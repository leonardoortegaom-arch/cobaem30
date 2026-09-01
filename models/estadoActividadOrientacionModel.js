const pool = require('../config/database');

const buscarPorClave = async (clave) => {
    const [rows] = await pool.execute(
        `SELECT id, clave, nombre, descripcion, activo
         FROM estados_actividad_orientacion
         WHERE clave = ?
         LIMIT 1`,
        [clave]
    );

    return rows[0] || null;
};

const buscarPorClaves = async (claves) => {
    if (!Array.isArray(claves) || claves.length === 0) return [];

    const placeholders = claves.map(() => '?').join(', ');
    const [rows] = await pool.execute(
        `SELECT id, clave, nombre, descripcion, activo
         FROM estados_actividad_orientacion
         WHERE clave IN (${placeholders})
         ORDER BY orden ASC`,
        claves
    );

    return rows;
};

module.exports = {
    buscarPorClave,
    buscarPorClaves
};
