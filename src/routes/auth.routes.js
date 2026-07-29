const express = require('express');
const { showLogin, doLogin, doVerify2fa, doLogout } = require('../controllers/auth.controller');
const { loginLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.get('/login', showLogin);
router.post('/login', loginLimiter, doLogin);
// Drugi krok logowania (2FA) — ten sam limiter co hasło (ochrona przed zgadywaniem kodu).
router.post('/login/2fa', loginLimiter, doVerify2fa);
router.post('/logout', doLogout);

module.exports = router;
