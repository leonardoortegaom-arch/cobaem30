const multer = require('multer');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, callback) => callback(/\.(xlsx|xls)$/i.test(file.originalname) ? null : new Error('FORMAT_EXCEL'), true)
});

module.exports = (req, res, next) => upload.single('archivo')(req, res, (error) => {
    if (!error) return next();
    return res.status(422).send('Selecciona un archivo Excel válido (.xlsx o .xls).');
});