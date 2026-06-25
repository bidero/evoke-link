// Logika logowania admina.
// Hasło: najpierw z bazy (tabela User), jeśli admin je zmienił w panelu;
// w innym razie z .env (ADMIN_PASSWORD_HASH lub jawne ADMIN_PASSWORD).
// E-mail (tożsamość konta) zawsze pochodzi z ADMIN_EMAIL.
const bcrypt = require('bcryptjs');
const config = require('../config');
const prisma = require('../db/client');

const adminEmail = () => (config.admin.email || '').trim().toLowerCase();

// Wiersz konta admina w bazie (lub null).
async function getAdminUser() {
  const email = adminEmail();
  if (!email) return null;
  try {
    return await prisma.user.findUnique({ where: { email } });
  } catch (_) {
    return null;
  }
}

async function verifyCredentials(email, password) {
  const emailOk =
    email && adminEmail() && email.trim().toLowerCase() === adminEmail();
  if (!emailOk) return false;

  // 1) Hasło ustawione w panelu (baza) — ma pierwszeństwo.
  const user = await getAdminUser();
  if (user && user.passwordHash) {
    return bcrypt.compareSync(password || '', user.passwordHash);
  }

  // 2) Fallback do .env.
  if (config.admin.passwordHash) {
    return bcrypt.compareSync(password || '', config.admin.passwordHash);
  }
  return (password || '') === config.admin.password;
}

// Zapisuje (lub aktualizuje) hasło admina w bazie.
async function setAdminPassword(newPassword) {
  const email = adminEmail();
  if (!email) throw new Error('Brak ADMIN_EMAIL w konfiguracji.');
  const passwordHash = bcrypt.hashSync(newPassword, 10);
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash, name: 'Administrator', role: 'admin' },
  });
}

// Czy hasło admina pochodzi już z bazy (do komunikatu w UI).
async function hasDbPassword() {
  const user = await getAdminUser();
  return !!(user && user.passwordHash);
}

module.exports = { verifyCredentials, setAdminPassword, getAdminUser, hasDbPassword };
