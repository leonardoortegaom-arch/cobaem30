'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
    cargarManifiesto,
    calcularChecksumCanonico
} = require('../scripts/migrationManifest');
const {
    INSERT_BASELINE_SQL,
    parsearArgumentos,
    validarOpcionesEjecucion,
    verificarRespaldo,
    construirPlanBaseline,
    compararRegistrosBaseline,
    validarEstadoPrevio,
    validarBootstrapSql,
    registrarBaselineTransaccional,
    ejecutarDryRun,
    ejecutarBaselineReal,
    ejecutarCli
} = require('../scripts/migrationBaseline');

const manifiesto = cargarManifiesto();

function entornoValido() {
    return {
        MIGRATION_DB_ALLOW_WRITES: 'BASELINE_V008_ONLY', MIGRATION_DB_HOST: 'local',
        MIGRATION_DB_PORT: '3306', MIGRATION_DB_NAME: 'db', MIGRATION_DB_USER: 'user',
        MIGRATION_DB_PASSWORD: 'secret'
    };
}

function crearRespaldo(contenido = 'backup') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cobaem-baseline-'));
    const file = path.join(dir, 'backup.sql');
    fs.writeFileSync(file, contenido);
    return { dir, file, hash: crypto.createHash('sha256').update(contenido).digest('hex') };
}

function opcionesValidas(backup) {
    return parsearArgumentos(['baseline-v008','--execute','--confirm=BASELINE-V008','--acknowledge-ddl-autocommit',`--backup-file=${backup.file}`,`--backup-sha256=${backup.hash}`]);
}

function poolMock(opciones = {}) {
    const estado = { sql: [], params: [], begin: 0, commit: 0, rollback: 0, release: 0, end: 0 };
    const connection = {
        async execute(sql, params = []) {
            estado.sql.push(sql); estado.params.push(params);
            if (/GET_LOCK/.test(sql)) return [[{ lock_obtenido: opciones.lock === undefined ? 1 : opciones.lock }]];
            if (/RELEASE_LOCK/.test(sql)) return [[{ lock_liberado: 1 }]];
            if (/^INSERT INTO schema_migrations/.test(sql)) {
                if (opciones.failInsertAt && estado.sql.filter((x)=>/^INSERT/.test(x)).length === opciones.failInsertAt) throw new Error('insert fail');
                return [{ affectedRows: 1 }];
            }
            return [{ affectedRows: 0 }];
        },
        async beginTransaction() { estado.begin += 1; },
        async commit() { estado.commit += 1; },
        async rollback() { estado.rollback += 1; },
        release() { estado.release += 1; }
    };
    return { estado, connection, async getConnection(){ return connection; }, async end(){ estado.end += 1; } };
}

function salida() { const lineas=[]; return { lineas, io:{log:(x)=>lineas.push(String(x)),error:(x)=>lineas.push(String(x))} }; }
function estado(nombre) { return { estado:nombre, resultado:{ fallidas:0, clasificacion:'COMPATIBLE_FOR_FUTURE_BASELINE', estadoControl:nombre } }; }

test('01 plan contiene exactamente 000-008',()=>assert.deepEqual(construirPlanBaseline(manifiesto).map(x=>x.version),[0,1,2,3,4,5,6,7,8]));
test('02 000 es EJECUTADA',()=>assert.equal(construirPlanBaseline(manifiesto)[0].tipoRegistro,'EJECUTADA'));
test('03 001-008 son BASELINE',()=>assert.ok(construirPlanBaseline(manifiesto).slice(1).every(x=>x.tipoRegistro==='BASELINE')));
test('04 checksum y archivo vienen del manifiesto',()=>{const p=construirPlanBaseline(manifiesto);assert.equal(p[4].archivo,manifiesto.migraciones[4].archivo);assert.equal(p[4].checksumSha256,manifiesto.migraciones[4].checksumSha256)});
test('05 todos comparten lote UUID',()=>{const p=construirPlanBaseline(manifiesto,{randomUUID:()=> '00000000-0000-4000-8000-000000000000'});assert.equal(new Set(p.map(x=>x.loteEjecucion)).size,1)});
test('06 dry-run no escribe',async()=>{const p=poolMock();await ejecutarDryRun(salida().io,{pool:p,preflight:async()=>estado('BOOTSTRAP_REQUIRED')});assert.equal(p.estado.sql.length,0)});
test('07 dry-run termina con marcador',async()=>{const c=salida();await ejecutarDryRun(c.io,{pool:poolMock(),preflight:async()=>estado('BOOTSTRAP_REQUIRED')});assert.equal(c.lineas.at(-1),'DRY_RUN_ONLY_NO_CHANGES')});
test('08 execute sin confirmacion se rechaza',()=>assert.throws(()=>validarOpcionesEjecucion(parsearArgumentos(['baseline-v008','--execute']),entornoValido())));
test('09 falta acknowledgement se rechaza',()=>{const b=crearRespaldo();const o=opcionesValidas(b);o.flags.delete('--acknowledge-ddl-autocommit');assert.throws(()=>validarOpcionesEjecucion(o,entornoValido()));fs.rmSync(b.dir,{recursive:true})});
test('10 falta respaldo se rechaza',()=>{const b=crearRespaldo();const o=opcionesValidas(b);delete o.valores['--backup-file'];assert.throws(()=>validarOpcionesEjecucion(o,entornoValido()));fs.rmSync(b.dir,{recursive:true})});
test('11 hash mal formado se rechaza',()=>{const b=crearRespaldo();const o=opcionesValidas(b);o.valores['--backup-sha256']='x';assert.throws(()=>validarOpcionesEjecucion(o,entornoValido()));fs.rmSync(b.dir,{recursive:true})});
test('12 hash no coincidente se rechaza',()=>{const b=crearRespaldo();assert.throws(()=>verificarRespaldo(b.file,'0'.repeat(64)));fs.rmSync(b.dir,{recursive:true})});
test('13 archivo vacio se rechaza',()=>{const b=crearRespaldo('');assert.throws(()=>verificarRespaldo(b.file,b.hash));fs.rmSync(b.dir,{recursive:true})});
test('14 directorio se rechaza',()=>{const b=crearRespaldo();assert.throws(()=>verificarRespaldo(b.dir,b.hash));fs.rmSync(b.dir,{recursive:true})});
test('15 falta habilitacion se rechaza',()=>{const b=crearRespaldo();const e=entornoValido();delete e.MIGRATION_DB_ALLOW_WRITES;assert.throws(()=>validarOpcionesEjecucion(opcionesValidas(b),e));fs.rmSync(b.dir,{recursive:true})});
test('16 habilitacion incorrecta se rechaza',()=>{const b=crearRespaldo();const e=entornoValido();e.MIGRATION_DB_ALLOW_WRITES='YES';assert.throws(()=>validarOpcionesEjecucion(opcionesValidas(b),e));fs.rmSync(b.dir,{recursive:true})});
test('17 falta cualquier MIGRATION_DB se rechaza',()=>{const b=crearRespaldo();for(const k of Object.keys(entornoValido()).filter(k=>k.startsWith('MIGRATION_DB_')&&k!=='MIGRATION_DB_ALLOW_WRITES')){const e=entornoValido();delete e[k];assert.throws(()=>validarOpcionesEjecucion(opcionesValidas(b),e))}fs.rmSync(b.dir,{recursive:true})});
test('18 no existe fallback a DB',()=>{const b=crearRespaldo();const e={...entornoValido(),DB_USER:'fallback',DB_PASSWORD:'fallback'};delete e.MIGRATION_DB_USER;assert.throws(()=>validarOpcionesEjecucion(opcionesValidas(b),e));fs.rmSync(b.dir,{recursive:true})});
test('19 password por CLI se rechaza',()=>assert.throws(()=>parsearArgumentos(['baseline-v008','--password=x'])));
test('20 multipleStatements es false',()=>{const b=crearRespaldo();assert.equal(validarOpcionesEjecucion(opcionesValidas(b),entornoValido()).multipleStatements,false);fs.rmSync(b.dir,{recursive:true})});
test('21 lock 0 detiene todo',async()=>{const b=crearRespaldo(),p=poolMock({lock:0});await assert.rejects(()=>ejecutarBaselineReal(opcionesValidas(b),salida().io,{env:entornoValido(),pool:p}));assert.equal(p.estado.begin,0);fs.rmSync(b.dir,{recursive:true})});
test('22 lock NULL detiene todo',async()=>{const b=crearRespaldo(),p=poolMock({lock:null});await assert.rejects(()=>ejecutarBaselineReal(opcionesValidas(b),salida().io,{env:entornoValido(),pool:p}));assert.equal(p.estado.begin,0);fs.rmSync(b.dir,{recursive:true})});
test('23 lock se libera tras exito',async()=>{const b=crearRespaldo(),p=poolMock();await ejecutarBaselineReal(opcionesValidas(b),salida().io,{env:entornoValido(),pool:p,preflight:async()=>estado('REGISTER_REQUIRED'),verificarPosterior:async()=>true});assert.ok(p.estado.sql.some(x=>/RELEASE_LOCK/.test(x)));fs.rmSync(b.dir,{recursive:true})});
test('24 lock se libera tras fallo',async()=>{const b=crearRespaldo(),p=poolMock();await assert.rejects(()=>ejecutarBaselineReal(opcionesValidas(b),salida().io,{env:entornoValido(),pool:p,preflight:async()=>{throw new Error('x')}}));assert.ok(p.estado.sql.some(x=>/RELEASE_LOCK/.test(x)));fs.rmSync(b.dir,{recursive:true})});
test('25 preflight incompatible detiene bootstrap',()=>assert.throws(()=>validarEstadoPrevio({fallidas:1,clasificacion:'SCHEMA_DRIFT_DETECTED'})));
test('26 estado parcial se rechaza',()=>assert.throws(()=>validarEstadoPrevio({fallidas:0,clasificacion:'X',estadoControl:'PARTIAL_OR_INCONSISTENT'})));
test('27 versiones desconocidas se rechazan',()=>assert.throws(()=>validarEstadoPrevio({fallidas:0,clasificacion:'X',estadoControl:'UNKNOWN'})));
test('28 baseline completo es idempotente',async()=>{const b=crearRespaldo(),p=poolMock();const r=await ejecutarBaselineReal(opcionesValidas(b),salida().io,{env:entornoValido(),pool:p,preflight:async()=>estado('ALREADY_REGISTERED')});assert.equal(r.estado,'ALREADY_REGISTERED');assert.equal(p.estado.begin,0);fs.rmSync(b.dir,{recursive:true})});
test('29 bootstrap checksum incorrecto se rechaza',()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'boot-')),f=path.join(d,'x.sql');fs.writeFileSync(f,'CREATE TABLE IF NOT EXISTS schema_migrations (id INT);');assert.throws(()=>validarBootstrapSql(manifiesto,f));fs.rmSync(d,{recursive:true})});
function manifiestoPara(sql, file){const m=JSON.parse(JSON.stringify(manifiesto));m.migraciones[0].checksumSha256=calcularChecksumCanonico(file);return m;}
test('30 bootstrap multiples sentencias se rechaza',()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'boot-')),f=path.join(d,'x.sql');fs.writeFileSync(f,'CREATE TABLE IF NOT EXISTS schema_migrations (id INT); SELECT 1;');assert.throws(()=>validarBootstrapSql(manifiestoPara('',f),f));fs.rmSync(d,{recursive:true})});
test('31 bootstrap con INSERT se rechaza',()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'boot-')),f=path.join(d,'x.sql');fs.writeFileSync(f,'CREATE TABLE IF NOT EXISTS schema_migrations (id INT, x VARCHAR(20) DEFAULT \'INSERT\')');assert.throws(()=>validarBootstrapSql(manifiestoPara('',f),f));fs.rmSync(d,{recursive:true})});
test('32 bootstrap con tabla distinta se rechaza',()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'boot-')),f=path.join(d,'x.sql');fs.writeFileSync(f,'CREATE TABLE IF NOT EXISTS otra (id INT)');assert.throws(()=>validarBootstrapSql(manifiestoPara('',f),f));fs.rmSync(d,{recursive:true})});
test('33 tabla ausente ejecuta bootstrap una vez',async()=>{const b=crearRespaldo(),p=poolMock();await ejecutarBaselineReal(opcionesValidas(b),salida().io,{env:entornoValido(),pool:p,preflight:async()=>estado('BOOTSTRAP_REQUIRED'),preflightPosteriorBootstrap:async()=>estado('REGISTER_REQUIRED'),verificarPosterior:async()=>true});assert.equal(p.estado.sql.filter(x=>/^\s*(?:--[^\n]*\n)*CREATE/i.test(x)).length,1);fs.rmSync(b.dir,{recursive:true})});
test('34 tabla vacia no repite bootstrap',async()=>{const b=crearRespaldo(),p=poolMock();await ejecutarBaselineReal(opcionesValidas(b),salida().io,{env:entornoValido(),pool:p,preflight:async()=>estado('REGISTER_REQUIRED'),verificarPosterior:async()=>true});assert.equal(p.estado.sql.filter(x=>/CREATE TABLE/.test(x)).length,0);fs.rmSync(b.dir,{recursive:true})});
test('35 inserta exactamente nueve filas',async()=>{const p=poolMock();await registrarBaselineTransaccional(p.connection,construirPlanBaseline(manifiesto));assert.equal(p.estado.sql.filter(x=>/^INSERT/.test(x)).length,9)});
test('36 todos los INSERT usan placeholders',()=>assert.match(INSERT_BASELINE_SQL,/VALUES \(\?, \?, \?, \?, \?, \?\)/));
test('37 fallo insercion hace rollback',async()=>{const p=poolMock({failInsertAt:3});await assert.rejects(()=>registrarBaselineTransaccional(p.connection,construirPlanBaseline(manifiesto)));assert.equal(p.estado.rollback,1)});
test('38 rollback no intenta DROP',async()=>{const p=poolMock({failInsertAt:2});await assert.rejects(()=>registrarBaselineTransaccional(p.connection,construirPlanBaseline(manifiesto)));assert.ok(p.estado.sql.every(x=>!/^DROP/i.test(x)))});
test('39 commit solo tras nueve inserts',async()=>{const p=poolMock();await registrarBaselineTransaccional(p.connection,construirPlanBaseline(manifiesto));assert.equal(p.estado.commit,1);assert.equal(p.estado.sql.filter(x=>/^INSERT/.test(x)).length,9)});
test('40 no existe INSERT IGNORE',()=>assert.doesNotMatch(INSERT_BASELINE_SQL,/INSERT\s+IGNORE/i));
test('41 no existe ON DUPLICATE KEY UPDATE',()=>assert.doesNotMatch(INSERT_BASELINE_SQL,/ON\s+DUPLICATE/i));
test('42 verificacion posterior correcta',async()=>{const plan=construirPlanBaseline(manifiesto);const filas=plan.map(x=>({version:x.version,archivo:x.archivo,checksum_sha256:x.checksumSha256,tipo_registro:x.tipoRegistro}));assert.equal(compararRegistrosBaseline(filas,plan),true)});
test('43 verificacion fallida no borra',async()=>{const b=crearRespaldo(),p=poolMock();await assert.rejects(()=>ejecutarBaselineReal(opcionesValidas(b),salida().io,{env:entornoValido(),pool:p,preflight:async()=>estado('REGISTER_REQUIRED'),verificarPosterior:async()=>{throw new Error('x')}}));assert.ok(p.estado.sql.every(x=>!/^DELETE|^DROP/i.test(x)));fs.rmSync(b.dir,{recursive:true})});
test('44 pool cierra tras exito',async()=>{const b=crearRespaldo(),p=poolMock();await ejecutarBaselineReal(opcionesValidas(b),salida().io,{env:entornoValido(),pool:p,preflight:async()=>estado('ALREADY_REGISTERED')});assert.equal(p.estado.end,1);fs.rmSync(b.dir,{recursive:true})});
test('45 pool cierra tras error',async()=>{const b=crearRespaldo(),p=poolMock({lock:0});await assert.rejects(()=>ejecutarBaselineReal(opcionesValidas(b),salida().io,{env:entornoValido(),pool:p}));assert.equal(p.estado.end,1);fs.rmSync(b.dir,{recursive:true})});
test('46 require no carga dotenv ni DB',()=>{assert.equal(Boolean(require.cache[path.resolve(__dirname,'..','config','database.js')]),false)});
test('47 comando desconocido se rechaza',async()=>assert.equal(await ejecutarCli(['apply'],salida().io),2));
test('48 comandos apply up down repair no existen',async()=>{for(const c of ['apply','up','down','repair'])assert.equal(await ejecutarCli([c],salida().io),2)});
test('49 errores no muestran credenciales SQL rutas',async()=>{const c=salida();await ejecutarCli(['baseline-v008','--execute'],c.io);assert.doesNotMatch(c.lineas.join('\n'),/secret|SELECT|INSERT|C:\\/i)});
test('50 ruta real completa funciona simulada',async()=>{const b=crearRespaldo(),p=poolMock();const code=await ejecutarCli(['baseline-v008','--execute','--confirm=BASELINE-V008','--acknowledge-ddl-autocommit',`--backup-file=${b.file}`,`--backup-sha256=${b.hash}`],salida().io,{env:entornoValido(),pool:p,preflight:async()=>estado('REGISTER_REQUIRED'),verificarPosterior:async()=>true});assert.equal(code,0);assert.equal(p.estado.commit,1);fs.rmSync(b.dir,{recursive:true})});
