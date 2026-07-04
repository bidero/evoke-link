// Dokumenty klienta: agencja wgrywa, oznacza widoczność, klient pobiera widoczne z portalu /c.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const storage = require('../src/services/storage.service');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function login() {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }), redirect: 'manual' });
  return (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}

test('dokumenty: wgranie, widoczność, pobranie (admin + klient), sprzątanie pliku', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');

  const cl = await prisma.client.create({ data: { name: 'Dok ' + Date.now(), token: 'doc_' + Date.now() } });
  const bytes = Buffer.from('UMOWA-tresc-' + Date.now());
  try {
    // wgranie dokumentu (multipart) z opisem, domyślnie ukryty
    const fd = new FormData();
    fd.append('document', new Blob([bytes], { type: 'application/pdf' }), 'umowa.pdf');
    fd.append('label', 'Umowa 2026');
    const up = await fetch(`${base}/admin/clients/${cl.id}/documents`, { method: 'POST', headers: { Cookie: cookie }, body: fd, redirect: 'manual' });
    assert.equal(up.status, 302);
    await wait(200);

    const doc = await prisma.document.findFirst({ where: { clientId: cl.id } });
    assert.ok(doc && doc.name === 'umowa.pdf' && doc.label === 'Umowa 2026');
    assert.equal(doc.visibleToClient, false, 'domyślnie ukryty');
    assert.equal(doc.size, bytes.length);
    assert.ok(fs.existsSync(storage.absolutePath(doc.storedPath)), 'plik na dysku');

    // pobranie z panelu (admin)
    const dlA = await fetch(`${base}/admin/clients/${cl.id}/documents/${doc.id}`, { headers: { Cookie: cookie } });
    assert.equal(dlA.status, 200);
    assert.ok(Buffer.from(await dlA.arrayBuffer()).equals(bytes), 'admin: bajty zgodne');

    // ukryty → klient NIE pobierze (404) i nie widzi w portalu
    const dlHidden = await fetch(`${base}/c/${cl.token}/documents/${doc.id}`, { redirect: 'manual' });
    assert.equal(dlHidden.status, 404, 'ukryty dokument niedostępny dla klienta');
    let portal = await (await fetch(`${base}/c/${cl.token}`)).text();
    assert.doesNotMatch(portal, /Umowa 2026/, 'ukryty nie widnieje w portalu');

    // oznacz jako widoczny
    await fetch(`${base}/admin/clients/${cl.id}/documents/${doc.id}/toggle`, { method: 'POST', headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal((await prisma.document.findUnique({ where: { id: doc.id } })).visibleToClient, true);

    // teraz klient widzi i pobiera
    portal = await (await fetch(`${base}/c/${cl.token}`)).text();
    assert.match(portal, /Umowa 2026/, 'widoczny w portalu');
    const dlC = await fetch(`${base}/c/${cl.token}/documents/${doc.id}`);
    assert.equal(dlC.status, 200);
    assert.ok(Buffer.from(await dlC.arrayBuffer()).equals(bytes), 'klient: bajty zgodne');

    // usunięcie kasuje plik z dysku
    const abs = storage.absolutePath(doc.storedPath);
    await fetch(`${base}/admin/clients/${cl.id}/documents/${doc.id}/delete`, { method: 'POST', headers: { Cookie: cookie }, redirect: 'manual' });
    await wait(150);
    assert.equal(await prisma.document.count({ where: { clientId: cl.id } }), 0, 'wiersz usunięty');
    assert.ok(!fs.existsSync(abs), 'plik usunięty z dysku');
  } finally {
    await prisma.document.deleteMany({ where: { clientId: cl.id } });
    await prisma.client.delete({ where: { id: cl.id } });
  }
});
