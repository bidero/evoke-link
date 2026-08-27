// Żywy wątek (polling) + wysyłka bez przeładowania — panel i strona klienta.
// Sprawdzamy KONTRAKT endpointów (kursor, izolacja wątków, kształt odpowiedzi), bo na nim stoi
// cała warstwa live; sam przepływ w przeglądarce weryfikowany jest E2E.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const messageService = require('../src/services/message.service');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

async function login() {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }), redirect: 'manual' });
  return (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}
const json = (url, opts) => fetch(url, { ...opts, headers: { Accept: 'application/json', ...((opts && opts.headers) || {}) } });

async function fixture(tag) {
  const client = await prisma.client.create({ data: { name: `${tag} ${Date.now()}`, token: `${tag}_${Date.now()}` } });
  const project = await prisma.project.create({ data: { name: `${tag} projekt`, clientId: client.id, clientToken: `${tag}p_${Date.now()}`, status: 'active' } });
  return { client, project };
}
async function cleanup({ client, project }) {
  await prisma.message.deleteMany({ where: { clientId: client.id } });
  await prisma.event.deleteMany({ where: { OR: [{ clientId: client.id }, { projectId: project.id }] } });
  await prisma.project.delete({ where: { id: project.id } });
  await prisma.client.delete({ where: { id: client.id } });
}

test('polling klienta: oddaje TYLKO wiadomości nowsze od kursora + bąbelek z data-msg-id', async () => {
  const f = await fixture('live');
  try {
    const older = await prisma.message.create({ data: { body: 'STARA', direction: 'in', clientId: f.client.id, projectId: f.project.id } });
    const newer = await prisma.message.create({ data: { body: 'NOWA', direction: 'out', clientId: f.client.id, projectId: f.project.id } });

    const all = await (await json(`${base}/p/${f.project.clientToken}/wiadomosci/poll?after=0`)).json();
    assert.match(all.html, /STARA/);
    assert.match(all.html, /NOWA/);
    assert.equal(all.lastId, newer.id, 'kursor = id najnowszej');
    assert.match(all.html, new RegExp(`data-msg-id="${newer.id}"`), 'bąbelek niesie data-msg-id (dedup + ptaszki)');

    const tail = await (await json(`${base}/p/${f.project.clientToken}/wiadomosci/poll?after=${older.id}`)).json();
    assert.doesNotMatch(tail.html, /STARA/, 'stara wiadomość NIE wraca ponownie');
    assert.match(tail.html, /NOWA/);

    const none = await (await json(`${base}/p/${f.project.clientToken}/wiadomosci/poll?after=${newer.id}`)).json();
    assert.equal(none.html, '', 'brak nowych = pusty html');
    assert.equal(none.lastId, newer.id, 'kursor nie cofa się przy pustej odpowiedzi');
  } finally {
    await cleanup(f);
  }
});

test('polling klienta: wątki są odseparowane (obcy token nie widzi cudzych wiadomości)', async () => {
  const a = await fixture('liva');
  const b = await fixture('livb');
  try {
    await prisma.message.create({ data: { body: 'TAJNE-A', direction: 'in', clientId: a.client.id, projectId: a.project.id } });
    const foreign = await (await json(`${base}/p/${b.project.clientToken}/wiadomosci/poll?after=0`)).json();
    assert.doesNotMatch(foreign.html || '', /TAJNE-A/, 'obcy projekt nie dostaje cudzego wątku');
    assert.equal(await (await json(`${base}/p/nieistniejacy-token/wiadomosci/poll?after=0`)).status, 404);
  } finally {
    await cleanup(a); await cleanup(b);
  }
});

test('polling panelu: wymaga logowania, zwraca no-store i bąbelki rozmowy', async () => {
  const f = await fixture('livp');
  try {
    await prisma.message.create({ data: { body: 'DO-PANELU', direction: 'in', clientId: f.client.id, projectId: f.project.id } });
    assert.equal((await json(`${base}/admin/messages/poll?client=${f.client.id}&after=0`, { redirect: 'manual' })).status, 302, 'bez sesji → przekierowanie na login');

    const cookie = await login();
    if (!cookie) return; // brak ADMIN_PASSWORD w .env
    const r = await json(`${base}/admin/messages/poll?client=${f.client.id}&after=0`, { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('cache-control') || '', /no-store/, 'licznik/wątek nie może być cache’owany');
    const d = await r.json();
    assert.match(d.html, /DO-PANELU/);
    assert.ok(Array.isArray(d.readIds), 'readIds do ptaszków');
  } finally {
    await cleanup(f);
  }
});

test('wysyłka: z Accept JSON oddaje bąbelek (bez przeładowania), bez nagłówka → redirect', async () => {
  const f = await fixture('livs');
  try {
    const cookie = await login();
    if (!cookie) return;
    const form = (body) => new URLSearchParams({ body, scope: 'p:' + f.project.id });

    const asJson = await fetch(`${base}/admin/messages/${f.client.id}/send`, {
      method: 'POST', redirect: 'manual',
      headers: { Cookie: cookie, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form('PRZEZ-JSON'),
    });
    assert.equal(asJson.status, 200, 'JSON zamiast redirectu');
    const d = await asJson.json();
    assert.equal(d.ok, true);
    assert.match(d.html, /PRZEZ-JSON/);
    assert.ok(d.lastId > 0, 'kursor po wysyłce');

    const classic = await fetch(`${base}/admin/messages/${f.client.id}/send`, {
      method: 'POST', redirect: 'manual',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form('KLASYCZNIE'),
    });
    assert.equal(classic.status, 302, 'fallback bez JS = dotychczasowy redirect');
  } finally {
    await cleanup(f);
  }
});

test('scopeWhere: jeden kształt wątku dla widoku, pollingu i oznaczania', () => {
  assert.deepEqual(messageService.scopeWhere({ transferId: 5 }), { transferId: 5 });
  assert.deepEqual(messageService.scopeWhere({ projectId: 7 }), { projectId: 7 });
  assert.deepEqual(messageService.scopeWhere({ clientId: 3 }), { clientId: 3, projectId: null, transferId: null });
  assert.equal(messageService.scopeWhere({}), null, 'pusty scope → null (wołający zwraca pustkę)');
});

test('ptaszki: markThreadOutRead oznacza TYLKO wiadomości agencji i nie rusza licznika dzwonka', async () => {
  const f = await fixture('livt');
  try {
    const incoming = await prisma.message.create({ data: { body: 'OD-KLIENTA', direction: 'in', clientId: f.client.id, projectId: f.project.id } });
    const outgoing = await prisma.message.create({ data: { body: 'OD-AGENCJI', direction: 'out', clientId: f.client.id, projectId: f.project.id } });
    const unreadBefore = await messageService.unreadCount();

    await messageService.markThreadOutRead({ projectId: f.project.id });

    assert.equal((await prisma.message.findUnique({ where: { id: outgoing.id } })).isRead, true, 'wiadomość agencji przeczytana przez klienta');
    assert.equal((await prisma.message.findUnique({ where: { id: incoming.id } })).isRead, false, 'wiadomość klienta NIE tknięta');
    assert.equal(await messageService.unreadCount(), unreadBefore, 'licznik dzwonka (in && !isRead) bez zmian');

    // pusty scope nie może masowo oznaczać wszystkiego
    const r = await messageService.markThreadOutRead({});
    assert.equal(r.count, 0, 'pusty scope = brak zmian');
  } finally {
    await cleanup(f);
  }
});

test('ptaszki: bąbelek własnej wiadomości niesie znacznik statusu (data-ticks/data-read)', async () => {
  const f = await fixture('livk');
  try {
    await prisma.message.create({ data: { body: 'MOJA', direction: 'in', clientId: f.client.id, projectId: f.project.id } });
    const d = await (await json(`${base}/p/${f.project.clientToken}/wiadomosci/poll?after=0`)).json();
    assert.match(d.html, /data-ticks/, 'u klienta ptaszek przy JEGO wiadomości (direction in)');
    assert.match(d.html, /data-read="0"/, 'świeża wiadomość = wysłane (jeszcze nieprzeczytana)');

    await messageService.markClientRead(f.client.id);
    const after = await (await json(`${base}/p/${f.project.clientToken}/wiadomosci/poll?after=0`)).json();
    assert.match(after.html, /data-read="1"/, 'po przeczytaniu przez agencję → ✓✓');
  } finally {
    await cleanup(f);
  }
});
