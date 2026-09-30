'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const apply = require('../scripts/migrationApply');
const manifestApi = require('../scripts/migrationManifest');
const preflight = require('../scripts/migrationPreflight');

const manifest = manifestApi.cargarManifiesto();
const entry = manifest.migraciones.find((item) => item.version === 26);
const contract = apply.cargarContrato(entry);
const contract024 = apply.cargarContrato(manifest.migraciones.find((item) => item.version === 24));
const descriptor = preflight.cargarDescriptor();
const sqlPath = path.join(manifestApi.MIGRATIONS_DIR, entry.archivo);
const sql = fs.readFileSync(sqlPath, 'utf8');
const tableNames = ['intentos_entrega_tarea', 'adjuntos_intento_entrega', 'contexto_adjuntos_intento_tarea'];
const manifestBefore027 = structuredClone(manifest);
const entry027Fixture = manifestBefore027.migraciones.find((item) => item.version === 27);
Object.assign(entry027Fixture, { estado: 'PLANNED', archivo: null, checksumSha256: null, razonEstado: 'Fixture previa a 027.' });
delete entry027Fixture.execution;

function controlRows(through = 25) {
    return manifest.migraciones
        .filter((item) => item.version <= 8 || (item.estado === 'ACTIVE' && item.version <= through))
        .map((item) => ({
            version: item.version, archivo: item.archivo, checksum_sha256: item.checksumSha256,
            tipo_registro: item.version === 0 ? 'EJECUTADA' : item.version <= 8 ? 'BASELINE' : 'EJECUTADA'
        }));
}

function tableFromContract(spec) {
    return {
        engine: spec.engine, charset: spec.charset, collation: spec.collation,
        columnas: Object.fromEntries(spec.columnas.map((column, index) => [column.nombre, {
            tipo: column.tipo.toLowerCase(), unsigned: column.unsigned, nullable: column.nullable,
            default: Object.hasOwn(column, 'default') && column.default !== null ? String(column.default).toLowerCase() : null,
            extra: String(column.extra || '').toLowerCase(), collation: column.collation || null,
            generationExpression: preflight.normalizarExpresionGenerada(column.generationExpression), ordinal: index + 1
        }])),
        indices: [{ nombre: 'PRIMARY', unique: true, columnas: spec.primaryKey }]
            .concat(spec.indicesUnicos.map((index, number) => ({ nombre: `uq_${number}`, unique: true, columnas: index.columnas })))
            .concat(spec.indices.map((index, number) => ({ nombre: `idx_${number}`, unique: false, columnas: index.columnas }))),
        foreignKeys: structuredClone(spec.foreignKeys),
        checks: spec.checks.map((check) => check.fragmentos.join(' ').replace(/,\s+/g, ',')),
        checkConstraints: []
    };
}

function snapshot({ applied = false, mutate } = {}) {
    const result = preflight.crearSnapshotCompatible(descriptor, {
        control: 'complete', controlRows: controlRows(applied ? 26 : 25),
        filasCatalogo: {
            estados_actividad_orientacion: [{ clave: 'RECHAZADA', nombre: 'Rechazada', descripcion: 'La evidencia requiere correcciones antes de considerarse realizada.', orden: 6, activo: 1 }],
            estados_tarea_academica: structuredClone(contract024.filasCatalogo.estados_tarea_academica),
            estados_entrega_tarea: structuredClone(contract024.filasCatalogo.estados_entrega_tarea)
        }
    });
    for (const version of [15, 16, 17, 18, 19, 20, 21, 24, 25]) {
        const current = apply.cargarContrato(manifest.migraciones.find((item) => item.version === version));
        for (const [name, spec] of Object.entries(current.tablas)) result.tablas[name] = tableFromContract(spec);
    }
    const activities = result.tablas.actividades_orientacion;
    activities.checks = activities.checks.filter((value) => !value.includes('fecha_realizacion'));
    activities.checkConstraints = [{ nombre: 'chk_actividades_fecha_limite', clausula: '((fecha_limite is null) or (fecha_limite >= fecha_asignacion))' }];
    if (applied) for (const [name, spec] of Object.entries(contract.tablas)) result.tablas[name] = tableFromContract(spec);
    if (mutate) mutate(result);
    return result;
}

test('01 SQL y contrato 026 están manifestados con checksums correctos', () => {
    assert.ok(fs.statSync(sqlPath).isFile()); assert.equal(contract.migracion, 26); assert.equal(entry.estado, 'ACTIVE');
    assert.equal(manifestApi.calcularChecksumCanonico(sqlPath), entry.checksumSha256);
    assert.equal(manifestApi.calcularChecksumCanonico(path.join(manifestApi.PROJECT_ROOT, entry.execution.postconditionContract)), entry.execution.postconditionChecksumSha256);
});

test('02 crea exactamente tres tablas en el orden contractual', () => {
    const statements = apply.validarSqlMigracion(entry);
    assert.deepEqual(statements.map(({ operation, target }) => ({ operation, target })), tableNames.map((target) => ({ operation: 'CREATE_TABLE', target })));
    assert.equal((sql.match(/\bCREATE\s+TABLE\b/gi) || []).length, 3);
});

test('03 no contiene ALTER, DROP, DML, ENUM ni objetos programables', () => {
    assert.doesNotMatch(sql, /^\s*(ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|REPLACE)\b/im);
    assert.doesNotMatch(sql, /\b(ENUM|TRIGGER|PROCEDURE|FUNCTION|EVENT|VIEW|IF\s+NOT\s+EXISTS)\b/i);
});

test('04 intento pertenece solo a destinatario y conserva tipos contractuales', () => {
    const table = contract.tablas.intentos_entrega_tarea;
    assert.equal(table.columnas.find((item) => item.nombre === 'destinatario_tarea_academica_id').tipo, 'bigint unsigned');
    for (const forbidden of ['alumno_usuario_id', 'docente_usuario_id', 'grupo_id', 'materia_id', 'periodo_academico_id']) {
        assert.equal(table.columnas.some((item) => item.nombre === forbidden), false);
    }
});

test('05 número e idempotencia son únicos dentro del destinatario', () => {
    assert.deepEqual(contract.tablas.intentos_entrega_tarea.indicesUnicos.map((item) => item.columnas), [
        ['destinatario_tarea_academica_id', 'numero_intento'],
        ['destinatario_tarea_academica_id', 'clave_idempotencia_hash']
    ]);
    assert.equal(contract.tablas.intentos_entrega_tarea.columnas.find((item) => item.nombre === 'clave_idempotencia_hash').collation, 'ascii_bin');
});

test('06 TARDÍA es propiedad congelada y no catálogo', () => {
    const table = contract.tablas.intentos_entrega_tarea;
    assert.ok(table.columnas.some((item) => item.nombre === 'es_tardia'));
    assert.ok(table.columnas.some((item) => item.nombre === 'fecha_limite_efectiva'));
    assert.ok(table.checks.some((item) => item.fragmentos.includes('es_tardia')));
    assert.doesNotMatch(sql, /estado[^\n]*tard/i);
});

test('07 intento conserva momento real y estado de entrega sin revisión', () => {
    const table = contract.tablas.intentos_entrega_tarea;
    assert.equal(table.columnas.find((item) => item.nombre === 'enviado_en').default, 'CURRENT_TIMESTAMP');
    assert.ok(table.foreignKeys.some((fk) => fk.columnas[0] === 'estado_entrega_actual_id' && fk.tablaDestino === 'estados_entrega_tarea'));
    for (const forbidden of ['calificacion', 'comentario', 'revision']) assert.equal(table.columnas.some((item) => item.nombre === forbidden), false);
});

test('08 adjuntos tienen orden 1–5 único por intento', () => {
    const table = contract.tablas.adjuntos_intento_entrega;
    assert.ok(table.indicesUnicos.some((item) => JSON.stringify(item.columnas) === JSON.stringify(['intento_entrega_tarea_id', 'orden'])));
    assert.ok(table.checks.some((item) => item.fragmentos.includes('between 1 and 5')));
});

test('09 adjunto protege tamaño individual exacto, almacenamiento y SHA-256', () => {
    const table = contract.tablas.adjuntos_intento_entrega;
    const checks = table.checks.flatMap((item) => item.fragmentos).join(' ');
    assert.match(checks, /tamano_bytes <= 52428800/);
    assert.match(checks, /\^\[0-9A-Fa-f\]\{64\}\$/);
    assert.ok(table.indicesUnicos.some((item) => item.columnas[0] === 'clave_almacenamiento'));
    assert.equal(table.columnas.find((item) => item.nombre === 'hash_sha256').collation, 'ascii_bin');
});

test('10 no almacena BLOB, base64, rutas absolutas ni total ficticio por fila', () => {
    assert.doesNotMatch(sql, /\b(BLOB|BASE64|ruta_absoluta|tamano_total)\b/i);
    for (const [name, forbidden] of Object.entries(contract.columnasProhibidas)) {
        const columns = contract.tablas[name].columnas.map((item) => item.nombre);
        for (const column of forbidden) assert.equal(columns.includes(column), false);
    }
});

test('11 contexto usa PK compuesta e índice inverso sin duplicar metadatos', () => {
    const table = contract.tablas.contexto_adjuntos_intento_tarea;
    assert.deepEqual(table.primaryKey, ['intento_entrega_tarea_id', 'version_adjunto_tarea_academica_id']);
    assert.deepEqual(table.indices[0].columnas, ['version_adjunto_tarea_academica_id', 'intento_entrega_tarea_id']);
    assert.deepEqual(table.columnas.map((item) => item.nombre), ['intento_entrega_tarea_id', 'version_adjunto_tarea_academica_id']);
});

test('12 todas las FK son RESTRICT/RESTRICT y están cubiertas por prefijo izquierdo', () => {
    for (const table of Object.values(contract.tablas)) {
        const indexes = [{ columnas: table.primaryKey }, ...table.indicesUnicos, ...table.indices];
        for (const fk of table.foreignKeys) {
            assert.equal(fk.onUpdate, 'RESTRICT'); assert.equal(fk.onDelete, 'RESTRICT');
            assert.ok(indexes.some((index) => index.columnas[0] === fk.columnas[0]));
        }
    }
    assert.doesNotMatch(sql, /ON\s+DELETE\s+CASCADE/i);
});

test('13 usa InnoDB, utf8mb4 y collation contractual', () => {
    for (const table of Object.values(contract.tablas)) assert.deepEqual([table.engine, table.charset, table.collation], ['innodb', 'utf8mb4', 'utf8mb4_0900_ai_ci']);
});

test('14 precondición acepta tablas ausentes y exige 025 registrada', () => {
    assert.equal(apply.validarPrecondiciones(snapshot(), entry), true);
    const current = snapshot(); current.controlRows = current.controlRows.filter((row) => Number(row.version) !== 25);
    assert.throws(() => apply.validarPrecondiciones(current, entry));
});

for (const [index, name] of tableNames.entries()) {
    test(`${15 + index} rechaza estructura parcial con ${name}`, () => {
        const current = snapshot(); current.tablas[name] = tableFromContract(contract.tablas[name]);
        assert.throws(() => apply.validarPrecondiciones(current, entry));
    });
}

test('18 postcondición acepta estructura completa y rechaza diferencias', () => {
    assert.equal(apply.validarPostcondicion(snapshot({ applied: true }), contract), true);
    assert.throws(() => apply.validarPostcondicion(snapshot({ applied: true, mutate(current) { current.tablas.intentos_entrega_tarea.foreignKeys[0].onDelete = 'CASCADE'; } }), contract));
    assert.throws(() => apply.validarPostcondicion(snapshot({ applied: true, mutate(current) { current.tablas.adjuntos_intento_entrega.checks = []; } }), contract));
    assert.throws(() => apply.validarPostcondicion(snapshot({ applied: true, mutate(current) { current.tablas.contexto_adjuntos_intento_tarea.indices = []; } }), contract));
});

test('19 estructura aplicada y registrada deja de estar pendiente en el fixture previo a 027', () => assert.deepEqual(apply.construirPlan(manifestBefore027, snapshot({ applied: true })), []));

test('20 estructura aplicada sin registro se rechaza', () => {
    const current = snapshot({ applied: true }); current.controlRows = current.controlRows.filter((row) => Number(row.version) !== 26);
    assert.throws(() => apply.construirPlan(manifest, current));
});

test('21 checksum alterado se rechaza', () => {
    const changed = structuredClone(entry); changed.checksumSha256 = '0'.repeat(64);
    assert.throws(() => apply.validarSqlMigracion(changed));
});

test('22 dry-run selecciona solo 026 y no escribe', async () => {
    const calls = []; const output = [];
    const connection = { async execute(query) { calls.push(query); return [[]]; }, release() {} };
    const pool = { async getConnection() { return connection; }, async end() {} };
    const plan = await apply.ejecutarDryRun({ log: (line) => output.push(line) }, { pool, manifest: manifestBefore027, snapshot: async () => snapshot() });
    assert.deepEqual(plan.map((item) => item.entrada.version), [26]);
    for (const name of tableNames) assert.match(output.join('\n'), new RegExp(`CREATE_TABLE ${name}`));
    assert.equal(calls.some((query) => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(query)), false);
});

test('23 aplicación simulada ejecuta tres CREATE antes de registrar 026', async () => {
    const calls = [];
    const connection = {
        async execute(query, params) {
            calls.push({ query, params });
            if (/GET_LOCK/.test(query)) return [[{ lock_obtenido: 1 }]];
            if (/RELEASE_LOCK/.test(query)) return [[{ lock_liberado: 1 }]];
            if (/^INSERT INTO schema_migrations/i.test(query)) return [{ affectedRows: 1 }];
            return [{ affectedRows: 0 }];
        },
        async beginTransaction() { calls.push({ query: 'BEGIN' }); }, async commit() { calls.push({ query: 'COMMIT' }); },
        async rollback() { calls.push({ query: 'ROLLBACK' }); }, release() {}
    };
    const pool = { async getConnection() { return connection; }, async end() {} };
    const backupHash = require('node:crypto').createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
    const options = apply.parsearArgumentos(['up', '--execute', '--confirm=APPLY-ACTIVE-MIGRATIONS', '--acknowledge-ddl-autocommit', `--backup-file=${__filename}`, `--backup-sha256=${backupHash}`]);
    await apply.ejecutarAdministrativo(options, true, { log() {} }, {
        env: { MIGRATION_DB_ALLOW_WRITES: 'ACTIVE_MIGRATIONS_ONLY', MIGRATION_DB_HOST: 'x', MIGRATION_DB_PORT: '3306', MIGRATION_DB_NAME: 'x', MIGRATION_DB_USER: 'x', MIGRATION_DB_PASSWORD: 'x' },
        pool, manifest: manifestBefore027, privileges: async (unused, required) => { assert.deepEqual(required, ['SELECT', 'CREATE', 'INSERT']); return { estado: 'PRESENT' }; },
        snapshot: async () => snapshot(), snapshotAfter: async () => snapshot({ applied: true }), snapshotVerified: async () => snapshot({ applied: true }),
        randomUUID: () => '00000000-0000-4000-8000-000000000026'
    });
    assert.equal(calls.filter((call) => /^CREATE TABLE/i.test(call.query)).length, 3);
    const records = calls.filter((call) => /^INSERT INTO schema_migrations/i.test(call.query));
    assert.equal(records.length, 1); assert.equal(records[0].params[0], 26);
});

test('24 el fallo de cualquiera de los tres CREATE ocurre antes del registro', async () => {
    const backupHash = require('node:crypto').createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
    const options = apply.parsearArgumentos(['up', '--execute', '--confirm=APPLY-ACTIVE-MIGRATIONS', '--acknowledge-ddl-autocommit', `--backup-file=${__filename}`, `--backup-sha256=${backupHash}`]);
    for (const failedOrdinal of [1, 2, 3]) {
        const calls = []; let createOrdinal = 0;
        const connection = {
            async execute(query, params) {
                calls.push({ query, params });
                if (/GET_LOCK/.test(query)) return [[{ lock_obtenido: 1 }]];
                if (/RELEASE_LOCK/.test(query)) return [[{ lock_liberado: 1 }]];
                if (/^CREATE TABLE/i.test(query) && ++createOrdinal === failedOrdinal) throw new Error('simulated');
                return [{ affectedRows: 0 }];
            },
            async beginTransaction() {}, async commit() {}, async rollback() {}, release() {}
        };
        const pool = { async getConnection() { return connection; }, async end() {} };
        await assert.rejects(() => apply.ejecutarAdministrativo(options, true, { log() {} }, {
            env: { MIGRATION_DB_ALLOW_WRITES: 'ACTIVE_MIGRATIONS_ONLY', MIGRATION_DB_HOST: 'x', MIGRATION_DB_PORT: '3306', MIGRATION_DB_NAME: 'x', MIGRATION_DB_USER: 'x', MIGRATION_DB_PASSWORD: 'x' },
            pool, manifest: manifestBefore027, privileges: async () => ({ estado: 'PRESENT' }), snapshot: async () => snapshot()
        }));
        assert.equal(calls.some((call) => /^INSERT INTO schema_migrations/i.test(call.query)), false);
    }
});

test('25 026 depende de 025 y 027 está ACTIVE', () => {
    assert.deepEqual(entry.execution.dependsOn, [25]);
    const active = manifest.migraciones.find((item) => item.version === 27);
    assert.equal(active.estado, 'ACTIVE'); assert.deepEqual(active.execution.dependsOn, [26]);
});
