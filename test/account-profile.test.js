// „Mój profil" (Etap 3): render strony + zapis nazwy/roli/telefonu (Settings.profile).
// Dotyka wiersza Settings (kolumna profile) — snapshot + restore w finally.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const settingsService = require('../src/services/settings.service');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

async function login() {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }), redirect: 'manual' });
  return (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}

test('profil: render „Mój profil" + zapis nazwy/roli/telefonu', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');
  const snap = await prisma.settings.findUnique({ where: { id: 1 }, select: { profile: true } });
  try {
    const page = await fetch(`${base}/admin/account`, { headers: { Cookie: cookie } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Mój profil/);

    const nm = 'PROFIL_TEST_' + Date.now();
    const r = await fetch(`${base}/admin/account/profile`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: new URLSearchParams({ name: nm, role: 'Właściciel', phone: '600 100 200' }), redirect: 'manual' });
    assert.equal(r.status, 302, 'zapis profilu → redirect');

    const s = await settingsService.get();
    assert.equal(s.profile.name, nm, 'nazwa zapisana');
    assert.equal(s.profile.role, 'Właściciel', 'rola zapisana');
    assert.equal(s.profile.phone, '600 100 200', 'telefon zapisany');

    // widoczne na stronie (nagłówek panelu + karta profilu)
    assert.match(await (await fetch(`${base}/admin/account`, { headers: { Cookie: cookie } })).text(), new RegExp(nm), 'nazwa widoczna po zapisie');
  } finally {
    await prisma.settings.update({ where: { id: 1 }, data: { profile: snap ? snap.profile : null } });
    await settingsService.get();
  }
});
