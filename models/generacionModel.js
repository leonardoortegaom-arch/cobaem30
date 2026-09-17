const pool = require('../config/database');

const escaparLike = (valor) => valor.replace(/[\\%_]/g, '\\$&');

const construirCondicionesListado = ({ busqueda, activo } = {}) => {
    const condiciones = [];
    const parametros = [];
    if (busqueda) {
        condiciones.push("CONCAT(anio_inicio, '-', anio_fin) LIKE ? ESCAPE '\\\\'");
        parametros.push(`%${escaparLike(busqueda)}%`);
    }
    if (typeof activo === 'boolean') {
        condiciones.push('activo = ?');
        parametros.push(activo ? 1 : 0);
    }
    return { clausulaWhere: condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '', parametros };
};

const contarFiltradas = async (filtros = {}) => {
    const { clausulaWhere, parametros } = construirCondicionesListado(filtros);
    const [rows] = await pool.execute(`SELECT COUNT(*) AS total FROM generaciones ${clausulaWhere}`, parametros);
    return Number(rows[0]?.total) || 0;
};

const listarPaginado = async (filtros = {}, limite = 15, offset = 0) => {
    const limiteSeguro = Number.isInteger(limite) && limite > 0 && limite <= 50 ? limite : 15;
    const offsetSeguro = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    const { clausulaWhere, parametros } = construirCondicionesListado(filtros);
    const [rows] = await pool.execute(
        `SELECT id, anio_inicio, anio_fin, activo, creado_en
         FROM generaciones ${clausulaWhere}
         ORDER BY activo DESC, anio_inicio DESC, anio_fin DESC, id ASC
         LIMIT ? OFFSET ?`,
        [...parametros, String(limiteSeguro), String(offsetSeguro)]
    );
    return rows;
};

const listarActivas = async () => {
    const [rows] = await pool.execute('SELECT id, anio_inicio, anio_fin FROM generaciones WHERE activo = 1 ORDER BY anio_inicio DESC, id ASC');
    return rows;
};

const buscarPorId = async (id) => {
    const [rows] = await pool.execute('SELECT id, anio_inicio, anio_fin, activo, creado_en FROM generaciones WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
};

const buscarDuplicado = async (anioInicio, anioFin, excluirId = null) => {
    const parametros = [anioInicio, anioFin];
    const exclusion = Number.isSafeInteger(excluirId) && excluirId > 0 ? ' AND id <> ?' : '';
    if (exclusion) parametros.push(excluirId);
    const [rows] = await pool.execute(`SELECT id FROM generaciones WHERE anio_inicio = ? AND anio_fin = ?${exclusion} LIMIT 1`, parametros);
    return rows[0] || null;
};

const crear = async ({ anioInicio, anioFin }) => {
    const [resultado] = await pool.execute('INSERT INTO generaciones (anio_inicio, anio_fin, activo) VALUES (?, ?, 1)', [anioInicio, anioFin]);
    return resultado.insertId;
};

const actualizar = async (id, { anioInicio, anioFin }) => {
    const [resultado] = await pool.execute('UPDATE generaciones SET anio_inicio = ?, anio_fin = ? WHERE id = ?', [anioInicio, anioFin, id]);
    return resultado;
};

const actualizarEstado = async (id, activo) => {
    const [resultado] = await pool.execute('UPDATE generaciones SET activo = ? WHERE id = ?', [activo ? 1 : 0, id]);
    return resultado;
};

const contarGruposActivosReferenciando = async (id) => {
    const [rows] = await pool.execute('SELECT COUNT(*) AS total FROM grupos WHERE generacion_id = ? AND activo = 1', [id]);
    return Number(rows[0]?.total) || 0;
};
const desactivarSiSinGruposActivos = async (id) => {
    const [resultado] = await pool.execute(
        `UPDATE generaciones AS g SET g.activo = 0
         WHERE g.id = ? AND NOT EXISTS (
             SELECT 1 FROM grupos AS gr WHERE gr.generacion_id = g.id AND gr.activo = 1
         )`,
        [id]
    );
    return resultado;
};

module.exports = { construirCondicionesListado, contarFiltradas, listarPaginado, listarActivas, buscarPorId, buscarDuplicado, crear, actualizar, actualizarEstado, contarGruposActivosReferenciando, desactivarSiSinGruposActivos };
