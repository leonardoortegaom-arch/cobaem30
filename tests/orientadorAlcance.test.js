const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { crearModelo } = require('../models/orientadorAlcanceModel');

const leer = (ruta) => fs.readFileSync(path.join(__dirname, '..', ruta), 'utf8');

const cargarModeloConDb = (ruta, db) => {
    const dbRuta = require.resolve('../config/database');
    const modeloRuta = require.resolve(`../${ruta}`);
    const original = require.cache[dbRuta];
    require.cache[dbRuta] = { id: dbRuta, filename: dbRuta, loaded: true, exports: db };
    delete require.cache[modeloRuta];
    const modelo = require(modeloRuta);
    return { modelo, restaurar: () => {
        delete require.cache[modeloRuta];
        if (original) require.cache[dbRuta] = original;
        else delete require.cache[dbRuta];
    } };
};

test('orientador vigente puede acceder al alumno de su grupo', async () => {
    let consulta;
    const modelo = crearModelo({ execute: async (sql, params) => {
        consulta = { sql, params }; return [[{ autorizado: 1 }]];
    } });
    assert.equal(await modelo.puedeAccederAlumno(10, 20), true);
    assert.deepEqual(consulta.params, [10, 20]);
    assert.match(consulta.sql, /asignaciones\.fecha_fin IS NULL/);
    assert.match(consulta.sql, /asignaciones\.grupo_id = alumnos\.grupo_id/);
});

for (const caso of ['sin asignacion', 'asignacion cerrada', 'asignacion de otro orientador']) {
    test(`${caso} no concede acceso`, async () => {
        const modelo = crearModelo({ execute: async () => [[]] });
        assert.equal(await modelo.puedeAccederAlumno(10, 20), false);
    });
}

test('selector de grupos queda limitado al orientador vigente', async () => {
    let consulta;
    const modelo = crearModelo({ execute: async (sql, params) => {
        consulta = { sql, params }; return [[{ id: 1 }]];
    } });
    assert.deepEqual(await modelo.listarGruposVigentes(10), [{ id: 1 }]);
    assert.deepEqual(consulta.params, [10]);
    assert.match(consulta.sql, /fecha_fin IS NULL/);
});

test('listado, conteo y detalle de alumnos incorporan alcance central', () => {
    const fuente = leer('models/alumnoModel.js');
    assert.match(fuente, /asignaciones\.orientador_usuario_id = \?/);
    assert.match(fuente, /asignaciones\.fecha_fin IS NULL/);
    assert.match(fuente, /buscarDetalleParaOrientadorPorUsuarioId = async \(usuarioId, orientadorUsuarioId\)/);
    assert.match(fuente, /const parametros = \[orientadorUsuarioId\]/);
});

test('manipular grupo o filtros no elimina la condición de alcance', () => {
    const fuente = leer('models/alumnoModel.js');
    const condicion = fuente.slice(fuente.indexOf('const construirCondicionesOrientador'), fuente.indexOf('const listarPaginadoParaOrientador'));
    assert.match(condicion, /orientadorUsuarioId/);
    assert.match(condicion, /fecha_fin IS NULL/);
    assert.match(condicion, /alumnos\.grupo_id = \?/);
});

test('detalle de alumno se autoriza antes de recuperar seguimientos y actividades', () => {
    const fuente = leer('controllers/orientadorAlumnoController.js');
    const inicio = fuente.indexOf('const mostrarDetalleAlumno');
    const bloque = fuente.slice(inicio);
    assert.ok(bloque.indexOf('buscarDetalleParaOrientadorPorUsuarioId') < bloque.indexOf('listarRecientesPorAlumno'));
    assert.match(bloque, /req\.session\.usuario\.id/);
});

test('seguimiento usa INSERT SELECT con asignación vigente', () => {
    const fuente = leer('models/seguimientoModel.js');
    assert.match(fuente, /const crearAutorizado/);
    assert.match(fuente, /INSERT INTO seguimientos[\s\S]*SELECT \?[\s\S]*asignaciones\.fecha_fin IS NULL/);
    assert.doesNotMatch(leer('controllers/orientadorSeguimientoController.js'), /seguimientoModel\.crear\(/);
});

test('seguimiento no escribe si la asignación desapareció durante el POST', async () => {
    let consulta;
    const cargado = cargarModeloConDb('models/seguimientoModel.js', { execute: async (sql, params) => {
        consulta = { sql, params }; return [{ affectedRows: 0 }];
    } });
    try {
        const id = await cargado.modelo.crearAutorizado({ alumno_usuario_id: 20,
            orientador_usuario_id: 10, tipo_id: 1, fecha_seguimiento: '2026-09-13',
            titulo: 'Título', descripcion: 'Descripción' });
        assert.equal(id, null);
        assert.match(consulta.sql, /INSERT INTO seguimientos[\s\S]*fecha_fin IS NULL/);
        assert.equal(consulta.params.at(-1), 10);
    } finally { cargado.restaurar(); }
});

test('actividad usa INSERT SELECT y UPDATE condicionado por alcance', () => {
    const fuente = leer('models/actividadOrientacionModel.js');
    assert.match(fuente, /const crearAutorizada/);
    assert.match(fuente, /INSERT INTO actividades_orientacion[\s\S]*asignaciones\.fecha_fin IS NULL/);
    const actualizar = fuente.slice(fuente.indexOf('const actualizarEstadoCondicional'), fuente.indexOf('const obtenerResumenPersonal'));
    assert.match(actualizar, /AND EXISTS/);
    assert.match(actualizar, /asignaciones\.orientador_usuario_id = \?/);
});

test('actividad no se crea para alumno fuera de alcance', async () => {
    const cargado = cargarModeloConDb('models/actividadOrientacionModel.js', {
        execute: async () => [{ affectedRows: 0 }]
    });
    try {
        assert.equal(await cargado.modelo.crearAutorizada({ alumno_usuario_id: 20,
            orientador_usuario_id: 10, estado_id: 1, titulo: 'Actividad',
            instrucciones: 'Detalle', fecha_asignacion: '2026-09-13' }), null);
    } finally { cargado.restaurar(); }
});

test('autoría de actividad se conserva además del alcance', () => {
    const fuente = leer('models/actividadOrientacionModel.js');
    assert.match(fuente, /AND orientador_usuario_id = \?/);
    assert.match(leer('controllers/orientadorActividadController.js'), /es_responsable|orientador_usuario_id/);
});

test('borrador se crea y actualiza con alcance vigente en la escritura', () => {
    const fuente = leer('models/reporteEscritoOrientacionModel.js');
    assert.match(fuente, /const crearBorradorAutorizado/);
    assert.match(fuente, /INSERT INTO reportes_orientacion[\s\S]*asignaciones\.fecha_fin IS NULL/);
    const actualizar = fuente.slice(fuente.indexOf('const actualizarBorradorCondicional'), fuente.indexOf('const listarBorradoresPorAutor'));
    assert.match(actualizar, /AND version = \?/);
    assert.match(actualizar, /AND EXISTS/);
});

test('reporte no se crea para alumno fuera de alcance', async () => {
    const cargado = cargarModeloConDb('models/reporteEscritoOrientacionModel.js', {
        execute: async () => [{ affectedRows: 0 }]
    });
    try {
        const id = await cargado.modelo.crearBorradorAutorizado({ alumnoUsuarioId: 20,
            orientadorUsuarioId: 10, tipoReporteId: 1, estadoId: 1,
            fechaReporte: '2026-09-13', periodoDesde: '2026-09-01',
            periodoHasta: '2026-09-13', motivo: 'Motivo', contenido: 'Contenido',
            conclusiones: null, recomendaciones: null });
        assert.equal(id, null);
    } finally { cargado.restaurar(); }
});

test('reporte ajeno o fuera de alcance se resuelve como 404', () => {
    const fuente = leer('controllers/orientadorReporteEscritoController.js');
    const bloque = fuente.slice(fuente.indexOf('const cargarReporteAutorizado'), fuente.indexOf('const crearDatosDesdeReporte'));
    assert.match(bloque, /buscarAccesoPorId\(reporteId, orientadorId\)/);
    assert.match(bloque, /status\(404\)/);
    assert.doesNotMatch(bloque, /status\(403\)/);
});

test('conflicto de versión permanece 409 si conserva alcance', () => {
    const fuente = leer('controllers/orientadorReporteEscritoController.js');
    assert.match(fuente, /puedeAccederAlumno[\s\S]*status\(404\)[\s\S]*status: 409/);
});

test('información de apoyo valida alumno antes de consultar contenido', () => {
    const fuente = leer('controllers/orientadorReporteController.js');
    const bloque = fuente.slice(fuente.indexOf('const prepararReporte'), fuente.indexOf('const mostrarConfiguracion'));
    assert.ok(bloque.indexOf('buscarDetalleParaOrientadorPorUsuarioId') < bloque.indexOf('obtenerReporteAlumno'));
});

test('PDF no se genera antes de verificar el alcance', () => {
    const fuente = leer('controllers/orientadorReporteController.js');
    const bloque = fuente.slice(fuente.indexOf('const descargarPdf'), fuente.indexOf('module.exports'));
    assert.ok(bloque.indexOf('prepararReporte') < bloque.indexOf('generarPdf'));
});

test('dashboard, panel e historial filtran por asignación abierta', () => {
    assert.match(leer('controllers/orientadorDashboardController.js'), /orientadorUsuarioId: orientador\.id/);
    assert.match(leer('controllers/orientadorPanelSeguimientoController.js'), /req\.session\.usuario\.id/);
    assert.match(leer('models/historialOrientacionModel.js'), /asignaciones\.fecha_fin IS NULL/);
    assert.match(leer('controllers/orientadorHistorialController.js'), /orientadorUsuarioId: req\.session\.usuario\.id/);
});

test('sin grupos tiene dashboard 200 con métricas vacías y mensaje', () => {
    const controlador = leer('controllers/orientadorDashboardController.js');
    const vista = leer('views/dashboards/orientador.ejs');
    assert.match(controlador, /sinGruposAsignados: gruposAsignados\.length === 0/);
    assert.match(vista, /No tienes grupos asignados actualmente/);
});

test('listados de alumnos y reportes explican ausencia de grupos', () => {
    assert.match(leer('views/orientador/alumnos/index.ejs'), /No tienes grupos asignados actualmente/);
    assert.match(leer('views/orientador/reportes/index.ejs'), /No tienes grupos asignados actualmente/);
});

test('ninguna ruta acepta orientadorId desde cliente', () => {
    const rutas = ['routes/orientadorAlumnoRoutes.js', 'routes/orientadorSeguimientoRoutes.js',
        'routes/orientadorReporteRoutes.js', 'routes/orientadorHistorialRoutes.js'];
    for (const ruta of rutas) assert.doesNotMatch(leer(ruta), /orientadorId|orientador_usuario_id/);
});

test('modelos de alcance no contienen asignaciones cerradas como vigentes', () => {
    for (const archivo of ['models/orientadorAlcanceModel.js', 'models/alumnoModel.js',
        'models/seguimientoModel.js', 'models/actividadOrientacionModel.js',
        'models/historialOrientacionModel.js', 'models/reporteEscritoOrientacionModel.js']) {
        assert.match(leer(archivo), /fecha_fin IS NULL/, archivo);
    }
});
