const alumnoModel = require('../models/alumnoModel');
const grupoModel = require('../models/grupoModel');
const reporteOrientacionModel = require('../models/reporteOrientacionModel');
const reporteEscritoOrientacionModel = require('../models/reporteEscritoOrientacionModel');
const reporteOrientacionPdfService = require('../services/reporteOrientacionPdfService');
const crearMenuPorRol = require('../config/roleMenus');

const normalizarTexto = (valor) => typeof valor === 'string' ? valor.trim() : '';

const convertirIdPositivo = (valor) => {
    if (!/^\d+$/.test(valor)) return null;
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
    if (
        fecha.getUTCFullYear() !== anio
        || fecha.getUTCMonth() !== mes - 1
        || fecha.getUTCDate() !== dia
    ) return null;
    return fecha;
};

const crearMenuReportes = () => crearMenuPorRol(
    'ORIENTADOR',
    { dashboardActivo: false }
).map((item) => ({ ...item, activo: item.url === '/orientador/reportes' }));

const listarAlumnos = async (req, res) => {
    try {
        const grupos = await grupoModel.listarTodosConTurno();
        const busqueda = normalizarTexto(req.query.q).slice(0, 100);
        const grupoSolicitado = convertirIdPositivo(normalizarTexto(req.query.grupo));
        const grupoId = grupoSolicitado !== null
            && grupos.some((grupo) => Number(grupo.id) === grupoSolicitado)
            ? grupoSolicitado
            : undefined;
        const estadoSolicitado = normalizarTexto(req.query.estado);
        const activo = estadoSolicitado === 'activo'
            ? true
            : estadoSolicitado === 'inactivo' ? false : undefined;
        const paginaSolicitada = typeof req.query.pagina === 'string'
            && /^\d+$/.test(req.query.pagina)
            && Number(req.query.pagina) > 0
            ? Number(req.query.pagina)
            : 1;
        const limite = 10;
        const filtrosModelo = { busqueda, grupoId, activo };
        const totalRegistros = await alumnoModel.contarFiltradosParaOrientador(filtrosModelo);
        const totalPaginas = Math.max(1, Math.ceil(totalRegistros / limite));
        const paginaActual = Math.min(paginaSolicitada, totalPaginas);
        const alumnos = await alumnoModel.listarPaginadoParaOrientador({
            ...filtrosModelo,
            limite,
            offset: (paginaActual - 1) * limite
        });
        const filtros = {
            q: busqueda,
            grupo: grupoId ? String(grupoId) : '',
            estado: typeof activo === 'boolean' ? estadoSolicitado : ''
        };
        const construirUrl = (pagina) => {
            const parametros = new URLSearchParams();
            if (filtros.q) parametros.set('q', filtros.q);
            if (filtros.grupo) parametros.set('grupo', filtros.grupo);
            if (filtros.estado) parametros.set('estado', filtros.estado);
            parametros.set('pagina', String(pagina));
            return `/orientador/reportes?${parametros.toString()}`;
        };
        const enlaces = Array.from({ length: totalPaginas }, (_, indice) => {
            const numero = indice + 1;
            return { numero, url: construirUrl(numero), actual: numero === paginaActual };
        });

        const borradores = await reporteEscritoOrientacionModel.listarBorradoresPorAutor(
            req.session.usuario.id,
            10
        );

        res.render('orientador/reportes/index', {
            title: 'Reportes | COBAEM 30',
            menuItems: crearMenuReportes(),
            alumnos,
            grupos,
            borradores,
            filtros,
            paginacion: {
                paginaActual,
                totalPaginas,
                totalRegistros,
                tieneAnterior: paginaActual > 1,
                tieneSiguiente: paginaActual < totalPaginas,
                urlAnterior: paginaActual > 1 ? construirUrl(paginaActual - 1) : null,
                urlSiguiente: paginaActual < totalPaginas ? construirUrl(paginaActual + 1) : null,
                enlaces
            }
        });
    } catch {
        res.status(503).send('No fue posible cargar los alumnos para reportes. Inténtalo nuevamente.');
    }
};

const crearAlumnoSeguro = (resultado) => ({
    nombre: normalizarTexto(resultado.nombre_completo),
    correo: resultado.correo,
    activo: Boolean(resultado.usuario_activo),
    matricula: resultado.matricula,
    grupo: resultado.grupo_clave,
    semestre: resultado.semestre,
    turno: resultado.turno_nombre,
    ciclo: resultado.ciclo_escolar,
    grupoActivo: Boolean(resultado.grupo_activo)
});

const crearResumen = (seguimientos, actividades) => {
    const porTipo = {};
    const porEstado = {};
    seguimientos.forEach((registro) => {
        porTipo[registro.tipo_nombre] = (porTipo[registro.tipo_nombre] || 0) + 1;
    });
    actividades.forEach((registro) => {
        porEstado[registro.estado_nombre] = (porEstado[registro.estado_nombre] || 0) + 1;
    });
    return {
        totalSeguimientos: seguimientos.length,
        seguimientosPorTipo: Object.entries(porTipo).map(([nombre, total]) => ({ nombre, total })),
        totalActividades: actividades.length,
        actividadesPorEstado: Object.entries(porEstado).map(([nombre, total]) => ({ nombre, total }))
    };
};

const construirReporte = ({ alumno, periodo, orientador, seguimientos = [], actividades = [] }) => ({
    fechaGeneracion: obtenerFechaLocal(),
    periodo,
    orientador,
    alumno,
    resumen: crearResumen(seguimientos, actividades),
    seguimientos,
    actividades
});

const prepararReporte = async (req, alumnoId) => {
    const resultadoAlumno = await alumnoModel.buscarDetalleParaOrientadorPorUsuarioId(alumnoId);
    if (!resultadoAlumno) return { noEncontrado: true };

    const alumno = crearAlumnoSeguro(resultadoAlumno);
    const periodo = {
        desde: normalizarTexto(req.query.desde) || obtenerPrimerDiaMes(),
        hasta: normalizarTexto(req.query.hasta) || obtenerFechaLocal()
    };
    const orientador = {
        nombre: req.session.usuario.nombre,
        rol: req.session.usuario.rol === 'ORIENTADOR' ? 'Orientador' : ''
    };
    const fechaDesde = descomponerFecha(periodo.desde);
    const fechaHasta = descomponerFecha(periodo.hasta);
    let error = null;
    if (!fechaDesde) error = 'La fecha inicial no es válida.';
    else if (!fechaHasta) error = 'La fecha final no es válida.';
    else if (periodo.desde > periodo.hasta) error = 'La fecha inicial no puede ser posterior a la fecha final.';
    else {
        const diasInclusivos = Math.floor((fechaHasta - fechaDesde) / 86400000) + 1;
        if (diasInclusivos > 366) error = 'El periodo no puede superar 366 días.';
    }

    if (error) {
        return {
            alumno,
            periodo,
            error,
            reporte: construirReporte({ alumno, periodo, orientador })
        };
    }

    const contenido = await reporteOrientacionModel.obtenerReporteAlumno(alumnoId, periodo);
    return {
        alumno,
        periodo,
        error: null,
        reporte: construirReporte({
            alumno,
            periodo,
            orientador,
            seguimientos: contenido.seguimientos,
            actividades: contenido.actividades
        })
    };
};

const renderizarConfiguracion = (res, {
    status = 200,
    alumno,
    alumnoId,
    periodo,
    error = null
}) => res.status(status).render('orientador/reportes/configurar', {
    title: 'Configurar información de apoyo | COBAEM 30',
    menuItems: crearMenuReportes(),
    alumno: {
        nombre: alumno.nombre,
        activo: alumno.activo,
        matricula: alumno.matricula,
        grupo: alumno.grupo,
        semestre: alumno.semestre,
        turno: alumno.turno
    },
    alumnoId,
    periodo,
    error
});

const mostrarConfiguracion = async (req, res) => {
    const alumnoId = convertirIdPositivo(req.params.id);
    if (!alumnoId) {
        res.status(404).send('Alumno no encontrado.');
        return;
    }

    try {
        const resultadoAlumno = await alumnoModel.buscarDetalleParaOrientadorPorUsuarioId(alumnoId);
        if (!resultadoAlumno) {
            res.status(404).send('Alumno no encontrado.');
            return;
        }
        renderizarConfiguracion(res, {
            alumno: crearAlumnoSeguro(resultadoAlumno),
            alumnoId,
            periodo: { desde: obtenerPrimerDiaMes(), hasta: obtenerFechaLocal() }
        });
    } catch {
        res.status(503).send('No fue posible cargar la configuración del reporte. Inténtalo nuevamente.');
    }
};

const construirUrlPdf = (alumnoId, periodo) => {
    const parametros = new URLSearchParams({
        desde: periodo.desde,
        hasta: periodo.hasta
    });
    return `/orientador/reportes/alumnos/${alumnoId}/pdf?${parametros.toString()}`;
};

const mostrarVistaPrevia = async (req, res) => {
    const alumnoId = convertirIdPositivo(req.params.id);
    if (!alumnoId) {
        res.status(404).send('Alumno no encontrado.');
        return;
    }

    const desde = normalizarTexto(req.query.desde);
    const hasta = normalizarTexto(req.query.hasta);
    if (!desde && !hasta) {
        res.redirect(`/orientador/reportes/alumnos/${alumnoId}`);
        return;
    }

    try {
        if (!desde || !hasta) {
            const resultadoAlumno = await alumnoModel.buscarDetalleParaOrientadorPorUsuarioId(alumnoId);
            if (!resultadoAlumno) {
                res.status(404).send('Alumno no encontrado.');
                return;
            }
            renderizarConfiguracion(res, {
                status: 422,
                alumno: crearAlumnoSeguro(resultadoAlumno),
                alumnoId,
                periodo: { desde, hasta },
                error: 'Debes seleccionar las fechas de inicio y fin del periodo.'
            });
            return;
        }

        const preparacion = await prepararReporte(req, alumnoId);
        if (preparacion.noEncontrado) {
            res.status(404).send('Alumno no encontrado.');
            return;
        }
        if (preparacion.error) {
            renderizarConfiguracion(res, {
                status: 422,
                alumno: preparacion.alumno,
                alumnoId,
                periodo: preparacion.periodo,
                error: preparacion.error
            });
            return;
        }
        res.render('orientador/reportes/vista-previa', {
            title: 'Información de apoyo | COBAEM 30',
            menuItems: crearMenuReportes(),
            reporte: preparacion.reporte,
            alumnoId,
            error: null,
            pdfUrl: construirUrlPdf(alumnoId, preparacion.periodo)
        });
    } catch {
        res.status(503).send('No fue posible consultar la información de apoyo. Inténtalo nuevamente.');
    }
};

const sanitizarParteNombre = (valor) => {
    const segura = String(valor || '').replace(/[^A-Za-z0-9_-]/g, '');
    return segura || 'alumno';
};

const descargarPdf = async (req, res) => {
    const alumnoId = convertirIdPositivo(req.params.id);
    if (!alumnoId) {
        res.status(404).send('Alumno no encontrado.');
        return;
    }

    let preparacion;
    try {
        preparacion = await prepararReporte(req, alumnoId);
    } catch {
        res.status(503).send('No fue posible obtener los datos del reporte. Inténtalo nuevamente.');
        return;
    }

    if (preparacion.noEncontrado) {
        res.status(404).send('Alumno no encontrado.');
        return;
    }
    if (preparacion.error) {
        res.status(422).send(preparacion.error);
        return;
    }

    let pdf;
    try {
        pdf = await reporteOrientacionPdfService.generarPdf(preparacion.reporte);
    } catch {
        res.status(500).send('No fue posible generar el archivo PDF. Inténtalo nuevamente.');
        return;
    }

    const matricula = sanitizarParteNombre(preparacion.alumno.matricula);
    const nombreArchivo = `reporte-orientacion-${matricula}-${preparacion.periodo.desde}-${preparacion.periodo.hasta}.pdf`;
    res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${nombreArchivo}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Length': String(pdf.length)
    });
    res.status(200).send(pdf);
};

module.exports = {
    listarAlumnos,
    mostrarConfiguracion,
    mostrarVistaPrevia,
    descargarPdf
};
