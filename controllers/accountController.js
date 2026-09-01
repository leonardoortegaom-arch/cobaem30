const bcrypt = require('bcrypt');

const usuarioModel = require('../models/usuarioModel');
const alumnoModel = require('../models/alumnoModel');
const crearMenuPorRol = require('../config/roleMenus');

const RONDAS_BCRYPT = 12;
const opcionesCookieSesion = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
};

const destruirSesionYRedirigir = (req, res, destino = '/login') => {
    req.session.destroy(() => {
        res.clearCookie('cobaem30.sid', opcionesCookieSesion);
        res.redirect(destino);
    });
};

const crearUsuarioCuenta = (usuario) => ({
    id: usuario.id,
    nombre: usuario.nombre,
    apellido_paterno: usuario.apellido_paterno,
    apellido_materno: usuario.apellido_materno,
    correo: usuario.correo,
    activo: Boolean(usuario.activo),
    rol: usuario.rol_clave,
    rolNombre: usuario.rol_nombre
});

const obtenerPerfilAcademicoSeguro = async (usuarioCuenta) => {
    if (usuarioCuenta.rol !== 'ALUMNO') return null;

    const perfil = await alumnoModel.buscarPorUsuarioIdConGrupo(usuarioCuenta.id);
    if (!perfil) return null;

    return {
        matricula: perfil.matricula,
        grupoClave: perfil.grupo_clave,
        semestre: perfil.semestre,
        turno: perfil.turno_nombre,
        cicloEscolar: perfil.ciclo_escolar,
        grupoActivo: Boolean(perfil.grupo_activo)
    };
};

const renderizarCuenta = (
    res,
    { usuarioCuenta, perfilAcademico = null, error = null, status = 200 }
) => res
    .status(status)
    .render('account/index', {
        title: 'Mi cuenta | COBAEM 30',
        menuItems: crearMenuPorRol(usuarioCuenta.rol, { dashboardActivo: false }),
        usuarioCuenta,
        perfilAcademico,
        error
    });

const mostrarCuenta = async (req, res) => {
    const id = req.session.usuario.id;

    try {
        const usuario = await usuarioModel.buscarPorIdConRol(id);
        if (!usuario || !usuario.activo) {
            destruirSesionYRedirigir(req, res);
            return;
        }

        const usuarioCuenta = crearUsuarioCuenta(usuario);
        const perfilAcademico = await obtenerPerfilAcademicoSeguro(usuarioCuenta);

        renderizarCuenta(res, { usuarioCuenta, perfilAcademico });
    } catch {
        res.status(500).send('No fue posible cargar la cuenta.');
    }
};

const cambiarPassword = async (req, res) => {
    if (req.session.usuario.rol === 'ALUMNO') {
        res.status(403).send('No tienes permiso para cambiar la contraseña desde esta sección.');
        return;
    }

    const id = req.session.usuario.id;
    const passwordActual = typeof req.body.password_actual === 'string'
        ? req.body.password_actual
        : '';
    const passwordNueva = typeof req.body.password_nueva === 'string'
        ? req.body.password_nueva
        : '';
    const passwordConfirmacion = typeof req.body.password_confirmacion === 'string'
        ? req.body.password_confirmacion
        : '';

    try {
        const usuario = await usuarioModel.buscarPorIdConRol(id);
        if (!usuario || !usuario.activo) {
            destruirSesionYRedirigir(req, res);
            return;
        }

        const usuarioCuenta = crearUsuarioCuenta(usuario);
        const perfilAcademico = await obtenerPerfilAcademicoSeguro(usuarioCuenta);
        const responderValidacion = (mensaje) => renderizarCuenta(res, {
            usuarioCuenta,
            perfilAcademico,
            error: mensaje,
            status: 422
        });

        if (!passwordActual || !passwordNueva || !passwordConfirmacion) {
            responderValidacion('Todos los campos de contraseña son obligatorios.');
            return;
        }

        if (Buffer.byteLength(passwordActual, 'utf8') > 72) {
            responderValidacion('La contraseña actual no es válida.');
            return;
        }

        if (Array.from(passwordNueva).length < 12) {
            responderValidacion('La nueva contraseña debe tener al menos 12 caracteres.');
            return;
        }

        if (Buffer.byteLength(passwordNueva, 'utf8') > 72) {
            responderValidacion('La nueva contraseña no puede superar 72 bytes.');
            return;
        }

        if (passwordNueva !== passwordConfirmacion) {
            responderValidacion('La confirmación de contraseña no coincide.');
            return;
        }

        const credenciales = await usuarioModel.buscarCredencialesPorId(id);
        if (!credenciales || !credenciales.activo) {
            destruirSesionYRedirigir(req, res);
            return;
        }

        const passwordActualCorrecta = await bcrypt.compare(
            passwordActual,
            credenciales.password_hash
        );
        if (!passwordActualCorrecta) {
            responderValidacion('La contraseña actual no es correcta.');
            return;
        }

        const passwordRepetida = await bcrypt.compare(
            passwordNueva,
            credenciales.password_hash
        );
        if (passwordRepetida) {
            responderValidacion('La nueva contraseña debe ser diferente de la actual.');
            return;
        }

        const passwordHash = await bcrypt.hash(passwordNueva, RONDAS_BCRYPT);
        const resultado = await usuarioModel.actualizarPasswordEInvalidarSesiones(id, passwordHash);
        if (resultado.affectedRows !== 1) {
            throw new Error('No se actualizó la cuenta esperada.');
        }

        destruirSesionYRedirigir(req, res, '/login?password=actualizada');
    } catch {
        res.status(500).send('No fue posible cambiar la contraseña.');
    }
};

module.exports = {
    mostrarCuenta,
    cambiarPassword
};
