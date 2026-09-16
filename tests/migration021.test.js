'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifestApi = require('../scripts/migrationManifest');
const preflight = require('../scripts/migrationPreflight');
const apply = require('../scripts/migrationApply');

const manifest = manifestApi.cargarManifiesto();
const entry = manifest.migraciones.find((item) => item.version === 21);
const sqlPath = path.join(manifestApi.MIGRATIONS_DIR, entry.archivo || '');
const sql = fs.readFileSync(sqlPath, 'utf8');
const executable = sql.replace(/--[^\r\n]*/g, '').toLowerCase();
const contract = apply.cargarContrato(entry);

function appliedRow(migration) {
    return {
        version: migration.version,
        archivo: migration.archivo,
        checksum_sha256: migration.checksumSha256,
        tipo_registro: migration.version === 0 ? 'EJECUTADA' : migration.version <= 8 ? 'BASELINE' : 'EJECUTADA'
    };
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
        indices: [{ unique: true, columnas: spec.primaryKey }]
            .concat(spec.indicesUnicos.map((index) => ({ unique: true, columnas: index.columnas })))
            .concat(spec.indices.map((index) => ({ unique: false, columnas: index.columnas }))),
        foreignKeys: structuredClone(spec.foreignKeys),
        checks: spec.checks.map((check) => check.fragmentos.join(' '))
    };
}

function snapshotBefore021() {
    const descriptor = preflight.cargarDescriptor();
    const baseline = manifest.migraciones.filter((item) => item.version <= 8).map(appliedRow);
    const snapshot = preflight.crearSnapshotCompatible(descriptor, { control: 'complete', controlRows: baseline });
    for (const version of [15, 16, 17, 18, 19, 20]) {
        const migration = manifest.migraciones.find((item) => item.version === version);
        const currentContract = apply.cargarContrato(migration);
        for (const [name, spec] of Object.entries(currentContract.tablas)) snapshot.tablas[name] = tableFromContract(spec);
        snapshot.controlRows.push(appliedRow(migration));
    }
    return snapshot;
}

test('01 archivo y contrato 021 están presentes', () => {
    assert.equal(fs.statSync(sqlPath).isFile(), true);
    assert.equal(fs.statSync(path.join(manifestApi.PROJECT_ROOT, entry.execution.postconditionContract)).isFile(), true);
});
test('02 contiene exactamente dos CREATE TABLE en el orden declarado', () => {
    assert.equal(apply.separarSentenciasSql(sql).length, 2);
    assert.deepEqual(apply.validarSqlMigracion(entry).map(({ operation, target }) => ({ operation, target })), [
        { operation: 'CREATE_TABLE', target: 'tipos_actividad_docente' },
        { operation: 'CREATE_TABLE', target: 'actividades_docente_no_lectivas' }
    ]);
});
test('03 no contiene DML, ALTER, DROP ni TRUNCATE', () => {
    for (const statement of apply.separarSentenciasSql(sql)) assert.doesNotMatch(statement, /^\s*(insert|update|delete|replace|alter|drop|truncate)\b/i);
});
test('04 no contiene ENUM ni objetos programables', () => assert.doesNotMatch(executable, /\b(enum|trigger|procedure|function|view|event)\b/));
test('05 ambas tablas comienzan vacías y no hay datos inventados', () => {
    assert.ok(contract.invariantesDatos.includes('NEW_TABLES_EMPTY'));
    assert.doesNotMatch(executable, /\binsert\b|\bvalues\s*\(/);
});
test('06 catálogo tiene columnas, tipos y nulabilidad contractuales', () => {
    const columns = contract.tablas.tipos_actividad_docente.columnas;
    assert.deepEqual(columns.map((item) => item.nombre), ['id', 'clave', 'nombre', 'descripcion', 'activo', 'creado_en', 'actualizado_en']);
    assert.equal(columns.find((item) => item.nombre === 'id').tipo, 'int unsigned');
    assert.equal(columns.find((item) => item.nombre === 'descripcion').nullable, true);
    assert.equal(columns.find((item) => item.nombre === 'activo').default, '1');
});
test('07 catálogo usa clave UNIQUE e índice administrativo', () => {
    const table = contract.tablas.tipos_actividad_docente;
    assert.deepEqual(table.indicesUnicos, [{ columnas: ['clave'] }]);
    assert.ok(table.indices.some((item) => item.columnas.join(',') === 'activo,nombre,id'));
});
test('08 catálogo valida clave, nombre y activo', () => {
    assert.match(executable, /check \(char_length\(trim\(clave\)\) > 0\)/);
    assert.match(executable, /check \(char_length\(trim\(nombre\)\) > 0\)/);
    assert.match(executable, /check \(activo in \(0, 1\)\)/);
});
test('09 actividad contiene exactamente las columnas aprobadas', () => {
    assert.deepEqual(contract.tablas.actividades_docente_no_lectivas.columnas.map((item) => item.nombre), [
        'id', 'docente_usuario_id', 'periodo_academico_id', 'tipo_actividad_docente_id', 'aula_id',
        'titulo', 'observaciones', 'dia_semana', 'hora_inicio', 'hora_fin', 'fecha_inicio', 'fecha_fin',
        'creado_por_usuario_id', 'creado_en', 'actualizado_en'
    ]);
});
test('10 tipos de identificadores coinciden con sus referencias', () => {
    const columns = Object.fromEntries(contract.tablas.actividades_docente_no_lectivas.columnas.map((item) => [item.nombre, item]));
    assert.equal(columns.id.tipo, 'bigint unsigned');
    for (const name of ['docente_usuario_id', 'creado_por_usuario_id']) assert.equal(columns[name].tipo, 'bigint unsigned');
    for (const name of ['periodo_academico_id', 'tipo_actividad_docente_id', 'aula_id']) assert.equal(columns[name].tipo, 'int unsigned');
});
test('11 aula, observaciones y fecha final son opcionales', () => {
    const columns = contract.tablas.actividades_docente_no_lectivas.columnas;
    assert.deepEqual(columns.filter((item) => item.nullable).map((item) => item.nombre), ['aula_id', 'observaciones', 'fecha_fin']);
});
test('12 catálogo de tipo es obligatorio mediante FK', () => {
    const fk = contract.tablas.actividades_docente_no_lectivas.foreignKeys.find((item) => item.columnas[0] === 'tipo_actividad_docente_id');
    assert.deepEqual(fk, { columnas: ['tipo_actividad_docente_id'], tablaDestino: 'tipos_actividad_docente', columnasDestino: ['id'], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' });
});
test('13 título y observaciones tienen límites y no admiten texto vacío', () => {
    const columns = Object.fromEntries(contract.tablas.actividades_docente_no_lectivas.columnas.map((item) => [item.nombre, item]));
    assert.equal(columns.titulo.tipo, 'varchar(150)');
    assert.equal(columns.observaciones.tipo, 'varchar(500)');
    assert.match(executable, /char_length\(trim\(titulo\)\) > 0/);
    assert.match(executable, /observaciones is null or char_length\(trim\(observaciones\)\) > 0/);
});
test('14 día está limitado exclusivamente de lunes a viernes', () => assert.match(executable, /check \(dia_semana between 1 and 5\)/));
test('15 horas son flexibles y están correctamente ordenadas', () => {
    assert.match(executable, /check \(hora_inicio < hora_fin\)/);
    assert.doesNotMatch(executable, /timestampdiff|interval\s+\d+|50\s+minute/);
});
test('16 vigencia usa fechas y permite cierre nullable', () => assert.match(executable, /check \(fecha_fin is null or fecha_fin >= fecha_inicio\)/));
test('17 actividad no contiene estado activo ni relaciones prohibidas', () => {
    const names = contract.tablas.actividades_docente_no_lectivas.columnas.map((item) => item.nombre);
    for (const forbidden of ['activo', 'grupo_id', 'materia_id', 'version_horario_id', 'concepto', 'descripcion', 'ubicacion_texto', 'fecha_evento']) assert.equal(names.includes(forbidden), false);
});
test('18 todas las FK usan UPDATE y DELETE RESTRICT', () => {
    const foreignKeys = contract.tablas.actividades_docente_no_lectivas.foreignKeys;
    assert.equal(foreignKeys.length, 5);
    assert.ok(foreignKeys.every((fk) => fk.onUpdate === 'RESTRICT' && fk.onDelete === 'RESTRICT'));
    assert.doesNotMatch(executable, /\bcascade\b/);
});
test('19 FK apuntan a usuarios, periodos, tipos y aulas', () => {
    const pairs = contract.tablas.actividades_docente_no_lectivas.foreignKeys.map((fk) => `${fk.columnas[0]}:${fk.tablaDestino}`);
    assert.deepEqual(pairs, ['docente_usuario_id:usuarios', 'periodo_academico_id:periodos_academicos', 'tipo_actividad_docente_id:tipos_actividad_docente', 'aula_id:aulas', 'creado_por_usuario_id:usuarios']);
});
test('20 índices cubren docente, aula, periodo, tipo y creador por prefijo izquierdo', () => {
    const first = contract.tablas.actividades_docente_no_lectivas.indices.map((item) => item.columnas[0]);
    assert.deepEqual(first, ['docente_usuario_id', 'aula_id', 'periodo_academico_id', 'tipo_actividad_docente_id', 'creado_por_usuario_id']);
});
test('21 no existe UNIQUE que intente resolver solapamientos', () => assert.deepEqual(contract.tablas.actividades_docente_no_lectivas.indicesUnicos, []));
test('22 ambas tablas usan InnoDB y la codificación contractual', () => {
    for (const table of Object.values(contract.tablas)) assert.deepEqual([table.engine, table.charset, table.collation], ['innodb', 'utf8mb4', 'utf8mb4_0900_ai_ci']);
});
test('23 contrato preserva tablas anteriores y prohíbe columnas ajenas', () => {
    assert.deepEqual(contract.tablasPreservadas, ['usuarios', 'periodos_academicos', 'aulas', 'clases_programadas']);
    assert.ok(contract.columnasProhibidas.actividades_docente_no_lectivas.includes('grupo_id'));
});
test('24 checksums SQL y contrato coinciden', () => {
    assert.equal(manifestApi.calcularChecksumCanonico(sqlPath), entry.checksumSha256);
    assert.equal(manifestApi.calcularChecksumCanonico(path.join(manifestApi.PROJECT_ROOT, entry.execution.postconditionContract)), entry.execution.postconditionChecksumSha256);
});
test('25 021 está ACTIVE, depende exactamente de 020 y no existe 022', () => {
    assert.equal(entry.estado, 'ACTIVE');
    assert.deepEqual(entry.execution.dependsOn, [20]);
    assert.equal(manifest.migraciones.some((item) => item.version > 21), false);
});
test('26 precondición es válida cuando ambas tablas están ausentes', () => assert.equal(apply.validarPrecondiciones(snapshotBefore021(), entry), true));
test('27 una sola tabla existente se rechaza como estado parcial', () => {
    for (const name of Object.keys(contract.tablas)) {
        const snapshot = snapshotBefore021();
        snapshot.tablas[name] = tableFromContract(contract.tablas[name]);
        assert.throws(() => apply.construirPlan(manifest, snapshot), (error) => error.code === 'UNREGISTERED_PARTIAL_STRUCTURE');
    }
});
test('28 aplicada y registrada deja de estar pendiente', () => {
    const snapshot = snapshotBefore021();
    for (const [name, spec] of Object.entries(contract.tablas)) snapshot.tablas[name] = tableFromContract(spec);
    snapshot.controlRows.push(appliedRow(entry));
    assert.deepEqual(apply.construirPlan(manifest, snapshot), []);
});
test('29 estructura completa no registrada se rechaza', () => {
    const snapshot = snapshotBefore021();
    for (const [name, spec] of Object.entries(contract.tablas)) snapshot.tablas[name] = tableFromContract(spec);
    assert.throws(() => apply.construirPlan(manifest, snapshot), (error) => error.code === 'UNREGISTERED_PARTIAL_STRUCTURE');
});
test('30 contrato rechaza columnas prohibidas añadidas', () => {
    const snapshot = { tablas: Object.fromEntries(Object.entries(contract.tablas).map(([name, spec]) => [name, tableFromContract(spec)])) };
    snapshot.tablas.actividades_docente_no_lectivas.columnas.grupo_id = { tipo: 'int unsigned', unsigned: true, nullable: false };
    assert.throws(() => apply.validarPostcondicion(snapshot, contract), (error) => error.code === 'POSTCONDITION_MISMATCH');
});
