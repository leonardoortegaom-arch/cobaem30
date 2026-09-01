const pool = require('../config/database');

const listarPorDocente = async (docenteId) => {
    const [rows] = await pool.execute(
        `SELECT dia, hora_inicio, hora_fin, materia, grupo, aula
         FROM docente_horarios
         WHERE docente_id = ?
         ORDER BY FIELD(dia, 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'), hora_inicio`,
        [docenteId]
    );
    return rows;
};

const reemplazarPorDocente = async (docenteId, filas) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.execute('DELETE FROM docente_horarios WHERE docente_id = ?', [docenteId]);
        for (const fila of filas) {
            await connection.execute(
                `INSERT INTO docente_horarios (docente_id, dia, hora_inicio, hora_fin, materia, grupo, aula)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [docenteId, fila.dia, fila.horaInicio, fila.horaFin, fila.materia, fila.grupo || null, fila.aula || null]
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

const eliminarPorDocente = async (docenteId) => {
    const [result] = await pool.execute('DELETE FROM docente_horarios WHERE docente_id = ?', [docenteId]);
    return result;
};

module.exports = { listarPorDocente, reemplazarPorDocente, eliminarPorDocente };