const pool = require('../config/database');

const buscarPorClave = async (clave, executor = pool) => {
    const [rows] = await executor.execute(
        `SELECT id, clave, nombre, descripcion, activo
         FROM estados_actividad_orientacion
         WHERE clave = ? AND activo = 1
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
         WHERE clave IN (${placeholders}) AND activo = 1
         ORDER BY orden ASC`,
        claves
    );

    return rows;
};

module.exports = {
    buscarPorClave,
    buscarPorClaves
};
