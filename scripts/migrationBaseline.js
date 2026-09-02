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
const CURRENT_ACCOUNT_SQL = 'SELECT CURRENT_USER() AS cuenta_efectiva';
const PRIVILEGES_SQL = `SELECT PRIVILEGE_TYPE
    FROM information_schema.USER_PRIVILEGES
    WHERE GRANTEE = ?
    UNION
    SELECT PRIVILEGE_TYPE
    FROM information_schema.SCHEMA_PRIVILEGES
    WHERE TABLE_SCHEMA = DATABASE()
      AND GRANTEE = ?`;
const ENABLED_ROLES_SQL = 'SELECT ROLE_NAME FROM information_schema.ENABLED_ROLES';
const ALLOWED_COMMANDS = new Set(['baseline-v008', 'help']);
const ALLOWED_FLAGS = new Set(['--dry-run', '--execute', '--execute-preflight', '--acknowledge-ddl-autocommit']);
const ALLOWED_VALUES = new Set(['--confirm', '--backup-file', '--backup-sha256']);
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
        if (posicion === -1) {
            if (!ALLOWED_FLAGS.has(argumento)) throw crearError('Opción desconocida.', 'UNKNOWN_OPTION');
            resultado.flags.add(argumento);
        } else {
            const clave = argumento.slice(0, posicion);
            if (!ALLOWED_VALUES.has(clave)) throw crearError('Opción desconocida.', 'UNKNOWN_OPTION');
            resultado.valores[clave] = argumento.slice(posicion + 1);
        }
    }
    return resultado;
}

function validarBarrerasEjecucion(opciones) {
    if (!opciones.flags.has('--execute') && !opciones.flags.has('--execute-preflight')) throw crearError('Falta modo de ejecución explícito.', 'EXECUTE_FLAG_REQUIRED');
    if (opciones.valores['--confirm'] !== 'BASELINE-V008') throw crearError('Confirmación de baseline inválida.', 'CONFIRMATION_REQUIRED');
    if (!opciones.flags.has('--acknowledge-ddl-autocommit')) throw crearError('Falta reconocer el autocommit de DDL.', 'DDL_ACK_REQUIRED');
    if (!opciones.valores['--backup-file']) throw crearError('Falta el archivo de respaldo.', 'BACKUP_REQUIRED');
    if (!/^[0-9a-f]{64}$/i.test(opciones.valores['--backup-sha256'] || '')) throw crearError('Hash de respaldo inválido.', 'BACKUP_HASH_INVALID');
    return true;
}

function validarConfiguracionAdministrativa(entorno = process.env) {
    const allowWrites = typeof entorno.MIGRATION_DB_ALLOW_WRITES === 'string'
        ? entorno.MIGRATION_DB_ALLOW_WRITES.trim() : '';
    if (allowWrites !== 'BASELINE_V008_ONLY') throw crearError('La habilitación temporal de escritura no es válida.', 'WRITE_ENABLE_REQUIRED');
    for (const nombre of REQUIRED_MIGRATION_ENV) {
        if (typeof entorno[nombre] !== 'string' || entorno[nombre].length === 0) {
            throw crearError('Configuración administrativa temporal incompleta.', 'MIGRATION_DB_CONFIG_INCOMPLETE');
        }
    }
    const host = entorno.MIGRATION_DB_HOST.trim();
    const database = entorno.MIGRATION_DB_NAME.trim();
    const user = entorno.MIGRATION_DB_USER.trim();
    if (!host || !database || !user) throw crearError('Configuración administrativa temporal incompleta.', 'MIGRATION_DB_CONFIG_INCOMPLETE');
    const portText = entorno.MIGRATION_DB_PORT.trim();
    if (!/^\d+$/.test(portText)) throw crearError('Puerto administrativo inválido.', 'MIGRATION_DB_PORT_INVALID');
    const port = Number(portText);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw crearError('Puerto administrativo inválido.', 'MIGRATION_DB_PORT_INVALID');
    return {
        host,
        port,
        database,
        user,
        password: entorno.MIGRATION_DB_PASSWORD,
        waitForConnections: true,
        connectionLimit: 1,
        queueLimit: 0,
        multipleStatements: false
    };
}

function validarOpcionesEjecucion(opciones, entorno = process.env) {
    validarBarrerasEjecucion(opciones);
    return validarConfiguracionAdministrativa(entorno);
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

async function verificarPrivilegiosAdministrativos(conexion) {
    let filas;
    let roles;
    try {
        const [cuentas] = await conexion.execute(CURRENT_ACCOUNT_SQL);
        const cuenta = String(cuentas && cuentas[0] && cuentas[0].cuenta_efectiva || '');
        const separador = cuenta.lastIndexOf('@');
        if (separador < 1) return { estado: 'UNKNOWN', faltantes: ['SELECT', 'CREATE', 'INSERT'] };
        const escapar = (valor) => valor.replace(/'/g, "''");
        const grantee = `'${escapar(cuenta.slice(0, separador))}'@'${escapar(cuenta.slice(separador + 1))}'`;
        [filas] = await conexion.execute(PRIVILEGES_SQL, [grantee, grantee]);
        [roles] = await conexion.execute(ENABLED_ROLES_SQL);
    } catch {
        return { estado: 'UNKNOWN', faltantes: ['SELECT', 'CREATE', 'INSERT'] };
    }
    const presentes = new Set((filas || []).map((fila) => String(fila.PRIVILEGE_TYPE || fila.privilege_type || '').toUpperCase()));
    const requeridos = ['SELECT', 'CREATE', 'INSERT'];
    const faltantes = requeridos.filter((permiso) => !presentes.has(permiso));
    if (faltantes.length === 0) return { estado: 'PRESENT', faltantes: [] };
    if (Array.isArray(roles) && roles.length > 0) return { estado: 'UNKNOWN', faltantes };
    return { estado: 'INSUFFICIENT', faltantes };
}

function asignarEtapa(error, etapa) {
    if (error && !error.stage) error.stage = etapa;
    return error;
}

async function ejecutarExecutePreflight(opciones, salida = {}, dependencias = {}) {
    const escribir = salida.log || ((mensaje) => console.log(mensaje));
    const entorno = dependencias.env || process.env;
    let etapa = 'ARGUMENTS';
    let pool;
    let conexion;
    let lockObtenido = false;
    let errorPrincipal;
    try {
        validarBarrerasEjecucion(opciones);
        escribir('EXECUTE_PREFLIGHT_ARGUMENTS_VALID');

        etapa = 'BACKUP';
        verificarRespaldo(opciones.valores['--backup-file'], opciones.valores['--backup-sha256']);
        escribir('EXECUTE_PREFLIGHT_BACKUP_VALID');

        etapa = 'MANIFEST';
        const { manifiesto, descriptor } = cargarContextoEstatico();

        etapa = 'CONFIG';
        const configuracion = validarConfiguracionAdministrativa(entorno);
        escribir('EXECUTE_PREFLIGHT_CONFIG_VALID');

        etapa = 'CONNECTION';
        pool = dependencias.pool || (dependencias.crearPool || crearPoolAdministrativo)(configuracion);
        conexion = await pool.getConnection();
        escribir('EXECUTE_PREFLIGHT_CONNECTED');

        etapa = 'LOCK';
        const [filasLock] = await conexion.execute(GET_LOCK_SQL, [LOCK_NAME, LOCK_TIMEOUT_SECONDS]);
        if (!filasLock || Number(filasLock[0] && filasLock[0].lock_obtenido) !== 1) throw crearError('No fue posible obtener el bloqueo exclusivo.', 'LOCK_NOT_ACQUIRED');
        lockObtenido = true;
        escribir('EXECUTE_PREFLIGHT_LOCK_ACQUIRED');

        etapa = 'SCHEMA_PREFLIGHT';
        const preflight = dependencias.preflight
            ? await dependencias.preflight(conexion, descriptor, manifiesto)
            : await ejecutarPreflightConexion(conexion, descriptor, manifiesto);
        const estado = preflight.estado || validarEstadoPrevio(preflight.resultado || preflight);
        if (!['BOOTSTRAP_REQUIRED', 'REGISTER_REQUIRED', 'ALREADY_REGISTERED'].includes(estado)) throw crearError('Estado incompatible.', 'PREFLIGHT_INCOMPATIBLE');
        escribir('EXECUTE_PREFLIGHT_SCHEMA_COMPATIBLE');

        etapa = 'PRIVILEGES';
        const privilegios = dependencias.verificarPrivilegios
            ? await dependencias.verificarPrivilegios(conexion)
            : await verificarPrivilegiosAdministrativos(conexion);
        if (privilegios.estado === 'PRESENT') {
            escribir('EXECUTE_PREFLIGHT_PRIVILEGES_PRESENT');
        } else if (privilegios.estado === 'INSUFFICIENT') {
            escribir('EXECUTE_PREFLIGHT_PRIVILEGES_INSUFFICIENT');
            escribir(`Permisos faltantes: ${(privilegios.faltantes || []).join(', ')}`);
            throw crearError('Privilegios administrativos insuficientes.', 'PRIVILEGES_INSUFFICIENT');
        } else {
            escribir('EXECUTE_PREFLIGHT_PRIVILEGES_UNKNOWN');
            throw crearError('No fue posible concluir los privilegios efectivos.', 'PRIVILEGES_UNKNOWN');
        }
    } catch (error) {
        errorPrincipal = asignarEtapa(error, etapa);
    } finally {
        try {
            if (conexion && lockObtenido) await conexion.execute(RELEASE_LOCK_SQL, [LOCK_NAME]);
            if (conexion && typeof conexion.release === 'function') conexion.release();
            if (pool) await pool.end();
        } catch (error) {
            if (!errorPrincipal) errorPrincipal = asignarEtapa(error, 'CLEANUP');
        }
    }
    if (errorPrincipal) throw errorPrincipal;
    escribir('EXECUTE_PREFLIGHT_COMPLETE_NO_CHANGES');
    return { estado: 'EXECUTE_PREFLIGHT_COMPLETE_NO_CHANGES' };
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
    let etapa = 'ARGUMENTS';
    let pool;
    let conexion;
    let lockObtenido = false;
    try {
        validarBarrerasEjecucion(opciones);
        etapa = 'BACKUP';
        verificarRespaldo(opciones.valores['--backup-file'], opciones.valores['--backup-sha256']);
        etapa = 'MANIFEST';
        const { manifiesto, descriptor } = cargarContextoEstatico();
        etapa = 'CONFIG';
        const configuracion = validarConfiguracionAdministrativa(entorno);
        etapa = 'CONNECTION';
        pool = dependencias.pool || (dependencias.crearPool || crearPoolAdministrativo)(configuracion);
        conexion = await pool.getConnection();
        etapa = 'LOCK';
        const [filasLock] = await conexion.execute(GET_LOCK_SQL, [LOCK_NAME, LOCK_TIMEOUT_SECONDS]);
        if (!filasLock || Number(filasLock[0] && filasLock[0].lock_obtenido) !== 1) throw crearError('No fue posible obtener el bloqueo exclusivo.', 'LOCK_NOT_ACQUIRED');
        lockObtenido = true;
        etapa = 'SCHEMA_PREFLIGHT';
        let preflight = dependencias.preflight
            ? await dependencias.preflight(conexion, descriptor, manifiesto)
            : await ejecutarPreflightConexion(conexion, descriptor, manifiesto);
        let estado = preflight.estado || validarEstadoPrevio(preflight.resultado || preflight);
        if (estado === 'ALREADY_REGISTERED') {
            escribir('BASELINE_ALREADY_REGISTERED');
            return { estado };
        }
        if (estado === 'BOOTSTRAP_REQUIRED') {
            etapa = 'BOOTSTRAP_VALIDATION';
            const sql = validarBootstrapSql(manifiesto);
            etapa = 'BOOTSTRAP_EXECUTION';
            await conexion.execute(sql);
            etapa = 'SCHEMA_PREFLIGHT';
            preflight = dependencias.preflightPosteriorBootstrap
                ? await dependencias.preflightPosteriorBootstrap(conexion, descriptor, manifiesto)
                : await ejecutarPreflightConexion(conexion, descriptor, manifiesto);
            estado = preflight.estado || validarEstadoPrevio(preflight.resultado || preflight);
            if (estado !== 'REGISTER_REQUIRED') throw crearError('El bootstrap no dejó un control vacío compatible.', 'BOOTSTRAP_POSTCHECK_FAILED');
        } else if (estado !== 'REGISTER_REQUIRED') {
            throw crearError('Estado previo incompatible.', 'CONTROL_PARTIAL');
        }
        const plan = construirPlanBaseline(manifiesto, dependencias);
        etapa = 'BASELINE_TRANSACTION';
        await registrarBaselineTransaccional(conexion, plan);
        etapa = 'POST_VERIFICATION';
        if (dependencias.verificarPosterior) await dependencias.verificarPosterior(conexion, descriptor, manifiesto, plan);
        else await verificarBaselineRegistrado(conexion, descriptor, manifiesto);
        escribir('BASELINE_V008_COMPLETE');
        return { estado: 'BASELINE_V008_COMPLETE', plan };
    } catch (error) {
        throw asignarEtapa(error, etapa);
    } finally {
        if (conexion && lockObtenido) {
            try { await conexion.execute(RELEASE_LOCK_SQL, [LOCK_NAME]); } catch { /* no oculta el error principal */ }
        }
        try {
            if (conexion && typeof conexion.release === 'function') conexion.release();
            if (pool) await pool.end();
        } catch (error) {
            throw asignarEtapa(error, 'CLEANUP');
        }
    }
}

function imprimirAyuda(escribir) {
    escribir('Uso: node scripts/migrationBaseline.js baseline-v008 --dry-run');
    escribir('Diagnóstico administrativo: baseline-v008 --execute-preflight con todas las barreras.');
    escribir('La ejecución real requiere --execute y todas las barreras documentadas.');
    escribir('N4C1 autoriza únicamente dry-run contra MySQL; no ejecute --execute en esta fase.');
}

function mensajeSeguro(error, etapa = 'ARGUMENTS') {
    const codigo = error && /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'TECHNICAL_ERROR';
    const etapaSegura = /^[A-Z_]+$/.test(error && error.stage ? error.stage : etapa)
        ? (error.stage || etapa) : 'UNKNOWN';
    return `BASELINE_FAILED_STAGE=${etapaSegura} CODE=${codigo}`;
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
        const executePreflight = opciones.flags.has('--execute-preflight');
        if ([dryRun, execute, executePreflight].filter(Boolean).length !== 1) throw crearError('Debe elegir exactamente un modo.', 'MODE_REQUIRED');
        if (dryRun) { await ejecutarDryRun(salida, dependencias); return 0; }
        if (executePreflight) { await ejecutarExecutePreflight(opciones, salida, dependencias); return 0; }
        await ejecutarBaselineReal(opciones, salida, dependencias);
        return 0;
    } catch (error) {
        escribirError(mensajeSeguro(error));
        return error && error.code && error.code.startsWith('PREFLIGHT') ? 1 : 2;
    }
}

module.exports = {
    BOOTSTRAP_PATH, LOCK_NAME, INSERT_BASELINE_SQL, GET_LOCK_SQL, RELEASE_LOCK_SQL,
    CURRENT_ACCOUNT_SQL, PRIVILEGES_SQL, ENABLED_ROLES_SQL, REQUIRED_MIGRATION_ENV, parsearArgumentos,
    validarBarrerasEjecucion, validarConfiguracionAdministrativa, validarOpcionesEjecucion,
    verificarRespaldo, construirPlanBaseline, compararRegistrosBaseline, validarEstadoPrevio,
    validarBootstrapSql, registrarBaselineTransaccional, verificarBaselineRegistrado,
    verificarPrivilegiosAdministrativos, ejecutarDryRun, ejecutarExecutePreflight,
    ejecutarBaselineReal, ejecutarCli
};

if (require.main === module) {
    ejecutarCli(process.argv.slice(2)).then((codigo) => { process.exitCode = codigo; });
}
