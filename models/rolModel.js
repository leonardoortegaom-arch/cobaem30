const pool = require('../config/database');

const listarTodos = async () => {
    const [rows] = await pool.execute(
        `SELECT id, clave, nombre, descripcion
         FROM roles
         ORDER BY id`
    );

    return rows;
};

const buscarPorId = async (id) => {
    const [rows] = await pool.execute(
        `SELECT id, clave, nombre
         FROM roles
         WHERE id = ?
         LIMIT 1`,
        [id]
    );

    return rows[0] || null;
};

module.exports = {
    listarTodos,
    buscarPorId
};
