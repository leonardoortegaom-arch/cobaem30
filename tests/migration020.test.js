'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifestApi = require('../scripts/migrationManifest');
const preflight = require('../scripts/migrationPreflight');
const apply = require('../scripts/migrationApply');

const manifest = manifestApi.cargarManifiesto();
const entry = manifest.migraciones.find((item) => item.version === 20);
const sqlPath = path.join(manifestApi.MIGRATIONS_DIR, entry.archivo || '');
const sql = fs.readFileSync(sqlPath, 'utf8');
const normalized = sql.replace(/--[^\r\n]*/g, '').toLowerCase();
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
            tipo: column.tipo.toLowerCase(), unsigned: column.unsigned, nullable: column.nullable,
            default: Object.hasOwn(column, 'default') && column.default !== null ? String(column.default).toLowerCase() : null,
            extra: String(column.extra || '').toLowerCase(), collation: column.collation || null,
            generationExpression: preflight.normalizarExpresionGenerada(column.generationExpression), ordinal: index + 1
        }])),
        indices: [{ unique: true, columnas: spec.primaryKey }]
            .concat(spec.indicesUnicos.map((index) => ({ unique: true, columnas: index.columnas })))
            .concat(spec.indices.map((index) => ({ unique: false, columnas: index.columnas }))),
        foreignKeys: structuredClone(spec.foreignKeys),
        checks: spec.checks.map((check) => check.fragmentos.join(' '))
    };
}

function snapshotBefore020() {
    const descriptor = preflight.cargarDescriptor();
    const rows = manifest.migraciones
        .filter((item) => item.version <= 8)
        .map(appliedRow);
    const snapshot = preflight.crearSnapshotCompatible(descriptor, { control: 'complete', controlRows: rows });
    for (const version of [15, 16, 17, 18, 19]) {
        const migration = manifest.migraciones.find((item) => item.version === version);
        const currentContract = apply.cargarContrato(migration);
        for (const [name, spec] of Object.entries(currentContract.tablas)) snapshot.tablas[name] = tableFromContract(spec);
        snapshot.controlRows.push(appliedRow(migration));
    }
    return snapshot;
}

test('01 archivo y contrato 020 están presentes', () => {
    assert.equal(fs.statSync(sqlPath).isFile(), true);
    assert.equal(fs.statSync(path.join(manifestApi.PROJECT_ROOT, entry.execution.postconditionContract)).isFile(), true);
});
test('02 contiene exactamente un CREATE TABLE', () => assert.equal(apply.separarSentenciasSql(sql).length, 1));
test('03 crea exclusivamente clases_programadas', () => {
    assert.deepEqual(apply.validarSqlMigracion(entry).map(({ operation, target }) => ({ operation, target })), [{ operation: 'CREATE_TABLE', target: 'clases_programadas' }]);
});
test('04 no contiene sentencias DML, ALTER, DROP ni TRUNCATE', () => {
    for (const statement of apply.separarSentenciasSql(sql)) assert.doesNotMatch(statement, /^\s*(insert|update|delete|replace|alter|drop|truncate)\b/i);
});
test('05 no contiene ENUM ni objetos programables', () => assert.doesNotMatch(normalized, /\b(enum|trigger|procedure|function|view|event)\b/));
test('06 no usa IF NOT EXISTS ni almacena XLSX', () => assert.doesNotMatch(normalized, /if\s+not\s+exists|xlsx|blob|base64/));
test('07 columnas y orden coinciden con el diseño inmutable', () => {
    assert.deepEqual(contract.tablas.clases_programadas.columnas.map((item) => item.nombre), [
        'id', 'version_horario_id', 'materia_id', 'docente_usuario_id', 'aula_id',
        'dia_semana', 'hora_inicio', 'hora_fin', 'creado_en'
    ]);
});
test('08 tipos de identificadores son compatibles', () => {
    const columns = Object.fromEntries(contract.tablas.clases_programadas.columnas.map((item) => [item.nombre, item]));
    assert.equal(columns.id.tipo, 'bigint unsigned');
    assert.equal(columns.version_horario_id.tipo, 'bigint unsigned');
    assert.equal(columns.docente_usuario_id.tipo, 'bigint unsigned');
    for (const name of ['materia_id', 'aula_id']) assert.equal(columns[name].tipo, 'int unsigned');
});
test('09 aula es la única referencia opcional', () => {
    const refs = contract.tablas.clases_programadas.columnas.filter((item) => item.nombre.endsWith('_id'));
    assert.deepEqual(refs.filter((item) => item.nullable).map((item) => item.nombre), ['aula_id']);
});
test('10 día está limitado de lunes a sábado', () => assert.match(normalized, /check \(dia_semana between 1 and 6\)/));
test('11 hora inicial debe ser anterior a hora final', () => assert.match(normalized, /check \(hora_inicio < hora_fin\)/));
test('12 bloque exacto es único dentro de la versión', () => {
    assert.deepEqual(contract.tablas.clases_programadas.indicesUnicos, [{ columnas: ['version_horario_id', 'dia_semana', 'hora_inicio', 'hora_fin'] }]);
});
test('13 alcance usa FK simple hacia versiones_horario', () => {
    const fk = contract.tablas.clases_programadas.foreignKeys.find((item) => item.tablaDestino === 'versiones_horario');
    assert.deepEqual(fk.columnas, ['version_horario_id']);
    assert.deepEqual(fk.columnasDestino, ['id']);
});
test('14 no duplica grupo ni periodo académico', () => {
    const names = contract.tablas.clases_programadas.columnas.map((item) => item.nombre);
    assert.equal(names.includes('grupo_id'), false);
    assert.equal(names.includes('periodo_academico_id'), false);
    assert.doesNotMatch(normalized, /\b(grupo_id|periodo_academico_id)\b/);
    assert.deepEqual(contract.columnasProhibidas.clases_programadas.slice(0, 2), ['grupo_id', 'periodo_academico_id']);
});
test('15 el alcance se deriva exclusivamente de versiones_horario', () => {
    assert.equal(contract.alcance.derivadoExclusivamenteDe, 'versiones_horario');
    assert.deepEqual(contract.alcance.foreignKey, ['version_horario_id']);
});
test('16 FK de materia, docente y aula apuntan a catálogos correctos', () => {
    const pairs = contract.tablas.clases_programadas.foreignKeys.map((fk) => `${fk.columnas[0]}:${fk.tablaDestino}`);
    assert.deepEqual(pairs, ['version_horario_id:versiones_horario', 'materia_id:materias', 'docente_usuario_id:usuarios', 'aula_id:aulas']);
});
test('17 todas las FK usan UPDATE y DELETE RESTRICT', () => {
    assert.ok(contract.tablas.clases_programadas.foreignKeys.every((fk) => fk.onUpdate === 'RESTRICT' && fk.onDelete === 'RESTRICT'));
    assert.doesNotMatch(normalized, /on delete cascade|on update cascade/);
});
test('18 índice docente cubre horario y versión', () => assert.ok(contract.tablas.clases_programadas.indices.some((i) => i.columnas.join(',') === 'docente_usuario_id,dia_semana,hora_inicio,hora_fin,version_horario_id')));
test('19 índice aula cubre horario y versión', () => assert.ok(contract.tablas.clases_programadas.indices.some((i) => i.columnas.join(',') === 'aula_id,dia_semana,hora_inicio,hora_fin,version_horario_id')));
test('20 índice materia cubre materia y versión', () => assert.ok(contract.tablas.clases_programadas.indices.some((i) => i.columnas.join(',') === 'materia_id,version_horario_id')));
test('21 no crea índices directos de grupo o periodo', () => assert.ok(contract.tablas.clases_programadas.indices.flatMap((i) => i.columnas).every((name) => !['grupo_id', 'periodo_academico_id'].includes(name))));
test('22 clases son inmutables y sin estado propio', () => {
    const names = contract.tablas.clases_programadas.columnas.map((item) => item.nombre);
    for (const forbidden of ['activo', 'actualizado_en']) assert.equal(names.includes(forbidden), false);
});
test('23 no desnormaliza nombres, correos ni claves', () => assert.doesNotMatch(normalized, /materia_clave|docente_correo|aula_clave|nombre_docente/));
test('24 usa InnoDB, utf8mb4 y collation contractual', () => {
    const table = contract.tablas.clases_programadas;
    assert.deepEqual([table.engine, table.charset, table.collation], ['innodb', 'utf8mb4', 'utf8mb4_0900_ai_ci']);
});
test('25 contrato declara tabla inicialmente vacía y preservación', () => {
    assert.equal(contract.conteoInicial, 0);
    assert.deepEqual(contract.tablasPreservadas, ['versiones_horario', 'materias', 'usuarios', 'aulas']);
    assert.doesNotMatch(normalized, /\bvalues\s*\(/);
});
test('26 checksums SQL y contrato coinciden', () => {
    assert.equal(manifestApi.calcularChecksumCanonico(sqlPath), entry.checksumSha256);
    assert.equal(manifestApi.calcularChecksumCanonico(path.join(manifestApi.PROJECT_ROOT, entry.execution.postconditionContract)), entry.execution.postconditionChecksumSha256);
});
test('27 020 está ACTIVE, depende de 019 y 021 ya tiene su propio contrato ACTIVE', () => {
    assert.equal(entry.estado, 'ACTIVE');
    assert.deepEqual(entry.execution.dependsOn, [19]);
    assert.equal(manifest.migraciones.find((item) => item.version === 21).estado, 'ACTIVE');
});
test('28 precondición es válida cuando la tabla está ausente', () => assert.equal(apply.validarPrecondiciones(snapshotBefore020(), entry), true));
test('29 estructura existente no registrada se rechaza', () => {
    const snapshot = snapshotBefore020();
    snapshot.tablas.clases_programadas = tableFromContract(contract.tablas.clases_programadas);
    assert.throws(() => apply.construirPlan(manifest, snapshot), (error) => error.code === 'UNREGISTERED_PARTIAL_STRUCTURE');
});
test('30 aplicada y registrada deja únicamente 021 pendiente', () => {
    const snapshot = snapshotBefore020();
    snapshot.tablas.clases_programadas = tableFromContract(contract.tablas.clases_programadas);
    snapshot.controlRows.push(appliedRow(entry));
    assert.deepEqual(apply.construirPlan(manifest, snapshot).map((item) => item.entrada.version), [21]);
});
test('31 el contrato rechaza grupo_id o periodo_academico_id añadidos', () => {
    for (const forbidden of ['grupo_id', 'periodo_academico_id']) {
        const snapshot = { tablas: { clases_programadas: tableFromContract(contract.tablas.clases_programadas) } };
        snapshot.tablas.clases_programadas.columnas[forbidden] = { tipo: 'int unsigned', unsigned: true, nullable: false };
        assert.throws(() => apply.validarPostcondicion(snapshot, contract), (error) => error.code === 'POSTCONDITION_MISMATCH');
    }
});
