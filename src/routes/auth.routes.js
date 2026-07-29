const express = require('express');
const { showLogin, doLogin, doVerify2fa, doLogout, passkeyOptions, passkeyLogin } = require('../controllers/auth.controller');
const { loginLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.get('/login', showLogin);
router.post('/login', loginLimiter, doLogin);
// Drugi krok logowania (2FA) — ten sam limiter co hasło (ochrona przed zgadywaniem kodu).
router.post('/login/2fa', loginLimiter, doVerify2fa);
// Logowanie passkeyem (bez hasła): opcje → weryfikacja podpisu.
router.post('/login/passkey/options', loginLimiter, passkeyOptions);
router.post('/login/passkey', loginLimiter, passkeyLogin);
router.post('/logout', doLogout);

module.exports = router;
