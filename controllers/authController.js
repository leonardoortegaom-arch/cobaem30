const bcrypt = require('bcrypt');

const usuarioModel = require('../models/usuarioModel');

const MENSAJE_CREDENCIALES_INVALIDAS = 'Correo o contraseña incorrectos.';
const DASHBOARDS_POR_ROL = {
    ADMINISTRADOR: '/dashboard/admin',
    DOCENTE: '/dashboard/docente',
    ALUMNO: '/dashboard/alumno',
    ORIENTADOR: '/dashboard/orientador'
};

const regenerarSesion = (req) => new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
        if (error) {
            reject(error);
            return;
        }

        resolve();
    });
});

const guardarSesion = (req) => new Promise((resolve, reject) => {
    req.session.save((error) => {
        if (error) {
            reject(error);
            return;
        }

        resolve();
    });
});

const opcionesCookieSesion = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
};

const mostrarLogin = (req, res) => {
    if (req.session.usuario) {
        const dashboard = DASHBOARDS_POR_ROL[req.session.usuario.rol];
        if (dashboard) {
            res.redirect(dashboard);
            return;
        }
    }

    res.render('auth/login', {
        error: null,
        correo: '',
        mensaje: req.query.password === 'actualizada'
            ? 'Contraseña actualizada correctamente. Inicia sesión nuevamente.'
            : null
    });
};

const procesarLogin = async (req, res) => {
    const correo = typeof req.body.correo === 'string'
        ? req.body.correo.trim().toLowerCase()
        : '';
    const password = typeof req.body.password === 'string'
        ? req.body.password
        : '';

    const renderizarCredencialesInvalidas = () => res.status(401).render('auth/login', {
        error: MENSAJE_CREDENCIALES_INVALIDAS,
        correo
    });

    if (!correo || !password) {
        renderizarCredencialesInvalidas();
        return;
    }

    try {
        const usuario = await usuarioModel.buscarParaAutenticacionPorCorreo(correo);
        const passwordCorrecto = usuario
            ? await bcrypt.compare(password, usuario.password_hash)
            : false;

        if (!usuario || !usuario.activo || !passwordCorrecto) {
            renderizarCredencialesInvalidas();
            return;
        }

        const dashboard = DASHBOARDS_POR_ROL[usuario.rol_clave];
        if (!dashboard) {
            throw new Error('Rol sin dashboard configurado.');
        }

        const versionCredenciales = Number(usuario.versionCredenciales);
        if (!Number.isSafeInteger(versionCredenciales) || versionCredenciales <= 0) {
            throw new Error('Versión de credenciales inválida.');
        }

        await regenerarSesion(req);

        req.session.usuario = {
            id: usuario.id,
            nombre: usuario.nombre,
            correo: usuario.correo,
            rol: usuario.rol_clave,
            versionCredenciales
        };

        await usuarioModel.actualizarUltimoAcceso(usuario.id);
        await guardarSesion(req);

        res.redirect(dashboard);
    } catch {
        res.status(500).render('auth/login', {
            error: 'No fue posible iniciar sesión. Inténtalo de nuevo.',
            correo
        });
    }
};

const cerrarSesion = (req, res) => {
    const limpiarCookieYRedirigir = () => {
        res.clearCookie('cobaem30.sid', opcionesCookieSesion);
        res.redirect('/login');
    };

    if (!req.session || !req.session.usuario) {
        limpiarCookieYRedirigir();
        return;
    }

    req.session.destroy(() => {
        limpiarCookieYRedirigir();
    });
};

module.exports = {
    mostrarLogin,
    procesarLogin,
    cerrarSesion
};
