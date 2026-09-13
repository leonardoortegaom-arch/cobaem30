'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
    QUERIES,
    cargarDescriptor,
    validarDescriptor,
    normalizarClausula,
    normalizarExpresionGenerada,
    validarSqlLectura,
    crearSnapshotCompatible,
    crearTablaControlCompatible,
    analizarFilasControl,
    componerContratosAplicados,
    compararSnapshotConDescriptor,
    ejecutarConPool,
    ejecutarCli
} = require('../scripts/migrationPreflight');
const { cargarManifiesto } = require('../scripts/migrationManifest');

const descriptor = cargarDescriptor();
const manifiesto = cargarManifiesto();

function clonar(valor) {
    return JSON.parse(JSON.stringify(valor));
}

function comparar(snapshot) {
    return compararSnapshotConDescriptor(snapshot, descriptor, manifiesto);
}

function filasBaseline() {
    return manifiesto.migraciones
        .filter((item) => item.version >= 0 && item.version <= 8)
        .map((item) => ({
            version: item.version,
            archivo: item.archivo,
            checksum_sha256: item.checksumSha256,
            tipo_registro: item.version === 0 ? 'EJECUTADA' : 'BASELINE',
            aplicada_en: new Date('2026-01-01T00:00:00Z')
        }));
}

function tablaDesdeContrato(contrato) {
    const columnas = Object.fromEntries(contrato.columnas.map((columna, ordinal) => [columna.nombre, {
        tipo: columna.tipo.toLowerCase(), unsigned: columna.unsigned, nullable: columna.nullable,
        default: Object.hasOwn(columna, 'default') ? String(columna.default).toLowerCase() : null,
        extra: String(columna.extra || '').toLowerCase(),
        generationExpression: normalizarExpresionGenerada(columna.generationExpression), ordinal: ordinal + 1
    }]));
    return {
        engine: contrato.engine, charset: contrato.charset, collation: contrato.collation, columnas,
        indices: [{ nombre: 'PRIMARY', unique: true, columnas: contrato.primaryKey }]
            .concat(contrato.indicesUnicos.map((indice, i) => ({ nombre: `uq_contract_${i}`, unique: true, columnas: indice.columnas })))
            .concat(contrato.indices.map((indice, i) => ({ nombre: `idx_contract_${i}`, unique: false, columnas: indice.columnas }))),
        foreignKeys: clonar(contrato.foreignKeys), checks: contrato.checks.map((check) => check.fragmentos.join(' '))
    };
}

function aplicarContrato(snapshot, version) {
    const entrada = manifiesto.migraciones.find((item) => item.version === version);
    const contrato = JSON.parse(fs.readFileSync(path.join(__dirname, '..', entrada.execution.postconditionContract), 'utf8'));
    for (const [tabla, definicion] of Object.entries(contrato.tablas)) snapshot.tablas[tabla] = tablaDesdeContrato(definicion);
    snapshot.controlRows.push(filaAplicada(version));
    return snapshot;
}

function snapshotTras016() {
    const snapshot = crearSnapshotCompatible(descriptor, { control: 'complete', controlRows: filasBaseline() });
    aplicarContrato(snapshot, 15);
    aplicarContrato(snapshot, 16);
    return snapshot;
}

function poolSimulado({ fallaConexion = null } = {}) {
    const estado = { liberado: false, cerrado: false };
    const conexion = { release() { estado.liberado = true; } };
    return {
        estado,
        async getConnection() {
            if (fallaConexion) throw fallaConexion;
            return conexion;
        },
        async end() { estado.cerrado = true; }
    };
}

function salidaCapturada() {
    const lineas = [];
    return { lineas, salida: { log: (m) => lineas.push(String(m)), error: (m) => lineas.push(String(m)) } };
}

test('01 descriptor JSON valido', () => assert.equal(validarDescriptor(descriptor), true));
test('02 descriptor cubre 001-008', () => assert.deepEqual(descriptor.migracionesCubiertas, ['001','002','003','004','005','006','007','008']));
test('03 descriptor contiene 14 tablas', () => assert.equal(Object.keys(descriptor.tablas).length, 14));
test('04 descriptor no contiene valores personales', () => {
    const texto = fs.readFileSync(path.join(__dirname, '..', 'database', 'baselines', 'v008-schema.json'), 'utf8');
    assert.doesNotMatch(texto, /matricula\s*"\s*:\s*"\d|correo\s*"\s*:\s*"[^"\n]+@|password_hash\s*"\s*:\s*"\$/i);
});
test('05 declara tablas prohibidas', () => assert.deepEqual(descriptor.tablasProhibidas, ['grupo_horarios', 'docente_horarios']));
test('06 declara columnas prohibidas', () => assert.deepEqual(descriptor.columnasProhibidas.grupos, ['docente_id','orientador_id','generacion','periodo_semestre','generacion_id','periodo_academico_id']));
test('07 base compatible sin control', () => assert.equal(comparar(crearSnapshotCompatible(descriptor)).fallidas, 0));
test('08 base compatible con control vacio', () => assert.equal(comparar(crearSnapshotCompatible(descriptor, { control: 'empty' })).estadoControl, 'CONTROL_EMPTY'));
test('09 baseline completo valido', () => {
    const s = crearSnapshotCompatible(descriptor, { control: 'complete', controlRows: filasBaseline() });
    assert.equal(comparar(s).clasificacion, 'BASELINE_V008_COMPLETE');
});
test('10 baseline parcial rechazado', () => {
    const s = crearSnapshotCompatible(descriptor, { control: 'complete', controlRows: filasBaseline().slice(0, 7) });
    assert.ok(comparar(s).fallidas > 0);
});
test('11 checksum registrado distinto rechazado', () => {
    const filas = filasBaseline(); filas[0].checksum_sha256 = '0'.repeat(64);
    assert.ok(comparar(crearSnapshotCompatible(descriptor, { control: 'complete', controlRows: filas })).fallidas > 0);
});
test('12 tabla requerida ausente', () => { const s=crearSnapshotCompatible(descriptor); delete s.tablas.grupos; assert.ok(comparar(s).fallidas>0); });
test('13 columna requerida ausente', () => { const s=crearSnapshotCompatible(descriptor); delete s.tablas.grupos.columnas.clave; assert.ok(comparar(s).fallidas>0); });
test('14 unsigned incompatible', () => { const s=crearSnapshotCompatible(descriptor); s.tablas.grupos.columnas.id.unsigned=false; assert.ok(comparar(s).fallidas>0); });
test('15 nullability incompatible', () => { const s=crearSnapshotCompatible(descriptor); s.tablas.grupos.columnas.clave.nullable=true; assert.ok(comparar(s).fallidas>0); });
test('16 PK ausente', () => { const s=crearSnapshotCompatible(descriptor); s.tablas.grupos.indices=s.tablas.grupos.indices.filter(i=>i.nombre!=='PRIMARY'); assert.ok(comparar(s).fallidas>0); });
test('17 indice requerido ausente', () => { const s=crearSnapshotCompatible(descriptor); s.tablas.grupos.indices=s.tablas.grupos.indices.filter(i=>i.columnas.join(',')!=='semestre'); assert.ok(comparar(s).fallidas>0); });
test('18 FK requerida ausente', () => { const s=crearSnapshotCompatible(descriptor); s.tablas.grupos.foreignKeys=[]; assert.ok(comparar(s).fallidas>0); });
test('19 ON DELETE incompatible', () => { const s=crearSnapshotCompatible(descriptor); s.tablas.grupos.foreignKeys[0].onDelete='CASCADE'; assert.ok(comparar(s).fallidas>0); });
test('20 CHECK requerido ausente', () => { const s=crearSnapshotCompatible(descriptor); s.tablas.grupos.checks=[]; assert.ok(comparar(s).fallidas>0); });
test('21 ENGINE incompatible', () => { const s=crearSnapshotCompatible(descriptor); s.tablas.grupos.engine='myisam'; assert.ok(comparar(s).fallidas>0); });
test('22 collation incompatible', () => { const s=crearSnapshotCompatible(descriptor); s.tablas.grupos.collation='utf8mb4_bin'; assert.ok(comparar(s).fallidas>0); });
test('23 tabla 013 presente rechazada', () => { const s=crearSnapshotCompatible(descriptor); s.tablas.grupo_horarios={}; assert.ok(comparar(s).fallidas>0); });
test('24 tabla 014 presente rechazada', () => { const s=crearSnapshotCompatible(descriptor); s.tablas.docente_horarios={}; assert.ok(comparar(s).fallidas>0); });
test('25 columna 009 presente rechazada', () => { const s=crearSnapshotCompatible(descriptor); s.tablas.grupos.columnas.docente_id={}; assert.ok(comparar(s).fallidas>0); });
test('26 columna 011 presente rechazada', () => { const s=crearSnapshotCompatible(descriptor); s.tablas.grupos.columnas.generacion={}; assert.ok(comparar(s).fallidas>0); });
test('27 columna 012 presente rechazada', () => { const s=crearSnapshotCompatible(descriptor); s.tablas.grupos.columnas.periodo_semestre={}; assert.ok(comparar(s).fallidas>0); });
test('28 catalogo minimo incompleto', () => { const s=crearSnapshotCompatible(descriptor); s.catalogos.roles=[]; assert.ok(comparar(s).fallidas>0); });
test('29 clave adicional legitima no falla', () => { const s=crearSnapshotCompatible(descriptor); s.catalogos.roles.push('FUTURO'); assert.equal(comparar(s).fallidas,0); });
test('30 descriptor no exige conteos personales', () => assert.doesNotMatch(JSON.stringify(descriptor), /conteo|totalUsuarios|totalAlumnos|totalReportes/i));
test('31 todas las consultas son SELECT o WITH', () => Object.values(QUERIES).forEach((sql) => assert.equal(validarSqlLectura(sql), true)));
test('32 escritura rechazada por barrera', () => assert.throws(() => validarSqlLectura('UPDATE grupos SET activo = 1'), /barrera/i));
test('33 multiples sentencias rechazadas', () => assert.throws(() => validarSqlLectura('SELECT 1; SELECT 2'), /múltiples|mÃºltiples/i));
test('34 require no carga conexion', () => {
    const ruta = path.resolve(__dirname, '..', 'config', 'database.js');
    assert.equal(Boolean(require.cache[ruta]), false);
});
test('35 comando desconocido rechazado', async () => assert.equal(await ejecutarCli(['apply'], salidaCapturada().salida), 2));
test('36 comandos de escritura no existen', async () => {
    for (const comando of ['baseline-v008','apply','up','migrate','rollback','down','repair','mark','bootstrap']) {
        assert.equal(await ejecutarCli([comando], salidaCapturada().salida), 2);
    }
});
test('37 errores no exponen SQL', async () => {
    const captura=salidaCapturada(); const error=Object.assign(new Error('SELECT secreto'),{code:'ER_ACCESS_DENIED_ERROR'});
    assert.equal(await ejecutarCli(['status'], captura.salida, { pool: poolSimulado({fallaConexion:error}) }),2);
    assert.doesNotMatch(captura.lineas.join('\n'), /SELECT secreto/);
});
test('38 pool cierra tras exito', async () => { const p=poolSimulado(); await ejecutarConPool(p, async()=>true); assert.deepEqual(p.estado,{liberado:true,cerrado:true}); });
test('39 pool cierra tras fallo', async () => { const p=poolSimulado(); await assert.rejects(()=>ejecutarConPool(p,async()=>{throw new Error('x');})); assert.deepEqual(p.estado,{liberado:true,cerrado:true}); });
test('40 codigos 0 1 2 correctos', async () => {
    const compatible=poolSimulado();
    assert.equal(await ejecutarCli(['baseline-v008-check'], salidaCapturada().salida, {pool:compatible, obtenerSnapshot:async()=>crearSnapshotCompatible(descriptor)}),0);
    const deriva=crearSnapshotCompatible(descriptor); delete deriva.tablas.grupos;
    assert.equal(await ejecutarCli(['baseline-v008-check'], salidaCapturada().salida, {pool:poolSimulado(), obtenerSnapshot:async()=>deriva}),1);
    assert.equal(await ejecutarCli(['status'], salidaCapturada().salida, {pool:poolSimulado({fallaConexion:Object.assign(new Error('x'),{code:'ECONNREFUSED'})})}),2);
});
test('41 reescritura equivalente de DATEDIFF por MySQL no genera deriva', () => {
    const clausula = normalizarClausula('((periodo_desde <= periodo_hasta) and ((to_days(periodo_hasta) - to_days(periodo_desde)) <= 365))');
    assert.match(clausula, /datediff\(periodo_hasta, periodo_desde\)/);
});

function filaAplicada(version, manifiestoUsado = manifiesto) {
    const entrada = manifiestoUsado.migraciones.find((item) => item.version === version);
    return { version, archivo: entrada.archivo, checksum_sha256: entrada.checksumSha256,
        tipo_registro: 'EJECUTADA', aplicada_en: new Date('2026-01-01T00:00:00Z') };
}

test('42 baseline válido con ACTIVE pendiente conserva BASELINE_V008_COMPLETE', () => {
    const resultado = comparar(crearSnapshotCompatible(descriptor, { control: 'complete', controlRows: filasBaseline() }));
    assert.equal(resultado.estadoControl, 'BASELINE_V008_COMPLETE');
    assert.equal(resultado.fallidas, 0);
});
test('43 baseline válido con 015 aplicada produce MIGRATIONS_CURRENT', () => {
    const snapshot = crearSnapshotCompatible(descriptor, { control: 'complete', controlRows: filasBaseline() });
    aplicarContrato(snapshot, 15);
    const resultado = comparar(snapshot);
    assert.equal(resultado.estadoControl, 'BASELINE_V008_COMPLETE');
    assert.equal(resultado.clasificacion, 'BASELINE_V008_COMPLETE');
    assert.equal(resultado.fallidas, 0);
});
test('44 checksum incorrecto de 015 se rechaza', () => {
    const fila = filaAplicada(15); fila.checksum_sha256 = '0'.repeat(64);
    assert.throws(() => analizarFilasControl(manifiesto, [...filasBaseline(), fila]), (e) => e.code === 'APPLIED_MIGRATION_INVALID');
});
test('45 estado almacenado incorrecto de 015 se rechaza', () => {
    const fila = filaAplicada(15); fila.tipo_registro = 'BASELINE';
    assert.throws(() => analizarFilasControl(manifiesto, [...filasBaseline(), fila]), (e) => e.code === 'APPLIED_MIGRATION_INVALID');
});
test('46 versión desconocida registrada se rechaza', () => {
    assert.throws(() => analizarFilasControl(manifiesto, [...filasBaseline(), { ...filaAplicada(15), version: 999 }]), (e) => e.code === 'UNKNOWN_APPLIED_VERSION');
});
for (const [numero, version, estado] of [[47,18,'PLANNED'],[48,9,'SUPERSEDED_NOT_APPLIED'],[49,10,'RESERVED_MISSING']]) {
    test(`${numero} registro ${estado} se rechaza`, () => {
        const entrada = manifiesto.migraciones.find((item) => item.version === version);
        const fila = { version, archivo: entrada.archivo, checksum_sha256: entrada.checksumSha256, tipo_registro: 'EJECUTADA' };
        assert.throws(() => analizarFilasControl(manifiesto, [...filasBaseline(), fila]), (e) => e.code === 'NON_EXECUTABLE_RECORDED');
    });
}
test('50 baseline incompleto no es compensado por 015', () => {
    assert.throws(() => analizarFilasControl(manifiesto, [...filasBaseline().slice(0, 8), filaAplicada(15)]), (e) => e.code === 'BASELINE_PARTIAL');
});
test('51 secuencia ACTIVE con salto se rechaza', () => {
    const futuro = clonar(manifiesto);
    const e16 = futuro.migraciones.find((item) => item.version === 16); Object.assign(e16, { estado: 'ACTIVE', archivo: '016.sql', checksumSha256: '1'.repeat(64) });
    const e17 = futuro.migraciones.find((item) => item.version === 17); Object.assign(e17, { estado: 'ACTIVE', archivo: '017.sql', checksumSha256: '2'.repeat(64) });
    assert.throws(() => analizarFilasControl(futuro, [...filasBaseline(), filaAplicada(15), filaAplicada(17, futuro)]), (e) => e.code === 'ACTIVE_PREDECESSOR_MISSING');
});
test('52 varias ACTIVE posteriores válidas son compatibles', () => {
    const futuro = clonar(manifiesto);
    for (const [version, checksum] of [[16,'1'],[17,'2']]) {
        Object.assign(futuro.migraciones.find((item) => item.version === version), { estado: 'ACTIVE', archivo: `${version}.sql`, checksumSha256: checksum.repeat(64) });
    }
    const filas = [...filasBaseline(), filaAplicada(15), filaAplicada(16, futuro), filaAplicada(17, futuro)];
    assert.equal(analizarFilasControl(futuro, filas).estado, 'MIGRATIONS_CURRENT');
});
test('53 baseline sin 016 mantiene prohibida generacion_id', () => {
    const snapshot = crearSnapshotCompatible(descriptor, { control: 'complete', controlRows: filasBaseline() });
    snapshot.tablas.grupos.columnas.generacion_id = { tipo: 'int unsigned', unsigned: true, nullable: true };
    assert.equal(comparar(snapshot).clasificacion, 'SCHEMA_DRIFT_DETECTED');
});
test('54 baseline sin 016 mantiene prohibida periodo_academico_id', () => {
    const snapshot = crearSnapshotCompatible(descriptor, { control: 'complete', controlRows: filasBaseline() });
    snapshot.tablas.grupos.columnas.periodo_academico_id = { tipo: 'int unsigned', unsigned: true, nullable: true };
    assert.equal(comparar(snapshot).clasificacion, 'SCHEMA_DRIFT_DETECTED');
});
test('55 contratos 015 y 016 aplicados componen un esquema valido con 017 pendiente', () => assert.equal(comparar(snapshotTras016()).clasificacion, 'BASELINE_V008_COMPLETE'));
for (const [numero, mutar] of [
    [56, (s) => { delete s.tablas.grupos.columnas.generacion_id; }],
    [57, (s) => { s.tablas.grupos.columnas.generacion_id.tipo = 'bigint unsigned'; }],
    [58, (s) => { s.tablas.grupos.columnas.generacion_id.nullable = false; }],
    [59, (s) => { s.tablas.grupos.indices = s.tablas.grupos.indices.filter((i) => i.columnas[0] !== 'generacion_id'); }],
    [60, (s) => { s.tablas.grupos.foreignKeys = s.tablas.grupos.foreignKeys.filter((fk) => fk.columnas[0] !== 'generacion_id'); }],
    [61, (s) => { s.tablas.grupos.foreignKeys.find((fk) => fk.columnas[0] === 'generacion_id').onDelete = 'CASCADE'; }],
    [62, (s) => { s.tablas.grupos.foreignKeys.find((fk) => fk.columnas[0] === 'generacion_id').onUpdate = 'RESTRICT'; }]
]) test(`${numero} deriva de postcondicion 016 es rechazada`, () => { const snapshot = snapshotTras016(); mutar(snapshot); assert.equal(comparar(snapshot).clasificacion, 'SCHEMA_DRIFT_DETECTED'); });
test('63 fila 016 con checksum incorrecto es inconsistente', () => { const s = snapshotTras016(); s.controlRows.find((r) => r.version === 16).checksum_sha256 = '0'.repeat(64); assert.equal(comparar(s).clasificacion, 'SCHEMA_DRIFT_DETECTED'); });
test('64 contrato con checksum incorrecto es inconsistente', () => { const m = clonar(manifiesto); m.migraciones.find((e) => e.version === 16).execution.postconditionChecksumSha256 = '0'.repeat(64); assert.equal(compararSnapshotConDescriptor(snapshotTras016(), descriptor, m).clasificacion, 'SCHEMA_DRIFT_DETECTED'); });
test('65 ACTIVE pendiente no autoriza columnas', () => { const s = crearSnapshotCompatible(descriptor, { control: 'complete', controlRows: filasBaseline() }); s.tablas.grupos.columnas.generacion_id = { tipo: 'int unsigned', unsigned: true, nullable: true }; assert.equal(comparar(s).clasificacion, 'SCHEMA_DRIFT_DETECTED'); });
test('66 contratos ACTIVE aplicados se componen en orden', () => assert.deepEqual(componerContratosAplicados(manifiesto, snapshotTras016().controlRows).contratos.map((item) => item.entrada.version), [15, 16]));
test('67 contrato 017 aplicado compone columnas generadas', () => {
    const snapshot = snapshotTras016(); aplicarContrato(snapshot, 17);
    assert.equal(comparar(snapshot).clasificacion, 'MIGRATIONS_CURRENT');
});
test('68 expresión generada distinta en 017 produce deriva', () => {
    const snapshot = snapshotTras016(); aplicarContrato(snapshot, 17);
    snapshot.tablas.asignaciones_orientador_grupo.columnas.grupo_vigente_id.generationExpression = 'grupo_id';
    assert.equal(comparar(snapshot).clasificacion, 'SCHEMA_DRIFT_DETECTED');
});
