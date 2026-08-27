// Pobrania w panelu MUSZĄ być pobraniami, nie nawigacją.
//
// DLACZEGO TEST: w zainstalowanej aplikacji (PWA) panel jest w `scope` — i ma być, bo to jest
// aplikacja. Zwykły link do pliku jest wtedy NAWIGACJĄ, więc plik otwiera się w oknie apki
// zamiast trafić do menedżera pobierania. Sygnałem „to pobranie" jest atrybut `download`
// na linku + `Content-Disposition: attachment` w odpowiedzi — pilnujemy OBU, bo sam nagłówek
// bez atrybutu nie wystarczył (zgłoszone z realnego urządzenia).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const storage = require('../src/services/storage.service');

let base, server, cookie;
before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}`;
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return;
  const r = await fetch(`${base}/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: process.env.ADMIN_EMAIL, password }), redirect: 'manual',
  });
  cookie = (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
});
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

test('transfer: linki pobierania mają `download`, podgląd (inline) NIE ma', async (t) => {
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');
  const stamp = Date.now();
  const transfer = await prisma.transfer.create({ data: { token: 'dlattr_' + stamp, direction: 'outgoing', title: 'DL attr', status: 'active' } });
  // Jeden plik zwykły i jeden obrazek (obrazek dokłada kafelek podglądu z trasą inline).
  // storedPath jest względny do storage.absolutePath (config.storageDir = ./storage/transfers) —
  // ścieżkę budujemy przez serwis, żeby test nie zakładał układu katalogów.
  const rel = (name) => `${transfer.token}/${name}`;
  fs.mkdirSync(path.dirname(storage.absolutePath(rel('a.txt'))), { recursive: true });
  fs.writeFileSync(storage.absolutePath(rel('a.txt')), 'tresc');
  fs.writeFileSync(storage.absolutePath(rel('b.png')), Buffer.from('89504e470d0a1a0a', 'hex'));
  const doc = await prisma.file.create({ data: { transferId: transfer.id, originalName: 'a.txt', storedName: 'a.txt', storedPath: rel('a.txt'), size: BigInt(5), mimeType: 'text/plain' } });
  const img = await prisma.file.create({ data: { transferId: transfer.id, originalName: 'b.png', storedName: 'b.png', storedPath: rel('b.png'), size: BigInt(8), mimeType: 'image/png' } });
  try {
    const html = await (await fetch(`${base}/admin/transfers/${transfer.id}`, { headers: { Cookie: cookie } })).text();

    // Każdy link do pliku/ZIP-a niesie `download`.
    const linkHas = (href) => new RegExp(`<a[^>]*href="${href.replace(/[/]/g, '\\/')}"[^>]*\\sdownload[\\s>]`).test(html)
      || new RegExp(`<a[^>]*\\sdownload[^>]*href="${href.replace(/[/]/g, '\\/')}"`).test(html);
    assert.ok(linkHas(`/admin/transfers/${transfer.id}/zip`), 'ZIP ma download');
    assert.ok(linkHas(`/admin/transfers/${transfer.id}/file/${doc.id}`), 'plik ma download');

    // Podgląd jest `inline` (Quick Look) — atrybut `download` byłby tu BŁĘDEM.
    const prev = `/admin/transfers/${transfer.id}/preview/${img.id}`;
    assert.ok(html.includes(prev), 'kafelek podglądu obecny');
    assert.ok(!linkHas(prev), 'podgląd NIE ma download');

    // Odpowiedź serwera nadal deklaruje załącznik (drugi filar).
    const res = await fetch(`${base}/admin/transfers/${transfer.id}/file/${doc.id}`, { headers: { Cookie: cookie } });
    assert.match(res.headers.get('content-disposition') || '', /^attachment/);
    await res.arrayBuffer();
    const inline = await fetch(`${base}/admin/transfers/${transfer.id}/preview/${img.id}`, { headers: { Cookie: cookie } });
    assert.match(inline.headers.get('content-disposition') || '', /inline/);
    await inline.arrayBuffer();
  } finally {
    await prisma.file.deleteMany({ where: { transferId: transfer.id } });
    await prisma.event.deleteMany({ where: { transferId: transfer.id } });
    await prisma.transfer.delete({ where: { id: transfer.id } });
    storage.removeTransfer(transfer.token);
  }
});
