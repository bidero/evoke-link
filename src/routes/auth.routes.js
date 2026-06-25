const express = require('express');
const { showLogin, doLogin, doLogout } = require('../controllers/auth.controller');

const router = express.Router();

router.get('/login', showLogin);
router.post('/login', doLogin);
router.post('/logout', doLogout);

module.exports = router;
