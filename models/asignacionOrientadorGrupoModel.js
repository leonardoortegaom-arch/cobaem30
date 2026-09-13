const pool = require('../config/database');

class ErrorAsignacionOrientador extends Error {
    constructor(codigo) {
        super(codigo);
        this.codigo = codigo;
    }
}

const fechaLocalActual = (ahora = new Date()) => {
    const anio = ahora.getFullYear();
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    const dia = String(ahora.getDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
};

const crearModelo = (db = pool, obtenerFecha = fechaLocalActual) => {
    const buscarVigentePorGrupo = async (grupoId, conexion = db) => {
        const [rows] = await conexion.execute(
            `SELECT asignaciones.id, asignaciones.grupo_id,
                    asignaciones.orientador_usuario_id, asignaciones.fecha_inicio,
                    asignaciones.creado_en, asignaciones.actualizado_en,
                    CONCAT_WS(' ', orientadores.nombre, orientadores.apellido_paterno,
                        orientadores.apellido_materno) AS orientador_nombre,
                    CONCAT_WS(' ', creadores.nombre, creadores.apellido_paterno,
                        creadores.apellido_materno) AS creado_por_nombre
             FROM asignaciones_orientador_grupo AS asignaciones
             INNER JOIN usuarios AS orientadores
                ON orientadores.id = asignaciones.orientador_usuario_id
             INNER JOIN usuarios AS creadores
                ON creadores.id = asignaciones.creado_por_usuario_id
             WHERE asignaciones.grupo_id = ? AND asignaciones.fecha_fin IS NULL
             LIMIT 1`,
            [grupoId]
        );
        return rows[0] || null;
    };

    const listarHistorialPorGrupo = async (grupoId) => {
        const [rows] = await db.execute(
            `SELECT asignaciones.orientador_usuario_id, asignaciones.fecha_inicio,
                    asignaciones.fecha_fin, asignaciones.creado_en,
                    asignaciones.actualizado_en,
                    CONCAT_WS(' ', orientadores.nombre, orientadores.apellido_paterno,
                        orientadores.apellido_materno) AS orientador_nombre
             FROM asignaciones_orientador_grupo AS asignaciones
             INNER JOIN usuarios AS orientadores
                ON orientadores.id = asignaciones.orientador_usuario_id
             WHERE asignaciones.grupo_id = ?
             ORDER BY asignaciones.fecha_inicio DESC, asignaciones.id DESC`,
            [grupoId]
        );
        return rows;
    };

    const listarOrientadoresActivos = async () => {
        const [rows] = await db.execute(
            `SELECT usuarios.id,
                    CONCAT_WS(' ', usuarios.nombre, usuarios.apellido_paterno,
                        usuarios.apellido_materno) AS nombre_completo
             FROM usuarios
             INNER JOIN roles ON roles.id = usuarios.rol_id
             WHERE usuarios.activo = 1 AND roles.clave = ?
             ORDER BY usuarios.apellido_paterno, usuarios.apellido_materno,
                      usuarios.nombre, usuarios.id`,
            ['ORIENTADOR']
        );
        return rows;
    };

    const listarVigentesPorGrupos = async (grupoIds) => {
        const ids = [...new Set(grupoIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
        if (ids.length === 0) return [];
        const marcadores = ids.map(() => '?').join(', ');
        const [rows] = await db.execute(
            `SELECT asignaciones.grupo_id,
                    CONCAT_WS(' ', orientadores.nombre, orientadores.apellido_paterno,
                        orientadores.apellido_materno) AS orientador_nombre
             FROM asignaciones_orientador_grupo AS asignaciones
             INNER JOIN usuarios AS orientadores
                ON orientadores.id = asignaciones.orientador_usuario_id
             WHERE asignaciones.fecha_fin IS NULL
               AND asignaciones.grupo_id IN (${marcadores})`,
            ids
        );
        return rows;
    };

    const reemplazarAsignacionVigente = async ({ grupoId, orientadorUsuarioId, creadoPorUsuarioId }) => {
        const conexion = await db.getConnection();
        try {
            await conexion.beginTransaction();
            const [grupos] = await conexion.execute(
                'SELECT id FROM grupos WHERE id = ? LIMIT 1 FOR UPDATE', [grupoId]
            );
            if (!grupos[0]) throw new ErrorAsignacionOrientador('GRUPO_NO_ENCONTRADO');

            const [usuarios] = await conexion.execute(
                `SELECT usuarios.id, usuarios.activo, roles.clave AS rol_clave
                 FROM usuarios INNER JOIN roles ON roles.id = usuarios.rol_id
                 WHERE usuarios.id = ? LIMIT 1 FOR UPDATE`,
                [orientadorUsuarioId]
            );
            const usuario = usuarios[0];
            if (!usuario) throw new ErrorAsignacionOrientador('ORIENTADOR_NO_ENCONTRADO');
            if (!usuario.activo) throw new ErrorAsignacionOrientador('ORIENTADOR_INACTIVO');
            if (usuario.rol_clave !== 'ORIENTADOR') {
                throw new ErrorAsignacionOrientador('ROL_ORIENTADOR_REQUERIDO');
            }

            const [vigentes] = await conexion.execute(
                `SELECT id, orientador_usuario_id FROM asignaciones_orientador_grupo
                 WHERE grupo_id = ? AND fecha_fin IS NULL LIMIT 2 FOR UPDATE`,
                [grupoId]
            );
            if (vigentes.length > 1) throw new ErrorAsignacionOrientador('ESTADO_CONCURRENTE');
            if (vigentes[0] && Number(vigentes[0].orientador_usuario_id) === orientadorUsuarioId) {
                await conexion.commit();
                return { resultado: 'SIN_CAMBIOS' };
            }

            const fecha = obtenerFecha();
            if (vigentes[0]) {
                const [cierre] = await conexion.execute(
                    `UPDATE asignaciones_orientador_grupo SET fecha_fin = ?
                     WHERE id = ? AND fecha_fin IS NULL`,
                    [fecha, vigentes[0].id]
                );
                if (cierre.affectedRows !== 1) {
                    throw new ErrorAsignacionOrientador('ESTADO_CONCURRENTE');
                }
            }
            await conexion.execute(
                `INSERT INTO asignaciones_orientador_grupo
                    (grupo_id, orientador_usuario_id, fecha_inicio, fecha_fin, creado_por_usuario_id)
                 VALUES (?, ?, ?, NULL, ?)`,
                [grupoId, orientadorUsuarioId, fecha, creadoPorUsuarioId]
            );
            const [conteo] = await conexion.execute(
                `SELECT COUNT(*) AS total FROM asignaciones_orientador_grupo
                 WHERE grupo_id = ? AND fecha_fin IS NULL`,
                [grupoId]
            );
            if (Number(conteo[0]?.total) !== 1) {
                throw new ErrorAsignacionOrientador('ESTADO_CONCURRENTE');
            }
            await conexion.commit();
            return { resultado: vigentes[0] ? 'ACTUALIZADA' : 'ASIGNADA' };
        } catch (error) {
            await conexion.rollback();
            throw error;
        } finally {
            conexion.release();
        }
    };

    return { buscarVigentePorGrupo, listarHistorialPorGrupo, listarOrientadoresActivos,
        listarVigentesPorGrupos, reemplazarAsignacionVigente };
};

module.exports = { ...crearModelo(), crearModelo, fechaLocalActual, ErrorAsignacionOrientador };
