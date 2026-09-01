const fs = require('fs');
const pool = require('../config/database');
const actividadOrientacionModel = require('../models/actividadOrientacionModel');
const adjuntoModel = require('../models/adjuntoActividadOrientacionModel');
const storageService = require('../services/adjuntoActividadStorageService');
const { cleanupRequestFiles, MAX_FILES } = require('../middlewares/actividadEvidenceUploadMiddleware');

const OPEN_STATES = new Set(['PENDIENTE', 'EN_PROCESO']);
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

const positiveId = (value) => {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
};

const jsonError = (res, status, message) => res.status(status).json({ resultado: 'error', mensaje: message });

const uploadEvidence = async (req, res) => {
    const activityId = positiveId(req.params.actividadId);
    const studentId = Number(req.session.usuario.id);
    if (!activityId) {
        await cleanupRequestFiles(req);
        jsonError(res, 404, 'Actividad no encontrada.');
        return;
    }
    if (!Array.isArray(req.files) || req.files.length === 0) {
        jsonError(res, 422, 'Selecciona al menos un archivo.');
        return;
    }

    let connection;
    const finalPaths = [];
    try {
        const inspections = await Promise.allSettled(req.files.map(storageService.inspectFile));
        const rejected = inspections.find((result) => result.status === 'rejected');
        if (rejected) {
            await cleanupRequestFiles(req);
            const status = rejected.reason?.status === 415 ? 415 : 500;
            jsonError(res, status, status === 415
                ? 'Uno o más archivos no tienen un formato permitido o su firma no es válida.'
                : 'No fue posible validar los archivos seleccionados.');
            return;
        }
        const validated = inspections.map((result) => result.value);
        const newBytes = validated.reduce((total, file) => total + file.size, 0);

        connection = await pool.getConnection();
        await connection.beginTransaction();
        const usage = await adjuntoModel.obtenerUsoPorActividad(activityId, studentId, connection, { bloquear: true });
        if (!usage) {
            await connection.rollback();
            await cleanupRequestFiles(req);
            jsonError(res, 404, 'Actividad no encontrada.');
            return;
        }
        if (!OPEN_STATES.has(usage.estadoClave)) {
            await connection.rollback();
            await cleanupRequestFiles(req);
            jsonError(res, 409, 'La actividad está cerrada y no admite nuevas evidencias.');
            return;
        }
        if (usage.cantidad + validated.length > MAX_FILES || usage.bytes + newBytes > MAX_TOTAL_BYTES) {
            await connection.rollback();
            await cleanupRequestFiles(req);
            jsonError(res, 413, 'La carga supera el máximo de 5 archivos o 100 MB por actividad.');
            return;
        }

        for (const file of validated) {
            finalPaths.push(await storageService.moveToFinal(file));
        }
        const result = await adjuntoModel.insertarVarios(connection, validated.map((file) => ({
            actividadId: activityId,
            subidoPorUsuarioId: studentId,
            nombreOriginal: file.originalName,
            claveAlmacenamiento: file.storageKey,
            extension: file.extension,
            mimeType: file.mimeType,
            tamanoBytes: file.size,
            hashSha256: file.hashSha256
        })));
        if (result.affectedRows !== validated.length) throw new Error('INCOMPLETE_ATTACHMENT_INSERT');
        await connection.commit();
        res.status(201).json({
            resultado: 'ok',
            cantidadCargada: validated.length,
            mensaje: 'Las evidencias se adjuntaron correctamente.'
        });
    } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        await Promise.all([
            storageService.cleanupFiles(finalPaths),
            cleanupRequestFiles(req)
        ]);
        if (error.code && (error.code.startsWith('ER_') || error.code === 'PROTOCOL_CONNECTION_LOST')) {
            jsonError(res, 503, 'No fue posible guardar las evidencias. Inténtalo nuevamente.');
            return;
        }
        jsonError(res, 500, 'No fue posible almacenar las evidencias.');
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
