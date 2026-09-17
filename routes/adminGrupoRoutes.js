const express = require('express');

const adminGrupoController = require('../controllers/adminGrupoController');
const adminGrupoOrientadorController = require('../controllers/adminGrupoOrientadorController');
const adminGrupoCalendarioController = require('../controllers/adminGrupoCalendarioController');
const { requireAuth, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get(
    '/:id/calendario',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminGrupoCalendarioController.mostrar
);

router.post(
    '/:id/calendario',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminGrupoCalendarioController.guardar
);

router.get(
    '/nuevo',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminGrupoController.mostrarFormularioCrear
);

router.get(
    '/:id/orientador',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminGrupoOrientadorController.mostrarAsignacion
);

router.post(
    '/:id/orientador',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminGrupoOrientadorController.guardarAsignacion
);

router.get(
    '/:id/editar',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminGrupoController.mostrarFormularioEditar
);

router.post(
    '/:id/editar',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminGrupoController.actualizarGrupo
);

router.get(
    '/:id/estado',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminGrupoController.mostrarConfirmacionEstado
);

router.post(
    '/:id/estado',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminGrupoController.cambiarEstado
);

router.post(
    '/',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminGrupoController.crearGrupo
);

router.get(
    '/',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminGrupoController.listarGrupos
);

module.exports = router;
