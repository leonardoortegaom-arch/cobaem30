'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const apply = require('../scripts/migrationApply');
const manifestApi = require('../scripts/migrationManifest');
const preflight = require('../scripts/migrationPreflight');

const manifest = manifestApi.cargarManifiesto();
const entry = manifest.migraciones.find((item) => item.version === 27);
const contract = apply.cargarContrato(entry);
const contract024 = apply.cargarContrato(manifest.migraciones.find((item) => item.version === 24));
const descriptor = preflight.cargarDescriptor();
const sqlPath = path.join(manifestApi.MIGRATIONS_DIR, entry.archivo);
const sql = fs.readFileSync(sqlPath, 'utf8');

function controlRows(through = 26) {
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
        control: 'complete', controlRows: controlRows(applied ? 27 : 26),
        filasCatalogo: {
            estados_actividad_orientacion: [{ clave: 'RECHAZADA', nombre: 'Rechazada', descripcion: 'La evidencia requiere correcciones antes de considerarse realizada.', orden: 6, activo: 1 }],
            estados_tarea_academica: structuredClone(contract024.filasCatalogo.estados_tarea_academica),
            estados_entrega_tarea: structuredClone(contract024.filasCatalogo.estados_entrega_tarea)
        }
    });
    for (const version of [15, 16, 17, 18, 19, 20, 21, 24, 25, 26]) {
        const current = apply.cargarContrato(manifest.migraciones.find((item) => item.version === version));
        for (const [name, spec] of Object.entries(current.tablas)) result.tablas[name] = tableFromContract(spec);
    }
    const activities = result.tablas.actividades_orientacion;
    activities.checks = activities.checks.filter((value) => !value.includes('fecha_realizacion'));
    activities.checkConstraints = [{ nombre: 'chk_actividades_fecha_limite', clausula: '((fecha_limite is null) or (fecha_limite >= fecha_asignacion))' }];
    if (applied) result.tablas.revisiones_entrega_tarea = tableFromContract(contract.tablas.revisiones_entrega_tarea);
    if (mutate) mutate(result);
    return result;
}

test('01 SQL y contrato 027 están manifestados con checksums correctos', () => {
    assert.ok(fs.statSync(sqlPath).isFile()); assert.equal(entry.estado, 'ACTIVE'); assert.equal(contract.migracion, 27);
    assert.equal(manifestApi.calcularChecksumCanonico(sqlPath), entry.checksumSha256);
    assert.equal(manifestApi.calcularChecksumCanonico(path.join(manifestApi.PROJECT_ROOT, entry.execution.postconditionContract)), entry.execution.postconditionChecksumSha256);
});

test('02 depende de 026 y declara un único CREATE_TABLE', () => {
    assert.deepEqual(entry.execution.dependsOn, [26]);
    const statements = apply.validarSqlMigracion(entry);
    assert.deepEqual(statements.map(({ operation, target }) => ({ operation, target })), [{ operation: 'CREATE_TABLE', target: 'revisiones_entrega_tarea' }]);
    assert.equal((sql.match(/\bCREATE\s+TABLE\b/gi) || []).length, 1);
});

test('03 no contiene ALTER, DROP, DML, ENUM ni objetos programables', () => {
    assert.doesNotMatch(sql, /^\s*(ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|REPLACE)\b/im);
    assert.doesNotMatch(sql, /\b(ENUM|TRIGGER|PROCEDURE|FUNCTION|EVENT|VIEW|IF\s+NOT\s+EXISTS)\b/i);
});

test('04 columnas y tipos coinciden con el contrato documental', () => {
    assert.deepEqual(contract.tablas.revisiones_entrega_tarea.columnas.map((item) => item.nombre), [
        'id', 'intento_entrega_tarea_id', 'numero_revision', 'docente_revisor_usuario_id',
        'estado_entrega_id', 'calificacion', 'comentario', 'revisado_en'
    ]);
});

test('05 las tres FK apuntan a intento, usuario revisor y estado', () => {
    const fks = contract.tablas.revisiones_entrega_tarea.foreignKeys;
    assert.deepEqual(fks.map((fk) => [fk.columnas[0], fk.tablaDestino, fk.columnasDestino[0]]), [
        ['intento_entrega_tarea_id', 'intentos_entrega_tarea', 'id'],
        ['docente_revisor_usuario_id', 'usuarios', 'id'],
        ['estado_entrega_id', 'estados_entrega_tarea', 'id']
    ]);
});

test('06 todas las FK usan RESTRICT y están cubiertas por prefijo izquierdo', () => {
    const table = contract.tablas.revisiones_entrega_tarea;
    const indexes = [...table.indicesUnicos, ...table.indices];
    for (const fk of table.foreignKeys) {
        assert.equal(fk.onUpdate, 'RESTRICT'); assert.equal(fk.onDelete, 'RESTRICT');
        assert.ok(indexes.some((index) => index.columnas[0] === fk.columnas[0]));
    }
    assert.doesNotMatch(sql, /ON\s+DELETE\s+CASCADE/i);
});

test('07 número de revisión es único por intento sin limitar el historial', () => {
    const unique = contract.tablas.revisiones_entrega_tarea.indicesUnicos;
    assert.deepEqual(unique, [{ columnas: ['intento_entrega_tarea_id', 'numero_revision'] }]);
    assert.equal(unique.some((item) => item.columnas.length === 1 && item.columnas[0] === 'intento_entrega_tarea_id'), false);
});

test('08 calificación es DECIMAL(8,2), nullable y no negativa', () => {
    const table = contract.tablas.revisiones_entrega_tarea;
    const column = table.columnas.find((item) => item.nombre === 'calificacion');
    assert.deepEqual([column.tipo, column.nullable, column.default], ['decimal(8,2)', true, null]);
    assert.ok(table.checks.some((item) => item.fragmentos.includes('calificacion >= 0')));
    assert.doesNotMatch(sql, /\b(FLOAT|DOUBLE)\b/i);
});

test('09 comentario contractual admite NULL pero rechaza texto vacío', () => {
    const table = contract.tablas.revisiones_entrega_tarea;
    const column = table.columnas.find((item) => item.nombre === 'comentario');
    assert.deepEqual([column.tipo, column.nullable], ['varchar(2000)', true]);
    assert.ok(table.checks.some((item) => item.fragmentos.includes('char_length(trim(comentario)) > 0')));
});

test('10 tabla append-only no contiene actualización ni eliminación física', () => {
    const columns = contract.tablas.revisiones_entrega_tarea.columnas.map((item) => item.nombre);
    for (const forbidden of ['actualizado_en', 'eliminado_en', 'activo']) assert.equal(columns.includes(forbidden), false);
    assert.doesNotMatch(sql, /^\s*(UPDATE|DELETE)\b/im);
});

test('11 índices cubren historial, docente, fecha y estado', () => {
    assert.deepEqual(contract.tablas.revisiones_entrega_tarea.indices.map((item) => item.columnas), [
        ['intento_entrega_tarea_id', 'revisado_en', 'id'],
        ['docente_revisor_usuario_id', 'revisado_en', 'id'],
        ['estado_entrega_id', 'revisado_en', 'id']
    ]);
});

test('12 estados se resuelven por clave y no existen IDs fijos', () => {
    assert.doesNotMatch(sql, /estado_entrega_id\s+(?:=|IN\s*\()\s*\d/i);
    assert.deepEqual(contract.invariantesAplicacion.map((item) => item.estadoClave).filter(Boolean), ['RECHAZADA', 'APROBADA', 'ENVIADA']);
});

test('13 RECHAZADA exige comentario y calificación NULL como invariante transaccional', () => {
    const rule = contract.invariantesAplicacion.find((item) => item.estadoClave === 'RECHAZADA');
    assert.ok(rule.reglas.includes('comentario obligatorio y no vacío'));
    assert.ok(rule.reglas.includes('calificacion NULL'));
});

test('14 APROBADA permite calificación opcional validada contra la tarea', () => {
    const rule = contract.invariantesAplicacion.find((item) => item.estadoClave === 'APROBADA');
    assert.ok(rule.reglas.includes('calificacion opcional'));
    assert.ok(rule.reglas.some((item) => item.includes('tareas_academicas.puntaje_maximo')));
});

test('15 ENVIADA no es resultado válido de una nueva revisión', () => {
    const rule = contract.invariantesAplicacion.find((item) => item.estadoClave === 'ENVIADA');
    assert.ok(rule.reglas.includes('no se admite como resultado de una nueva revisión'));
});

test('16 contrato exige inserción y proyección de estado en una transacción futura', () => {
    const rule = contract.invariantesAplicacion.find((item) => item.reglasTransaccionales);
    assert.ok(rule.reglasTransaccionales.some((item) => item.includes('misma transacción')));
    assert.ok(rule.reglasTransaccionales.some((item) => item.includes('docente autor autorizado')));
});

test('17 usa InnoDB, utf8mb4 y collation contractual', () => {
    const table = contract.tablas.revisiones_entrega_tarea;
    assert.deepEqual([table.engine, table.charset, table.collation], ['innodb', 'utf8mb4', 'utf8mb4_0900_ai_ci']);
});

test('18 precondición acepta ausencia y exige 026 registrada', () => {
    assert.equal(apply.validarPrecondiciones(snapshot(), entry), true);
    const current = snapshot(); current.controlRows = current.controlRows.filter((row) => Number(row.version) !== 26);
    assert.throws(() => apply.validarPrecondiciones(current, entry));
});

test('19 estructura existente no registrada se rechaza', () => {
    const current = snapshot(); current.tablas.revisiones_entrega_tarea = tableFromContract(contract.tablas.revisiones_entrega_tarea);
    assert.throws(() => apply.construirPlan(manifest, current));
});

test('20 estructura aplicada y registrada satisface la postcondición', () => {
    const current = snapshot({ applied: true });
    assert.equal(apply.validarPostcondicion(current, contract), true);
    assert.deepEqual(apply.construirPlan(manifest, current), []);
});

test('21 postcondición rechaza diferencias de FK, CHECK o índice', () => {
    assert.throws(() => apply.validarPostcondicion(snapshot({ applied: true, mutate(current) { current.tablas.revisiones_entrega_tarea.foreignKeys[0].onDelete = 'CASCADE'; } }), contract));
    assert.throws(() => apply.validarPostcondicion(snapshot({ applied: true, mutate(current) { current.tablas.revisiones_entrega_tarea.checks = []; } }), contract));
    assert.throws(() => apply.validarPostcondicion(snapshot({ applied: true, mutate(current) { current.tablas.revisiones_entrega_tarea.indices = []; } }), contract));
});

test('22 checksum alterado se rechaza', () => {
    const changed = structuredClone(entry); changed.checksumSha256 = '0'.repeat(64);
    assert.throws(() => apply.validarSqlMigracion(changed));
});

test('23 dry-run selecciona solo 027 y no escribe', async () => {
    const calls = []; const output = [];
    const connection = { async execute(query) { calls.push(query); return [[]]; }, release() {} };
    const pool = { async getConnection() { return connection; }, async end() {} };
    const plan = await apply.ejecutarDryRun({ log: (line) => output.push(line) }, { pool, manifest, snapshot: async () => snapshot() });
    assert.deepEqual(plan.map((item) => item.entrada.version), [27]);
    assert.match(output.join('\n'), /CREATE_TABLE revisiones_entrega_tarea/);
    assert.equal(calls.some((query) => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(query)), false);
});

test('24 fallo durante CREATE ocurre antes del registro', async () => {
    const calls = [];
    const connection = {
        async execute(query, params) {
            calls.push({ query, params });
            if (/GET_LOCK/.test(query)) return [[{ lock_obtenido: 1 }]];
            if (/RELEASE_LOCK/.test(query)) return [[{ lock_liberado: 1 }]];
            if (/^CREATE TABLE/i.test(query)) throw new Error('simulated');
            return [{ affectedRows: 0 }];
        },
        async beginTransaction() {}, async commit() {}, async rollback() {}, release() {}
    };
    const pool = { async getConnection() { return connection; }, async end() {} };
    const backupHash = require('node:crypto').createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
    const options = apply.parsearArgumentos(['up', '--execute', '--confirm=APPLY-ACTIVE-MIGRATIONS', '--acknowledge-ddl-autocommit', `--backup-file=${__filename}`, `--backup-sha256=${backupHash}`]);
    await assert.rejects(() => apply.ejecutarAdministrativo(options, true, { log() {} }, {
        env: { MIGRATION_DB_ALLOW_WRITES: 'ACTIVE_MIGRATIONS_ONLY', MIGRATION_DB_HOST: 'x', MIGRATION_DB_PORT: '3306', MIGRATION_DB_NAME: 'x', MIGRATION_DB_USER: 'x', MIGRATION_DB_PASSWORD: 'x' },
        pool, manifest, privileges: async () => ({ estado: 'PRESENT' }), snapshot: async () => snapshot()
    }));
    assert.equal(calls.some((call) => /^INSERT INTO schema_migrations/i.test(call.query)), false);
});

test('25 aplicación simulada registra exactamente 027 tras el CREATE', async () => {
    const calls = [];
    const connection = {
        async execute(query, params) {
            calls.push({ query, params });
            if (/GET_LOCK/.test(query)) return [[{ lock_obtenido: 1 }]];
            if (/RELEASE_LOCK/.test(query)) return [[{ lock_liberado: 1 }]];
            if (/^INSERT INTO schema_migrations/i.test(query)) return [{ affectedRows: 1 }];
            return [{ affectedRows: 0 }];
        },
        async beginTransaction() {}, async commit() {}, async rollback() {}, release() {}
    };
    const pool = { async getConnection() { return connection; }, async end() {} };
    const backupHash = require('node:crypto').createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
    const options = apply.parsearArgumentos(['up', '--execute', '--confirm=APPLY-ACTIVE-MIGRATIONS', '--acknowledge-ddl-autocommit', `--backup-file=${__filename}`, `--backup-sha256=${backupHash}`]);
    await apply.ejecutarAdministrativo(options, true, { log() {} }, {
        env: { MIGRATION_DB_ALLOW_WRITES: 'ACTIVE_MIGRATIONS_ONLY', MIGRATION_DB_HOST: 'x', MIGRATION_DB_PORT: '3306', MIGRATION_DB_NAME: 'x', MIGRATION_DB_USER: 'x', MIGRATION_DB_PASSWORD: 'x' },
        pool, manifest, privileges: async () => ({ estado: 'PRESENT' }), snapshot: async () => snapshot(),
        snapshotAfter: async () => snapshot({ applied: true }), snapshotVerified: async () => snapshot({ applied: true }),
        randomUUID: () => '00000000-0000-4000-8000-000000000027'
    });
    assert.equal(calls.filter((call) => /^CREATE TABLE/i.test(call.query)).length, 1);
    const records = calls.filter((call) => /^INSERT INTO schema_migrations/i.test(call.query));
    assert.equal(records.length, 1); assert.equal(records[0].params[0], 27);
});
