'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifestApi = require('../scripts/migrationManifest');
const apply = require('../scripts/migrationApply');

const root = manifestApi.PROJECT_ROOT;
const manifest = manifestApi.cargarManifiesto();
const entry = manifest.migraciones.find((item) => item.version === 18);
const sqlPath = path.join(manifestApi.MIGRATIONS_DIR, entry.archivo || '');
const sql = fs.readFileSync(sqlPath, 'utf8');
const contract = apply.cargarContrato(entry);
const normalized = sql.replace(/--[^\r\n]*/g, '').toLowerCase();

test('01 archivo 018 existe y está manifestado', () => assert.equal(fs.existsSync(sqlPath), true));
test('02 contiene exactamente dos CREATE TABLE', () => assert.equal(apply.separarSentenciasSql(sql).length, 2));
test('03 crea materias y aulas en orden', () => assert.deepEqual(apply.validarSqlMigracion(entry).map((x) => x.target), ['materias', 'aulas']));
test('04 no contiene DML', () => {
    for (const statement of apply.separarSentenciasSql(sql)) {
        assert.doesNotMatch(statement, /^\s*(insert|update|delete|replace)\b/i);
    }
});
test('05 no contiene ENUM', () => assert.doesNotMatch(normalized, /\benum\s*\(/));
test('06 no contiene objetos programables', () => assert.doesNotMatch(normalized, /\b(trigger|procedure|function|view|event)\b/));
test('07 no altera tablas existentes', () => assert.doesNotMatch(normalized, /\balter\s+table\b/));
test('08 no contiene datos iniciales inventados', () => assert.doesNotMatch(normalized, /\bvalues\s*\(/));
test('09 IDs son INT UNSIGNED autoincrementales', () => assert.equal((normalized.match(/id int unsigned not null auto_increment/g) || []).length, 2));
test('10 clave es UNIQUE en ambas tablas', () => assert.equal((normalized.match(/unique key uq_(materias|aulas)_clave \(clave\)/g) || []).length, 2));
test('11 clave y nombre rechazan trim vacío', () => {
    assert.equal((normalized.match(/char_length\(trim\(clave\)\) > 0/g) || []).length, 2);
    assert.equal((normalized.match(/char_length\(trim\(nombre\)\) > 0/g) || []).length, 2);
});
test('12 activo tiene default y CHECK 0/1', () => {
    assert.equal((normalized.match(/activo boolean not null default true/g) || []).length, 2);
    assert.equal((normalized.match(/check \(activo in \(0, 1\)\)/g) || []).length, 2);
});
test('13 índices administrativos son activo nombre id', () => {
    assert.match(normalized, /idx_materias_activo_nombre_id \(activo, nombre, id\)/);
    assert.match(normalized, /idx_aulas_activo_nombre_id \(activo, nombre, id\)/);
});
test('14 timestamps siguen la convención', () => {
    assert.equal((normalized.match(/creado_en timestamp not null default current_timestamp/g) || []).length, 2);
    assert.equal((normalized.match(/actualizado_en timestamp not null default current_timestamp\s+on update current_timestamp/g) || []).length, 2);
});
test('15 usa InnoDB utf8mb4 y collation contractual', () => {
    assert.equal((normalized.match(/engine=innodb/g) || []).length, 2);
    assert.equal((normalized.match(/default character set utf8mb4/g) || []).length, 2);
    assert.equal((normalized.match(/collate utf8mb4_0900_ai_ci/g) || []).length, 2);
});
test('16 no existen claves foráneas', () => assert.doesNotMatch(normalized, /foreign key|references/));
test('17 contrato coincide con las dos tablas SQL', () => {
    assert.deepEqual(Object.keys(contract.tablas), ['materias', 'aulas']);
    for (const tabla of Object.values(contract.tablas)) {
        assert.deepEqual(tabla.primaryKey, ['id']);
        assert.deepEqual(tabla.indicesUnicos, [{ columnas: ['clave'] }]);
        assert.deepEqual(tabla.indices, [{ columnas: ['activo', 'nombre', 'id'] }]);
        assert.deepEqual(tabla.foreignKeys, []);
        assert.equal(tabla.columnas.find((c) => c.nombre === 'nombre').tipo, 'varchar(150)');
        assert.equal(tabla.columnas.find((c) => c.nombre === 'descripcion').tipo, 'varchar(500)');
    }
});
test('18 checksums SQL y contrato coinciden', () => {
    assert.equal(manifestApi.calcularChecksumCanonico(sqlPath), entry.checksumSha256);
    assert.equal(manifestApi.calcularChecksumCanonico(path.join(root, entry.execution.postconditionContract)), entry.execution.postconditionChecksumSha256);
});
test('19 018 está ACTIVE con dependencia de 017', () => {
    assert.equal(entry.estado, 'ACTIVE');
    assert.deepEqual(entry.execution.dependsOn, [17]);
});
test('20 019 está ACTIVE y 020 a 021 siguen PLANNED', () => {
    assert.equal(manifest.migraciones.find((x) => x.version === 19).estado, 'ACTIVE');
    for (let version = 20; version <= 21; version += 1) assert.equal(manifest.migraciones.find((x) => x.version === version).estado, 'PLANNED');
});
test('21 precondición válida cuando ambas tablas están ausentes', () => {
    assert.equal(apply.validarPrecondiciones({ tablas: {}, controlRows: [{ version: 17 }] }, entry), true);
});
test('22 materias existente sin aulas se rechaza como parcial', () => {
    assert.throws(() => apply.validarPrecondiciones({ tablas: { materias: {} }, controlRows: [{ version: 17 }] }, entry));
});
test('23 aulas existente sin materias se rechaza como parcial', () => {
    assert.throws(() => apply.validarPrecondiciones({ tablas: { aulas: {} }, controlRows: [{ version: 17 }] }, entry));
});
test('24 completamente aplicada y registrada deja de estar pendiente', () => {
    const rows = manifest.migraciones.filter((x) => x.version <= 8 || (x.estado === 'ACTIVE' && x.version <= 19)).map((x) => ({
        version: x.version, archivo: x.archivo, checksum_sha256: x.checksumSha256,
        tipo_registro: x.version === 0 ? 'EJECUTADA' : x.version <= 8 ? 'BASELINE' : 'EJECUTADA'
    }));
    assert.deepEqual(apply.validarRegistrosAplicados(manifest, rows).pending, []);
});
test('25 fallo en segunda sentencia ocurre antes del registro', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/migrationApply.js'), 'utf8');
    const loop = source.indexOf('for (const [index, statement]');
    const record = source.indexOf('await connection.beginTransaction()', loop);
    const insert = source.indexOf('connection.execute(INSERT_SQL', loop);
    assert.ok(loop >= 0 && loop < record && record < insert);
    assert.match(source.slice(loop, record), /throw error/);
});
