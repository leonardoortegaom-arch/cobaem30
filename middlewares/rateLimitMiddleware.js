const { rateLimit } = require('express-rate-limit');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    identifier: 'login',
    handler: (req, res) => {
        const correo = typeof req.body.correo === 'string'
            ? req.body.correo.trim().toLowerCase()
            : '';

        res.status(429).render('auth/login', {
            error: 'Demasiados intentos de acceso. Espera 15 minutos antes de intentarlo nuevamente.',
            correo
        });
    }
});

module.exports = {
    loginLimiter
};
