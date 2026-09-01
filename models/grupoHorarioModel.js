const pool = require('../config/database');

const listarPorGrupo = async (grupoId) => {
    const [rows] = await pool.execute(
        `SELECT dia, hora_inicio, hora_fin, materia, aula
         FROM grupo_horarios
         WHERE grupo_id = ?
         ORDER BY FIELD(dia, 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'), hora_inicio`,
        [grupoId]
    );
    return rows;
};

const reemplazarPorGrupo = async (grupoId, filas) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.execute('DELETE FROM grupo_horarios WHERE grupo_id = ?', [grupoId]);
        for (const fila of filas) {
            await connection.execute(
                `INSERT INTO grupo_horarios (grupo_id, dia, hora_inicio, hora_fin, materia, aula)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [grupoId, fila.dia, fila.horaInicio, fila.horaFin, fila.materia, fila.aula || null]
            );
        }
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const eliminarPorGrupo = async (grupoId) => {
    const [result] = await pool.execute(
        'DELETE FROM grupo_horarios WHERE grupo_id = ?',
        [grupoId]
    );
    return result;
};

module.exports = { listarPorGrupo, reemplazarPorGrupo, eliminarPorGrupo };