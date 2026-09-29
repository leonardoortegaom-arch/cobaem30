'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const apply = require('../scripts/migrationApply');
const manifestApi = require('../scripts/migrationManifest');
const preflight = require('../scripts/migrationPreflight');

const manifest = manifestApi.cargarManifiesto();
const entry = manifest.migraciones.find((item) => item.version === 25);
const contract = apply.cargarContrato(entry);
const contract024 = apply.cargarContrato(manifest.migraciones.find((item) => item.version === 24));
const descriptor = preflight.cargarDescriptor();
const sqlPath = path.join(manifestApi.MIGRATIONS_DIR, entry.archivo);
const sql = fs.readFileSync(sqlPath, 'utf8');
const tableNames = [
    'destinatarios_tarea_academica',
    'historial_plazos_destinatario_tarea',
    'adjuntos_tarea_academica',
    'versiones_adjunto_tarea_academica'
];
const manifestBefore026 = structuredClone(manifest);
const entry026Fixture = manifestBefore026.migraciones.find((item) => item.version === 26);
Object.assign(entry026Fixture, { estado: 'PLANNED', archivo: null, checksumSha256: null, razonEstado: 'Fixture previa a 026.' });
delete entry026Fixture.execution;

function controlRows(through = 24) {
    return manifest.migraciones
        .filter((item) => item.version <= 8 || (item.estado === 'ACTIVE' && item.version <= through))
        .map((item) => ({
            version: item.version,
            archivo: item.archivo,
            checksum_sha256: item.checksumSha256,
            tipo_registro: item.version === 0 ? 'EJECUTADA' : item.version <= 8 ? 'BASELINE' : 'EJECUTADA'
        }));
}

function tableFromContract(spec) {
    return {
        engine: spec.engine,
        charset: spec.charset,
        collation: spec.collation,
        columnas: Object.fromEntries(spec.columnas.map((column, index) => [column.nombre, {
            tipo: column.tipo.toLowerCase(),
            unsigned: column.unsigned,
            nullable: column.nullable,
            default: Object.hasOwn(column, 'default') && column.default !== null ? String(column.default).toLowerCase() : null,
            extra: String(column.extra || '').toLowerCase(),
            collation: column.collation || null,
            generationExpression: preflight.normalizarExpresionGenerada(column.generationExpression),
            ordinal: index + 1
        }])),
        indices: [{ nombre: 'PRIMARY', unique: true, columnas: spec.primaryKey }]
            .concat(spec.indicesUnicos.map((index, number) => ({ nombre: `uq_${number}`, unique: true, columnas: index.columnas })))
            .concat(spec.indices.map((index, number) => ({ nombre: `idx_${number}`, unique: false, columnas: index.columnas }))),
        foreignKeys: structuredClone(spec.foreignKeys),
        checks: spec.checks.map((check) => check.fragmentos.join(' ').replace(/,\s+/g, ',')),
        checkConstraints: []
    };
}

function snapshot({ applied = false, missing = '', mutate } = {}) {
    const result = preflight.crearSnapshotCompatible(descriptor, {
        control: 'complete',
        controlRows: controlRows(applied ? 25 : 24),
        filasCatalogo: {
            estados_actividad_orientacion: [{ clave: 'RECHAZADA', nombre: 'Rechazada', descripcion: 'La evidencia requiere correcciones antes de considerarse realizada.', orden: 6, activo: 1 }],
            estados_tarea_academica: structuredClone(contract024.filasCatalogo.estados_tarea_academica),
            estados_entrega_tarea: structuredClone(contract024.filasCatalogo.estados_entrega_tarea)
        }
    });
    for (const version of [15, 16, 17, 18, 19, 20, 21, 24]) {
        const current = apply.cargarContrato(manifest.migraciones.find((item) => item.version === version));
        for (const [name, spec] of Object.entries(current.tablas)) result.tablas[name] = tableFromContract(spec);
    }
    const activities = result.tablas.actividades_orientacion;
    activities.checks = activities.checks.filter((value) => !value.includes('fecha_realizacion'));
    activities.checkConstraints = [{ nombre: 'chk_actividades_fecha_limite', clausula: '((fecha_limite is null) or (fecha_limite >= fecha_asignacion))' }];
    if (applied) for (const [name, spec] of Object.entries(contract.tablas)) result.tablas[name] = tableFromContract(spec);
    if (missing) delete result.tablas[missing];
    if (mutate) mutate(result);
    return result;
}

test('01 SQL y contrato 025 existen, están manifestados y sus checksums coinciden', () => {
    assert.ok(fs.statSync(sqlPath).isFile());
    assert.equal(contract.migracion, 25);
    assert.equal(entry.estado, 'ACTIVE');
    assert.equal(manifestApi.calcularChecksumCanonico(sqlPath), entry.checksumSha256);
    assert.equal(manifestApi.calcularChecksumCanonico(path.join(manifestApi.PROJECT_ROOT, entry.execution.postconditionContract)), entry.execution.postconditionChecksumSha256);
});

test('02 declara exactamente cuatro CREATE_TABLE en orden de dependencia', () => {
    const statements = apply.validarSqlMigracion(entry);
    assert.deepEqual(statements.map(({ operation, target }) => ({ operation, target })), tableNames.map((target) => ({ operation: 'CREATE_TABLE', target })));
    assert.equal((sql.match(/\bCREATE\s+TABLE\b/gi) || []).length, 4);
});

test('03 no contiene DML, ALTER heredado, ENUM ni objetos programables', () => {
    assert.doesNotMatch(sql, /^\s*(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|TRUNCATE)\b/im);
    assert.doesNotMatch(sql, /\b(ENUM|TRIGGER|PROCEDURE|FUNCTION|EVENT|IF\s+NOT\s+EXISTS)\b/i);
});

test('04 destinatario usa alumno_usuario_id BIGINT UNSIGNED y nunca alumnos.id', () => {
    const table = contract.tablas.destinatarios_tarea_academica;
    const column = table.columnas.find((item) => item.nombre === 'alumno_usuario_id');
    assert.deepEqual([column.tipo, column.unsigned, column.nullable], ['bigint unsigned', true, false]);
    assert.equal(table.columnas.some((item) => item.nombre === 'alumno_id'), false);
    const fk = table.foreignKeys.find((item) => item.columnas[0] === 'alumno_usuario_id');
    assert.deepEqual([fk.tablaDestino, fk.columnasDestino], ['alumnos', ['usuario_id']]);
    assert.doesNotMatch(sql, /REFERENCES\s+alumnos\s*\(\s*id\s*\)/i);
});

test('05 un destinatario es único por tarea y alumno y tiene índices de consulta', () => {
    const table = contract.tablas.destinatarios_tarea_academica;
    assert.ok(table.indicesUnicos.some((index) => JSON.stringify(index.columnas) === JSON.stringify(['tarea_id', 'alumno_usuario_id'])));
    assert.ok(table.indices.some((index) => JSON.stringify(index.columnas.slice(0, 2)) === JSON.stringify(['alumno_usuario_id', 'tarea_id'])));
});

test('06 incorporación posterior y plazo individual mantienen relación contractual', () => {
    const checks = contract.tablas.destinatarios_tarea_academica.checks.flatMap((item) => item.fragmentos).join(' ');
    assert.match(checks, /es_incorporacion_posterior.*in \(0, 1\)/);
    assert.match(checks, /es_incorporacion_posterior = 0.*fecha_limite_individual is null/);
    assert.match(checks, /es_incorporacion_posterior = 1.*fecha_limite_individual is not null/);
});

test('07 historial de plazos es append-only, auditable y admite múltiples cambios', () => {
    const table = contract.tablas.historial_plazos_destinatario_tarea;
    assert.equal(table.indicesUnicos.length, 0);
    assert.equal(table.columnas.some((item) => item.nombre === 'actualizado_en'), false);
    assert.ok(table.checks.some((item) => item.fragmentos.includes('fecha_limite_nueva <> fecha_limite_anterior')));
    assert.ok(table.checks.some((item) => item.fragmentos.includes('char_length(trim(motivo))')));
});

test('08 adjuntos limita orden a 1–5 y lo hace único por tarea', () => {
    const table = contract.tablas.adjuntos_tarea_academica;
    assert.ok(table.indicesUnicos.some((index) => JSON.stringify(index.columnas) === JSON.stringify(['tarea_id', 'orden'])));
    assert.ok(table.checks.some((item) => item.fragmentos.includes('between 1 and 5')));
});

test('09 versiones son únicas por adjunto y nombre interno', () => {
    const unique = contract.tablas.versiones_adjunto_tarea_academica.indicesUnicos.map((item) => item.columnas);
    assert.deepEqual(unique, [['adjunto_tarea_id', 'numero_version'], ['nombre_interno']]);
});

test('10 tamaño, SHA-256 y motivo de corrección están protegidos', () => {
    const table = contract.tablas.versiones_adjunto_tarea_academica;
    const checks = table.checks.flatMap((item) => item.fragmentos).join(' ');
    assert.match(checks, /tamano_bytes <= 52428800/);
    assert.match(checks, /\^\[0-9A-Fa-f\]\{64\}\$/);
    assert.match(checks, /numero_version > 1.*motivo_cambio is not null/);
    assert.equal(table.columnas.find((item) => item.nombre === 'sha256').collation, 'ascii_bin');
});

test('11 no almacena vigencia, borrado, BLOB, base64 ni rutas absolutas', () => {
    for (const [name, forbidden] of Object.entries(contract.columnasProhibidas)) {
        const columns = contract.tablas[name].columnas.map((item) => item.nombre);
        for (const column of forbidden) assert.equal(columns.includes(column), false);
    }
    assert.doesNotMatch(sql, /\b(BLOB|BASE64|ruta_absoluta|eliminado_en)\b/i);
});

test('12 todas las FK son RESTRICT/RESTRICT y están cubiertas por índice', () => {
    for (const table of Object.values(contract.tablas)) {
        const indexes = [...table.indicesUnicos, ...table.indices];
        for (const fk of table.foreignKeys) {
            assert.equal(fk.onUpdate, 'RESTRICT');
            assert.equal(fk.onDelete, 'RESTRICT');
            assert.ok(indexes.some((index) => index.columnas[0] === fk.columnas[0]));
        }
    }
    assert.doesNotMatch(sql, /ON\s+DELETE\s+CASCADE/i);
});

test('13 precondición acepta las cuatro tablas ausentes y exige 024', () => {
    assert.equal(apply.validarPrecondiciones(snapshot(), entry), true);
    const current = snapshot();
    current.controlRows = current.controlRows.filter((row) => Number(row.version) !== 24);
    assert.throws(() => apply.validarPrecondiciones(current, entry));
});

for (const [index, name] of tableNames.entries()) {
    test(`${14 + index} rechaza estado parcial si ya existe ${name}`, () => {
        const current = snapshot();
        current.tablas[name] = tableFromContract(contract.tablas[name]);
        assert.throws(() => apply.validarPrecondiciones(current, entry));
    });
}

test('18 postcondición completa acepta las cuatro tablas', () => {
    assert.equal(apply.validarPostcondicion(snapshot({ applied: true }), contract), true);
});

test('19 postcondición rechaza diferencias de FK, CHECK e índice', () => {
    assert.throws(() => apply.validarPostcondicion(snapshot({ applied: true, mutate(current) {
        current.tablas.destinatarios_tarea_academica.foreignKeys[1].columnasDestino = ['id'];
    } }), contract));
    assert.throws(() => apply.validarPostcondicion(snapshot({ applied: true, mutate(current) {
        current.tablas.adjuntos_tarea_academica.checks = [];
    } }), contract));
    assert.throws(() => apply.validarPostcondicion(snapshot({ applied: true, mutate(current) {
        current.tablas.versiones_adjunto_tarea_academica.indices = current.tablas.versiones_adjunto_tarea_academica.indices.filter((item) => item.columnas[0] !== 'sha256');
    } }), contract));
});

test('20 aplicada y registrada deja de estar pendiente', () => {
    assert.deepEqual(apply.construirPlan(manifestBefore026, snapshot({ applied: true })), []);
});

test('21 estructura existente sin registro se rechaza', () => {
    const current = snapshot({ applied: true });
    current.controlRows = current.controlRows.filter((row) => Number(row.version) !== 25);
    assert.throws(() => apply.construirPlan(manifest, current));
});

test('22 checksum diferente es rechazado', () => {
    const changed = structuredClone(entry); changed.checksumSha256 = '0'.repeat(64);
    assert.throws(() => apply.validarSqlMigracion(changed));
});

test('23 dry-run selecciona solo 025 y no escribe', async () => {
    const calls = []; const output = [];
    const connection = { async execute(query) { calls.push(query); return [[]]; }, release() {} };
    const pool = { async getConnection() { return connection; }, async end() {} };
    const plan = await apply.ejecutarDryRun({ log: (line) => output.push(line) }, { pool, manifest: manifestBefore026, snapshot: async () => snapshot() });
    assert.deepEqual(plan.map((item) => item.entrada.version), [25]);
    for (const name of tableNames) assert.match(output.join('\n'), new RegExp(`CREATE_TABLE ${name}`));
    assert.equal(calls.some((query) => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(query)), false);
});

test('24 aplicación simulada ejecuta cuatro CREATE antes de registrar exactamente 025', async () => {
    const calls = [];
    const connection = {
        async execute(query, params) {
            calls.push({ query, params });
            if (/GET_LOCK/.test(query)) return [[{ lock_obtenido: 1 }]];
            if (/RELEASE_LOCK/.test(query)) return [[{ lock_liberado: 1 }]];
            if (/^INSERT INTO schema_migrations/i.test(query)) return [{ affectedRows: 1 }];
            return [{ affectedRows: 0 }];
        },
        async beginTransaction() { calls.push({ query: 'BEGIN' }); },
        async commit() { calls.push({ query: 'COMMIT' }); },
        async rollback() { calls.push({ query: 'ROLLBACK' }); },
        release() {}
    };
    const pool = { async getConnection() { return connection; }, async end() {} };
    const backupHash = require('node:crypto').createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
    const options = apply.parsearArgumentos(['up', '--execute', '--confirm=APPLY-ACTIVE-MIGRATIONS', '--acknowledge-ddl-autocommit', `--backup-file=${__filename}`, `--backup-sha256=${backupHash}`]);
    const deps = {
        env: { MIGRATION_DB_ALLOW_WRITES: 'ACTIVE_MIGRATIONS_ONLY', MIGRATION_DB_HOST: 'x', MIGRATION_DB_PORT: '3306', MIGRATION_DB_NAME: 'x', MIGRATION_DB_USER: 'x', MIGRATION_DB_PASSWORD: 'x' },
        pool,
        manifest: manifestBefore026,
        privileges: async (unused, required) => { assert.deepEqual(required, ['SELECT', 'CREATE', 'INSERT']); return { estado: 'PRESENT' }; },
        snapshot: async () => snapshot(),
        snapshotAfter: async () => snapshot({ applied: true }),
        snapshotVerified: async () => snapshot({ applied: true }),
        randomUUID: () => '00000000-0000-4000-8000-000000000025'
    };
    await apply.ejecutarAdministrativo(options, true, { log() {} }, deps);
    assert.equal(calls.filter((call) => /^CREATE TABLE/i.test(call.query)).length, 4);
    const records = calls.filter((call) => /^INSERT INTO schema_migrations/i.test(call.query));
    assert.equal(records.length, 1); assert.equal(records[0].params[0], 25);
});

test('25 026 y 027 permanecen PLANNED y sin SQL físico', () => {
    assert.deepEqual(entry.execution.dependsOn, [24]);
    const active = manifest.migraciones.find((item) => item.version === 26);
    assert.equal(active.estado, 'ACTIVE'); assert.deepEqual(active.execution.dependsOn, [25]);
    const planned = manifest.migraciones.find((item) => item.version === 27);
    assert.deepEqual([planned.estado, planned.archivo, planned.checksumSha256], ['PLANNED', null, null]);
    assert.equal(fs.readdirSync(manifestApi.MIGRATIONS_DIR).some((name) => name.startsWith('027_')), false);
});
