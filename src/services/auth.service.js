// Logika logowania admina. W MVP jedno konto pochodzi z .env:
//  - jeśli ustawiony ADMIN_PASSWORD_HASH → porównujemy hash (bcrypt),
//  - w innym razie porównujemy ADMIN_PASSWORD jawnie (wygodne na start).
const bcrypt = require('bcryptjs');
const config = require('../config');

function verifyCredentials(email, password) {
  const emailOk =
    email &&
    config.admin.email &&
    email.trim().toLowerCase() === config.admin.email.trim().toLowerCase();

  if (!emailOk) return false;

  if (config.admin.passwordHash) {
    return bcrypt.compareSync(password || '', config.admin.passwordHash);
  }
  return (password || '') === config.admin.password;
}

module.exports = { verifyCredentials };
