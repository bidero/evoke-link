// Passkeys (WebAuthn) — rejestracja i logowanie kluczem platformowym
// (Touch ID / Face ID / Windows Hello / iCloud Keychain / menedżer haseł).
//
// Weryfikację podpisów (CBOR/COSE, attestation) robi biblioteka @simplewebauthn/server —
// czysty JS, bez kompilacji natywnej („shared-hosting-safe"). Nie piszemy tego sami:
// błąd w weryfikacji podpisu = obejście logowania.
//
// WAŻNE: przeglądarki wymagają bezpiecznego kontekstu — HTTPS albo localhost.
// Na http://IP:3000 passkeys po prostu nie wystartują (to ograniczenie przeglądarki).
const {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const prisma = require('../db/client');
const config = require('../config');

// rpID = sama domena (bez portu i schematu), origin = pełny adres aplikacji.
function rp() {
  let host = 'localhost';
  try { host = new URL(config.appUrl).hostname || 'localhost'; } catch (_) {}
  return { id: host, origin: config.appUrl };
}
// Czy passkeys mogą w ogóle zadziałać pod tym adresem (HTTPS albo localhost).
function isSupportedOrigin() {
  const { origin, id } = rp();
  return /^https:/i.test(origin) || id === 'localhost' || id === '127.0.0.1';
}

const b64 = {
  toBuf: (s) => Buffer.from(String(s || ''), 'base64url'),
  fromBuf: (b) => Buffer.from(b).toString('base64url'),
};

function listForUser(userId) {
  return prisma.credential.findMany({ where: { userId: Number(userId) }, orderBy: { createdAt: 'asc' } });
}
function countForUser(userId) {
  return prisma.credential.count({ where: { userId: Number(userId) } });
}
function removeCredential(userId, id) {
  return prisma.credential.deleteMany({ where: { id: Number(id), userId: Number(userId) } });
}

// ── Rejestracja nowego passkeya ──────────────────────────────────────────────
async function registrationOptions(user, appName) {
  const { id: rpID } = rp();
  const existing = await listForUser(user.id);
  const options = await generateRegistrationOptions({
    rpName: appName || 'Evoke LINK',
    rpID,
    userID: Buffer.from(String(user.id)),
    userName: user.email,
    userDisplayName: user.name || user.email,
    attestationType: 'none', // nie potrzebujemy atestacji producenta — mniej danych, mniej tarcia
    // Nie pozwól zarejestrować tego samego klucza dwa razy.
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: safeTransports(c.transports) })),
    authenticatorSelection: {
      residentKey: 'preferred',      // klucz „odkrywalny" → logowanie BEZ podawania e-maila
      userVerification: 'preferred', // Touch ID / PIN, gdy urządzenie potrafi
    },
  });
  return options;
}

async function verifyRegistration(user, response, expectedChallenge, label) {
  const { id: rpID, origin } = rp();
  const verification = await verifyRegistrationResponse({
    response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
  });
  if (!verification.verified || !verification.registrationInfo) return null;

  const info = verification.registrationInfo;
  // v13: dane klucza siedzą w `credential` (starsze wersje miały je płasko).
  const cred = info.credential || info;
  const credentialId = typeof cred.id === 'string' ? cred.id : b64.fromBuf(cred.id || cred.credentialID);
  const publicKey = b64.fromBuf(cred.publicKey || cred.credentialPublicKey);

  return prisma.credential.create({
    data: {
      userId: user.id,
      credentialId,
      publicKey,
      counter: Number(cred.counter || 0),
      transports: JSON.stringify(response.response && response.response.transports ? response.response.transports : []),
      label: (label || '').trim().slice(0, 60) || 'Passkey',
    },
  });
}

// ── Logowanie passkeyem ──────────────────────────────────────────────────────
// Bez `allowCredentials` → logowanie „usernameless": przeglądarka sama proponuje
// zapisany klucz (Touch ID i jesteś w panelu).
async function authenticationOptions() {
  const { id: rpID } = rp();
  return generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
}

// Weryfikacja odpowiedzi → zwraca użytkownika (obiekt sesji) albo null.
async function verifyAuthentication(response, expectedChallenge) {
  const { id: rpID, origin } = rp();
  const credentialId = response && response.id;
  if (!credentialId) return null;

  const stored = await prisma.credential.findUnique({ where: { credentialId }, include: { user: true } });
  if (!stored || !stored.user || stored.user.active === false) return null;

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: stored.credentialId,
      publicKey: b64.toBuf(stored.publicKey),
      counter: stored.counter,
      transports: safeTransports(stored.transports),
    },
  });
  if (!verification.verified) return null;

  // Licznik podpisów rośnie — zapisujemy (ochrona przed sklonowanym kluczem).
  const newCounter = verification.authenticationInfo ? verification.authenticationInfo.newCounter : stored.counter;
  await prisma.credential.update({ where: { id: stored.id }, data: { counter: Number(newCounter || 0), lastUsedAt: new Date() } });

  const u = stored.user;
  return { id: u.id, email: u.email, name: u.name || 'Administrator', role: u.role === 'staff' ? 'staff' : 'admin' };
}

function safeTransports(json) {
  try { const t = JSON.parse(json || '[]'); return Array.isArray(t) && t.length ? t : undefined; } catch (_) { return undefined; }
}

module.exports = {
  rp, isSupportedOrigin, listForUser, countForUser, removeCredential,
  registrationOptions, verifyRegistration, authenticationOptions, verifyAuthentication,
};
