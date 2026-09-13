'use strict';

const fs = require('fs');
const path = require('path');
const {
    PROJECT_ROOT,
    cargarManifiesto,
    validarArchivosYChecksums,
    calcularChecksumCanonico
} = require('./migrationManifest');

const DESCRIPTOR_PATH = path.join(PROJECT_ROOT, 'database', 'baselines', 'v008-schema.json');
const COMMANDS = new Set(['status', 'baseline-v008-check', 'help']);

const QUERIES = Object.freeze({
    tables: `SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`,
    columns: `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE,
            COLUMN_DEFAULT, EXTRA, GENERATION_EXPRESSION, COLLATION_NAME, ORDINAL_POSITION
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()`,
    indexes: `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX,
            COLUMN_NAME, COLLATION
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()`,
    foreignKeys: `SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME,
            k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
            k.ORDINAL_POSITION, r.UPDATE_RULE, r.DELETE_RULE
        FROM information_schema.KEY_COLUMN_USAGE k
        INNER JOIN information_schema.REFERENTIAL_CONSTRAINTS r
            ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
           AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
           AND r.TABLE_NAME = k.TABLE_NAME
        WHERE k.CONSTRAINT_SCHEMA = DATABASE()
          AND k.REFERENCED_TABLE_NAME IS NOT NULL`,
    checks: `SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
        FROM information_schema.TABLE_CONSTRAINTS tc
        INNER JOIN information_schema.CHECK_CONSTRAINTS cc
            ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
           AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
        WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
          AND tc.CONSTRAINT_TYPE = 'CHECK'`,
    roles: `SELECT clave FROM roles WHERE clave IN (?, ?, ?, ?)`,
    turnos: `SELECT clave FROM turnos WHERE clave IN (?, ?)`,
    tiposSeguimiento: `SELECT clave FROM tipos_seguimiento WHERE clave IN (?, ?, ?, ?)`,
    estadosActividad: `SELECT clave FROM estados_actividad_orientacion WHERE clave IN (?, ?, ?, ?, ?)`,
    tiposReporte: `SELECT clave FROM tipos_reporte_orientacion WHERE clave IN (?, ?)`,
    estadosReporte: `SELECT clave FROM estados_reporte_orientacion WHERE clave IN (?, ?)`,
    controlRows: `SELECT version, archivo, checksum_sha256, tipo_registro, aplicada_en
        FROM schema_migrations ORDER BY version`
});

const CATALOG_QUERY_KEYS = Object.freeze({
    roles: 'roles',
    turnos: 'turnos',
    tipos_seguimiento: 'tiposSeguimiento',
    estados_actividad_orientacion: 'estadosActividad',
    tipos_reporte_orientacion: 'tiposReporte',
    estados_reporte_orientacion: 'estadosReporte'
});

function crearError(message, code = 'PREFLIGHT_ERROR') {
    const error = new Error(message);
    error.name = 'MigrationPreflightError';
    error.code = code;
    return error;
}

function cargarDescriptor(ruta = DESCRIPTOR_PATH) {
    try {
        return JSON.parse(fs.readFileSync(ruta, 'utf8'));
    } catch {
        throw crearError('No fue posible cargar el descriptor v008.', 'DESCRIPTOR_INVALID');
    }
}

function validarDescriptor(descriptor) {
    if (!descriptor || descriptor.versionDescriptor !== 1 || descriptor.nombreLogico !== 'v008') {
        throw crearError('Descriptor v008 inválido.', 'DESCRIPTOR_INVALID');
    }
    if (!Array.isArray(descriptor.migracionesCubiertas)
        || descriptor.migracionesCubiertas.join(',') !== '001,002,003,004,005,006,007,008') {
        throw crearError('Cobertura de migraciones inválida.', 'DESCRIPTOR_INVALID');
    }
    if (!descriptor.tablas || Object.keys(descriptor.tablas).length !== 14) {
        throw crearError('El descriptor debe contener 14 tablas funcionales.', 'DESCRIPTOR_INVALID');
    }
    if (!Array.isArray(descriptor.tablasProhibidas) || !descriptor.columnasProhibidas) {
        throw crearError('El descriptor no declara prohibiciones estructurales.', 'DESCRIPTOR_INVALID');
    }
    return true;
}

function validarSqlLectura(sql) {
    if (typeof sql !== 'string') {
        throw crearError('Consulta no permitida.', 'READ_ONLY_BARRIER');
    }
    const texto = sql.trim();
    if (!/^(SELECT|WITH)\b/i.test(texto)) {
        throw crearError('La barrera rechazó una operación que no es de lectura.', 'READ_ONLY_BARRIER');
    }
    const sinTerminador = texto.endsWith(';') ? texto.slice(0, -1) : texto;
    if (sinTerminador.includes(';')) {
        throw crearError('La barrera rechazó múltiples sentencias.', 'READ_ONLY_BARRIER');
    }
    if (/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CALL|SET|USE|SHOW|DESCRIBE|EXPLAIN|LOCK\s+TABLES)\b/i.test(sinTerminador)) {
        throw crearError('La barrera detectó una palabra reservada no permitida.', 'READ_ONLY_BARRIER');
    }
    return true;
}

async function ejecutarConsultaLectura(adaptador, clave, parametros = []) {
    if (!Object.prototype.hasOwnProperty.call(QUERIES, clave)) {
        throw crearError('Consulta predefinida desconocida.', 'READ_ONLY_BARRIER');
    }
    const sql = QUERIES[clave];
    validarSqlLectura(sql);
    const resultado = await adaptador.execute(sql, parametros);
    return Array.isArray(resultado) && Array.isArray(resultado[0]) ? resultado[0] : resultado;
}

function campo(fila, nombre) {
    if (Object.prototype.hasOwnProperty.call(fila, nombre)) return fila[nombre];
    const clave = Object.keys(fila).find((item) => item.toLowerCase() === nombre.toLowerCase());
    return clave ? fila[clave] : undefined;
}

function normalizarNombre(valor) {
    return String(valor || '').toLowerCase();
}

function normalizarTipo(valor) {
    return String(valor || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizarDefault(valor) {
    if (valor === null || valor === undefined) return null;
    return String(valor).toLowerCase().replace(/current_timestamp\(\)/g, 'current_timestamp').trim();
}

function normalizarClausula(valor) {
    return String(valor || '')
        .toLowerCase()
        .replace(/`/g, '')
        .replace(/\(\s*to_days\(([^)]+)\)\s*-\s*to_days\(([^)]+)\)\s*\)/g, 'datediff($1, $2)')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizarExpresionGenerada(valor) {
    let expresion = normalizarClausula(valor)
        .replace(/\(\s*([a-z_][a-z0-9_]*\s+is\s+null)\s*\)/g, '$1');
    while (expresion.startsWith('(') && expresion.endsWith(')')) {
        expresion = expresion.slice(1, -1).trim();
    }
    return expresion;
}

function agruparIndices(filas) {
    const grupos = new Map();
    for (const fila of filas) {
        const tabla = normalizarNombre(campo(fila, 'TABLE_NAME'));
        const nombre = String(campo(fila, 'INDEX_NAME'));
        const clave = `${tabla}\u0000${nombre}`;
        if (!grupos.has(clave)) {
            grupos.set(clave, { nombre, unique: Number(campo(fila, 'NON_UNIQUE')) === 0, columnas: [] });
        }
        grupos.get(clave).columnas.push({
            orden: Number(campo(fila, 'SEQ_IN_INDEX')),
            nombre: normalizarNombre(campo(fila, 'COLUMN_NAME'))
        });
    }
    const porTabla = {};
    for (const [clave, indice] of grupos) {
        const tabla = clave.split('\u0000')[0];
        indice.columnas = indice.columnas.sort((a, b) => a.orden - b.orden).map((item) => item.nombre);
        if (!porTabla[tabla]) porTabla[tabla] = [];
        porTabla[tabla].push(indice);
    }
    return porTabla;
}

function agruparForeignKeys(filas) {
    const grupos = new Map();
    for (const fila of filas) {
        const tabla = normalizarNombre(campo(fila, 'TABLE_NAME'));
        const nombre = String(campo(fila, 'CONSTRAINT_NAME'));
        const clave = `${tabla}\u0000${nombre}`;
        if (!grupos.has(clave)) {
            grupos.set(clave, {
                columnas: [], tablaDestino: normalizarNombre(campo(fila, 'REFERENCED_TABLE_NAME')),
                columnasDestino: [], onUpdate: String(campo(fila, 'UPDATE_RULE')).toUpperCase(),
                onDelete: String(campo(fila, 'DELETE_RULE')).toUpperCase()
            });
        }
        const item = grupos.get(clave);
        item.columnas.push({ orden: Number(campo(fila, 'ORDINAL_POSITION')), nombre: normalizarNombre(campo(fila, 'COLUMN_NAME')) });
        item.columnasDestino.push({ orden: Number(campo(fila, 'ORDINAL_POSITION')), nombre: normalizarNombre(campo(fila, 'REFERENCED_COLUMN_NAME')) });
    }
    const porTabla = {};
    for (const [clave, fk] of grupos) {
        const tabla = clave.split('\u0000')[0];
        fk.columnas = fk.columnas.sort((a, b) => a.orden - b.orden).map((item) => item.nombre);
        fk.columnasDestino = fk.columnasDestino.sort((a, b) => a.orden - b.orden).map((item) => item.nombre);
        if (!porTabla[tabla]) porTabla[tabla] = [];
        porTabla[tabla].push(fk);
    }
    return porTabla;
}

function construirSnapshotDesdeFilas(datos) {
    const indices = agruparIndices(datos.indexes || []);
    const foreignKeys = agruparForeignKeys(datos.foreignKeys || []);
    const checks = {};
    for (const fila of datos.checks || []) {
        const tabla = normalizarNombre(campo(fila, 'TABLE_NAME'));
        if (!checks[tabla]) checks[tabla] = [];
        checks[tabla].push(normalizarClausula(campo(fila, 'CHECK_CLAUSE')));
    }

    const tablas = {};
    for (const fila of datos.tables || []) {
        const nombre = normalizarNombre(campo(fila, 'TABLE_NAME'));
        const collation = normalizarNombre(campo(fila, 'TABLE_COLLATION'));
        tablas[nombre] = {
            engine: normalizarNombre(campo(fila, 'ENGINE')),
            collation,
            charset: collation.split('_').slice(0, 1).join('_'),
            columnas: {}, indices: indices[nombre] || [],
            foreignKeys: foreignKeys[nombre] || [], checks: checks[nombre] || []
        };
    }
    for (const fila of datos.columns || []) {
        const tabla = normalizarNombre(campo(fila, 'TABLE_NAME'));
        if (!tablas[tabla]) continue;
        const nombre = normalizarNombre(campo(fila, 'COLUMN_NAME'));
        const tipo = normalizarTipo(campo(fila, 'COLUMN_TYPE'));
        tablas[tabla].columnas[nombre] = {
            tipo, unsigned: /\bunsigned\b/.test(tipo),
            nullable: String(campo(fila, 'IS_NULLABLE')).toUpperCase() === 'YES',
            default: normalizarDefault(campo(fila, 'COLUMN_DEFAULT')),
            extra: String(campo(fila, 'EXTRA') || '').toLowerCase(),
            generationExpression: normalizarExpresionGenerada(campo(fila, 'GENERATION_EXPRESSION')),
            ordinal: Number(campo(fila, 'ORDINAL_POSITION'))
        };
    }

    return {
        tablas,
        catalogos: datos.catalogos || {},
        controlRows: datos.controlRows || []
    };
}

function crearSnapshotCompatible(descriptor, opciones = {}) {
    const tablas = {};
    for (const [nombre, contrato] of Object.entries(descriptor.tablas)) {
        const columnas = {};
        contrato.columnas.forEach((columna, indice) => {
            columnas[columna.nombre] = {
                tipo: normalizarTipo(columna.tipo), unsigned: columna.unsigned,
                nullable: columna.nullable,
                default: Object.prototype.hasOwnProperty.call(columna, 'default') ? normalizarDefault(columna.default) : null,
                extra: String(columna.extra || '').toLowerCase(),
                generationExpression: normalizarExpresionGenerada(columna.generationExpression), ordinal: indice + 1
            };
        });
        const indices = [{ nombre: 'PRIMARY', unique: true, columnas: contrato.primaryKey }]
            .concat(contrato.indicesUnicos.map((item, indice) => ({ nombre: `uq_${nombre}_${indice}`, unique: true, columnas: item.columnas })))
            .concat(contrato.indices.map((item, indice) => ({ nombre: `idx_${nombre}_${indice}`, unique: false, columnas: item.columnas })));
        tablas[nombre] = {
            engine: contrato.engine, charset: contrato.charset, collation: contrato.collation,
            columnas, indices, foreignKeys: JSON.parse(JSON.stringify(contrato.foreignKeys)),
            checks: contrato.checks.map((item) => item.fragmentos.join(' '))
        };
    }
    if (opciones.control === 'empty' || opciones.control === 'complete') {
        tablas.schema_migrations = crearTablaControlCompatible();
    }
    return {
        tablas,
        catalogos: Object.fromEntries(Object.entries(descriptor.catalogosMinimos).map(([tabla, claves]) => [tabla, [...claves]])),
        controlRows: opciones.control === 'complete' ? (opciones.controlRows || []) : []
    };
}

function crearTablaControlCompatible() {
    const columnas = {
        version: { tipo: 'int unsigned', unsigned: true, nullable: false, default: null, extra: '', ordinal: 1 },
        archivo: { tipo: 'varchar(255)', unsigned: false, nullable: false, default: null, extra: '', ordinal: 2 },
        checksum_sha256: { tipo: 'char(64)', unsigned: false, nullable: false, default: null, extra: '', ordinal: 3 },
        tipo_registro: { tipo: 'varchar(20)', unsigned: false, nullable: false, default: null, extra: '', ordinal: 4 },
        aplicada_en: { tipo: 'timestamp', unsigned: false, nullable: false, default: 'current_timestamp', extra: '', ordinal: 5 },
        duracion_ms: { tipo: 'int unsigned', unsigned: true, nullable: true, default: null, extra: '', ordinal: 6 },
        lote_ejecucion: { tipo: 'char(36)', unsigned: false, nullable: true, default: null, extra: '', ordinal: 7 }
    };
    return {
        engine: 'innodb', charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci', columnas,
        indices: [
            { nombre: 'PRIMARY', unique: true, columnas: ['version'] },
            { nombre: 'uq_schema_migrations_archivo', unique: true, columnas: ['archivo'] }
        ], foreignKeys: [], checks: ['checksum_sha256 regexp ^[0-9a-f]{64}$', 'tipo_registro ejecutada baseline']
    };
}

function columnasIguales(a, b) {
    return a.length === b.length && a.every((valor, indice) => valor === b[indice]);
}

function contieneIndice(indices, columnas, unique) {
    return indices.some((indice) => indice.unique === unique && columnasIguales(indice.columnas, columnas));
}

function agregarRegla(resultado, codigo, seccion, ok, mensaje, severidad = 'ERROR') {
    resultado.reglas.push({ codigo, seccion, ok, mensaje, severidad });
}

function analizarFilasControl(manifiesto, filasControl) {
    const limite = manifiesto.legacyBaselineThrough;
    const entradas = new Map(manifiesto.migraciones.map((entrada) => [entrada.version, entrada]));
    const filas = new Map();

    for (const fila of filasControl) {
        const version = Number(campo(fila, 'version'));
        if (!Number.isInteger(version) || filas.has(version)) {
            throw crearError('Versiones duplicadas o inválidas en el control.', 'CONTROL_DUPLICATE_OR_INVALID_VERSION');
        }
        filas.set(version, fila);
    }

    for (let version = 0; version <= limite; version += 1) {
        const entrada = entradas.get(version);
        const fila = filas.get(version);
        const tipoEsperado = version === 0 ? 'EJECUTADA' : 'BASELINE';
        if (!entrada || !fila
            || campo(fila, 'archivo') !== entrada.archivo
            || campo(fila, 'checksum_sha256') !== entrada.checksumSha256
            || campo(fila, 'tipo_registro') !== tipoEsperado) {
            throw crearError('Baseline heredado incompleto o inválido.', 'BASELINE_PARTIAL');
        }
    }

    for (const [version, fila] of filas) {
        if (version <= limite) continue;
        const entrada = entradas.get(version);
        if (!entrada) throw crearError('Versión registrada desconocida.', 'UNKNOWN_APPLIED_VERSION');
        if (entrada.estado !== 'ACTIVE') throw crearError('Versión no ejecutable registrada.', 'NON_EXECUTABLE_RECORDED');
        if (campo(fila, 'archivo') !== entrada.archivo
            || campo(fila, 'checksum_sha256') !== entrada.checksumSha256
            || campo(fila, 'tipo_registro') !== 'EJECUTADA') {
            throw crearError('Registro de migración ACTIVE incompatible.', 'APPLIED_MIGRATION_INVALID');
        }
    }

    const activasPosteriores = manifiesto.migraciones
        .filter((entrada) => entrada.estado === 'ACTIVE' && entrada.version > limite)
        .sort((a, b) => a.version - b.version);
    let pendienteEncontrada = false;
    for (const entrada of activasPosteriores) {
        if (!filas.has(entrada.version)) pendienteEncontrada = true;
        else if (pendienteEncontrada) throw crearError('Migraciones ACTIVE aplicadas fuera de orden.', 'ACTIVE_PREDECESSOR_MISSING');
    }

    return {
        estado: pendienteEncontrada ? 'BASELINE_V008_COMPLETE' : 'MIGRATIONS_CURRENT',
        aplicadasPosteriores: activasPosteriores.filter((entrada) => filas.has(entrada.version)),
        pendientesPosteriores: activasPosteriores.filter((entrada) => !filas.has(entrada.version))
    };
}

function compararTabla(nombre, contrato, real, resultado) {
    const prefijo = nombre.toUpperCase();
    if (!real) {
        agregarRegla(resultado, `TABLE_${prefijo}_MISSING`, 'estructura', false, 'Tabla requerida ausente.');
        return;
    }
    agregarRegla(resultado, `TABLE_${prefijo}_PRESENT`, 'estructura', true, 'Tabla requerida presente.');
    agregarRegla(resultado, `ENGINE_${prefijo}`, 'estructura', real.engine === contrato.engine, 'Motor de tabla.');
    agregarRegla(resultado, `CHARSET_${prefijo}`, 'estructura', real.charset === contrato.charset, 'Charset de tabla.');
    agregarRegla(resultado, `COLLATION_${prefijo}`, 'estructura', real.collation === contrato.collation, 'Collation de tabla.');

    for (const columna of contrato.columnas) {
        const actual = real.columnas[columna.nombre];
        if (!actual) {
            agregarRegla(resultado, `COLUMN_${prefijo}_${columna.nombre.toUpperCase()}_MISSING`, 'estructura', false, 'Columna requerida ausente.');
            continue;
        }
        agregarRegla(resultado, `TYPE_${prefijo}_${columna.nombre.toUpperCase()}`, 'estructura', actual.tipo === normalizarTipo(columna.tipo), 'Tipo de columna.');
        agregarRegla(resultado, `UNSIGNED_${prefijo}_${columna.nombre.toUpperCase()}`, 'estructura', actual.unsigned === columna.unsigned, 'Atributo unsigned.');
        agregarRegla(resultado, `NULL_${prefijo}_${columna.nombre.toUpperCase()}`, 'estructura', actual.nullable === columna.nullable, 'Nullability.');
        if (Object.prototype.hasOwnProperty.call(columna, 'default')) {
            agregarRegla(resultado, `DEFAULT_${prefijo}_${columna.nombre.toUpperCase()}`, 'estructura', actual.default === normalizarDefault(columna.default), 'Default contractual.');
        }
        if (columna.extra) {
            const fragmentos = columna.extra.toLowerCase().split(/\s+/).filter(Boolean);
            agregarRegla(resultado, `EXTRA_${prefijo}_${columna.nombre.toUpperCase()}`, 'estructura', fragmentos.every((item) => actual.extra.includes(item)), 'Atributos adicionales.');
        }
        if (columna.generationExpression) {
            agregarRegla(resultado, `GENERATION_${prefijo}_${columna.nombre.toUpperCase()}`, 'integridad',
                normalizarExpresionGenerada(actual.generationExpression) === normalizarExpresionGenerada(columna.generationExpression), 'Expresión de columna generada.');
        }
    }

    agregarRegla(resultado, `PK_${prefijo}`, 'integridad', contieneIndice(real.indices, contrato.primaryKey, true), 'Clave primaria.');
    contrato.indicesUnicos.forEach((indice, posicion) => {
        agregarRegla(resultado, `UNIQUE_${prefijo}_${posicion + 1}`, 'integridad', contieneIndice(real.indices, indice.columnas, true), 'Índice único requerido.');
    });
    contrato.indices.forEach((indice, posicion) => {
        const equivalente = real.indices.some((actual) => columnasIguales(actual.columnas, indice.columnas));
        agregarRegla(resultado, `INDEX_${prefijo}_${posicion + 1}`, 'integridad', equivalente, 'Índice funcional requerido.');
    });
    contrato.foreignKeys.forEach((fk, posicion) => {
        const equivalente = real.foreignKeys.some((actual) => columnasIguales(actual.columnas, fk.columnas)
            && actual.tablaDestino === fk.tablaDestino
            && columnasIguales(actual.columnasDestino, fk.columnasDestino)
            && actual.onUpdate === fk.onUpdate
            && actual.onDelete === fk.onDelete);
        agregarRegla(resultado, `FK_${prefijo}_${posicion + 1}`, 'integridad', equivalente, 'Clave foránea requerida.');
    });
    contrato.checks.forEach((check, posicion) => {
        const presente = real.checks.some((clausula) => check.fragmentos.every((fragmento) => clausula.includes(normalizarClausula(fragmento))));
        agregarRegla(resultado, `CHECK_${prefijo}_${posicion + 1}`, 'integridad', presente, 'CHECK requerido.');
    });
}

function cargarContratoAplicado(entrada) {
    if (!entrada.execution || typeof entrada.execution.postconditionContract !== 'string') {
        throw crearError('Migracion ACTIVE sin contrato de postcondicion.', 'ACTIVE_CONTRACT_INVALID');
    }
    const ruta = path.resolve(PROJECT_ROOT, entrada.execution.postconditionContract);
    const raiz = path.resolve(PROJECT_ROOT, 'database', 'migration-contracts');
    if (!ruta.startsWith(`${raiz}${path.sep}`)
        || calcularChecksumCanonico(ruta) !== entrada.execution.postconditionChecksumSha256) {
        throw crearError('Contrato ACTIVE ausente o con checksum incompatible.', 'ACTIVE_CONTRACT_INVALID');
    }
    let contrato;
    try { contrato = JSON.parse(fs.readFileSync(ruta, 'utf8')); } catch {
        throw crearError('Contrato ACTIVE invalido.', 'ACTIVE_CONTRACT_INVALID');
    }
    if (Number(contrato.migracion) !== entrada.version || !contrato.tablas) {
        throw crearError('Contrato ACTIVE asociado a otra version.', 'ACTIVE_CONTRACT_INVALID');
    }
    return contrato;
}

function componerContratosAplicados(manifiesto, filasControl) {
    const analisis = analizarFilasControl(manifiesto, filasControl || []);
    const contratos = analisis.aplicadasPosteriores.map((entrada) => ({ entrada, contrato: cargarContratoAplicado(entrada) }));
    const tablasPermitidas = new Set();
    const columnasPermitidas = new Map();
    for (const { contrato } of contratos) {
        for (const [tabla, definicion] of Object.entries(contrato.tablas)) {
            tablasPermitidas.add(tabla);
            if (!columnasPermitidas.has(tabla)) columnasPermitidas.set(tabla, new Set());
            for (const columna of definicion.columnas || []) columnasPermitidas.get(tabla).add(columna.nombre);
        }
    }
    return { analisis, contratos, tablasPermitidas, columnasPermitidas };
}

function evaluarControl(snapshot, manifiesto, resultado) {
    const tabla = snapshot.tablas.schema_migrations;
    if (!tabla) {
        agregarRegla(resultado, 'CONTROL_NOT_INITIALIZED', 'control', true, 'Tabla de control ausente; bootstrap futuro requerido.', 'ADVERTENCIA');
        return 'CONTROL_NOT_INITIALIZED';
    }

    const esperado = crearTablaControlCompatible();
    const columnasOk = Object.entries(esperado.columnas).every(([nombre, columna]) => {
        const real = tabla.columnas[nombre];
        return real && real.tipo === columna.tipo && real.nullable === columna.nullable;
    });
    const indicesOk = contieneIndice(tabla.indices, ['version'], true) && contieneIndice(tabla.indices, ['archivo'], true);
    if (!columnasOk || !indicesOk) {
        agregarRegla(resultado, 'CONTROL_STRUCTURE_INCOMPATIBLE', 'control', false, 'La tabla de control es incompatible.');
        return 'PARTIAL_OR_INCONSISTENT';
    }
    agregarRegla(resultado, 'CONTROL_STRUCTURE_VALID', 'control', true, 'Estructura de control compatible.');

    if (snapshot.controlRows.length === 0) {
        agregarRegla(resultado, 'CONTROL_EMPTY', 'control', true, 'Tabla de control vacía; baseline futuro posible.', 'ADVERTENCIA');
        return 'CONTROL_EMPTY';
    }

    let analisis;
    try {
        analisis = analizarFilasControl(manifiesto, snapshot.controlRows);
    } catch {
        agregarRegla(resultado, 'CONTROL_BASELINE_PARTIAL_OR_INVALID', 'control', false, 'Baseline parcial o checksums incompatibles.');
        return 'PARTIAL_OR_INCONSISTENT';
    }
    agregarRegla(resultado, analisis.estado, 'control', true,
        analisis.estado === 'MIGRATIONS_CURRENT'
            ? 'Baseline válido y migraciones ACTIVE actuales aplicadas.'
            : 'Baseline v008 registrado; existen migraciones ACTIVE pendientes.');
    return analisis.estado;
}

function compararSnapshotConDescriptor(snapshot, descriptor, manifiesto) {
    validarDescriptor(descriptor);
    const resultado = { reglas: [], estadoControl: null, clasificacion: null };

    resultado.estadoControl = evaluarControl(snapshot, manifiesto, resultado);
    let composicion = { contratos: [], tablasPermitidas: new Set(), columnasPermitidas: new Map() };
    if (['BASELINE_V008_COMPLETE', 'MIGRATIONS_CURRENT'].includes(resultado.estadoControl)) {
        try {
            composicion = componerContratosAplicados(manifiesto, snapshot.controlRows);
            for (const { entrada, contrato } of composicion.contratos) {
                for (const [nombre, tabla] of Object.entries(contrato.tablas)) compararTabla(nombre, tabla, snapshot.tablas[nombre], resultado);
                agregarRegla(resultado, `ACTIVE_CONTRACT_${entrada.identificador}`, 'control', true, 'Contrato ACTIVE aplicado y validado.');
            }
        } catch {
            agregarRegla(resultado, 'ACTIVE_CONTRACT_INVALID', 'control', false, 'Contrato de migracion ACTIVE incompatible.');
        }
    }

    for (const [nombre, contrato] of Object.entries(descriptor.tablas)) {
        compararTabla(nombre, contrato, snapshot.tablas[nombre], resultado);
    }
    for (const tabla of descriptor.tablasProhibidas) {
        const permitida = composicion.tablasPermitidas.has(tabla);
        agregarRegla(resultado, `FORBIDDEN_TABLE_${tabla.toUpperCase()}`, 'ausencia-009-014', !snapshot.tablas[tabla] || permitida, 'Tabla prohibida ausente o autorizada por contrato ACTIVE.');
    }
    for (const [tabla, columnas] of Object.entries(descriptor.columnasProhibidas)) {
        for (const columna of columnas) {
            const existe = snapshot.tablas[tabla] && snapshot.tablas[tabla].columnas[columna];
            const permitida = composicion.columnasPermitidas.get(tabla)?.has(columna);
            agregarRegla(resultado, `FORBIDDEN_COLUMN_${tabla.toUpperCase()}_${columna.toUpperCase()}`, 'ausencia-009-014', !existe || permitida, 'Columna prohibida ausente o autorizada por contrato ACTIVE.');
        }
    }
    for (const [tabla, esperadas] of Object.entries(descriptor.catalogosMinimos)) {
        const presentes = new Set((snapshot.catalogos[tabla] || []).map(String));
        const faltantes = esperadas.filter((clave) => !presentes.has(clave));
        agregarRegla(resultado, `CATALOG_${tabla.toUpperCase()}`, 'catalogos', faltantes.length === 0,
            faltantes.length ? `Claves faltantes: ${faltantes.join(', ')}.` : 'Claves mínimas presentes.');
    }

    const fallidas = resultado.reglas.filter((regla) => !regla.ok && regla.severidad !== 'ADVERTENCIA').length;
    resultado.clasificacion = fallidas === 0
        ? (['BASELINE_V008_COMPLETE', 'MIGRATIONS_CURRENT'].includes(resultado.estadoControl)
            ? resultado.estadoControl : 'COMPATIBLE_FOR_FUTURE_BASELINE')
        : 'SCHEMA_DRIFT_DETECTED';
    resultado.total = resultado.reglas.length;
    resultado.aprobadas = resultado.reglas.filter((regla) => regla.ok && regla.severidad !== 'ADVERTENCIA').length;
    resultado.fallidas = fallidas;
    resultado.advertencias = resultado.reglas.filter((regla) => regla.severidad === 'ADVERTENCIA').length;
    return resultado;
}

function clasificarStatus(snapshot, descriptor, manifiesto) {
    return compararSnapshotConDescriptor(snapshot, descriptor, manifiesto).clasificacion;
}

async function consultarSnapshot(adaptador, descriptor) {
    const datos = {
        tables: await ejecutarConsultaLectura(adaptador, 'tables'),
        columns: await ejecutarConsultaLectura(adaptador, 'columns'),
        indexes: await ejecutarConsultaLectura(adaptador, 'indexes'),
        foreignKeys: await ejecutarConsultaLectura(adaptador, 'foreignKeys'),
        checks: await ejecutarConsultaLectura(adaptador, 'checks'),
        catalogos: {}, controlRows: []
    };
    const nombresTablas = new Set(datos.tables.map((fila) => normalizarNombre(campo(fila, 'TABLE_NAME'))));
    for (const [tabla, claveConsulta] of Object.entries(CATALOG_QUERY_KEYS)) {
        const claves = descriptor.catalogosMinimos[tabla];
        datos.catalogos[tabla] = nombresTablas.has(tabla)
            ? (await ejecutarConsultaLectura(adaptador, claveConsulta, claves)).map((fila) => String(campo(fila, 'clave')))
            : [];
    }
    if (nombresTablas.has('schema_migrations')) {
        datos.controlRows = await ejecutarConsultaLectura(adaptador, 'controlRows');
    }
    return construirSnapshotDesdeFilas(datos);
}

async function ejecutarConPool(pool, operacion) {
    let conexion;
    try {
        conexion = await pool.getConnection();
        return await operacion(conexion);
    } finally {
        if (conexion && typeof conexion.release === 'function') conexion.release();
        await pool.end();
    }
}

function cargarDependenciasConectadas() {
    require('dotenv').config({ quiet: true });
    return require('../config/database');
}

function imprimirAyuda(escribir) {
    escribir('Uso: node scripts/migrationPreflight.js <status|baseline-v008-check|help>');
    escribir('  status               Resume control y presencia de elementos prohibidos mediante SELECT.');
    escribir('  baseline-v008-check  Compara MySQL contra el descriptor v008 mediante SELECT.');
    escribir('  help                 Muestra esta ayuda.');
    escribir('N4B es de solo lectura: no crea control, no registra baseline y no ejecuta migraciones.');
}

function mensajeTecnico(error) {
    const codigo = error && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
        ? error.code : 'TECHNICAL_ERROR';
    return `Error técnico de preflight (${codigo}).`;
}

async function ejecutarCli(argumentos, salida = {}, dependencias = {}) {
    const escribir = salida.log || ((mensaje) => console.log(mensaje));
    const escribirError = salida.error || ((mensaje) => console.error(mensaje));
    const comando = argumentos[0] || 'help';

    if (comando === 'help') {
        imprimirAyuda(escribir);
        return 0;
    }
    if (!COMMANDS.has(comando)) {
        escribirError(`Comando no permitido o desconocido: ${comando}. Use help.`);
        return 2;
    }

    try {
        const manifiesto = cargarManifiesto();
        validarArchivosYChecksums(manifiesto);
        const descriptor = cargarDescriptor();
        validarDescriptor(descriptor);
        const pool = dependencias.pool || cargarDependenciasConectadas();

        return await ejecutarConPool(pool, async (conexion) => {
            const snapshot = dependencias.obtenerSnapshot
                ? await dependencias.obtenerSnapshot(conexion, descriptor)
                : await consultarSnapshot(conexion, descriptor);
            if (comando === 'status') {
                const estado = clasificarStatus(snapshot, descriptor, manifiesto);
                let composicion = { tablasPermitidas: new Set(), columnasPermitidas: new Map() };
                try { composicion = componerContratosAplicados(manifiesto, snapshot.controlRows); } catch { /* estado ya refleja la inconsistencia */ }
                const prohibidas = descriptor.tablasProhibidas.filter((tabla) => snapshot.tablas[tabla] && !composicion.tablasPermitidas.has(tabla)).length;
                const columnasProhibidas = Object.entries(descriptor.columnasProhibidas)
                    .flatMap(([tabla, columnas]) => columnas.filter((columna) => snapshot.tablas[tabla]
                        && snapshot.tablas[tabla].columnas[columna]
                        && !composicion.columnasPermitidas.get(tabla)?.has(columna))).length;
                escribir(`Estado estructural: ${estado}`);
                escribir(`Cantidad agregada de tablas del esquema: ${Object.keys(snapshot.tablas).length}`);
                escribir(`Tablas prohibidas detectadas: ${prohibidas}`);
                escribir(`Columnas prohibidas detectadas: ${columnasProhibidas}`);
                escribir('Operación de solo lectura; todas las consultas fueron SELECT.');
                if (estado === 'CONTROL_NOT_INITIALIZED' || estado === 'CONTROL_EMPTY') {
                    escribir('Se requiere baseline-v008-check antes de un futuro baseline.');
                }
                return estado === 'SCHEMA_DRIFT_DETECTED' || estado === 'PARTIAL_OR_INCONSISTENT' ? 1 : 0;
            }

            const resultado = compararSnapshotConDescriptor(snapshot, descriptor, manifiesto);
            escribir(`Resultado global: ${resultado.clasificacion}`);
            escribir(`Reglas: ${resultado.total}; aprobadas: ${resultado.aprobadas}; fallidas: ${resultado.fallidas}; advertencias: ${resultado.advertencias}.`);
            escribir(`Control de migraciones: ${resultado.estadoControl}`);
            for (const seccion of ['estructura', 'integridad', 'catalogos', 'ausencia-009-014', 'control']) {
                const reglas = resultado.reglas.filter((regla) => regla.seccion === seccion);
                escribir(`${seccion}: ${reglas.filter((regla) => regla.ok).length}/${reglas.length} verificaciones no fallidas.`);
            }
            for (const regla of resultado.reglas.filter((item) => !item.ok)) {
                escribir(`[${regla.severidad}] ${regla.codigo}`);
            }
            escribir('Operación de solo lectura; todas las consultas fueron SELECT.');
            return resultado.fallidas === 0 ? 0 : 1;
        });
    } catch (error) {
        escribirError(mensajeTecnico(error));
        return 2;
    }
}

module.exports = {
    DESCRIPTOR_PATH,
    QUERIES,
    cargarDescriptor,
    validarDescriptor,
    normalizarClausula,
    normalizarExpresionGenerada,
    validarSqlLectura,
    ejecutarConsultaLectura,
    construirSnapshotDesdeFilas,
    crearSnapshotCompatible,
    crearTablaControlCompatible,
    analizarFilasControl,
    cargarContratoAplicado,
    componerContratosAplicados,
    compararSnapshotConDescriptor,
    clasificarStatus,
    consultarSnapshot,
    ejecutarConPool,
    ejecutarCli
};

if (require.main === module) {
    ejecutarCli(process.argv.slice(2)).then((codigo) => {
        process.exitCode = codigo;
    });
}
