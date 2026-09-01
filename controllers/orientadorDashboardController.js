const alumnoModel = require('../models/alumnoModel');
const seguimientoModel = require('../models/seguimientoModel');
const actividadOrientacionModel = require('../models/actividadOrientacionModel');
const crearMenuPorRol = require('../config/roleMenus');

const textoSeguro = (valor) => typeof valor === 'string' ? valor.trim() : '';

const obtenerFechasLocales = () => {
    const hoy = new Date();
    const anio = hoy.getFullYear();
    const mesIndice = hoy.getMonth();
    const formato = (year, month, day) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const siguiente = new Date(anio, mesIndice + 1, 1);
    return {
        fechaActual: formato(anio, mesIndice, hoy.getDate()),
        primerDiaMes: formato(anio, mesIndice, 1),
        primerDiaMesSiguiente: formato(siguiente.getFullYear(), siguiente.getMonth(), 1),
        fechaLegible: new Intl.DateTimeFormat('es-MX', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        }).format(hoy)
    };
};

const crearUsuarioSeguro = (usuario) => {
    const nombre = textoSeguro(usuario.nombre);
    return {
        nombre,
        correo: textoSeguro(usuario.correo),
        rolNombre: 'Orientador',
        inicial: Array.from(nombre || 'O')[0].toLocaleUpperCase('es-MX')
    };
};

const mostrarDashboard = async (req, res) => {
    const orientador = req.session.usuario;
    const fechas = obtenerFechasLocales();
    try {
        const [
            totalAlumnosActivos,
            seguimientosMes,
            resumenActividades,
            actividades,
            seguimientos
        ] = await Promise.all([
            alumnoModel.contarFiltradosParaOrientador({ activo: true }),
            seguimientoModel.contarPorOrientadorEnPeriodo(
                orientador.id,
                fechas.primerDiaMes,
                fechas.primerDiaMesSiguiente
            ),
            actividadOrientacionModel.obtenerResumenPersonal(orientador.id, fechas.fechaActual),
            actividadOrientacionModel.listarAbiertasPorOrientador(orientador.id, 5, fechas.fechaActual),
            seguimientoModel.listarRecientesPorOrientador(orientador.id, 5)
        ]);

        res.render('dashboards/orientador', {
            menuItems: crearMenuPorRol('ORIENTADOR'),
            usuario: crearUsuarioSeguro(orientador),
            fechaActualLegible: fechas.fechaLegible,
            metricas: {
                totalAlumnosActivos,
                seguimientosMes,
                actividadesAbiertas: resumenActividades.totalAbiertas,
                actividadesVencidas: resumenActividades.totalVencidas
            },
            actividades,
            seguimientos
        });
    } catch {
        res.status(503).send('No fue posible cargar el dashboard de orientación. Inténtalo nuevamente.');
    }
};

module.exports = {
    mostrarDashboard
};
