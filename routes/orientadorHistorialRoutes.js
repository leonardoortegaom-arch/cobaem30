const express = require('express');

const orientadorHistorialController = require('../controllers/orientadorHistorialController');
const { requireAuth, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get(
    '/',
    requireAuth,
    requireRole('ORIENTADOR'),
    orientadorHistorialController.listarHistorial
);

module.exports = router;
