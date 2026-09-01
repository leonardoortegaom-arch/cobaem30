const express = require('express');

const orientadorReporteController = require('../controllers/orientadorReporteController');
const orientadorReporteEscritoController = require('../controllers/orientadorReporteEscritoController');
const { requireAuth, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/', requireAuth, requireRole('ORIENTADOR'), orientadorReporteController.listarAlumnos);
router.get(
    '/:reporteId/editar',
    requireAuth,
    requireRole('ORIENTADOR'),
    orientadorReporteEscritoController.mostrarEditar
);
router.post(
    '/:reporteId/editar',
    requireAuth,
    requireRole('ORIENTADOR'),
    orientadorReporteEscritoController.actualizarBorrador
);
router.get(
    '/alumnos/:id/vista-previa',
    requireAuth,
    requireRole('ORIENTADOR'),
    orientadorReporteController.mostrarVistaPrevia
);
router.get(
    '/alumnos/:id/pdf',
    requireAuth,
    requireRole('ORIENTADOR'),
    orientadorReporteController.descargarPdf
);
router.get(
    '/alumnos/:id',
    requireAuth,
    requireRole('ORIENTADOR'),
    orientadorReporteEscritoController.mostrarNuevo
);
router.post(
    '/alumnos/:id',
    requireAuth,
    requireRole('ORIENTADOR'),
    orientadorReporteEscritoController.crearBorrador
);

module.exports = router;
