const alumnoModel = require('../models/alumnoModel');
const estadoActividadOrientacionModel = require('../models/estadoActividadOrientacionModel');
const actividadOrientacionModel = require('../models/actividadOrientacionModel');
const adjuntoActividadOrientacionModel = require('../models/adjuntoActividadOrientacionModel');
const orientadorAlcanceModel = require('../models/orientadorAlcanceModel');
const adjuntoActividadStorageService = require('../services/adjuntoActividadStorageService');
const fs = require('fs');
const crearMenuPorRol = require('../config/roleMenus');

const normalizarTexto = (valor) => typeof valor === 'string' ? valor.trim() : '';

const convertirIdPositivo = (valor) => {
    if (!/^\d+$/.test(valor)) return null;

    const id = Number(valor);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const obtenerFechaActual = () => {
    const ahora = new Date();
    const anio = ahora.getFullYear();
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    const dia = String(ahora.getDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
};

const esFechaReal = (valor) => {
    const coincidencia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
    if (!coincidencia) return false;

    const anio = Number(coincidencia[1]);
    const mes = Number(coincidencia[2]);
    const dia = Number(coincidencia[3]);
    const fecha = new Date(Date.UTC(anio, mes - 1, dia));
    return fecha.getUTCFullYear() === anio
        && fecha.getUTCMonth() === mes - 1
        && fecha.getUTCDate() === dia;
};

const TRANSICIONES_PERMITIDAS = Object.freeze({
    PENDIENTE: Object.freeze(['EN_PROCESO', 'NO_REALIZADA', 'CANCELADA']),
    EN_PROCESO: Object.freeze(['REALIZADA', 'NO_REALIZADA', 'CANCELADA']),
    REALIZADA: Object.freeze(['RECHAZADA']),
    RECHAZADA: Object.freeze([]),
    NO_REALIZADA: Object.freeze([]),
    CANCELADA: Object.freeze([])
});

const ESTADOS_TERMINALES = new Set(['NO_REALIZADA', 'CANCELADA', 'RECHAZADA']);

const crearMenuOrientadorAlumnos = () => crearMenuPorRol(
    'ORIENTADOR',
    { dashboardActivo: false }
).map((item) => ({ ...item, activo: item.url === '/orientador/alumnos' }));

const crearAlumnoSeguro = (resultado) => ({
    nombreCompleto: normalizarTexto(resultado.nombre_completo),
    matricula: resultado.matricula,
    grupoClave: resultado.grupo_clave,
    semestre: resultado.semestre,
    turno: resultado.turno_nombre,
    cicloEscolar: resultado.ciclo_escolar,
    correo: resultado.correo,
    usuarioActivo: Boolean(resultado.usuario_activo)
});

const EXPLICACIONES_ESTADO = Object.freeze({
    PENDIENTE: 'La actividad está programada y todavía no ha comenzado.',
    EN_PROCESO: 'La actividad se encuentra actualmente en seguimiento.',
    REALIZADA: 'La actividad fue completada.',
    RECHAZADA: 'La evidencia requiere correcciones y puede volver a enviarse.',
    NO_REALIZADA: 'La actividad no pudo realizarse.',
    CANCELADA: 'La actividad fue cancelada.'
});

const formatearBytes = (bytes) => {
    const total = Number(bytes);
    if (!Number.isFinite(total) || total <= 0) return '0 B';
    const unidades = ['B', 'KB', 'MB', 'GB'];
    const indice = Math.min(Math.floor(Math.log(total) / Math.log(1024)), unidades.length - 1);
    const valor = total / (1024 ** indice);
    return `${valor.toFixed(indice === 0 ? 0 : 1)} ${unidades[indice]}`;
};

const obtenerTipoLegible = (mimeType) => {
    if (mimeType.startsWith('image/')) return 'Imagen';
    if (mimeType.startsWith('video/')) return 'Video';
    if (mimeType === 'application/pdf') return 'Documento PDF';
    if (mimeType.includes('wordprocessingml')) return 'Documento Word';
    if (mimeType.includes('spreadsheetml')) return 'Hoja de cálculo Excel';
    if (mimeType.includes('presentationml')) return 'Presentación PowerPoint';
    return 'Archivo';
};

const obtenerIndicadorTemporal = (actividad, fechaActual = obtenerFechaActual()) => {
    if (ESTADOS_TERMINALES.has(actividad.estado_clave)) return 'Cerrada';
    if (actividad.fecha_asignacion < fechaActual) return 'Vencida';
    if (actividad.fecha_asignacion === fechaActual) return 'Programada para hoy';
    return 'Próxima';
};

const cargarContextoConsulta = async (req, res) => {
    const alumnoId = convertirIdPositivo(req.params.id);
    const actividadId = convertirIdPositivo(req.params.actividadId);
    if (!alumnoId || !actividadId) {
        res.status(404).send('Actividad no encontrada.');
        return null;
    }

    const resultadoAlumno = await alumnoModel.buscarDetalleParaOrientadorPorUsuarioId(alumnoId, req.session.usuario.id);
    if (!resultadoAlumno) {
        res.status(404).send('Alumno no encontrado.');
        return null;
    }

    const actividad = await actividadOrientacionModel.buscarDetalleParaOrientador(
        actividadId,
        alumnoId,
        req.session.usuario.id
    );
    if (!actividad) {
        res.status(404).send('Actividad no encontrada.');
        return null;
    }
    if (!Boolean(actividad.es_responsable)) {
        res.status(403).send('No tienes autorización para consultar esta actividad.');
        return null;
    }

    return {
        alumnoId,
        actividadId,
        alumno: crearAlumnoSeguro(resultadoAlumno),
        actividad
    };
};

const mostrarDetalle = async (req, res) => {
    try {
        const contexto = await cargarContextoConsulta(req, res);
        if (!contexto) return;

        const rows = await adjuntoActividadOrientacionModel.listarPorActividadYOrientador(
            contexto.actividadId,
            contexto.alumnoId,
            req.session.usuario.id
        );
        const evidencias = rows.map((adjunto) => ({
            id: adjunto.id,
            nombreOriginal: adjunto.nombre_original,
            extension: adjunto.extension,
            tipo: obtenerTipoLegible(adjunto.mime_type),
            tamano: formatearBytes(adjunto.tamano_bytes),
            creadoEn: adjunto.creado_en
        }));
        const totalBytes = rows.reduce((total, adjunto) => total + Number(adjunto.tamano_bytes || 0), 0);
        const actividad = crearActividadSegura(contexto.actividad);

        res.render('orientador/actividades/detalle', {
            title: 'Detalle de actividad | COBAEM 30',
            menuItems: crearMenuOrientadorAlumnos(),
            alumno: contexto.alumno,
            alumnoId: contexto.alumnoId,
            actividad,
            cerrada: ESTADOS_TERMINALES.has(actividad.estadoClave),
            indicadorTemporal: obtenerIndicadorTemporal(contexto.actividad),
            explicacionEstado: EXPLICACIONES_ESTADO[actividad.estadoClave] || 'Consulta el estado actual de la actividad.',
            evidencias,
            resumenEvidencias: {
                cantidad: evidencias.length,
                espacioUtilizado: formatearBytes(totalBytes)
            }
        });
    } catch {
        res.status(503).send('No fue posible consultar la actividad. Inténtalo nuevamente.');
    }
};

const descargarEvidencia = async (req, res) => {
    const adjuntoId = convertirIdPositivo(req.params.adjuntoId);
    if (!adjuntoId) {
        res.status(404).send('Evidencia no encontrada.');
        return;
    }

    try {
        const contexto = await cargarContextoConsulta(req, res);
        if (!contexto) return;

        const adjunto = await adjuntoActividadOrientacionModel.buscarParaDescargaPorOrientador(
            adjuntoId,
            contexto.actividadId,
            contexto.alumnoId,
            req.session.usuario.id
        );
        if (!adjunto) {
            res.status(404).send('Evidencia no encontrada.');
            return;
        }

        let archivo;
        try {
            archivo = await adjuntoActividadStorageService.getDownloadFile({
                storageKey: adjunto.clave_almacenamiento,
                extension: adjunto.extension
            });
        } catch {
            res.status(404).send('No fue posible localizar la evidencia solicitada.');
            return;
        }

        const nombre = adjuntoActividadStorageService.sanitizeOriginalName(adjunto.nombre_original);
        res.attachment(nombre);
        res.set({
            'Content-Type': adjunto.mime_type,
            'Content-Length': String(archivo.size),
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff'
        });
        const stream = fs.createReadStream(archivo.filePath);
        stream.on('error', () => {
            if (!res.headersSent) res.status(500).send('No fue posible descargar la evidencia.');
            else res.destroy();
        });
        stream.pipe(res);
    } catch {
        if (!res.headersSent) {
            res.status(503).send('No fue posible consultar la evidencia. Inténtalo nuevamente.');
        }
    }
};

const cargarAlumnoActivo = async (id, orientadorId, res) => {
    const resultado = await alumnoModel.buscarDetalleParaOrientadorPorUsuarioId(id, orientadorId);
    if (!resultado) {
        res.status(404).send('Alumno no encontrado.');
        return null;
    }

    if (!resultado.usuario_activo) {
        res.status(403).send('No es posible programar actividades para una cuenta inactiva.');
        return null;
    }

    return crearAlumnoSeguro(resultado);
};

const renderizarFormulario = (res, {
    status = 200,
    alumno,
    alumnoId,
    datos,
    error = null
}) => res.status(status).render('orientador/actividades/nueva', {
    title: 'Programar actividad | COBAEM 30',
    menuItems: crearMenuOrientadorAlumnos(),
    alumno,
    alumnoId,
    datos,
    error
});

const mostrarFormulario = async (req, res) => {
    const alumnoId = convertirIdPositivo(req.params.id);
    if (!alumnoId) {
        res.status(404).send('Alumno no encontrado.');
        return;
    }

    try {
        const alumno = await cargarAlumnoActivo(alumnoId, req.session.usuario.id, res);
        if (!alumno) return;

        renderizarFormulario(res, {
            alumno,
            alumnoId,
            datos: {
                titulo: '',
                descripcion: '',
                fecha_programada: obtenerFechaActual()
            }
        });
    } catch {
        res.status(503).send('No fue posible cargar el formulario de actividad.');
    }
};

const crearActividad = async (req, res) => {
    const alumnoId = convertirIdPositivo(req.params.id);
    if (!alumnoId) {
        res.status(404).send('Alumno no encontrado.');
        return;
    }

    const orientadorId = req.session.usuario.id;
    const datos = {
        titulo: normalizarTexto(req.body.titulo),
        descripcion: normalizarTexto(req.body.descripcion),
        fecha_programada: normalizarTexto(req.body.fecha_programada)
    };

    try {
        const alumno = await cargarAlumnoActivo(alumnoId, orientadorId, res);
        if (!alumno) return;

        const responderValidacion = (mensaje) => renderizarFormulario(res, {
            status: 422,
            alumno,
            alumnoId,
            datos,
            error: mensaje
        });

        if (!datos.titulo) {
            responderValidacion('El título es obligatorio.');
            return;
        }

        if (datos.titulo.length > 150) {
            responderValidacion('El título no puede superar 150 caracteres.');
            return;
        }

        if (!datos.descripcion) {
            responderValidacion('La descripción es obligatoria.');
            return;
        }

        if (Buffer.byteLength(datos.descripcion, 'utf8') > 65535) {
            responderValidacion('La descripción supera la longitud permitida.');
            return;
        }

        if (!esFechaReal(datos.fecha_programada)) {
            responderValidacion('La fecha programada no es válida.');
            return;
        }

        if (datos.fecha_programada < obtenerFechaActual()) {
            responderValidacion('La fecha programada no puede ser anterior a la fecha actual.');
            return;
        }

        const estadoPendiente = await estadoActividadOrientacionModel.buscarPorClave('PENDIENTE');
        if (!estadoPendiente) {
            res.status(503).send('No fue posible determinar el estado inicial de la actividad.');
            return;
        }

        const actividadId = await actividadOrientacionModel.crearAutorizada({
            alumno_usuario_id: alumnoId,
            orientador_usuario_id: orientadorId,
            estado_id: estadoPendiente.id,
            titulo: datos.titulo,
            instrucciones: datos.descripcion,
            fecha_asignacion: datos.fecha_programada
        });

        if (!actividadId) return res.status(404).send('Alumno no encontrado.');

        res.redirect(`/orientador/alumnos/${alumnoId}?actividad=creada`);
    } catch {
        res.status(503).send('No fue posible programar la actividad.');
    }
};

const cargarContextoEstado = async (req, res) => {
    const alumnoId = convertirIdPositivo(req.params.id);
    const actividadId = convertirIdPositivo(req.params.actividadId);
    if (!alumnoId || !actividadId) {
        res.status(404).send('Actividad no encontrada.');
        return null;
    }

    const alumno = await cargarAlumnoActivo(alumnoId, req.session.usuario.id, res);
    if (!alumno) return null;

    const actividad = await actividadOrientacionModel.buscarPorIdYAlumnoConEstado(
        actividadId,
        alumnoId
    );
    if (!actividad) {
        res.status(404).send('Actividad no encontrada.');
        return null;
    }

    if (Number(actividad.orientador_usuario_id) !== Number(req.session.usuario.id)) {
        res.status(403).send('No tienes autorización para modificar esta actividad.');
        return null;
    }

    return { alumnoId, actividadId, alumno, actividad };
};

const crearActividadSegura = (actividad) => ({
    id: actividad.id,
    titulo: actividad.titulo,
    instrucciones: actividad.instrucciones,
    fechaAsignacion: actividad.fecha_asignacion,
    fechaRealizacion: actividad.fecha_realizacion,
    estadoClave: actividad.estado_clave,
    estadoNombre: actividad.estado_nombre,
    orientadorNombre: normalizarTexto(actividad.orientador_nombre)
});

const mostrarFormularioEstado = async (req, res) => {
    try {
        const contexto = await cargarContextoEstado(req, res);
        if (!contexto) return;

        const clavesPermitidas = TRANSICIONES_PERMITIDAS[contexto.actividad.estado_clave];
        if (!clavesPermitidas) {
            res.status(422).send('El estado actual de la actividad no es válido.');
            return;
        }

        const opciones = await estadoActividadOrientacionModel.buscarPorClaves(clavesPermitidas);
        if (opciones.length !== clavesPermitidas.length) {
            res.status(503).send('No fue posible cargar los estados disponibles.');
            return;
        }

        res.render('orientador/actividades/estado', {
            title: 'Actualizar estado de actividad | COBAEM 30',
            menuItems: crearMenuOrientadorAlumnos(),
            alumno: contexto.alumno,
            alumnoId: contexto.alumnoId,
            actividad: crearActividadSegura(contexto.actividad),
            opciones,
            cerrada: ESTADOS_TERMINALES.has(contexto.actividad.estado_clave),
            error: null
        });
    } catch {
        res.status(503).send('No fue posible cargar el estado de la actividad.');
    }
};

const actualizarEstado = async (req, res) => {
    try {
        const contexto = await cargarContextoEstado(req, res);
        if (!contexto) return;

        const clavesPermitidas = TRANSICIONES_PERMITIDAS[contexto.actividad.estado_clave];
        if (!clavesPermitidas || clavesPermitidas.length === 0) {
            res.status(422).send('La actividad está cerrada y su estado no puede modificarse.');
            return;
        }

        const estadoDestinoClave = normalizarTexto(req.body.estado).toLocaleUpperCase('es-MX');
        if (!clavesPermitidas.includes(estadoDestinoClave)) {
            res.status(422).send('La transición de estado solicitada no está permitida.');
            return;
        }

        const fechaActual = obtenerFechaActual();
        if (
            (estadoDestinoClave === 'REALIZADA' || estadoDestinoClave === 'NO_REALIZADA')
            && fechaActual < contexto.actividad.fecha_asignacion
        ) {
            res.status(422).send('Este estado no puede asignarse antes de la fecha programada.');
            return;
        }

        let resultado;
        if (estadoDestinoClave === 'RECHAZADA') {
            resultado = await actividadOrientacionModel.rechazarRealizadaAutorizada({
                actividadId: contexto.actividadId,
                alumnoUsuarioId: contexto.alumnoId,
                orientadorUsuarioId: req.session.usuario.id
            });
        } else {
            const estadoDestino = await estadoActividadOrientacionModel.buscarPorClave(estadoDestinoClave);
            if (!estadoDestino) {
                res.status(503).send('No fue posible determinar el nuevo estado de la actividad.');
                return;
            }
            resultado = await actividadOrientacionModel.actualizarEstadoCondicional({
                actividadId: contexto.actividadId,
                alumnoUsuarioId: contexto.alumnoId,
                orientadorUsuarioId: req.session.usuario.id,
                estadoIdAnterior: contexto.actividad.estado_id,
                estadoIdNuevo: estadoDestino.id,
                fechaRealizacion: estadoDestinoClave === 'REALIZADA' ? fechaActual : null
            });
        }

        if (resultado.affectedRows === 0) {
            const conservaAlcance = await orientadorAlcanceModel.puedeAccederAlumno(
                req.session.usuario.id, contexto.alumnoId
            );
            if (!conservaAlcance) return res.status(404).send('Actividad no encontrada.');
            res.status(409).send('El estado de la actividad cambió. Recarga la página e inténtalo nuevamente.');
            return;
        }

        res.redirect(`/orientador/alumnos/${contexto.alumnoId}?actividad=estado-actualizado`);
    } catch {
        res.status(503).send('No fue posible actualizar el estado de la actividad.');
    }
};

module.exports = {
    mostrarFormulario,
    crearActividad,
    mostrarFormularioEstado,
    actualizarEstado,
    mostrarDetalle,
    descargarEvidencia
};
