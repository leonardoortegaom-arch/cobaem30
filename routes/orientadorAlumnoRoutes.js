const express = require('express');

const orientadorAlumnoController = require('../controllers/orientadorAlumnoController');
const orientadorSeguimientoController = require('../controllers/orientadorSeguimientoController');
const orientadorActividadController = require('../controllers/orientadorActividadController');
const { requireAuth, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get(
    '/',
    requireAuth,
    requireRole('ORIENTADOR'),
    orientadorAlumnoController.listarAlumnos
);

router.get(
    '/:id/seguimientos/nuevo',
    requireAuth,
    requireRole('ORIENTADOR'),
    orientadorSeguimientoController.mostrarFormulario
);

router.get(
    '/:id/seguimientos',
    requireAuth,
    requireRole('ORIENTADOR'),
    orientadorSeguimientoController.listarHistorial
);

router.post(
    '/:id/seguimientos',
    requireAuth,
    requireRole('ORIENTADOR'),
    orientadorSeguimientoController.crearSeguimiento
);

router.get(
    '/:id/actividades/nueva',
    requireAuth,
    requireRole('ORIENTADOR'),
    orientadorActividadController.mostrarFormulario
);

router.post(
    '/:id/actividades',
    requireAuth,
    requireRole('ORIENTADOR'),
    orientadorActividadController.crearActividad
);

router.get(
    '/:id/actividades/:actividadId/estado',
    requireAuth,
    requireRole('ORIENTADOR'),
    orientadorActividadController.mostrarFormularioEstado
);

router.post(
    '/:id/actividades/:actividadId/estado',
    requireAuth,
    requireRole('ORIENTADOR'),
    orientadorActividadController.actualizarEstado
);

router.get(
    '/:id/actividades/:actividadId/evidencias/:adjuntoId/descargar',
    requireAuth,
    requireRole('ORIENTADOR'),
    orientadorActividadController.descargarEvidencia
);

router.get(
    '/:id/actividades/:actividadId',
    requireAuth,
    requireRole('ORIENTADOR'),
    orientadorActividadController.mostrarDetalle
);

router.get(
    '/:id',
    requireAuth,
    requireRole('ORIENTADOR'),
    orientadorAlumnoController.mostrarDetalleAlumno
);

module.exports = router;
