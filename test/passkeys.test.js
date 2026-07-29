// Etap 4 slice 3: passkeys (WebAuthn) — konfiguracja, bramki i przechowywanie kluczy.
//
// UWAGA: pełny przepływ (rejestracja klucza → logowanie bez hasła) wymaga prawdziwego
// authenticatora, więc jest weryfikowany E2E w Chromium z wirtualnym authenticatorem
// (CDP WebAuthn.addVirtualAuthenticator). Tutaj testujemy warstwę serwera: rp/origin,
// listę i usuwanie kluczy oraz to, że endpointy nie wpuszczają niezalogowanych.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const authService = require('../src/services/auth.service');
const webauthn = require('../src/services/webauthn.service');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

test('webauthn: rp z APP_URL + wymóg bezpiecznego kontekstu (HTTPS/localhost)', () => {
  const { id, origin } = webauthn.rp();
  assert.ok(id && typeof id === 'string', 'rpID = hostname');
  assert.ok(origin.startsWith('http'), 'origin = pełny adres aplikacji');
  // localhost i https są dozwolone, zwykłe http po IP nie (ograniczenie przeglądarek).
  assert.equal(webauthn.isSupportedOrigin(), /^https:/i.test(origin) || id === 'localhost' || id === '127.0.0.1');
});

test('passkeys: zapis, lista i usuwanie kluczy konta', async () => {
  const email = 'TEST_pk_' + Date.now() + '@example.com';
  let user;
  try {
    user = await authService.createUser({ email, password: 'tajnehaslo123', name: 'PK', role: 'admin' });
    assert.equal(await webauthn.countForUser(user.id), 0, 'na starcie brak kluczy');

    const cred = await prisma.credential.create({
      data: { userId: user.id, credentialId: 'cred_' + Date.now(), publicKey: 'cGs', counter: 0, transports: JSON.stringify(['internal']), label: 'MacBook' },
    });
    const list = await webauthn.listForUser(user.id);
    assert.equal(list.length, 1, 'klucz na liście konta');
    assert.equal(list[0].label, 'MacBook');

    // usunięcie cudzym userId nie działa (klucz przypisany do konta)
    await webauthn.removeCredential(user.id + 99999, cred.id);
    assert.equal(await webauthn.countForUser(user.id), 1, 'obcy użytkownik nie usunie klucza');
    await webauthn.removeCredential(user.id, cred.id);
    assert.equal(await webauthn.countForUser(user.id), 0, 'właściciel usuwa swój klucz');

    // klucze giną razem z kontem (Cascade)
    await prisma.credential.create({ data: { userId: user.id, credentialId: 'casc_' + Date.now(), publicKey: 'cGs' } });
    await prisma.user.delete({ where: { id: user.id } });
    assert.equal(await prisma.credential.count({ where: { userId: user.id } }), 0, 'Cascade usuwa klucze konta');
    user = null;
  } finally {
    if (user) await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'TEST_pk_' } } });
  }
});

test('passkeys: endpointy panelu wymagają zalogowania, logowanie kluczem wymaga sesji z challenge', async () => {
  // bez sesji → przekierowanie na logowanie (requireAuth)
  const opt = await fetch(`${base}/admin/account/passkey/options`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', redirect: 'manual' });
  assert.equal(opt.status, 302, 'rejestracja klucza wymaga zalogowania');

  // logowanie kluczem bez wcześniejszego pobrania opcji (brak challenge w sesji) → 400
  const login = await fetch(`${base}/admin/login/passkey`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response: {} }) });
  assert.equal(login.status, 400, 'brak challenge w sesji = odmowa');

  // opcje logowania są publiczne (usernameless) i zwracają challenge
  const pub = await fetch(`${base}/admin/login/passkey/options`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(pub.status, 200);
  const json = await pub.json();
  assert.ok(json.challenge && typeof json.challenge === 'string', 'opcje zawierają challenge');
  assert.ok(json.rpId, 'opcje zawierają rpId');
});
