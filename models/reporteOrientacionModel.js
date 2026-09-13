const pool = require('../config/database');

const obtenerReporteAlumno = async (alumnoUsuarioId, orientadorUsuarioId, { desde, hasta }) => {
    const [seguimientosResultado, actividadesResultado] = await Promise.all([
        pool.execute(
            `SELECT
                seguimientos.fecha_seguimiento AS fecha,
                seguimientos.titulo,
                seguimientos.descripcion,
                tipos_seguimiento.clave AS tipo_clave,
                tipos_seguimiento.nombre AS tipo_nombre,
                CONCAT_WS(' ', orientadores.nombre, orientadores.apellido_paterno, orientadores.apellido_materno) AS orientador_nombre
             FROM seguimientos
             INNER JOIN tipos_seguimiento ON tipos_seguimiento.id = seguimientos.tipo_id
             INNER JOIN usuarios AS orientadores ON orientadores.id = seguimientos.orientador_usuario_id
             WHERE seguimientos.alumno_usuario_id = ?
               AND EXISTS (SELECT 1 FROM alumnos
                   INNER JOIN asignaciones_orientador_grupo AS asignaciones ON asignaciones.grupo_id = alumnos.grupo_id
                   WHERE alumnos.usuario_id = seguimientos.alumno_usuario_id
                     AND asignaciones.orientador_usuario_id = ? AND asignaciones.fecha_fin IS NULL)
               AND seguimientos.fecha_seguimiento BETWEEN ? AND ?
             ORDER BY seguimientos.fecha_seguimiento ASC,
                      seguimientos.creado_en ASC,
                      seguimientos.id ASC`,
            [alumnoUsuarioId, orientadorUsuarioId, desde, hasta]
        ),
        pool.execute(
            `SELECT
                actividades_orientacion.fecha_asignacion,
                actividades_orientacion.fecha_realizacion,
                actividades_orientacion.titulo,
                actividades_orientacion.instrucciones,
                estados_actividad_orientacion.clave AS estado_clave,
                estados_actividad_orientacion.nombre AS estado_nombre,
                CONCAT_WS(' ', orientadores.nombre, orientadores.apellido_paterno, orientadores.apellido_materno) AS orientador_nombre
             FROM actividades_orientacion
             INNER JOIN estados_actividad_orientacion
                ON estados_actividad_orientacion.id = actividades_orientacion.estado_id
             INNER JOIN usuarios AS orientadores
                ON orientadores.id = actividades_orientacion.orientador_usuario_id
             WHERE actividades_orientacion.alumno_usuario_id = ?
               AND EXISTS (SELECT 1 FROM alumnos
                   INNER JOIN asignaciones_orientador_grupo AS asignaciones ON asignaciones.grupo_id = alumnos.grupo_id
                   WHERE alumnos.usuario_id = actividades_orientacion.alumno_usuario_id
                     AND asignaciones.orientador_usuario_id = ? AND asignaciones.fecha_fin IS NULL)
               AND COALESCE(
                    actividades_orientacion.fecha_realizacion,
                    actividades_orientacion.fecha_asignacion
               ) BETWEEN ? AND ?
             ORDER BY COALESCE(
                        actividades_orientacion.fecha_realizacion,
                        actividades_orientacion.fecha_asignacion
                      ) ASC,
                      actividades_orientacion.creado_en ASC,
                      actividades_orientacion.id ASC`,
            [alumnoUsuarioId, orientadorUsuarioId, desde, hasta]
        )
    ]);

    return {
        seguimientos: seguimientosResultado[0],
        actividades: actividadesResultado[0]
    };
};

module.exports = {
    obtenerReporteAlumno
};
