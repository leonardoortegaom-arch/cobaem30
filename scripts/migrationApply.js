'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const manifestApi = require('./migrationManifest');
const preflightApi = require('./migrationPreflight');
const baselineApi = require('./migrationBaseline');

const LOCK_NAME = 'cobaem30:schema-migrations:active';
const GET_LOCK_SQL = 'SELECT GET_LOCK(?, ?) AS lock_obtenido';
const RELEASE_LOCK_SQL = 'SELECT RELEASE_LOCK(?) AS lock_liberado';
const INSERT_SQL = `INSERT INTO schema_migrations
    (version, archivo, checksum_sha256, tipo_registro, duracion_ms, lote_ejecucion)
    VALUES (?, ?, ?, 'EJECUTADA', ?, ?)`;
const RECOVERY_COUNTS_SQL = `SELECT
    (SELECT COUNT(*) FROM importaciones_horario) AS importaciones_horario,
    (SELECT COUNT(*) FROM versiones_horario) AS versiones_horario`;
const RECOVERY_ROW_SQL = `SELECT version, archivo, checksum_sha256, tipo_registro
    FROM schema_migrations WHERE version = ?`;
const MODES = new Set(['--dry-run', '--execute-preflight', '--execute']);
const VALUE_OPTIONS = new Set(['--confirm', '--backup-file', '--backup-sha256', '--version']);
const FLAG_OPTIONS = new Set(['--dry-run', '--execute-preflight', '--execute', '--acknowledge-ddl-autocommit']);

function errorSeguro(code, stage, message = 'Operación de migración rechazada.') {
    const error = new Error(message); error.code = code; error.stage = stage; return error;
}

function parsearArgumentos(args) {
    const comando = args[0] || 'help';
    if (comando === 'help') return { comando, flags: new Set(), valores: {} };
    if (!['up', 'recover-registration'].includes(comando)) throw errorSeguro('COMMAND_NOT_ALLOWED', 'ARGUMENTS');
    const flags = new Set(); const valores = {};
    for (const arg of args.slice(1)) {
        if (/^--(?:password|migration-db-password)(?:=|$)/i.test(arg)) throw errorSeguro('PASSWORD_CLI_FORBIDDEN', 'ARGUMENTS');
        const pos = arg.indexOf('=');
        const key = pos < 0 ? arg : arg.slice(0, pos);
        if (FLAG_OPTIONS.has(key) && pos < 0) flags.add(key);
        else if (VALUE_OPTIONS.has(key) && pos > 0) valores[key] = arg.slice(pos + 1);
        else throw errorSeguro('UNKNOWN_OPTION', 'ARGUMENTS');
    }
    const modes = [...MODES].filter((mode) => flags.has(mode));
    if (modes.length !== 1) throw errorSeguro('MODE_REQUIRED', 'ARGUMENTS');
    if (comando === 'up' && Object.hasOwn(valores, '--version')) throw errorSeguro('UNKNOWN_OPTION', 'ARGUMENTS');
    if (comando === 'recover-registration' && valores['--version'] !== '019') throw errorSeguro('RECOVERY_VERSION_NOT_ALLOWED', 'RECOVERY_ARGUMENTS');
    return { comando, flags, valores, mode: modes[0] };
}

function validarBarreras(opciones, env = process.env) {
    if (opciones.valores['--confirm'] !== 'APPLY-ACTIVE-MIGRATIONS') throw errorSeguro('CONFIRMATION_REQUIRED', 'ARGUMENTS');
    if (!opciones.flags.has('--acknowledge-ddl-autocommit')) throw errorSeguro('DDL_ACK_REQUIRED', 'ARGUMENTS');
    const hash = opciones.valores['--backup-sha256'];
    if (!opciones.valores['--backup-file']) throw errorSeguro('BACKUP_REQUIRED', 'BACKUP');
    if (!/^[0-9a-f]{64}$/i.test(hash || '')) throw errorSeguro('BACKUP_HASH_INVALID', 'BACKUP');
    baselineApi.verificarRespaldo(opciones.valores['--backup-file'], hash);
    if (String(env.MIGRATION_DB_ALLOW_WRITES || '').trim() !== 'ACTIVE_MIGRATIONS_ONLY') throw errorSeguro('WRITE_GUARD_REQUIRED', 'CONFIG');
    const mapped = { ...env, MIGRATION_DB_ALLOW_WRITES: 'BASELINE_V008_ONLY' };
    return baselineApi.validarConfiguracionAdministrativa(mapped);
}

function validarBarrerasRecuperacion(opciones, env = process.env) {
    if (opciones.valores['--confirm'] !== 'RECOVER-MIGRATION-019') throw errorSeguro('CONFIRMATION_REQUIRED', 'RECOVERY_ARGUMENTS');
    if (!opciones.valores['--backup-file']) throw errorSeguro('BACKUP_REQUIRED', 'RECOVERY_BACKUP');
    const hash = opciones.valores['--backup-sha256'];
    if (!/^[0-9a-f]{64}$/i.test(hash || '')) throw errorSeguro('BACKUP_HASH_INVALID', 'RECOVERY_BACKUP');
    baselineApi.verificarRespaldo(opciones.valores['--backup-file'], hash);
    if (String(env.MIGRATION_DB_ALLOW_WRITES || '').trim() !== 'REGISTRATION_RECOVERY_ONLY') {
        throw errorSeguro('WRITE_GUARD_REQUIRED', 'RECOVERY_CONFIG');
    }
    return baselineApi.validarConfiguracionAdministrativa({ ...env, MIGRATION_DB_ALLOW_WRITES: 'BASELINE_V008_ONLY' });
}

function separarSentenciasSql(sql) {
    if (/^\s*(DELIMITER|SOURCE|\\[.!])/im.test(sql)) throw errorSeguro('SQL_CLIENT_COMMAND_FORBIDDEN', 'SQL_VALIDATION');
    const statements = []; let current = ''; let state = 'normal';
    for (let i = 0; i < sql.length; i += 1) {
        const c = sql[i]; const n = sql[i + 1];
        if (state === 'line') { if (c === '\n') { state = 'normal'; current += '\n'; } continue; }
        if (state === 'block') { if (c === '*' && n === '/') { state = 'normal'; i += 1; } continue; }
        if (state === 'single' || state === 'double' || state === 'backtick') {
            current += c;
            const end = state === 'single' ? "'" : state === 'double' ? '"' : '`';
            if (c === '\\' && state !== 'backtick' && n !== undefined) { current += n; i += 1; continue; }
            if (c === end) {
                if (n === end) { current += n; i += 1; } else state = 'normal';
            }
            continue;
        }
        if (c === '-' && n === '-' && /\s/.test(sql[i + 2] || '')) { state = 'line'; i += 1; continue; }
        if (c === '#') { state = 'line'; continue; }
        if (c === '/' && n === '*') { state = 'block'; i += 1; continue; }
        if (c === "'") state = 'single'; else if (c === '"') state = 'double'; else if (c === '`') state = 'backtick';
        if (c === ';') { if (current.trim()) statements.push(current.trim()); current = ''; } else current += c;
    }
    if (state !== 'normal' && state !== 'line') throw errorSeguro('SQL_UNTERMINATED_TOKEN', 'SQL_VALIDATION');
    if (current.trim()) statements.push(current.trim());
    return statements;
}

function clasificarSentenciaDeclarada(sql, declarada) {
    if (/\bIF\s+NOT\s+EXISTS\b/i.test(sql)) throw errorSeguro('IF_NOT_EXISTS_FORBIDDEN', 'SQL_VALIDATION');
    const operation = declarada && declarada.operation;
    if (operation === 'INSERT_CATALOG_ROW') {
        if (declarada.target !== 'estados_actividad_orientacion') {
            throw errorSeguro('STATEMENT_TARGET_OR_ORDER_MISMATCH', 'SQL_VALIDATION');
        }
        const patron = /^INSERT\s+INTO\s+estados_actividad_orientacion\s*\(\s*clave\s*,\s*nombre\s*,\s*descripcion\s*,\s*orden\s*,\s*activo\s*\)\s*VALUES\s*\(\s*'RECHAZADA'\s*,\s*'Rechazada'\s*,\s*'La evidencia requiere correcciones antes de considerarse realizada\.'\s*,\s*6\s*,\s*1\s*\)$/i;
        if (!patron.test(sql)) throw errorSeguro('SQL_OPERATION_FORBIDDEN', 'SQL_VALIDATION');
        return { operation, target: declarada.target, sql };
    }
    const pattern = operation === 'ALTER_TABLE'
        ? /^ALTER\s+TABLE\s+`?([a-zA-Z][a-zA-Z0-9_]*)`?\s+/i
        : /^CREATE\s+TABLE\s+`?([a-zA-Z][a-zA-Z0-9_]*)`?\s*\(/i;
    const match = sql.match(pattern);
    if (!match) throw errorSeguro('SQL_OPERATION_FORBIDDEN', 'SQL_VALIDATION');
    if (!['CREATE_TABLE', 'ALTER_TABLE'].includes(operation) || declarada.target !== match[1].toLowerCase()) {
        throw errorSeguro('STATEMENT_TARGET_OR_ORDER_MISMATCH', 'SQL_VALIDATION');
    }
    return { operation, target: match[1].toLowerCase(), sql };
}

function validarSqlMigracion(entrada, directorio = path.join(manifestApi.PROJECT_ROOT, 'database', 'migrations')) {
    const ruta = path.resolve(directorio, entrada.archivo);
    if (manifestApi.calcularChecksumCanonico(ruta) !== entrada.checksumSha256) throw errorSeguro('SQL_CHECKSUM_MISMATCH', 'SQL_VALIDATION');
    const contenido = fs.readFileSync(ruta, 'utf8');
    if (entrada.execution.statements.some((item) => item.operation === 'INSERT_CATALOG_ROW')
        && /--|#|\/\*/.test(contenido)) throw errorSeguro('SQL_COMMENT_FORBIDDEN', 'SQL_VALIDATION');
    const sentencias = separarSentenciasSql(contenido);
    if (sentencias.length !== entrada.execution.statementCount) throw errorSeguro('STATEMENT_COUNT_MISMATCH', 'SQL_VALIDATION');
    const clasificadas = sentencias.map((sql, index) => clasificarSentenciaDeclarada(sql, entrada.execution.statements[index]));
    return clasificadas;
}

function cargarContrato(entrada) {
    const ruta = path.resolve(manifestApi.PROJECT_ROOT, entrada.execution.postconditionContract);
    if (manifestApi.calcularChecksumCanonico(ruta) !== entrada.execution.postconditionChecksumSha256) throw errorSeguro('CONTRACT_CHECKSUM_MISMATCH', 'SQL_VALIDATION');
    const contrato = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    if (Number(contrato.migracion) !== entrada.version) throw errorSeguro('CONTRACT_VERSION_MISMATCH', 'SQL_VALIDATION');
    return contrato;
}

function validarRegistrosAplicados(manifiesto, rows) {
    try { preflightApi.analizarFilasControl(manifiesto, rows || []); } catch (error) {
        throw errorSeguro(error.code || 'CONTROL_INCONSISTENT', 'STATE');
    }
    const applied = new Map((rows || []).map((row) => [Number(row.version), row]));
    const active = manifiesto.migraciones.filter((item) => item.estado === 'ACTIVE' && item.version > manifiesto.legacyBaselineThrough);
    return { applied, pending: active.filter((entry) => !applied.has(entry.version)) };
}

function validarPrecondiciones(snapshot, entrada) {
    for (const item of entrada.execution.preconditions) {
        const tabla = snapshot.tablas[item.table || item.target];
        let valida = false;
        if (item.type === 'MIGRATION_APPLIED') valida = (snapshot.controlRows || []).some((row) => Number(row.version) === item.version);
        else if (item.type === 'TABLE_PRESENT') valida = Boolean(snapshot.tablas[item.target]);
        else if (item.type === 'TABLE_ABSENT') valida = !snapshot.tablas[item.target];
        else if (item.type === 'COLUMN_ABSENT') valida = Boolean(tabla) && !tabla.columnas[item.target];
        else if (item.type === 'INDEX_ABSENT') valida = Boolean(tabla) && !tabla.indices.some((indice) => indice.nombre === item.target);
        else if (item.type === 'FOREIGN_KEY_ABSENT') valida = Boolean(tabla) && !tabla.foreignKeys.some((fk) => fk.nombre === item.target);
        else if (item.type === 'COLUMN_MATCH') {
            const columna = tabla && tabla.columnas[item.target];
            valida = Boolean(columna) && columna.tipo === normalizar(item.columnType) && columna.nullable === item.nullable;
        } else if (item.type === 'CATALOG_VALUE_ABSENT') {
            const filas = snapshot.filasCatalogo?.[item.table] || [];
            valida = !filas.some((fila) => String(fila[item.column]) === String(item.value));
        }
        if (!valida) throw errorSeguro('UNREGISTERED_PARTIAL_STRUCTURE', 'PRECONDITIONS');
    }
    return true;
}

function normalizar(v) { return String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').trim(); }
function igualArray(a, b) { return a.length === b.length && a.every((v, i) => v === b[i]); }
function tieneIndice(indices, columnas, unique) { return indices.some((i) => i.unique === unique && igualArray(i.columnas, columnas)); }

function validarPostcondicion(snapshot, contrato) {
    const errores = [];
    for (const [name, expected] of Object.entries(contrato.tablas)) {
        const actual = snapshot.tablas[name];
        if (!actual) { errores.push(`TABLE_${name}`); continue; }
        if (actual.engine !== expected.engine || actual.charset !== expected.charset || actual.collation !== expected.collation) errores.push(`TABLE_OPTIONS_${name}`);
        for (const col of expected.columnas) {
            const a = actual.columnas[col.nombre];
            if (!a || a.tipo !== normalizar(col.tipo) || a.unsigned !== col.unsigned || a.nullable !== col.nullable) errores.push(`COLUMN_${name}_${col.nombre}`);
            if (a && Object.hasOwn(col, 'default') && normalizar(a.default) !== normalizar(col.default)) errores.push(`DEFAULT_${name}_${col.nombre}`);
            if (a && col.collation && normalizar(a.collation) !== normalizar(col.collation)) errores.push(`COLLATION_${name}_${col.nombre}`);
            if (a && col.extra && !normalizar(a.extra).includes(normalizar(col.extra))) errores.push(`EXTRA_${name}_${col.nombre}`);
            if (a && col.generationExpression
                && preflightApi.normalizarExpresionGenerada(a.generationExpression) !== preflightApi.normalizarExpresionGenerada(col.generationExpression)) errores.push(`GENERATION_${name}_${col.nombre}`);
        }
        if (!tieneIndice(actual.indices, expected.primaryKey, true)) errores.push(`PK_${name}`);
        for (const idx of expected.indicesUnicos) if (!tieneIndice(actual.indices, idx.columnas, true)) errores.push(`UNIQUE_${name}`);
        for (const idx of expected.indices) if (!actual.indices.some((i) => igualArray(i.columnas, idx.columnas))) errores.push(`INDEX_${name}`);
        for (const fk of expected.foreignKeys) if (!actual.foreignKeys.some((a) => igualArray(a.columnas, fk.columnas) && a.tablaDestino === fk.tablaDestino && igualArray(a.columnasDestino, fk.columnasDestino) && a.onUpdate === fk.onUpdate && a.onDelete === fk.onDelete)) errores.push(`FK_${name}`);
        for (const check of expected.checks) if (!actual.checks.some((value) => check.fragmentos.every((f) => normalizar(value).includes(normalizar(f))))) errores.push(`CHECK_${name}`);
    }
    for (const [tabla, columnas] of Object.entries(contrato.columnasProhibidas || {})) {
        const actual = snapshot.tablas[tabla];
        if (actual && columnas.some((columna) => actual.columnas[columna])) errores.push(`FORBIDDEN_COLUMNS_${tabla}`);
    }
    for (const [tabla, esperadas] of Object.entries(contrato.filasCatalogo || {})) {
        const reales = snapshot.filasCatalogo?.[tabla] || [];
        for (const esperada of esperadas) {
            const coincidencias = reales.filter((fila) => Object.entries(esperada).every(([clave, valor]) => (
                typeof valor === 'number' ? Number(fila[clave]) === valor : String(fila[clave]) === String(valor)
            )));
            if (coincidencias.length !== 1) errores.push(`CATALOG_ROW_${tabla}_${esperada.clave}`);
        }
        const cardinalidad = contrato.cardinalidadExacta?.[tabla];
        if (Number.isInteger(cardinalidad)) {
            const claves = new Set(esperadas.map((fila) => fila.clave));
            if (reales.filter((fila) => claves.has(String(fila.clave))).length !== cardinalidad) errores.push(`CATALOG_CARDINALITY_${tabla}`);
        }
    }
    if (errores.length) throw errorSeguro('POSTCONDITION_MISMATCH', 'POSTCONDITION');
    return true;
}

async function obtenerEstado(conexion) {
    const descriptor = preflightApi.cargarDescriptor();
    const snapshot = await preflightApi.consultarSnapshot(conexion, descriptor);
    return snapshot;
}

function construirPlan(manifiesto, snapshot) {
    const state = validarRegistrosAplicados(manifiesto, snapshot.controlRows);
    for (const entry of manifiesto.migraciones.filter((e) => e.estado === 'ACTIVE' && e.version > manifiesto.legacyBaselineThrough && state.applied.has(e.version))) {
        validarPostcondicion(snapshot, cargarContrato(entry));
    }
    return state.pending.map((entry) => {
        validarPrecondiciones(snapshot, entry);
        return { entrada: entry, statements: validarSqlMigracion(entry), contrato: cargarContrato(entry) };
    });
}

function validarEstadoRecuperacion(manifiesto, snapshot, version = 19) {
    if (version !== 19) throw errorSeguro('RECOVERY_VERSION_NOT_ALLOWED', 'RECOVERY_STATE');
    const entrada = manifiesto.migraciones.find((item) => item.version === version);
    if (!entrada || entrada.estado !== 'ACTIVE') throw errorSeguro('RECOVERY_MIGRATION_INVALID', 'RECOVERY_STATE');
    const estado = validarRegistrosAplicados(manifiesto, snapshot.controlRows);
    if (estado.applied.has(version)) throw errorSeguro('RECOVERY_ALREADY_RECORDED', 'RECOVERY_STATE');
    if (estado.pending.length === 0 || estado.pending[0].version !== version) {
        throw errorSeguro('RECOVERY_NOT_NEXT_MIGRATION', 'RECOVERY_STATE');
    }
    const previas = manifiesto.migraciones.filter((item) => item.estado === 'ACTIVE'
        && item.version > manifiesto.legacyBaselineThrough && item.version < version);
    if (previas.some((item) => !estado.applied.has(item.version))) throw errorSeguro('RECOVERY_PREDECESSOR_MISSING', 'RECOVERY_STATE');
    const statements = validarSqlMigracion(entrada);
    if (statements.length !== 2 || statements.some((item) => item.operation !== 'CREATE_TABLE')) {
        throw errorSeguro('RECOVERY_SQL_NOT_CREATE_TABLES', 'RECOVERY_STRUCTURE');
    }
    const contrato = cargarContrato(entrada);
    validarPostcondicion(snapshot, contrato);
    return { entrada, contrato, statements };
}

async function contarFilasRecuperacion(connection, deps = {}) {
    if (deps.countRows) return deps.countRows(connection);
    const [rows] = await connection.execute(RECOVERY_COUNTS_SQL);
    return rows && rows[0] ? rows[0] : {};
}

function validarTablasRecuperacionVacias(conteos) {
    if (Number(conteos.importaciones_horario) !== 0 || Number(conteos.versiones_horario) !== 0) {
        throw errorSeguro('RECOVERY_TABLES_NOT_EMPTY', 'RECOVERY_TABLES_EMPTY');
    }
    return true;
}

function validarFilaRecuperada(rows, entrada) {
    if (!Array.isArray(rows) || rows.length !== 1) throw errorSeguro('RECOVERY_RECORD_VERIFICATION_FAILED', 'RECOVERY_REGISTRATION');
    const row = rows[0];
    if (Number(row.version) !== entrada.version || row.archivo !== entrada.archivo
        || row.checksum_sha256 !== entrada.checksumSha256 || row.tipo_registro !== 'EJECUTADA') {
        throw errorSeguro('RECOVERY_RECORD_VERIFICATION_FAILED', 'RECOVERY_REGISTRATION');
    }
    return true;
}

async function validarPrivilegioInsert(connection, deps = {}) {
    const resultado = deps.privileges
        ? await deps.privileges(connection)
        : await baselineApi.verificarPrivilegiosAdministrativos(connection);
    if (resultado.estado === 'UNKNOWN' && (!Array.isArray(resultado.faltantes) || resultado.faltantes.includes('INSERT'))) {
        throw errorSeguro('PRIVILEGES_UNKNOWN', 'RECOVERY_PRIVILEGES');
    }
    if (Array.isArray(resultado.faltantes) && resultado.faltantes.includes('INSERT')) {
        throw errorSeguro('PRIVILEGES_INSUFFICIENT', 'RECOVERY_PRIVILEGES');
    }
    return true;
}

async function ejecutarRecuperacionDryRun(output = {}, deps = {}) {
    const log = output.log || console.log;
    const manifiesto = deps.manifest || cargarContexto();
    const pool = deps.pool || crearPoolLectura();
    return conRecursos(pool, async (connection) => {
        log('RECOVERY_ARGUMENTS_VALID');
        const snapshot = deps.snapshot ? await deps.snapshot(connection) : await obtenerEstado(connection);
        const contexto = validarEstadoRecuperacion(manifiesto, snapshot);
        log('RECOVERY_STATE_VALID');
        log('RECOVERY_STRUCTURE_VALID');
        validarTablasRecuperacionVacias(await contarFilasRecuperacion(connection, deps));
        log('RECOVERY_TABLES_EMPTY');
        log('RECOVERY_DRY_RUN_COMPLETE_NO_CHANGES');
        return contexto;
    });
}

async function ejecutarRecuperacionAdministrativa(opciones, execute, output = {}, deps = {}) {
    const log = output.log || console.log;
    log('RECOVERY_ARGUMENTS_VALID');
    const config = validarBarrerasRecuperacion(opciones, deps.env || process.env);
    log('RECOVERY_BACKUP_VALID');
    const manifiesto = deps.manifest || cargarContexto();
    log('RECOVERY_CONFIG_VALID');
    const pool = deps.pool || (deps.crearPool || crearPoolAdmin)(config);
    try {
        return await conRecursos(pool, async (connection) => {
            log('RECOVERY_CONNECTED');
            log('RECOVERY_LOCK_ACQUIRED');
            const snapshot = deps.snapshot ? await deps.snapshot(connection) : await obtenerEstado(connection);
            const contexto = validarEstadoRecuperacion(manifiesto, snapshot);
            log('RECOVERY_STATE_VALID');
            log('RECOVERY_STRUCTURE_VALID');
            validarTablasRecuperacionVacias(await contarFilasRecuperacion(connection, deps));
            log('RECOVERY_TABLES_EMPTY');
            await validarPrivilegioInsert(connection, deps);
            log('RECOVERY_PRIVILEGES_PRESENT');
            if (!execute) {
                log('RECOVERY_EXECUTE_PREFLIGHT_COMPLETE_NO_CHANGES');
                return contexto;
            }
            await connection.beginTransaction();
            try {
                const [result] = await connection.execute(INSERT_SQL, [contexto.entrada.version, contexto.entrada.archivo,
                    contexto.entrada.checksumSha256, 0, (deps.randomUUID || crypto.randomUUID)()]);
                if (result?.affectedRows !== 1) throw errorSeguro('RECOVERY_RECORD_FAILED', 'RECOVERY_REGISTRATION');
                const [beforeCommit] = await connection.execute(RECOVERY_ROW_SQL, [contexto.entrada.version]);
                validarFilaRecuperada(beforeCommit, contexto.entrada);
                await connection.commit();
            } catch (error) {
                await connection.rollback();
                if (!error?.stage) {
                    throw errorSeguro(/^[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'RECOVERY_RECORD_FAILED', 'RECOVERY_REGISTRATION');
                }
                throw error;
            }
            const [afterCommit] = await connection.execute(RECOVERY_ROW_SQL, [contexto.entrada.version]);
            validarFilaRecuperada(afterCommit, contexto.entrada);
            log('RECOVERY_REGISTRATION_RECORDED');
            log('RECOVERY_COMPLETE');
            return contexto;
        }, true);
    } catch (error) {
        if (!error?.stage) throw errorSeguro('RECOVERY_TECHNICAL_ERROR', 'RECOVERY_CONNECTION');
        throw error;
    }
}

function cargarContexto() {
    const manifiesto = manifestApi.cargarManifiesto(); manifestApi.validarArchivosYChecksums(manifiesto); return manifiesto;
}

function crearPoolLectura() { require('dotenv').config({ quiet: true }); return require('../config/database'); }
function crearPoolAdmin(config) { return require('mysql2/promise').createPool({ ...config, multipleStatements: false, connectionLimit: 1 }); }

async function conRecursos(pool, fn, lock = false) {
    let connection; let locked = false; let mainError;
    try {
        connection = await pool.getConnection();
        if (lock) { const [rows] = await connection.execute(GET_LOCK_SQL, [LOCK_NAME, 10]); if (Number(rows?.[0]?.lock_obtenido) !== 1) throw errorSeguro('LOCK_NOT_ACQUIRED', 'LOCK'); locked = true; }
        return await fn(connection);
    } catch (e) { mainError = e; throw e; }
    finally {
        try { if (connection && locked) await connection.execute(RELEASE_LOCK_SQL, [LOCK_NAME]); } catch (e) { if (!mainError) throw e; }
        if (connection?.release) connection.release(); await pool.end();
    }
}

async function ejecutarDryRun(output = {}, deps = {}) {
    const log = output.log || console.log; const manifiesto = deps.manifest || cargarContexto(); const pool = deps.pool || crearPoolLectura();
    return conRecursos(pool, async (connection) => {
        const snapshot = deps.snapshot ? await deps.snapshot(connection) : await obtenerEstado(connection);
        const plan = construirPlan(manifiesto, snapshot);
        log(`Migraciones ACTIVE pendientes: ${plan.map((p) => p.entrada.identificador).join(', ') || 'ninguna'}.`);
        for (const item of plan) { log(`${item.entrada.identificador}: ${item.statements.length} sentencias.`); item.statements.forEach((s) => log(`  ${s.operation} ${s.target}`)); }
        if (plan.some((item) => item.statements.some((statement) => statement.operation !== 'INSERT_CATALOG_ROW'))) {
            log('Advertencia: el DDL de MySQL puede producir autocommit y estructura parcial.');
        } else if (plan.length > 0) {
            log('La operación de catálogo se aplicará transaccionalmente junto con su registro.');
        }
        log('MIGRATION_UP_DRY_RUN_NO_CHANGES'); return plan;
    });
}

async function ejecutarAdministrativo(opciones, execute, output = {}, deps = {}) {
    const log = output.log || console.log; const config = validarBarreras(opciones, deps.env || process.env); log('MIGRATION_ARGUMENTS_VALID'); log('MIGRATION_BACKUP_VALID'); log('MIGRATION_CONFIG_VALID');
    const manifiesto = deps.manifest || cargarContexto(); const pool = deps.pool || (deps.crearPool || crearPoolAdmin)(config);
    return conRecursos(pool, async (connection) => {
        log('MIGRATION_CONNECTED'); log('MIGRATION_LOCK_ACQUIRED');
        const snapshot = deps.snapshot ? await deps.snapshot(connection) : await obtenerEstado(connection);
        const plan = construirPlan(manifiesto, snapshot); log('MIGRATION_STATE_VALID'); log('MIGRATION_PRECONDITIONS_VALID'); log('MIGRATION_SQL_VALID');
        const soloCatalogo = plan.length > 0 && plan.every((item) => item.statements.every((statement) => statement.operation === 'INSERT_CATALOG_ROW'));
        const privileges = deps.privileges ? await deps.privileges(connection, soloCatalogo ? ['SELECT', 'INSERT'] : ['SELECT', 'CREATE', 'INSERT'])
            : await baselineApi.verificarPrivilegiosAdministrativos(connection, soloCatalogo ? ['SELECT', 'INSERT'] : ['SELECT', 'CREATE', 'INSERT']);
        if (privileges.estado !== 'PRESENT') throw errorSeguro(privileges.estado === 'INSUFFICIENT' ? 'PRIVILEGES_INSUFFICIENT' : 'PRIVILEGES_UNKNOWN', 'PRIVILEGES');
        log('MIGRATION_PRIVILEGES_PRESENT');
        if (!execute) { log('MIGRATION_EXECUTE_PREFLIGHT_COMPLETE_NO_CHANGES'); return plan; }
        const batch = (deps.randomUUID || crypto.randomUUID)();
        for (const item of plan) {
            const start = Date.now();
            const esCatalogo = item.statements.every((statement) => statement.operation === 'INSERT_CATALOG_ROW');
            if (esCatalogo) {
                await connection.beginTransaction();
                try {
                    const statement = item.statements[0];
                    let applied;
                    try {
                        [applied] = await connection.execute(statement.sql);
                    } catch (cause) {
                        const error = errorSeguro(
                            /^[A-Z0-9_]+$/.test(cause?.code || '') ? cause.code : 'STATEMENT_EXECUTION_FAILED',
                            'STATEMENT_APPLICATION'
                        );
                        error.version = item.entrada.version;
                        error.statement = 1;
                        throw error;
                    }
                    if (applied?.affectedRows !== 1) throw errorSeguro('CATALOG_INSERT_FAILED', 'STATEMENT_APPLICATION');
                    log('MIGRATION_STATEMENTS_APPLIED');
                    const after = deps.snapshotAfter ? await deps.snapshotAfter(connection, item) : await obtenerEstado(connection);
                    validarPostcondicion(after, item.contrato); log('MIGRATION_POSTCONDITION_VALID');
                    const [result] = await connection.execute(INSERT_SQL, [item.entrada.version, item.entrada.archivo, item.entrada.checksumSha256, Date.now() - start, batch]);
                    if (result?.affectedRows !== 1) throw errorSeguro('MIGRATION_RECORD_FAILED', 'RECORD');
                    const beforeCommit = deps.snapshotBeforeCommit ? await deps.snapshotBeforeCommit(connection, item) : await obtenerEstado(connection);
                    const pendingRow = beforeCommit.controlRows.find((row) => Number(row.version) === item.entrada.version);
                    if (!pendingRow || pendingRow.archivo !== item.entrada.archivo || pendingRow.checksum_sha256 !== item.entrada.checksumSha256) {
                        throw errorSeguro('PRE_COMMIT_VERIFICATION_FAILED', 'RECORD');
                    }
                    validarPostcondicion(beforeCommit, item.contrato);
                    await connection.commit();
                } catch (error) {
                    await connection.rollback();
                    throw error;
                }
                log('MIGRATION_RECORDED');
                const verified = deps.snapshotVerified ? await deps.snapshotVerified(connection, item) : await obtenerEstado(connection);
                const row = verified.controlRows.find((current) => Number(current.version) === item.entrada.version);
                if (!row || row.archivo !== item.entrada.archivo || row.checksum_sha256 !== item.entrada.checksumSha256) throw errorSeguro('POST_RECORD_VERIFICATION_FAILED', 'POST_VERIFICATION');
                validarPostcondicion(verified, item.contrato);
                continue;
            }
            for (const [index, statement] of item.statements.entries()) {
                try {
                    await connection.execute(statement.sql);
                } catch (cause) {
                    const error = errorSeguro(
                        /^[A-Z0-9_]+$/.test(cause?.code || '') ? cause.code : 'STATEMENT_EXECUTION_FAILED',
                        'STATEMENT_APPLICATION'
                    );
                    error.version = item.entrada.version;
                    error.statement = index + 1;
                    throw error;
                }
            }
            log('MIGRATION_STATEMENTS_APPLIED');
            const after = deps.snapshotAfter ? await deps.snapshotAfter(connection, item) : await obtenerEstado(connection);
            validarPostcondicion(after, item.contrato); log('MIGRATION_POSTCONDITION_VALID');
            await connection.beginTransaction();
            try {
                const [result] = await connection.execute(INSERT_SQL, [item.entrada.version, item.entrada.archivo, item.entrada.checksumSha256, Date.now() - start, batch]);
                if (result?.affectedRows !== 1) throw errorSeguro('MIGRATION_RECORD_FAILED', 'RECORD');
                await connection.commit();
            } catch (e) { await connection.rollback(); throw e; }
            log('MIGRATION_RECORDED');
            const verified = deps.snapshotVerified ? await deps.snapshotVerified(connection, item) : await obtenerEstado(connection);
            const row = verified.controlRows.find((r) => Number(r.version) === item.entrada.version);
            if (!row || row.archivo !== item.entrada.archivo || row.checksum_sha256 !== item.entrada.checksumSha256) throw errorSeguro('POST_RECORD_VERIFICATION_FAILED', 'POST_VERIFICATION');
            validarPostcondicion(verified, item.contrato);
        }
        log('MIGRATION_UP_COMPLETE'); return plan;
    }, true);
}

function mensajeSeguro(error) {
    let mensaje = `MIGRATION_FAILED_STAGE=${/^[A-Z_]+$/.test(error?.stage || '') ? error.stage : 'UNKNOWN'} CODE=${/^[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'TECHNICAL_ERROR'}`;
    if (error?.stage === 'STATEMENT_APPLICATION' && Number.isInteger(error.version) && Number.isInteger(error.statement)) {
        mensaje += ` VERSION=${error.version} STATEMENT=${error.statement}`;
    }
    return mensaje;
}
async function ejecutarCli(args, output = {}, deps = {}) {
    const log = output.log || console.log; const err = output.error || console.error;
    try {
        const options = parsearArgumentos(args);
        if (options.comando === 'help') {
            log('Uso: migrationApply.js up <--dry-run|--execute-preflight|--execute>');
            log('     migrationApply.js recover-registration --version=019 <--dry-run|--execute-preflight|--execute>');
            log('No existen down, repair, force ni recuperación para otras versiones.'); return 0;
        }
        if (options.comando === 'recover-registration') {
            if (options.mode === '--dry-run') { await ejecutarRecuperacionDryRun(output, deps); return 0; }
            await ejecutarRecuperacionAdministrativa(options, options.mode === '--execute', output, deps); return 0;
        }
        if (options.mode === '--dry-run') { await ejecutarDryRun(output, deps); return 0; }
        await ejecutarAdministrativo(options, options.mode === '--execute', output, deps); return 0;
    } catch (e) { err(mensajeSeguro(e)); return 2; }
}

module.exports = { LOCK_NAME, GET_LOCK_SQL, RELEASE_LOCK_SQL, INSERT_SQL, RECOVERY_COUNTS_SQL, RECOVERY_ROW_SQL,
    parsearArgumentos, validarBarreras, validarBarrerasRecuperacion,
    separarSentenciasSql, clasificarSentenciaDeclarada, validarSqlMigracion, cargarContrato, validarRegistrosAplicados, validarPrecondiciones,
    validarPostcondicion, construirPlan, validarEstadoRecuperacion, validarTablasRecuperacionVacias, validarFilaRecuperada,
    ejecutarDryRun, ejecutarAdministrativo, ejecutarRecuperacionDryRun, ejecutarRecuperacionAdministrativa, mensajeSeguro, ejecutarCli };

if (require.main === module) ejecutarCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
