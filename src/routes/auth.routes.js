const express = require('express');
const { showLogin, doLogin, doLogout } = require('../controllers/auth.controller');
const { loginLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.get('/login', showLogin);
router.post('/login', loginLimiter, doLogin);
router.post('/logout', doLogout);

module.exports = router;
