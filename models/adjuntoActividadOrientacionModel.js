const pool = require('../config/database');

const listarPorActividadYAlumno = async (actividadId, alumnoUsuarioId) => {
    const [rows] = await pool.execute(
        `SELECT
            adjuntos.id,
            adjuntos.nombre_original,
            adjuntos.extension,
            adjuntos.mime_type,
            adjuntos.tamano_bytes,
            adjuntos.creado_en,
            (adjuntos.subido_por_usuario_id = ?) AS puede_eliminar
         FROM adjuntos_actividad_orientacion AS adjuntos
         INNER JOIN actividades_orientacion AS actividades
            ON actividades.id = adjuntos.actividad_orientacion_id
         WHERE adjuntos.actividad_orientacion_id = ?
           AND actividades.alumno_usuario_id = ?
         ORDER BY adjuntos.creado_en DESC, adjuntos.id DESC`,
        [alumnoUsuarioId, actividadId, alumnoUsuarioId]
    );
    return rows;
};

const obtenerUsoPorActividad = async (actividadId, alumnoUsuarioId, executor = pool, { bloquear = false } = {}) => {
    const [activityRows] = await executor.execute(
        `SELECT actividades.id, estados.clave AS estado_clave
         FROM actividades_orientacion AS actividades
         INNER JOIN estados_actividad_orientacion AS estados ON estados.id = actividades.estado_id
         WHERE actividades.id = ? AND actividades.alumno_usuario_id = ?
         LIMIT 1${bloquear ? ' FOR UPDATE' : ''}`,
        [actividadId, alumnoUsuarioId]
    );
    if (!activityRows[0]) return null;
    const [usageRows] = await executor.execute(
        `SELECT COUNT(*) AS cantidad, COALESCE(SUM(tamano_bytes), 0) AS bytes
         FROM adjuntos_actividad_orientacion
         WHERE actividad_orientacion_id = ?`,
        [actividadId]
    );
    return {
        estadoClave: activityRows[0].estado_clave,
        cantidad: Number(usageRows[0].cantidad),
        bytes: Number(usageRows[0].bytes)
    };
};

const insertarVarios = async (connection, adjuntos) => {
    const placeholders = adjuntos.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values = adjuntos.flatMap((adjunto) => [
        adjunto.actividadId,
        adjunto.subidoPorUsuarioId,
        adjunto.nombreOriginal,
        adjunto.claveAlmacenamiento,
        adjunto.extension,
        adjunto.mimeType,
        adjunto.tamanoBytes,
        adjunto.hashSha256
    ]);
    const [result] = await connection.execute(
        `INSERT INTO adjuntos_actividad_orientacion (
            actividad_orientacion_id, subido_por_usuario_id, nombre_original,
            clave_almacenamiento, extension, mime_type, tamano_bytes, hash_sha256
         ) VALUES ${placeholders}`,
        values
    );
    return result;
};

const buscarParaDescarga = async (adjuntoId, actividadId, alumnoUsuarioId) => {
    const [rows] = await pool.execute(
        `SELECT adjuntos.id, adjuntos.nombre_original, adjuntos.clave_almacenamiento,
                adjuntos.extension, adjuntos.mime_type, adjuntos.tamano_bytes
         FROM adjuntos_actividad_orientacion AS adjuntos
         INNER JOIN actividades_orientacion AS actividades
            ON actividades.id = adjuntos.actividad_orientacion_id
         WHERE adjuntos.id = ?
           AND adjuntos.actividad_orientacion_id = ?
           AND actividades.alumno_usuario_id = ?
         LIMIT 1`,
        [adjuntoId, actividadId, alumnoUsuarioId]
    );
    return rows[0] || null;
};

const listarPorActividadYOrientador = async (actividadId, alumnoUsuarioId, orientadorUsuarioId) => {
    const [rows] = await pool.execute(
        `SELECT
            adjuntos.id,
            adjuntos.nombre_original,
            adjuntos.extension,
            adjuntos.mime_type,
            adjuntos.tamano_bytes,
            adjuntos.creado_en
         FROM adjuntos_actividad_orientacion AS adjuntos
         INNER JOIN actividades_orientacion AS actividades
            ON actividades.id = adjuntos.actividad_orientacion_id
         INNER JOIN alumnos
            ON alumnos.usuario_id = actividades.alumno_usuario_id
         INNER JOIN usuarios AS orientadores
            ON orientadores.id = actividades.orientador_usuario_id
         WHERE adjuntos.actividad_orientacion_id = ?
           AND actividades.alumno_usuario_id = ?
           AND actividades.orientador_usuario_id = ?
         ORDER BY adjuntos.creado_en DESC, adjuntos.id DESC`,
        [actividadId, alumnoUsuarioId, orientadorUsuarioId]
    );
    return rows;
};

const buscarParaDescargaPorOrientador = async (
    adjuntoId,
    actividadId,
    alumnoUsuarioId,
    orientadorUsuarioId
) => {
    const [rows] = await pool.execute(
        `SELECT
            adjuntos.id,
            adjuntos.nombre_original,
            adjuntos.clave_almacenamiento,
            adjuntos.extension,
            adjuntos.mime_type,
            adjuntos.tamano_bytes
         FROM adjuntos_actividad_orientacion AS adjuntos
         INNER JOIN actividades_orientacion AS actividades
            ON actividades.id = adjuntos.actividad_orientacion_id
         INNER JOIN alumnos
            ON alumnos.usuario_id = actividades.alumno_usuario_id
         INNER JOIN usuarios AS orientadores
            ON orientadores.id = actividades.orientador_usuario_id
         WHERE adjuntos.id = ?
           AND adjuntos.actividad_orientacion_id = ?
           AND actividades.alumno_usuario_id = ?
           AND actividades.orientador_usuario_id = ?
         LIMIT 1`,
        [adjuntoId, actividadId, alumnoUsuarioId, orientadorUsuarioId]
    );
    return rows[0] || null;
};

const buscarParaEliminar = async (adjuntoId, actividadId, alumnoUsuarioId, subidoPorUsuarioId, executor = pool) => {
    const [rows] = await executor.execute(
        `SELECT adjuntos.id, adjuntos.clave_almacenamiento, adjuntos.extension,
                estados.clave AS estado_clave
         FROM adjuntos_actividad_orientacion AS adjuntos
         INNER JOIN actividades_orientacion AS actividades
            ON actividades.id = adjuntos.actividad_orientacion_id
         INNER JOIN estados_actividad_orientacion AS estados ON estados.id = actividades.estado_id
         WHERE adjuntos.id = ?
           AND adjuntos.actividad_orientacion_id = ?
           AND actividades.alumno_usuario_id = ?
           AND adjuntos.subido_por_usuario_id = ?
         LIMIT 1 FOR UPDATE`,
        [adjuntoId, actividadId, alumnoUsuarioId, subidoPorUsuarioId]
    );
    return rows[0] || null;
};

const eliminarCondicional = async (connection, { adjuntoId, actividadId, alumnoUsuarioId, subidoPorUsuarioId }) => {
    const [result] = await connection.execute(
        `DELETE adjuntos
         FROM adjuntos_actividad_orientacion AS adjuntos
         INNER JOIN actividades_orientacion AS actividades
            ON actividades.id = adjuntos.actividad_orientacion_id
         INNER JOIN estados_actividad_orientacion AS estados ON estados.id = actividades.estado_id
         WHERE adjuntos.id = ?
           AND adjuntos.actividad_orientacion_id = ?
           AND actividades.alumno_usuario_id = ?
           AND adjuntos.subido_por_usuario_id = ?
           AND estados.clave IN (?, ?)`,
        [adjuntoId, actividadId, alumnoUsuarioId, subidoPorUsuarioId, 'PENDIENTE', 'EN_PROCESO']
    );
    return result;
};

module.exports = {
    listarPorActividadYAlumno,
    obtenerUsoPorActividad,
    insertarVarios,
    buscarParaDescarga,
    listarPorActividadYOrientador,
    buscarParaDescargaPorOrientador,
    buscarParaEliminar,
    eliminarCondicional
};
