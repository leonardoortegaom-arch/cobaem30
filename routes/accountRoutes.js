const express = require('express');

const accountController = require('../controllers/accountController');
const { requireAuth } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/', requireAuth, accountController.mostrarCuenta);
router.post('/contrasena', requireAuth, accountController.cambiarPassword);

module.exports = router;
