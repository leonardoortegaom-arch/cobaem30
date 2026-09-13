const historialOrientacionModel = require('../models/historialOrientacionModel');
const crearMenuPorRol = require('../config/roleMenus');

const normalizarTexto = (valor) => typeof valor === 'string' ? valor.trim() : '';

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

const crearMenuHistorial = () => crearMenuPorRol(
    'ORIENTADOR',
    { dashboardActivo: false }
).map((item) => ({ ...item, activo: item.url === '/orientador/historial' }));

const crearPaginacionVacia = () => ({
    paginaActual: 1,
    totalPaginas: 1,
    totalRegistros: 0,
    tieneAnterior: false,
    tieneSiguiente: false,
    urlAnterior: null,
    urlSiguiente: null,
    enlaces: []
});

const renderizarIntervaloInvalido = (res, filtros, error) => res.status(422).render(
    'orientador/historial/index',
    {
        title: 'Historial de orientación | COBAEM 30',
        menuItems: crearMenuHistorial(),
        filtros,
        registros: [],
        paginacion: crearPaginacionVacia(),
        error
    }
);

const listarHistorial = async (req, res) => {
    const q = normalizarTexto(req.query.q).slice(0, 100);
    const tipoSolicitado = normalizarTexto(req.query.tipo).toLocaleUpperCase('es-MX');
    const tipo = ['SEGUIMIENTO', 'ACTIVIDAD'].includes(tipoSolicitado)
        ? tipoSolicitado
        : 'TODOS';
    const fechaDesde = normalizarTexto(req.query.desde);
    const fechaHasta = normalizarTexto(req.query.hasta);
    const filtros = { q, tipo, desde: fechaDesde, hasta: fechaHasta };

    if (fechaDesde && !esFechaReal(fechaDesde)) {
        renderizarIntervaloInvalido(res, filtros, 'La fecha inicial no es válida.');
        return;
    }

    if (fechaHasta && !esFechaReal(fechaHasta)) {
        renderizarIntervaloInvalido(res, filtros, 'La fecha final no es válida.');
        return;
    }

    if (fechaDesde && fechaHasta && fechaDesde > fechaHasta) {
        renderizarIntervaloInvalido(
            res,
            filtros,
            'La fecha inicial no puede ser posterior a la fecha final.'
        );
        return;
    }

    try {
        const paginaSolicitada = typeof req.query.pagina === 'string'
            && /^\d+$/.test(req.query.pagina)
            && Number(req.query.pagina) > 0
            ? Number(req.query.pagina)
            : 1;
        const limite = 10;
        const filtrosModelo = {
            orientadorUsuarioId: req.session.usuario.id,
            q,
            tipo: tipo === 'TODOS' ? undefined : tipo,
            fechaDesde,
            fechaHasta
        };
        const totalRegistros = await historialOrientacionModel.contarFiltrados(filtrosModelo);
        const totalPaginas = Math.max(1, Math.ceil(totalRegistros / limite));
        const paginaActual = Math.min(paginaSolicitada, totalPaginas);
        const registros = await historialOrientacionModel.listarPaginado({
            ...filtrosModelo,
            limite,
            offset: (paginaActual - 1) * limite
        });
        const construirUrl = (pagina) => {
            const parametros = new URLSearchParams();
            if (q) parametros.set('q', q);
            if (tipo !== 'TODOS') parametros.set('tipo', tipo);
            if (fechaDesde) parametros.set('desde', fechaDesde);
            if (fechaHasta) parametros.set('hasta', fechaHasta);
            parametros.set('pagina', String(pagina));
            return `/orientador/historial?${parametros.toString()}`;
        };
        const enlaces = Array.from({ length: totalPaginas }, (_, indice) => {
            const numero = indice + 1;
            return { numero, url: construirUrl(numero), actual: numero === paginaActual };
        });

        res.render('orientador/historial/index', {
            title: 'Historial de orientación | COBAEM 30',
            menuItems: crearMenuHistorial(),
            filtros,
            registros,
            error: null,
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
        res.status(503).send('No fue posible cargar el historial de orientación. Inténtalo nuevamente.');
    }
};

module.exports = {
    listarHistorial
};
