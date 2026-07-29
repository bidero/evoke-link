// Załącznik w komunikatorze agencji: agencja wysyła plik (out), klient pobiera go
// ze SWOJEGO wątku (/c/:token/wiadomosci/:id/attachment). IDOR: obcy token = 404.
// HTTP E2E na dev-DB; sprząta własne rekordy. Wymaga ADMIN_PASSWORD (inaczej skip).
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

test('agencja wysyła załącznik → klient pobiera ze swojego wątku; obcy token = 404', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');

  const c1 = await clientService.create({ name: 'TEST_att_' + Date.now(), status: 'active' });
  const c2 = await clientService.create({ name: 'TEST_att2_' + Date.now(), status: 'active' });
  try {
    // agencja wysyła wiadomość z plikiem (multipart) w kontekście ogólnym
    const bytes = Buffer.from('evoke-attachment-test-' + Date.now());
    const fd = new FormData();
    fd.set('scope', 'c');
    fd.set('body', 'Masz plik w załączniku');
    fd.set('attachment', new Blob([bytes], { type: 'text/plain' }), 'umowa.txt');
    const sendRes = await fetch(`${base}/admin/messages/${c1.id}/send`, { method: 'POST', headers: { Cookie: cookie }, body: fd, redirect: 'manual' });
    assert.ok(sendRes.status >= 200 && sendRes.status < 400, 'send zwraca redirect/ok');

    // wiadomość out z załącznikiem powstała
    const msg = await prisma.message.findFirst({ where: { clientId: c1.id, direction: 'out', attachmentPath: { not: null } }, orderBy: { id: 'desc' } });
    assert.ok(msg, 'utworzono wiadomość out z załącznikiem');
    assert.equal(msg.attachmentName, 'umowa.txt');

    // klient pobiera ze SWOJEGO wątku → 200 + bajty się zgadzają
    const dl = await fetch(`${base}/c/${c1.token}/wiadomosci/${msg.id}/attachment`);
    assert.equal(dl.status, 200, 'klient pobiera swój załącznik');
    assert.match(dl.headers.get('content-disposition') || '', /umowa\.txt/);
    const got = Buffer.from(await dl.arrayBuffer());
    assert.equal(got.toString(), bytes.toString(), 'zawartość pliku zgodna');

    // IDOR: obcy token klienta NIE pobierze cudzego załącznika → 404
    const idor = await fetch(`${base}/c/${c2.token}/wiadomosci/${msg.id}/attachment`);
    assert.equal(idor.status, 404, 'obcy token = 404 (attachmentInThread ogranicza do wątku)');
  } finally {
    await prisma.message.deleteMany({ where: { clientId: { in: [c1.id, c2.id] } } });
    await clientService.remove(c1.id);
    await clientService.remove(c2.id);
  }
});
