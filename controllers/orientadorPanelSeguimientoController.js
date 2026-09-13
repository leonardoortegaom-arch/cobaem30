const actividadOrientacionModel = require('../models/actividadOrientacionModel');
const seguimientoModel = require('../models/seguimientoModel');
const crearMenuPorRol = require('../config/roleMenus');

const crearMenuSeguimiento = () => crearMenuPorRol(
    'ORIENTADOR',
    { dashboardActivo: false }
).map((item) => ({
    ...item,
    activo: item.url === '/orientador/seguimientos'
}));

const mostrarPanel = async (req, res) => {
    try {
        const [resumen, actividades, seguimientos] = await Promise.all([
            actividadOrientacionModel.obtenerResumenGeneral(req.session.usuario.id),
            actividadOrientacionModel.listarActividadesQueRequierenAtencion(req.session.usuario.id, 10),
            seguimientoModel.listarSeguimientosRecientesGlobales(req.session.usuario.id, 10)
        ]);

        const actividadesSeguras = actividades.map((actividad) => ({
            id: actividad.id,
            alumno_usuario_id: actividad.alumno_usuario_id,
            alumno_nombre: actividad.alumno_nombre,
            matricula: actividad.matricula,
            grupo_clave: actividad.grupo_clave,
            titulo: actividad.titulo,
            fecha_asignacion: actividad.fecha_asignacion,
            estado_clave: actividad.estado_clave,
            estado_nombre: actividad.estado_nombre,
            vencida: Boolean(actividad.vencida),
            esPropia: Number(actividad.orientador_usuario_id) === Number(req.session.usuario.id)
        }));

        res.render('orientador/seguimientos/index', {
            title: 'Seguimiento | COBAEM 30',
            menuItems: crearMenuSeguimiento(),
            resumen,
            actividades: actividadesSeguras,
            seguimientos
        });
    } catch {
        res.status(503).send('No fue posible cargar el panel de seguimiento. Inténtalo nuevamente.');
    }
};

module.exports = {
    mostrarPanel
};
