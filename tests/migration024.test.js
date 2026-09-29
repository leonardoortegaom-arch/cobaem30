'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const apply = require('../scripts/migrationApply');
const manifestApi = require('../scripts/migrationManifest');
const preflight = require('../scripts/migrationPreflight');

const manifest = manifestApi.cargarManifiesto();
const entry = manifest.migraciones.find((item) => item.version === 24);
const contract = apply.cargarContrato(entry);
const descriptor = preflight.cargarDescriptor();
const sqlPath = path.join(manifestApi.MIGRATIONS_DIR, entry.archivo);
const sql = fs.readFileSync(sqlPath, 'utf8');
const taskRows = contract.filasCatalogo.estados_tarea_academica;
const deliveryRows = contract.filasCatalogo.estados_entrega_tarea;
const manifestBefore025 = structuredClone(manifest);
const entry025Fixture = manifestBefore025.migraciones.find((item) => item.version === 25);
Object.assign(entry025Fixture, { estado: 'PLANNED', archivo: null, checksumSha256: null, razonEstado: 'Fixture previa a 025.' });
delete entry025Fixture.execution;

function controlRows(through = 23) {
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

function snapshot({ applied = false, missing = '', rowsTask = taskRows, rowsDelivery = deliveryRows } = {}) {
    const result = preflight.crearSnapshotCompatible(descriptor, {
        control: 'complete', controlRows: controlRows(applied ? 24 : 23),
        filasCatalogo: {
            estados_actividad_orientacion: [{ clave: 'RECHAZADA', nombre: 'Rechazada', descripcion: 'La evidencia requiere correcciones antes de considerarse realizada.', orden: 6, activo: 1 }],
            estados_tarea_academica: applied ? structuredClone(rowsTask) : [],
            estados_entrega_tarea: applied ? structuredClone(rowsDelivery) : []
        }
    });
    for (const version of [15, 16, 17, 18, 19, 20, 21]) {
        const current = apply.cargarContrato(manifest.migraciones.find((item) => item.version === version));
        for (const [name, spec] of Object.entries(current.tablas)) result.tablas[name] = tableFromContract(spec);
    }
    const activities = result.tablas.actividades_orientacion;
    activities.checks = activities.checks.filter((value) => !value.includes('fecha_realizacion'));
    activities.checkConstraints = [{ nombre: 'chk_actividades_fecha_limite', clausula: '((fecha_limite is null) or (fecha_limite >= fecha_asignacion))' }];
    if (applied) for (const [name, spec] of Object.entries(contract.tablas)) result.tablas[name] = tableFromContract(spec);
    if (missing) delete result.tablas[missing];
    return result;
}

test('01 SQL, contrato y checksums de 024 existen y coinciden', () => {
    assert.ok(fs.statSync(sqlPath).isFile());
    assert.equal(contract.migracion, 24);
    assert.equal(manifestApi.calcularChecksumCanonico(sqlPath), entry.checksumSha256);
    assert.equal(manifestApi.calcularChecksumCanonico(path.join(manifestApi.PROJECT_ROOT, entry.execution.postconditionContract)), entry.execution.postconditionChecksumSha256);
});

test('02 declara cinco operaciones y crea exactamente las tres tablas esperadas', () => {
    const statements = apply.validarSqlMigracion(entry);
    assert.deepEqual(statements.map(({ operation, target }) => ({ operation, target })), [
        { operation: 'CREATE_TABLE', target: 'estados_tarea_academica' },
        { operation: 'INSERT_CATALOG_ROWS', target: 'estados_tarea_academica' },
        { operation: 'CREATE_TABLE', target: 'estados_entrega_tarea' },
        { operation: 'INSERT_CATALOG_ROWS', target: 'estados_entrega_tarea' },
        { operation: 'CREATE_TABLE', target: 'tareas_academicas' }
    ]);
    assert.equal((sql.match(/\bCREATE\s+TABLE\b/gi) || []).length, 3);
});

test('03 no altera tablas heredadas ni contiene objetos u operaciones prohibidos', () => {
    assert.doesNotMatch(sql, /^\s*(ALTER|UPDATE|DELETE|REPLACE|INSERT\s+IGNORE|TRIGGER|PROCEDURE|FUNCTION|EVENT)\b/im);
    assert.doesNotMatch(sql, /\b(ON\s+DUPLICATE|ENUM)\b/i);
    assert.doesNotMatch(sql, /\bIF\s+NOT\s+EXISTS\b/i);
});

test('04 solo contiene siete filas contractuales y no fija IDs', () => {
    assert.equal(taskRows.length + deliveryRows.length, 7);
    assert.equal((sql.match(/\('(?:BORRADOR|PUBLICADA|CERRADA|CANCELADA|ENVIADA|APROBADA|RECHAZADA)'/g) || []).length, 7);
    assert.doesNotMatch(sql, /INSERT\s+INTO[^(]+\([^)]*\bid\b/i);
});

test('05 catálogos protegen clave, nombre y orden únicos', () => {
    for (const table of ['estados_tarea_academica', 'estados_entrega_tarea']) {
        assert.deepEqual(contract.tablas[table].indicesUnicos.map((index) => index.columnas), [['clave'], ['nombre'], ['orden']]);
    }
});

test('06 tareas usa tipos FK vigentes, DECIMAL positivo y columnas permitidas', () => {
    const table = contract.tablas.tareas_academicas;
    assert.equal(table.columnas.find((column) => column.nombre === 'puntaje_maximo').tipo, 'decimal(8,2)');
    assert.equal(table.columnas.find((column) => column.nombre === 'puntaje_maximo').nullable, false);
    assert.ok(table.checks.some((check) => check.fragmentos.includes('puntaje_maximo')));
    for (const forbidden of contract.columnasProhibidas.tareas_academicas) assert.equal(table.columnas.some((column) => column.nombre === forbidden), false);
});

test('07 todas las FK son RESTRICT/RESTRICT y los índices cubren sus prefijos', () => {
    const table = contract.tablas.tareas_academicas;
    for (const fk of table.foreignKeys) {
        assert.equal(fk.onUpdate, 'RESTRICT'); assert.equal(fk.onDelete, 'RESTRICT');
        assert.ok(table.indices.some((index) => index.columnas[0] === fk.columnas[0]));
    }
    assert.equal(table.indicesUnicos.length, 0);
});

test('08 024 depende de 023; 025 a 027 están PLANNED sin SQL', () => {
    assert.equal(entry.estado, 'ACTIVE'); assert.deepEqual(entry.execution.dependsOn, [23]);
    const active = manifest.migraciones.find((item) => item.version === 25);
    assert.equal(active.estado, 'ACTIVE'); assert.deepEqual(active.execution.dependsOn, [24]);
    for (const version of [26, 27]) {
        const planned = manifest.migraciones.find((item) => item.version === version);
        assert.deepEqual([planned.estado, planned.archivo, planned.checksumSha256], ['PLANNED', null, null]);
    }
});

test('09 precondición acepta las tres tablas ausentes', () => assert.equal(apply.validarPrecondiciones(snapshot(), entry), true));
for (const [number, table] of ['estados_tarea_academica', 'estados_entrega_tarea', 'tareas_academicas'].entries()) {
    test(`${10 + number} rechaza estado parcial con ${table}`, () => {
        const current = snapshot(); current.tablas[table] = tableFromContract(contract.tablas[table]);
        assert.throws(() => apply.validarPrecondiciones(current, entry));
    });
}
test('13 rechaza si falta 023', () => {
    const current = snapshot(); current.controlRows = current.controlRows.filter((row) => Number(row.version) !== 23);
    assert.throws(() => apply.validarPrecondiciones(current, entry));
});
test('13b rechaza una fila contractual parcial antes de aplicar', () => {
    const current = snapshot();
    current.filasCatalogo.estados_tarea_academica = [{ clave: 'BORRADOR', nombre: 'Borrador', descripcion: null, orden: 1, activo: 1 }];
    assert.throws(() => apply.validarPrecondiciones(current, entry));
});
test('14 postcondición acepta estructura y siete filas exactas', () => assert.equal(apply.validarPostcondicion(snapshot({ applied: true }), contract), true));
test('15 postcondición rechaza fila faltante, alterada, duplicada o adicional', () => {
    assert.throws(() => apply.validarPostcondicion(snapshot({ applied: true, rowsTask: taskRows.slice(1) }), contract));
    assert.throws(() => apply.validarPostcondicion(snapshot({ applied: true, rowsTask: taskRows.map((row, index) => index ? row : { ...row, activo: 0 }) }), contract));
    assert.throws(() => apply.validarPostcondicion(snapshot({ applied: true, rowsDelivery: [...deliveryRows, deliveryRows[0]] }), contract));
    assert.throws(() => apply.validarPostcondicion(snapshot({ applied: true, rowsTask: [...taskRows, { clave: 'EXTRA', nombre: 'Extra', descripcion: null, orden: 5, activo: 1 }] }), contract));
});
test('16 estructura existente sin registro es rechazada por el plan', () => {
    const current = snapshot({ applied: true });
    current.controlRows = current.controlRows.filter((row) => Number(row.version) !== 24);
    assert.throws(() => apply.construirPlan(manifest, current));
});
test('17 aplicada y registrada deja de estar pendiente en el fixture previo a 025', () => assert.deepEqual(apply.construirPlan(manifestBefore025, snapshot({ applied: true })), []));
test('18 checksum distinto es rechazado', () => {
    const changed = structuredClone(entry); changed.checksumSha256 = '0'.repeat(64);
    assert.throws(() => apply.validarSqlMigracion(changed));
});
test('19 clasificador cerrado rechaza DML distinto del declarado', () => {
    const declared = entry.execution.statements[1];
    for (const candidate of [
        "INSERT INTO estados_tarea_academica (clave,nombre,descripcion,orden,activo) VALUES ('OTRA','Otra',NULL,1,1)",
        'INSERT INTO estados_tarea_academica SELECT * FROM otra',
        "INSERT IGNORE INTO estados_tarea_academica (clave) VALUES ('BORRADOR')",
        'UPDATE estados_tarea_academica SET activo=1', 'DELETE FROM estados_tarea_academica', 'CREATE TABLE x (id INT)'
    ]) assert.throws(() => apply.clasificarSentenciaDeclarada(candidate, declared));
});
test('20 dry-run selecciona solo 024 y no escribe', async () => {
    const calls = []; const output = [];
    const connection = { async execute(query) { calls.push(query); return [[]]; }, release() {} };
    const pool = { async getConnection() { return connection; }, async end() {} };
    const plan = await apply.ejecutarDryRun({ log: (line) => output.push(line) }, { pool, manifest: manifestBefore025, snapshot: async () => snapshot() });
    assert.deepEqual(plan.map((item) => item.entrada.version), [24]);
    assert.match(output.join('\n'), /CREATE_TABLE estados_tarea_academica[\s\S]+INSERT_CATALOG_ROWS estados_tarea_academica[\s\S]+CREATE_TABLE estados_entrega_tarea[\s\S]+INSERT_CATALOG_ROWS estados_entrega_tarea[\s\S]+CREATE_TABLE tareas_academicas/);
    assert.equal(calls.some((query) => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(query)), false);
});

test('21 aplicación simulada ejecuta cinco sentencias antes de registrar exactamente 024', async () => {
    const calls = [];
    const connection = {
        async execute(query, params) {
            calls.push({ query, params });
            if (/GET_LOCK/.test(query)) return [[{ lock_obtenido: 1 }]];
            if (/RELEASE_LOCK/.test(query)) return [[{ lock_liberado: 1 }]];
            if (/^INSERT INTO estados_tarea_academica/i.test(query)) return [{ affectedRows: 4 }];
            if (/^INSERT INTO estados_entrega_tarea/i.test(query)) return [{ affectedRows: 3 }];
            if (/^INSERT INTO schema_migrations/i.test(query)) return [{ affectedRows: 1 }];
            return [{ affectedRows: 0 }];
        },
        async beginTransaction() { calls.push({ query: 'BEGIN' }); },
        async commit() { calls.push({ query: 'COMMIT' }); },
        async rollback() { calls.push({ query: 'ROLLBACK' }); }, release() {}
    };
    const pool = { async getConnection() { return connection; }, async end() {} };
    const backupHash = require('node:crypto').createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
    const options = apply.parsearArgumentos(['up', '--execute', '--confirm=APPLY-ACTIVE-MIGRATIONS', '--acknowledge-ddl-autocommit', `--backup-file=${__filename}`, `--backup-sha256=${backupHash}`]);
    const deps = {
        env: { MIGRATION_DB_ALLOW_WRITES: 'ACTIVE_MIGRATIONS_ONLY', MIGRATION_DB_HOST: 'x', MIGRATION_DB_PORT: '3306', MIGRATION_DB_NAME: 'x', MIGRATION_DB_USER: 'x', MIGRATION_DB_PASSWORD: 'x' },
        pool, manifest: manifestBefore025, privileges: async (unused, required) => { assert.deepEqual(required, ['SELECT', 'CREATE', 'INSERT']); return { estado: 'PRESENT' }; },
        snapshot: async () => snapshot(), snapshotAfter: async () => snapshot({ applied: true }),
        snapshotVerified: async () => snapshot({ applied: true }), randomUUID: () => '00000000-0000-4000-8000-000000000024',
    };
    await apply.ejecutarAdministrativo(options, true, { log() {} }, deps);
    const statements = calls.filter((call) => /^(CREATE TABLE|INSERT INTO estados_)/i.test(call.query));
    assert.equal(statements.length, 5);
    const records = calls.filter((call) => /^INSERT INTO schema_migrations/i.test(call.query));
    assert.equal(records.length, 1); assert.equal(records[0].params[0], 24);
});
