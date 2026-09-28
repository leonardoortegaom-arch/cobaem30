'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const apply = require('../scripts/migrationApply');
const manifestApi = require('../scripts/migrationManifest');
const preflight = require('../scripts/migrationPreflight');

const manifest = manifestApi.cargarManifiesto();
const entry = manifest.migraciones.find((item) => item.version === 23);
const contract = apply.cargarContrato(entry);
const descriptor = preflight.cargarDescriptor();
const sqlPath = path.join(manifestApi.MIGRATIONS_DIR, entry.archivo);
const sql = fs.readFileSync(sqlPath, 'utf8');

const rejected = {
    clave: 'RECHAZADA', nombre: 'Rechazada',
    descripcion: 'La evidencia requiere correcciones antes de considerarse realizada.', orden: 6, activo: 1
};

function controlRows(through = 22) {
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
            .concat(spec.indicesUnicos.map((index) => ({ nombre: 'uq', unique: true, columnas: index.columnas })))
            .concat(spec.indices.map((index) => ({ nombre: 'idx', unique: false, columnas: index.columnas }))),
        foreignKeys: structuredClone(spec.foreignKeys),
        checks: spec.checks.map((check) => check.fragmentos.join(' ').replace(/,\s+/g, ',')),
        checkConstraints: []
    };
}

function snapshot({ applied = false, missingTable = false, missingCompletionCheck = false,
    unexpectedCompletionCheck = false, corruptStructure = false } = {}) {
    const result = preflight.crearSnapshotCompatible(descriptor, {
        control: 'complete', controlRows: controlRows(applied ? 23 : 22),
        filasCatalogo: { estados_actividad_orientacion: [rejected] }
    });
    for (const version of [15, 16, 17, 18, 19, 20, 21]) {
        const current = apply.cargarContrato(manifest.migraciones.find((item) => item.version === version));
        for (const [name, spec] of Object.entries(current.tablas)) result.tablas[name] = tableFromContract(spec);
    }
    const table = result.tablas.actividades_orientacion;
    table.checkConstraints = [
        { nombre: 'chk_actividades_fecha_limite', clausula: '((fecha_limite is null) or (fecha_limite >= fecha_asignacion))' },
        { nombre: 'chk_actividades_fecha_realizacion', clausula: unexpectedCompletionCheck
            ? '((fecha_realizacion is null) or (fecha_realizacion > fecha_asignacion))'
            : '((fecha_realizacion is null) or (fecha_realizacion >= fecha_asignacion))' }
    ];
    if (applied || missingCompletionCheck) {
        table.checks = table.checks.filter((value) => !value.includes('fecha_realizacion'));
        table.checkConstraints = table.checkConstraints.filter((value) => value.nombre !== 'chk_actividades_fecha_realizacion');
    }
    if (corruptStructure) delete table.columnas.fecha_realizacion;
    if (missingTable) delete result.tablas.actividades_orientacion;
    return result;
}

test('01 archivo, contrato y checksums de 023 son válidos', () => {
    assert.ok(fs.statSync(sqlPath).isFile());
    assert.equal(entry.estado, 'ACTIVE');
    assert.equal(contract.migracion, 23);
    assert.equal(manifestApi.calcularChecksumCanonico(sqlPath), entry.checksumSha256);
    assert.equal(manifestApi.calcularChecksumCanonico(path.join(manifestApi.PROJECT_ROOT, entry.execution.postconditionContract)), entry.execution.postconditionChecksumSha256);
});

test('02 contiene exactamente un DROP_CHECK cerrado', () => {
    const statements = apply.validarSqlMigracion(entry);
    assert.deepEqual(statements.map(({ operation, target, constraint }) => ({ operation, target, constraint })), [{
        operation: 'DROP_CHECK', target: 'actividades_orientacion', constraint: 'chk_actividades_fecha_realizacion'
    }]);
    assert.equal((sql.match(/\bALTER\s+TABLE\b/gi) || []).length, 1);
});

test('03 solo elimina el CHECK de realización y no contiene otras operaciones', () => {
    assert.match(sql, /DROP\s+CHECK\s+chk_actividades_fecha_realizacion/i);
    assert.doesNotMatch(sql, /chk_actividades_fecha_limite/i);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|CREATE|DROP\s+TABLE|TRUNCATE)\b/i);
});

test('04 023 depende exclusivamente de 022 y es la última ACTIVE', () => {
    assert.deepEqual(entry.execution.dependsOn, [22]);
    assert.equal(manifest.migraciones.at(-1).version, 23);
    assert.equal(manifest.migraciones.slice(15).every((item) => item.estado === 'ACTIVE'), true);
});

test('05 precondición acepta exclusivamente la estructura heredada exacta', () => {
    assert.equal(apply.validarPrecondiciones(snapshot(), entry), true);
});

test('06 rechaza tabla ausente', () => {
    assert.throws(() => apply.validarPrecondiciones(snapshot({ missingTable: true }), entry));
});

test('07 rechaza CHECK de realización ausente antes de aplicar', () => {
    assert.throws(() => apply.validarPrecondiciones(snapshot({ missingCompletionCheck: true }), entry));
});

test('08 rechaza expresión heredada inesperada', () => {
    assert.throws(() => apply.validarPrecondiciones(snapshot({ unexpectedCompletionCheck: true }), entry));
});

test('09 rechaza si falta 022', () => {
    const current = snapshot();
    current.controlRows = current.controlRows.filter((row) => Number(row.version) !== 22);
    assert.throws(() => apply.validarPrecondiciones(current, entry));
});

test('10 rechaza estructura parcial o inconsistente', () => {
    assert.throws(() => apply.validarPrecondiciones(snapshot({ corruptStructure: true }), entry));
});

test('11 postcondición exige ausencia de realización y preserva límite', () => {
    assert.equal(apply.validarPostcondicion(snapshot({ applied: true }), contract), true);
    assert.throws(() => apply.validarPostcondicion(snapshot(), contract));
    const broken = snapshot({ applied: true });
    broken.tablas.actividades_orientacion.checkConstraints = [];
    broken.tablas.actividades_orientacion.checks = [];
    assert.throws(() => apply.validarPostcondicion(broken, contract));
});

test('12 composición exige el CHECK antes de 023 y su ausencia después', () => {
    const before = preflight.compararSnapshotConDescriptor(snapshot(), descriptor, manifest);
    assert.equal(before.clasificacion, 'BASELINE_V008_COMPLETE', JSON.stringify(before.reglas.filter((rule) => !rule.ok)));
    const after = preflight.compararSnapshotConDescriptor(snapshot({ applied: true }), descriptor, manifest);
    assert.equal(after.clasificacion, 'MIGRATIONS_CURRENT');
    assert.equal(after.fallidas, 0);
});

test('13 estructura no registrada después del ALTER se rechaza', () => {
    assert.throws(() => apply.construirPlan(manifest, snapshot({ missingCompletionCheck: true })));
});

test('14 aplicada y registrada deja de estar pendiente', () => {
    assert.deepEqual(apply.construirPlan(manifest, snapshot({ applied: true })), []);
});

test('15 CURRENT_DATE se conserva y no se sustituye por la fecha programada', () => {
    const model = fs.readFileSync(path.join(manifestApi.PROJECT_ROOT, 'models', 'actividadOrientacionModel.js'), 'utf8');
    assert.match(model, /fecha_realizacion\s*=\s*CURRENT_DATE\(\)/);
    assert.doesNotMatch(model, /fecha_realizacion\s*=\s*fecha_asignacion/i);
    assert.equal(contract.restriccionesCheckAusentes[0].nombre, 'chk_actividades_fecha_realizacion');
});

test('16 clasificador rechaza cualquier ALTER diferente', () => {
    const declared = entry.execution.statements[0];
    for (const candidate of [
        'ALTER TABLE actividades_orientacion DROP CHECK chk_actividades_fecha_limite',
        'ALTER TABLE actividades_orientacion ADD COLUMN x INT',
        'ALTER TABLE otra DROP CHECK chk_actividades_fecha_realizacion',
        'ALTER TABLE actividades_orientacion DROP CHECK chk_actividades_fecha_realizacion, DROP COLUMN titulo'
    ]) assert.throws(() => apply.clasificarSentenciaDeclarada(candidate, declared));
});

test('17 dry-run selecciona únicamente 023 y no escribe', async () => {
    const calls = []; const output = [];
    const connection = { async execute(query) { calls.push(query); return [[]]; }, release() {} };
    const pool = { async getConnection() { return connection; }, async end() {} };
    const plan = await apply.ejecutarDryRun({ log: (line) => output.push(line) }, { pool, manifest, snapshot: async () => snapshot() });
    assert.deepEqual(plan.map((item) => item.entrada.version), [23]);
    assert.match(output.join('\n'), /DROP_CHECK actividades_orientacion/);
    assert.equal(calls.some((query) => /\b(ALTER|INSERT|UPDATE|DELETE|CREATE|DROP)\b/i.test(query)), false);
});

test('18 execute-preflight futuro exige ALTER sin ejecutar escrituras', async () => {
    const source = fs.readFileSync(path.join(manifestApi.PROJECT_ROOT, 'scripts', 'migrationApply.js'), 'utf8');
    assert.match(source, /soloDropCheck[\s\S]+\['SELECT', 'ALTER', 'INSERT'\]/);
});
