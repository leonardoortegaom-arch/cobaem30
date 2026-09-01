const actividadOrientacionModel = require('../models/actividadOrientacionModel');
const adjuntoActividadOrientacionModel = require('../models/adjuntoActividadOrientacionModel');
const crearMenuPorRol = require('../config/roleMenus');

const ESTADOS = new Set(['PENDIENTE', 'EN_PROCESO', 'REALIZADA', 'NO_REALIZADA', 'CANCELADA']);
const ESTADOS_ABIERTOS = new Set(['PENDIENTE', 'EN_PROCESO']);
const EXPLICACIONES = {
    PENDIENTE: 'La actividad está programada y todavía no ha comenzado.',
    EN_PROCESO: 'La actividad se encuentra actualmente en seguimiento.',
    REALIZADA: 'La actividad fue completada.',
    NO_REALIZADA: 'La actividad no pudo realizarse.',
    CANCELADA: 'La actividad fue cancelada.'
};

const textoSeguro = (valor) => typeof valor === 'string' ? valor.trim() : '';
const fechaLocalActual = () => {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
};
const enteroPositivo = (valor) => {
    if (typeof valor !== 'string' || !/^\d+$/.test(valor)) return null;
    const numero = Number(valor);
    return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
};
const crearMenuActividades = () => crearMenuPorRol('ALUMNO', { dashboardActivo: false })
    .map((item) => ({ ...item, activo: item.url === '/alumno/actividades' }));
const clasificarTemporalmente = (actividad, fechaActual) => {
    if (!ESTADOS_ABIERTOS.has(actividad.estado_clave)) return 'Cerrada';
    if (actividad.fecha_asignacion < fechaActual) return 'Vencida';
    if (actividad.fecha_asignacion === fechaActual) return 'Programada para hoy';
    return 'Próxima';
};
const actividadSegura = (actividad, fechaActual, { completa = false } = {}) => ({
    id: actividad.id,
    titulo: actividad.titulo,
    instrucciones: actividad.instrucciones,
    resumenInstrucciones: completa || actividad.instrucciones.length <= 180
        ? actividad.instrucciones
        : `${actividad.instrucciones.slice(0, 177)}…`,
    fechaAsignacion: actividad.fecha_asignacion,
    fechaRealizacion: actividad.fecha_realizacion,
    estadoClave: actividad.estado_clave,
    estadoNombre: actividad.estado_nombre,
    orientadorNombre: actividad.orientador_nombre,
    indicadorTemporal: clasificarTemporalmente(actividad, fechaActual),
    explicacionEstado: EXPLICACIONES[actividad.estado_clave] || 'Consulta el estado actual de esta actividad.'
});

const listarActividades = async (req, res) => {
    const alumnoUsuarioId = Number(req.session.usuario.id);
    const fechaActual = fechaLocalActual();
    const q = textoSeguro(req.query.q).slice(0, 100);
    const estadoSolicitado = textoSeguro(req.query.estado).toUpperCase();
    const estadoClave = ESTADOS.has(estadoSolicitado) ? estadoSolicitado : undefined;
    const paginaSolicitada = enteroPositivo(typeof req.query.pagina === 'string' ? req.query.pagina : '') || 1;
    const limite = 10;
    const filtrosModelo = { busqueda: q, estadoClave };

    try {
        const [resumen, totalRegistros] = await Promise.all([
            actividadOrientacionModel.obtenerResumenPorAlumno(alumnoUsuarioId, fechaActual),
            actividadOrientacionModel.contarPorAlumno(alumnoUsuarioId, filtrosModelo)
        ]);
        const totalPaginas = Math.max(1, Math.ceil(totalRegistros / limite));
        const paginaActual = Math.min(paginaSolicitada, totalPaginas);
        const resultados = await actividadOrientacionModel.listarPorAlumnoPaginado(alumnoUsuarioId, {
            ...filtrosModelo,
            fechaActual,
            limite,
            offset: (paginaActual - 1) * limite
        });
        const actividades = resultados.map((actividad) => actividadSegura(actividad, fechaActual));
        const filtros = { q, estado: estadoClave || '' };
        const crearUrl = (pagina) => {
            const parametros = new URLSearchParams();
            if (q) parametros.set('q', q);
            if (estadoClave) parametros.set('estado', estadoClave);
            parametros.set('pagina', String(pagina));
            return `/alumno/actividades?${parametros.toString()}`;
        };
        const enlaces = Array.from({ length: totalPaginas }, (_, indice) => ({
            numero: indice + 1,
            url: crearUrl(indice + 1),
            actual: indice + 1 === paginaActual
        }));

        res.render('alumno/actividades/index', {
            title: 'Mis actividades | COBAEM 30',
            menuItems: crearMenuActividades(),
            resumen,
            actividades,
            filtros,
            paginacion: {
                paginaActual,
                totalPaginas,
                totalRegistros,
                tieneAnterior: paginaActual > 1,
                tieneSiguiente: paginaActual < totalPaginas,
                urlAnterior: paginaActual > 1 ? crearUrl(paginaActual - 1) : null,
                urlSiguiente: paginaActual < totalPaginas ? crearUrl(paginaActual + 1) : null,
                enlaces
            }
        });
    } catch {
        res.status(503).send('No fue posible cargar tus actividades. Inténtalo nuevamente.');
    }
};

const mostrarDetalle = async (req, res) => {
    const actividadId = enteroPositivo(req.params.actividadId);
    if (!actividadId) {
        res.status(404).send('Actividad no encontrada.');
        return;
    }

    try {
        const resultado = await actividadOrientacionModel.buscarDetallePorIdYAlumno(
            actividadId,
            Number(req.session.usuario.id)
        );
        if (!resultado) {
            res.status(404).send('Actividad no encontrada.');
            return;
        }
        const actividad = actividadSegura(resultado, fechaLocalActual(), { completa: true });
        const adjuntosResultado = await adjuntoActividadOrientacionModel.listarPorActividadYAlumno(
            actividadId,
            Number(req.session.usuario.id)
        );
        const estadoAbierto = ESTADOS_ABIERTOS.has(actividad.estadoClave);
        const adjuntos = adjuntosResultado.map((adjunto) => ({
            id: adjunto.id,
            nombreOriginal: adjunto.nombre_original,
            extension: adjunto.extension,
            mimeType: adjunto.mime_type,
            tamanoBytes: Number(adjunto.tamano_bytes),
            creadoEn: adjunto.creado_en,
            puedeEliminar: estadoAbierto && Boolean(adjunto.puede_eliminar)
        }));
        const bytesUtilizados = adjuntos.reduce((total, adjunto) => total + adjunto.tamanoBytes, 0);
        res.render('alumno/actividades/detalle', {
            title: 'Detalle de actividad | COBAEM 30',
            menuItems: crearMenuActividades(),
            actividad,
            adjuntos,
            evidencia: {
                cantidadActual: adjuntos.length,
                bytesUtilizados,
                maximoArchivos: 5,
                maximoBytes: 100 * 1024 * 1024,
                puedeAdjuntar: estadoAbierto && adjuntos.length < 5 && bytesUtilizados < 100 * 1024 * 1024,
                mensaje: req.query.evidencia === 'eliminada'
                    ? 'La evidencia se eliminó correctamente.'
                    : null
            }
        });
    } catch {
        res.status(503).send('No fue posible cargar la actividad. Inténtalo nuevamente.');
    }
};

module.exports = { listarActividades, mostrarDetalle };
