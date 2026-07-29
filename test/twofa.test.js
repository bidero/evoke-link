// Etap 4 slice 2: 2FA (TOTP) — pełny przepływ logowania dwuetapowego.
// Kluczowe: samo hasło NIE daje dostępu do panelu; kody zapasowe są jednorazowe.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const authService = require('../src/services/auth.service');
const totp = require('../src/utils/totp');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

const post = (url, body, cookie) => fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { Cookie: cookie } : {}) }, body: new URLSearchParams(body), redirect: 'manual' });
const ck = (r) => (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');

test('2FA: hasło → kod; samo hasło nie wpuszcza; kod zapasowy jednorazowy', async () => {
  const email = 'TEST_2fa_' + Date.now() + '@example.com';
  const pass = 'tajnehaslo123';
  let user;
  try {
    user = await authService.createUser({ email, password: pass, name: 'Test 2FA', role: 'admin' });

    // bez 2FA — logowanie od razu
    assert.equal((await post('/admin/login', { email, password: pass })).status, 302, 'bez 2FA: prosty login');

    // włączenie 2FA: sekret → potwierdzenie kodem → kody zapasowe
    const secret = await authService.begin2fa(user.id);
    assert.equal(await authService.confirm2fa(user.id, '000000'), null, 'zły kod nie włącza 2FA');
    const codes = await authService.confirm2fa(user.id, totp.generate(secret));
    assert.ok(Array.isArray(codes) && codes.length === 10, '10 kodów zapasowych');
    assert.equal(authService.has2fa(await prisma.user.findUnique({ where: { id: user.id } })), true, '2FA aktywne');

    // logowanie hasłem → strona z kodem, BEZ dostępu do panelu
    let r = await post('/admin/login', { email, password: pass });
    const cookie = ck(r);
    assert.equal(r.status, 200, 'po haśle: strona weryfikacji (nie redirect)');
    assert.match(await r.text(), /Weryfikacja dwuetapowa/);
    const beforeCode = await fetch(`${base}/admin`, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(beforeCode.status, 302, 'samo hasło NIE daje dostępu do panelu');

    // zły kod
    assert.equal((await post('/admin/login/2fa', { token: '000000' }, cookie)).status, 401, 'zły kod odrzucony');

    // ekran 2FA używa TEGO SAMEGO układu co logowanie (wspólna skorupa _login_shell)
    const snapLogin = await prisma.settings.findUnique({ where: { id: 1 }, select: { login: true } });
    try {
      const settingsService = require('../src/services/settings.service');
      await settingsService.update({ login: { style: 'panel', side: 'left', width: '2xl', heroTitle: 'HERO_2FA' } });
      const shaped = await post('/admin/login', { email, password: pass });
      const shapedHtml = await shaped.text();
      assert.match(shapedHtml, /Weryfikacja dwuetapowa/, 'to nadal ekran 2FA');
      assert.match(shapedHtml, /md:max-w-2xl/, 'ekran 2FA dziedziczy szerokość panelu');
      assert.match(shapedHtml, /HERO_2FA/, 'ekran 2FA dziedziczy hero z ustawień logowania');
    } finally {
      await prisma.settings.update({ where: { id: 1 }, data: { login: snapLogin ? snapLogin.login : null } });
      await require('../src/services/settings.service').get();
    }

    // poprawny kod TOTP → wejście
    const ok = await post('/admin/login/2fa', { token: totp.generate(secret) }, cookie);
    assert.equal(ok.status, 302, 'poprawny kod → redirect');
    assert.equal((await fetch(`${base}/admin`, { headers: { Cookie: ck(ok) || cookie }, redirect: 'manual' })).status, 200, 'panel dostępny po kodzie');

    // kod zapasowy działa raz
    let r2 = await post('/admin/login', { email, password: pass });
    assert.equal((await post('/admin/login/2fa', { token: codes[0] }, ck(r2))).status, 302, 'kod zapasowy wpuszcza');
    r2 = await post('/admin/login', { email, password: pass });
    assert.equal((await post('/admin/login/2fa', { token: codes[0] }, ck(r2))).status, 401, 'ten sam kod zapasowy drugi raz odrzucony');
    assert.equal(authService.recoveryCodesLeft(await prisma.user.findUnique({ where: { id: user.id } })), 9, 'zużyty kod zniknął z puli');

    // wyłączenie 2FA czyści sekret i kody
    await authService.disable2fa(user.id);
    const after = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(authService.has2fa(after), false, '2FA wyłączone');
    assert.equal(after.totpSecret, null, 'sekret wyczyszczony');
    assert.equal((await post('/admin/login', { email, password: pass })).status, 302, 'po wyłączeniu: znów prosty login');
  } finally {
    if (user) await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'TEST_2fa_' } } });
  }
});
