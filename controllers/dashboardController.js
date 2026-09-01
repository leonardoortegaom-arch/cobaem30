const crearMenuPorRol = require('../config/roleMenus');
const usuarioModel = require('../models/usuarioModel');
const grupoModel = require('../models/grupoModel');

const NOMBRES_ROL = {
    ADMINISTRADOR: 'Administrador',
    DOCENTE: 'Docente',
    ALUMNO: 'Alumno',
    ORIENTADOR: 'Orientador'
};

const textoSeguro = (valor) => typeof valor === 'string' ? valor.trim() : '';

const crearUsuarioParaVista = (usuario = {}) => {
    const nombre = textoSeguro(usuario.nombre);
    const correo = textoSeguro(usuario.correo);
    const rol = textoSeguro(usuario.rol);
    const rolNombre = NOMBRES_ROL[rol] || 'Usuario';
    const textoInicial = nombre || rol || 'U';
    const inicial = Array.from(textoInicial)[0].toLocaleUpperCase('es-MX');

    return {
        id: usuario.id ?? null,
        nombre,
        correo,
        rol,
        rolNombre,
        inicial
    };
};

const mostrarAdministrador = async (req, res) => {
    try {
        const [resumenUsuarios, totalGrupos] = await Promise.all([
            usuarioModel.obtenerResumenActivos(),
            grupoModel.contarActivos()
        ]);

        res.render('dashboards/admin', {
            menuItems: crearMenuPorRol('ADMINISTRADOR'),
            usuario: crearUsuarioParaVista(res.locals.usuario),
            metricas: {
                totalUsuarios: resumenUsuarios.totalUsuarios,
                totalDocentes: resumenUsuarios.totalDocentes,
                totalAlumnos: resumenUsuarios.totalAlumnos,
                totalGrupos
            }
        });
    } catch {
        res.status(503).send('No fue posible cargar las métricas del dashboard.');
    }
};

const mostrarDocente = (req, res) => {
    res.render('dashboards/docente', {
        menuItems: crearMenuPorRol('DOCENTE'),
        usuario: crearUsuarioParaVista(res.locals.usuario)
    });
};

const mostrarAlumno = (req, res) => {
    res.render('dashboards/alumno', {
        menuItems: crearMenuPorRol('ALUMNO'),
        usuario: crearUsuarioParaVista(res.locals.usuario)
    });
};

const mostrarOrientador = (req, res) => {
    res.render('dashboards/orientador', {
        menuItems: crearMenuPorRol('ORIENTADOR'),
        usuario: crearUsuarioParaVista(res.locals.usuario)
    });
};

module.exports = {
    mostrarAdministrador,
    mostrarDocente,
    mostrarAlumno,
    mostrarOrientador
};
