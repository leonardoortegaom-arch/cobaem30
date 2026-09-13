const pool = require('../config/database');

const crear = async (seguimiento) => {
    const [result] = await pool.execute(
        `INSERT INTO seguimientos (
            alumno_usuario_id,
            orientador_usuario_id,
            tipo_id,
            fecha_seguimiento,
            titulo,
            descripcion
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
            seguimiento.alumno_usuario_id,
            seguimiento.orientador_usuario_id,
            seguimiento.tipo_id,
            seguimiento.fecha_seguimiento,
            seguimiento.titulo,
            seguimiento.descripcion
        ]
    );

    return result.insertId;
};

const crearAutorizado = async (seguimiento) => {
    const [result] = await pool.execute(
        `INSERT INTO seguimientos (
            alumno_usuario_id, orientador_usuario_id, tipo_id,
            fecha_seguimiento, titulo, descripcion
         )
         SELECT ?, ?, ?, ?, ?, ?
         FROM alumnos
         INNER JOIN asignaciones_orientador_grupo AS asignaciones
            ON asignaciones.grupo_id = alumnos.grupo_id
         WHERE alumnos.usuario_id = ?
           AND asignaciones.orientador_usuario_id = ?
           AND asignaciones.fecha_fin IS NULL`,
        [seguimiento.alumno_usuario_id, seguimiento.orientador_usuario_id,
            seguimiento.tipo_id, seguimiento.fecha_seguimiento, seguimiento.titulo,
            seguimiento.descripcion, seguimiento.alumno_usuario_id,
            seguimiento.orientador_usuario_id]
    );
    return result.affectedRows === 1 ? result.insertId : null;
};

const listarRecientesPorAlumno = async (alumnoUsuarioId, limite = 5) => {
    const limiteSeguro = Number.isInteger(limite) && limite > 0 ? limite : 5;
    const [rows] = await pool.execute(
        `SELECT
            tipos_seguimiento.clave AS tipo_clave,
            tipos_seguimiento.nombre AS tipo_nombre,
            seguimientos.fecha_seguimiento,
            seguimientos.titulo,
            seguimientos.descripcion,
            CONCAT_WS(' ', orientadores.nombre, orientadores.apellido_paterno, orientadores.apellido_materno) AS orientador_nombre
         FROM seguimientos
         INNER JOIN tipos_seguimiento ON tipos_seguimiento.id = seguimientos.tipo_id
         INNER JOIN usuarios AS orientadores ON orientadores.id = seguimientos.orientador_usuario_id
         WHERE seguimientos.alumno_usuario_id = ?
         ORDER BY seguimientos.fecha_seguimiento DESC, seguimientos.creado_en DESC, seguimientos.id DESC
         LIMIT ?`,
        [alumnoUsuarioId, String(limiteSeguro)]
    );

    return rows;
};

const construirCondicionesHistorial = ({
    alumnoUsuarioId,
    q,
    tipoId,
    fechaDesde,
    fechaHasta
} = {}) => {
    const condiciones = ['seguimientos.alumno_usuario_id = ?'];
    const parametros = [alumnoUsuarioId];

    if (q) {
        const patron = `%${q}%`;
        condiciones.push(`(
            seguimientos.titulo LIKE ?
            OR seguimientos.descripcion LIKE ?
            OR CONCAT_WS(' ', orientadores.nombre, orientadores.apellido_paterno, orientadores.apellido_materno) LIKE ?
        )`);
        parametros.push(patron, patron, patron);
    }

    if (Number.isInteger(tipoId)) {
        condiciones.push('seguimientos.tipo_id = ?');
        parametros.push(tipoId);
    }

    if (fechaDesde) {
        condiciones.push('seguimientos.fecha_seguimiento >= ?');
        parametros.push(fechaDesde);
    }

    if (fechaHasta) {
        condiciones.push('seguimientos.fecha_seguimiento <= ?');
        parametros.push(fechaHasta);
    }

    return {
        clausulaWhere: `WHERE ${condiciones.join(' AND ')}`,
        parametros
    };
};

const listarPaginadoPorAlumno = async ({
    alumnoUsuarioId,
    q,
    tipoId,
    fechaDesde,
    fechaHasta,
    limite,
    offset
} = {}) => {
    const limiteSeguro = Number.isInteger(limite) && limite > 0 ? limite : 10;
    const offsetSeguro = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    const { clausulaWhere, parametros } = construirCondicionesHistorial({
        alumnoUsuarioId,
        q,
        tipoId,
        fechaDesde,
        fechaHasta
    });
    const [rows] = await pool.execute(
        `SELECT
            seguimientos.id,
            seguimientos.fecha_seguimiento AS fecha,
            seguimientos.titulo,
            seguimientos.descripcion,
            tipos_seguimiento.clave AS tipo_clave,
            tipos_seguimiento.nombre AS tipo_nombre,
            CONCAT_WS(' ', orientadores.nombre, orientadores.apellido_paterno, orientadores.apellido_materno) AS orientador_nombre
         FROM seguimientos
         INNER JOIN tipos_seguimiento ON tipos_seguimiento.id = seguimientos.tipo_id
         INNER JOIN usuarios AS orientadores ON orientadores.id = seguimientos.orientador_usuario_id
         ${clausulaWhere}
         ORDER BY seguimientos.fecha_seguimiento DESC, seguimientos.creado_en DESC, seguimientos.id DESC
         LIMIT ? OFFSET ?`,
        [...parametros, String(limiteSeguro), String(offsetSeguro)]
    );

    return rows;
};

const contarFiltradosPorAlumno = async ({
    alumnoUsuarioId,
    q,
    tipoId,
    fechaDesde,
    fechaHasta
} = {}) => {
    const { clausulaWhere, parametros } = construirCondicionesHistorial({
        alumnoUsuarioId,
        q,
        tipoId,
        fechaDesde,
        fechaHasta
    });
    const [rows] = await pool.execute(
        `SELECT COUNT(*) AS total
         FROM seguimientos
         INNER JOIN tipos_seguimiento ON tipos_seguimiento.id = seguimientos.tipo_id
         INNER JOIN usuarios AS orientadores ON orientadores.id = seguimientos.orientador_usuario_id
         ${clausulaWhere}`,
        parametros
    );
    const total = Number(rows[0]?.total);

    return Number.isSafeInteger(total) && total >= 0 ? total : 0;
};

const listarSeguimientosRecientesGlobales = async (orientadorUsuarioId, limite = 10) => {
    const limiteSeguro = Number.isInteger(limite) && limite > 0 ? limite : 10;
    const [rows] = await pool.execute(
        `SELECT
            usuarios.id AS alumno_usuario_id,
            CONCAT_WS(' ', usuarios.nombre, usuarios.apellido_paterno, usuarios.apellido_materno) AS alumno_nombre,
            alumnos.matricula,
            tipos_seguimiento.nombre AS tipo_nombre,
            seguimientos.titulo,
            seguimientos.fecha_seguimiento,
            CONCAT_WS(' ', orientadores.nombre, orientadores.apellido_paterno, orientadores.apellido_materno) AS orientador_nombre
         FROM seguimientos
         INNER JOIN alumnos ON alumnos.usuario_id = seguimientos.alumno_usuario_id
         INNER JOIN usuarios ON usuarios.id = alumnos.usuario_id
         INNER JOIN tipos_seguimiento ON tipos_seguimiento.id = seguimientos.tipo_id
         INNER JOIN usuarios AS orientadores ON orientadores.id = seguimientos.orientador_usuario_id
         INNER JOIN asignaciones_orientador_grupo AS asignaciones
            ON asignaciones.grupo_id = alumnos.grupo_id
           AND asignaciones.orientador_usuario_id = ?
           AND asignaciones.fecha_fin IS NULL
         ORDER BY seguimientos.fecha_seguimiento DESC,
                  seguimientos.creado_en DESC,
                  seguimientos.id DESC
         LIMIT ?`,
        [orientadorUsuarioId, String(limiteSeguro)]
    );

    return rows;
};

const contarPorOrientadorEnPeriodo = async (orientadorUsuarioId, desde, hastaExclusivo) => {
    const [rows] = await pool.execute(
        `SELECT COUNT(*) AS total
         FROM seguimientos
         INNER JOIN alumnos ON alumnos.usuario_id = seguimientos.alumno_usuario_id
         INNER JOIN asignaciones_orientador_grupo AS asignaciones
            ON asignaciones.grupo_id = alumnos.grupo_id
           AND asignaciones.orientador_usuario_id = ?
           AND asignaciones.fecha_fin IS NULL
         WHERE seguimientos.orientador_usuario_id = ?
           AND fecha_seguimiento >= ?
           AND fecha_seguimiento < ?`,
        [orientadorUsuarioId, orientadorUsuarioId, desde, hastaExclusivo]
    );
    const total = Number(rows[0]?.total);
    return Number.isSafeInteger(total) && total >= 0 ? total : 0;
};

const listarRecientesPorOrientador = async (orientadorUsuarioId, limite = 5) => {
    const limiteSeguro = Number.isInteger(limite) && limite > 0 ? limite : 5;
    const [rows] = await pool.execute(
        `SELECT
            usuarios.id AS alumno_usuario_id,
            CONCAT_WS(' ', usuarios.nombre, usuarios.apellido_paterno, usuarios.apellido_materno) AS alumno_nombre,
            alumnos.matricula,
            tipos_seguimiento.nombre AS tipo_nombre,
            seguimientos.titulo,
            seguimientos.fecha_seguimiento
         FROM seguimientos
         INNER JOIN alumnos ON alumnos.usuario_id = seguimientos.alumno_usuario_id
         INNER JOIN usuarios ON usuarios.id = alumnos.usuario_id
         INNER JOIN asignaciones_orientador_grupo AS asignaciones
            ON asignaciones.grupo_id = alumnos.grupo_id
           AND asignaciones.orientador_usuario_id = ?
           AND asignaciones.fecha_fin IS NULL
         INNER JOIN tipos_seguimiento ON tipos_seguimiento.id = seguimientos.tipo_id
         WHERE seguimientos.orientador_usuario_id = ?
         ORDER BY seguimientos.fecha_seguimiento DESC,
                  seguimientos.creado_en DESC,
                  seguimientos.id DESC
         LIMIT ?`,
        [orientadorUsuarioId, orientadorUsuarioId, String(limiteSeguro)]
    );
    return rows;
};

module.exports = {
    crear,
    crearAutorizado,
    listarRecientesPorAlumno,
    listarPaginadoPorAlumno,
    contarFiltradosPorAlumno,
    listarSeguimientosRecientesGlobales,
    contarPorOrientadorEnPeriodo,
    listarRecientesPorOrientador
};
