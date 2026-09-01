const usuarioModel = require('../models/usuarioModel');

const DASHBOARDS_POR_ROL = {
    ADMINISTRADOR: '/dashboard/admin',
    DOCENTE: '/dashboard/docente',
    ALUMNO: '/dashboard/alumno',
    ORIENTADOR: '/dashboard/orientador'
};

const opcionesCookieSesion = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
};

const destruirSesion = (req) => new Promise((resolve, reject) => {
    req.session.destroy((error) => {
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

const responderServicioNoDisponible = (res) => {
    res.status(503).send('No fue posible validar la sesión. Inténtalo nuevamente.');
};

const requireAuth = async (req, res, next) => {
    res.set('Cache-Control', 'no-store');

    if (!req.session.usuario || !req.session.usuario.id) {
        res.redirect('/login');
        return;
    }

    try {
        const usuarioSesion = req.session.usuario;
        const usuario = await usuarioModel.buscarEstadoAutorizacionPorId(usuarioSesion.id);
        const versionActual = Number(usuario?.versionCredenciales);
        const versionSesion = usuarioSesion.versionCredenciales;
        const versionInvalida = !Number.isSafeInteger(versionActual)
            || versionActual <= 0
            || !Number.isSafeInteger(versionSesion)
            || versionSesion <= 0
            || versionSesion !== versionActual;

        if (!usuario || !usuario.activo || versionInvalida) {
            try {
                await destruirSesion(req);
            } catch {
                res.clearCookie('cobaem30.sid', opcionesCookieSesion);
                responderServicioNoDisponible(res);
                return;
            }

            res.clearCookie('cobaem30.sid', opcionesCookieSesion);
            res.redirect('/login');
            return;
        }

        const usuarioActualizado = {
            id: usuario.id,
            nombre: usuario.nombre,
            correo: usuario.correo,
            rol: usuario.rol,
            versionCredenciales: versionActual
        };
        const sesionCambio = usuarioSesion.id !== usuarioActualizado.id
            || usuarioSesion.nombre !== usuarioActualizado.nombre
            || usuarioSesion.correo !== usuarioActualizado.correo
            || usuarioSesion.rol !== usuarioActualizado.rol
            || usuarioSesion.versionCredenciales !== usuarioActualizado.versionCredenciales;

        req.session.usuario = usuarioActualizado;

        if (sesionCambio) {
            await guardarSesion(req);
        }

        res.locals.usuario = {
            id: usuarioActualizado.id,
            nombre: usuarioActualizado.nombre,
            correo: usuarioActualizado.correo,
            rol: usuarioActualizado.rol
        };
        next();
    } catch {
        responderServicioNoDisponible(res);
    }
};

const requireRole = (...rolesPermitidos) => (req, res, next) => {
    const usuario = req.session.usuario;

    if (!usuario) {
        res.redirect('/login');
        return;
    }

    if (rolesPermitidos.includes(usuario.rol)) {
        next();
        return;
    }

    const dashboard = DASHBOARDS_POR_ROL[usuario.rol];
    if (!dashboard) {
        res.sendStatus(403);
        return;
    }

    const rutaActual = req.originalUrl.split('?')[0];
    if (rutaActual === dashboard) {
        res.sendStatus(403);
        return;
    }

    res.redirect(dashboard);
};

module.exports = {
    requireAuth,
    requireRole
};
