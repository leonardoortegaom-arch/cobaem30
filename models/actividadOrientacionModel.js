const pool = require('../config/database');

const crear = async (actividad) => {
    const [result] = await pool.execute(
        `INSERT INTO actividades_orientacion (
            alumno_usuario_id,
            orientador_usuario_id,
            estado_id,
            titulo,
            instrucciones,
            fecha_asignacion
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
            actividad.alumno_usuario_id,
            actividad.orientador_usuario_id,
            actividad.estado_id,
            actividad.titulo,
            actividad.instrucciones,
            actividad.fecha_asignacion
        ]
    );

    return result.insertId;
};

const listarRecientesPorAlumno = async (alumnoUsuarioId, limite = 5) => {
    const limiteSeguro = Number.isInteger(limite) && limite > 0 ? limite : 5;
    const [rows] = await pool.execute(
        `SELECT
            actividades_orientacion.id,
            actividades_orientacion.titulo,
            actividades_orientacion.instrucciones AS descripcion,
            actividades_orientacion.fecha_asignacion AS fecha_programada,
            actividades_orientacion.fecha_realizacion,
            actividades_orientacion.orientador_usuario_id,
            estados_actividad_orientacion.clave AS estado_clave,
            estados_actividad_orientacion.nombre AS estado_nombre,
            CONCAT_WS(' ', orientadores.nombre, orientadores.apellido_paterno, orientadores.apellido_materno) AS orientador_nombre
         FROM actividades_orientacion
         INNER JOIN estados_actividad_orientacion
            ON estados_actividad_orientacion.id = actividades_orientacion.estado_id
         INNER JOIN usuarios AS orientadores
            ON orientadores.id = actividades_orientacion.orientador_usuario_id
         WHERE actividades_orientacion.alumno_usuario_id = ?
         ORDER BY actividades_orientacion.fecha_asignacion DESC,
                  actividades_orientacion.creado_en DESC,
                  actividades_orientacion.id DESC
         LIMIT ?`,
        [alumnoUsuarioId, String(limiteSeguro)]
    );

    return rows;
};

const obtenerResumenGeneral = async () => {
    const [rows] = await pool.execute(
        `SELECT
            (
                SELECT COUNT(*)
                FROM alumnos
                INNER JOIN usuarios ON usuarios.id = alumnos.usuario_id
                INNER JOIN roles ON roles.id = usuarios.rol_id
                WHERE usuarios.activo = 1 AND roles.clave = ?
            ) AS total_alumnos_activos,
            (SELECT COUNT(*) FROM seguimientos) AS total_seguimientos,
            (
                SELECT COUNT(*)
                FROM actividades_orientacion
                INNER JOIN estados_actividad_orientacion
                    ON estados_actividad_orientacion.id = actividades_orientacion.estado_id
                WHERE estados_actividad_orientacion.clave = ?
            ) AS total_actividades_pendientes,
            (
                SELECT COUNT(*)
                FROM actividades_orientacion
                INNER JOIN estados_actividad_orientacion
                    ON estados_actividad_orientacion.id = actividades_orientacion.estado_id
                WHERE estados_actividad_orientacion.clave = ?
            ) AS total_actividades_en_proceso,
            (
                SELECT COUNT(*)
                FROM actividades_orientacion
                INNER JOIN estados_actividad_orientacion
                    ON estados_actividad_orientacion.id = actividades_orientacion.estado_id
                WHERE estados_actividad_orientacion.clave IN (?, ?)
                  AND actividades_orientacion.fecha_asignacion < CURRENT_DATE()
            ) AS total_actividades_vencidas`,
        ['ALUMNO', 'PENDIENTE', 'EN_PROCESO', 'PENDIENTE', 'EN_PROCESO']
    );
    const resultado = rows[0] || {};
    const numeroSeguro = (valor) => {
        const numero = Number(valor);
        return Number.isSafeInteger(numero) && numero >= 0 ? numero : 0;
    };

    return {
        totalAlumnosActivos: numeroSeguro(resultado.total_alumnos_activos),
        totalSeguimientos: numeroSeguro(resultado.total_seguimientos),
        totalActividadesPendientes: numeroSeguro(resultado.total_actividades_pendientes),
        totalActividadesEnProceso: numeroSeguro(resultado.total_actividades_en_proceso),
        totalActividadesVencidas: numeroSeguro(resultado.total_actividades_vencidas)
    };
};

const listarActividadesQueRequierenAtencion = async (limite = 10) => {
    const limiteSeguro = Number.isInteger(limite) && limite > 0 ? limite : 10;
    const [rows] = await pool.execute(
        `SELECT
            actividades_orientacion.id,
            actividades_orientacion.orientador_usuario_id,
            usuarios.id AS alumno_usuario_id,
            CONCAT_WS(' ', usuarios.nombre, usuarios.apellido_paterno, usuarios.apellido_materno) AS alumno_nombre,
            alumnos.matricula,
            grupos.clave AS grupo_clave,
            actividades_orientacion.titulo,
            actividades_orientacion.fecha_asignacion,
            estados_actividad_orientacion.clave AS estado_clave,
            estados_actividad_orientacion.nombre AS estado_nombre,
            (actividades_orientacion.fecha_asignacion < CURRENT_DATE()) AS vencida
         FROM actividades_orientacion
         INNER JOIN estados_actividad_orientacion
            ON estados_actividad_orientacion.id = actividades_orientacion.estado_id
         INNER JOIN alumnos ON alumnos.usuario_id = actividades_orientacion.alumno_usuario_id
         INNER JOIN usuarios ON usuarios.id = alumnos.usuario_id
         INNER JOIN grupos ON grupos.id = alumnos.grupo_id
         WHERE estados_actividad_orientacion.clave IN (?, ?)
         ORDER BY vencida DESC,
                  actividades_orientacion.fecha_asignacion ASC,
                  actividades_orientacion.id ASC
         LIMIT ?`,
        ['PENDIENTE', 'EN_PROCESO', String(limiteSeguro)]
    );

    return rows;
};

const buscarPorIdYAlumnoConEstado = async (actividadId, alumnoUsuarioId) => {
    const [rows] = await pool.execute(
        `SELECT
            actividades_orientacion.id,
            actividades_orientacion.alumno_usuario_id,
            actividades_orientacion.orientador_usuario_id,
            actividades_orientacion.titulo,
            actividades_orientacion.instrucciones,
            DATE_FORMAT(actividades_orientacion.fecha_asignacion, '%Y-%m-%d') AS fecha_asignacion,
            DATE_FORMAT(actividades_orientacion.fecha_realizacion, '%Y-%m-%d') AS fecha_realizacion,
            actividades_orientacion.estado_id,
            estados_actividad_orientacion.clave AS estado_clave,
            estados_actividad_orientacion.nombre AS estado_nombre
         FROM actividades_orientacion
         INNER JOIN estados_actividad_orientacion
            ON estados_actividad_orientacion.id = actividades_orientacion.estado_id
         WHERE actividades_orientacion.id = ?
           AND actividades_orientacion.alumno_usuario_id = ?
         LIMIT 1`,
        [actividadId, alumnoUsuarioId]
    );

    return rows[0] || null;
};

const actualizarEstadoCondicional = async ({
    actividadId,
    alumnoUsuarioId,
    orientadorUsuarioId,
    estadoIdAnterior,
    estadoIdNuevo,
    fechaRealizacion
}) => {
    const [result] = await pool.execute(
        `UPDATE actividades_orientacion
         SET estado_id = ?, fecha_realizacion = ?
         WHERE id = ?
           AND alumno_usuario_id = ?
           AND orientador_usuario_id = ?
           AND estado_id = ?`,
        [
            estadoIdNuevo,
            fechaRealizacion,
            actividadId,
            alumnoUsuarioId,
            orientadorUsuarioId,
            estadoIdAnterior
        ]
    );

    return result;
};

const obtenerResumenPersonal = async (orientadorUsuarioId, fechaActual) => {
    const [rows] = await pool.execute(
        `SELECT
            COUNT(*) AS total_abiertas,
            SUM(actividades_orientacion.fecha_asignacion < ?) AS total_vencidas
         FROM actividades_orientacion
         INNER JOIN estados_actividad_orientacion
            ON estados_actividad_orientacion.id = actividades_orientacion.estado_id
         WHERE actividades_orientacion.orientador_usuario_id = ?
           AND estados_actividad_orientacion.clave IN (?, ?)`,
        [fechaActual, orientadorUsuarioId, 'PENDIENTE', 'EN_PROCESO']
    );
    const numeroSeguro = (valor) => {
        const numero = Number(valor);
        return Number.isSafeInteger(numero) && numero >= 0 ? numero : 0;
    };
    return {
        totalAbiertas: numeroSeguro(rows[0]?.total_abiertas),
        totalVencidas: numeroSeguro(rows[0]?.total_vencidas)
    };
};

const listarAbiertasPorOrientador = async (orientadorUsuarioId, limite = 5, fechaActual) => {
    const limiteSeguro = Number.isInteger(limite) && limite > 0 ? limite : 5;
    const [rows] = await pool.execute(
        `SELECT
            actividades_orientacion.id AS actividad_id,
            usuarios.id AS alumno_usuario_id,
            CONCAT_WS(' ', usuarios.nombre, usuarios.apellido_paterno, usuarios.apellido_materno) AS alumno_nombre,
            alumnos.matricula,
            grupos.clave AS grupo_clave,
            actividades_orientacion.titulo,
            actividades_orientacion.fecha_asignacion,
            estados_actividad_orientacion.clave AS estado_clave,
            estados_actividad_orientacion.nombre AS estado_nombre,
            (actividades_orientacion.fecha_asignacion < ?) AS vencida
         FROM actividades_orientacion
         INNER JOIN estados_actividad_orientacion
            ON estados_actividad_orientacion.id = actividades_orientacion.estado_id
         INNER JOIN alumnos ON alumnos.usuario_id = actividades_orientacion.alumno_usuario_id
         INNER JOIN usuarios ON usuarios.id = alumnos.usuario_id
         INNER JOIN grupos ON grupos.id = alumnos.grupo_id
         WHERE actividades_orientacion.orientador_usuario_id = ?
           AND estados_actividad_orientacion.clave IN (?, ?)
         ORDER BY vencida DESC,
                  actividades_orientacion.fecha_asignacion ASC,
                  actividades_orientacion.id ASC
         LIMIT ?`,
        [fechaActual, orientadorUsuarioId, 'PENDIENTE', 'EN_PROCESO', String(limiteSeguro)]
    );
    return rows;
};

const construirFiltrosAlumno = ({ busqueda = '', estadoClave } = {}) => {
    const condiciones = [];
    const parametros = [];

    if (busqueda) {
        const patron = `%${busqueda}%`;
        condiciones.push(`(
            actividades_orientacion.titulo LIKE ?
            OR actividades_orientacion.instrucciones LIKE ?
            OR CONCAT_WS(' ', orientadores.nombre, orientadores.apellido_paterno, orientadores.apellido_materno) LIKE ?
        )`);
        parametros.push(patron, patron, patron);
    }

    if (estadoClave) {
        condiciones.push('estados_actividad_orientacion.clave = ?');
        parametros.push(estadoClave);
    }

    return {
        sql: condiciones.length ? ` AND ${condiciones.join(' AND ')}` : '',
        parametros
    };
};

const obtenerResumenPorAlumno = async (alumnoUsuarioId, fechaActual) => {
    const [rows] = await pool.execute(
        `SELECT
            SUM(estados_actividad_orientacion.clave = ?) AS pendientes,
            SUM(estados_actividad_orientacion.clave = ?) AS en_proceso,
            SUM(estados_actividad_orientacion.clave = ?) AS realizadas,
            SUM(estados_actividad_orientacion.clave = ?) AS no_realizadas,
            SUM(estados_actividad_orientacion.clave = ?) AS canceladas,
            SUM(estados_actividad_orientacion.clave IN (?, ?)) AS abiertas,
            SUM(
                estados_actividad_orientacion.clave IN (?, ?)
                AND actividades_orientacion.fecha_asignacion < ?
            ) AS vencidas
         FROM actividades_orientacion
         INNER JOIN estados_actividad_orientacion
            ON estados_actividad_orientacion.id = actividades_orientacion.estado_id
         WHERE actividades_orientacion.alumno_usuario_id = ?`,
        [
            'PENDIENTE',
            'EN_PROCESO',
            'REALIZADA',
            'NO_REALIZADA',
            'CANCELADA',
            'PENDIENTE',
            'EN_PROCESO',
            'PENDIENTE',
            'EN_PROCESO',
            fechaActual,
            alumnoUsuarioId
        ]
    );
    const numeroSeguro = (valor) => {
        const numero = Number(valor);
        return Number.isSafeInteger(numero) && numero >= 0 ? numero : 0;
    };
    const resumen = rows[0] || {};
    return {
        pendientes: numeroSeguro(resumen.pendientes),
        enProceso: numeroSeguro(resumen.en_proceso),
        realizadas: numeroSeguro(resumen.realizadas),
        noRealizadas: numeroSeguro(resumen.no_realizadas),
        canceladas: numeroSeguro(resumen.canceladas),
        abiertas: numeroSeguro(resumen.abiertas),
        vencidas: numeroSeguro(resumen.vencidas)
    };
};

const listarPorAlumnoPaginado = async (alumnoUsuarioId, filtros) => {
    const { sql, parametros } = construirFiltrosAlumno(filtros);
    const [rows] = await pool.execute(
        `SELECT
            actividades_orientacion.id,
            actividades_orientacion.titulo,
            actividades_orientacion.instrucciones,
            DATE_FORMAT(actividades_orientacion.fecha_asignacion, '%Y-%m-%d') AS fecha_asignacion,
            DATE_FORMAT(actividades_orientacion.fecha_realizacion, '%Y-%m-%d') AS fecha_realizacion,
            estados_actividad_orientacion.clave AS estado_clave,
            estados_actividad_orientacion.nombre AS estado_nombre,
            CONCAT_WS(' ', orientadores.nombre, orientadores.apellido_paterno, orientadores.apellido_materno) AS orientador_nombre
         FROM actividades_orientacion
         INNER JOIN estados_actividad_orientacion
            ON estados_actividad_orientacion.id = actividades_orientacion.estado_id
         INNER JOIN usuarios AS orientadores
            ON orientadores.id = actividades_orientacion.orientador_usuario_id
         WHERE actividades_orientacion.alumno_usuario_id = ?${sql}
         ORDER BY
            CASE
                WHEN estados_actividad_orientacion.clave IN (?, ?)
                     AND actividades_orientacion.fecha_asignacion < ? THEN 1
                WHEN estados_actividad_orientacion.clave IN (?, ?)
                     AND actividades_orientacion.fecha_asignacion = ? THEN 2
                WHEN estados_actividad_orientacion.clave IN (?, ?)
                     AND actividades_orientacion.fecha_asignacion > ? THEN 3
                ELSE 4
            END ASC,
            CASE
                WHEN estados_actividad_orientacion.clave IN (?, ?)
                    THEN actividades_orientacion.fecha_asignacion
            END ASC,
            CASE
                WHEN estados_actividad_orientacion.clave NOT IN (?, ?)
                    THEN COALESCE(actividades_orientacion.fecha_realizacion, actividades_orientacion.fecha_asignacion)
            END DESC,
            actividades_orientacion.id DESC
         LIMIT ? OFFSET ?`,
        [
            alumnoUsuarioId,
            ...parametros,
            'PENDIENTE', 'EN_PROCESO', filtros.fechaActual,
            'PENDIENTE', 'EN_PROCESO', filtros.fechaActual,
            'PENDIENTE', 'EN_PROCESO', filtros.fechaActual,
            'PENDIENTE', 'EN_PROCESO',
            'PENDIENTE', 'EN_PROCESO',
            String(filtros.limite),
            String(filtros.offset)
        ]
    );
    return rows;
};

const contarPorAlumno = async (alumnoUsuarioId, filtros) => {
    const { sql, parametros } = construirFiltrosAlumno(filtros);
    const [rows] = await pool.execute(
        `SELECT COUNT(*) AS total
         FROM actividades_orientacion
         INNER JOIN estados_actividad_orientacion
            ON estados_actividad_orientacion.id = actividades_orientacion.estado_id
         INNER JOIN usuarios AS orientadores
            ON orientadores.id = actividades_orientacion.orientador_usuario_id
         WHERE actividades_orientacion.alumno_usuario_id = ?${sql}`,
        [alumnoUsuarioId, ...parametros]
    );
    const total = Number(rows[0]?.total);
    return Number.isSafeInteger(total) && total >= 0 ? total : 0;
};

const buscarDetallePorIdYAlumno = async (actividadId, alumnoUsuarioId) => {
    const [rows] = await pool.execute(
        `SELECT
            actividades_orientacion.id,
            actividades_orientacion.titulo,
            actividades_orientacion.instrucciones,
            DATE_FORMAT(actividades_orientacion.fecha_asignacion, '%Y-%m-%d') AS fecha_asignacion,
            DATE_FORMAT(actividades_orientacion.fecha_realizacion, '%Y-%m-%d') AS fecha_realizacion,
            estados_actividad_orientacion.clave AS estado_clave,
            estados_actividad_orientacion.nombre AS estado_nombre,
            CONCAT_WS(' ', orientadores.nombre, orientadores.apellido_paterno, orientadores.apellido_materno) AS orientador_nombre
         FROM actividades_orientacion
         INNER JOIN estados_actividad_orientacion
            ON estados_actividad_orientacion.id = actividades_orientacion.estado_id
         INNER JOIN usuarios AS orientadores
            ON orientadores.id = actividades_orientacion.orientador_usuario_id
         WHERE actividades_orientacion.id = ?
           AND actividades_orientacion.alumno_usuario_id = ?
         LIMIT 1`,
        [actividadId, alumnoUsuarioId]
    );
    return rows[0] || null;
};

const buscarDetalleParaOrientador = async (actividadId, alumnoUsuarioId, orientadorUsuarioId) => {
    const [rows] = await pool.execute(
        `SELECT
            actividades.id,
            actividades.titulo,
            actividades.instrucciones,
            DATE_FORMAT(actividades.fecha_asignacion, '%Y-%m-%d') AS fecha_asignacion,
            DATE_FORMAT(actividades.fecha_realizacion, '%Y-%m-%d') AS fecha_realizacion,
            estados.clave AS estado_clave,
            estados.nombre AS estado_nombre,
            CONCAT_WS(' ', orientadores.nombre, orientadores.apellido_paterno, orientadores.apellido_materno) AS orientador_nombre,
            (actividades.orientador_usuario_id = ?) AS es_responsable
         FROM actividades_orientacion AS actividades
         INNER JOIN estados_actividad_orientacion AS estados
            ON estados.id = actividades.estado_id
         INNER JOIN usuarios AS orientadores
            ON orientadores.id = actividades.orientador_usuario_id
         WHERE actividades.id = ?
           AND actividades.alumno_usuario_id = ?
         LIMIT 1`,
        [orientadorUsuarioId, actividadId, alumnoUsuarioId]
    );
    return rows[0] || null;
};

module.exports = {
    crear,
    listarRecientesPorAlumno,
    obtenerResumenGeneral,
    listarActividadesQueRequierenAtencion,
    buscarPorIdYAlumnoConEstado,
    actualizarEstadoCondicional,
    obtenerResumenPersonal,
    listarAbiertasPorOrientador,
    obtenerResumenPorAlumno,
    listarPorAlumnoPaginado,
    contarPorAlumno,
    buscarDetallePorIdYAlumno,
    buscarDetalleParaOrientador
};
