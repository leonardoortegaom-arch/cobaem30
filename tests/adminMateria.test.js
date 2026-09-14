'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const materiaModel = require('../models/materiaModel');
const { crearControlador, obtenerDatos, validarDatos } = require('../controllers/adminMateriaController');
const crearMenuAdmin = require('../config/adminMenu');
const { requireRole } = require('../middlewares/authMiddleware');

const root = path.join(__dirname, '..');
const leer = (ruta) => fs.readFileSync(path.join(root, ruta), 'utf8');
const respuesta = () => ({
    statusCode: 200, body: null, view: null, locals: null, redirectTo: null,
    status(codigo) { this.statusCode = codigo; return this; },
    send(valor) { this.body = valor; return this; },
    render(vista, datos) { this.view = vista; this.locals = datos; return this; },
    redirect(ruta) { this.redirectTo = ruta; return this; }
});
const req = (extra = {}) => ({ params: {}, query: {}, body: {}, session: { usuario: { id: 1, rol: 'ADMINISTRADOR' } }, ...extra });

test('01 listado administrativo autorizado conserva filtros y paginación', async () => {
    let filtros; const modelo = { contarFiltradas: async (f) => { filtros = f; return 1; }, listarPaginado: async () => [{ id: 1 }] };
    const res = respuesta(); await crearControlador(modelo).listar(req({ query: { q: ' MAT ', estado: 'activo', pagina: '1' } }), res);
    assert.equal(res.view, 'admin/materias/index'); assert.deepEqual(filtros, { busqueda: 'MAT', activo: true });
});
test('02 sin sesión conserva redirección existente', () => { const res = respuesta(); requireRole('ADMINISTRADOR')({ session: {}, originalUrl: '/admin/materias' }, res, () => {}); assert.equal(res.redirectTo, '/login'); });
test('03 rol no administrador conserva rechazo existente', () => { const res = respuesta(); requireRole('ADMINISTRADOR')({ session: { usuario: { rol: 'DOCENTE' } }, originalUrl: '/admin/materias' }, res, () => {}); assert.equal(res.redirectTo, '/dashboard/docente'); });
test('04 GET nueva materia responde 200', () => { const res = respuesta(); crearControlador({}).mostrarNueva(req(), res); assert.equal(res.statusCode, 200); assert.equal(res.view, 'admin/materias/nuevo'); });
test('05 POST está cubierto por CSRF global antes del router', () => { const app = leer('index.js'); assert.ok(app.indexOf('app.use(csrfProtection)') < app.indexOf("app.use('/admin/materias'")); assert.match(leer('middlewares/csrfMiddleware.js'), /status\(403\)/); });
test('06 creación normaliza clave, fuerza activo y guarda descripción vacía como NULL', async () => {
    let creado; const modelo = { buscarDuplicadoClave: async () => null, crear: async (d) => { creado = d; } };
    const res = respuesta(); await crearControlador(modelo).crear(req({ body: { clave: ' mat-1 ', nombre: ' Álgebra ', descripcion: '', activo: '0' } }), res);
    assert.deepEqual(creado, { clave: 'MAT-1', nombre: 'Álgebra', descripcion: null, activo: true }); assert.equal(res.redirectTo, '/admin/materias?creado=1');
});
test('07 clave vacía o mayor de 30 produce 422', async () => { for (const clave of ['   ', 'X'.repeat(31)]) { const res = respuesta(); await crearControlador({}).crear(req({ body: { clave, nombre: 'Nombre' } }), res); assert.equal(res.statusCode, 422); } });
test('08 nombre corto o mayor de 150 produce 422', async () => { for (const nombre of ['X', 'X'.repeat(151)]) { const res = respuesta(); await crearControlador({}).crear(req({ body: { clave: 'A', nombre } }), res); assert.equal(res.statusCode, 422); } });
test('09 descripción mayor de 500 produce 422', () => assert.match(validarDatos(obtenerDatos({ clave: 'A', nombre: 'Nombre', descripcion: 'X'.repeat(501) })), /500/));
test('10 caracteres de control producen 422', () => assert.match(validarDatos(obtenerDatos({ clave: 'A\u0000B', nombre: 'Nombre' })), /control/));
test('11 clave duplicada tiene respuesta segura 422', async () => { const res = respuesta(); await crearControlador({ buscarDuplicadoClave: async () => ({ id: 2 }) }).crear(req({ body: { clave: 'A', nombre: 'Nombre' } }), res); assert.equal(res.statusCode, 422); assert.doesNotMatch(res.locals.error, /SQL|ER_DUP/i); });
test('12 edición válida comprueba duplicado excluyendo el ID', async () => { let exclusion; const modelo = { buscarPorId: async () => ({ id: 2 }), buscarDuplicadoClave: async (c, id) => { exclusion = id; return null; }, actualizar: async () => ({ affectedRows: 1 }) }; const res = respuesta(); await crearControlador(modelo).actualizar(req({ params: { id: '2' }, body: { clave: 'b', nombre: 'Biología' } }), res); assert.equal(exclusion, 2); assert.equal(res.redirectTo, '/admin/materias?actualizado=1'); });
test('13 edición inexistente devuelve 404', async () => { const res = respuesta(); await crearControlador({ buscarPorId: async () => null }).actualizar(req({ params: { id: '4' }, body: { clave: 'A', nombre: 'Nombre' } }), res); assert.equal(res.statusCode, 404); });
test('14 estado activo e inactivo usa operación específica', async () => { const valores = []; const modelo = { buscarPorId: async () => ({ activo: 1 }), actualizarEstado: async (id, activo) => { valores.push(activo); return { affectedRows: 1 }; } }; const res = respuesta(); await crearControlador(modelo).actualizarEstado(req({ params: { id: '1' }, body: { accion: 'desactivar' } }), res); assert.deepEqual(valores, [false]); });
test('15 operación de estado idempotente no ejecuta UPDATE', async () => { let llamadas = 0; const modelo = { buscarPorId: async () => ({ activo: 1 }), actualizarEstado: async () => { llamadas += 1; } }; const res = respuesta(); await crearControlador(modelo).actualizarEstado(req({ params: { id: '1' }, body: { accion: 'activar' } }), res); assert.equal(llamadas, 0); assert.equal(res.redirectTo, '/admin/materias?estado=activado'); });
test('16 affectedRows cero se trata como materia inexistente', async () => { const modelo = { buscarPorId: async () => ({}), buscarDuplicadoClave: async () => null, actualizar: async () => ({ affectedRows: 0 }) }; const res = respuesta(); await crearControlador(modelo).actualizar(req({ params: { id: '1' }, body: { clave: 'A', nombre: 'Nombre' } }), res); assert.equal(res.statusCode, 404); });
test('17 filtros usan placeholders y límite fijo seguro', () => { const construido = materiaModel.construirCondicionesListado({ busqueda: "A%'_", activo: false }); assert.equal(construido.parametros.length, 3); assert.match(construido.clausulaWhere, /LIKE \?/); assert.doesNotMatch(construido.clausulaWhere, /A%/); assert.match(leer('models/materiaModel.js'), /limite > 0 && limite <= 50/); });
test('18 error MySQL se traduce a 503', async () => { const res = respuesta(); await crearControlador({ contarFiltradas: async () => { throw new Error('SQL privado'); } }).listar(req(), res); assert.equal(res.statusCode, 503); assert.doesNotMatch(res.body, /SQL privado/); });
test('19 valores dinámicos de formularios quedan escapados', () => { const file = path.join(root, 'views/admin/materias/nuevo.ejs'); const html = ejs.render(leer('views/admin/materias/nuevo.ejs'), { title: 'x', menuItems: [], csrfToken: 't', error: null, datos: { clave: '<x>', nombre: '<y>', descripcion: '<z>' } }, { filename: file }); assert.match(html, /&lt;x&gt;/); assert.doesNotMatch(html, /value="<x>"/); });
test('20 no existe ruta DELETE ni modelo de eliminación', () => { assert.doesNotMatch(leer('routes/adminMateriaRoutes.js'), /router\.delete/i); assert.doesNotMatch(leer('models/materiaModel.js'), /DELETE\s+FROM/i); });
test('21 activo no se acepta en formularios ordinarios', () => { const datos = obtenerDatos({ clave: 'A', nombre: 'Nombre', activo: '0' }); assert.equal(Object.hasOwn(datos, 'activo'), false); assert.doesNotMatch(leer('views/admin/materias/nuevo.ejs') + leer('views/admin/materias/editar.ejs'), /name="activo"/); });
test('22 enlace del menú dirige a materias y se activa', () => { const item = crearMenuAdmin('materias').find((x) => x.texto === 'Materias'); assert.equal(item.url, '/admin/materias'); assert.equal(item.activo, true); });
test('23 acción rápida dirige al alta de materia', () => assert.match(leer('views/dashboards/admin.ejs'), /href="\/admin\/materias\/nuevo"[^>]*>[\s\S]*?Registrar materia/));
