const express = require('express');
const alumnoMateriaController = require('../controllers/alumnoMateriaController');
const { requireAuth, requireRole } = require('../middlewares/authMiddleware');
const router = express.Router();

router.get('/', requireAuth, requireRole('ALUMNO'), alumnoMateriaController.listar);

module.exports = router;
