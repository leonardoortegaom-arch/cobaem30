const multer = require('multer');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, callback) => {
        const allowed = /\.(xlsx|xls)$/i.test(file.originalname);
        callback(allowed ? null : new Error('FORMAT_EXCEL'), allowed);
    }
});

const grupoHorarioUpload = (req, res, next) => {
    upload.single('archivo')(req, res, (error) => {
        if (!error) {
            next();
            return;
        }
        res.status(422).send('Selecciona un archivo Excel válido (.xlsx o .xls).');
    });
};

module.exports = grupoHorarioUpload;