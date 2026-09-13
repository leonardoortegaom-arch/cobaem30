const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const { crearModelo, fechaLocalActual, ErrorAsignacionOrientador } = require('../models/asignacionOrientadorGrupoModel');
const { crearControlador, enteroPositivo } = require('../controllers/adminGrupoOrientadorController');

const crearConexion = ({ grupo = true, usuario = { id: 7, activo: 1, rol_clave: 'ORIENTADOR' },
    vigente = [], fallaInsert = false, conteo = 1 } = {}) => {
    const llamadas = [];
    const conexion = {
        llamadas,
        beginTransaction: async () => llamadas.push(['BEGIN']),
        commit: async () => llamadas.push(['COMMIT']),
        rollback: async () => llamadas.push(['ROLLBACK']),
        release: () => llamadas.push(['RELEASE']),
        execute: async (sql, params) => {
            llamadas.push([sql, params]);
            if (/FROM grupos/.test(sql)) return [[...(grupo ? [{ id: 1 }] : [])]];
            if (/FROM usuarios INNER JOIN roles/.test(sql)) return [[...(usuario ? [usuario] : [])]];
            if (/SELECT id, orientador_usuario_id/.test(sql)) return [vigente];
            if (/^\s*UPDATE/.test(sql)) return [{ affectedRows: 1 }];
            if (/^\s*INSERT/.test(sql)) {
                if (fallaInsert) throw new Error('fallo simulado');
                return [{ affectedRows: 1 }];
            }
            if (/COUNT\(\*\)/.test(sql)) return [[{ total: conteo }]];
            throw new Error(`Consulta no simulada: ${sql.slice(0, 40)}`);
        }
    };
    return conexion;
};

const crearRespuesta = () => ({
    statusCode: 200, body: null, redirectTo: null, view: null, locals: null,
    status(codigo) { this.statusCode = codigo; return this; },
    send(texto) { this.body = texto; return this; },
    redirect(destino) { this.redirectTo = destino; return this; },
    render(vista, datos) { this.view = vista; this.locals = datos; return this; }
});

test('fechaLocalActual usa componentes locales y formato YYYY-MM-DD', () => {
    assert.equal(fechaLocalActual(new Date(2026, 8, 13, 23, 59)), '2026-09-13');
});

test('primera asignacion bloquea, valida, inserta con creador de sesion y confirma', async () => {
    const conexion = crearConexion();
    const modelo = crearModelo({ getConnection: async () => conexion }, () => '2026-09-13');
    assert.deepEqual(await modelo.reemplazarAsignacionVigente({ grupoId: 1, orientadorUsuarioId: 7, creadoPorUsuarioId: 3 }), { resultado: 'ASIGNADA' });
    const sql = conexion.llamadas.map(([texto]) => texto).filter(Boolean);
    assert.ok(sql.some((s) => /grupos.+FOR UPDATE/s.test(s)));
    assert.ok(sql.some((s) => /usuarios.+roles.+FOR UPDATE/s.test(s)));
    assert.ok(sql.some((s) => /asignaciones_orientador_grupo.+FOR UPDATE/s.test(s)));
    const insercion = conexion.llamadas.find(([s]) => /^\s*INSERT/.test(s));
    assert.deepEqual(insercion[1], [1, 7, '2026-09-13', 3]);
    assert.ok(conexion.llamadas.some(([s]) => s === 'COMMIT'));
});

test('reemplazo cierra la anterior, crea la nueva y conserva una sola vigente', async () => {
    const conexion = crearConexion({ vigente: [{ id: 9, orientador_usuario_id: 4 }] });
    const modelo = crearModelo({ getConnection: async () => conexion }, () => '2026-09-13');
    assert.deepEqual(await modelo.reemplazarAsignacionVigente({ grupoId: 1, orientadorUsuarioId: 7, creadoPorUsuarioId: 3 }), { resultado: 'ACTUALIZADA' });
    assert.deepEqual(conexion.llamadas.find(([s]) => /^\s*UPDATE/.test(s))[1], ['2026-09-13', 9]);
    assert.ok(conexion.llamadas.some(([s]) => /COUNT\(\*\)/.test(s)));
});

test('mismo orientador es idempotente y no escribe', async () => {
    const conexion = crearConexion({ vigente: [{ id: 9, orientador_usuario_id: 7 }] });
    const modelo = crearModelo({ getConnection: async () => conexion });
    assert.equal((await modelo.reemplazarAsignacionVigente({ grupoId: 1, orientadorUsuarioId: 7, creadoPorUsuarioId: 3 })).resultado, 'SIN_CAMBIOS');
    assert.equal(conexion.llamadas.some(([s]) => /^\s*(UPDATE|INSERT)/.test(s || '')), false);
});

test('fallo de INSERT revierte el cierre previo y libera conexion', async () => {
    const conexion = crearConexion({ vigente: [{ id: 9, orientador_usuario_id: 4 }], fallaInsert: true });
    const modelo = crearModelo({ getConnection: async () => conexion });
    await assert.rejects(modelo.reemplazarAsignacionVigente({ grupoId: 1, orientadorUsuarioId: 7, creadoPorUsuarioId: 3 }));
    assert.ok(conexion.llamadas.some(([s]) => s === 'ROLLBACK'));
    assert.ok(conexion.llamadas.some(([s]) => s === 'RELEASE'));
    assert.equal(conexion.llamadas.some(([s]) => s === 'COMMIT'), false);
});

for (const [nombre, opciones, codigo] of [
    ['usuario inexistente', { usuario: null }, 'ORIENTADOR_NO_ENCONTRADO'],
    ['usuario inactivo', { usuario: { id: 7, activo: 0, rol_clave: 'ORIENTADOR' } }, 'ORIENTADOR_INACTIVO'],
    ['rol incorrecto', { usuario: { id: 7, activo: 1, rol_clave: 'DOCENTE' } }, 'ROL_ORIENTADOR_REQUERIDO'],
    ['grupo inexistente', { grupo: false }, 'GRUPO_NO_ENCONTRADO']
]) test(`${nombre} se rechaza sin INSERT`, async () => {
    const conexion = crearConexion(opciones);
    const modelo = crearModelo({ getConnection: async () => conexion });
    await assert.rejects(modelo.reemplazarAsignacionVigente({ grupoId: 1, orientadorUsuarioId: 7, creadoPorUsuarioId: 3 }), (e) => e.codigo === codigo);
    assert.equal(conexion.llamadas.some(([s]) => /^\s*INSERT/.test(s || '')), false);
});

test('multiples vigentes se reportan como conflicto seguro', async () => {
    const conexion = crearConexion({ vigente: [{ id: 1, orientador_usuario_id: 2 }, { id: 2, orientador_usuario_id: 3 }] });
    const modelo = crearModelo({ getConnection: async () => conexion });
    await assert.rejects(modelo.reemplazarAsignacionVigente({ grupoId: 1, orientadorUsuarioId: 7, creadoPorUsuarioId: 3 }), (e) => e.codigo === 'ESTADO_CONCURRENTE');
});

test('listado de orientadores filtra por clave y estado sin IDs fijos', async () => {
    let consulta;
    const modelo = crearModelo({ execute: async (sql, params) => { consulta = [sql, params]; return [[]]; } });
    await modelo.listarOrientadoresActivos();
    assert.match(consulta[0], /usuarios\.activo = 1/);
    assert.match(consulta[0], /roles\.clave = \?/);
    assert.deepEqual(consulta[1], ['ORIENTADOR']);
    assert.doesNotMatch(consulta[0], /password|hash|sesion/i);
});

test('controlador GET presenta vigente, selector activo e historial', async () => {
    const asignaciones = { buscarVigentePorGrupo: async () => ({ orientador_nombre: 'Persona' }), listarOrientadoresActivos: async () => [{ id: 7 }], listarHistorialPorGrupo: async () => [{ orientador_nombre: 'Persona' }] };
    const controlador = crearControlador({ grupos: { buscarPorIdConTurno: async () => ({ id: 1 }) }, asignaciones, crearMenu: () => [] });
    const res = crearRespuesta();
    await controlador.mostrarAsignacion({ params: { id: '1' }, query: {} }, res);
    assert.equal(res.view, 'admin/grupos/orientador');
    assert.equal(res.locals.orientadores.length, 1);
    assert.equal(res.locals.historial.length, 1);
});

test('controlador GET conserva estado vacio y grupo inexistente da 404', async () => {
    const vacias = { buscarVigentePorGrupo: async () => null, listarOrientadoresActivos: async () => [], listarHistorialPorGrupo: async () => [] };
    let res = crearRespuesta();
    await crearControlador({ grupos: { buscarPorIdConTurno: async () => ({ id: 1 }) }, asignaciones: vacias, crearMenu: () => [] }).mostrarAsignacion({ params: { id: '1' }, query: {} }, res);
    assert.equal(res.locals.vigente, null);
    res = crearRespuesta();
    await crearControlador({ grupos: { buscarPorIdConTurno: async () => null }, asignaciones: vacias }).mostrarAsignacion({ params: { id: '1' }, query: {} }, res);
    assert.equal(res.statusCode, 404);
});

test('POST usa exclusivamente creador de sesion y redirige con indicador seguro', async () => {
    let datos;
    const asignaciones = { reemplazarAsignacionVigente: async (entrada) => { datos = entrada; return { resultado: 'ACTUALIZADA' }; } };
    const res = crearRespuesta();
    await crearControlador({ asignaciones }).guardarAsignacion({ params: { id: '1' }, body: { orientador_usuario_id: '7', creado_por_usuario_id: '999', fecha_inicio: '2000-01-01' }, session: { usuario: { id: 3 } } }, res);
    assert.deepEqual(datos, { grupoId: 1, orientadorUsuarioId: 7, creadoPorUsuarioId: 3 });
    assert.equal(res.redirectTo, '/admin/grupos/1/orientador?actualizado=1');
});

for (const [codigo, estado] of [['GRUPO_NO_ENCONTRADO', 404], ['ORIENTADOR_NO_ENCONTRADO', 422], ['ORIENTADOR_INACTIVO', 422], ['ROL_ORIENTADOR_REQUERIDO', 422], ['ESTADO_CONCURRENTE', 409], ['MYSQL', 503]]) test(`controlador traduce ${codigo} a ${estado}`, async () => {
    const error = codigo === 'MYSQL' ? new Error('interno') : new ErrorAsignacionOrientador(codigo);
    const res = crearRespuesta();
    await crearControlador({ asignaciones: { reemplazarAsignacionVigente: async () => { throw error; } } }).guardarAsignacion({ params: { id: '1' }, body: { orientador_usuario_id: '7' }, session: { usuario: { id: 3 } } }, res);
    assert.equal(res.statusCode, estado);
    assert.doesNotMatch(res.body, /SELECT|INSERT|interno/i);
});

test('IDs invalidos se rechazan con 404 o 422', async () => {
    assert.equal(enteroPositivo('1'), 1);
    assert.equal(enteroPositivo('0'), null);
    let res = crearRespuesta();
    await crearControlador().guardarAsignacion({ params: { id: 'x' }, body: {}, session: {} }, res);
    assert.equal(res.statusCode, 404);
    res = crearRespuesta();
    await crearControlador().guardarAsignacion({ params: { id: '1' }, body: { orientador_usuario_id: '-2' }, session: {} }, res);
    assert.equal(res.statusCode, 422);
});

test('rutas requieren autenticacion y ADMINISTRADOR en GET y POST; CSRF es global', () => {
    const rutas = fs.readFileSync(path.join(__dirname, '../routes/adminGrupoRoutes.js'), 'utf8');
    const app = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    assert.match(rutas, /router\.get\(\s*'\/:id\/orientador',\s*requireAuth,\s*requireRole\('ADMINISTRADOR'\)/);
    assert.match(rutas, /router\.post\(\s*'\/:id\/orientador',\s*requireAuth,\s*requireRole\('ADMINISTRADOR'\)/);
    assert.ok(app.indexOf('app.use(csrfProtection)') < app.indexOf("app.use('/admin/grupos'"));
});

test('vista compila y renderiza estados vigente y vacio con CSRF', () => {
    const archivo = path.join(__dirname, '../views/admin/grupos/orientador.ejs');
    const fuente = fs.readFileSync(archivo, 'utf8');
    ejs.compile(fuente, { filename: archivo });
    const base = { title: 'x', menuItems: [], csrfToken: 'token', usuario: { nombre: 'Admin' }, grupo: { clave: '101', semestre: 1, turno_nombre: 'Matutino', ciclo_escolar: '2026-2027' }, orientadores: [], historial: [], mensaje: null };
    const vacio = ejs.render(fuente, { ...base, vigente: null }, { filename: archivo });
    assert.match(vacio, /todav.a no tiene un orientador asignado/i);
    assert.match(vacio, /name="_csrf" value="token"/);
    const lleno = ejs.render(fuente, { ...base, vigente: { orientador_nombre: '<Persona>', fecha_inicio: '2026-09-13' }, historial: [{ orientador_nombre: '<Persona>', fecha_inicio: '2026-09-13', fecha_fin: null }] }, { filename: archivo });
    assert.match(lleno, /&lt;Persona&gt;/);
    assert.doesNotMatch(lleno, /<Persona>/);
});
