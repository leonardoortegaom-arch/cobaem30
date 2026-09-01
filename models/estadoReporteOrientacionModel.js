const pool = require('../config/database');

const buscarPorClave = async (clave) => {
    const [rows] = await pool.execute(
        `SELECT id, clave, nombre, es_terminal
         FROM estados_reporte_orientacion
         WHERE clave = ?
         LIMIT 1`,
        [clave]
    );
    return rows[0] || null;
};

module.exports = { buscarPorClave };
