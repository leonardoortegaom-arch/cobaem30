'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'database', 'migration-manifest.json');
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'database', 'migrations');
const CONTRACTS_DIR = path.join(PROJECT_ROOT, 'database', 'migration-contracts');
const FORMAT_VERSION = 2;
const CHECKSUM_ALGORITHM = 'sha256-utf8-lf-v1';
const ALLOWED_STATES = new Set([
    'BOOTSTRAP',
    'ACTIVE',
    'SUPERSEDED_NOT_APPLIED',
    'RESERVED_MISSING',
    'PLANNED'
]);
const STATES_WITH_FILE = new Set(['BOOTSTRAP', 'ACTIVE', 'SUPERSEDED_NOT_APPLIED']);
const STATES_WITHOUT_FILE = new Set(['RESERVED_MISSING', 'PLANNED']);

function crearError(message) {
    const error = new Error(message);
    error.name = 'MigrationManifestError';
    return error;
}

function normalizarContenidoParaChecksum(contenido) {
    let texto;

    if (Buffer.isBuffer(contenido) || contenido instanceof Uint8Array) {
        try {
            texto = new TextDecoder('utf-8', { fatal: true }).decode(contenido);
        } catch {
            throw crearError('El archivo no contiene texto UTF-8 válido.');
        }
    } else if (typeof contenido === 'string') {
        texto = contenido;
    } else {
        throw crearError('El contenido para checksum debe ser texto UTF-8 o bytes.');
    }

    if (texto.startsWith('\uFEFF')) {
        texto = texto.slice(1);
    }

    return texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function calcularChecksumCanonico(rutaArchivo) {
    const contenido = fs.readFileSync(rutaArchivo);
    const normalizado = normalizarContenidoParaChecksum(contenido);
    return crypto.createHash('sha256').update(normalizado, 'utf8').digest('hex');
}

function cargarManifiesto(rutaManifiesto = MANIFEST_PATH) {
    let contenido;
    try {
        contenido = fs.readFileSync(rutaManifiesto);
    } catch {
        throw crearError('No fue posible leer el manifiesto de migraciones.');
    }

    try {
        return JSON.parse(normalizarContenidoParaChecksum(contenido));
    } catch (error) {
        if (error.name === 'MigrationManifestError') {
            throw error;
        }
        throw crearError('El manifiesto de migraciones no contiene JSON válido.');
    }
}

function esNombreArchivoSeguro(nombre) {
    return typeof nombre === 'string'
        && nombre.length > 0
        && nombre === path.basename(nombre)
        && !path.isAbsolute(nombre)
        && !nombre.includes('..')
        && !nombre.includes('/')
        && !nombre.includes('\\')
        && nombre.toLowerCase().endsWith('.sql');
}

function esRutaContratoSegura(nombre) {
    if (typeof nombre !== 'string' || !nombre.endsWith('.json') || path.isAbsolute(nombre)
        || nombre.includes('..') || nombre.includes('\\')) return false;
    const destino = path.resolve(PROJECT_ROOT, nombre);
    return destino.startsWith(`${CONTRACTS_DIR}${path.sep}`) && path.dirname(destino) === CONTRACTS_DIR;
}

function validarEstructuraManifiesto(manifiesto) {
    if (!manifiesto || typeof manifiesto !== 'object' || Array.isArray(manifiesto)) {
        throw crearError('El manifiesto debe ser un objeto JSON.');
    }
    if (manifiesto.versionFormato !== FORMAT_VERSION) {
        throw crearError(`versionFormato debe ser ${FORMAT_VERSION}.`);
    }
    if (manifiesto.algoritmoChecksum !== CHECKSUM_ALGORITHM) {
        throw crearError(`algoritmoChecksum debe ser ${CHECKSUM_ALGORITHM}.`);
    }
    if (!Number.isInteger(manifiesto.legacyBaselineThrough) || manifiesto.legacyBaselineThrough < 0) {
        throw crearError('legacyBaselineThrough debe ser un entero no negativo.');
    }
    if (typeof manifiesto.descripcion !== 'string' || !manifiesto.descripcion.trim()) {
        throw crearError('El manifiesto requiere una descripción.');
    }
    if (!Array.isArray(manifiesto.migraciones)) {
        throw crearError('migraciones debe ser un arreglo.');
    }

    const versiones = new Set();
    const identificadores = new Set();
    const archivos = new Set();
    let versionAnterior = -1;

    for (const entrada of manifiesto.migraciones) {
        if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
            throw crearError('Cada migración debe ser un objeto.');
        }
        if (!Number.isInteger(entrada.version) || entrada.version < 0) {
            throw crearError('Cada versión debe ser un entero no negativo.');
        }
        const identificadorEsperado = String(entrada.version).padStart(3, '0');
        if (entrada.identificador !== identificadorEsperado || !/^\d{3}$/.test(entrada.identificador)) {
            throw crearError(`Identificador inválido para la versión ${entrada.version}.`);
        }
        if (entrada.version <= versionAnterior) {
            throw crearError('Las migraciones deben estar ordenadas ascendentemente y sin duplicados.');
        }
        versionAnterior = entrada.version;
        if (versiones.has(entrada.version)) {
            throw crearError(`Versión duplicada: ${entrada.version}.`);
        }
        if (identificadores.has(entrada.identificador)) {
            throw crearError(`Identificador duplicado: ${entrada.identificador}.`);
        }
        versiones.add(entrada.version);
        identificadores.add(entrada.identificador);

        if (!ALLOWED_STATES.has(entrada.estado)) {
            throw crearError(`Estado desconocido en ${entrada.identificador}.`);
        }
        if (typeof entrada.descripcion !== 'string' || !entrada.descripcion.trim()) {
            throw crearError(`Descripción ausente en ${entrada.identificador}.`);
        }
        if (entrada.estado !== 'ACTIVE'
            && (typeof entrada.razonEstado !== 'string' || !entrada.razonEstado.trim())) {
            throw crearError(`razonEstado es obligatoria en ${entrada.identificador}.`);
        }

        if (STATES_WITH_FILE.has(entrada.estado)) {
            if (!esNombreArchivoSeguro(entrada.archivo)) {
                throw crearError(`Archivo ausente o inseguro en ${entrada.identificador}.`);
            }
            if (!/^[0-9a-f]{64}$/.test(entrada.checksumSha256 || '')) {
                throw crearError(`Checksum inválido o ausente en ${entrada.identificador}.`);
            }
            if (archivos.has(entrada.archivo)) {
                throw crearError(`Archivo duplicado: ${entrada.archivo}.`);
            }
            archivos.add(entrada.archivo);
        } else if (STATES_WITHOUT_FILE.has(entrada.estado)) {
            if (entrada.archivo !== null || entrada.checksumSha256 !== null) {
                throw crearError(`${entrada.estado} no puede apuntar a un archivo en ${entrada.identificador}.`);
            }
        }

        if (entrada.estado === 'ACTIVE' && entrada.version > manifiesto.legacyBaselineThrough) {
            const ejecucion = entrada.execution;
            if (!ejecucion || !Number.isInteger(ejecucion.statementCount) || ejecucion.statementCount < 1
                || !Array.isArray(ejecucion.statements) || ejecucion.statements.length !== ejecucion.statementCount) {
                throw crearError(`Metadatos de ejecución inválidos en ${entrada.identificador}.`);
            }
            const targets = new Set();
            for (const statement of ejecucion.statements) {
                if (!statement || statement.operation !== 'CREATE_TABLE' || !/^[a-z][a-z0-9_]*$/.test(statement.target || '')
                    || targets.has(statement.target)) throw crearError(`Operación o target inválido en ${entrada.identificador}.`);
                targets.add(statement.target);
            }
            const targetsPrecondicion = new Set((ejecucion.preconditions || []).map((item) => item && item.target));
            if (!Array.isArray(ejecucion.preconditions) || ejecucion.preconditions.length !== targets.size
                || targetsPrecondicion.size !== targets.size
                || ejecucion.preconditions.some((item) => !item || item.type !== 'TABLE_ABSENT' || !targets.has(item.target))) {
                throw crearError(`Precondiciones incoherentes en ${entrada.identificador}.`);
            }
            if (!esRutaContratoSegura(ejecucion.postconditionContract)
                || !/^[0-9a-f]{64}$/.test(ejecucion.postconditionChecksumSha256 || '')) {
                throw crearError(`Contrato de postcondición inválido en ${entrada.identificador}.`);
            }
        } else if (entrada.execution !== undefined) {
            throw crearError(`execution solo se permite en ACTIVE posterior al baseline: ${entrada.identificador}.`);
        }
    }

    return true;
}

function listarArchivosSql(directorioMigraciones = MIGRATIONS_DIR) {
    return fs.readdirSync(directorioMigraciones, { withFileTypes: true })
        .filter((entrada) => entrada.isFile() && entrada.name.toLowerCase().endsWith('.sql'))
        .map((entrada) => entrada.name)
        .sort((a, b) => a.localeCompare(b, 'en'));
}

function resolverArchivoMigracionSeguro(nombre, directorioMigraciones) {
    if (!esNombreArchivoSeguro(nombre)) {
        throw crearError('El manifiesto contiene una ruta de migración insegura.');
    }
    const raiz = path.resolve(directorioMigraciones);
    const destino = path.resolve(raiz, nombre);
    if (path.dirname(destino) !== raiz) {
        throw crearError('La ruta de migración sale del directorio permitido.');
    }
    return destino;
}

function validarArchivosYChecksums(manifiesto, opciones = {}) {
    validarEstructuraManifiesto(manifiesto);
    const directorioMigraciones = opciones.directorioMigraciones || MIGRATIONS_DIR;
    const archivosFisicos = listarArchivosSql(directorioMigraciones);
    const entradasConArchivo = manifiesto.migraciones.filter((entrada) => entrada.archivo !== null);
    const archivosManifestados = new Set(entradasConArchivo.map((entrada) => entrada.archivo));

    for (const archivo of archivosFisicos) {
        if (!archivosManifestados.has(archivo)) {
            throw crearError(`SQL físico no manifestado: ${archivo}.`);
        }
    }

    for (const entrada of entradasConArchivo) {
        const ruta = resolverArchivoMigracionSeguro(entrada.archivo, directorioMigraciones);
        let estadisticas;
        try {
            estadisticas = fs.lstatSync(ruta);
        } catch {
            throw crearError(`Archivo esperado ausente: ${entrada.archivo}.`);
        }
        if (!estadisticas.isFile() || estadisticas.isSymbolicLink()) {
            throw crearError(`La migración no es un archivo regular permitido: ${entrada.archivo}.`);
        }
        const checksumReal = calcularChecksumCanonico(ruta);
        if (checksumReal !== entrada.checksumSha256) {
            throw crearError(`Checksum distinto para ${entrada.archivo}.`);
        }
    }

    const contratosManifestados = new Set();
    for (const entrada of manifiesto.migraciones.filter((item) => item.execution)) {
        const relativo = entrada.execution.postconditionContract;
        if (contratosManifestados.has(relativo)) throw crearError(`Contrato duplicado: ${relativo}.`);
        contratosManifestados.add(relativo);
        const ruta = path.resolve(PROJECT_ROOT, relativo);
        let stat;
        try { stat = fs.lstatSync(ruta); } catch { throw crearError(`Contrato esperado ausente en ${entrada.identificador}.`); }
        if (!stat.isFile() || stat.isSymbolicLink()) throw crearError(`Contrato no regular en ${entrada.identificador}.`);
        if (calcularChecksumCanonico(ruta) !== entrada.execution.postconditionChecksumSha256) {
            throw crearError(`Checksum de contrato distinto en ${entrada.identificador}.`);
        }
        let contrato;
        try { contrato = JSON.parse(normalizarContenidoParaChecksum(fs.readFileSync(ruta))); } catch { throw crearError(`Contrato JSON inválido en ${entrada.identificador}.`); }
        if (Number(contrato.migracion) !== entrada.version) throw crearError(`Contrato asociado a versión incorrecta en ${entrada.identificador}.`);
    }
    const contratosFisicos = fs.existsSync(CONTRACTS_DIR)
        ? fs.readdirSync(CONTRACTS_DIR, { withFileTypes: true }).filter((item) => item.isFile() && item.name.endsWith('.json'))
            .map((item) => `database/migration-contracts/${item.name}`) : [];
    for (const contrato of contratosFisicos) if (!contratosManifestados.has(contrato)) throw crearError(`Contrato físico no manifestado: ${contrato}.`);

    return {
        totalEntradas: manifiesto.migraciones.length,
        totalArchivosSql: archivosFisicos.length
    };
}

function construirPlanEstatico(manifiesto) {
    validarEstructuraManifiesto(manifiesto);
    return manifiesto.migraciones.map((entrada) => ({
        version: entrada.identificador,
        estado: entrada.estado,
        archivo: entrada.archivo || '(sin archivo)',
        descripcion: entrada.descripcion
    }));
}

function imprimirAyuda(escribir) {
    escribir('Uso: node scripts/migrationManifest.js <verify|plan|help>');
    escribir('  verify  Valida estructura, archivos y checksums sin acceder a MySQL.');
    escribir('  plan    Muestra el Plan estático del manifiesto después de validarlo.');
    escribir('  help    Muestra esta ayuda.');
    escribir('N4A no ejecuta migraciones ni contiene comandos de escritura en base de datos.');
}

function ejecutarCli(argumentos, salida = {}) {
    const escribir = salida.log || ((mensaje) => console.log(mensaje));
    const escribirError = salida.error || ((mensaje) => console.error(mensaje));
    const comando = argumentos[0] || 'help';

    try {
        if (comando === 'help') {
            imprimirAyuda(escribir);
            return 0;
        }
        if (comando !== 'verify' && comando !== 'plan') {
            escribirError(`Comando no permitido o desconocido: ${comando}. Use help.`);
            return 1;
        }

        const manifiesto = cargarManifiesto();
        const resumen = validarArchivosYChecksums(manifiesto);

        if (comando === 'verify') {
            escribir(`Manifiesto verificado: ${resumen.totalEntradas} entradas y ${resumen.totalArchivosSql} archivos SQL.`);
            escribir('Verificación exclusivamente estática; no hubo acceso a base de datos.');
            return 0;
        }

        escribir('Plan estático del manifiesto');
        escribir('Verificación exclusivamente estática; no hubo acceso a base de datos.');
        for (const entrada of construirPlanEstatico(manifiesto)) {
            escribir(`${entrada.version} | ${entrada.estado} | ${entrada.archivo} | ${entrada.descripcion}`);
        }
        return 0;
    } catch (error) {
        escribirError(error && error.message ? error.message : 'Falló la validación estática del manifiesto.');
        return 1;
    }
}

module.exports = {
    PROJECT_ROOT, CONTRACTS_DIR,
    MANIFEST_PATH,
    MIGRATIONS_DIR,
    FORMAT_VERSION,
    CHECKSUM_ALGORITHM,
    normalizarContenidoParaChecksum,
    calcularChecksumCanonico,
    cargarManifiesto,
    validarEstructuraManifiesto,
    listarArchivosSql,
    validarArchivosYChecksums,
    construirPlanEstatico,
    ejecutarCli
};

if (require.main === module) {
    process.exitCode = ejecutarCli(process.argv.slice(2));
}
