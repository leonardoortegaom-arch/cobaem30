'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const apply = require('../scripts/migrationApply');
const manifestApi = require('../scripts/migrationManifest');
const preflight = require('../scripts/migrationPreflight');

const manifest = manifestApi.cargarManifiesto();
const entry015 = manifest.migraciones.find((item) => item.version === 15);
const contract = apply.cargarContrato(entry015);
const descriptor = preflight.cargarDescriptor();

function baselineRows() {
    return manifest.migraciones.filter((e) => e.version <= 8).map((e) => ({
        version: e.version, archivo: e.archivo, checksum_sha256: e.checksumSha256,
        tipo_registro: e.version === 0 ? 'EJECUTADA' : 'BASELINE'
    }));
}

function compatibleSnapshot() {
    return preflight.crearSnapshotCompatible(descriptor, { control: 'complete', controlRows: baselineRows() });
}

function tableFromContract(spec) {
    const columnas = Object.fromEntries(spec.columnas.map((c, i) => [c.nombre, {
        tipo: c.tipo.toLowerCase(), unsigned: c.unsigned, nullable: c.nullable,
        default: Object.hasOwn(c, 'default') ? String(c.default).toLowerCase() : null,
        extra: String(c.extra || '').toLowerCase(), ordinal: i + 1
    }]));
    return {
        engine: spec.engine, charset: spec.charset, collation: spec.collation, columnas,
        indices: [{ unique: true, columnas: spec.primaryKey }]
            .concat(spec.indicesUnicos.map((i) => ({ unique: true, columnas: i.columnas })))
            .concat(spec.indices.map((i) => ({ unique: false, columnas: i.columnas }))),
        foreignKeys: structuredClone(spec.foreignKeys),
        checks: spec.checks.map((c) => c.fragmentos.join(' ').replace(/,\s+/g, ','))
    };
}

function appliedSnapshot(withRow = false) {
    const snapshot = compatibleSnapshot();
    for (const [name, spec] of Object.entries(contract.tablas)) snapshot.tablas[name] = tableFromContract(spec);
    if (withRow) snapshot.controlRows.push({ version: 15, archivo: entry015.archivo, checksum_sha256: entry015.checksumSha256, tipo_registro: 'EJECUTADA' });
    return snapshot;
}

function mockPool(connection) {
    return { ended: false, async getConnection() { return connection; }, async end() { this.ended = true; } };
}

function adminOptions(mode, backupFile, hash) {
    return apply.parsearArgumentos(['up', mode, '--confirm=APPLY-ACTIVE-MIGRATIONS', '--acknowledge-ddl-autocommit', `--backup-file=${backupFile}`, `--backup-sha256=${hash}`]);
}

function adminEnv() {
    return { MIGRATION_DB_ALLOW_WRITES: 'ACTIVE_MIGRATIONS_ONLY', MIGRATION_DB_HOST: 'localhost', MIGRATION_DB_PORT: '3306', MIGRATION_DB_NAME: 'x', MIGRATION_DB_USER: 'x', MIGRATION_DB_PASSWORD: 'x' };
}

function tempBackup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'n5b-')); const file = path.join(dir, 'backup con espacio.sql');
    fs.writeFileSync(file, 'backup'); return { dir, file, hash: crypto.createHash('sha256').update('backup').digest('hex') };
}

test('01 contrato 015 válido y checksum correcto', () => {
    assert.equal(contract.migracion, 15);
    assert.equal(manifestApi.calcularChecksumCanonico(path.join(manifestApi.PROJECT_ROOT, entry015.execution.postconditionContract)), entry015.execution.postconditionChecksumSha256);
});
test('02 contrato contiene las tres tablas y campos', () => {
    assert.deepEqual(Object.keys(contract.tablas), ['generaciones', 'ciclos_escolares', 'periodos_academicos']);
    assert.ok(contract.tablas.periodos_academicos.columnas.some((c) => c.nombre === 'ciclo_escolar_id' && c.unsigned));
});
test('03 contrato contiene índices FK CHECK y opciones', () => {
    assert.equal(contract.tablas.periodos_academicos.foreignKeys[0].onDelete, 'RESTRICT');
    assert.equal(contract.tablas.generaciones.engine, 'innodb'); assert.ok(contract.tablas.generaciones.checks.length);
});
test('04 manifiesto formato 2 y metadata obligatoria', () => {
    assert.equal(manifest.versionFormato, 2); assert.equal(manifest.legacyBaselineThrough, 8); assert.equal(entry015.execution.statementCount, 3);
});
test('05 rutas de contrato seguras', () => assert.doesNotThrow(() => manifestApi.validarArchivosYChecksums(manifest)));
test('06 dry-run encuentra solo 015', async () => {
    const connection = { release() {} }; const pool = mockPool(connection); const out = [];
    const plan = await apply.ejecutarDryRun({ log: (x) => out.push(x) }, { pool, snapshot: async () => compatibleSnapshot() });
    assert.deepEqual(plan.map((p) => p.entrada.version), [15]); assert.match(out.join('\n'), /MIGRATION_UP_DRY_RUN_NO_CHANGES/); assert.ok(pool.ended);
});
test('07 baseline parcial rechazado', () => { const s = compatibleSnapshot(); s.controlRows.pop(); assert.throws(() => apply.construirPlan(manifest, s), (e) => e.code === 'BASELINE_PARTIAL'); });
test('08 checksum aplicado distinto rechazado', () => { const s = compatibleSnapshot(); s.controlRows[1].checksum_sha256 = '0'.repeat(64); assert.throws(() => apply.construirPlan(manifest, s)); });
test('09 versión desconocida rechazada', () => { const s = compatibleSnapshot(); s.controlRows.push({ version: 99 }); assert.throws(() => apply.construirPlan(manifest, s)); });
test('10 estructura parcial no registrada rechazada', () => { const s = compatibleSnapshot(); s.tablas.generaciones = tableFromContract(contract.tablas.generaciones); assert.throws(() => apply.construirPlan(manifest, s), (e) => e.code === 'UNREGISTERED_PARTIAL_STRUCTURE'); });
test('11 015 aplicada con postcondición correcta es idempotente', () => assert.deepEqual(apply.construirPlan(manifest, appliedSnapshot(true)), []));
test('12 015 aplicada con deriva rechazada', () => { const s = appliedSnapshot(true); delete s.tablas.generaciones.columnas.anio_fin; assert.throws(() => apply.construirPlan(manifest, s)); });

test('13 separador respeta strings backticks y comentarios', () => {
    const sql = "-- a;\nCREATE TABLE `a` (`x` VARCHAR(9) DEFAULT ';'); # b;\n/* c; */ CREATE TABLE b (id INT);";
    assert.equal(apply.separarSentenciasSql(sql).length, 2);
});
test('14 punto y coma dentro de strings no divide', () => assert.equal(apply.separarSentenciasSql("SELECT ';';").length, 1));
test('15 comentario sin cerrar rechazado', () => assert.throws(() => apply.separarSentenciasSql('/* x')));
test('16 cadena sin cerrar rechazada', () => assert.throws(() => apply.separarSentenciasSql("SELECT 'x")));
test('17 DELIMITER rechazado', () => assert.throws(() => apply.separarSentenciasSql('DELIMITER $$')));
test('18 SOURCE rechazado', () => assert.throws(() => apply.separarSentenciasSql('SOURCE otro.sql')));
test('19 015 produce tres sentencias correctas', () => assert.deepEqual(apply.validarSqlMigracion(entry015).map((s) => s.target), ['generaciones', 'ciclos_escolares', 'periodos_academicos']));
test('20 orden incorrecto rechazado', () => { const e = structuredClone(entry015); e.execution.statements.reverse(); assert.throws(() => apply.validarSqlMigracion(e)); });
test('21 target distinto rechazado', () => { const e = structuredClone(entry015); e.execution.statements[0].target = 'otra'; assert.throws(() => apply.validarSqlMigracion(e)); });
test('22 sentencia adicional rechazada', () => { const e = structuredClone(entry015); e.execution.statementCount = 2; assert.throws(() => apply.validarSqlMigracion(e)); });
test('23 DML ALTER DROP rechazados', () => { for (const sql of ['INSERT INTO x VALUES(1)', 'ALTER TABLE x ADD y INT', 'DROP TABLE x']) assert.throws(() => apply.clasificarSentenciaDeclarada(sql, { operation: 'CREATE_TABLE', target: 'x' }), (e) => e.code === 'SQL_OPERATION_FORBIDDEN'); });

test('24 dry-run no ejecuta SQL mediante conexión', async () => {
    let calls = 0; const pool = mockPool({ execute() { calls += 1; }, release() {} });
    await apply.ejecutarDryRun({ log() {} }, { pool, snapshot: async () => compatibleSnapshot() }); assert.equal(calls, 0);
});
test('25 barreras administrativas completas', () => {
    const b = tempBackup(); try { assert.equal(apply.validarBarreras(adminOptions('--execute', b.file, b.hash), adminEnv()).multipleStatements, false); } finally { fs.rmSync(b.dir, { recursive: true }); }
});
test('26 execute-preflight no escribe', async () => {
    const b = tempBackup(); const queries = []; const connection = { async execute(sql) { queries.push(sql); return [[{ lock_obtenido: 1 }]]; }, release() {} }; const pool = mockPool(connection);
    try { await apply.ejecutarAdministrativo(adminOptions('--execute-preflight', b.file, b.hash), false, { log() {} }, { env: adminEnv(), pool, snapshot: async () => compatibleSnapshot(), privileges: async () => ({ estado: 'PRESENT' }) }); } finally { fs.rmSync(b.dir, { recursive: true }); }
    assert.ok(queries.every((q) => /^SELECT|^WITH/i.test(q))); assert.equal(queries.some((q) => /INSERT|CREATE/i.test(q)), false);
});
test('27 permisos insuficientes bloquean', async () => {
    const b = tempBackup(); const c = { async execute() { return [[{ lock_obtenido: 1 }]]; }, release() {} };
    try { await assert.rejects(apply.ejecutarAdministrativo(adminOptions('--execute-preflight', b.file, b.hash), false, { log() {} }, { env: adminEnv(), pool: mockPool(c), snapshot: async () => compatibleSnapshot(), privileges: async () => ({ estado: 'INSUFFICIENT' }) })); } finally { fs.rmSync(b.dir, { recursive: true }); }
});
test('28 lock siempre se libera', async () => {
    const b = tempBackup(); const queries = []; const c = { async execute(sql) { queries.push(sql); return [[{ lock_obtenido: 1 }]]; }, release() {} };
    try { await assert.rejects(apply.ejecutarAdministrativo(adminOptions('--execute-preflight', b.file, b.hash), false, { log() {} }, { env: adminEnv(), pool: mockPool(c), snapshot: async () => { throw new Error('x'); } })); } finally { fs.rmSync(b.dir, { recursive: true }); }
    assert.ok(queries.some((q) => /RELEASE_LOCK/.test(q)));
});

async function simulatedExecution(failAt = 0, badPost = false, failRecord = false) {
    const b = tempBackup(); const calls = []; let ddl = 0;
    const c = { released: false, async execute(sql, params) {
        calls.push({ sql, params });
        if (/GET_LOCK/.test(sql)) return [[{ lock_obtenido: 1 }]];
        if (/RELEASE_LOCK/.test(sql)) return [[{ lock_liberado: 1 }]];
        if (/^CREATE TABLE/.test(sql)) { ddl += 1; if (ddl === failAt) throw new Error('ddl'); return [{ affectedRows: 0 }]; }
        if (/^INSERT INTO schema_migrations/.test(sql)) { if (failRecord) throw new Error('record'); return [{ affectedRows: 1 }]; }
        return [[]];
    }, async beginTransaction() { calls.push({ sql: 'BEGIN' }); }, async commit() { calls.push({ sql: 'COMMIT' }); }, async rollback() { calls.push({ sql: 'ROLLBACK' }); }, release() { this.released = true; } };
    const pool = mockPool(c); const after = appliedSnapshot(false); if (badPost) delete after.tablas.generaciones;
    try {
        const result = await apply.ejecutarAdministrativo(adminOptions('--execute', b.file, b.hash), true, { log() {} }, {
            env: adminEnv(), pool, snapshot: async () => compatibleSnapshot(), privileges: async () => ({ estado: 'PRESENT' }),
            snapshotAfter: async () => after, snapshotVerified: async () => appliedSnapshot(true), randomUUID: () => '00000000-0000-4000-8000-000000000001'
        }); return { result, calls, pool, c };
    } finally { fs.rmSync(b.dir, { recursive: true }); }
}

test('29 ejecución simulada aplica tres sentencias individualmente', async () => { const r = await simulatedExecution(); assert.equal(r.calls.filter((x) => /^CREATE TABLE/.test(x.sql)).length, 3); });
test('30 nunca activa multipleStatements', () => { const b = tempBackup(); try { assert.equal(apply.validarBarreras(adminOptions('--execute', b.file, b.hash), adminEnv()).multipleStatements, false); } finally { fs.rmSync(b.dir, { recursive: true }); } });
for (const n of [1, 2, 3]) test(`3${n}. fallo en sentencia ${n} no registra`, async () => { await assert.rejects(simulatedExecution(n)); });
test('34 fallo de postcondición no registra', async () => { await assert.rejects(simulatedExecution(0, true)); });
test('35 registro usa placeholders y datos exactos de 015', async () => { const r = await simulatedExecution(); const call = r.calls.find((x) => /^INSERT INTO/.test(x.sql)); assert.match(call.sql, /VALUES \(\?, \?, \?, 'EJECUTADA', \?, \?\)/); assert.deepEqual(call.params.slice(0, 3), [15, entry015.archivo, entry015.checksumSha256]); });
test('36 fallo de registro no intenta reparación destructiva', async () => { let err; try { await simulatedExecution(0, false, true); } catch (e) { err = e; } assert.ok(err); assert.doesNotMatch(String(err), /DROP/i); });
test('37 commit ocurre tras registro', async () => { const r = await simulatedExecution(); assert.ok(r.calls.findIndex((x) => /^INSERT/.test(x.sql)) < r.calls.findIndex((x) => x.sql === 'COMMIT')); });
test('38 recursos cierran tras éxito', async () => { const r = await simulatedExecution(); assert.ok(r.pool.ended && r.c.released); });
test('39 errores CLI saneados', async () => { const errors = []; const code = await apply.ejecutarCli(['up', '--execute', '--secret=x'], { log() {}, error: (e) => errors.push(e) }); assert.equal(code, 2); assert.match(errors[0], /^MIGRATION_FAILED_STAGE=/); assert.doesNotMatch(errors[0], /secret|SQL|C:\\/i); });
test('40 require no abre conexión ni carga dotenv', () => { const source = fs.readFileSync(require.resolve('../scripts/migrationApply'), 'utf8'); assert.match(source, /require\.main === module/); assert.doesNotMatch(source.split('function crearPoolLectura')[0], /require\(['"]dotenv/); });
test('41 no existen comandos down repair force', async () => { for (const command of ['down', 'repair', 'force']) assert.notEqual(await apply.ejecutarCli([command], { log() {}, error() {} }), 0); });
test('42 contraseña CLI se rechaza', () => assert.throws(() => apply.parsearArgumentos(['up', '--execute', '--password=x'])));
test('43 modo administrativo exige respaldo', () => { const o = apply.parsearArgumentos(['up', '--execute', '--confirm=APPLY-ACTIVE-MIGRATIONS', '--acknowledge-ddl-autocommit', `--backup-sha256=${'0'.repeat(64)}`]); assert.throws(() => apply.validarBarreras(o, adminEnv())); });
test('44 modo preflight termina sin cambios', async () => {
    const b = tempBackup(); const output = []; const c = { async execute(sql) { return [[{ lock_obtenido: 1 }]]; }, release() {} };
    try { await apply.ejecutarAdministrativo(adminOptions('--execute-preflight', b.file, b.hash), false, { log: (x) => output.push(x) }, { env: adminEnv(), pool: mockPool(c), snapshot: async () => compatibleSnapshot(), privileges: async () => ({ estado: 'PRESENT' }) }); } finally { fs.rmSync(b.dir, { recursive: true }); }
    assert.match(output.join('\n'), /MIGRATION_EXECUTE_PREFLIGHT_COMPLETE_NO_CHANGES/);
});
test('45 SQL 015 permanece inmutable por checksum', () => assert.equal(manifestApi.calcularChecksumCanonico(path.join(manifestApi.MIGRATIONS_DIR, entry015.archivo)), entry015.checksumSha256));
