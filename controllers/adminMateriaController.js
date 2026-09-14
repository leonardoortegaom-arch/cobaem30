const materiaModel = require('../models/materiaModel');
const crearMenuAdmin = require('../config/adminMenu');

const LIMITE = 15;
const datosVacios = { clave: '', nombre: '', descripcion: '' };
const normalizarTexto = (valor) => typeof valor === 'string' ? valor.trim() : '';
const contieneControl = (valor) => /[\u0000-\u001F\u007F]/.test(valor);
const obtenerId = (valor) => /^\d+$/.test(String(valor || '')) && Number(valor) > 0
    ? Number(valor)
    : null;

const obtenerDatos = (body = {}) => ({
    clave: normalizarTexto(body.clave).toLocaleUpperCase('es-MX'),
    nombre: normalizarTexto(body.nombre),
    descripcion: normalizarTexto(body.descripcion)
});

const validarDatos = (datos) => {
    if (!datos.clave || datos.clave.length > 30) return 'La clave debe contener entre 1 y 30 caracteres.';
    if (datos.nombre.length < 2 || datos.nombre.length > 150) return 'El nombre debe contener entre 2 y 150 caracteres.';
    if (datos.descripcion.length > 500) return 'La descripción no puede superar 500 caracteres.';
    if ([datos.clave, datos.nombre, datos.descripcion].some(contieneControl)) return 'Los campos no pueden contener caracteres de control.';
    return null;
};

const crearControlador = (modelo = materiaModel) => {
    const renderFormulario = (res, vista, { status = 200, error = null, datos = datosVacios } = {}) => res
        .status(status)
        .render(`admin/materias/${vista}`, {
            title: `${vista === 'nuevo' ? 'Registrar' : 'Editar'} materia | COBAEM 30`,
            menuItems: crearMenuAdmin('materias'), error, datos
        });

    const listar = async (req, res) => {
        try {
            const busqueda = normalizarTexto(req.query.q).slice(0, 150);
            const estado = normalizarTexto(req.query.estado);
            const activo = estado === 'activo' ? true : estado === 'inactivo' ? false : undefined;
            const solicitada = /^\d+$/.test(String(req.query.pagina || '')) ? Number(req.query.pagina) : 1;
            const paginaSolicitada = Number.isSafeInteger(solicitada) && solicitada > 0 ? solicitada : 1;
            const filtrosModelo = { busqueda, activo };
            const totalRegistros = await modelo.contarFiltradas(filtrosModelo);
            const totalPaginas = Math.max(1, Math.ceil(totalRegistros / LIMITE));
            const paginaActual = Math.min(paginaSolicitada, totalPaginas);
            const materias = await modelo.listarPaginado(filtrosModelo, LIMITE, (paginaActual - 1) * LIMITE);
            const construirUrl = (pagina) => {
                const params = new URLSearchParams();
                if (busqueda) params.set('q', busqueda);
                if (typeof activo === 'boolean') params.set('estado', estado);
                params.set('pagina', String(pagina));
                return `/admin/materias?${params.toString()}`;
            };
            res.render('admin/materias/index', {
                title: 'Administración de materias | COBAEM 30',
                menuItems: crearMenuAdmin('materias'), materias,
                filtros: { q: busqueda, estado: typeof activo === 'boolean' ? estado : '' },
                paginacion: {
                    totalRegistros, totalPaginas, paginaActual,
                    tieneAnterior: paginaActual > 1, tieneSiguiente: paginaActual < totalPaginas,
                    urlAnterior: paginaActual > 1 ? construirUrl(paginaActual - 1) : null,
                    urlSiguiente: paginaActual < totalPaginas ? construirUrl(paginaActual + 1) : null,
                    enlaces: Array.from({ length: totalPaginas }, (_, i) => ({ numero: i + 1, url: construirUrl(i + 1), actual: i + 1 === paginaActual }))
                },
                mensaje: req.query.creado === '1' ? 'Materia registrada correctamente.'
                    : req.query.actualizado === '1' ? 'Materia actualizada correctamente.'
                        : req.query.estado === 'activado' ? 'Materia activada correctamente.'
                            : req.query.estado === 'desactivado' ? 'Materia desactivada correctamente.' : null
            });
        } catch { res.status(503).send('No fue posible cargar el catálogo de materias.'); }
    };

    const mostrarNueva = (req, res) => renderFormulario(res, 'nuevo');

    const crear = async (req, res) => {
        const datos = obtenerDatos(req.body);
        const error = validarDatos(datos);
        if (error) return renderFormulario(res, 'nuevo', { status: 422, error, datos });
        try {
            if (await modelo.buscarDuplicadoClave(datos.clave)) return renderFormulario(res, 'nuevo', { status: 422, error: 'La clave ya está registrada.', datos });
            await modelo.crear({ ...datos, descripcion: datos.descripcion || null, activo: true });
            return res.redirect('/admin/materias?creado=1');
        } catch (fallo) {
            if (fallo.code === 'ER_DUP_ENTRY') return renderFormulario(res, 'nuevo', { status: 422, error: 'La clave ya está registrada.', datos });
            return res.status(503).send('No fue posible registrar la materia.');
        }
    };

    const mostrarEditar = async (req, res) => {
        const id = obtenerId(req.params.id);
        if (!id) return res.status(404).send('Materia no encontrada.');
        try {
            const materia = await modelo.buscarPorId(id);
            if (!materia) return res.status(404).send('Materia no encontrada.');
            return renderFormulario(res, 'editar', { datos: { id, clave: materia.clave, nombre: materia.nombre, descripcion: materia.descripcion || '' } });
        } catch { return res.status(503).send('No fue posible cargar la materia.'); }
    };

    const actualizar = async (req, res) => {
        const id = obtenerId(req.params.id);
        if (!id) return res.status(404).send('Materia no encontrada.');
        const datos = { id, ...obtenerDatos(req.body) };
        const error = validarDatos(datos);
        if (error) return renderFormulario(res, 'editar', { status: 422, error, datos });
        try {
            if (!await modelo.buscarPorId(id)) return res.status(404).send('Materia no encontrada.');
            if (await modelo.buscarDuplicadoClave(datos.clave, id)) return renderFormulario(res, 'editar', { status: 422, error: 'La clave ya está registrada.', datos });
            const resultado = await modelo.actualizar(id, { ...datos, descripcion: datos.descripcion || null });
            if (resultado.affectedRows !== 1) return res.status(404).send('Materia no encontrada.');
            return res.redirect('/admin/materias?actualizado=1');
        } catch (fallo) {
            if (fallo.code === 'ER_DUP_ENTRY') return renderFormulario(res, 'editar', { status: 422, error: 'La clave ya está registrada.', datos });
            return res.status(503).send('No fue posible actualizar la materia.');
        }
    };

    const mostrarEstado = async (req, res) => {
        const id = obtenerId(req.params.id);
        if (!id) return res.status(404).send('Materia no encontrada.');
        try {
            const materia = await modelo.buscarPorId(id);
            if (!materia) return res.status(404).send('Materia no encontrada.');
            return res.render('admin/materias/estado', { title: 'Estado de materia | COBAEM 30', menuItems: crearMenuAdmin('materias'), materia, accion: materia.activo ? 'desactivar' : 'activar' });
        } catch { return res.status(503).send('No fue posible cargar la materia.'); }
    };

    const actualizarEstado = async (req, res) => {
        const id = obtenerId(req.params.id);
        if (!id) return res.status(404).send('Materia no encontrada.');
        const accion = normalizarTexto(req.body.accion);
        if (!['activar', 'desactivar'].includes(accion)) return res.status(422).send('La acción solicitada no es válida.');
        try {
            const materia = await modelo.buscarPorId(id);
            if (!materia) return res.status(404).send('Materia no encontrada.');
            const activo = accion === 'activar';
            if (Boolean(materia.activo) !== activo) {
                const resultado = await modelo.actualizarEstado(id, activo);
                if (resultado.affectedRows !== 1) return res.status(404).send('Materia no encontrada.');
            }
            return res.redirect(`/admin/materias?estado=${activo ? 'activado' : 'desactivado'}`);
        } catch { return res.status(503).send('No fue posible cambiar el estado de la materia.'); }
    };

    return { listar, mostrarNueva, crear, mostrarEditar, actualizar, mostrarEstado, actualizarEstado };
};

module.exports = { ...crearControlador(), crearControlador, obtenerDatos, validarDatos, obtenerId };
