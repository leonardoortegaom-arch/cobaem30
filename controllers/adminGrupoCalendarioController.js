const grupoModel = require('../models/grupoModel');
const crearMenuAdmin = require('../config/adminMenu');

const enteroPositivo = (valor) => {
    const texto = typeof valor === 'string' ? valor.trim() : '';
    if (!/^\d+$/.test(texto)) return null;
    const numero = Number(texto);
    return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
};

const crearControlador = ({ grupos = grupoModel, crearMenu = crearMenuAdmin } = {}) => {
    const mostrar = async (req, res) => {
        const grupoId = enteroPositivo(req.params.id);
        if (!grupoId) return res.status(404).send('Grupo no encontrado.');
        try {
            const [grupo, generaciones, periodos] = await Promise.all([
                grupos.buscarPorIdConCalendario(grupoId),
                grupos.listarGeneracionesActivas(),
                grupos.listarPeriodosActivosConCicloActivo()
            ]);
            if (!grupo) return res.status(404).send('Grupo no encontrado.');
            const mensaje = req.query.actualizado === '1'
                ? 'Calendario académico actualizado correctamente.'
                : req.query.sinCambios === '1' ? 'El grupo ya tenía esa configuración.' : null;
            return res.render('admin/grupos/calendario', {
                title: 'Calendario del grupo | COBAEM 30', menuItems: crearMenu('grupos'),
                grupo, generaciones, periodos, mensaje, error: null,
                datos: { generacion_id: grupo.generacion_id || '', periodo_academico_id: grupo.periodo_academico_id || '' }
            });
        } catch {
            return res.status(503).send('No fue posible cargar la configuración académica del grupo.');
        }
    };

    const guardar = async (req, res) => {
        const grupoId = enteroPositivo(req.params.id);
        if (!grupoId) return res.status(404).send('Grupo no encontrado.');
        const generacionId = enteroPositivo(req.body.generacion_id);
        const periodoId = enteroPositivo(req.body.periodo_academico_id);
        if (!generacionId || !periodoId) {
            return res.status(422).send('Selecciona una generación y un periodo académico válidos.');
        }
        try {
            const resultado = await grupos.actualizarCalendario(grupoId, generacionId, periodoId);
            const indicador = resultado.resultado === 'SIN_CAMBIOS' ? 'sinCambios=1' : 'actualizado=1';
            return res.redirect(`/admin/grupos/${grupoId}/calendario?${indicador}`);
        } catch (error) {
            if (error.codigo === 'GRUPO_NO_ENCONTRADO') return res.status(404).send('Grupo no encontrado.');
            if (['GENERACION_NO_DISPONIBLE', 'PERIODO_NO_DISPONIBLE'].includes(error.codigo)) {
                return res.status(422).send('La generación, el periodo o su ciclo ya no están disponibles.');
            }
            if (error.codigo === 'GENERACION_CON_HISTORIAL') {
                return res.status(409).send('La generación no puede cambiar porque el grupo ya tiene historial de horarios.');
            }
            if (error.codigo === 'CONFLICTO_TRANSACCIONAL' || error.code === 'ER_LOCK_DEADLOCK'
                || error.code === 'ER_LOCK_WAIT_TIMEOUT') {
                return res.status(409).send('La configuración cambió simultáneamente. Recarga la página.');
            }
            return res.status(503).send('No fue posible guardar la configuración académica del grupo.');
        }
    };
    return { mostrar, guardar };
};

module.exports = { ...crearControlador(), crearControlador, enteroPositivo };
