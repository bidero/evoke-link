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
    return {
      id: user.id, email: user.email, name: user.name || 'Administrator',
      role: ROLES.includes(user.role) ? user.role : 'admin',
      // Hasło OK — ale gdy konto ma 2FA, kontroler wymaga jeszcze kodu.
      needs2fa: !!(user.totpSecret && user.totpEnabledAt),
    };
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

// ── 2FA (TOTP) ───────────────────────────────────────────────────────────────
// Sekret trzymamy w bazie (musi być odwracalny, żeby liczyć kody). Kody zapasowe
// przechowujemy WYŁĄCZNIE jako hashe bcrypt — jak hasła.
const totp = require('../utils/totp');

// Czy konto ma WŁĄCZONE 2FA (sekret potwierdzony kodem).
function has2fa(user) {
  return !!(user && user.totpSecret && user.totpEnabledAt);
}

// Start konfiguracji: nowy sekret zapisany, ale jeszcze NIEaktywny
// (`totpEnabledAt` zostaje null, dopóki użytkownik nie potwierdzi kodem).
async function begin2fa(userId) {
  const secret = totp.generateSecret();
  await prisma.user.update({ where: { id: Number(userId) }, data: { totpSecret: secret, totpEnabledAt: null } });
  return secret;
}

// Potwierdzenie kodem z aplikacji → włączenie 2FA + wygenerowanie kodów zapasowych.
// Zwraca kody JAWNIE (jedyny raz — w bazie lądują hashe) albo null przy złym kodzie.
async function confirm2fa(userId, token) {
  const user = await prisma.user.findUnique({ where: { id: Number(userId) } });
  if (!user || !user.totpSecret) return null;
  if (!totp.verify(user.totpSecret, token)) return null;
  const codes = totp.generateRecoveryCodes();
  const hashes = codes.map((c) => bcrypt.hashSync(totp.normalizeRecovery(c), 10));
  await prisma.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date(), recoveryCodes: JSON.stringify(hashes) } });
  return codes;
}

async function disable2fa(userId) {
  return prisma.user.update({ where: { id: Number(userId) }, data: { totpSecret: null, totpEnabledAt: null, recoveryCodes: null } });
}

// Nowe kody zapasowe (unieważniają poprzednie).
async function regenerateRecoveryCodes(userId) {
  const user = await prisma.user.findUnique({ where: { id: Number(userId) } });
  if (!has2fa(user)) return null;
  const codes = totp.generateRecoveryCodes();
  const hashes = codes.map((c) => bcrypt.hashSync(totp.normalizeRecovery(c), 10));
  await prisma.user.update({ where: { id: user.id }, data: { recoveryCodes: JSON.stringify(hashes) } });
  return codes;
}

// Drugi krok logowania: kod z aplikacji ALBO kod zapasowy (jednorazowy — zużyty znika).
async function verifySecondFactor(userId, token) {
  const user = await prisma.user.findUnique({ where: { id: Number(userId) } });
  if (!has2fa(user)) return false;

  if (totp.verify(user.totpSecret, token)) return true;

  // Kod zapasowy — porównujemy z hashami, zużyty usuwamy z listy.
  let hashes = [];
  try { hashes = JSON.parse(user.recoveryCodes || '[]'); } catch (_) { hashes = []; }
  const candidate = totp.normalizeRecovery(token);
  if (candidate.length < 6) return false;
  const idx = hashes.findIndex((h) => bcrypt.compareSync(candidate, h));
  if (idx === -1) return false;
  hashes.splice(idx, 1);
  await prisma.user.update({ where: { id: user.id }, data: { recoveryCodes: JSON.stringify(hashes) } });
  return true;
}

// Ile kodów zapasowych zostało (do UI).
function recoveryCodesLeft(user) {
  try { return JSON.parse((user && user.recoveryCodes) || '[]').length; } catch (_) { return 0; }
}

module.exports = {
  ROLES, authenticate, verifyCredentials, setAdminPassword, getAdminUser, hasDbPassword,
  listUsers, createUser, updateUser, deleteUser, touchLogin, findByEmail,
  has2fa, begin2fa, confirm2fa, disable2fa, regenerateRecoveryCodes, verifySecondFactor, recoveryCodesLeft,
};
