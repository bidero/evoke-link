// Liczniki (dzwonek, badge menu, licznik na ikonie PWA) odświeżane w otwartej karcie:
// endpoint /admin/badges.json + markup, który da się aktualizować bez przeładowania.
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
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: process.env.ADMIN_EMAIL, password }), redirect: 'manual' });
  return (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}

test('/admin/badges.json: wymaga logowania i zwraca trzy liczniki', async (t) => {
  const anon = await fetch(`${base}/admin/badges.json`, { redirect: 'manual' });
  assert.match(anon.headers.get('location') || '', /\/admin\/login/, 'bez sesji przekierowanie na logowanie');

  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');

  const res = await fetch(`${base}/admin/badges.json`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  assert.match(res.headers.get('cache-control') || '', /no-store/, 'licznik nie może być cache’owany');

  const data = await res.json();
  assert.deepEqual(Object.keys(data).sort(), ['calendar', 'messages', 'notifications']);
  for (const k of Object.keys(data)) assert.equal(typeof data[k], 'number', `${k} jest liczbą`);
});

test('/admin/badges.json odzwierciedla realny stan (nowa wiadomość podnosi licznik)', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');

  const get = async () => (await fetch(`${base}/admin/badges.json`, { headers: { Cookie: cookie } })).json();
  const before = await get();

  const cl = await prisma.client.create({ data: { name: 'BADGE ' + Date.now(), token: 'bdg_' + Date.now() } });
  try {
    await prisma.message.create({ data: { clientId: cl.id, direction: 'in', body: 'pytanie', isRead: false } });
    await prisma.event.create({ data: { type: 'uploaded', message: 'wgrano plik', clientId: cl.id, isRead: false } });

    const after = await get();
    assert.equal(after.messages, before.messages + 1, 'nieprzeczytana wiadomość policzona');
    assert.equal(after.notifications, before.notifications + 1, 'nowe powiadomienie policzone');
  } finally {
    await prisma.message.deleteMany({ where: { clientId: cl.id } });
    await prisma.event.deleteMany({ where: { clientId: cl.id } });
    await prisma.client.delete({ where: { id: cl.id } });
  }
});

test('layout: badge istnieją zawsze (ukryte przy zerze) + skrypt odświeżający', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');

  const snap = await prisma.settings.findUnique({ where: { id: 1 }, select: { panel: true } });
  try {
    // pozycje menu z licznikami muszą być widoczne, żeby dało się je sprawdzić
    const cur = (await settingsService.get()).panel;
    await settingsService.update({ panel: { menu: [{ key: 'notifications' }, { key: 'messages' }, { key: 'calendar' }], dashboard: cur.dashboard, actions: cur.actions } });

    const html = await (await fetch(`${base}/admin`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /src="\/js\/badges\.js"/, 'skrypt odświeżający wpięty');
    // Dzwonek + trzy pozycje menu: element badge renderowany ZAWSZE (JS tylko podmienia treść).
    for (const k of ['notifications', 'messages', 'calendar']) {
      assert.match(html, new RegExp(`data-badge="${k}"`), `badge dla ${k} obecny w markupie`);
    }
    // Przy zerowym liczniku element ma `hidden` — inaczej wisiałoby puste kółko.
    const zeroBadge = /data-badge="calendar"[^>]*class="[^"]*\bhidden\b/.test(html)
      || /data-badge="calendar"[^>]*>\s*[1-9]/.test(html);
    assert.ok(zeroBadge, 'badge przy zerze schowany, przy niezerowym pokazany');
  } finally {
    await prisma.settings.update({ where: { id: 1 }, data: { panel: snap ? snap.panel : null } });
    await settingsService.get();
  }
});
