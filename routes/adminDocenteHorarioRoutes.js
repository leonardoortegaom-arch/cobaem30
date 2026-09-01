const express = require('express');
const controller = require('../controllers/adminDocenteHorarioController');
const upload = require('../middlewares/docenteHorarioUploadMiddleware');
const { requireAuth, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();
const adminOnly = [requireAuth, requireRole('ADMINISTRADOR')];

router.get('/:id/horario', ...adminOnly, controller.mostrar);
router.post('/:id/horario', ...adminOnly, upload, controller.importar);
router.post('/:id/horario/eliminar', ...adminOnly, controller.eliminar);

module.exports = router;