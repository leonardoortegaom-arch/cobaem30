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
    if (typeof activo === 'boolean') { condiciones.push('activo = ?'); parametros.push(activo ? 1 : 0); }
    return { clausulaWhere: condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '', parametros };
};
const contarFiltradas = async (filtros = {}) => { const c = construirCondicionesListado(filtros); const [r] = await pool.execute(`SELECT COUNT(*) AS total FROM ciclos_escolares ${c.clausulaWhere}`, c.parametros); return Number(r[0]?.total) || 0; };
const listarPaginado = async (filtros = {}, limite = 15, offset = 0) => {
    const l = Number.isInteger(limite) && limite > 0 && limite <= 50 ? limite : 15;
    const o = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    const c = construirCondicionesListado(filtros);
    const [rows] = await pool.execute(`SELECT id, clave, nombre, DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS fecha_inicio, DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS fecha_fin, activo, creado_en FROM ciclos_escolares ${c.clausulaWhere} ORDER BY activo DESC, fecha_inicio DESC, id ASC LIMIT ? OFFSET ?`, [...c.parametros, String(l), String(o)]);
    return rows;
};
const listarActivos = async () => { const [r] = await pool.execute("SELECT id, clave, nombre, DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS fecha_inicio, DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS fecha_fin FROM ciclos_escolares WHERE activo = 1 ORDER BY fecha_inicio DESC, id ASC"); return r; };
const buscarPorId = async (id) => { const [r] = await pool.execute("SELECT id, clave, nombre, DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS fecha_inicio, DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS fecha_fin, activo, creado_en FROM ciclos_escolares WHERE id = ? LIMIT 1", [id]); return r[0] || null; };
const buscarDuplicadoClave = async (clave, excluirId = null) => { const p = [clave]; const x = Number.isSafeInteger(excluirId) && excluirId > 0 ? ' AND id <> ?' : ''; if (x) p.push(excluirId); const [r] = await pool.execute(`SELECT id FROM ciclos_escolares WHERE clave = ?${x} LIMIT 1`, p); return r[0] || null; };
const crear = async (d) => { const [r] = await pool.execute('INSERT INTO ciclos_escolares (clave, nombre, fecha_inicio, fecha_fin, activo) VALUES (?, ?, ?, ?, 1)', [d.clave, d.nombre, d.fechaInicio, d.fechaFin]); return r.insertId; };
const actualizar = async (id, d) => { const [r] = await pool.execute('UPDATE ciclos_escolares SET clave = ?, nombre = ?, fecha_inicio = ?, fecha_fin = ? WHERE id = ?', [d.clave, d.nombre, d.fechaInicio, d.fechaFin, id]); return r; };
const actualizarEstado = async (id, activo) => { const [r] = await pool.execute('UPDATE ciclos_escolares SET activo = ? WHERE id = ?', [activo ? 1 : 0, id]); return r; };
const contarPeriodosActivos = async (id) => { const [r] = await pool.execute('SELECT COUNT(*) AS total FROM periodos_academicos WHERE ciclo_escolar_id = ? AND activo = 1', [id]); return Number(r[0]?.total) || 0; };
const contarPeriodosFueraDeRango = async (id, fechaInicio, fechaFin) => { const [r] = await pool.execute('SELECT COUNT(*) AS total FROM periodos_academicos WHERE ciclo_escolar_id = ? AND (fecha_inicio < ? OR fecha_fin > ?)', [id, fechaInicio, fechaFin]); return Number(r[0]?.total) || 0; };
const desactivarSiSinPeriodosActivos = async (id) => { const [r] = await pool.execute(`UPDATE ciclos_escolares AS c SET c.activo = 0 WHERE c.id = ? AND NOT EXISTS (SELECT 1 FROM periodos_academicos AS p WHERE p.ciclo_escolar_id = c.id AND p.activo = 1)`, [id]); return r; };
module.exports = { construirCondicionesListado, contarFiltradas, listarPaginado, listarActivos, buscarPorId, buscarDuplicadoClave, crear, actualizar, actualizarEstado, contarPeriodosActivos, contarPeriodosFueraDeRango, desactivarSiSinPeriodosActivos };
