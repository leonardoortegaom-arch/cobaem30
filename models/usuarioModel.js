const pool = require('../config/database');

const normalizarCorreo = (correo) => correo.trim().toLowerCase();

const buscarPorCorreo = async (correo) => {
    const correoNormalizado = normalizarCorreo(correo);
    const [rows] = await pool.execute(
        `SELECT
            u.id,
            u.rol_id,
            u.nombre,
            u.apellido_paterno,
            u.apellido_materno,
            u.correo,
            u.activo,
            u.ultimo_acceso,
            u.creado_en,
            u.actualizado_en,
            r.clave AS rol_clave,
            r.nombre AS rol_nombre
         FROM usuarios AS u
         INNER JOIN roles AS r ON r.id = u.rol_id
         WHERE u.correo = ?
         LIMIT 1`,
        [correoNormalizado]
    );

    return rows[0] || null;
};

const buscarParaAutenticacionPorCorreo = async (correo) => {
    const correoNormalizado = normalizarCorreo(correo);
    const [rows] = await pool.execute(
        `SELECT
            u.id,
            u.nombre,
            u.apellido_paterno,
            u.apellido_materno,
            u.correo,
            u.password_hash,
            u.version_credenciales AS versionCredenciales,
            u.activo,
            r.clave AS rol_clave,
            r.nombre AS rol_nombre
         FROM usuarios AS u
         INNER JOIN roles AS r ON r.id = u.rol_id
         WHERE u.correo = ?
         LIMIT 1`,
        [correoNormalizado]
    );

    return rows[0] || null;
};

const listarTodosConRol = async () => {
    const [rows] = await pool.execute(
        `SELECT
            u.id,
            u.nombre,
            u.apellido_paterno,
            u.apellido_materno,
            u.correo,
            u.activo,
            u.ultimo_acceso,
            u.creado_en,
            r.clave AS rol_clave,
            r.nombre AS rol_nombre
         FROM usuarios AS u
         INNER JOIN roles AS r ON r.id = u.rol_id
         ORDER BY u.creado_en DESC, u.id DESC`
    );

    return rows;
};

const construirCondicionesListado = ({ busqueda, rolClave, activo } = {}) => {
    const condiciones = [];
    const parametros = [];

    if (busqueda) {
        const patron = `%${busqueda}%`;
        condiciones.push(`(
            u.nombre LIKE ?
            OR u.apellido_paterno LIKE ?
            OR u.apellido_materno LIKE ?
            OR u.correo LIKE ?
        )`);
        parametros.push(patron, patron, patron, patron);
    }

    if (rolClave) {
        condiciones.push('r.clave = ?');
        parametros.push(rolClave);
    }

    if (typeof activo === 'boolean') {
        condiciones.push('u.activo = ?');
        parametros.push(activo ? 1 : 0);
    }

    return {
        clausulaWhere: condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '',
        parametros
    };
};

const listarPaginado = async ({ busqueda, rolClave, activo, limite, offset } = {}) => {
    const limiteSeguro = Number.isInteger(limite) && limite > 0 ? limite : 10;
    const offsetSeguro = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    const { clausulaWhere, parametros } = construirCondicionesListado({
        busqueda,
        rolClave,
        activo
    });
    const [rows] = await pool.execute(
        `SELECT
            u.id,
            u.nombre,
            u.apellido_paterno,
            u.apellido_materno,
            u.correo,
            u.activo,
            u.ultimo_acceso,
            u.creado_en,
            r.clave AS rol_clave,
            r.nombre AS rol_nombre
         FROM usuarios AS u
         INNER JOIN roles AS r ON r.id = u.rol_id
         ${clausulaWhere}
         ORDER BY u.creado_en DESC, u.id DESC
         LIMIT ? OFFSET ?`,
        [...parametros, String(limiteSeguro), String(offsetSeguro)]
    );

    return rows;
};

const contarFiltrados = async ({ busqueda, rolClave, activo } = {}) => {
    const { clausulaWhere, parametros } = construirCondicionesListado({
        busqueda,
        rolClave,
        activo
    });
    const [rows] = await pool.execute(
        `SELECT COUNT(*) AS total
         FROM usuarios AS u
         INNER JOIN roles AS r ON r.id = u.rol_id
         ${clausulaWhere}`,
        parametros
    );

    return Number(rows[0].total);
};

const buscarEstadoAutorizacionPorId = async (id) => {
    const [rows] = await pool.execute(
        `SELECT
            u.id,
            u.nombre,
            u.correo,
            u.activo,
            u.version_credenciales AS versionCredenciales,
            r.clave AS rol
         FROM usuarios AS u
         INNER JOIN roles AS r ON r.id = u.rol_id
         WHERE u.id = ?
         LIMIT 1`,
        [id]
    );

    return rows[0] || null;
};

const buscarPorIdConRol = async (id) => {
    const [rows] = await pool.execute(
        `SELECT
            u.id,
            u.rol_id,
            u.nombre,
            u.apellido_paterno,
            u.apellido_materno,
            u.correo,
            u.activo,
            r.clave AS rol_clave,
            r.nombre AS rol_nombre
         FROM usuarios AS u
         INNER JOIN roles AS r ON r.id = u.rol_id
         WHERE u.id = ?
         LIMIT 1`,
        [id]
    );

    return rows[0] || null;
};

const listarActivosPorRol = async (rolClave) => {
    const [rows] = await pool.execute(
        `SELECT
            usuarios.id,
            usuarios.nombre,
            usuarios.apellido_paterno,
            usuarios.apellido_materno,
            usuarios.correo,
            roles.clave AS rol_clave,
            roles.nombre AS rol_nombre
         FROM usuarios
         INNER JOIN roles ON roles.id = usuarios.rol_id
         WHERE usuarios.activo = 1 AND roles.clave = ?
         ORDER BY usuarios.apellido_paterno ASC, usuarios.apellido_materno ASC, usuarios.nombre ASC, usuarios.id ASC`,
        [rolClave]
    );

    return rows;
};

const buscarCredencialesPorId = async (id) => {
    const [rows] = await pool.execute(
        `SELECT
            id,
            password_hash,
            activo,
            version_credenciales AS versionCredenciales
         FROM usuarios
         WHERE id = ?
         LIMIT 1`,
        [id]
    );

    return rows[0] || null;
};

const actualizarDatosYRol = async (id, usuario) => {
    const correoNormalizado = normalizarCorreo(usuario.correo);
    const [result] = await pool.execute(
        `UPDATE usuarios
         SET rol_id = ?,
             nombre = ?,
             apellido_paterno = ?,
             apellido_materno = ?,
             correo = ?
         WHERE id = ?`,
        [
            usuario.rol_id,
            usuario.nombre,
            usuario.apellido_paterno,
            usuario.apellido_materno || null,
            correoNormalizado,
            id
        ]
    );

    return result;
};

const actualizarEstado = async (id, activo) => {
    const estado = activo ? 1 : 0;
    const [result] = await pool.execute(
        'UPDATE usuarios SET activo = ? WHERE id = ?',
        [estado, id]
    );

    return result;
};

const actualizarPasswordEInvalidarSesiones = async (id, passwordHash) => {
    const [result] = await pool.execute(
        `UPDATE usuarios
         SET password_hash = ?,
             version_credenciales = version_credenciales + 1
         WHERE id = ?`,
        [passwordHash, id]
    );

    return result;
};

const crear = async (usuario, executor = pool) => {
    const correoNormalizado = normalizarCorreo(usuario.correo);
    const [result] = await executor.execute(
        `INSERT INTO usuarios (
            rol_id,
            nombre,
            apellido_paterno,
            apellido_materno,
            correo,
            password_hash,
            activo
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            usuario.rol_id,
            usuario.nombre,
            usuario.apellido_paterno,
            usuario.apellido_materno || null,
            correoNormalizado,
            usuario.password_hash,
            usuario.activo
        ]
    );

    return result.insertId;
};

const actualizarUltimoAcceso = async (id) => {
    await pool.execute(
        'UPDATE usuarios SET ultimo_acceso = CURRENT_TIMESTAMP WHERE id = ?',
        [id]
    );
};

const obtenerResumenActivos = async () => {
    const [rows] = await pool.execute(
        `SELECT
            COUNT(*) AS totalUsuarios,
            COALESCE(SUM(roles.clave = 'DOCENTE'), 0) AS totalDocentes,
            COALESCE(SUM(roles.clave = 'ALUMNO'), 0) AS totalAlumnos
         FROM usuarios
         INNER JOIN roles ON roles.id = usuarios.rol_id
         WHERE usuarios.activo = 1`
    );

    const resumen = rows[0] || {};
    const convertirConteoSeguro = (valor) => {
        const numero = Number(valor);
        return Number.isSafeInteger(numero) && numero >= 0 ? numero : 0;
    };

    return {
        totalUsuarios: convertirConteoSeguro(resumen.totalUsuarios),
        totalDocentes: convertirConteoSeguro(resumen.totalDocentes),
        totalAlumnos: convertirConteoSeguro(resumen.totalAlumnos)
    };
};

module.exports = {
    buscarPorCorreo,
    buscarParaAutenticacionPorCorreo,
    listarTodosConRol,
    listarPaginado,
    contarFiltrados,
    buscarEstadoAutorizacionPorId,
    buscarPorIdConRol,
    listarActivosPorRol,
    buscarCredencialesPorId,
    actualizarDatosYRol,
    actualizarEstado,
    actualizarPasswordEInvalidarSesiones,
    crear,
    actualizarUltimoAcceso,
    obtenerResumenActivos
};
