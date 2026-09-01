const alumnoModel = require('../models/alumnoModel');
const grupoModel = require('../models/grupoModel');
const seguimientoModel = require('../models/seguimientoModel');
const actividadOrientacionModel = require('../models/actividadOrientacionModel');
const crearMenuPorRol = require('../config/roleMenus');

const normalizarTexto = (valor) => typeof valor === 'string' ? valor.trim() : '';

const convertirIdPositivo = (valor) => {
    if (!/^\d+$/.test(valor)) return null;

    const id = Number(valor);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const crearMenuOrientadorAlumnos = () => crearMenuPorRol(
    'ORIENTADOR',
    { dashboardActivo: false }
).map((item) => ({ ...item, activo: item.url === '/orientador/alumnos' }));

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
            : estadoSolicitado === 'inactivo'
                ? false
                : undefined;
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
        const construirUrlPagina = (pagina) => {
            const parametros = new URLSearchParams();
            if (filtros.q) parametros.set('q', filtros.q);
            if (filtros.grupo) parametros.set('grupo', filtros.grupo);
            if (filtros.estado) parametros.set('estado', filtros.estado);
            parametros.set('pagina', String(pagina));
            return `/orientador/alumnos?${parametros.toString()}`;
        };
        const enlaces = Array.from({ length: totalPaginas }, (_, indice) => {
            const numero = indice + 1;
            return {
                numero,
                url: construirUrlPagina(numero),
                actual: numero === paginaActual
            };
        });
        res.render('orientador/alumnos/index', {
            title: 'Alumnos | COBAEM 30',
            menuItems: crearMenuOrientadorAlumnos(),
            alumnos,
            grupos,
            filtros,
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
        res.status(500).send('No fue posible cargar la lista de alumnos.');
    }
};

const mostrarDetalleAlumno = async (req, res) => {
    const id = convertirIdPositivo(req.params.id);
    if (!id) {
        res.status(404).send('Alumno no encontrado.');
        return;
    }

    try {
        const resultado = await alumnoModel.buscarDetalleParaOrientadorPorUsuarioId(id);
        if (!resultado) {
            res.status(404).send('Alumno no encontrado.');
            return;
        }

        const nombreCompleto = typeof resultado.nombre_completo === 'string'
            ? resultado.nombre_completo.trim()
            : '';
        const textoInicial = nombreCompleto || 'A';
        const alumno = {
            usuarioId: id,
            nombreCompleto,
            correo: resultado.correo,
            matricula: resultado.matricula,
            usuarioActivo: Boolean(resultado.usuario_activo),
            grupoClave: resultado.grupo_clave,
            semestre: resultado.semestre,
            turno: resultado.turno_nombre,
            cicloEscolar: resultado.ciclo_escolar,
            grupoActivo: Boolean(resultado.grupo_activo),
            inicial: Array.from(textoInicial)[0].toLocaleUpperCase('es-MX')
        };
        const [resultadosSeguimiento, resultadosActividad] = await Promise.all([
            seguimientoModel.listarRecientesPorAlumno(id, 5),
            actividadOrientacionModel.listarRecientesPorAlumno(id, 5)
        ]);
        const seguimientosRecientes = resultadosSeguimiento.map((seguimiento) => ({
            tipo: seguimiento.tipo_nombre,
            fecha: seguimiento.fecha_seguimiento,
            titulo: seguimiento.titulo,
            descripcion: seguimiento.descripcion,
            orientador: seguimiento.orientador_nombre
        }));
        const actividadesRecientes = resultadosActividad.map((actividad) => ({
            id: actividad.id,
            titulo: actividad.titulo,
            descripcion: actividad.descripcion,
            fechaProgramada: actividad.fecha_programada,
            fechaRealizacion: actividad.fecha_realizacion,
            estadoClave: actividad.estado_clave,
            estado: actividad.estado_nombre,
            orientador: actividad.orientador_nombre,
            cerrada: ['REALIZADA', 'NO_REALIZADA', 'CANCELADA'].includes(actividad.estado_clave),
            esPropia: Number(actividad.orientador_usuario_id) === Number(req.session.usuario.id)
        }));

        res.render('orientador/alumnos/detalle', {
            title: 'Detalle del alumno | COBAEM 30',
            menuItems: crearMenuOrientadorAlumnos(),
            alumno,
            seguimientosRecientes,
            actividadesRecientes,
            mensaje: req.query.actividad === 'estado-actualizado'
                ? 'Estado de la actividad actualizado correctamente.'
                : req.query.actividad === 'creada'
                    ? 'Actividad programada correctamente.'
                : req.query.seguimiento === 'creado'
                    ? 'Seguimiento registrado correctamente.'
                    : null
        });
    } catch {
        res.status(500).send('No fue posible cargar el detalle del alumno.');
    }
};

module.exports = {
    listarAlumnos,
    mostrarDetalleAlumno
};
