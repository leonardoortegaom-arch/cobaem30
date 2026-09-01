const { csrfSync } = require('csrf-sync');

const {
    generateToken: generateCsrfToken,
    csrfSynchronisedProtection
} = csrfSync({
    ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
    getTokenFromRequest: (req) => {
        if (req.is('application/x-www-form-urlencoded')) {
            return req.body?._csrf;
        }

        return req.headers['x-csrf-token'];
    }
});

const attachCsrfToken = (req, res, next) => {
    res.locals.csrfToken = generateCsrfToken(req);
    next();
};

const csrfProtection = csrfSynchronisedProtection;

const csrfErrorHandler = (error, req, res, next) => {
    if (error.code === 'EBADCSRFTOKEN') {
        res.status(403).send(
            'La solicitud no es válida o ha expirado. Recarga la página e inténtalo nuevamente.'
        );
        return;
    }

    next(error);
};

module.exports = {
    generateCsrfToken,
    attachCsrfToken,
    csrfProtection,
    csrfErrorHandler
};
