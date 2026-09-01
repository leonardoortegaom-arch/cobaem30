const express = require('express');
const authController = require('../controllers/authController');
const { loginLimiter } = require('../middlewares/rateLimitMiddleware');

const router = express.Router();

router.get('/login', authController.mostrarLogin);
router.post('/login', loginLimiter, authController.procesarLogin);
router.post('/logout', authController.cerrarSesion);

module.exports = router;
