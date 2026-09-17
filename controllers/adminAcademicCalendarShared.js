const crearMenuAdmin = require('../config/adminMenu');

const LIMITE = 15;
const normalizarTexto = (valor) => typeof valor === 'string' ? valor.trim() : '';
const contieneControl = (valor) => /[\u0000-\u001F\u007F]/.test(valor);
const obtenerId = (valor) => /^\d+$/.test(String(valor || '')) && Number.isSafeInteger(Number(valor)) && Number(valor) > 0 ? Number(valor) : null;
const obtenerAnio = (valor) => /^\d{4}$/.test(String(valor || '')) ? Number(valor) : null;

const fechaValida = (valor) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
    const [anio, mes, dia] = valor.split('-').map(Number);
    const fecha = new Date(Date.UTC(anio, mes - 1, dia));
    return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
};

const obtenerEstado = (valor) => valor === 'activo' ? true : valor === 'inactivo' ? false : undefined;
const obtenerPagina = (valor) => /^\d+$/.test(String(valor || '')) && Number(valor) > 0 ? Number(valor) : 1;

const crearPaginacion = (totalRegistros, paginaSolicitada, construirUrl) => {
    const totalPaginas = Math.max(1, Math.ceil(totalRegistros / LIMITE));
    const paginaActual = Math.min(paginaSolicitada, totalPaginas);
    return {
        totalRegistros, totalPaginas, paginaActual,
        tieneAnterior: paginaActual > 1,
        tieneSiguiente: paginaActual < totalPaginas,
        urlAnterior: paginaActual > 1 ? construirUrl(paginaActual - 1) : null,
        urlSiguiente: paginaActual < totalPaginas ? construirUrl(paginaActual + 1) : null,
        enlaces: Array.from({ length: totalPaginas }, (_, i) => ({ numero: i + 1, url: construirUrl(i + 1), actual: i + 1 === paginaActual }))
    };
};

const menuCalendario = () => crearMenuAdmin('calendario');
const mensajeMysql = (res, texto) => res.status(503).send(texto);
const esDuplicado = (error) => error?.code === 'ER_DUP_ENTRY';

module.exports = { LIMITE, normalizarTexto, contieneControl, obtenerId, obtenerAnio, fechaValida, obtenerEstado, obtenerPagina, crearPaginacion, menuCalendario, mensajeMysql, esDuplicado };
