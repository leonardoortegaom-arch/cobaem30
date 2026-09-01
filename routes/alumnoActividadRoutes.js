const express = require('express');
const alumnoActividadController = require('../controllers/alumnoActividadController');
const alumnoActividadEvidenciaController = require('../controllers/alumnoActividadEvidenciaController');
const { evidenceUpload } = require('../middlewares/actividadEvidenceUploadMiddleware');
const { requireAuth, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/', requireAuth, requireRole('ALUMNO'), alumnoActividadController.listarActividades);
router.post('/:actividadId/evidencias', requireAuth, requireRole('ALUMNO'), evidenceUpload, alumnoActividadEvidenciaController.uploadEvidence);
router.get('/:actividadId/evidencias/:adjuntoId/descargar', requireAuth, requireRole('ALUMNO'), alumnoActividadEvidenciaController.downloadEvidence);
router.post('/:actividadId/evidencias/:adjuntoId/eliminar', requireAuth, requireRole('ALUMNO'), alumnoActividadEvidenciaController.deleteEvidence);
router.get('/:actividadId', requireAuth, requireRole('ALUMNO'), alumnoActividadController.mostrarDetalle);

module.exports = router;
