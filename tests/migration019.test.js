'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const manifestApi = require('../scripts/migrationManifest');
const preflight = require('../scripts/migrationPreflight');
const apply = require('../scripts/migrationApply');

const manifest = manifestApi.cargarManifiesto();
const entry = manifest.migraciones.find((item) => item.version === 19);
const sqlPath = path.join(manifestApi.MIGRATIONS_DIR, entry.archivo || '');
const sql = fs.readFileSync(sqlPath, 'utf8');
const normalized = sql.replace(/--[^\r\n]*/g, '').toLowerCase();
const contract = apply.cargarContrato(entry);
const manifestBefore020 = structuredClone(manifest);
const entry020Fixture = manifestBefore020.migraciones.find((item) => item.version === 20);
Object.assign(entry020Fixture, { estado: 'PLANNED', archivo: null, checksumSha256: null, razonEstado: 'Fixture previa a 020.' });
delete entry020Fixture.execution;
const entry021Fixture = manifestBefore020.migraciones.find((item) => item.version === 21);
Object.assign(entry021Fixture, { estado: 'PLANNED', archivo: null, checksumSha256: null, razonEstado: 'Fixture previa a 021.' });
delete entry021Fixture.execution;
const entry022Fixture = manifestBefore020.migraciones.find((item) => item.version === 22);
Object.assign(entry022Fixture, { estado: 'PLANNED', archivo: null, checksumSha256: null, razonEstado: 'Fixture previa a 022.' });
delete entry022Fixture.execution;
manifestBefore020.migraciones = manifestBefore020.migraciones.filter((item) => item.version <= 19);

function tableFromContract(spec) {
    const columnas = Object.fromEntries(spec.columnas.map((column, index) => [column.nombre, {
        tipo: column.tipo.toLowerCase(),
        unsigned: column.unsigned,
        nullable: column.nullable,
        default: Object.hasOwn(column, 'default') && column.default !== null ? String(column.default).toLowerCase() : null,
        extra: String(column.extra || '').toLowerCase(),
        collation: column.collation || null,
        generationExpression: preflight.normalizarExpresionGenerada(column.generationExpression),
        ordinal: index + 1
    }]));
    return {
        engine: spec.engine,
        charset: spec.charset,
        collation: spec.collation,
        columnas,
        indices: [{ unique: true, columnas: spec.primaryKey }]
            .concat(spec.indicesUnicos.map((index) => ({ unique: true, columnas: index.columnas })))
            .concat(spec.indices.map((index) => ({ unique: false, columnas: index.columnas }))),
        foreignKeys: structuredClone(spec.foreignKeys),
        checks: spec.checks.map((check) => check.fragmentos.join(' '))
    };
}

function appliedRow(migration) {
    return {
        version: migration.version,
        archivo: migration.archivo,
        checksum_sha256: migration.checksumSha256,
        tipo_registro: migration.version === 0 ? 'EJECUTADA' : migration.version <= 8 ? 'BASELINE' : 'EJECUTADA'
    };
}

function snapshotBefore019() {
    const descriptor = preflight.cargarDescriptor();
    const rows = manifest.migraciones.filter((item) => item.version <= 8).map(appliedRow);
    const snapshot = preflight.crearSnapshotCompatible(descriptor, { control: 'complete', controlRows: rows });
    for (const version of [15, 16, 17, 18]) {
        const migration = manifest.migraciones.find((item) => item.version === version);
        const currentContract = apply.cargarContrato(migration);
        for (const [name, spec] of Object.entries(currentContract.tablas)) snapshot.tablas[name] = tableFromContract(spec);
        snapshot.controlRows.push(appliedRow(migration));
    }
    return snapshot;
}

function recoverySnapshot() {
    const snapshot = snapshotBefore019();
    for (const [name, spec] of Object.entries(contract.tablas)) snapshot.tablas[name] = tableFromContract(spec);
    snapshot.tablas.versiones_horario.columnas.grupo_activo_id.generationExpression = 'case when (activa = 1) then grupo_id else null end';
    snapshot.tablas.versiones_horario.columnas.periodo_activo_id.generationExpression = 'case when (activa = 1) then periodo_academico_id else null end';
    return snapshot;
}

function mockPool(connection) {
    return { ended: false, async getConnection() { return connection; }, async end() { this.ended = true; } };
}

function recoveryOptions(mode, backup, hash) {
    const args = ['recover-registration', '--version=019', mode];
    if (mode !== '--dry-run') args.push('--confirm=RECOVER-MIGRATION-019', `--backup-file=${backup}`, `--backup-sha256=${hash}`);
    return apply.parsearArgumentos(args);
}

function recoveryEnv() {
    return {
        MIGRATION_DB_ALLOW_WRITES: 'REGISTRATION_RECOVERY_ONLY', MIGRATION_DB_HOST: 'localhost',
        MIGRATION_DB_PORT: '3306', MIGRATION_DB_NAME: 'test', MIGRATION_DB_USER: 'test', MIGRATION_DB_PASSWORD: 'test'
    };
}

test('01 archivo y contrato 019 están presentes', () => {
    assert.ok(fs.statSync(sqlPath).isFile());
    assert.ok(fs.statSync(path.join(manifestApi.PROJECT_ROOT, entry.execution.postconditionContract)).isFile());
});
test('02 contiene exactamente dos CREATE TABLE en orden', () => {
    assert.deepEqual(apply.validarSqlMigracion(entry).map((item) => `${item.operation} ${item.target}`), [
        'CREATE_TABLE importaciones_horario', 'CREATE_TABLE versiones_horario'
    ]);
});
test('03 no contiene DML', () => {
    for (const statement of apply.separarSentenciasSql(sql)) {
        assert.doesNotMatch(statement, /^\s*(insert|update|delete|replace)\b/i);
    }
});
test('04 no contiene ENUM ni objetos programables', () => assert.doesNotMatch(normalized, /\b(enum|trigger|procedure|function|view|event)\b/));
test('05 no almacena BLOB base64 ni rutas de archivos', () => assert.doesNotMatch(normalized, /\b(blob|binary|varbinary|base64|ruta_(?:temporal|permanente)|contenido_archivo)\b/));
test('06 importaciones conserva únicamente metadatos aprobados', () => {
    assert.deepEqual(contract.tablas.importaciones_horario.columnas.map((item) => item.nombre), [
        'id', 'grupo_id', 'periodo_academico_id', 'nombre_archivo_original', 'archivo_sha256',
        'archivo_tamano_bytes', 'total_filas', 'version_formato', 'importado_por_usuario_id', 'creado_en'
    ]);
});
test('07 version_formato es obligatorio y sin default', () => {
    const column = contract.tablas.importaciones_horario.columnas.find((item) => item.nombre === 'version_formato');
    assert.equal(column.nullable, false);
    assert.equal(Object.hasOwn(column, 'default'), false);
    assert.match(normalized, /check \(version_formato >= 1\)/);
});
test('08 total de filas y clases se limita a 1–500', () => {
    assert.equal((normalized.match(/between 1 and 500/g) || []).length, 2);
});
test('09 SHA-256 usa ASCII binario y CHECK hexadecimal de 64 caracteres', () => {
    assert.match(normalized, /archivo_sha256 char\(64\) character set ascii collate ascii_bin not null/);
    assert.match(normalized, /archivo_sha256 regexp '\^\[0-9a-fa-f\]\{64\}\$'/);
    assert.equal(contract.tablas.importaciones_horario.columnas.find((item) => item.nombre === 'archivo_sha256').collation, 'ascii_bin');
});
test('10 archivo es único por grupo y periodo', () => {
    assert.match(normalized, /unique key uq_importaciones_alcance_archivo\s*\(grupo_id, periodo_academico_id, archivo_sha256\)/);
});
test('11 número de versión es único por alcance', () => {
    assert.match(normalized, /unique key uq_versiones_numero_alcance\s*\(grupo_id, periodo_academico_id, numero_version\)/);
});
test('12 una sola versión activa se garantiza por clave generada compuesta', () => {
    assert.match(normalized, /unique key uq_versiones_alcance_activo\s*\(grupo_activo_id, periodo_activo_id\)/);
});
test('13 expresiones generadas representan el alcance activo', () => {
    const columns = contract.tablas.versiones_horario.columnas;
    assert.equal(columns.find((item) => item.nombre === 'grupo_activo_id').generationExpression, 'case when activa = 1 then grupo_id else null end');
    assert.equal(columns.find((item) => item.nombre === 'periodo_activo_id').generationExpression, 'case when activa = 1 then periodo_academico_id else null end');
});
test('14 importación y reversión son orígenes mutuamente excluyentes', () => {
    assert.match(normalized, /importacion_id is not null and version_origen_id is null[\s\S]*or[\s\S]*importacion_id is null and version_origen_id is not null/);
});
test('15 FK compuesta de importación conserva grupo y periodo', () => {
    const fk = contract.tablas.versiones_horario.foreignKeys.find((item) => item.tablaDestino === 'importaciones_horario');
    assert.deepEqual(fk.columnas, ['importacion_id', 'grupo_id', 'periodo_academico_id']);
    assert.deepEqual(fk.columnasDestino, ['id', 'grupo_id', 'periodo_academico_id']);
});
test('16 reversión no puede cruzar grupo ni periodo', () => {
    const fk = contract.tablas.versiones_horario.foreignKeys.find((item) => item.tablaDestino === 'versiones_horario');
    assert.deepEqual(fk.columnas, ['version_origen_id', 'grupo_id', 'periodo_academico_id']);
    assert.deepEqual(fk.columnasDestino, ['id', 'grupo_id', 'periodo_academico_id']);
});
test('17 FK de grupo y periodo usan UPDATE RESTRICT', () => {
    const fks = Object.values(contract.tablas).flatMap((table) => table.foreignKeys);
    assert.ok(fks.filter((fk) => ['grupos', 'periodos_academicos'].includes(fk.tablaDestino)).every((fk) => fk.onUpdate === 'RESTRICT'));
});
test('18 todas las FK usan DELETE RESTRICT', () => {
    assert.ok(Object.values(contract.tablas).flatMap((table) => table.foreignKeys).every((fk) => fk.onDelete === 'RESTRICT'));
    assert.doesNotMatch(normalized, /on delete cascade/);
});
test('19 índices históricos y administrativos coinciden con el contrato', () => {
    assert.ok(contract.tablas.importaciones_horario.indices.some((item) => item.columnas.join(',') === 'grupo_id,periodo_academico_id,creado_en,id'));
    assert.ok(contract.tablas.versiones_horario.indices.some((item) => item.columnas.join(',') === 'creada_por_usuario_id,creado_en,id'));
});
test('20 timestamps y estado activo están restringidos', () => {
    assert.match(normalized, /activa boolean not null default false/);
    assert.match(normalized, /activa = 0[\s\S]*activada_en is not null and desactivada_en is null/);
    assert.match(normalized, /desactivada_en >= activada_en/);
});
test('21 contrato valida tablas completas y opciones', () => {
    assert.deepEqual(Object.keys(contract.tablas), ['importaciones_horario', 'versiones_horario']);
    for (const table of Object.values(contract.tablas)) {
        assert.equal(table.engine, 'innodb');
        assert.equal(table.charset, 'utf8mb4');
        assert.equal(table.collation, 'utf8mb4_0900_ai_ci');
        assert.deepEqual(table.primaryKey, ['id']);
    }
});
test('22 precondición válida con ambas tablas ausentes', () => {
    assert.equal(apply.validarPrecondiciones(snapshotBefore019(), entry), true);
});
test('23 estado parcial con solo importaciones se rechaza', () => {
    const snapshot = snapshotBefore019();
    snapshot.tablas.importaciones_horario = tableFromContract(contract.tablas.importaciones_horario);
    assert.throws(() => apply.construirPlan(manifest, snapshot), (error) => error.code === 'UNREGISTERED_PARTIAL_STRUCTURE');
});
test('24 estado parcial con solo versiones se rechaza', () => {
    const snapshot = snapshotBefore019();
    snapshot.tablas.versiones_horario = tableFromContract(contract.tablas.versiones_horario);
    assert.throws(() => apply.construirPlan(manifest, snapshot), (error) => error.code === 'UNREGISTERED_PARTIAL_STRUCTURE');
});
test('25 postcondición completa acepta FK e índices compuestos', () => {
    const snapshot = { tablas: Object.fromEntries(Object.entries(contract.tablas).map(([name, spec]) => [name, tableFromContract(spec)])) };
    assert.equal(apply.validarPostcondicion(snapshot, contract), true);
});
test('26 falta de una columna en postcondición se rechaza', () => {
    const snapshot = { tablas: Object.fromEntries(Object.entries(contract.tablas).map(([name, spec]) => [name, tableFromContract(spec)])) };
    delete snapshot.tablas.versiones_horario.columnas.periodo_activo_id;
    assert.throws(() => apply.validarPostcondicion(snapshot, contract));
});
test('27 019 está ACTIVE y depende de 018', () => {
    assert.equal(entry.estado, 'ACTIVE');
    assert.deepEqual(entry.execution.dependsOn, [18]);
});
test('28 020 y 021 están ACTIVE', () => {
    assert.equal(manifest.migraciones.find((item) => item.version === 20).estado, 'ACTIVE');
    const migration = manifest.migraciones.find((item) => item.version === 21);
    assert.equal(migration.estado, 'ACTIVE');
    assert.equal(migration.archivo, '021_create_teacher_non_teaching_activities.sql');
});
test('29 checksums de SQL y contrato coinciden', () => {
    assert.equal(manifestApi.calcularChecksumCanonico(sqlPath), entry.checksumSha256);
    assert.equal(manifestApi.calcularChecksumCanonico(path.join(manifestApi.PROJECT_ROOT, entry.execution.postconditionContract)), entry.execution.postconditionChecksumSha256);
});
test('30 una 019 aplicada y registrada deja las posteriores pendientes por orden', () => {
    const snapshot = snapshotBefore019();
    for (const [name, spec] of Object.entries(contract.tablas)) snapshot.tablas[name] = tableFromContract(spec);
    snapshot.controlRows.push(appliedRow(entry));
    assert.deepEqual(apply.validarRegistrosAplicados(manifest, snapshot.controlRows).pending.map((item) => item.version), [20, 21, 22, 23, 24, 25, 26]);
});
test('31 fallo de la segunda sentencia no registra 019', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'migration019-'));
    const backup = path.join(directory, 'backup.sql');
    fs.writeFileSync(backup, 'backup', 'utf8');
    const hash = crypto.createHash('sha256').update('backup').digest('hex');
    const options = apply.parsearArgumentos(['up', '--execute', '--confirm=APPLY-ACTIVE-MIGRATIONS', '--acknowledge-ddl-autocommit', `--backup-file=${backup}`, `--backup-sha256=${hash}`]);
    const calls = [];
    let createCount = 0;
    const connection = {
        async execute(statement) {
            calls.push(statement);
            if (/GET_LOCK/.test(statement)) return [[{ lock_obtenido: 1 }]];
            if (/RELEASE_LOCK/.test(statement)) return [[{ lock_liberado: 1 }]];
            if (/^CREATE TABLE/.test(statement)) {
                createCount += 1;
                if (createCount === 2) throw Object.assign(new Error('detalle interno'), { code: 'ER_CANNOT_ADD_FOREIGN' });
                return [{ affectedRows: 0 }];
            }
            return [[]];
        },
        release() {}
    };
    const pool = { async getConnection() { return connection; }, async end() {} };
    const env = {
        MIGRATION_DB_ALLOW_WRITES: 'ACTIVE_MIGRATIONS_ONLY', MIGRATION_DB_HOST: 'localhost',
        MIGRATION_DB_PORT: '3306', MIGRATION_DB_NAME: 'test', MIGRATION_DB_USER: 'test', MIGRATION_DB_PASSWORD: 'test'
    };
    try {
        await assert.rejects(apply.ejecutarAdministrativo(options, true, { log() {} }, {
            env, pool, manifest: manifestBefore020, snapshot: async () => snapshotBefore019(), privileges: async () => ({ estado: 'PRESENT' })
        }));
        assert.equal(calls.filter((statement) => /^CREATE TABLE/.test(statement)).length, 2);
        assert.equal(calls.some((statement) => /^INSERT INTO schema_migrations/.test(statement)), false);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
test('32 no existe reparación destructiva ni datos iniciales', () => {
    assert.doesNotMatch(normalized, /\b(drop|truncate|alter)\b|\bvalues\s*\(/);
});

test('33 normaliza la expresión real de grupo_activo_id', () => {
    assert.equal(preflight.normalizarExpresionGenerada('case when (activa = 1) then grupo_id else null end'),
        preflight.normalizarExpresionGenerada('case when activa = 1 then grupo_id else null end'));
});
test('34 normaliza la expresión real de periodo_activo_id', () => {
    assert.equal(preflight.normalizarExpresionGenerada('case when (activa = 1) then periodo_academico_id else null end'),
        preflight.normalizarExpresionGenerada('case when activa = 1 then periodo_academico_id else null end'));
});
test('35 no confunde expresiones con precedencia lógica distinta', () => {
    assert.notEqual(preflight.normalizarExpresionGenerada('(a = 1 or b = 1) and c = 1'),
        preflight.normalizarExpresionGenerada('a = 1 or b = 1 and c = 1'));
});
test('36 conserva paréntesis de funciones, aritmética y CASE anidado', () => {
    for (const expression of ['coalesce((a + b), 0)', '(a + b) * c', 'case when a = 1 then (case when b = 1 then 1 else 0 end) else 0 end']) {
        assert.match(preflight.normalizarExpresionGenerada(expression), /\(/);
    }
});
test('37 recovery dry-run valida estructura real y no escribe', async () => {
    const calls = []; const connection = { async execute(sql) { calls.push(sql); return [[]]; }, release() {} };
    const pool = mockPool(connection); const logs = [];
    await apply.ejecutarRecuperacionDryRun({ log: (line) => logs.push(line) }, {
        manifest, pool, snapshot: async () => recoverySnapshot(), countRows: async () => ({ importaciones_horario: 0, versiones_horario: 0 })
    });
    assert.ok(logs.includes('RECOVERY_DRY_RUN_COMPLETE_NO_CHANGES'));
    assert.equal(calls.length, 0); assert.equal(pool.ended, true);
});
test('38 execute-preflight de recuperación usa solo SELECT y no escribe', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery019-')); const backup = path.join(directory, 'backup.sql');
    fs.writeFileSync(backup, 'backup'); const hash = crypto.createHash('sha256').update('backup').digest('hex');
    const calls = []; const connection = { async execute(sql) { calls.push(sql); return [[{ lock_obtenido: 1 }]]; }, release() {} };
    const pool = mockPool(connection); const logs = [];
    try {
        await apply.ejecutarRecuperacionAdministrativa(recoveryOptions('--execute-preflight', backup, hash), false, { log: (line) => logs.push(line) }, {
            env: recoveryEnv(), manifest, pool, snapshot: async () => recoverySnapshot(),
            countRows: async () => ({ importaciones_horario: 0, versiones_horario: 0 }), privileges: async () => ({ estado: 'PRESENT', faltantes: [] })
        });
        assert.ok(logs.includes('RECOVERY_EXECUTE_PREFLIGHT_COMPLETE_NO_CHANGES'));
        assert.ok(calls.every((sql) => /^SELECT\b/i.test(sql.trim())));
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('39 recuperación simulada registra exactamente una fila', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery019-')); const backup = path.join(directory, 'backup.sql');
    fs.writeFileSync(backup, 'backup'); const hash = crypto.createHash('sha256').update('backup').digest('hex');
    const calls = []; let committed = false; const row = appliedRow(entry);
    const connection = {
        async execute(sql, params) {
            calls.push({ sql, params });
            if (/GET_LOCK/.test(sql)) return [[{ lock_obtenido: 1 }]];
            if (/RELEASE_LOCK/.test(sql)) return [[{ lock_liberado: 1 }]];
            if (/^INSERT INTO schema_migrations/.test(sql)) return [{ affectedRows: 1 }];
            if (/^SELECT version/.test(sql)) return [[row]];
            return [[]];
        }, async beginTransaction() {}, async commit() { committed = true; }, async rollback() {}, release() {}
    };
    const pool = mockPool(connection);
    try {
        await apply.ejecutarRecuperacionAdministrativa(recoveryOptions('--execute', backup, hash), true, { log() {} }, {
            env: recoveryEnv(), manifest, pool, snapshot: async () => recoverySnapshot(),
            countRows: async () => ({ importaciones_horario: 0, versiones_horario: 0 }), privileges: async () => ({ estado: 'PRESENT', faltantes: [] }), randomUUID: () => '00000000-0000-4000-8000-000000000019'
        });
        const inserts = calls.filter((call) => /^INSERT INTO schema_migrations/.test(call.sql));
        assert.equal(inserts.length, 1); assert.equal(inserts[0].params[0], 19); assert.equal(committed, true); assert.equal(pool.ended, true);
        assert.equal(calls.some((call) => /^(CREATE|ALTER|DROP|UPDATE|DELETE)\b/i.test(call.sql.trim())), false);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('40 rechaza una versión de recuperación distinta de 019', () => {
    assert.throws(() => apply.parsearArgumentos(['recover-registration', '--version=018', '--dry-run']), (error) => error.code === 'RECOVERY_VERSION_NOT_ALLOWED');
});
test('41 rechaza 019 ya registrada', () => {
    const snapshot = recoverySnapshot(); snapshot.controlRows.push(appliedRow(entry));
    assert.throws(() => apply.validarEstadoRecuperacion(manifest, snapshot), (error) => error.code === 'RECOVERY_ALREADY_RECORDED');
});
for (const [number, table] of [[42, 'importaciones_horario'], [43, 'versiones_horario']]) {
    test(`${number} rechaza tabla ${table} ausente`, () => {
        const snapshot = recoverySnapshot(); delete snapshot.tablas[table];
        assert.throws(() => apply.validarEstadoRecuperacion(manifest, snapshot), (error) => error.code === 'POSTCONDITION_MISMATCH');
    });
}
test('44 rechaza una postcondición estructural incorrecta', () => {
    const snapshot = recoverySnapshot(); snapshot.tablas.versiones_horario.columnas.activa.nullable = true;
    assert.throws(() => apply.validarEstadoRecuperacion(manifest, snapshot), (error) => error.code === 'POSTCONDITION_MISMATCH');
});
for (const [number, counts] of [[45, { importaciones_horario: 1, versiones_horario: 0 }], [46, { importaciones_horario: 0, versiones_horario: 1 }]]) {
    test(`${number} rechaza tablas de recuperación con registros`, () => {
        assert.throws(() => apply.validarTablasRecuperacionVacias(counts), (error) => error.code === 'RECOVERY_TABLES_NOT_EMPTY');
    });
}
test('47 rechaza checksum SQL diferente', () => {
    const changed = structuredClone(manifest); changed.migraciones.find((item) => item.version === 19).checksumSha256 = '0'.repeat(64);
    assert.throws(() => apply.validarEstadoRecuperacion(changed, recoverySnapshot()), (error) => error.code === 'SQL_CHECKSUM_MISMATCH');
});
test('48 rechaza cuando falta la predecesora 018', () => {
    const snapshot = recoverySnapshot(); snapshot.controlRows = snapshot.controlRows.filter((row) => Number(row.version) !== 18);
    assert.throws(() => apply.validarEstadoRecuperacion(manifest, snapshot));
});
test('49 fallo del INSERT hace rollback y libera recursos', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery019-')); const backup = path.join(directory, 'backup.sql');
    fs.writeFileSync(backup, 'backup'); const hash = crypto.createHash('sha256').update('backup').digest('hex');
    let rolledBack = false; let released = false;
    const connection = {
        async execute(sql) {
            if (/GET_LOCK/.test(sql)) return [[{ lock_obtenido: 1 }]];
            if (/RELEASE_LOCK/.test(sql)) return [[{ lock_liberado: 1 }]];
            if (/^INSERT/.test(sql)) throw Object.assign(new Error('internal'), { code: 'ER_ACCESS_DENIED_ERROR' });
            return [[]];
        }, async beginTransaction() {}, async commit() {}, async rollback() { rolledBack = true; }, release() { released = true; }
    };
    const pool = mockPool(connection);
    try {
        await assert.rejects(apply.ejecutarRecuperacionAdministrativa(recoveryOptions('--execute', backup, hash), true, { log() {} }, {
            env: recoveryEnv(), manifest, pool, snapshot: async () => recoverySnapshot(),
            countRows: async () => ({ importaciones_horario: 0, versiones_horario: 0 }), privileges: async () => ({ estado: 'PRESENT', faltantes: [] })
        }), (error) => error.stage === 'RECOVERY_REGISTRATION' && error.code === 'ER_ACCESS_DENIED_ERROR');
        assert.equal(rolledBack, true); assert.equal(released, true); assert.equal(pool.ended, true);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('50 opciones desconocidas y combinación de modos se rechazan', () => {
    assert.throws(() => apply.parsearArgumentos(['recover-registration', '--version=019', '--dry-run', '--unknown']), (error) => error.code === 'UNKNOWN_OPTION');
    assert.throws(() => apply.parsearArgumentos(['recover-registration', '--version=019', '--dry-run', '--execute']), (error) => error.code === 'MODE_REQUIRED');
});
test('51 cláusulas CHECK reales de MySQL satisfacen los seis contratos de 019', () => {
    const snapshot = recoverySnapshot();
    snapshot.controlRows.push(appliedRow(entry));
    snapshot.tablas.versiones_horario.checks = [
        '(`activa` in (0,1))',
        '((`activa` = 0) or ((`activada_en` is not null) and (`desactivada_en` is null)))',
        '((`desactivada_en` is null) or ((`activada_en` is not null) and (`desactivada_en` >= `activada_en`)))',
        '(`numero_version` >= 1)',
        '(((`importacion_id` is not null) and (`version_origen_id` is null)) or ((`importacion_id` is null) and (`version_origen_id` is not null)))',
        '(`total_clases` between 1 and 500)'
    ].map((clause) => preflight.normalizarClausula(clause));
    const result = preflight.compararSnapshotConDescriptor(snapshot, preflight.cargarDescriptor(), manifest);
    assert.equal(result.fallidas, 0, JSON.stringify(result.reglas.filter((rule) => !rule.ok).map((rule) => rule.codigo)));
    assert.ok(result.reglas.filter((rule) => rule.codigo.startsWith('CHECK_VERSIONES_HORARIO_')).every((rule) => rule.ok));
});
