const alumnoModel = require('../models/alumnoModel');
const tipoReporteOrientacionModel = require('../models/tipoReporteOrientacionModel');
const estadoReporteOrientacionModel = require('../models/estadoReporteOrientacionModel');
const reporteEscritoOrientacionModel = require('../models/reporteEscritoOrientacionModel');
const orientadorAlcanceModel = require('../models/orientadorAlcanceModel');
const crearMenuPorRol = require('../config/roleMenus');

const TIPOS_PERMITIDOS = new Set(['ACADEMICO', 'CONDUCTUAL']);

const normalizarTexto = (valor) => typeof valor === 'string' ? valor.trim() : '';

const convertirIdPositivo = (valor) => {
    if (typeof valor !== 'string' || !/^\d+$/.test(valor)) return null;
    const id = Number(valor);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const obtenerFechaLocal = () => {
    const fecha = new Date();
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
};

const obtenerPrimerDiaMes = () => `${obtenerFechaLocal().slice(0, 7)}-01`;

const descomponerFecha = (valor) => {
    const coincidencia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
    if (!coincidencia) return null;
    const anio = Number(coincidencia[1]);
    const mes = Number(coincidencia[2]);
    const dia = Number(coincidencia[3]);
    const fecha = new Date(Date.UTC(anio, mes - 1, dia));
    return fecha.getUTCFullYear() === anio
        && fecha.getUTCMonth() === mes - 1
        && fecha.getUTCDate() === dia
        ? fecha
        : null;
};

const crearMenuReportes = () => crearMenuPorRol(
    'ORIENTADOR',
    { dashboardActivo: false }
).map((item) => ({ ...item, activo: item.url === '/orientador/reportes' }));

const crearAlumnoSeguro = (resultado) => ({
    nombre: normalizarTexto(resultado.nombre_completo),
    matricula: resultado.matricula,
    grupo: resultado.grupo_clave,
    semestre: resultado.semestre,
    turno: resultado.turno_nombre,
    ciclo: resultado.ciclo_escolar,
    activo: Boolean(resultado.usuario_activo)
});

const crearAlumnoDesdeReporte = (reporte) => ({
    nombre: normalizarTexto(reporte.alumno_nombre),
    matricula: reporte.matricula,
    grupo: reporte.grupo_clave,
    semestre: reporte.semestre,
    turno: reporte.turno_nombre,
    ciclo: reporte.ciclo_escolar,
    activo: Boolean(reporte.alumno_activo)
});

const leerDatos = (body = {}) => ({
    tipo: normalizarTexto(body.tipo).toLocaleUpperCase('es-MX'),
    periodoDesde: normalizarTexto(body.periodo_desde),
    periodoHasta: normalizarTexto(body.periodo_hasta),
    motivo: normalizarTexto(body.motivo),
    contenido: normalizarTexto(body.contenido),
    conclusiones: normalizarTexto(body.conclusiones),
    recomendaciones: normalizarTexto(body.recomendaciones)
});

const longitudTexto = (valor) => Array.from(valor).length;

const validarDatos = (datos) => {
    if (!TIPOS_PERMITIDOS.has(datos.tipo)) return 'Selecciona un tipo de reporte válido.';
    const desde = descomponerFecha(datos.periodoDesde);
    const hasta = descomponerFecha(datos.periodoHasta);
    if (!desde || !hasta) return 'El periodo debe contener fechas reales con formato YYYY-MM-DD.';
    if (datos.periodoDesde > datos.periodoHasta) return 'La fecha inicial no puede ser posterior a la fecha final.';
    const diasInclusivos = Math.floor((hasta - desde) / 86400000) + 1;
    if (diasInclusivos > 366) return 'El periodo no puede superar 366 días.';
    if (longitudTexto(datos.motivo) < 5 || longitudTexto(datos.motivo) > 250) return 'El motivo debe contener entre 5 y 250 caracteres.';
    if (longitudTexto(datos.contenido) < 20 || longitudTexto(datos.contenido) > 20000) return 'El contenido debe contener entre 20 y 20,000 caracteres.';
    if (longitudTexto(datos.conclusiones) > 10000) return 'Las conclusiones no pueden superar 10,000 caracteres.';
    if (longitudTexto(datos.recomendaciones) > 10000) return 'Las recomendaciones no pueden superar 10,000 caracteres.';
    return null;
};

const datosParaVista = (datos) => ({
    tipo: datos.tipo,
    periodo_desde: datos.periodoDesde,
    periodo_hasta: datos.periodoHasta,
    motivo: datos.motivo,
    contenido: datos.contenido,
    conclusiones: datos.conclusiones,
    recomendaciones: datos.recomendaciones
});

const renderizarNuevo = (res, {
    status = 200,
    alumno,
    alumnoId,
    tipos,
    datos,
    error = null
}) => res.status(status).render('orientador/reportes/nuevo', {
    title: 'Redactar reporte | COBAEM 30',
    menuItems: crearMenuReportes(),
    alumno,
    alumnoId,
    tipos,
    datos,
    error
});

const mostrarNuevo = async (req, res) => {
    const alumnoId = convertirIdPositivo(req.params.id);
    if (!alumnoId) return res.status(404).send('Alumno no encontrado.');
    try {
        const [resultadoAlumno, tipos] = await Promise.all([
            alumnoModel.buscarDetalleParaOrientadorPorUsuarioId(alumnoId, req.session.usuario.id),
            tipoReporteOrientacionModel.listarTodos()
        ]);
        if (!resultadoAlumno) return res.status(404).send('Alumno no encontrado.');
        return renderizarNuevo(res, {
            alumno: crearAlumnoSeguro(resultadoAlumno),
            alumnoId,
            tipos,
            datos: {
                tipo: '',
                periodo_desde: obtenerPrimerDiaMes(),
                periodo_hasta: obtenerFechaLocal(),
                motivo: '',
                contenido: '',
                conclusiones: '',
                recomendaciones: ''
            }
        });
    } catch {
        return res.status(503).send('No fue posible cargar el editor del reporte. Inténtalo nuevamente.');
    }
};

const crearBorrador = async (req, res) => {
    const alumnoId = convertirIdPositivo(req.params.id);
    if (!alumnoId) return res.status(404).send('Alumno no encontrado.');
    const datos = leerDatos(req.body);
    try {
        const [resultadoAlumno, tipos] = await Promise.all([
            alumnoModel.buscarDetalleParaOrientadorPorUsuarioId(alumnoId, req.session.usuario.id),
            tipoReporteOrientacionModel.listarTodos()
        ]);
        if (!resultadoAlumno) return res.status(404).send('Alumno no encontrado.');
        const alumno = crearAlumnoSeguro(resultadoAlumno);
        const error = validarDatos(datos);
        if (error) {
            return renderizarNuevo(res, {
                status: 422,
                alumno,
                alumnoId,
                tipos,
                datos: datosParaVista(datos),
                error
            });
        }

        const [tipo, estadoBorrador] = await Promise.all([
            tipoReporteOrientacionModel.buscarPorClave(datos.tipo),
            estadoReporteOrientacionModel.buscarPorClave('BORRADOR')
        ]);
        if (!tipo) {
            return renderizarNuevo(res, {
                status: 422,
                alumno,
                alumnoId,
                tipos,
                datos: datosParaVista(datos),
                error: 'Selecciona un tipo de reporte válido.'
            });
        }
        if (!estadoBorrador) return res.status(503).send('No fue posible determinar el estado inicial del reporte.');

        const reporteId = await reporteEscritoOrientacionModel.crearBorradorAutorizado({
            alumnoUsuarioId: alumnoId,
            orientadorUsuarioId: req.session.usuario.id,
            tipoReporteId: tipo.id,
            estadoId: estadoBorrador.id,
            fechaReporte: obtenerFechaLocal(),
            periodoDesde: datos.periodoDesde,
            periodoHasta: datos.periodoHasta,
            motivo: datos.motivo,
            contenido: datos.contenido,
            conclusiones: datos.conclusiones || null,
            recomendaciones: datos.recomendaciones || null
        });
        if (!reporteId) return res.status(404).send('Alumno no encontrado.');
        return res.redirect(`/orientador/reportes/${reporteId}/editar?creado=1`);
    } catch {
        return res.status(503).send('No fue posible guardar el borrador. Inténtalo nuevamente.');
    }
};

const cargarReporteAutorizado = async (reporteId, orientadorId, res) => {
    const acceso = await reporteEscritoOrientacionModel.buscarAccesoPorId(reporteId, orientadorId);
    if (!acceso) {
        res.status(404).send('Reporte no encontrado.');
        return null;
    }
    if (Number(acceso.orientador_usuario_id) !== Number(orientadorId)) {
        res.status(404).send('Reporte no encontrado.');
        return null;
    }
    if (acceso.estado_clave !== 'BORRADOR') {
        res.status(409).send('El reporte ya está finalizado y no puede editarse.');
        return null;
    }
    const reporte = await reporteEscritoOrientacionModel.buscarPorIdConDetalle(reporteId, orientadorId);
    if (!reporte) {
        res.status(404).send('Reporte no encontrado.');
        return null;
    }
    return reporte;
};

const crearDatosDesdeReporte = (reporte) => ({
    tipo: reporte.tipo_clave,
    periodo_desde: reporte.periodo_desde,
    periodo_hasta: reporte.periodo_hasta,
    motivo: reporte.motivo,
    contenido: reporte.contenido,
    conclusiones: reporte.conclusiones || '',
    recomendaciones: reporte.recomendaciones || ''
});

const renderizarEditar = (res, {
    status = 200,
    reporte,
    tipos,
    datos,
    version,
    mensaje = null,
    error = null
}) => {
    const parametros = new URLSearchParams({
        desde: datos.periodo_desde,
        hasta: datos.periodo_hasta
    });
    return res.status(status).render('orientador/reportes/editar', {
        title: 'Editar borrador | COBAEM 30',
        menuItems: crearMenuReportes(),
        reporte: {
            id: reporte.id,
            fechaReporte: reporte.fecha_reporte,
            actualizadoEn: reporte.actualizado_en,
            estadoNombre: reporte.estado_nombre
        },
        alumno: crearAlumnoDesdeReporte(reporte),
        tipos,
        datos,
        version,
        mensaje,
        error,
        apoyoUrl: `/orientador/reportes/alumnos/${reporte.alumno_usuario_id}/vista-previa?${parametros.toString()}`
    });
};

const mostrarEditar = async (req, res) => {
    const reporteId = convertirIdPositivo(req.params.reporteId);
    if (!reporteId) return res.status(404).send('Reporte no encontrado.');
    try {
        const reporte = await cargarReporteAutorizado(reporteId, req.session.usuario.id, res);
        if (!reporte) return undefined;
        const tipos = await tipoReporteOrientacionModel.listarTodos();
        const mensaje = req.query.creado === '1'
            ? 'Borrador creado correctamente.'
            : req.query.guardado === '1' ? 'Cambios guardados correctamente.' : null;
        return renderizarEditar(res, {
            reporte,
            tipos,
            datos: crearDatosDesdeReporte(reporte),
            version: reporte.version,
            mensaje
        });
    } catch {
        return res.status(503).send('No fue posible cargar el borrador. Inténtalo nuevamente.');
    }
};

const actualizarBorrador = async (req, res) => {
    const reporteId = convertirIdPositivo(req.params.reporteId);
    if (!reporteId) return res.status(404).send('Reporte no encontrado.');
    const datos = leerDatos(req.body);
    const versionAnterior = convertirIdPositivo(normalizarTexto(req.body.version));
    try {
        const reporte = await cargarReporteAutorizado(reporteId, req.session.usuario.id, res);
        if (!reporte) return undefined;
        const tipos = await tipoReporteOrientacionModel.listarTodos();
        const error = validarDatos(datos) || (!versionAnterior ? 'La versión del borrador no es válida.' : null);
        if (error) {
            return renderizarEditar(res, {
                status: 422,
                reporte,
                tipos,
                datos: datosParaVista(datos),
                version: versionAnterior || reporte.version,
                error
            });
        }

        const [tipo, estadoBorrador] = await Promise.all([
            tipoReporteOrientacionModel.buscarPorClave(datos.tipo),
            estadoReporteOrientacionModel.buscarPorClave('BORRADOR')
        ]);
        if (!tipo) {
            return renderizarEditar(res, {
                status: 422,
                reporte,
                tipos,
                datos: datosParaVista(datos),
                version: versionAnterior,
                error: 'Selecciona un tipo de reporte válido.'
            });
        }
        if (!estadoBorrador) return res.status(503).send('No fue posible validar el estado del borrador.');

        const resultado = await reporteEscritoOrientacionModel.actualizarBorradorCondicional({
            reporteId,
            orientadorUsuarioId: req.session.usuario.id,
            tipoReporteId: tipo.id,
            estadoIdBorrador: estadoBorrador.id,
            versionAnterior,
            periodoDesde: datos.periodoDesde,
            periodoHasta: datos.periodoHasta,
            motivo: datos.motivo,
            contenido: datos.contenido,
            conclusiones: datos.conclusiones || null,
            recomendaciones: datos.recomendaciones || null
        });
        if (resultado.affectedRows === 0) {
            const conservaAlcance = await orientadorAlcanceModel.puedeAccederAlumno(
                req.session.usuario.id, reporte.alumno_usuario_id
            );
            if (!conservaAlcance) return res.status(404).send('Reporte no encontrado.');
            return renderizarEditar(res, {
                status: 409,
                reporte,
                tipos,
                datos: datosParaVista(datos),
                version: versionAnterior,
                error: 'El borrador cambió en otra sesión. Recarga la página antes de continuar.'
            });
        }
        return res.redirect(`/orientador/reportes/${reporteId}/editar?guardado=1`);
    } catch {
        return res.status(503).send('No fue posible guardar los cambios. Inténtalo nuevamente.');
    }
};

module.exports = {
    mostrarNuevo,
    crearBorrador,
    mostrarEditar,
    actualizarBorrador
};
