const alumnoModel = require('../models/alumnoModel');
const tipoSeguimientoModel = require('../models/tipoSeguimientoModel');
const seguimientoModel = require('../models/seguimientoModel');
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

const crearMenuOrientadorAlumnos = () => crearMenuPorRol(
    'ORIENTADOR',
    { dashboardActivo: false }
).map((item) => ({ ...item, activo: item.url === '/orientador/alumnos' }));

const crearAlumnoSeguro = (resultado) => ({
    nombreCompleto: normalizarTexto(resultado.nombre_completo),
    correo: resultado.correo,
    matricula: resultado.matricula,
    grupoClave: resultado.grupo_clave,
    semestre: resultado.semestre,
    turno: resultado.turno_nombre,
    cicloEscolar: resultado.ciclo_escolar
});

const renderizarHistorialConError = (res, { alumno, alumnoId, tipos, filtros, error }) => res
    .status(422)
    .render('orientador/seguimientos/historial', {
        title: 'Historial de seguimiento | COBAEM 30',
        menuItems: crearMenuOrientadorAlumnos(),
        alumno,
        alumnoId,
        tipos,
        filtros,
        seguimientos: [],
        error,
        paginacion: {
            paginaActual: 1,
            totalPaginas: 1,
            totalRegistros: 0,
            tieneAnterior: false,
            tieneSiguiente: false,
            urlAnterior: null,
            urlSiguiente: null,
            enlaces: []
        }
    });

const renderizarFormulario = async (
    res,
    { status = 200, error = null, alumno, alumnoId, datos }
) => {
    const tipos = await tipoSeguimientoModel.listarActivos();

    return res.status(status).render('orientador/seguimientos/nuevo', {
        title: 'Registrar seguimiento | COBAEM 30',
        menuItems: crearMenuOrientadorAlumnos(),
        alumno,
        alumnoId,
        tipos,
        datos,
        error
    });
};

const mostrarFormulario = async (req, res) => {
    const alumnoId = convertirIdPositivo(req.params.id);
    if (!alumnoId) {
        res.status(404).send('Alumno no encontrado.');
        return;
    }

    try {
        const resultado = await alumnoModel.buscarDetalleParaOrientadorPorUsuarioId(alumnoId, req.session.usuario.id);
        if (!resultado) {
            res.status(404).send('Alumno no encontrado.');
            return;
        }

        if (!resultado.usuario_activo) {
            res.status(403).send('No es posible registrar seguimiento para una cuenta inactiva.');
            return;
        }

        await renderizarFormulario(res, {
            alumno: crearAlumnoSeguro(resultado),
            alumnoId,
            datos: {
                tipo_id: '',
                fecha_seguimiento: obtenerFechaActual(),
                titulo: '',
                descripcion: ''
            }
        });
    } catch {
        res.status(503).send('No fue posible cargar el formulario de seguimiento.');
    }
};

const crearSeguimiento = async (req, res) => {
    const alumnoId = convertirIdPositivo(req.params.id);
    if (!alumnoId) {
        res.status(404).send('Alumno no encontrado.');
        return;
    }

    const orientadorId = req.session.usuario.id;
    const datos = {
        tipo_id: normalizarTexto(req.body.tipo_id),
        fecha_seguimiento: normalizarTexto(req.body.fecha_seguimiento),
        titulo: normalizarTexto(req.body.titulo),
        descripcion: normalizarTexto(req.body.descripcion)
    };

    try {
        const resultado = await alumnoModel.buscarDetalleParaOrientadorPorUsuarioId(alumnoId, orientadorId);
        if (!resultado) {
            res.status(404).send('Alumno no encontrado.');
            return;
        }

        if (!resultado.usuario_activo) {
            res.status(403).send('No es posible registrar seguimiento para una cuenta inactiva.');
            return;
        }

        const alumno = crearAlumnoSeguro(resultado);
        const responderValidacion = async (mensaje) => renderizarFormulario(res, {
            status: 422,
            error: mensaje,
            alumno,
            alumnoId,
            datos
        });

        const tipoId = convertirIdPositivo(datos.tipo_id);
        if (!tipoId) {
            await responderValidacion('Selecciona un tipo de seguimiento válido.');
            return;
        }

        const tipo = await tipoSeguimientoModel.buscarActivoPorId(tipoId);
        if (!tipo) {
            await responderValidacion('Selecciona un tipo de seguimiento válido.');
            return;
        }

        if (!esFechaReal(datos.fecha_seguimiento)) {
            await responderValidacion('La fecha de seguimiento no es válida.');
            return;
        }

        if (datos.fecha_seguimiento > obtenerFechaActual()) {
            await responderValidacion('La fecha de seguimiento no puede ser posterior a la fecha actual.');
            return;
        }

        if (!datos.titulo) {
            await responderValidacion('El título es obligatorio.');
            return;
        }

        if (datos.titulo.length > 150) {
            await responderValidacion('El título no puede superar 150 caracteres.');
            return;
        }

        if (!datos.descripcion) {
            await responderValidacion('La descripción es obligatoria.');
            return;
        }

        if (datos.descripcion.length > 5000) {
            await responderValidacion('La descripción no puede superar 5000 caracteres.');
            return;
        }

        const seguimientoId = await seguimientoModel.crearAutorizado({
            alumno_usuario_id: alumnoId,
            orientador_usuario_id: orientadorId,
            tipo_id: tipo.id,
            fecha_seguimiento: datos.fecha_seguimiento,
            titulo: datos.titulo,
            descripcion: datos.descripcion
        });

        if (!seguimientoId) return res.status(404).send('Alumno no encontrado.');

        res.redirect(`/orientador/alumnos/${alumnoId}?seguimiento=creado`);
    } catch {
        res.status(503).send('No fue posible registrar el seguimiento.');
    }
};

const listarHistorial = async (req, res) => {
    const alumnoId = convertirIdPositivo(req.params.id);
    if (!alumnoId) {
        res.status(404).send('Alumno no encontrado.');
        return;
    }

    try {
        const resultado = await alumnoModel.buscarDetalleParaOrientadorPorUsuarioId(alumnoId, req.session.usuario.id);
        if (!resultado) {
            res.status(404).send('Alumno no encontrado.');
            return;
        }

        const tipos = await tipoSeguimientoModel.listarTodos();
        const alumno = crearAlumnoSeguro(resultado);
        const q = normalizarTexto(req.query.q).slice(0, 100);
        const tipoSolicitado = convertirIdPositivo(normalizarTexto(req.query.tipo));
        const tipoId = tipoSolicitado === null ? undefined : tipoSolicitado;
        const fechaDesde = normalizarTexto(req.query.desde);
        const fechaHasta = normalizarTexto(req.query.hasta);
        const filtros = {
            q,
            tipo: tipoId ? String(tipoId) : '',
            desde: fechaDesde,
            hasta: fechaHasta
        };

        if (fechaDesde && !esFechaReal(fechaDesde)) {
            renderizarHistorialConError(res, {
                alumno,
                alumnoId,
                tipos,
                filtros,
                error: 'La fecha inicial no es válida.'
            });
            return;
        }

        if (fechaHasta && !esFechaReal(fechaHasta)) {
            renderizarHistorialConError(res, {
                alumno,
                alumnoId,
                tipos,
                filtros,
                error: 'La fecha final no es válida.'
            });
            return;
        }

        if (fechaDesde && fechaHasta && fechaDesde > fechaHasta) {
            renderizarHistorialConError(res, {
                alumno,
                alumnoId,
                tipos,
                filtros,
                error: 'La fecha inicial no puede ser posterior a la fecha final.'
            });
            return;
        }

        const paginaSolicitada = typeof req.query.pagina === 'string'
            && /^\d+$/.test(req.query.pagina)
            && Number(req.query.pagina) > 0
            ? Number(req.query.pagina)
            : 1;
        const limite = 10;
        const filtrosModelo = {
            alumnoUsuarioId: alumnoId,
            q,
            tipoId,
            fechaDesde,
            fechaHasta
        };
        const totalRegistros = await seguimientoModel.contarFiltradosPorAlumno(filtrosModelo);
        const totalPaginas = Math.max(1, Math.ceil(totalRegistros / limite));
        const paginaActual = Math.min(paginaSolicitada, totalPaginas);
        const seguimientos = await seguimientoModel.listarPaginadoPorAlumno({
            ...filtrosModelo,
            limite,
            offset: (paginaActual - 1) * limite
        });
        const construirUrlPagina = (pagina) => {
            const parametros = new URLSearchParams();
            if (filtros.q) parametros.set('q', filtros.q);
            if (filtros.tipo) parametros.set('tipo', filtros.tipo);
            if (filtros.desde) parametros.set('desde', filtros.desde);
            if (filtros.hasta) parametros.set('hasta', filtros.hasta);
            parametros.set('pagina', String(pagina));
            return `/orientador/alumnos/${alumnoId}/seguimientos?${parametros.toString()}`;
        };
        const enlaces = Array.from({ length: totalPaginas }, (_, indice) => {
            const numero = indice + 1;
            return {
                numero,
                url: construirUrlPagina(numero),
                actual: numero === paginaActual
            };
        });

        res.render('orientador/seguimientos/historial', {
            title: 'Historial de seguimiento | COBAEM 30',
            menuItems: crearMenuOrientadorAlumnos(),
            alumno,
            alumnoId,
            tipos,
            filtros,
            seguimientos,
            error: null,
            paginacion: {
                paginaActual,
                totalPaginas,
                totalRegistros,
                tieneAnterior: paginaActual > 1,
                tieneSiguiente: paginaActual < totalPaginas,
                urlAnterior: paginaActual > 1 ? construirUrlPagina(paginaActual - 1) : null,
                urlSiguiente: paginaActual < totalPaginas ? construirUrlPagina(paginaActual + 1) : null,
                enlaces
            }
        });
    } catch {
        res.status(503).send('No fue posible cargar el historial de seguimiento.');
    }
};

module.exports = {
    mostrarFormulario,
    crearSeguimiento,
    listarHistorial
};
