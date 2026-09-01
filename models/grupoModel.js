const pool = require('../config/database');

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

const construirCondicionesListado = ({ busqueda, semestre, turnoId, cicloEscolar, activo } = {}) => {
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
        activo
    });
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
         ${clausulaWhere}
         ORDER BY grupos.ciclo_escolar DESC, grupos.semestre ASC, grupos.clave ASC
         LIMIT ? OFFSET ?`,
        [...parametros, String(limiteSeguro), String(offsetSeguro)]
    );

    return rows;
};

const contarFiltrados = async ({ busqueda, semestre, turnoId, cicloEscolar, activo } = {}) => {
    const { clausulaWhere, parametros } = construirCondicionesListado({
        busqueda,
        semestre,
        turnoId,
        cicloEscolar,
        activo
    });
    const [rows] = await pool.execute(
        `SELECT COUNT(*) AS total
         FROM grupos
         INNER JOIN turnos ON turnos.id = grupos.turno_id
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
            grupos.activo,
            turnos.clave AS turno_clave,
            turnos.nombre AS turno_nombre
         FROM grupos
         INNER JOIN turnos ON turnos.id = grupos.turno_id
         WHERE grupos.id = ?
         LIMIT 1`,
        [id]
    );

    return rows[0] || null;
};

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
    contarActivos
};
