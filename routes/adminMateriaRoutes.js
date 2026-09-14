const express = require('express');
const adminMateriaController = require('../controllers/adminMateriaController');
const { requireAuth, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();
const proteger = [requireAuth, requireRole('ADMINISTRADOR')];

router.get('/nuevo', ...proteger, adminMateriaController.mostrarNueva);
router.get('/:id/editar', ...proteger, adminMateriaController.mostrarEditar);
router.post('/:id/editar', ...proteger, adminMateriaController.actualizar);
router.get('/:id/estado', ...proteger, adminMateriaController.mostrarEstado);
router.post('/:id/estado', ...proteger, adminMateriaController.actualizarEstado);
router.post('/', ...proteger, adminMateriaController.crear);
router.get('/', ...proteger, adminMateriaController.listar);

module.exports = router;
