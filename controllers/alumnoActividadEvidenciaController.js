const fs = require('fs');
const pool = require('../config/database');
const actividadOrientacionModel = require('../models/actividadOrientacionModel');
const adjuntoModel = require('../models/adjuntoActividadOrientacionModel');
const estadoActividadOrientacionModel = require('../models/estadoActividadOrientacionModel');
const storageService = require('../services/adjuntoActividadStorageService');
const { cleanupRequestFiles, MAX_FILES, MAX_FILE_SIZE } = require('../middlewares/actividadEvidenceUploadMiddleware');

const OPEN_STATES = new Set(['PENDIENTE', 'EN_PROCESO', 'RECHAZADA']);
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const CLIENT_STATE_FIELDS = new Set(['estado', 'estado_id', 'estado_clave', 'fecha_realizacion']);

const positiveId = (value) => {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
};

const jsonError = (res, status, message) => res.status(status).json({ resultado: 'error', mensaje: message });
const controlledError = (status, code) => Object.assign(new Error(code), { status, code });

const uploadEvidence = async (req, res) => {
    const activityId = positiveId(req.params.actividadId);
    const studentId = Number(req.session.usuario.id);
    if (!activityId) {
        await cleanupRequestFiles(req);
        return jsonError(res, 404, 'Actividad no encontrada.');
    }
    if (!Array.isArray(req.files) || req.files.length === 0) {
        await cleanupRequestFiles(req);
        return jsonError(res, 422, 'Selecciona al menos un archivo.');
    }
    if (Object.keys(req.body || {}).some((field) => CLIENT_STATE_FIELDS.has(field))) {
        await cleanupRequestFiles(req);
        return jsonError(res, 422, 'La solicitud contiene campos no permitidos.');
    }

    let connection;
    let committed = false;
    const finalPaths = [];
    try {
        const inspections = await Promise.allSettled(req.files.map(storageService.inspectFile));
        const rejected = inspections.find((result) => result.status === 'rejected');
        if (rejected) {
            const error = controlledError(rejected.reason?.status === 415 ? 415 : 500, 'FILE_INSPECTION_FAILED');
            throw error;
        }
        const validated = inspections.map((result) => result.value);
        if (validated.some((file) => !Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_FILE_SIZE)) {
            throw controlledError(413, 'FILE_SIZE_LIMIT');
        }
        const newBytes = validated.reduce((total, file) => total + file.size, 0);

        connection = await pool.getConnection();
        await connection.beginTransaction();
        const activity = await actividadOrientacionModel.bloquearParaEntregaAlumno(connection, activityId, studentId);
        if (!activity) throw controlledError(404, 'ACTIVITY_NOT_FOUND');
        if (!OPEN_STATES.has(activity.estado_clave)) throw controlledError(409, 'ACTIVITY_STATE_CLOSED');
        const completedState = await estadoActividadOrientacionModel.buscarPorClave('REALIZADA', connection);
        if (!completedState) throw controlledError(503, 'COMPLETED_STATE_UNAVAILABLE');
        const usage = await adjuntoModel.obtenerUsoPorActividad(activityId, studentId, connection);
        if (!usage) throw controlledError(404, 'ACTIVITY_NOT_FOUND');
        if (usage.cantidad + validated.length > MAX_FILES || usage.bytes + newBytes > MAX_TOTAL_BYTES) {
            throw controlledError(413, 'ACTIVITY_EVIDENCE_LIMIT');
        }

        for (const file of validated) {
            finalPaths.push(await storageService.moveToFinal(file));
            const inserted = await adjuntoModel.insertarUno(connection, {
                actividadId: activityId,
                subidoPorUsuarioId: studentId,
                nombreOriginal: file.originalName,
                claveAlmacenamiento: file.storageKey,
                extension: file.extension,
                mimeType: file.mimeType,
                tamanoBytes: file.size,
                hashSha256: file.hashSha256
            });
            if (inserted.affectedRows !== 1) throw controlledError(503, 'INCOMPLETE_ATTACHMENT_INSERT');
        }
        const updated = await actividadOrientacionModel.actualizarARealizadaCondicional(connection, {
            actividadId: activityId,
            alumnoUsuarioId: studentId,
            estadoIdAnterior: activity.estado_id,
            estadoIdRealizada: completedState.id
        });
        if (updated.affectedRows !== 1) throw controlledError(409, 'CONCURRENT_ACTIVITY_CHANGE');
        const finalState = await actividadOrientacionModel.confirmarEstadoAlumno(connection, activityId, studentId);
        if (!finalState || finalState.estado_clave !== 'REALIZADA' || !finalState.fecha_realizacion) {
            throw controlledError(503, 'FINAL_STATE_VERIFICATION_FAILED');
        }
        await connection.commit();
        committed = true;
        return res.status(201).json({
            resultado: 'ok',
            cantidadCargada: validated.length,
            mensaje: 'La evidencia se envió correctamente.'
        });
    } catch (error) {
        if (connection && !committed) await connection.rollback().catch(() => {});
        if (!committed) {
            await Promise.all([storageService.cleanupFiles(finalPaths), cleanupRequestFiles(req)]);
        }
        if (committed) {
            if (!res.headersSent) return jsonError(res, 500, 'La evidencia fue guardada; recarga la actividad.');
            return undefined;
        }
        if (error.status === 404) return jsonError(res, 404, 'Actividad no encontrada.');
        if (error.status === 409) return jsonError(res, 409, 'La actividad cambió o ya no admite evidencias.');
        if (error.status === 413) return jsonError(res, 413, 'La carga supera el máximo de 5 archivos, 50 MB por archivo o 100 MB por actividad.');
        if (error.status === 415) return jsonError(res, 415, 'Uno o más archivos no tienen un formato permitido o su firma no es válida.');
        if (error.status === 503) return jsonError(res, 503, 'No fue posible guardar las evidencias. Inténtalo nuevamente.');
        if (error.code && (error.code.startsWith('ER_') || error.code === 'PROTOCOL_CONNECTION_LOST')) {
            return jsonError(res, 503, 'No fue posible guardar las evidencias. Inténtalo nuevamente.');
        }
        return jsonError(res, 500, 'No fue posible almacenar las evidencias.');
    } finally {
        if (connection) connection.release();
    }
};

const downloadEvidence = async (req, res) => {
    const activityId = positiveId(req.params.actividadId);
    const attachmentId = positiveId(req.params.adjuntoId);
    if (!activityId || !attachmentId) {
        res.status(404).send('Evidencia no encontrada.');
        return;
    }
    try {
        const attachment = await adjuntoModel.buscarParaDescarga(
            attachmentId,
            activityId,
            Number(req.session.usuario.id)
        );
        if (!attachment) {
            res.status(404).send('Evidencia no encontrada.');
            return;
        }
        let stored;
        try {
            stored = await storageService.getDownloadFile({
                storageKey: attachment.clave_almacenamiento,
                extension: attachment.extension
            });
        } catch {
            res.status(404).send('El archivo solicitado no está disponible.');
            return;
        }
        res.set({
            'Content-Type': attachment.mime_type,
            'Content-Length': String(stored.size),
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff'
        });
        res.attachment(storageService.sanitizeOriginalName(attachment.nombre_original));
        const stream = fs.createReadStream(stored.filePath);
        stream.on('error', () => {
            if (!res.headersSent) res.status(500).send('No fue posible descargar la evidencia.');
            else res.destroy();
        });
        stream.pipe(res);
    } catch {
        res.status(503).send('No fue posible consultar la evidencia. Inténtalo nuevamente.');
    }
};

const deleteEvidence = async (req, res) => {
    const activityId = positiveId(req.params.actividadId);
    const attachmentId = positiveId(req.params.adjuntoId);
    const studentId = Number(req.session.usuario.id);
    if (!activityId || !attachmentId) {
        res.status(404).send('Evidencia no encontrada.');
        return;
    }

    let connection;
    let discarded;
    let committed = false;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        const attachment = await adjuntoModel.buscarParaEliminar(
            attachmentId,
            activityId,
            studentId,
            studentId,
            connection
        );
        if (!attachment) {
            await connection.rollback();
            res.status(404).send('Evidencia no encontrada.');
            return;
        }
        if (!OPEN_STATES.has(attachment.estado_clave)) {
            await connection.rollback();
            res.status(409).send('La actividad está cerrada y sus evidencias son de solo lectura.');
            return;
        }
        try {
            discarded = await storageService.moveToDiscard({
                storageKey: attachment.clave_almacenamiento,
                extension: attachment.extension
            });
        } catch {
            await connection.rollback();
            res.status(500).send('No fue posible eliminar la evidencia.');
            return;
        }
        const result = await adjuntoModel.eliminarCondicional(connection, {
            adjuntoId: attachmentId,
            actividadId: activityId,
            alumnoUsuarioId: studentId,
            subidoPorUsuarioId: studentId
        });
        if (result.affectedRows !== 1) {
            const error = new Error('CONCURRENT_ATTACHMENT_CHANGE');
            error.status = 409;
            throw error;
        }
        await connection.commit();
        committed = true;
        await storageService.removeFile(discarded.destination).catch(() => {});
        res.redirect(`/alumno/actividades/${activityId}?evidencia=eliminada`);
    } catch (error) {
        if (connection && !committed) await connection.rollback().catch(() => {});
        if (discarded && !committed) await storageService.restoreFromDiscard(discarded).catch(() => {});
        if (error.status === 409) {
            res.status(409).send('La evidencia cambió. Recarga la página e inténtalo nuevamente.');
            return;
        }
        res.status(503).send('No fue posible eliminar la evidencia. Inténtalo nuevamente.');
    } finally {
        if (connection) connection.release();
    }
};

module.exports = { uploadEvidence, downloadEvidence, deleteEvidence, MAX_TOTAL_BYTES };
