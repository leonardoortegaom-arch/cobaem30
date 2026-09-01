const express = require('express');

const adminUsuarioController = require('../controllers/adminUsuarioController');
const { requireAuth, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get(
    '/nuevo',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminUsuarioController.mostrarFormularioCrear
);

router.get(
    '/:id/editar',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminUsuarioController.mostrarFormularioEditar
);

router.post(
    '/:id/editar',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminUsuarioController.actualizarUsuario
);

router.get(
    '/:id/alumno',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminUsuarioController.mostrarPerfilAlumno
);

router.post(
    '/:id/alumno',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminUsuarioController.actualizarPerfilAlumno
);

router.get(
    '/:id/estado',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminUsuarioController.mostrarConfirmacionEstado
);

router.post(
    '/:id/estado',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminUsuarioController.cambiarEstado
);

router.get(
    '/:id/contrasena',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminUsuarioController.mostrarFormularioPassword
);

router.post(
    '/:id/contrasena',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminUsuarioController.restablecerPassword
);

router.post(
    '/',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminUsuarioController.crearUsuario
);

router.get(
    '/',
    requireAuth,
    requireRole('ADMINISTRADOR'),
    adminUsuarioController.listarUsuarios
);

module.exports = router;
