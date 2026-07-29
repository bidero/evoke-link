// Etap 4 slice 1: konta użytkowników + role (admin | staff).
// Logowanie kontem z bazy, bramka requireAdmin (403 dla staff), konto wyłączone,
// bootstrap z .env dalej działa. HTTP E2E na dev-DB; sprząta własne konta.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const authService = require('../src/services/auth.service');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

async function login(email, password) {
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }), redirect: 'manual' });
  return { status: r.status, cookie: (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ') };
}
const get = (url, cookie) => fetch(`${base}${url}`, { headers: { Cookie: cookie }, redirect: 'manual' });

test('konta+role: logowanie z bazy, staff bez Ustawień/Kont, wyłączone konto, .env dalej działa', async (t) => {
  const email = 'TEST_staff_' + Date.now() + '@example.com';
  const pass = 'tajnehaslo123';
  let user;
  try {
    user = await authService.createUser({ email, password: pass, name: 'Pracownik Test', role: 'staff' });
    assert.ok(user && user.role === 'staff', 'konto pracownika utworzone');

    // logowanie kontem z bazy
    const s = await login(email, pass);
    assert.equal(s.status, 302, 'staff loguje się (redirect)');

    // pracownik: pulpit/projekty OK, Ustawienia i Konta = 403
    assert.equal((await get('/admin', s.cookie)).status, 200, 'staff widzi pulpit');
    assert.equal((await get('/admin/projects', s.cookie)).status, 200, 'staff widzi projekty');
    assert.equal((await get('/admin/settings', s.cookie)).status, 403, 'staff NIE widzi Ustawień');
    assert.equal((await get('/admin/users', s.cookie)).status, 403, 'staff NIE widzi Kont');

    // złe hasło
    assert.equal((await login(email, 'zlehaslo123')).status, 401, 'złe hasło odrzucone');

    // konto wyłączone nie loguje się
    await authService.updateUser(user.id, { active: false });
    assert.equal((await login(email, pass)).status, 401, 'wyłączone konto odrzucone');
    await authService.updateUser(user.id, { active: true });

    // walidacja: za krótkie hasło nie tworzy konta
    assert.equal(await authService.createUser({ email: 'x_' + email, password: 'krotkie', role: 'staff' }), null, 'hasło <8 znaków odrzucone');

    // bootstrap z .env dalej działa i ma pełny dostęp
    if (process.env.ADMIN_PASSWORD) {
      const a = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
      assert.equal(a.status, 302, 'admin z .env loguje się');
      assert.equal((await get('/admin/settings', a.cookie)).status, 200, 'admin widzi Ustawienia');
      assert.equal((await get('/admin/users', a.cookie)).status, 200, 'admin widzi Konta');
    }
  } finally {
    if (user) await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'TEST_staff_' } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'x_TEST_staff_' } } });
  }
});
