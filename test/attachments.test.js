// Załączniki wiadomości: klient wysyła plik w wątku (/c), agencja pobiera z panelu.
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

test('załącznik: klient dołącza plik do wiadomości, agencja pobiera z panelu', async () => {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  const cl = await prisma.client.create({ data: { name: 'Załącznik ' + Date.now(), token: 'att_' + Date.now() } });
  const bytes = Buffer.from('PDF-udawany-kontrakt-' + Date.now());
  try {
    // wysyłka wiadomości z plikiem (multipart)
    const fd = new FormData();
    fd.append('body', 'W załączeniu podpisana umowa.');
    fd.append('senderName', 'Jan Klient');
    fd.append('attachment', new Blob([bytes], { type: 'application/pdf' }), 'umowa.pdf');
    const r = await fetch(`${base}/c/${cl.token}/message`, { method: 'POST', body: fd, redirect: 'manual' });
    assert.equal(r.status, 302);
    await wait(200);

    const msg = await prisma.message.findFirst({ where: { clientId: cl.id } });
    assert.ok(msg, 'wiadomość zapisana');
    assert.equal(msg.attachmentName, 'umowa.pdf');
    assert.equal(msg.attachmentMime, 'application/pdf');
    assert.equal(msg.attachmentSize, bytes.length);
    assert.ok(msg.attachmentPath && msg.attachmentPath.replace(/\\/g, '/').startsWith('_messages/'), 'ścieżka w _messages/');
    assert.ok(fs.existsSync(storage.absolutePath(msg.attachmentPath)), 'plik na dysku');

    // badge w wątku klienta (portal /c)
    const portal = await (await fetch(`${base}/c/${cl.token}`)).text();
    assert.match(portal, /umowa\.pdf/, 'nazwa pliku widoczna w wątku klienta');

    // pobranie z panelu (wymaga logowania)
    if (password) {
      const lr = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }), redirect: 'manual' });
      const cookie = (lr.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
      const dl = await fetch(`${base}/admin/messages/${msg.id}/attachment`, { headers: { Cookie: cookie } });
      assert.equal(dl.status, 200);
      assert.match(dl.headers.get('content-disposition') || '', /umowa\.pdf/);
      const got = Buffer.from(await dl.arrayBuffer());
      assert.ok(got.equals(bytes), 'pobrane bajty = wysłane');
    }

    // pusta treść + plik → brak wiadomości i brak osieroconego pliku (sprzątanie tmp)
    const fd2 = new FormData();
    fd2.append('body', '   ');
    fd2.append('attachment', new Blob([Buffer.from('x')], { type: 'text/plain' }), 'pusty.txt');
    await fetch(`${base}/c/${cl.token}/message`, { method: 'POST', body: fd2, redirect: 'manual' });
    await wait(150);
    assert.equal(await prisma.message.count({ where: { clientId: cl.id } }), 1, 'pusta treść nie tworzy wiadomości');

    // kasowanie wątku usuwa plik z dysku
    const abs = storage.absolutePath(msg.attachmentPath);
    const messageService = require('../src/services/message.service');
    await messageService.deleteThread(msg);
    assert.ok(!fs.existsSync(abs), 'plik usunięty razem z wątkiem');
  } finally {
    await prisma.message.deleteMany({ where: { clientId: cl.id } });
    await prisma.client.delete({ where: { id: cl.id } });
  }
});
