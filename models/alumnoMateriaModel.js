const pool = require('../config/database');

const ESTADOS = Object.freeze({
    NO_STUDENT_PROFILE: 'NO_STUDENT_PROFILE',
    NO_GROUP: 'NO_GROUP',
    GROUP_CALENDAR_PENDING: 'GROUP_CALENDAR_PENDING',
    NO_ACTIVE_SCHEDULE: 'NO_ACTIVE_SCHEDULE',
    ACTIVE_SCHEDULE_EMPTY: 'ACTIVE_SCHEDULE_EMPTY',
    ACTIVE_SCHEDULE_AVAILABLE: 'ACTIVE_SCHEDULE_AVAILABLE',
    DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE'
});

const crearModelo = (db = pool) => {
    const obtenerEstadoAcademico = async (usuarioId) => {
        const [rows] = await db.execute(
            `SELECT
                alumnos.usuario_id,
                alumnos.grupo_id AS alumno_grupo_id,
                grupos.id AS grupo_id,
                grupos.generacion_id,
                grupos.periodo_academico_id,
                versiones.id AS version_horario_id,
                clases.id AS clase_id,
                clases.dia_semana,
                TIME_FORMAT(clases.hora_inicio, '%H:%i') AS hora_inicio,
                TIME_FORMAT(clases.hora_fin, '%H:%i') AS hora_fin,
                materias.clave AS materia_clave,
                materias.nombre AS materia_nombre,
                materias.descripcion AS materia_descripcion,
                CONCAT_WS(' ', docentes.nombre, docentes.apellido_paterno,
                    docentes.apellido_materno) AS docente_nombre,
                aulas.nombre AS aula_nombre
             FROM alumnos
             LEFT JOIN grupos ON grupos.id = alumnos.grupo_id
             LEFT JOIN versiones_horario AS versiones
                ON versiones.grupo_id = grupos.id
               AND versiones.periodo_academico_id = grupos.periodo_academico_id
               AND versiones.activa = 1
             LEFT JOIN clases_programadas AS clases
                ON clases.version_horario_id = versiones.id
             LEFT JOIN materias ON materias.id = clases.materia_id
             LEFT JOIN usuarios AS docentes ON docentes.id = clases.docente_usuario_id
             LEFT JOIN aulas ON aulas.id = clases.aula_id
             WHERE alumnos.usuario_id = ?
             ORDER BY materias.nombre ASC, materias.id ASC,
                      clases.dia_semana ASC, clases.hora_inicio ASC,
                      clases.hora_fin ASC, clases.id ASC`,
            [usuarioId]
        );

        if (rows.length === 0) return { estado: ESTADOS.NO_STUDENT_PROFILE, filas: [] };
        const base = rows[0];
        if (!base.alumno_grupo_id || !base.grupo_id) return { estado: ESTADOS.NO_GROUP, filas: [] };
        if (!base.generacion_id || !base.periodo_academico_id) {
            return { estado: ESTADOS.GROUP_CALENDAR_PENDING, filas: [] };
        }
        if (!base.version_horario_id) return { estado: ESTADOS.NO_ACTIVE_SCHEDULE, filas: [] };
        const clases = rows.filter((row) => row.clase_id !== null && row.clase_id !== undefined);
        if (clases.length === 0) return { estado: ESTADOS.ACTIVE_SCHEDULE_EMPTY, filas: [] };
        return { estado: ESTADOS.ACTIVE_SCHEDULE_AVAILABLE, filas: clases };
    };
    return { obtenerEstadoAcademico };
};

module.exports = { ...crearModelo(), crearModelo, ESTADOS };
