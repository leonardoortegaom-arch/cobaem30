const pool = require('../config/database');

const buscarPorMatricula = async (matricula) => {
    const [rows] = await pool.execute(
        `SELECT usuario_id, grupo_id, matricula
         FROM alumnos
         WHERE matricula = ?
         LIMIT 1`,
        [matricula]
    );

    return rows[0] || null;
};

const buscarPorUsuarioIdConGrupo = async (usuarioId) => {
    const [rows] = await pool.execute(
        `SELECT
            alumnos.usuario_id,
            alumnos.grupo_id,
            alumnos.matricula,
            alumnos.creado_en,
            alumnos.actualizado_en,
            grupos.clave AS grupo_clave,
            grupos.semestre,
            grupos.ciclo_escolar,
            grupos.activo AS grupo_activo,
            turnos.clave AS turno_clave,
            turnos.nombre AS turno_nombre
         FROM alumnos
         INNER JOIN grupos ON grupos.id = alumnos.grupo_id
         INNER JOIN turnos ON turnos.id = grupos.turno_id
         WHERE alumnos.usuario_id = ?
         LIMIT 1`,
        [usuarioId]
    );

    return rows[0] || null;
};

const construirCondicionesOrientador = ({ orientadorUsuarioId, busqueda, grupoId, activo } = {}) => {
    const condiciones = ["roles.clave = 'ALUMNO'", 'asignaciones.orientador_usuario_id = ?',
        'asignaciones.fecha_fin IS NULL'];
    const parametros = [orientadorUsuarioId];

    if (busqueda) {
        const patron = `%${busqueda}%`;
        condiciones.push(`(
            alumnos.matricula LIKE ?
            OR usuarios.nombre LIKE ?
            OR usuarios.apellido_paterno LIKE ?
            OR usuarios.apellido_materno LIKE ?
            OR usuarios.correo LIKE ?
        )`);
        parametros.push(patron, patron, patron, patron, patron);
    }

    if (Number.isInteger(grupoId)) {
        condiciones.push('alumnos.grupo_id = ?');
        parametros.push(grupoId);
    }

    if (typeof activo === 'boolean') {
        condiciones.push('usuarios.activo = ?');
        parametros.push(activo ? 1 : 0);
    }

    return {
        clausulaWhere: `WHERE ${condiciones.join(' AND ')}`,
        parametros
    };
};

const listarPaginadoParaOrientador = async ({
    orientadorUsuarioId,
    busqueda,
    grupoId,
    activo,
    limite,
    offset
} = {}) => {
    const limiteSeguro = Number.isInteger(limite) && limite > 0 ? limite : 10;
    const offsetSeguro = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    const { clausulaWhere, parametros } = construirCondicionesOrientador({
        orientadorUsuarioId,
        busqueda,
        grupoId,
        activo
    });
    const [rows] = await pool.execute(
        `SELECT
            usuarios.id AS usuarioId,
            alumnos.matricula,
            CONCAT_WS(' ', usuarios.nombre, usuarios.apellido_paterno, usuarios.apellido_materno) AS nombre_completo,
            usuarios.correo,
            usuarios.activo AS usuario_activo,
            grupos.clave AS grupo_clave,
            grupos.semestre,
            turnos.nombre AS turno_nombre,
            grupos.ciclo_escolar,
            grupos.activo AS grupo_activo
         FROM alumnos
         INNER JOIN usuarios ON usuarios.id = alumnos.usuario_id
         INNER JOIN roles ON roles.id = usuarios.rol_id
         INNER JOIN grupos ON grupos.id = alumnos.grupo_id
         INNER JOIN asignaciones_orientador_grupo AS asignaciones
            ON asignaciones.grupo_id = alumnos.grupo_id
         INNER JOIN turnos ON turnos.id = grupos.turno_id
         ${clausulaWhere}
         ORDER BY grupos.ciclo_escolar DESC, grupos.semestre ASC, grupos.clave ASC, alumnos.matricula ASC
         LIMIT ? OFFSET ?`,
        [...parametros, String(limiteSeguro), String(offsetSeguro)]
    );

    return rows;
};

const buscarDetalleParaOrientadorPorUsuarioId = async (usuarioId, orientadorUsuarioId) => {
    const [rows] = await pool.execute(
        `SELECT
            usuarios.id AS usuarioId,
            CONCAT_WS(' ', usuarios.nombre, usuarios.apellido_paterno, usuarios.apellido_materno) AS nombre_completo,
            usuarios.correo,
            usuarios.activo AS usuario_activo,
            alumnos.matricula,
            grupos.clave AS grupo_clave,
            grupos.semestre,
            turnos.nombre AS turno_nombre,
            grupos.ciclo_escolar,
            grupos.activo AS grupo_activo
         FROM alumnos
         INNER JOIN usuarios ON usuarios.id = alumnos.usuario_id
         INNER JOIN roles ON roles.id = usuarios.rol_id
         INNER JOIN grupos ON grupos.id = alumnos.grupo_id
         INNER JOIN asignaciones_orientador_grupo AS asignaciones
            ON asignaciones.grupo_id = alumnos.grupo_id
         INNER JOIN turnos ON turnos.id = grupos.turno_id
         WHERE usuarios.id = ? AND roles.clave = ?
           AND asignaciones.orientador_usuario_id = ?
           AND asignaciones.fecha_fin IS NULL
         LIMIT 1`,
        [usuarioId, 'ALUMNO', orientadorUsuarioId]
    );

    return rows[0] || null;
};

const contarFiltradosParaOrientador = async ({ orientadorUsuarioId, busqueda, grupoId, activo } = {}) => {
    const { clausulaWhere, parametros } = construirCondicionesOrientador({
        orientadorUsuarioId, busqueda,
        grupoId,
        activo
    });
    const [rows] = await pool.execute(
        `SELECT COUNT(*) AS total
         FROM alumnos
         INNER JOIN usuarios ON usuarios.id = alumnos.usuario_id
         INNER JOIN roles ON roles.id = usuarios.rol_id
         INNER JOIN grupos ON grupos.id = alumnos.grupo_id
         INNER JOIN asignaciones_orientador_grupo AS asignaciones
            ON asignaciones.grupo_id = alumnos.grupo_id
         INNER JOIN turnos ON turnos.id = grupos.turno_id
         ${clausulaWhere}`,
        parametros
    );
    const total = Number(rows[0]?.total);

    return Number.isSafeInteger(total) && total >= 0 ? total : 0;
};

const crear = async (alumno, executor) => {
    const [result] = await executor.execute(
        `INSERT INTO alumnos (usuario_id, grupo_id, matricula)
         VALUES (?, ?, ?)`,
        [alumno.usuario_id, alumno.grupo_id, alumno.matricula]
    );

    return result;
};

const actualizarPerfil = async (usuarioId, matricula, grupoId) => {
    const [result] = await pool.execute(
        `UPDATE alumnos
         SET matricula = ?, grupo_id = ?
         WHERE usuario_id = ?`,
        [matricula, grupoId, usuarioId]
    );

    return result;
};

module.exports = {
    buscarPorMatricula,
    buscarPorUsuarioIdConGrupo,
    listarPaginadoParaOrientador,
    contarFiltradosParaOrientador,
    buscarDetalleParaOrientadorPorUsuarioId,
    crear,
    actualizarPerfil
};
