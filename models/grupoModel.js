const pool = require('../config/database');

class ErrorCalendarioGrupo extends Error {
    constructor(codigo) {
        super(codigo);
        this.codigo = codigo;
    }
}

const columnasCalendario = `
    generaciones.anio_inicio AS generacion_anio_inicio,
    generaciones.anio_fin AS generacion_anio_fin,
    generaciones.activo AS generacion_activa,
    periodos_academicos.clave AS periodo_clave,
    periodos_academicos.nombre AS periodo_nombre,
    periodos_academicos.activo AS periodo_activo,
    ciclos_escolares.clave AS ciclo_normalizado_clave,
    ciclos_escolares.nombre AS ciclo_normalizado_nombre,
    ciclos_escolares.activo AS ciclo_normalizado_activo`;

const joinsCalendario = `
    LEFT JOIN generaciones ON generaciones.id = grupos.generacion_id
    LEFT JOIN periodos_academicos ON periodos_academicos.id = grupos.periodo_academico_id
    LEFT JOIN ciclos_escolares ON ciclos_escolares.id = periodos_academicos.ciclo_escolar_id`;

const expresionEstadoCalendario = `CASE
    WHEN grupos.generacion_id IS NULL OR grupos.periodo_academico_id IS NULL THEN 'PENDIENTE'
    WHEN generaciones.id IS NULL OR periodos_academicos.id IS NULL OR ciclos_escolares.id IS NULL
      OR generaciones.activo <> 1 OR periodos_academicos.activo <> 1 OR ciclos_escolares.activo <> 1
      THEN 'CONFIGURACION_INACTIVA'
    ELSE 'CONFIGURADO' END`;

const listarTodosConTurno = async () => {
    const [rows] = await pool.execute(
        `SELECT
            grupos.id,
            grupos.clave,
            grupos.semestre,
            grupos.ciclo_escolar,
            grupos.activo,
            grupos.creado_en,
            turnos.id AS turno_id,
            turnos.clave AS turno_clave,
            turnos.nombre AS turno_nombre
         FROM grupos
         INNER JOIN turnos ON turnos.id = grupos.turno_id
         ORDER BY grupos.ciclo_escolar DESC, grupos.semestre ASC, grupos.clave ASC`
    );

    return rows;
};

const construirCondicionesListado = ({ busqueda, semestre, turnoId, cicloEscolar, activo, estadoCalendario } = {}) => {
    const condiciones = [];
    const parametros = [];

    if (busqueda) {
        condiciones.push('grupos.clave LIKE ?');
        parametros.push(`%${busqueda}%`);
    }

    if (Number.isInteger(semestre)) {
        condiciones.push('grupos.semestre = ?');
        parametros.push(semestre);
    }

    if (Number.isInteger(turnoId)) {
        condiciones.push('grupos.turno_id = ?');
        parametros.push(turnoId);
    }

    if (cicloEscolar) {
        condiciones.push('grupos.ciclo_escolar = ?');
        parametros.push(cicloEscolar);
    }

    if (typeof activo === 'boolean') {
        condiciones.push('grupos.activo = ?');
        parametros.push(activo ? 1 : 0);
    }

    if (['PENDIENTE', 'CONFIGURADO', 'CONFIGURACION_INACTIVA'].includes(estadoCalendario)) {
        condiciones.push(`${expresionEstadoCalendario} = ?`);
        parametros.push(estadoCalendario);
    }

    return {
        clausulaWhere: condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '',
        parametros
    };
};

const listarPaginado = async ({
    busqueda,
    semestre,
    turnoId,
    cicloEscolar,
    activo,
    estadoCalendario,
    limite,
    offset
} = {}) => {
    const limiteSeguro = Number.isInteger(limite) && limite > 0 ? limite : 10;
    const offsetSeguro = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    const { clausulaWhere, parametros } = construirCondicionesListado({
        busqueda,
        semestre,
        turnoId,
        cicloEscolar,
        activo,
        estadoCalendario
    });
    const [rows] = await pool.execute(
        `SELECT
            grupos.id,
            grupos.clave,
            grupos.semestre,
            grupos.ciclo_escolar,
            grupos.generacion_id,
            grupos.periodo_academico_id,
            grupos.activo,
            grupos.creado_en,
            turnos.id AS turno_id,
            turnos.clave AS turno_clave,
            turnos.nombre AS turno_nombre,
            ${columnasCalendario},
            ${expresionEstadoCalendario} AS estado_calendario
         FROM grupos
         INNER JOIN turnos ON turnos.id = grupos.turno_id
         ${joinsCalendario}
         ${clausulaWhere}
         ORDER BY grupos.ciclo_escolar DESC, grupos.semestre ASC, grupos.clave ASC
         LIMIT ? OFFSET ?`,
        [...parametros, String(limiteSeguro), String(offsetSeguro)]
    );

    return rows;
};

const contarFiltrados = async ({ busqueda, semestre, turnoId, cicloEscolar, activo, estadoCalendario } = {}) => {
    const { clausulaWhere, parametros } = construirCondicionesListado({
        busqueda,
        semestre,
        turnoId,
        cicloEscolar,
        activo,
        estadoCalendario
    });
    const [rows] = await pool.execute(
        `SELECT COUNT(*) AS total
         FROM grupos
         INNER JOIN turnos ON turnos.id = grupos.turno_id
         ${joinsCalendario}
         ${clausulaWhere}`,
        parametros
    );
    const total = Number(rows[0]?.total);

    return Number.isSafeInteger(total) && total >= 0 ? total : 0;
};

const listarCiclosDisponibles = async () => {
    const [rows] = await pool.execute(
        `SELECT DISTINCT ciclo_escolar
         FROM grupos
         ORDER BY ciclo_escolar DESC`
    );

    return rows.map((row) => row.ciclo_escolar);
};

const listarActivosParaSeleccion = async () => {
    const [rows] = await pool.execute(
        `SELECT
            grupos.id,
            grupos.clave,
            grupos.semestre,
            grupos.ciclo_escolar,
            turnos.id AS turno_id,
            turnos.clave AS turno_clave,
            turnos.nombre AS turno_nombre
         FROM grupos
         INNER JOIN turnos ON turnos.id = grupos.turno_id
         WHERE grupos.activo = 1
         ORDER BY grupos.ciclo_escolar DESC, grupos.semestre ASC, grupos.clave ASC`
    );

    return rows;
};

const buscarActivoPorId = async (id) => {
    const [rows] = await pool.execute(
        `SELECT
            grupos.id,
            grupos.clave,
            grupos.semestre,
            grupos.ciclo_escolar,
            turnos.id AS turno_id,
            turnos.clave AS turno_clave,
            turnos.nombre AS turno_nombre
         FROM grupos
         INNER JOIN turnos ON turnos.id = grupos.turno_id
         WHERE grupos.id = ? AND grupos.activo = 1
         LIMIT 1`,
        [id]
    );

    return rows[0] || null;
};

const buscarDuplicado = async (clave, cicloEscolar, turnoId) => {
    const [rows] = await pool.execute(
        `SELECT id, clave, ciclo_escolar, turno_id
         FROM grupos
         WHERE clave = ? AND ciclo_escolar = ? AND turno_id = ?
         LIMIT 1`,
        [clave, cicloEscolar, turnoId]
    );

    return rows[0] || null;
};

const buscarPorIdConTurno = async (id) => {
    const [rows] = await pool.execute(
        `SELECT
            grupos.id,
            grupos.turno_id,
            grupos.clave,
            grupos.semestre,
            grupos.ciclo_escolar,
            grupos.generacion_id,
            grupos.periodo_academico_id,
            grupos.activo,
            turnos.clave AS turno_clave,
            turnos.nombre AS turno_nombre,
            ${columnasCalendario},
            ${expresionEstadoCalendario} AS estado_calendario
         FROM grupos
         INNER JOIN turnos ON turnos.id = grupos.turno_id
         ${joinsCalendario}
         WHERE grupos.id = ?
         LIMIT 1`,
        [id]
    );

    return rows[0] || null;
};

const buscarPorIdConCalendario = buscarPorIdConTurno;

const listarGeneracionesActivas = async (conexion = pool) => {
    const [rows] = await conexion.execute(
        'SELECT id, anio_inicio, anio_fin FROM generaciones WHERE activo = 1 ORDER BY anio_inicio DESC, id ASC'
    );
    return rows;
};

const listarPeriodosActivosConCicloActivo = async (conexion = pool) => {
    const [rows] = await conexion.execute(
        `SELECT p.id, p.clave, p.nombre, p.ciclo_escolar_id,
                c.clave AS ciclo_clave, c.nombre AS ciclo_nombre
         FROM periodos_academicos p
         INNER JOIN ciclos_escolares c ON c.id = p.ciclo_escolar_id
         WHERE p.activo = 1 AND c.activo = 1
         ORDER BY p.fecha_inicio DESC, p.id ASC`
    );
    return rows;
};

const crearModeloCalendario = (db = pool) => {
    const tieneHistorialHorarios = async (grupoId, conexion = db) => {
        const [rows] = await conexion.execute(
            `SELECT
                EXISTS(SELECT 1 FROM importaciones_horario WHERE grupo_id = ? LIMIT 1)
                OR EXISTS(SELECT 1 FROM versiones_horario WHERE grupo_id = ? LIMIT 1) AS tiene_historial`,
            [grupoId, grupoId]
        );
        return Boolean(rows[0]?.tiene_historial);
    };

    const validarCatalogosBloqueados = async (conexion, generacionId, periodoId) => {
        const [generaciones] = await conexion.execute(
            'SELECT id, anio_inicio, anio_fin, activo FROM generaciones WHERE id = ? LIMIT 1 FOR UPDATE',
            [generacionId]
        );
        if (!generaciones[0] || !generaciones[0].activo) throw new ErrorCalendarioGrupo('GENERACION_NO_DISPONIBLE');
        const [periodos] = await conexion.execute(
            `SELECT p.id, p.activo, c.id AS ciclo_id, c.activo AS ciclo_activo
             FROM periodos_academicos p INNER JOIN ciclos_escolares c ON c.id = p.ciclo_escolar_id
             WHERE p.id = ? LIMIT 1 FOR UPDATE`,
            [periodoId]
        );
        if (!periodos[0] || !periodos[0].activo || !periodos[0].ciclo_activo) {
            throw new ErrorCalendarioGrupo('PERIODO_NO_DISPONIBLE');
        }
        return { generacion: generaciones[0], periodo: periodos[0] };
    };

    const actualizarCalendario = async (grupoId, generacionId, periodoId) => {
        const conexion = await db.getConnection();
        try {
            await conexion.beginTransaction();
            const [grupos] = await conexion.execute(
                'SELECT id, generacion_id, periodo_academico_id, ciclo_escolar FROM grupos WHERE id = ? LIMIT 1 FOR UPDATE',
                [grupoId]
            );
            const grupo = grupos[0];
            if (!grupo) throw new ErrorCalendarioGrupo('GRUPO_NO_ENCONTRADO');
            await validarCatalogosBloqueados(conexion, generacionId, periodoId);
            if (Number(grupo.generacion_id) === generacionId && Number(grupo.periodo_academico_id) === periodoId) {
                await conexion.commit();
                return { resultado: 'SIN_CAMBIOS' };
            }
            if (grupo.generacion_id !== null && Number(grupo.generacion_id) !== generacionId
                && await tieneHistorialHorarios(grupoId, conexion)) {
                throw new ErrorCalendarioGrupo('GENERACION_CON_HISTORIAL');
            }
            const [resultado] = await conexion.execute(
                'UPDATE grupos SET generacion_id = ?, periodo_academico_id = ? WHERE id = ?',
                [generacionId, periodoId, grupoId]
            );
            if (resultado.affectedRows !== 1) throw new ErrorCalendarioGrupo('CONFLICTO_TRANSACCIONAL');
            const [verificacion] = await conexion.execute(
                'SELECT generacion_id, periodo_academico_id, ciclo_escolar FROM grupos WHERE id = ? LIMIT 1', [grupoId]
            );
            if (Number(verificacion[0]?.generacion_id) !== generacionId
                || Number(verificacion[0]?.periodo_academico_id) !== periodoId
                || verificacion[0]?.ciclo_escolar !== grupo.ciclo_escolar) {
                throw new ErrorCalendarioGrupo('CONFLICTO_TRANSACCIONAL');
            }
            await conexion.commit();
            return { resultado: 'ACTUALIZADO' };
        } catch (error) {
            await conexion.rollback();
            throw error;
        } finally {
            conexion.release();
        }
    };

    const crearNormalizado = async ({ turnoId, clave, semestre, generacionId, periodoId }) => {
        const conexion = await db.getConnection();
        try {
            await conexion.beginTransaction();
            const { generacion } = await validarCatalogosBloqueados(conexion, generacionId, periodoId);
            const cicloEscolar = `${generacion.anio_inicio}-${generacion.anio_fin}`;
            const [resultado] = await conexion.execute(
                `INSERT INTO grupos
                    (turno_id, clave, semestre, ciclo_escolar, generacion_id, periodo_academico_id, activo)
                 VALUES (?, ?, ?, ?, ?, ?, 1)`,
                [turnoId, clave, semestre, cicloEscolar, generacionId, periodoId]
            );
            await conexion.commit();
            return { id: resultado.insertId, cicloEscolar };
        } catch (error) {
            await conexion.rollback();
            throw error;
        } finally {
            conexion.release();
        }
    };

    const listarActivosNormalizadosParaSeleccion = async () => {
        const [rows] = await db.execute(
            `SELECT grupos.id, grupos.clave, grupos.semestre, grupos.ciclo_escolar,
                    grupos.generacion_id, grupos.periodo_academico_id,
                    turnos.nombre AS turno_nombre, periodos_academicos.nombre AS periodo_nombre
             FROM grupos INNER JOIN turnos ON turnos.id = grupos.turno_id
             INNER JOIN generaciones ON generaciones.id = grupos.generacion_id AND generaciones.activo = 1
             INNER JOIN periodos_academicos ON periodos_academicos.id = grupos.periodo_academico_id AND periodos_academicos.activo = 1
             INNER JOIN ciclos_escolares ON ciclos_escolares.id = periodos_academicos.ciclo_escolar_id AND ciclos_escolares.activo = 1
             WHERE grupos.activo = 1 ORDER BY grupos.clave, grupos.id`
        );
        return rows;
    };
    return { actualizarCalendario, crearNormalizado, tieneHistorialHorarios,
        listarActivosNormalizadosParaSeleccion, validarCatalogosBloqueados };
};

const calendario = crearModeloCalendario();

const crear = async (grupo) => {
    const [result] = await pool.execute(
        `INSERT INTO grupos (turno_id, clave, semestre, ciclo_escolar, activo)
         VALUES (?, ?, ?, ?, ?)`,
        [
            grupo.turno_id,
            grupo.clave,
            grupo.semestre,
            grupo.ciclo_escolar,
            grupo.activo ? 1 : 0
        ]
    );

    return result.insertId;
};

const actualizar = async (id, grupo) => {
    const [result] = await pool.execute(
        `UPDATE grupos
         SET turno_id = ?,
             clave = ?,
             semestre = ?,
             ciclo_escolar = ?
         WHERE id = ?`,
        [grupo.turno_id, grupo.clave, grupo.semestre, grupo.ciclo_escolar, id]
    );

    return result;
};

const actualizarEstado = async (id, activo) => {
    const [result] = await pool.execute(
        'UPDATE grupos SET activo = ? WHERE id = ?',
        [activo ? 1 : 0, id]
    );

    return result;
};

const contarAlumnosPorGrupo = async (id) => {
    const [rows] = await pool.execute(
        'SELECT COUNT(*) AS total FROM alumnos WHERE grupo_id = ?',
        [id]
    );
    return Number(rows[0]?.total) || 0;
};

const eliminar = async (id) => {
    const [result] = await pool.execute(
        'DELETE FROM grupos WHERE id = ?',
        [id]
    );
    return result;
};

const contarActivos = async () => {
    const [rows] = await pool.execute(
        'SELECT COUNT(*) AS total FROM grupos WHERE activo = 1'
    );
    const total = Number(rows[0]?.total);

    return Number.isSafeInteger(total) && total >= 0 ? total : 0;
};

module.exports = {
    construirCondicionesListado,
    listarTodosConTurno,
    listarPaginado,
    contarFiltrados,
    listarCiclosDisponibles,
    listarActivosParaSeleccion,
    buscarActivoPorId,
    buscarDuplicado,
    buscarPorIdConTurno,
    crear,
    actualizar,
    actualizarEstado,
    contarAlumnosPorGrupo,
    eliminar,
    contarActivos,
    buscarPorIdConCalendario,
    listarGeneracionesActivas,
    listarPeriodosActivosConCicloActivo,
    ...calendario,
    crearModeloCalendario,
    ErrorCalendarioGrupo
};
