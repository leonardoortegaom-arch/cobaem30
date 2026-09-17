'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const grupoModel = require('../models/grupoModel');
const controlador = require('../controllers/adminGrupoCalendarioController');

const root = path.join(__dirname, '..');
const leer = (archivo) => fs.readFileSync(path.join(root, archivo), 'utf8');
const respuesta = () => ({ statusCode: 200, body: null, view: null, locals: null, redirectTo: null,
    status(c) { this.statusCode = c; return this; }, send(x) { this.body = x; return this; },
    render(v, d) { this.view = v; this.locals = d; return this; }, redirect(x) { this.redirectTo = x; return this; } });
const solicitud = (extra = {}) => ({ params: { id: '1' }, query: {}, body: {},
    session: { usuario: { id: 9, rol: 'ADMINISTRADOR' } }, ...extra });

const crearDb = (respuestas, { fallarEn } = {}) => {
    const consultas = [];
    let indice = 0;
    const conexion = {
        commits: 0, rollbacks: 0, releases: 0,
        async beginTransaction() {},
        async execute(sql, params) {
            consultas.push({ sql, params });
            indice += 1;
            if (fallarEn === indice) throw new Error('fallo simulado');
            return respuestas.shift() || [[]];
        },
        async commit() { this.commits += 1; }, async rollback() { this.rollbacks += 1; },
        release() { this.releases += 1; }
    };
    return { db: { async getConnection() { return conexion; }, execute: conexion.execute.bind(conexion) }, conexion, consultas };
};

test('01 rutas de calendario exigen autenticaciÃ³n y administrador', () => {
    const s = leer('routes/adminGrupoRoutes.js');
    assert.match(s, /\/:id\/calendario[\s\S]+requireAuth[\s\S]+requireRole\('ADMINISTRADOR'\)/);
});
test('02 GET inexistente responde 404', async () => {
    const r = respuesta(); const c = controlador.crearControlador({ grupos: {
        buscarPorIdConCalendario: async () => null, listarGeneracionesActivas: async () => [],
        listarPeriodosActivosConCicloActivo: async () => [] }, crearMenu: () => [] });
    await c.mostrar(solicitud(), r); assert.equal(r.statusCode, 404);
});
test('03 GET muestra estado vacÃ­o sin formulario utilizable', async () => {
    const r = respuesta(); const c = controlador.crearControlador({ grupos: {
        buscarPorIdConCalendario: async () => ({ id: 1 }), listarGeneracionesActivas: async () => [],
        listarPeriodosActivosConCicloActivo: async () => [] }, crearMenu: () => [] });
    await c.mostrar(solicitud(), r); assert.equal(r.view, 'admin/grupos/calendario'); assert.equal(r.locals.generaciones.length, 0);
    assert.match(leer('views/admin/grupos/calendario.ejs'), /Administrar generaciones/);
});
test('04 POST rechaza IDs manipulados', async () => { const r = respuesta(); await controlador.guardar(solicitud({ body: { generacion_id: 'x', periodo_academico_id: '2' } }), r); assert.equal(r.statusCode, 422); });
test('05 POST traduce catÃ¡logo inactivo a 422', async () => { const r = respuesta(); const e = new Error(); e.codigo = 'GENERACION_NO_DISPONIBLE'; await controlador.crearControlador({ grupos: { actualizarCalendario: async () => { throw e; } } }).guardar(solicitud({ body: { generacion_id: '1', periodo_academico_id: '2' } }), r); assert.equal(r.statusCode, 422); });
test('06 POST traduce historial a 409', async () => { const r = respuesta(); const e = new Error(); e.codigo = 'GENERACION_CON_HISTORIAL'; await controlador.crearControlador({ grupos: { actualizarCalendario: async () => { throw e; } } }).guardar(solicitud({ body: { generacion_id: '1', periodo_academico_id: '2' } }), r); assert.equal(r.statusCode, 409); });
test('07 primera vinculaciÃ³n es atÃ³mica y conserva ciclo heredado', async () => {
    const f = crearDb([
        [[{ id: 1, generacion_id: null, periodo_academico_id: null, ciclo_escolar: '2024-2027' }]],
        [[{ id: 2, anio_inicio: 2026, anio_fin: 2029, activo: 1 }]],
        [[{ id: 3, activo: 1, ciclo_id: 4, ciclo_activo: 1 }]],
        [{ affectedRows: 1 }], [[{ generacion_id: 2, periodo_academico_id: 3, ciclo_escolar: '2024-2027' }]]
    ]);
    const m = grupoModel.crearModeloCalendario(f.db); const out = await m.actualizarCalendario(1, 2, 3);
    assert.equal(out.resultado, 'ACTUALIZADO'); assert.equal(f.conexion.commits, 1); assert.equal(f.conexion.releases, 1);
    const update = f.consultas.find(q => /^UPDATE grupos/.test(q.sql)); assert.deepEqual(update.params, [2, 3, 1]); assert.doesNotMatch(update.sql, /ciclo_escolar\s*=/);
});
test('08 misma configuraciÃ³n es idempotente sin UPDATE', async () => {
    const f = crearDb([[[{ id: 1, generacion_id: 2, periodo_academico_id: 3, ciclo_escolar: 'x' }]], [[{ id: 2, activo: 1 }]], [[{ id: 3, activo: 1, ciclo_activo: 1 }]]]);
    const out = await grupoModel.crearModeloCalendario(f.db).actualizarCalendario(1, 2, 3);
    assert.equal(out.resultado, 'SIN_CAMBIOS'); assert.equal(f.consultas.some(q => /^UPDATE grupos/.test(q.sql)), false);
});
test('09 cambio de periodo conserva generaciÃ³n y estÃ¡ permitido', async () => {
    const f = crearDb([[[{ id: 1, generacion_id: 2, periodo_academico_id: 3, ciclo_escolar: 'x' }]], [[{ id: 2, activo: 1 }]], [[{ id: 4, activo: 1, ciclo_activo: 1 }]], [{ affectedRows: 1 }], [[{ generacion_id: 2, periodo_academico_id: 4, ciclo_escolar: 'x' }]]]);
    await grupoModel.crearModeloCalendario(f.db).actualizarCalendario(1, 2, 4); assert.equal(f.consultas.some(q => /importaciones_horario/.test(q.sql)), false);
});
test('10 cambio de generaciÃ³n con historial se rechaza', async () => {
    const f = crearDb([[[{ id: 1, generacion_id: 1, periodo_academico_id: 3, ciclo_escolar: 'x' }]], [[{ id: 2, activo: 1 }]], [[{ id: 4, activo: 1, ciclo_activo: 1 }]], [[{ tiene_historial: 1 }]]]);
    await assert.rejects(() => grupoModel.crearModeloCalendario(f.db).actualizarCalendario(1, 2, 4), e => e.codigo === 'GENERACION_CON_HISTORIAL');
    assert.equal(f.conexion.rollbacks, 1); assert.equal(f.conexion.releases, 1);
});
test('11 cambio de generaciÃ³n sin historial se permite', async () => {
    const f = crearDb([[[{ id: 1, generacion_id: 1, periodo_academico_id: 3, ciclo_escolar: 'x' }]], [[{ id: 2, activo: 1 }]], [[{ id: 4, activo: 1, ciclo_activo: 1 }]], [[{ tiene_historial: 0 }]], [{ affectedRows: 1 }], [[{ generacion_id: 2, periodo_academico_id: 4, ciclo_escolar: 'x' }]]]);
    await grupoModel.crearModeloCalendario(f.db).actualizarCalendario(1, 2, 4); assert.equal(f.conexion.commits, 1);
});
test('12 fallo provoca rollback y libera conexiÃ³n', async () => { const f = crearDb([], { fallarEn: 1 }); await assert.rejects(() => grupoModel.crearModeloCalendario(f.db).actualizarCalendario(1, 2, 3)); assert.equal(f.conexion.rollbacks, 1); assert.equal(f.conexion.releases, 1); });
test('13 grupo inexistente se distingue', async () => { const f = crearDb([[[]]]); await assert.rejects(() => grupoModel.crearModeloCalendario(f.db).actualizarCalendario(1, 2, 3), e => e.codigo === 'GRUPO_NO_ENCONTRADO'); });
test('14 generaciÃ³n y periodo inactivos se rechazan bajo transacciÃ³n', async () => { const f = crearDb([[[{ id: 1, generacion_id: null, periodo_academico_id: null }]], [[{ id: 2, activo: 0 }]]]); await assert.rejects(() => grupoModel.crearModeloCalendario(f.db).actualizarCalendario(1, 2, 3), e => e.codigo === 'GENERACION_NO_DISPONIBLE'); });
test('15 nueva creaciÃ³n deriva AAAA-AAAA de generaciÃ³n', async () => {
    const f = crearDb([[[{ id: 2, anio_inicio: 2026, anio_fin: 2029, activo: 1 }]], [[{ id: 3, activo: 1, ciclo_activo: 1 }]], [{ insertId: 8 }]]);
    const out = await grupoModel.crearModeloCalendario(f.db).crearNormalizado({ turnoId: 1, clave: '101', semestre: 1, generacionId: 2, periodoId: 3 });
    assert.equal(out.cicloEscolar, '2026-2029'); assert.deepEqual(f.consultas[2].params, [1, '101', 1, '2026-2029', 2, 3]);
});
test('16 filtros de normalizaciÃ³n usan placeholder y JOIN Ãºnico', () => { const c = grupoModel.construirCondicionesListado({ estadoCalendario: 'PENDIENTE' }); assert.match(c.clausulaWhere, /= \?/); assert.deepEqual(c.parametros, ['PENDIENTE']); assert.match(leer('models/grupoModel.js'), /LEFT JOIN generaciones/); });
test('17 selector futuro exige todos los estados activos', () => { const s = leer('models/grupoModel.js'); assert.match(s, /listarActivosNormalizadosParaSeleccion[\s\S]+generaciones\.activo = 1[\s\S]+periodos_academicos\.activo = 1[\s\S]+ciclos_escolares\.activo = 1/); });
test('18 referencias no pueden limpiarse desde la interfaz', () => { const v = leer('views/admin/grupos/calendario.ejs'); assert.doesNotMatch(v, /value=""[^>]*>Sin configuraciÃ³n/); assert.doesNotMatch(leer('controllers/adminGrupoCalendarioController.js'), /generacion_id\s*=\s*NULL/i); });
test('19 ediciÃ³n general no cambia referencias normalizadas', () => { const s = leer('models/grupoModel.js'); const inicio = s.indexOf('const actualizar ='); const fin = s.indexOf('const actualizarEstado'); const tramo = s.slice(inicio, fin); assert.doesNotMatch(tramo, /SET[\s\S]*generacion_id\s*=/i); assert.doesNotMatch(tramo, /SET[\s\S]*periodo_academico_id\s*=/i); });
test('20 no hay DELETE ni SQL de horarios en controlador nuevo', () => { const s = leer('controllers/adminGrupoCalendarioController.js'); assert.doesNotMatch(s, /DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+/i); });
test('21 creaciÃ³n administrativa exige referencias', () => { const s = leer('controllers/adminGrupoController.js'); assert.match(s, /convertirEnteroPositivo\(datos\.generacion_id\)/); assert.match(s, /convertirEnteroPositivo\(datos\.periodo_academico_id\)/); assert.match(s, /crearNormalizado/); });
