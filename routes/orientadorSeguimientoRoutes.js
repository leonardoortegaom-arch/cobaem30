const express = require('express');

const orientadorPanelSeguimientoController = require('../controllers/orientadorPanelSeguimientoController');
const { requireAuth, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get(
    '/',
    requireAuth,
    requireRole('ORIENTADOR'),
    orientadorPanelSeguimientoController.mostrarPanel
);

module.exports = router;
