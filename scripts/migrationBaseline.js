'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
    PROJECT_ROOT,
    MIGRATIONS_DIR,
    cargarManifiesto,
    validarArchivosYChecksums,
    calcularChecksumCanonico
} = require('./migrationManifest');
const {
    cargarDescriptor,
    validarDescriptor,
    consultarSnapshot,
    compararSnapshotConDescriptor
} = require('./migrationPreflight');

const BOOTSTRAP_PATH = path.join(MIGRATIONS_DIR, '000_create_schema_migrations.sql');
const LOCK_NAME = 'cobaem30:schema-migrations:baseline-v008';
const LOCK_TIMEOUT_SECONDS = 10;
const INSERT_BASELINE_SQL = `INSERT INTO schema_migrations
    (version, archivo, checksum_sha256, tipo_registro, duracion_ms, lote_ejecucion)
    VALUES (?, ?, ?, ?, ?, ?)`;
const GET_LOCK_SQL = 'SELECT GET_LOCK(?, ?) AS lock_obtenido';
const RELEASE_LOCK_SQL = 'SELECT RELEASE_LOCK(?) AS lock_liberado';
const ALLOWED_COMMANDS = new Set(['baseline-v008', 'help']);
const REQUIRED_MIGRATION_ENV = Object.freeze([
    'MIGRATION_DB_HOST', 'MIGRATION_DB_PORT', 'MIGRATION_DB_NAME',
    'MIGRATION_DB_USER', 'MIGRATION_DB_PASSWORD'
]);

function crearError(message, code = 'BASELINE_ERROR') {
    const error = new Error(message);
    error.name = 'MigrationBaselineError';
    error.code = code;
    return error;
}

function cargarContextoEstatico() {
    const manifiesto = cargarManifiesto();
    validarArchivosYChecksums(manifiesto);
    const descriptor = cargarDescriptor();
    validarDescriptor(descriptor);
    return { manifiesto, descriptor };
}

function parsearArgumentos(argumentos) {
    const resultado = { comando: argumentos[0] || 'help', flags: new Set(), valores: {} };
    for (const argumento of argumentos.slice(1)) {
        if (/password/i.test(argumento)) {
            throw crearError('La contraseña no se acepta mediante argumentos CLI.', 'CLI_PASSWORD_FORBIDDEN');
        }
        if (!argumento.startsWith('--')) {
            throw crearError('Argumento no reconocido.', 'INVALID_ARGUMENT');
        }
        const posicion = argumento.indexOf('=');
        if (posicion === -1) resultado.flags.add(argumento);
        else resultado.valores[argumento.slice(0, posicion)] = argumento.slice(posicion + 1);
    }
    return resultado;
}

function validarOpcionesEjecucion(opciones, entorno = process.env) {
    if (!opciones.flags.has('--execute')) throw crearError('Falta modo de ejecución explícito.', 'EXECUTE_FLAG_REQUIRED');
    if (opciones.valores['--confirm'] !== 'BASELINE-V008') throw crearError('Confirmación de baseline inválida.', 'CONFIRMATION_REQUIRED');
    if (!opciones.flags.has('--acknowledge-ddl-autocommit')) throw crearError('Falta reconocer el autocommit de DDL.', 'DDL_ACK_REQUIRED');
    if (!opciones.valores['--backup-file']) throw crearError('Falta el archivo de respaldo.', 'BACKUP_REQUIRED');
    if (!/^[0-9a-f]{64}$/i.test(opciones.valores['--backup-sha256'] || '')) throw crearError('Hash de respaldo inválido.', 'BACKUP_HASH_INVALID');
    if (entorno.MIGRATION_DB_ALLOW_WRITES !== 'BASELINE_V008_ONLY') throw crearError('La habilitación temporal de escritura no es válida.', 'WRITE_ENABLE_REQUIRED');
    for (const nombre of REQUIRED_MIGRATION_ENV) {
        if (typeof entorno[nombre] !== 'string' || entorno[nombre].length === 0) {
            throw crearError('Configuración administrativa temporal incompleta.', 'MIGRATION_DB_CONFIG_INCOMPLETE');
        }
    }
    return {
        host: entorno.MIGRATION_DB_HOST,
        port: entorno.MIGRATION_DB_PORT,
        database: entorno.MIGRATION_DB_NAME,
        user: entorno.MIGRATION_DB_USER,
        password: entorno.MIGRATION_DB_PASSWORD,
        waitForConnections: true,
        connectionLimit: 1,
        queueLimit: 0,
        multipleStatements: false
    };
}

function verificarRespaldo(rutaRespaldo, checksumEsperado) {
    const ruta = path.resolve(rutaRespaldo || '');
    if (ruta === PROJECT_ROOT) throw crearError('El respaldo no puede ser el directorio del proyecto.', 'BACKUP_INVALID');
    let estadisticas;
    try { estadisticas = fs.lstatSync(ruta); } catch { throw crearError('El respaldo no está disponible.', 'BACKUP_NOT_FOUND'); }
    if (!estadisticas.isFile() || estadisticas.isSymbolicLink()) throw crearError('El respaldo debe ser un archivo regular.', 'BACKUP_NOT_REGULAR');
    if (estadisticas.size < 1) throw crearError('El respaldo está vacío.', 'BACKUP_EMPTY');
    const real = crypto.createHash('sha256').update(fs.readFileSync(ruta)).digest();
    const esperado = Buffer.from(checksumEsperado, 'hex');
    if (esperado.length !== real.length || !crypto.timingSafeEqual(real, esperado)) throw crearError('El respaldo no coincide con su hash.', 'BACKUP_HASH_MISMATCH');
    return { size: estadisticas.size };
}

function construirPlanBaseline(manifiesto, opciones = {}) {
    const lote = (opciones.randomUUID || crypto.randomUUID)();
    const entradas = manifiesto.migraciones.filter((item) => item.version >= 0 && item.version <= 8);
    if (entradas.length !== 9 || entradas.some((item, indice) => item.version !== indice)) {
        throw crearError('El manifiesto no contiene exactamente 000–008.', 'BASELINE_PLAN_INVALID');
    }
    return entradas.map((entrada) => ({
        version: entrada.version,
        archivo: entrada.archivo,
        checksumSha256: entrada.checksumSha256,
        tipoRegistro: entrada.version === 0 ? 'EJECUTADA' : 'BASELINE',
        duracionMs: 0,
        loteEjecucion: lote
    }));
}

function compararRegistrosBaseline(filas, plan) {
    if (!Array.isArray(filas) || filas.length !== 9 || !Array.isArray(plan) || plan.length !== 9) return false;
    const porVersion = new Map(filas.map((fila) => [Number(fila.version), fila]));
    return plan.every((esperada) => {
        const real = porVersion.get(esperada.version);
        return real
            && real.archivo === esperada.archivo
            && real.checksum_sha256 === esperada.checksumSha256
            && real.tipo_registro === esperada.tipoRegistro;
    });
}

function validarEstadoPrevio(resultado) {
    if (!resultado || resultado.fallidas > 0 || resultado.clasificacion === 'SCHEMA_DRIFT_DETECTED') {
        throw crearError('El preflight detectó incompatibilidad estructural.', 'PREFLIGHT_INCOMPATIBLE');
    }
    if (resultado.estadoControl === 'PARTIAL_OR_INCONSISTENT') throw crearError('El control de migraciones es parcial o incompatible.', 'CONTROL_PARTIAL');
    if (resultado.estadoControl === 'BASELINE_V008_COMPLETE') return 'ALREADY_REGISTERED';
    if (resultado.estadoControl === 'CONTROL_NOT_INITIALIZED') return 'BOOTSTRAP_REQUIRED';
    if (resultado.estadoControl === 'CONTROL_EMPTY') return 'REGISTER_REQUIRED';
    throw crearError('Estado de control desconocido.', 'CONTROL_UNKNOWN');
}

function quitarComentariosSql(sql) {
    return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '').trim();
}

function validarBootstrapSql(manifiesto, ruta = BOOTSTRAP_PATH) {
    const entrada = manifiesto.migraciones.find((item) => item.version === 0);
    if (!entrada || calcularChecksumCanonico(ruta) !== entrada.checksumSha256) throw crearError('Checksum del bootstrap inválido.', 'BOOTSTRAP_CHECKSUM_MISMATCH');
    const sql = fs.readFileSync(ruta, 'utf8');
    const limpio = quitarComentariosSql(sql);
    const sinFinal = limpio.endsWith(';') ? limpio.slice(0, -1).trim() : limpio;
    if (sinFinal.includes(';')) throw crearError('El bootstrap contiene más de una sentencia.', 'BOOTSTRAP_MULTIPLE_STATEMENTS');
    if (!/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`?schema_migrations`?\s*\(/i.test(sinFinal)) throw crearError('El bootstrap no crea únicamente schema_migrations.', 'BOOTSTRAP_TARGET_INVALID');
    if (/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|USE|CALL)\b/i.test(sinFinal)) throw crearError('El bootstrap contiene operaciones no permitidas.', 'BOOTSTRAP_OPERATION_FORBIDDEN');
    const creates = sinFinal.match(/\bCREATE\s+TABLE\b/gi) || [];
    if (creates.length !== 1) throw crearError('El bootstrap debe contener un solo CREATE TABLE.', 'BOOTSTRAP_TARGET_INVALID');
    return sql;
}

async function ejecutarPreflightConexion(conexion, descriptor, manifiesto) {
    const snapshot = await consultarSnapshot(conexion, descriptor);
    const resultado = compararSnapshotConDescriptor(snapshot, descriptor, manifiesto);
    const estado = validarEstadoPrevio(resultado);
    if (estado === 'ALREADY_REGISTERED'
        && !compararRegistrosBaseline(snapshot.controlRows, construirPlanBaseline(manifiesto))) {
        throw crearError('Los nueve registros del baseline no coinciden.', 'CONTROL_PARTIAL');
    }
    return { snapshot, resultado, estado };
}

async function registrarBaselineTransaccional(conexion, plan) {
    if (!Array.isArray(plan) || plan.length !== 9) throw crearError('Plan de registro inválido.', 'BASELINE_PLAN_INVALID');
    await conexion.beginTransaction();
    let insertadas = 0;
    try {
        for (const fila of plan) {
            const [resultado] = await conexion.execute(INSERT_BASELINE_SQL, [
                fila.version, fila.archivo, fila.checksumSha256,
                fila.tipoRegistro, fila.duracionMs, fila.loteEjecucion
            ]);
            if (!resultado || resultado.affectedRows !== 1) throw crearError('No se registró una fila del baseline.', 'BASELINE_INSERT_FAILED');
            insertadas += 1;
        }
        if (insertadas !== 9) throw crearError('No se registraron las nueve filas.', 'BASELINE_INSERT_COUNT');
        await conexion.commit();
        return insertadas;
    } catch (error) {
        await conexion.rollback();
        throw error;
    }
}

async function verificarBaselineRegistrado(conexion, descriptor, manifiesto) {
    const verificacion = await ejecutarPreflightConexion(conexion, descriptor, manifiesto);
    if (verificacion.estado !== 'ALREADY_REGISTERED') throw crearError('La verificación posterior del baseline falló.', 'POST_VERIFY_FAILED');
    const plan = construirPlanBaseline(manifiesto);
    if (!compararRegistrosBaseline(verificacion.snapshot.controlRows, plan)) throw crearError('La verificación de las nueve filas falló.', 'POST_VERIFY_FAILED');
    return true;
}

function crearPoolLectura() {
    require('dotenv').config({ quiet: true });
    return require('../config/database');
}

function crearPoolAdministrativo(configuracion) {
    const mysql = require('mysql2/promise');
    return mysql.createPool(configuracion);
}

async function ejecutarDryRun(salida = {}, dependencias = {}) {
    const escribir = salida.log || ((mensaje) => console.log(mensaje));
    const { manifiesto, descriptor } = cargarContextoEstatico();
    const pool = dependencias.pool || crearPoolLectura();
    let conexion;
    try {
        conexion = await pool.getConnection();
        const preflight = dependencias.preflight
            ? await dependencias.preflight(conexion, descriptor, manifiesto)
            : await ejecutarPreflightConexion(conexion, descriptor, manifiesto);
        const estado = preflight.estado || validarEstadoPrevio(preflight.resultado || preflight);
        const plan = construirPlanBaseline(manifiesto, dependencias);
        escribir(`Estado previo: ${estado}`);
        escribir(`Registros planeados: ${plan.length}`);
        plan.forEach((fila) => escribir(`${String(fila.version).padStart(3, '0')} | ${fila.tipoRegistro} | ${fila.checksumSha256.slice(0, 12)}…`));
        escribir('Advertencia: CREATE TABLE implica autocommit de DDL en MySQL.');
        escribir('DRY_RUN_ONLY_NO_CHANGES');
        return { estado, plan, marcador: 'DRY_RUN_ONLY_NO_CHANGES' };
    } finally {
        if (conexion && typeof conexion.release === 'function') conexion.release();
        await pool.end();
    }
}

async function ejecutarBaselineReal(opciones, salida = {}, dependencias = {}) {
    const escribir = salida.log || ((mensaje) => console.log(mensaje));
    const entorno = dependencias.env || process.env;
    const configuracion = validarOpcionesEjecucion(opciones, entorno);
    verificarRespaldo(opciones.valores['--backup-file'], opciones.valores['--backup-sha256']);
    const { manifiesto, descriptor } = cargarContextoEstatico();
    const pool = dependencias.pool || (dependencias.crearPool || crearPoolAdministrativo)(configuracion);
    let conexion;
    let lockObtenido = false;
    try {
        conexion = await pool.getConnection();
        const [filasLock] = await conexion.execute(GET_LOCK_SQL, [LOCK_NAME, LOCK_TIMEOUT_SECONDS]);
        if (!filasLock || Number(filasLock[0] && filasLock[0].lock_obtenido) !== 1) throw crearError('No fue posible obtener el bloqueo exclusivo.', 'LOCK_NOT_ACQUIRED');
        lockObtenido = true;
        let preflight = dependencias.preflight
            ? await dependencias.preflight(conexion, descriptor, manifiesto)
            : await ejecutarPreflightConexion(conexion, descriptor, manifiesto);
        let estado = preflight.estado || validarEstadoPrevio(preflight.resultado || preflight);
        if (estado === 'ALREADY_REGISTERED') {
            escribir('BASELINE_ALREADY_REGISTERED');
            return { estado };
        }
        if (estado === 'BOOTSTRAP_REQUIRED') {
            const sql = validarBootstrapSql(manifiesto);
            await conexion.execute(sql);
            preflight = dependencias.preflightPosteriorBootstrap
                ? await dependencias.preflightPosteriorBootstrap(conexion, descriptor, manifiesto)
                : await ejecutarPreflightConexion(conexion, descriptor, manifiesto);
            estado = preflight.estado || validarEstadoPrevio(preflight.resultado || preflight);
            if (estado !== 'REGISTER_REQUIRED') throw crearError('El bootstrap no dejó un control vacío compatible.', 'BOOTSTRAP_POSTCHECK_FAILED');
        } else if (estado !== 'REGISTER_REQUIRED') {
            throw crearError('Estado previo incompatible.', 'CONTROL_PARTIAL');
        }
        const plan = construirPlanBaseline(manifiesto, dependencias);
        await registrarBaselineTransaccional(conexion, plan);
        if (dependencias.verificarPosterior) await dependencias.verificarPosterior(conexion, descriptor, manifiesto, plan);
        else await verificarBaselineRegistrado(conexion, descriptor, manifiesto);
        escribir('BASELINE_V008_COMPLETE');
        return { estado: 'BASELINE_V008_COMPLETE', plan };
    } finally {
        if (conexion && lockObtenido) {
            try { await conexion.execute(RELEASE_LOCK_SQL, [LOCK_NAME]); } catch { /* no oculta el error principal */ }
        }
        if (conexion && typeof conexion.release === 'function') conexion.release();
        await pool.end();
    }
}

function imprimirAyuda(escribir) {
    escribir('Uso: node scripts/migrationBaseline.js baseline-v008 --dry-run');
    escribir('La ejecución real requiere --execute y todas las barreras documentadas.');
    escribir('N4C1 autoriza únicamente dry-run contra MySQL; no ejecute --execute en esta fase.');
}

function mensajeSeguro(error) {
    const codigo = error && /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'TECHNICAL_ERROR';
    return `Error seguro de baseline (${codigo}).`;
}

async function ejecutarCli(argumentos, salida = {}, dependencias = {}) {
    const escribir = salida.log || ((mensaje) => console.log(mensaje));
    const escribirError = salida.error || ((mensaje) => console.error(mensaje));
    try {
        const opciones = parsearArgumentos(argumentos);
        if (opciones.comando === 'help') { imprimirAyuda(escribir); return 0; }
        if (!ALLOWED_COMMANDS.has(opciones.comando)) throw crearError('Comando no permitido.', 'COMMAND_NOT_ALLOWED');
        const dryRun = opciones.flags.has('--dry-run');
        const execute = opciones.flags.has('--execute');
        if (dryRun === execute) throw crearError('Debe elegir exactamente un modo.', 'MODE_REQUIRED');
        if (dryRun) { await ejecutarDryRun(salida, dependencias); return 0; }
        await ejecutarBaselineReal(opciones, salida, dependencias);
        return 0;
    } catch (error) {
        escribirError(mensajeSeguro(error));
        return error && error.code && error.code.startsWith('PREFLIGHT') ? 1 : 2;
    }
}

module.exports = {
    BOOTSTRAP_PATH, LOCK_NAME, INSERT_BASELINE_SQL, GET_LOCK_SQL, RELEASE_LOCK_SQL,
    REQUIRED_MIGRATION_ENV, parsearArgumentos, validarOpcionesEjecucion,
    verificarRespaldo, construirPlanBaseline, compararRegistrosBaseline, validarEstadoPrevio,
    validarBootstrapSql, registrarBaselineTransaccional, verificarBaselineRegistrado,
    ejecutarDryRun, ejecutarBaselineReal, ejecutarCli
};

if (require.main === module) {
    ejecutarCli(process.argv.slice(2)).then((codigo) => { process.exitCode = codigo; });
}
