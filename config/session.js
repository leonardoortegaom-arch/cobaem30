const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);

const pool = require('./database');

const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret || !sessionSecret.trim()) {
    throw new Error('SESSION_SECRET es obligatoria para iniciar el servidor.');
}

const sessionStore = new MySQLStore(
    {
        createDatabaseTable: false,
        endConnectionOnClose: false,
        schema: {
            tableName: 'sessions'
        }
    },
    pool
);

const sessionMiddleware = session({
    name: 'cobaem30.sid',
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 8 * 60 * 60 * 1000
    }
});

module.exports = sessionMiddleware;
