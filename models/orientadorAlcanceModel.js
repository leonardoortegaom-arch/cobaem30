const pool = require('../config/database');

const crearModelo = (db = pool) => {
    const puedeAccederAlumno = async (orientadorUsuarioId, alumnoUsuarioId, conexion = db) => {
        const [rows] = await conexion.execute(
            `SELECT 1 AS autorizado
             FROM alumnos
             INNER JOIN asignaciones_orientador_grupo AS asignaciones
                ON asignaciones.grupo_id = alumnos.grupo_id
               AND asignaciones.orientador_usuario_id = ?
               AND asignaciones.fecha_fin IS NULL
             WHERE alumnos.usuario_id = ?
             LIMIT 1`,
            [orientadorUsuarioId, alumnoUsuarioId]
        );
        return Boolean(rows[0]);
    };

    const listarGruposVigentes = async (orientadorUsuarioId) => {
        const [rows] = await db.execute(
            `SELECT grupos.id, grupos.clave, grupos.semestre, grupos.ciclo_escolar,
                    turnos.nombre AS turno_nombre
             FROM asignaciones_orientador_grupo AS asignaciones
             INNER JOIN grupos ON grupos.id = asignaciones.grupo_id
             INNER JOIN turnos ON turnos.id = grupos.turno_id
             WHERE asignaciones.orientador_usuario_id = ?
               AND asignaciones.fecha_fin IS NULL
             ORDER BY grupos.ciclo_escolar DESC, grupos.semestre, grupos.clave`,
            [orientadorUsuarioId]
        );
        return rows;
    };

    return { puedeAccederAlumno, listarGruposVigentes };
};

module.exports = { ...crearModelo(), crearModelo };
