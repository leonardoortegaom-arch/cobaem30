const express = require('express');
const dashboardController = require('../controllers/dashboardController');
const orientadorDashboardController = require('../controllers/orientadorDashboardController');
const { requireAuth, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get(
    '/dashboard/admin',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    dashboardController.mostrarAdministrador
);

router.get(
    '/dashboard/docente',
    requireAuth,
    requireRole('DOCENTE'),
    dashboardController.mostrarDocente
);

router.get(
    '/dashboard/alumno',
    requireAuth,
    requireRole('ALUMNO'),
    dashboardController.mostrarAlumno
);

router.get(
    '/dashboard/orientador',
    requireAuth,
    requireRole('ORIENTADOR'),
    orientadorDashboardController.mostrarDashboard
);

module.exports = router;
