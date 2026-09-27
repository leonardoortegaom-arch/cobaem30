'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const apply = require('../scripts/migrationApply');
const manifestApi = require('../scripts/migrationManifest');
const preflight = require('../scripts/migrationPreflight');

const manifest = manifestApi.cargarManifiesto();
const entry = manifest.migraciones.find((item) => item.version === 22);
const contract = apply.cargarContrato(entry);
const sqlPath = path.join(manifestApi.MIGRATIONS_DIR, entry.archivo);
const sql = fs.readFileSync(sqlPath, 'utf8');
const descriptor = preflight.cargarDescriptor();
const existingStates = [
    ['PENDIENTE', 'Pendiente', 1], ['EN_PROCESO', 'En proceso', 2],
    ['REALIZADA', 'Realizada', 3], ['NO_REALIZADA', 'No realizada', 4],
    ['CANCELADA', 'Cancelada', 5]
].map(([clave, nombre, orden]) => ({ clave, nombre, descripcion: 'Existente', orden, activo: 1 }));
const rejected = structuredClone(contract.filasCatalogo.estados_actividad_orientacion[0]);

function controlRows(through = 21) {
    return manifest.migraciones.filter((item) => item.version <= 8 || (item.estado === 'ACTIVE' && item.version <= through)).map((item) => ({
        version: item.version, archivo: item.archivo, checksum_sha256: item.checksumSha256,
        tipo_registro: item.version === 0 ? 'EJECUTADA' : item.version <= 8 ? 'BASELINE' : 'EJECUTADA'
    }));
}

function snapshot({ applied = false, rows = existingStates } = {}) {
    const result = preflight.crearSnapshotCompatible(descriptor, {
        control: 'complete', controlRows: controlRows(applied ? 22 : 21),
        filasCatalogo: { estados_actividad_orientacion: structuredClone(rows) }
    });
    for (const version of [15, 16, 17, 18, 19, 20, 21]) {
        const current = apply.cargarContrato(manifest.migraciones.find((item) => item.version === version));
        for (const [name, spec] of Object.entries(current.tablas)) {
            const columns = Object.fromEntries(spec.columnas.map((column, index) => [column.nombre, {
                tipo: column.tipo.toLowerCase(), unsigned: column.unsigned, nullable: column.nullable,
                default: Object.hasOwn(column, 'default') && column.default !== null ? String(column.default).toLowerCase() : null,
                extra: String(column.extra || '').toLowerCase(), collation: column.collation || null,
                generationExpression: preflight.normalizarExpresionGenerada(column.generationExpression), ordinal: index + 1
            }]));
            result.tablas[name] = {
                engine: spec.engine, charset: spec.charset, collation: spec.collation, columnas: columns,
                indices: [{ unique: true, columnas: spec.primaryKey }]
                    .concat(spec.indicesUnicos.map((index) => ({ unique: true, columnas: index.columnas })))
                    .concat(spec.indices.map((index) => ({ unique: false, columnas: index.columnas }))),
                foreignKeys: structuredClone(spec.foreignKeys),
                checks: spec.checks.map((check) => check.fragmentos.join(' ').replace(/,\s+/g, ','))
            };
        }
    }
    return result;
}

function backup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-022-'));
    const file = path.join(dir, 'backup.sql');
    fs.writeFileSync(file, 'backup');
    return { dir, file, hash: crypto.createHash('sha256').update('backup').digest('hex') };
}

function options(mode, file, hash) {
    return apply.parsearArgumentos(['up', mode, '--confirm=APPLY-ACTIVE-MIGRATIONS', '--acknowledge-ddl-autocommit', `--backup-file=${file}`, `--backup-sha256=${hash}`]);
}

const env = { MIGRATION_DB_ALLOW_WRITES: 'ACTIVE_MIGRATIONS_ONLY', MIGRATION_DB_HOST: 'localhost', MIGRATION_DB_PORT: '3306', MIGRATION_DB_NAME: 'x', MIGRATION_DB_USER: 'x', MIGRATION_DB_PASSWORD: 'x' };

test('01 SQL y contrato 022 existen y están manifestados', () => {
    assert.ok(fs.statSync(sqlPath).isFile());
    assert.equal(entry.estado, 'ACTIVE');
    assert.equal(contract.migracion, 22);
});
test('02 contiene exactamente un INSERT al catálogo exacto', () => {
    const statements = apply.validarSqlMigracion(entry);
    assert.deepEqual(statements.map(({ operation, target }) => ({ operation, target })), [{ operation: 'INSERT_CATALOG_ROW', target: 'estados_actividad_orientacion' }]);
});
test('03 no fija ID ni contiene operaciones prohibidas', () => {
    assert.doesNotMatch(sql, /\bid\s*[,)]/i);
    assert.doesNotMatch(sql, /\b(UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|REPLACE)\b/i);
    assert.doesNotMatch(sql, /INSERT\s+IGNORE|ON\s+DUPLICATE|INSERT[\s\S]+SELECT/i);
});
test('04 valores contractuales son exactos y el orden es el siguiente libre', () => {
    assert.deepEqual(rejected, { clave: 'RECHAZADA', nombre: 'Rechazada', descripcion: 'La evidencia requiere correcciones antes de considerarse realizada.', orden: 6, activo: 1 });
});
test('05 depende exclusivamente de 021', () => assert.deepEqual(entry.execution.dependsOn, [21]));
test('06 checksums SQL y contrato coinciden', () => {
    assert.equal(manifestApi.calcularChecksumCanonico(sqlPath), entry.checksumSha256);
    assert.equal(manifestApi.calcularChecksumCanonico(path.join(manifestApi.PROJECT_ROOT, entry.execution.postconditionContract)), entry.execution.postconditionChecksumSha256);
});
test('07 todos los SQL físicos permanecen manifestados', () => assert.doesNotThrow(() => manifestApi.validarArchivosYChecksums(manifest)));
test('08 precondición acepta ausencia completa', () => assert.equal(apply.validarPrecondiciones(snapshot(), entry), true));
for (const [index, mutation] of [
    ['clave existente', { clave: 'RECHAZADA', nombre: 'Otra', orden: 9 }],
    ['nombre existente', { clave: 'OTRA', nombre: 'Rechazada', orden: 9 }],
    ['orden existente', { clave: 'OTRA', nombre: 'Otra', orden: 6 }]
].entries()) test(`${9 + index} rechaza ${mutation[0]}`, () => {
    assert.throws(() => apply.validarPrecondiciones(snapshot({ rows: [...existingStates, { ...mutation[1], descripcion: '', activo: 1 }] }), entry));
});
test('12 postcondición exige la fila exacta y cardinalidad uno', () => assert.equal(apply.validarPostcondicion(snapshot({ rows: [...existingStates, rejected] }), contract), true));
test('13 fila parcial o distinta es rechazada', () => assert.throws(() => apply.validarPostcondicion(snapshot({ rows: [...existingStates, { ...rejected, activo: 0 }] }), contract)));
test('14 cardinalidad distinta de uno es rechazada', () => assert.throws(() => apply.validarPostcondicion(snapshot({ rows: [...existingStates, rejected, rejected] }), contract)));

for (const [name, candidate] of [
    ['otra tabla', "INSERT INTO roles (clave,nombre,descripcion,orden,activo) VALUES ('RECHAZADA','Rechazada','La evidencia requiere correcciones antes de considerarse realizada.',6,1)"],
    ['múltiples filas', "INSERT INTO estados_actividad_orientacion (clave,nombre,descripcion,orden,activo) VALUES ('RECHAZADA','Rechazada','La evidencia requiere correcciones antes de considerarse realizada.',6,1),('X','X','X',7,1)"],
    ['INSERT SELECT', 'INSERT INTO estados_actividad_orientacion SELECT * FROM roles'],
    ['INSERT IGNORE', "INSERT IGNORE INTO estados_actividad_orientacion (clave) VALUES ('RECHAZADA')"],
    ['REPLACE', "REPLACE INTO estados_actividad_orientacion (clave) VALUES ('RECHAZADA')"],
    ['ON DUPLICATE', "INSERT INTO estados_actividad_orientacion (clave) VALUES ('RECHAZADA') ON DUPLICATE KEY UPDATE activo=1"],
    ['UPDATE', "UPDATE estados_actividad_orientacion SET activo=1"],
    ['DELETE', "DELETE FROM estados_actividad_orientacion"],
    ['DDL', 'ALTER TABLE estados_actividad_orientacion ADD x INT']
]) test(`15 rechaza ${name}`, () => assert.throws(() => apply.clasificarSentenciaDeclarada(candidate, entry.execution.statements[0])));

test('16 dry-run selecciona solo 022 y no escribe', async () => {
    const calls = []; const output = [];
    const connection = { async execute(sqlText) { calls.push(sqlText); return [[]]; }, release() {} };
    const pool = { async getConnection() { return connection; }, async end() {} };
    const plan = await apply.ejecutarDryRun({ log: (line) => output.push(line) }, { pool, manifest, snapshot: async () => snapshot() });
    assert.deepEqual(plan.map((item) => item.entrada.version), [22]);
    assert.match(output.join('\n'), /INSERT_CATALOG_ROW estados_actividad_orientacion/);
    assert.match(output.join('\n'), /se aplicará transaccionalmente junto con su registro/);
    assert.doesNotMatch(output.join('\n'), /DDL de MySQL/);
    assert.equal(calls.some((query) => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(query)), false);
});

async function simulate({ fail = '' } = {}) {
    const b = backup(); const calls = []; let catalogInserted = false; let migrationInserted = false;
    const connection = {
        async execute(query, params) {
            calls.push({ query, params });
            if (/GET_LOCK/.test(query)) return [[{ lock_obtenido: 1 }]];
            if (/RELEASE_LOCK/.test(query)) return [[{ lock_liberado: 1 }]];
            if (/^INSERT INTO estados_actividad_orientacion/i.test(query)) { if (fail === 'catalog') throw new Error('catalog'); catalogInserted = true; return [{ affectedRows: 1 }]; }
            if (/^INSERT INTO schema_migrations/i.test(query)) { if (fail === 'record') throw new Error('record'); migrationInserted = true; return [{ affectedRows: 1 }]; }
            return [[]];
        },
        async beginTransaction() { calls.push({ query: 'BEGIN' }); },
        async commit() { calls.push({ query: 'COMMIT' }); },
        async rollback() { calls.push({ query: 'ROLLBACK' }); }, release() { calls.push({ query: 'RELEASE_CONNECTION' }); }
    };
    const pool = { async getConnection() { return connection; }, async end() { calls.push({ query: 'POOL_END' }); } };
    const afterRows = () => [...existingStates, rejected];
    try {
        await apply.ejecutarAdministrativo(options('--execute', b.file, b.hash), true, { log() {} }, {
            env, pool, manifest, privileges: async (c, required) => { calls.push({ query: `PRIVILEGES:${required.join(',')}` }); return { estado: 'PRESENT' }; },
            snapshot: async () => snapshot(),
            snapshotAfter: async () => { if (fail === 'postcondition') return snapshot(); return snapshot({ rows: afterRows() }); },
            snapshotBeforeCommit: async () => snapshot({ applied: true, rows: afterRows() }),
            snapshotVerified: async () => snapshot({ applied: true, rows: afterRows() }),
            randomUUID: () => '00000000-0000-4000-8000-000000000022'
        });
        return { calls, catalogInserted, migrationInserted };
    } finally { fs.rmSync(b.dir, { recursive: true }); }
}

test('17 execute-preflight simulado no escribe y solo exige SELECT e INSERT', async () => {
    const b = backup(); const calls = [];
    const connection = { async execute(query) { calls.push(query); if (/GET_LOCK/.test(query)) return [[{ lock_obtenido: 1 }]]; return [[]]; }, release() {} };
    const pool = { async getConnection() { return connection; }, async end() {} };
    try {
        await apply.ejecutarAdministrativo(options('--execute-preflight', b.file, b.hash), false, { log() {} }, { env, pool, manifest, snapshot: async () => snapshot(), privileges: async (c, required) => { assert.deepEqual(required, ['SELECT', 'INSERT']); return { estado: 'PRESENT' }; } });
    } finally { fs.rmSync(b.dir, { recursive: true }); }
    assert.equal(calls.some((query) => /^INSERT|^UPDATE|^DELETE|^CREATE|^ALTER|^DROP/i.test(query)), false);
});
test('18 ejecución futura usa exactamente dos INSERT dentro de una transacción', async () => {
    const result = await simulate(); const writes = result.calls.filter((call) => /^INSERT/i.test(call.query));
    assert.equal(writes.length, 2); assert.match(writes[0].query, /estados_actividad_orientacion/); assert.match(writes[1].query, /schema_migrations/);
    assert.ok(result.calls.findIndex((call) => call.query === 'BEGIN') < result.calls.findIndex((call) => /^INSERT INTO estados/.test(call.query)));
    assert.ok(result.calls.findIndex((call) => /^INSERT INTO schema/.test(call.query)) < result.calls.findIndex((call) => call.query === 'COMMIT'));
});
for (const failure of ['catalog', 'postcondition', 'record']) test(`19 rollback ante fallo de ${failure}`, async () => {
    let error; try { await simulate({ fail: failure }); } catch (caught) { error = caught; }
    assert.ok(error);
});
test('20 libera lock, conexión y pool en éxito', async () => {
    const { calls } = await simulate();
    assert.ok(calls.some((call) => /RELEASE_LOCK/.test(call.query)));
    assert.ok(calls.some((call) => call.query === 'RELEASE_CONNECTION'));
    assert.ok(calls.some((call) => call.query === 'POOL_END'));
});
