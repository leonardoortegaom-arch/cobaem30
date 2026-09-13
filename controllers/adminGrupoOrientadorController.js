const grupoModel = require('../models/grupoModel');
const asignacionModel = require('../models/asignacionOrientadorGrupoModel');
const crearMenuAdmin = require('../config/adminMenu');

const enteroPositivo = (valor) => {
    const texto = typeof valor === 'string' ? valor.trim() : '';
    if (!/^\d+$/.test(texto)) return null;
    const numero = Number(texto);
    return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
};

const crearControlador = ({ grupos = grupoModel, asignaciones = asignacionModel,
    crearMenu = crearMenuAdmin } = {}) => {
const mostrarAsignacion = async (req, res) => {
    const grupoId = enteroPositivo(req.params.id);
    if (!grupoId) return res.status(404).send('Grupo no encontrado.');
    try {
        const grupo = await grupos.buscarPorIdConTurno(grupoId);
        if (!grupo) return res.status(404).send('Grupo no encontrado.');
        const [vigente, orientadores, historial] = await Promise.all([
            asignaciones.buscarVigentePorGrupo(grupoId),
            asignaciones.listarOrientadoresActivos(),
            asignaciones.listarHistorialPorGrupo(grupoId)
        ]);
        const mensaje = req.query.asignado === '1' ? 'Orientador asignado correctamente.'
            : req.query.actualizado === '1'
                ? 'Orientador actualizado; la asignación anterior permanece en el historial.'
                : req.query.sinCambios === '1'
                    ? 'El orientador seleccionado ya estaba asignado al grupo.' : null;
        return res.render('admin/grupos/orientador', {
            title: 'Orientador del grupo | COBAEM 30', menuItems: crearMenu('grupos'),
            grupo, vigente, orientadores, historial, mensaje
        });
    } catch {
        return res.status(503).send('No fue posible cargar la asignación del orientador.');
    }
};

const guardarAsignacion = async (req, res) => {
    const grupoId = enteroPositivo(req.params.id);
    if (!grupoId) return res.status(404).send('Grupo no encontrado.');
    const orientadorUsuarioId = enteroPositivo(req.body.orientador_usuario_id);
    if (!orientadorUsuarioId) return res.status(422).send('Selecciona un orientador válido.');
    try {
        const resultado = await asignaciones.reemplazarAsignacionVigente({
            grupoId, orientadorUsuarioId, creadoPorUsuarioId: Number(req.session.usuario.id)
        });
        const indicador = resultado.resultado === 'ASIGNADA' ? 'asignado=1'
            : resultado.resultado === 'ACTUALIZADA' ? 'actualizado=1' : 'sinCambios=1';
        return res.redirect(`/admin/grupos/${grupoId}/orientador?${indicador}`);
    } catch (error) {
        if (error.codigo === 'GRUPO_NO_ENCONTRADO') return res.status(404).send('Grupo no encontrado.');
        if (['ORIENTADOR_NO_ENCONTRADO', 'ORIENTADOR_INACTIVO', 'ROL_ORIENTADOR_REQUERIDO'].includes(error.codigo)) {
            return res.status(422).send('El orientador seleccionado no está disponible.');
        }
        if (error.codigo === 'ESTADO_CONCURRENTE' || error.code === 'ER_DUP_ENTRY') {
            return res.status(409).send('La asignación cambió simultáneamente. Recarga la página.');
        }
        return res.status(503).send('No fue posible guardar la asignación del orientador.');
    }
};

return { mostrarAsignacion, guardarAsignacion };
};

module.exports = { ...crearControlador(), crearControlador, enteroPositivo };
