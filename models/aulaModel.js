const pool = require('../config/database');

const escaparLike = (valor) => valor.replace(/[\\%_]/g, '\\$&');

const construirCondicionesListado = ({ busqueda, activo } = {}) => {
    const condiciones = [];
    const parametros = [];
    if (busqueda) {
        const patron = `%${escaparLike(busqueda)}%`;
        condiciones.push("(clave LIKE ? ESCAPE '\\\\' OR nombre LIKE ? ESCAPE '\\\\')");
        parametros.push(patron, patron);
    }
    if (typeof activo === 'boolean') {
        condiciones.push('activo = ?');
        parametros.push(activo ? 1 : 0);
    }
    return { clausulaWhere: condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '', parametros };
};

const contarFiltradas = async (filtros = {}) => {
    const { clausulaWhere, parametros } = construirCondicionesListado(filtros);
    const [rows] = await pool.execute(`SELECT COUNT(*) AS total FROM aulas ${clausulaWhere}`, parametros);
    const total = Number(rows[0]?.total);
    return Number.isSafeInteger(total) && total >= 0 ? total : 0;
};

const listarPaginado = async (filtros = {}, limite = 15, offset = 0) => {
    const limiteSeguro = Number.isInteger(limite) && limite > 0 && limite <= 50 ? limite : 15;
    const offsetSeguro = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    const { clausulaWhere, parametros } = construirCondicionesListado(filtros);
    const [rows] = await pool.execute(
        `SELECT id, clave, nombre, descripcion, activo, creado_en
         FROM aulas ${clausulaWhere}
         ORDER BY activo DESC, nombre ASC, id ASC
         LIMIT ? OFFSET ?`,
        [...parametros, String(limiteSeguro), String(offsetSeguro)]
    );
    return rows;
};

const listarActivas = async () => {
    const [rows] = await pool.execute('SELECT id, clave, nombre FROM aulas WHERE activo = 1 ORDER BY nombre ASC, id ASC');
    return rows;
};

const buscarPorId = async (id) => {
    const [rows] = await pool.execute('SELECT id, clave, nombre, descripcion, activo, creado_en FROM aulas WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
};

const buscarDuplicadoClave = async (clave, excluirId = null) => {
    const parametros = [clave];
    const exclusion = Number.isSafeInteger(excluirId) && excluirId > 0 ? ' AND id <> ?' : '';
    if (exclusion) parametros.push(excluirId);
    const [rows] = await pool.execute(`SELECT id FROM aulas WHERE clave = ?${exclusion} LIMIT 1`, parametros);
    return rows[0] || null;
};

const crear = async ({ clave, nombre, descripcion }) => {
    const [resultado] = await pool.execute('INSERT INTO aulas (clave, nombre, descripcion, activo) VALUES (?, ?, ?, 1)', [clave, nombre, descripcion]);
    return resultado.insertId;
};

const actualizar = async (id, { clave, nombre, descripcion }) => {
    const [resultado] = await pool.execute('UPDATE aulas SET clave = ?, nombre = ?, descripcion = ? WHERE id = ?', [clave, nombre, descripcion, id]);
    return resultado;
};

const actualizarEstado = async (id, activo) => {
    const [resultado] = await pool.execute('UPDATE aulas SET activo = ? WHERE id = ?', [activo ? 1 : 0, id]);
    return resultado;
};

module.exports = { construirCondicionesListado, contarFiltradas, listarPaginado, listarActivas, buscarPorId, buscarDuplicadoClave, crear, actualizar, actualizarEstado };
