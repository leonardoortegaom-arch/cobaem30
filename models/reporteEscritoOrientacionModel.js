const pool = require('../config/database');

const crearBorrador = async (datos) => {
    const [result] = await pool.execute(
        `INSERT INTO reportes_orientacion (
            alumno_usuario_id,
            orientador_usuario_id,
            tipo_reporte_id,
            estado_id,
            fecha_reporte,
            periodo_desde,
            periodo_hasta,
            motivo,
            contenido,
            conclusiones,
            recomendaciones
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            datos.alumnoUsuarioId,
            datos.orientadorUsuarioId,
            datos.tipoReporteId,
            datos.estadoId,
            datos.fechaReporte,
            datos.periodoDesde,
            datos.periodoHasta,
            datos.motivo,
            datos.contenido,
            datos.conclusiones,
            datos.recomendaciones
        ]
    );
    return result.insertId;
};

const buscarAccesoPorId = async (reporteId, orientadorUsuarioId) => {
    const [rows] = await pool.execute(
        `SELECT reportes.id, reportes.orientador_usuario_id, estados.clave AS estado_clave
         FROM reportes_orientacion AS reportes
         INNER JOIN estados_reporte_orientacion AS estados ON estados.id = reportes.estado_id
         INNER JOIN alumnos ON alumnos.usuario_id = reportes.alumno_usuario_id
         INNER JOIN asignaciones_orientador_grupo AS asignaciones ON asignaciones.grupo_id = alumnos.grupo_id
         WHERE reportes.id = ?
           AND reportes.orientador_usuario_id = ?
           AND asignaciones.orientador_usuario_id = ? AND asignaciones.fecha_fin IS NULL
         LIMIT 1`,
        [reporteId, orientadorUsuarioId, orientadorUsuarioId]
    );
    return rows[0] || null;
};

const crearBorradorAutorizado = async (datos) => {
    const [result] = await pool.execute(
        `INSERT INTO reportes_orientacion (
            alumno_usuario_id, orientador_usuario_id, tipo_reporte_id, estado_id,
            fecha_reporte, periodo_desde, periodo_hasta, motivo, contenido,
            conclusiones, recomendaciones
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         FROM alumnos
         INNER JOIN asignaciones_orientador_grupo AS asignaciones
            ON asignaciones.grupo_id = alumnos.grupo_id
         WHERE alumnos.usuario_id = ?
           AND asignaciones.orientador_usuario_id = ?
           AND asignaciones.fecha_fin IS NULL`,
        [datos.alumnoUsuarioId, datos.orientadorUsuarioId, datos.tipoReporteId,
            datos.estadoId, datos.fechaReporte, datos.periodoDesde, datos.periodoHasta,
            datos.motivo, datos.contenido, datos.conclusiones, datos.recomendaciones,
            datos.alumnoUsuarioId, datos.orientadorUsuarioId]
    );
    return result.affectedRows === 1 ? result.insertId : null;
};

const buscarPorIdConDetalle = async (reporteId, orientadorUsuarioId) => {
    const [rows] = await pool.execute(
        `SELECT
            reportes.id,
            reportes.alumno_usuario_id,
            reportes.orientador_usuario_id,
            tipos.clave AS tipo_clave,
            tipos.nombre AS tipo_nombre,
            estados.clave AS estado_clave,
            estados.nombre AS estado_nombre,
            DATE_FORMAT(reportes.fecha_reporte, '%Y-%m-%d') AS fecha_reporte,
            DATE_FORMAT(reportes.periodo_desde, '%Y-%m-%d') AS periodo_desde,
            DATE_FORMAT(reportes.periodo_hasta, '%Y-%m-%d') AS periodo_hasta,
            reportes.motivo,
            reportes.contenido,
            reportes.conclusiones,
            reportes.recomendaciones,
            reportes.version,
            reportes.actualizado_en,
            CONCAT_WS(' ', alumnos_usuario.nombre, alumnos_usuario.apellido_paterno, alumnos_usuario.apellido_materno) AS alumno_nombre,
            alumnos.matricula,
            grupos.clave AS grupo_clave,
            grupos.semestre,
            turnos.nombre AS turno_nombre,
            grupos.ciclo_escolar,
            alumnos_usuario.activo AS alumno_activo
         FROM reportes_orientacion AS reportes
         INNER JOIN tipos_reporte_orientacion AS tipos ON tipos.id = reportes.tipo_reporte_id
         INNER JOIN estados_reporte_orientacion AS estados ON estados.id = reportes.estado_id
         INNER JOIN usuarios AS alumnos_usuario ON alumnos_usuario.id = reportes.alumno_usuario_id
         INNER JOIN alumnos ON alumnos.usuario_id = alumnos_usuario.id
         INNER JOIN grupos ON grupos.id = alumnos.grupo_id
         INNER JOIN asignaciones_orientador_grupo AS asignaciones ON asignaciones.grupo_id = alumnos.grupo_id
         INNER JOIN turnos ON turnos.id = grupos.turno_id
         WHERE reportes.id = ?
           AND reportes.orientador_usuario_id = ?
           AND asignaciones.orientador_usuario_id = ? AND asignaciones.fecha_fin IS NULL
         LIMIT 1`,
        [reporteId, orientadorUsuarioId, orientadorUsuarioId]
    );
    return rows[0] || null;
};

const buscarBorradorPorIdYAutor = async (reporteId, orientadorUsuarioId) => {
    const [rows] = await pool.execute(
        `SELECT reportes.id, reportes.version
         FROM reportes_orientacion AS reportes
         INNER JOIN estados_reporte_orientacion AS estados ON estados.id = reportes.estado_id
         WHERE reportes.id = ?
           AND reportes.orientador_usuario_id = ?
           AND estados.clave = ?
         LIMIT 1`,
        [reporteId, orientadorUsuarioId, 'BORRADOR']
    );
    return rows[0] || null;
};

const actualizarBorradorCondicional = async (datos) => {
    const [result] = await pool.execute(
        `UPDATE reportes_orientacion
         SET tipo_reporte_id = ?,
             periodo_desde = ?,
             periodo_hasta = ?,
             motivo = ?,
             contenido = ?,
             conclusiones = ?,
             recomendaciones = ?,
             version = version + 1
         WHERE id = ?
           AND orientador_usuario_id = ?
           AND estado_id = ?
           AND version = ?
           AND EXISTS (SELECT 1 FROM alumnos
               INNER JOIN asignaciones_orientador_grupo AS asignaciones ON asignaciones.grupo_id = alumnos.grupo_id
               WHERE alumnos.usuario_id = reportes_orientacion.alumno_usuario_id
                 AND asignaciones.orientador_usuario_id = ? AND asignaciones.fecha_fin IS NULL)`,
        [
            datos.tipoReporteId,
            datos.periodoDesde,
            datos.periodoHasta,
            datos.motivo,
            datos.contenido,
            datos.conclusiones,
            datos.recomendaciones,
            datos.reporteId,
            datos.orientadorUsuarioId,
            datos.estadoIdBorrador,
            datos.versionAnterior, datos.orientadorUsuarioId
        ]
    );
    return result;
};

const listarBorradoresPorAutor = async (orientadorUsuarioId, limite = 10) => {
    const limiteSeguro = Number.isSafeInteger(Number(limite)) && Number(limite) > 0
        ? Math.min(Number(limite), 50)
        : 10;
    const [rows] = await pool.execute(
        `SELECT
            reportes.id,
            CONCAT_WS(' ', alumnos_usuario.nombre, alumnos_usuario.apellido_paterno, alumnos_usuario.apellido_materno) AS alumno_nombre,
            alumnos.matricula,
            tipos.nombre AS tipo_nombre,
            reportes.motivo,
            DATE_FORMAT(reportes.periodo_desde, '%Y-%m-%d') AS periodo_desde,
            DATE_FORMAT(reportes.periodo_hasta, '%Y-%m-%d') AS periodo_hasta,
            DATE_FORMAT(reportes.fecha_reporte, '%Y-%m-%d') AS fecha_reporte,
            reportes.actualizado_en
         FROM reportes_orientacion AS reportes
         INNER JOIN estados_reporte_orientacion AS estados ON estados.id = reportes.estado_id
         INNER JOIN tipos_reporte_orientacion AS tipos ON tipos.id = reportes.tipo_reporte_id
         INNER JOIN usuarios AS alumnos_usuario ON alumnos_usuario.id = reportes.alumno_usuario_id
         INNER JOIN alumnos ON alumnos.usuario_id = alumnos_usuario.id
         INNER JOIN asignaciones_orientador_grupo AS asignaciones ON asignaciones.grupo_id = alumnos.grupo_id
         WHERE reportes.orientador_usuario_id = ?
           AND estados.clave = ?
           AND asignaciones.orientador_usuario_id = ? AND asignaciones.fecha_fin IS NULL
         ORDER BY reportes.actualizado_en DESC, reportes.id DESC
         LIMIT ?`,
        [orientadorUsuarioId, 'BORRADOR', orientadorUsuarioId, String(limiteSeguro)]
    );
    return rows;
};

module.exports = {
    crearBorrador,
    crearBorradorAutorizado,
    buscarAccesoPorId,
    buscarPorIdConDetalle,
    buscarBorradorPorIdYAutor,
    actualizarBorradorCondicional,
    listarBorradoresPorAutor
};
