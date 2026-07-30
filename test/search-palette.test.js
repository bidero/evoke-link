// Paleta wyszukiwania (Cmd/Ctrl+K): JSON endpoint + obecność palety w layoucie panelu.
// GOTCHA, którą ten test pilnuje: layout panelu NIE MOŻE wstawiać palety przez include()
// — widoki z localem `client` (skrzynka) przełączają EJS w tryb client-side i include pada.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

async function login() {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }), redirect: 'manual' });
  return (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}

test('paleta: /admin/search.json wymaga logowania, grupuje wyniki, poniżej 2 znaków pusto', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');

  // bez sesji → przekierowanie na logowanie (nie wyciekamy danych)
  const anon = await fetch(`${base}/admin/search.json?q=cokolwiek`, { redirect: 'manual' });
  assert.equal(anon.status, 302);

  const stamp = Date.now();
  const cl = await prisma.client.create({ data: { name: 'Paleta Klient ' + stamp, company: 'Paleta sp. z o.o.', token: 'pal_' + stamp, avatarPath: '/branding/pal.png' } });
  const pr = await prisma.project.create({ data: { name: 'Paleta Projekt ' + stamp, clientId: cl.id, clientToken: 'palp_' + stamp } });
  try {
    const get = async (q) => (await fetch(`${base}/admin/search.json?q=${encodeURIComponent(q)}`, { headers: { Cookie: cookie } })).json();

    // < 2 znaki: nic nie szukamy (jak na stronie wyników)
    assert.deepEqual((await get('P')).groups, []);

    const d = await get('Paleta Klient ' + stamp);
    const clients = d.groups.find((g) => g.key === 'clients');
    assert.ok(clients, 'grupa klientów obecna');
    const hit = clients.items.find((i) => i.label === cl.name);
    assert.ok(hit, 'zasiany klient w wynikach');
    assert.match(hit.href, new RegExp(`^/admin/clients/${cl.id}\\?from=search:`), 'link z kontekstem powrotu');
    assert.match(hit.sub, /Paleta sp\. z o\.o\./);
    assert.match(hit.avatar, /^<img src="\/branding\/pal\.png"/, 'awatar jako gotowy HTML');

    const d2 = await get('Paleta Projekt ' + stamp);
    const projects = d2.groups.find((g) => g.key === 'projects');
    assert.ok(projects && projects.items.some((i) => i.label === pr.name), 'projekt w wynikach');

    // brak trafień = brak grup (widok pokazuje „Brak wyników")
    assert.deepEqual((await get('zzz-nie-ma-takiego-' + stamp)).groups, []);
  } finally {
    await prisma.project.delete({ where: { id: pr.id } }).catch(() => {});
    await prisma.client.delete({ where: { id: cl.id } }).catch(() => {});
  }
});

test('paleta: renderuje się w layoucie panelu — także na widoku z localem `client`', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');

  const stamp = Date.now();
  const cl = await prisma.client.create({ data: { name: 'Paleta Layout ' + stamp, token: 'pall_' + stamp } });
  try {
    for (const url of ['/admin', `/admin/messages?client=${cl.id}`, `/admin/clients/${cl.id}`]) {
      const r = await fetch(base + url, { headers: { Cookie: cookie } });
      const html = await r.text();
      assert.equal(r.status, 200, url);
      assert.match(html, /searchPalette\(/, 'x-data palety obecne w ' + url);
      assert.match(html, /search\.json/, 'endpoint palety w ' + url);
      assert.ok(!/include is not a function/.test(html), 'brak błędu include w ' + url);
    }
    // Pole w nagłówku zostaje formularzem GET (działa bez JS) + chip „⌘K".
    const html = await (await fetch(base + '/admin', { headers: { Cookie: cookie } })).text();
    assert.match(html, /action="\/admin\/search"/);
    assert.match(html, /⌘K/);
  } finally {
    await prisma.client.delete({ where: { id: cl.id } }).catch(() => {});
  }
});
