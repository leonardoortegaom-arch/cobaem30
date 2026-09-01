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
    validarSqlLectura,
    crearSnapshotCompatible,
    crearTablaControlCompatible,
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
        .filter((item) => item.version >= 1 && item.version <= 8)
        .map((item) => ({
            version: item.version,
            archivo: item.archivo,
            checksum_sha256: item.checksumSha256,
            tipo_registro: 'BASELINE',
            aplicada_en: new Date('2026-01-01T00:00:00Z')
        }));
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
