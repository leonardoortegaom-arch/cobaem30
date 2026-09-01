const pool = require('../config/database');

const listarActivos = async () => {
    const [rows] = await pool.execute(
        `SELECT id, clave, nombre, descripcion
         FROM tipos_seguimiento
         WHERE activo = 1
         ORDER BY nombre ASC`
    );

    return rows;
};

const listarTodos = async () => {
    const [rows] = await pool.execute(
        `SELECT id, clave, nombre, descripcion, activo
         FROM tipos_seguimiento
         ORDER BY nombre ASC`
    );

    return rows;
};

const buscarActivoPorId = async (id) => {
    const [rows] = await pool.execute(
        `SELECT id, clave, nombre, descripcion
         FROM tipos_seguimiento
         WHERE id = ? AND activo = 1
         LIMIT 1`,
        [id]
    );

    return rows[0] || null;
};

module.exports = {
    listarActivos,
    listarTodos,
    buscarActivoPorId
};
