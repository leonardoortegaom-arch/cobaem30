'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function loadWithMocks(target, mocks) {
    const saved = new Map();
    for (const [request, value] of Object.entries(mocks)) {
        const resolved = require.resolve(path.join(root, request));
        saved.set(resolved, require.cache[resolved]);
        require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: value };
    }
    const resolvedTarget = require.resolve(path.join(root, target));
    saved.set(resolvedTarget, require.cache[resolvedTarget]);
    delete require.cache[resolvedTarget];
    const loaded = require(resolvedTarget);
    return {
        loaded,
        restore() {
            for (const [resolved, original] of saved) {
                delete require.cache[resolved];
                if (original) require.cache[resolved] = original;
            }
        }
    };
}

const response = ({ throwOnJson = false } = {}) => ({
    statusCode: 200, body: null, redirectTo: null, headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { if (throwOnJson) throw new Error('response failure'); this.body = body; return this; },
    send(body) { this.body = body; return this; }, redirect(url) { this.redirectTo = url; return this; },
    set() { return this; }, attachment() { return this; }, destroy() {}
});

function uploadHarness({ state = 'PENDIENTE', insertRows = 1, updateRows = 1, failCommit = false,
    finalState = 'REALIZADA', activity = true, throwOnJson = false, body = {}, inspectError = null } = {}) {
    const calls = { begin: 0, commit: 0, rollback: 0, release: 0, moved: [], cleaned: [], requestCleanup: 0, inserted: [], updated: [] };
    const connection = {
        async beginTransaction() { calls.begin += 1; },
        async commit() { calls.commit += 1; if (failCommit) throw new Error('commit failed'); },
        async rollback() { calls.rollback += 1; },
        release() { calls.release += 1; }
    };
    const pool = { async getConnection() { return connection; } };
    const activityModel = {
        async bloquearParaEntregaAlumno(conn, id, student) {
            calls.lock = { conn, id, student };
            return activity ? { id, estado_id: 7, estado_clave: state } : null;
        },
        async actualizarARealizadaCondicional(conn, data) { calls.updated.push({ conn, data }); return { affectedRows: updateRows }; },
        async confirmarEstadoAlumno() { return { estado_clave: finalState, fecha_realizacion: finalState === 'REALIZADA' ? '2026-09-27' : null }; }
    };
    const attachmentModel = {
        async obtenerUsoPorActividad() { return { cantidad: 0, bytes: 0, estadoClave: state }; },
        async insertarUno(conn, data) { calls.inserted.push({ conn, data }); return { affectedRows: insertRows }; }
    };
    const stateModel = { async buscarPorClave(key, conn) { calls.stateLookup = { key, conn }; return { id: 3, clave: key, activo: 1 }; } };
    const storage = {
        async inspectFile(file) { if (inspectError) throw Object.assign(new Error('invalid'), { status: inspectError }); return { tempPath: file.path, originalName: file.originalname, size: file.size,
            mimeType: 'application/pdf', extension: 'pdf', hashSha256: 'a'.repeat(64), storageKey: `key-${file.originalname}` }; },
        async moveToFinal(file) { const final = `final/${file.storageKey}.${file.extension}`; calls.moved.push(final); return final; },
        async cleanupFiles(paths) { calls.cleaned.push(...paths); },
        async moveToDiscard() {}, async restoreFromDiscard() {}, async removeFile() {}, async getDownloadFile() {}, sanitizeOriginalName: (x) => x
    };
    const middleware = { MAX_FILES: 5, MAX_FILE_SIZE: 50 * 1024 * 1024,
        async cleanupRequestFiles() { calls.requestCleanup += 1; } };
    const module = loadWithMocks('controllers/alumnoActividadEvidenciaController.js', {
        'config/database.js': pool,
        'models/actividadOrientacionModel.js': activityModel,
        'models/adjuntoActividadOrientacionModel.js': attachmentModel,
        'models/estadoActividadOrientacionModel.js': stateModel,
        'services/adjuntoActividadStorageService.js': storage,
        'middlewares/actividadEvidenceUploadMiddleware.js': middleware
    });
    const req = { params: { actividadId: '12' }, body, files: [
        { path: 'temp/a', originalname: 'uno.pdf', size: 100 },
        { path: 'temp/b', originalname: 'dos.pdf', size: 200 }
    ], session: { usuario: { id: 44, rol: 'ALUMNO' } } };
    return { ...module, calls, req, res: response({ throwOnJson }) };
}

test('01 selección no inicia carga y el envío ocurre solo por clic', () => {
    const script = read('public/js/alumnoActivityEvidence.js');
    assert.match(script, /input\.addEventListener\('change',[\s\S]*setFiles\(input\.files\)/);
    assert.match(script, /submit\.addEventListener\('click',[\s\S]*request\.send\(body\)/);
    const changeBlock = script.slice(script.indexOf("input.addEventListener('change'"), script.indexOf("dropzone.addEventListener('keydown'"));
    assert.doesNotMatch(changeBlock, /send\(|XMLHttpRequest/);
});

test('02 vista usa botón explícito inicialmente deshabilitado y no ofrece estado', () => {
    const view = read('views/alumno/actividades/detalle.ejs');
    assert.match(view, /id="student-activity-evidence-submit"[^>]*disabled>Enviar evidencia</);
    assert.doesNotMatch(view, /name="estado(?:_id|_clave)?"/);
});

test('03 rutas de evidencia requieren ALUMNO y no existe endpoint de estado del alumno', () => {
    const routes = read('routes/alumnoActividadRoutes.js');
    assert.match(routes, /post\('\/:actividadId\/evidencias'[\s\S]*requireRole\('ALUMNO'\)/);
    assert.doesNotMatch(routes, /actividadId\/estado/);
    assert.doesNotMatch(read('routes/orientadorAlumnoRoutes.js'), /DOCENTE/);
    assert.match(read('index.js'), /app\.use\(csrfProtection\)[\s\S]*app\.use\('\/alumno\/actividades'/);
});

for (const [number, state] of [[4, 'PENDIENTE'], [5, 'EN_PROCESO'], [6, 'RECHAZADA']]) {
    test(`${number} ${state} permite envío atómico y termina REALIZADA`, async () => {
        const h = uploadHarness({ state });
        try {
            await h.loaded.uploadEvidence(h.req, h.res);
            assert.equal(h.res.statusCode, 201);
            assert.equal(h.calls.lock.student, 44);
            assert.equal(h.calls.inserted.length, 2);
            assert.equal(h.calls.updated.length, 1);
            assert.equal(h.calls.updated[0].data.estadoIdAnterior, 7);
            assert.equal(h.calls.stateLookup.key, 'REALIZADA');
            assert.equal(h.calls.commit, 1);
            assert.equal(h.calls.rollback, 0);
            assert.equal(h.calls.release, 1);
        } finally { h.restore(); }
    });
}

for (const [number, state] of [[7, 'REALIZADA'], [8, 'NO_REALIZADA'], [9, 'CANCELADA']]) {
    test(`${number} ${state} bloquea nuevos adjuntos`, async () => {
        const h = uploadHarness({ state });
        try {
            await h.loaded.uploadEvidence(h.req, h.res);
            assert.equal(h.res.statusCode, 409);
            assert.equal(h.calls.inserted.length, 0);
            assert.equal(h.calls.updated.length, 0);
            assert.equal(h.calls.rollback, 1);
        } finally { h.restore(); }
    });
}

test('10 identidad proviene de sesión y actividad ajena devuelve 404', async () => {
    const h = uploadHarness({ activity: false });
    h.req.query = { alumnoId: '999' }; h.req.body.alumnoId = '999';
    try {
        await h.loaded.uploadEvidence(h.req, h.res);
        assert.equal(h.calls.lock.student, 44);
        assert.equal(h.res.statusCode, 404);
        assert.equal(h.calls.inserted.length, 0);
    } finally { h.restore(); }
});

test('11 campos de estado manipulados se rechazan sin conexión ni escritura', async () => {
    const h = uploadHarness({ body: { estado_id: '3' } });
    try {
        await h.loaded.uploadEvidence(h.req, h.res);
        assert.equal(h.res.statusCode, 422);
        assert.equal(h.calls.begin, 0);
        assert.equal(h.calls.inserted.length, 0);
        assert.equal(h.calls.requestCleanup, 1);
    } finally { h.restore(); }
});

test('11b archivo inválido no inicia transacción, no inserta y no cambia estado', async () => {
    const h = uploadHarness({ inspectError: 415 });
    try {
        await h.loaded.uploadEvidence(h.req, h.res);
        assert.equal(h.res.statusCode, 415);
        assert.equal(h.calls.begin, 0);
        assert.equal(h.calls.inserted.length, 0);
        assert.equal(h.calls.updated.length, 0);
        assert.equal(h.calls.requestCleanup, 1);
    } finally { h.restore(); }
});

for (const [number, options, expected] of [
    [12, { insertRows: 0 }, 'inserción'],
    [13, { updateRows: 0 }, 'actualización'],
    [14, { failCommit: true }, 'commit'],
    [15, { finalState: 'RECHAZADA' }, 'postcondición']
]) test(`${number} fallo de ${expected} revierte y limpia archivos`, async () => {
    const h = uploadHarness(options);
    try {
        await h.loaded.uploadEvidence(h.req, h.res);
        assert.equal(h.calls.rollback, 1);
        assert.equal(h.calls.cleaned.length > 0, true);
        assert.equal(h.calls.requestCleanup, 1);
    } finally { h.restore(); }
});

test('16 error posterior al commit no revierte ni elimina archivos confirmados', async () => {
    const h = uploadHarness({ throwOnJson: true });
    try {
        await assert.rejects(() => h.loaded.uploadEvidence(h.req, h.res));
        assert.equal(h.calls.commit, 1);
        assert.equal(h.calls.rollback, 0);
        assert.equal(h.calls.cleaned.length, 0);
        assert.equal(h.calls.requestCleanup, 0);
    } finally { h.restore(); }
});

test('17 límites, firma, hash y nombres saneados permanecen en el flujo', () => {
    assert.match(read('middlewares/actividadEvidenceUploadMiddleware.js'), /MAX_FILES = 5[\s\S]*MAX_FILE_SIZE = 50 \* 1024 \* 1024/);
    const storage = read('services/adjuntoActividadStorageService.js');
    assert.match(storage, /fileTypeFromFile/); assert.match(storage, /hashSha256/); assert.match(storage, /sanitizeOriginalName/);
    assert.match(read('controllers/alumnoActividadEvidenciaController.js'), /MAX_TOTAL_BYTES = 100 \* 1024 \* 1024/);
});

test('18 RECHAZADA permite eliminar y estados cerrados quedan bloqueados', () => {
    const controller = read('controllers/alumnoActividadEvidenciaController.js');
    const model = read('models/adjuntoActividadOrientacionModel.js');
    assert.match(controller, /OPEN_STATES = new Set\(\['PENDIENTE', 'EN_PROCESO', 'RECHAZADA'\]\)/);
    assert.match(model, /estados\.clave IN \(\?, \?, \?\)[\s\S]*'PENDIENTE', 'EN_PROCESO', 'RECHAZADA'/);
});

test('19 modelo rechaza REALIZADA solo por autor vigente y limpia fecha', async () => {
    let query;
    const db = { execute: async (sql, params) => { query = { sql, params }; return [{ affectedRows: 1 }]; } };
    const module = loadWithMocks('models/actividadOrientacionModel.js', { 'config/database.js': db });
    try {
        const result = await module.loaded.rechazarRealizadaAutorizada({ actividadId: 1, alumnoUsuarioId: 2, orientadorUsuarioId: 3 });
        assert.equal(result.affectedRows, 1);
        assert.match(query.sql, /estado_actual\.clave = \?/);
        assert.match(query.sql, /estado_destino\.clave = \?/);
        assert.match(query.sql, /fecha_realizacion = NULL/);
        assert.match(query.sql, /actividades\.orientador_usuario_id = \?/);
        assert.match(query.sql, /asignaciones\.fecha_fin IS NULL/);
        assert.deepEqual(query.params.slice(0, 2), ['REALIZADA', 'RECHAZADA']);
    } finally { module.restore(); }
});

function orientadorHarness({ author = 9, affectedRows = 1, scope = true } = {}) {
    const calls = { reject: 0 };
    const activity = { id: 12, titulo: 'A', instrucciones: 'B', fecha_asignacion: '2026-09-20',
        fecha_realizacion: '2026-09-27', estado_id: 3, estado_clave: 'REALIZADA', estado_nombre: 'Realizada', orientador_usuario_id: author };
    const module = loadWithMocks('controllers/orientadorActividadController.js', {
        'models/alumnoModel.js': { buscarDetalleParaOrientadorPorUsuarioId: async () => ({ usuario_activo: 1, nombre_completo: 'Alumno', matricula: 'x', grupo_clave: '1', semestre: 1, turno_nombre: 'M', ciclo_escolar: 'x' }) },
        'models/estadoActividadOrientacionModel.js': { buscarPorClaves: async () => [{ clave: 'RECHAZADA', nombre: 'Rechazada' }] },
        'models/actividadOrientacionModel.js': { buscarPorIdYAlumnoConEstado: async () => activity,
            rechazarRealizadaAutorizada: async () => { calls.reject += 1; return { affectedRows }; } },
        'models/adjuntoActividadOrientacionModel.js': {},
        'models/orientadorAlcanceModel.js': { puedeAccederAlumno: async () => scope },
        'services/adjuntoActividadStorageService.js': {},
        'config/roleMenus.js': () => []
    });
    return { ...module, calls, req: { params: { id: '2', actividadId: '12' }, body: { estado: 'RECHAZADA' }, session: { usuario: { id: 9, rol: 'ORIENTADOR' } } }, res: response() };
}

test('20 orientador autor puede REALIZADA a RECHAZADA', async () => {
    const h = orientadorHarness(); try { await h.loaded.actualizarEstado(h.req, h.res); assert.equal(h.calls.reject, 1); assert.match(h.res.redirectTo, /estado-actualizado/); } finally { h.restore(); }
});
test('21 otro orientador no puede rechazar', async () => {
    const h = orientadorHarness({ author: 8 }); try { await h.loaded.actualizarEstado(h.req, h.res); assert.equal(h.res.statusCode, 403); assert.equal(h.calls.reject, 0); } finally { h.restore(); }
});
test('22 pérdida de asignación vigente devuelve 404 y concurrencia conservando alcance devuelve 409', async () => {
    const noScope = orientadorHarness({ affectedRows: 0, scope: false });
    try { await noScope.loaded.actualizarEstado(noScope.req, noScope.res); assert.equal(noScope.res.statusCode, 404); } finally { noScope.restore(); }
    const conflict = orientadorHarness({ affectedRows: 0, scope: true });
    try { await conflict.loaded.actualizarEstado(conflict.req, conflict.res); assert.equal(conflict.res.statusCode, 409); } finally { conflict.restore(); }
});

test('23 interfaz, filtros y badges incluyen RECHAZADA sin transición manual a REALIZADA', () => {
    assert.match(read('views/alumno/actividades/index.ejs'), /resumen\.rechazadas[\s\S]*value="RECHAZADA"/);
    assert.match(read('views/alumno/actividades/detalle.ejs'), /La evidencia requiere correcciones[\s\S]*Evidencia enviada/);
    assert.match(read('public/css/styles.css'), /state-rechazada/);
    const transitions = read('controllers/orientadorActividadController.js');
    assert.match(transitions, /REALIZADA: Object\.freeze\(\['RECHAZADA'\]\)/);
    assert.match(transitions, /RECHAZADA: Object\.freeze\(\[\]\)/);
});

test('24 descarga sigue autorizada y archivos son privados', () => {
    assert.match(read('models/adjuntoActividadOrientacionModel.js'), /buscarParaDescarga[\s\S]*actividades\.alumno_usuario_id = \?/);
    assert.match(read('services/adjuntoActividadStorageService.js'), /'storage', 'private', 'orientation-activity-attachments'/);
});

test('25 no se conceden permisos a DOCENTE ni se mezclan tareas académicas', () => {
    const routes = read('routes/alumnoActividadRoutes.js') + read('routes/orientadorAlumnoRoutes.js');
    assert.doesNotMatch(routes, /requireRole\('DOCENTE'\)/);
    assert.doesNotMatch(routes, /tareas|materias|clases_programadas/i);
});

test('26 diagnóstico seguro informa solo etapa y código técnico', () => {
    const h = uploadHarness();
    try {
        const lines = [];
        h.loaded.logSafeEvidenceFailure('EVIDENCE_STAGE_STATE_UPDATE', {
            code: 'ER_CHECK_CONSTRAINT_VIOLATED', sql: 'UPDATE secreto',
            message: 'ruta privada y credencial secreta', stack: 'dato sensible'
        }, (line) => lines.push(line));
        assert.deepEqual(lines, ['EVIDENCE_STAGE_STATE_UPDATE CODE=ER_CHECK_CONSTRAINT_VIOLATED']);
        assert.doesNotMatch(lines[0], /ruta|credencial|sensible|\bsql\b/i);
    } finally { h.restore(); }
});

test('27 una actividad futura no se rechaza en aplicación por fecha programada', async () => {
    const h = uploadHarness({ state: 'PENDIENTE' });
    h.req.fecha_asignacion = '2099-12-31';
    try {
        await h.loaded.uploadEvidence(h.req, h.res);
        assert.equal(h.res.statusCode, 201);
        assert.equal(h.calls.updated.length, 1);
        assert.equal(h.calls.commit, 1);
    } finally { h.restore(); }
});
