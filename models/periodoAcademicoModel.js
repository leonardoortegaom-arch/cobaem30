const pool = require('../config/database');

const escaparLike = (valor) => valor.replace(/[\\%_]/g, '\\$&');
const construirCondicionesListado = ({ busqueda, activo, cicloEscolarId } = {}) => {
    const condiciones = [];
    const parametros = [];
    if (busqueda) { const p = `%${escaparLike(busqueda)}%`; condiciones.push("(p.clave LIKE ? ESCAPE '\\\\' OR p.nombre LIKE ? ESCAPE '\\\\')"); parametros.push(p, p); }
    if (typeof activo === 'boolean') { condiciones.push('p.activo = ?'); parametros.push(activo ? 1 : 0); }
    if (Number.isSafeInteger(cicloEscolarId) && cicloEscolarId > 0) { condiciones.push('p.ciclo_escolar_id = ?'); parametros.push(cicloEscolarId); }
    return { clausulaWhere: condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '', parametros };
};
const contarFiltradas = async (f = {}) => { const c = construirCondicionesListado(f); const [r] = await pool.execute(`SELECT COUNT(*) AS total FROM periodos_academicos p ${c.clausulaWhere}`, c.parametros); return Number(r[0]?.total) || 0; };
const listarPaginado = async (f = {}, limite = 15, offset = 0) => {
    const l = Number.isInteger(limite) && limite > 0 && limite <= 50 ? limite : 15;
    const o = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    const c = construirCondicionesListado(f);
    const [r] = await pool.execute(`SELECT p.id, p.ciclo_escolar_id, p.clave, p.nombre, DATE_FORMAT(p.fecha_inicio, '%Y-%m-%d') AS fecha_inicio, DATE_FORMAT(p.fecha_fin, '%Y-%m-%d') AS fecha_fin, p.activo, p.creado_en, c.clave AS ciclo_clave, c.nombre AS ciclo_nombre, c.activo AS ciclo_activo FROM periodos_academicos p INNER JOIN ciclos_escolares c ON c.id = p.ciclo_escolar_id ${c.clausulaWhere} ORDER BY p.activo DESC, p.fecha_inicio DESC, p.id ASC LIMIT ? OFFSET ?`, [...c.parametros, String(l), String(o)]);
    return r;
};
const listarActivos = async () => { const [r] = await pool.execute('SELECT p.id, p.clave, p.nombre, p.ciclo_escolar_id FROM periodos_academicos p INNER JOIN ciclos_escolares c ON c.id = p.ciclo_escolar_id WHERE p.activo = 1 AND c.activo = 1 ORDER BY p.fecha_inicio DESC, p.id ASC'); return r; };
const buscarPorId = async (id) => { const [r] = await pool.execute("SELECT p.id, p.ciclo_escolar_id, p.clave, p.nombre, DATE_FORMAT(p.fecha_inicio, '%Y-%m-%d') AS fecha_inicio, DATE_FORMAT(p.fecha_fin, '%Y-%m-%d') AS fecha_fin, p.activo, p.creado_en, c.clave AS ciclo_clave, c.nombre AS ciclo_nombre, DATE_FORMAT(c.fecha_inicio, '%Y-%m-%d') AS ciclo_fecha_inicio, DATE_FORMAT(c.fecha_fin, '%Y-%m-%d') AS ciclo_fecha_fin, c.activo AS ciclo_activo FROM periodos_academicos p INNER JOIN ciclos_escolares c ON c.id = p.ciclo_escolar_id WHERE p.id = ? LIMIT 1", [id]); return r[0] || null; };
const buscarDuplicado = async (cicloId, clave, excluirId = null) => { const p = [cicloId, clave]; const x = Number.isSafeInteger(excluirId) && excluirId > 0 ? ' AND id <> ?' : ''; if (x) p.push(excluirId); const [r] = await pool.execute(`SELECT id FROM periodos_academicos WHERE ciclo_escolar_id = ? AND clave = ?${x} LIMIT 1`, p); return r[0] || null; };
const crear = async (d) => { const [r] = await pool.execute('INSERT INTO periodos_academicos (ciclo_escolar_id, clave, nombre, fecha_inicio, fecha_fin, activo) VALUES (?, ?, ?, ?, ?, 1)', [d.cicloEscolarId, d.clave, d.nombre, d.fechaInicio, d.fechaFin]); return r.insertId; };
const actualizar = async (id, d) => { const [r] = await pool.execute('UPDATE periodos_academicos SET ciclo_escolar_id = ?, clave = ?, nombre = ?, fecha_inicio = ?, fecha_fin = ? WHERE id = ?', [d.cicloEscolarId, d.clave, d.nombre, d.fechaInicio, d.fechaFin, id]); return r; };
const actualizarEstado = async (id, activo) => { const [r] = await pool.execute('UPDATE periodos_academicos SET activo = ? WHERE id = ?', [activo ? 1 : 0, id]); return r; };
const activarSiCicloActivo = async (id) => { const [r] = await pool.execute('UPDATE periodos_academicos AS p INNER JOIN ciclos_escolares AS c ON c.id = p.ciclo_escolar_id SET p.activo = 1 WHERE p.id = ? AND c.activo = 1', [id]); return r; };
module.exports = { construirCondicionesListado, contarFiltradas, listarPaginado, listarActivos, buscarPorId, buscarDuplicado, crear, actualizar, actualizarEstado, activarSiCicloActivo };
