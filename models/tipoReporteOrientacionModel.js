const pool = require('../config/database');

const listarTodos = async () => {
    const [rows] = await pool.execute(
        `SELECT clave, nombre, descripcion
         FROM tipos_reporte_orientacion
         ORDER BY nombre ASC`
    );
    return rows;
};

const buscarPorClave = async (clave) => {
    const [rows] = await pool.execute(
        `SELECT id, clave, nombre, descripcion
         FROM tipos_reporte_orientacion
         WHERE clave = ?
         LIMIT 1`,
        [clave]
    );
    return rows[0] || null;
};

module.exports = { listarTodos, buscarPorClave };
