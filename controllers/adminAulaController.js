const aulaModel = require('../models/aulaModel');
const crearMenuAdmin = require('../config/adminMenu');

const LIMITE = 15;
const datosVacios = { clave: '', nombre: '', descripcion: '' };
const texto = (valor) => typeof valor === 'string' ? valor.trim() : '';
const contieneControl = (valor) => /[\u0000-\u001F\u007F]/.test(valor);
const obtenerId = (valor) => /^\d+$/.test(String(valor || '')) && Number(valor) > 0 ? Number(valor) : null;
const obtenerDatos = (body = {}) => ({ clave: texto(body.clave).toLocaleUpperCase('es-MX'), nombre: texto(body.nombre), descripcion: texto(body.descripcion) });
const validarDatos = (datos) => {
    if (!datos.clave || datos.clave.length > 30) return 'La clave debe contener entre 1 y 30 caracteres.';
    if (datos.nombre.length < 2 || datos.nombre.length > 150) return 'El nombre debe contener entre 2 y 150 caracteres.';
    if (datos.descripcion.length > 500) return 'La descripción no puede superar 500 caracteres.';
    if ([datos.clave, datos.nombre, datos.descripcion].some(contieneControl)) return 'Los campos no pueden contener caracteres de control.';
    return null;
};

const crearControlador = (modelo = aulaModel) => {
    const formulario = (res, vista, { status = 200, error = null, datos = datosVacios } = {}) => res.status(status).render(`admin/aulas/${vista}`, {
        title: `${vista === 'nuevo' ? 'Registrar' : 'Editar'} aula | COBAEM 30`, menuItems: crearMenuAdmin('aulas'), error, datos
    });

    const listar = async (req, res) => {
        try {
            const busqueda = texto(req.query.q).slice(0, 150);
            const estado = texto(req.query.estado);
            const activo = estado === 'activo' ? true : estado === 'inactivo' ? false : undefined;
            const numeroPagina = /^\d+$/.test(String(req.query.pagina || '')) ? Number(req.query.pagina) : 1;
            const paginaSolicitada = Number.isSafeInteger(numeroPagina) && numeroPagina > 0 ? numeroPagina : 1;
            const filtrosModelo = { busqueda, activo };
            const totalRegistros = await modelo.contarFiltradas(filtrosModelo);
            const totalPaginas = Math.max(1, Math.ceil(totalRegistros / LIMITE));
            const paginaActual = Math.min(paginaSolicitada, totalPaginas);
            const aulas = await modelo.listarPaginado(filtrosModelo, LIMITE, (paginaActual - 1) * LIMITE);
            const url = (pagina) => { const p = new URLSearchParams(); if (busqueda) p.set('q', busqueda); if (typeof activo === 'boolean') p.set('estado', estado); p.set('pagina', String(pagina)); return `/admin/aulas?${p}`; };
            return res.render('admin/aulas/index', {
                title: 'Administración de aulas | COBAEM 30', menuItems: crearMenuAdmin('aulas'), aulas,
                filtros: { q: busqueda, estado: typeof activo === 'boolean' ? estado : '' },
                paginacion: { totalRegistros, totalPaginas, paginaActual, tieneAnterior: paginaActual > 1, tieneSiguiente: paginaActual < totalPaginas, urlAnterior: paginaActual > 1 ? url(paginaActual - 1) : null, urlSiguiente: paginaActual < totalPaginas ? url(paginaActual + 1) : null, enlaces: Array.from({ length: totalPaginas }, (_, i) => ({ numero: i + 1, url: url(i + 1), actual: i + 1 === paginaActual })) },
                mensaje: req.query.creado === '1' ? 'Aula registrada correctamente.' : req.query.actualizado === '1' ? 'Aula actualizada correctamente.' : req.query.estado === 'activado' ? 'Aula activada correctamente.' : req.query.estado === 'desactivado' ? 'Aula desactivada correctamente.' : null
            });
        } catch { return res.status(503).send('No fue posible cargar el catálogo de aulas.'); }
    };

    const mostrarNueva = (req, res) => formulario(res, 'nuevo');
    const crear = async (req, res) => {
        const datos = obtenerDatos(req.body); const error = validarDatos(datos);
        if (error) return formulario(res, 'nuevo', { status: 422, error, datos });
        try {
            if (await modelo.buscarDuplicadoClave(datos.clave)) return formulario(res, 'nuevo', { status: 422, error: 'La clave ya está registrada.', datos });
            await modelo.crear({ ...datos, descripcion: datos.descripcion || null, activo: true });
            return res.redirect('/admin/aulas?creado=1');
        } catch (fallo) { return fallo.code === 'ER_DUP_ENTRY' ? formulario(res, 'nuevo', { status: 422, error: 'La clave ya está registrada.', datos }) : res.status(503).send('No fue posible registrar el aula.'); }
    };
    const mostrarEditar = async (req, res) => {
        const id = obtenerId(req.params.id); if (!id) return res.status(404).send('Aula no encontrada.');
        try { const aula = await modelo.buscarPorId(id); if (!aula) return res.status(404).send('Aula no encontrada.'); return formulario(res, 'editar', { datos: { id, clave: aula.clave, nombre: aula.nombre, descripcion: aula.descripcion || '' } }); } catch { return res.status(503).send('No fue posible cargar el aula.'); }
    };
    const actualizar = async (req, res) => {
        const id = obtenerId(req.params.id); if (!id) return res.status(404).send('Aula no encontrada.');
        const datos = { id, ...obtenerDatos(req.body) }; const error = validarDatos(datos);
        if (error) return formulario(res, 'editar', { status: 422, error, datos });
        try {
            if (!await modelo.buscarPorId(id)) return res.status(404).send('Aula no encontrada.');
            if (await modelo.buscarDuplicadoClave(datos.clave, id)) return formulario(res, 'editar', { status: 422, error: 'La clave ya está registrada.', datos });
            const resultado = await modelo.actualizar(id, { ...datos, descripcion: datos.descripcion || null });
            return resultado.affectedRows === 1 ? res.redirect('/admin/aulas?actualizado=1') : res.status(404).send('Aula no encontrada.');
        } catch (fallo) { return fallo.code === 'ER_DUP_ENTRY' ? formulario(res, 'editar', { status: 422, error: 'La clave ya está registrada.', datos }) : res.status(503).send('No fue posible actualizar el aula.'); }
    };
    const mostrarEstado = async (req, res) => {
        const id = obtenerId(req.params.id); if (!id) return res.status(404).send('Aula no encontrada.');
        try { const aula = await modelo.buscarPorId(id); if (!aula) return res.status(404).send('Aula no encontrada.'); return res.render('admin/aulas/estado', { title: 'Estado de aula | COBAEM 30', menuItems: crearMenuAdmin('aulas'), aula, accion: aula.activo ? 'desactivar' : 'activar' }); } catch { return res.status(503).send('No fue posible cargar el aula.'); }
    };
    const actualizarEstado = async (req, res) => {
        const id = obtenerId(req.params.id); if (!id) return res.status(404).send('Aula no encontrada.');
        const accion = texto(req.body.accion); if (!['activar', 'desactivar'].includes(accion)) return res.status(422).send('La acción solicitada no es válida.');
        try { const aula = await modelo.buscarPorId(id); if (!aula) return res.status(404).send('Aula no encontrada.'); const activo = accion === 'activar'; if (Boolean(aula.activo) !== activo) { const resultado = await modelo.actualizarEstado(id, activo); if (resultado.affectedRows !== 1) return res.status(404).send('Aula no encontrada.'); } return res.redirect(`/admin/aulas?estado=${activo ? 'activado' : 'desactivado'}`); } catch { return res.status(503).send('No fue posible cambiar el estado del aula.'); }
    };
    return { listar, mostrarNueva, crear, mostrarEditar, actualizar, mostrarEstado, actualizarEstado };
};

module.exports = { ...crearControlador(), crearControlador, obtenerDatos, validarDatos, obtenerId };
