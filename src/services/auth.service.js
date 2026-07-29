// Logowanie: konta użytkowników w bazie (tabela User) + BOOTSTRAP z .env.
//
// Zasada (ważna, żeby nigdy nie stracić dostępu):
//  1) Jeśli e-mail pasuje do AKTYWNEGO konta w bazie → sprawdzamy jego hasło.
//  2) Jeśli e-mail = ADMIN_EMAIL z .env, a konto w bazie nie ma jeszcze hasła
//     (albo w ogóle nie istnieje) → fallback do hasła z .env.
// Dzięki temu istniejące instalacje działają bez zmian, a po dodaniu kont
// logują się wszyscy użytkownicy.
const bcrypt = require('bcryptjs');
const config = require('../config');
const prisma = require('../db/client');

const ROLES = ['admin', 'staff'];
const norm = (e) => (e || '').trim().toLowerCase();
const adminEmail = () => norm(config.admin.email);

function findByEmail(email) {
  const e = norm(email);
  if (!e) return Promise.resolve(null);
  return prisma.user.findUnique({ where: { email: e } }).catch(() => null);
}

// Wiersz konta admina z .env (lub null).
function getAdminUser() {
  return findByEmail(adminEmail());
}

// Sprawdza dane logowania. Zwraca użytkownika (obiekt sesji) albo null.
// Konto wyłączone (`active:false`) nigdy nie przechodzi.
async function authenticate(email, password) {
  const e = norm(email);
  if (!e) return null;
  const user = await findByEmail(e);

  if (user && user.passwordHash) {
    if (user.active === false) return null;
    if (!bcrypt.compareSync(password || '', user.passwordHash)) return null;
    return { id: user.id, email: user.email, name: user.name || 'Administrator', role: ROLES.includes(user.role) ? user.role : 'admin' };
  }

  // Bootstrap: konto z .env, dopóki nie ma hasła w bazie.
  if (e === adminEmail()) {
    const ok = config.admin.passwordHash
      ? bcrypt.compareSync(password || '', config.admin.passwordHash)
      : (password || '') === config.admin.password;
    if (ok) return { id: user ? user.id : null, email: e, name: (user && user.name) || 'Administrator', role: 'admin' };
  }
  return null;
}

// Zgodność wstecz (używane m.in. przy zmianie hasła — potwierdzenie obecnego).
async function verifyCredentials(email, password) {
  return !!(await authenticate(email, password));
}

// Zapisuje (lub aktualizuje) hasło konta admina z .env.
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

// ── Zarządzanie kontami (panel: Ustawienia → Konta) ──────────────────────────
function listUsers() {
  return prisma.user.findMany({ orderBy: [{ role: 'asc' }, { email: 'asc' }] });
}

async function createUser({ email, password, name, role }) {
  const e = norm(email);
  if (!e || !password || password.length < 8) return null;
  return prisma.user.create({
    data: {
      email: e,
      passwordHash: bcrypt.hashSync(password, 10),
      name: (name || '').trim().slice(0, 120) || null,
      role: ROLES.includes(role) ? role : 'staff',
    },
  });
}

// Aktualizacja konta. Hasło zmieniane tylko, gdy podane (min. 8 znaków).
async function updateUser(id, { name, role, active, password }) {
  const data = {};
  if (name !== undefined) data.name = (name || '').trim().slice(0, 120) || null;
  if (role !== undefined && ROLES.includes(role)) data.role = role;
  if (active !== undefined) data.active = !!active;
  if (password) {
    if (password.length < 8) return null;
    data.passwordHash = bcrypt.hashSync(password, 10);
  }
  return prisma.user.update({ where: { id: Number(id) }, data });
}

function deleteUser(id) {
  return prisma.user.deleteMany({ where: { id: Number(id) } });
}

function touchLogin(id) {
  if (!id) return Promise.resolve(null);
  return prisma.user.update({ where: { id: Number(id) }, data: { lastLoginAt: new Date() } }).catch(() => null);
}

module.exports = {
  ROLES, authenticate, verifyCredentials, setAdminPassword, getAdminUser, hasDbPassword,
  listUsers, createUser, updateUser, deleteUser, touchLogin, findByEmail,
};
