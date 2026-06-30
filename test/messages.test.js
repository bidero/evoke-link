// Przepływ wiadomości (Faza A+B): klient pisze → agencja odpowiada → wątek + badge.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const clientService = require('../src/services/client.service');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

async function login() {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }), redirect: 'manual' });
  return (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}

test('klient pisze → agencja odpowiada → wątek w panelu + badge u klienta', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env — pomijam');

  const c = await clientService.create({ name: 'TEST_msg_' + Date.now(), status: 'active' });
  const token = 'tmsg_' + Date.now();
  const p = await prisma.project.create({ data: { name: 'TEST proj', clientId: c.id, clientToken: token } });
  try {
    const inBody = 'pytanie ' + Date.now();
    await fetch(`${base}/p/${token}/message`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ body: inBody, senderName: 'Ala', senderEmail: 'ala@example.com' }), redirect: 'manual' });
    const original = await prisma.message.findFirst({ where: { projectId: p.id, body: inBody } });
    assert.ok(original, 'wiadomość zapisana');
    assert.equal(original.clientId, c.id, 'wiązanie z klientem z projektu');
    assert.equal(original.isRead, false);

    // przed odpowiedzią — brak badge nowej odpowiedzi
    assert.match(await (await fetch(`${base}/p/${token}`)).text(), /hasReply: false/);

    // odpowiedź agencji
    const outBody = 'odpowiedz ' + Date.now();
    const rep = await fetch(`${base}/admin/messages/${original.id}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: new URLSearchParams({ body: outBody }), redirect: 'manual' });
    assert.equal(rep.status, 302);
    const reply = await prisma.message.findFirst({ where: { projectId: p.id, direction: 'out', body: outBody } });
    assert.ok(reply, 'odpowiedź zapisana jako out');
    assert.equal((await prisma.message.findUnique({ where: { id: original.id } })).isRead, true, 'oryginał przeczytany');

    // panel pokazuje obie w jednym wątku
    const ihtml = await (await fetch(`${base}/admin/messages`, { headers: { Cookie: cookie } })).text();
    assert.ok(ihtml.includes(inBody) && ihtml.includes(outBody), 'wątek pokazuje obie wiadomości');

    // po odpowiedzi — badge nowej odpowiedzi u klienta
    assert.match(await (await fetch(`${base}/p/${token}`)).text(), /hasReply: true/);
  } finally {
    await prisma.message.deleteMany({ where: { projectId: p.id } });
    await prisma.project.delete({ where: { id: p.id } });
    await clientService.remove(c.id);
  }
});
