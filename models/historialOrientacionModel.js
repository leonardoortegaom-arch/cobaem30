const pool = require('../config/database');

const CONSULTA_UNIFICADA = `
    SELECT
        'SEGUIMIENTO' AS tipoRegistro,
        seguimientos.id AS registroId,
        usuarios.id AS alumnoUsuarioId,
        alumnos.matricula,
        CONCAT_WS(' ', usuarios.nombre, usuarios.apellido_paterno, usuarios.apellido_materno) AS alumnoNombre,
        grupos.clave AS grupo,
        grupos.semestre,
        turnos.nombre AS turno,
        grupos.ciclo_escolar AS ciclo,
        seguimientos.fecha_seguimiento AS fechaEvento,
        NULL AS fechaAsignacion,
        NULL AS fechaRealizacion,
        seguimientos.titulo,
        seguimientos.descripcion AS contenido,
        tipos_seguimiento.nombre AS categoria,
        NULL AS estadoClave,
        NULL AS estadoNombre,
        CONCAT_WS(' ', orientadores.nombre, orientadores.apellido_paterno, orientadores.apellido_materno) AS orientadorNombre,
        seguimientos.creado_en AS fechaCreacion
    FROM seguimientos
    INNER JOIN alumnos ON alumnos.usuario_id = seguimientos.alumno_usuario_id
    INNER JOIN usuarios ON usuarios.id = alumnos.usuario_id
    INNER JOIN grupos ON grupos.id = alumnos.grupo_id
    INNER JOIN turnos ON turnos.id = grupos.turno_id
    INNER JOIN tipos_seguimiento ON tipos_seguimiento.id = seguimientos.tipo_id
    INNER JOIN usuarios AS orientadores ON orientadores.id = seguimientos.orientador_usuario_id

    UNION ALL

    SELECT
        'ACTIVIDAD' AS tipoRegistro,
        actividades_orientacion.id AS registroId,
        usuarios.id AS alumnoUsuarioId,
        alumnos.matricula,
        CONCAT_WS(' ', usuarios.nombre, usuarios.apellido_paterno, usuarios.apellido_materno) AS alumnoNombre,
        grupos.clave AS grupo,
        grupos.semestre,
        turnos.nombre AS turno,
        grupos.ciclo_escolar AS ciclo,
        COALESCE(actividades_orientacion.fecha_realizacion, actividades_orientacion.fecha_asignacion) AS fechaEvento,
        actividades_orientacion.fecha_asignacion AS fechaAsignacion,
        actividades_orientacion.fecha_realizacion AS fechaRealizacion,
        actividades_orientacion.titulo,
        actividades_orientacion.instrucciones AS contenido,
        'Actividad de orientación' AS categoria,
        estados_actividad_orientacion.clave AS estadoClave,
        estados_actividad_orientacion.nombre AS estadoNombre,
        CONCAT_WS(' ', orientadores.nombre, orientadores.apellido_paterno, orientadores.apellido_materno) AS orientadorNombre,
        actividades_orientacion.creado_en AS fechaCreacion
    FROM actividades_orientacion
    INNER JOIN alumnos ON alumnos.usuario_id = actividades_orientacion.alumno_usuario_id
    INNER JOIN usuarios ON usuarios.id = alumnos.usuario_id
    INNER JOIN grupos ON grupos.id = alumnos.grupo_id
    INNER JOIN turnos ON turnos.id = grupos.turno_id
    INNER JOIN estados_actividad_orientacion
        ON estados_actividad_orientacion.id = actividades_orientacion.estado_id
    INNER JOIN usuarios AS orientadores ON orientadores.id = actividades_orientacion.orientador_usuario_id
`;

const construirCondiciones = ({ q, tipo, fechaDesde, fechaHasta } = {}) => {
    const condiciones = [];
    const parametros = [];

    if (q) {
        const patron = `%${q}%`;
        condiciones.push(`(
            historial.matricula LIKE ?
            OR historial.alumnoNombre LIKE ?
            OR historial.titulo LIKE ?
            OR historial.contenido LIKE ?
            OR historial.orientadorNombre LIKE ?
        )`);
        parametros.push(patron, patron, patron, patron, patron);
    }

    if (tipo === 'SEGUIMIENTO' || tipo === 'ACTIVIDAD') {
        condiciones.push('historial.tipoRegistro = ?');
        parametros.push(tipo);
    }

    if (fechaDesde) {
        condiciones.push('historial.fechaEvento >= ?');
        parametros.push(fechaDesde);
    }

    if (fechaHasta) {
        condiciones.push('historial.fechaEvento <= ?');
        parametros.push(fechaHasta);
    }

    return {
        clausulaWhere: condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '',
        parametros
    };
};

const listarPaginado = async ({
    q,
    tipo,
    fechaDesde,
    fechaHasta,
    limite,
    offset
} = {}) => {
    const limiteSeguro = Number.isInteger(limite) && limite > 0 ? limite : 10;
    const offsetSeguro = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    const { clausulaWhere, parametros } = construirCondiciones({
        q,
        tipo,
        fechaDesde,
        fechaHasta
    });
    const [rows] = await pool.execute(
        `SELECT
            historial.tipoRegistro,
            historial.registroId,
            historial.alumnoUsuarioId,
            historial.matricula,
            historial.alumnoNombre,
            historial.grupo,
            historial.semestre,
            historial.turno,
            historial.ciclo,
            historial.fechaEvento,
            historial.fechaAsignacion,
            historial.fechaRealizacion,
            historial.titulo,
            historial.contenido,
            historial.categoria,
            historial.estadoClave,
            historial.estadoNombre,
            historial.orientadorNombre
         FROM (${CONSULTA_UNIFICADA}) AS historial
         ${clausulaWhere}
         ORDER BY historial.fechaEvento DESC,
                  historial.fechaCreacion DESC,
                  historial.tipoRegistro ASC,
                  historial.registroId DESC
         LIMIT ? OFFSET ?`,
        [...parametros, String(limiteSeguro), String(offsetSeguro)]
    );

    return rows;
};

const contarFiltrados = async ({ q, tipo, fechaDesde, fechaHasta } = {}) => {
    const { clausulaWhere, parametros } = construirCondiciones({
        q,
        tipo,
        fechaDesde,
        fechaHasta
    });
    const [rows] = await pool.execute(
        `SELECT COUNT(*) AS total
         FROM (${CONSULTA_UNIFICADA}) AS historial
         ${clausulaWhere}`,
        parametros
    );
    const total = Number(rows[0]?.total);

    return Number.isSafeInteger(total) && total >= 0 ? total : 0;
};

module.exports = {
    listarPaginado,
    contarFiltrados
};
