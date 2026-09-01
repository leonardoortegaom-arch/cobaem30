const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const storageService = require('../services/adjuntoActividadStorageService');

const MAX_FILES = 5;
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const storage = multer.diskStorage({
    destination: async (req, file, callback) => {
        try {
            await storageService.ensureDirectories();
            callback(null, storageService.tempDirectory);
        } catch (error) {
            callback(error);
        }
    },
    filename: (req, file, callback) => callback(null, `${crypto.randomUUID()}.upload`)
});

const upload = multer({
    storage,
    limits: {
        files: MAX_FILES,
        fileSize: MAX_FILE_SIZE,
        fields: 2,
        parts: MAX_FILES + 2
    }
}).array('evidencias', MAX_FILES);

const cleanupRequestFiles = async (req) => {
    const paths = Array.isArray(req.files) ? req.files.map((file) => file.path) : [];
    await storageService.cleanupFiles(paths);
};

const evidenceUpload = (req, res, next) => {
    upload(req, res, async (error) => {
        if (!error) {
            next();
            return;
        }
        await cleanupRequestFiles(req);
        if (error instanceof multer.MulterError) {
            if (error.code === 'LIMIT_FILE_SIZE' || error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_PART_COUNT') {
                res.status(413).json({ resultado: 'error', mensaje: 'El lote supera los límites permitidos.' });
                return;
            }
            res.status(422).json({ resultado: 'error', mensaje: 'No fue posible procesar los archivos seleccionados.' });
            return;
        }
        res.status(500).json({ resultado: 'error', mensaje: 'No fue posible preparar el almacenamiento.' });
    });
};

module.exports = { evidenceUpload, cleanupRequestFiles, MAX_FILES, MAX_FILE_SIZE };
