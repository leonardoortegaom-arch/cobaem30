'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const modeloModulo = require('../models/alumnoMateriaModel');
const controllerModulo = require('../controllers/alumnoMateriaController');
const crearMenuPorRol = require('../config/roleMenus');

const root = path.join(__dirname, '..');
const leer = (archivo) => fs.readFileSync(path.join(root, archivo), 'utf8');
const respuesta = () => ({ statusCode: 200, body: null, view: null, locals: null,
    status(c) { this.statusCode = c; return this; }, send(x) { this.body = x; return this; },
    render(v, d) { this.view = v; this.locals = d; return this; } });
const req = (extra = {}) => ({ session: { usuario: { id: 77, rol: 'ALUMNO' } }, query: {}, params: {}, ...extra });
const filaBase = { usuario_id: 77, alumno_grupo_id: 1, grupo_id: 1, generacion_id: 2,
    periodo_academico_id: 3, version_horario_id: 4, clase_id: 5, dia_semana: 1,
    hora_inicio: '08:00', hora_fin: '09:00', materia_clave: 'MAT', materia_nombre: 'Matemáticas',
    materia_descripcion: null, docente_nombre: 'Docente Uno', aula_nombre: null };
const modeloConFilas = (rows) => { let llamadas = 0; let parametros; let sql;
    const modelo = modeloModulo.crearModelo({ execute: async (q, p) => { llamadas += 1; sql = q; parametros = p; return [rows]; } });
    return { modelo, obtener: () => ({ llamadas, parametros, sql }) }; };

test('01 ruta es GET protegida exclusivamente para ALUMNO', () => { const s = leer('routes/alumnoMateriaRoutes.js'); assert.match(s, /router\.get\('\/', requireAuth, requireRole\('ALUMNO'\)/); assert.doesNotMatch(s, /router\.(post|put|patch|delete)/i); });
test('02 router está montado después de CSRF y sesión', () => { const s = leer('index.js'); assert.ok(s.indexOf('app.use(csrfProtection)') < s.indexOf("app.use('/alumno/materias'")); });
test('03 consulta recibe exclusivamente el usuario de sesión', async () => { const f = modeloConFilas([]); await f.modelo.obtenerEstadoAcademico(77); assert.deepEqual(f.obtener().parametros, [77]); assert.match(f.obtener().sql, /WHERE alumnos\.usuario_id = \?/); });
test('04 consulta no acepta alcance por query o params', () => { const s = leer('controllers/alumnoMateriaController.js'); assert.doesNotMatch(s, /req\.(query|params)\.(alumno|grupo|periodo|version|usuario|materia)/); });
test('05 perfil inexistente produce estado explícito', async () => { const f = modeloConFilas([]); assert.equal((await f.modelo.obtenerEstadoAcademico(77)).estado, 'NO_STUDENT_PROFILE'); });
test('06 alumno sin grupo produce estado explícito', async () => { const f = modeloConFilas([{ usuario_id: 77, alumno_grupo_id: null, grupo_id: null }]); assert.equal((await f.modelo.obtenerEstadoAcademico(77)).estado, 'NO_GROUP'); });
test('07 grupo sin calendario queda pendiente', async () => { const f = modeloConFilas([{ ...filaBase, generacion_id: null, periodo_academico_id: null, version_horario_id: null, clase_id: null }]); assert.equal((await f.modelo.obtenerEstadoAcademico(77)).estado, 'GROUP_CALENDAR_PENDING'); });
test('08 grupo sin versión activa tiene estado vacío controlado', async () => { const f = modeloConFilas([{ ...filaBase, version_horario_id: null, clase_id: null }]); assert.equal((await f.modelo.obtenerEstadoAcademico(77)).estado, 'NO_ACTIVE_SCHEDULE'); });
test('09 versión activa vacía no se confunde con ausencia de versión', async () => { const f = modeloConFilas([{ ...filaBase, clase_id: null }]); assert.equal((await f.modelo.obtenerEstadoAcademico(77)).estado, 'ACTIVE_SCHEDULE_EMPTY'); });
test('10 versión con clases queda disponible', async () => { const f = modeloConFilas([filaBase]); const r = await f.modelo.obtenerEstadoAcademico(77); assert.equal(r.estado, 'ACTIVE_SCHEDULE_AVAILABLE'); assert.equal(r.filas.length, 1); });
test('11 consulta usa una ejecución y evita N+1', async () => { const f = modeloConFilas([filaBase, { ...filaBase, clase_id: 6 }]); await f.modelo.obtenerEstadoAcademico(77); assert.equal(f.obtener().llamadas, 1); });
test('12 consulta exige versión activa del grupo y periodo actuales', () => { const s = leer('models/alumnoMateriaModel.js'); assert.match(s, /versiones\.grupo_id = grupos\.id/); assert.match(s, /versiones\.periodo_academico_id = grupos\.periodo_academico_id/); assert.match(s, /versiones\.activa = 1/); });
test('13 no selecciona correo ni datos de versiones históricas', () => { const s = leer('models/alumnoMateriaModel.js'); assert.doesNotMatch(s, /docentes\.correo|versiones\.numero_version|versiones\.creada_por/); });
test('14 agrupa bloques de una materia en una tarjeta', () => { const materias = controllerModulo.construirMaterias([filaBase, { ...filaBase, clase_id: 6, dia_semana: 3 }]); assert.equal(materias.length, 1); assert.equal(materias[0].cantidadBloques, 2); });
test('15 varios docentes se deduplican y ordenan', () => { const materias = controllerModulo.construirMaterias([filaBase, { ...filaBase, docente_nombre: 'Docente Dos' }, { ...filaBase }]); assert.deepEqual(materias[0].docentes, ['Docente Dos', 'Docente Uno']); });
test('16 aula NULL se presenta con texto seguro', () => { const materias = controllerModulo.construirMaterias([filaBase]); assert.equal(materias[0].bloques[0].aula, 'Sin aula asignada'); });
test('17 orden es materia día y horas', () => { const materias = controllerModulo.construirMaterias([{ ...filaBase, materia_clave: 'Z', materia_nombre: 'Zeta', dia_semana: 1 }, { ...filaBase, materia_clave: 'A', materia_nombre: 'Álgebra', dia_semana: 3, hora_inicio: '10:00' }, { ...filaBase, materia_clave: 'A', materia_nombre: 'Álgebra', dia_semana: 1, hora_inicio: '08:00' }]); assert.equal(materias[0].nombre, 'Álgebra'); assert.deepEqual(materias[0].bloques.map(b => b.diaNumero), [1, 3]); });
test('18 desarrollo usa demo solo sin calendario o versión', async () => { for (const estado of ['GROUP_CALENDAR_PENDING', 'NO_ACTIVE_SCHEDULE']) { const r = respuesta(); await controllerModulo.crearControlador({ modelo: { obtenerEstadoAcademico: async () => ({ estado, filas: [] }) }, datosDemo: [{ materiaClave: 'D', materiaNombre: 'Demo', docenteNombre: 'Docente', diaSemana: 1, horaInicio: '08:00', horaFin: '09:00' }], entorno: () => 'development' }).listar(req(), r); assert.equal(r.locals.modoDemostracion, true); assert.equal(r.locals.materias.length, 1); } });
test('19 producción deshabilita demo', async () => { const r = respuesta(); await controllerModulo.crearControlador({ modelo: { obtenerEstadoAcademico: async () => ({ estado: 'NO_ACTIVE_SCHEDULE', filas: [] }) }, datosDemo: [filaBase], entorno: () => 'production' }).listar(req(), r); assert.equal(r.locals.modoDemostracion, false); assert.equal(r.locals.materias.length, 0); });
test('20 error SQL nunca usa demo y responde 503', async () => { const r = respuesta(); await controllerModulo.crearControlador({ modelo: { obtenerEstadoAcademico: async () => { throw new Error('SQL privado'); } }, datosDemo: [filaBase], entorno: () => 'development' }).listar(req(), r); assert.equal(r.statusCode, 503); assert.doesNotMatch(r.body, /SQL privado/); });
test('21 versión activa vacía nunca usa demo', async () => { const r = respuesta(); await controllerModulo.crearControlador({ modelo: { obtenerEstadoAcademico: async () => ({ estado: 'ACTIVE_SCHEDULE_EMPTY', filas: [] }) }, datosDemo: [filaBase], entorno: () => 'development' }).listar(req(), r); assert.equal(r.locals.modoDemostracion, false); assert.equal(r.locals.materias.length, 0); });
test('22 datos reales y demo nunca se mezclan', async () => { const r = respuesta(); await controllerModulo.crearControlador({ modelo: { obtenerEstadoAcademico: async () => ({ estado: 'ACTIVE_SCHEDULE_AVAILABLE', filas: [filaBase] }) }, datosDemo: [{ ...filaBase, materia_clave: 'DEMO' }], entorno: () => 'development' }).listar(req(), r); assert.equal(r.locals.modoDemostracion, false); assert.deepEqual(r.locals.materias.map(m => m.clave), ['MAT']); });
test('23 perfil o grupo inexistente responde 404 genérico', async () => { for (const estado of ['NO_STUDENT_PROFILE', 'NO_GROUP']) { const r = respuesta(); await controllerModulo.crearControlador({ modelo: { obtenerEstadoAcademico: async () => ({ estado, filas: [] }) } }).listar(req(), r); assert.equal(r.statusCode, 404); assert.equal(r.body, 'Perfil académico no encontrado.'); } });
test('24 vista muestra aviso y escapa datos', () => { const archivo = path.join(root, 'views/alumno/materias/index.ejs'); const html = ejs.render(leer('views/alumno/materias/index.ejs'), { title: 'x', menuItems: [], csrfToken: 't', modoDemostracion: true, estado: 'NO_ACTIVE_SCHEDULE', resumen: { materias: 1, bloques: 1, docentes: 1 }, materias: [{ clave: '<DEMO>', nombre: '<script>x</script>', descripcion: '<b>x</b>', docentes: ['<docente>'], cantidadBloques: 1, bloques: [{ dia: 'Lunes', horaInicio: '08:00', horaFin: '09:00', aula: '<aula>' }] }] }, { filename: archivo }); assert.match(html, /Contenido de demostración/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>x<\/script>/); });
test('25 menú y dashboard enlazan a la ruta real', () => { const item = crearMenuPorRol('ALUMNO', { dashboardActivo: false, opcionActiva: '/alumno/materias' }).find(i => i.texto === 'Mis materias'); assert.equal(item.url, '/alumno/materias'); assert.equal(item.activo, true); assert.match(leer('views/dashboards/alumno.ejs'), /href="\/alumno\/materias"/); });
test('26 fixture no contiene IDs utilizables ni acceso a MySQL', () => { const s = leer('config/studentSubjectsDemo.js'); assert.doesNotMatch(s, /\bid\s*:/); assert.doesNotMatch(s, /database|mysql|pool|execute\(/i); });
test('27 solo existe lectura SQL en el nuevo modelo', () => { const s = leer('models/alumnoMateriaModel.js'); assert.doesNotMatch(s, /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i); assert.match(s, /SELECT/); });
