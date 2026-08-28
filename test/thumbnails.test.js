// Miniatury podglądów — mały JPEG z cache'u zamiast pełnego oryginału.
//
// DLACZEGO TEST: miniatura 48 px ładowała CAŁY plik (przy zdjęciu 7 MB ~1400× za dużo), i to
// nie tylko w panelu, ale też u klienta na /t i /p. Pilnujemy czterech rzeczy naraz:
// że miniatura jest realnie mała, że oryginał wciąż da się obejrzeć (Quick Look), że
// nieobsługiwany format nie psuje listy plików, i że PIERWSZE żądanie nie czeka na
// generację (dekodowanie jest wolne i idzie w tle — inaczej blokowałoby proces).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const storage = require('../src/services/storage.service');
const thumb = require('../src/services/thumb.service');
const jpeg = require('jpeg-js');

let base, server, cookie;
before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}`;
  if (!process.env.ADMIN_PASSWORD) return;
  const r = await fetch(`${base}/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }), redirect: 'manual',
  });
  cookie = (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
});
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

// Duży, „kosztowny" obraz — szum, żeby JPEG się nie skompresował do zera i test miał sens.
function bigJpeg(w, h) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i * 7) % 256; data[i + 1] = (i * 13) % 256; data[i + 2] = (i * 29) % 256; data[i + 3] = 255;
  }
  return jpeg.encode({ data, width: w, height: h }, 92).data;
}

async function fixture(tag, name, mime, bytes) {
  const transfer = await prisma.transfer.create({ data: { token: `${tag}_${Date.now()}`, direction: 'outgoing', title: 'Miniatury', status: 'active' } });
  const rel = `${transfer.token}/${name}`;
  fs.mkdirSync(path.dirname(storage.absolutePath(rel)), { recursive: true });
  fs.writeFileSync(storage.absolutePath(rel), bytes);
  const file = await prisma.file.create({ data: { transferId: transfer.id, originalName: name, storedName: name, storedPath: rel, size: BigInt(bytes.length), mimeType: mime } });
  return { transfer, file };
}
async function cleanup({ transfer, file }) {
  try { fs.rmSync(thumb.cachePath(file.storedPath), { force: true }); } catch (_) { /* mogło nie powstać */ }
  await prisma.file.deleteMany({ where: { transferId: transfer.id } });
  await prisma.event.deleteMany({ where: { transferId: transfer.id } });
  await prisma.transfer.delete({ where: { id: transfer.id } });
  storage.removeTransfer(transfer.token);
}

test('miniatura jest DUŻO mniejsza od oryginału i mieści się w limicie boku', async (t) => {
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');
  const bytes = bigJpeg(1600, 1200);
  const f = await fixture('thumb', 'duze.jpg', 'image/jpeg', bytes);
  try {
    const url = `${base}/admin/transfers/${f.transfer.id}/preview/${f.file.id}`;

    // Pierwsze wejście nie czeka na generację — dostaje oryginał, tak jak przed zmianą.
    const first = await (await fetch(`${url}?t=1`, { headers: { Cookie: cookie } })).arrayBuffer();
    assert.equal(first.byteLength, bytes.length, 'pierwsze żądanie nie blokuje się na dekodowaniu');

    // Miniatura powstaje w tle (wątek roboczy) — czekamy na nią jak na realny efekt.
    const cachePath = thumb.cachePath(f.file.storedPath);
    for (let i = 0; i < 100 && !fs.existsSync(cachePath); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(fs.existsSync(cachePath), 'miniatura wygenerowana w tle');

    const small = await (await fetch(`${url}?t=1`, { headers: { Cookie: cookie } })).arrayBuffer();
    const full = await (await fetch(url, { headers: { Cookie: cookie } })).arrayBuffer();

    assert.equal(full.byteLength, bytes.length, 'bez ?t=1 leci oryginał (Quick Look)');
    assert.ok(small.byteLength * 10 < full.byteLength,
      `miniatura ma być rząd wielkości mniejsza (${small.byteLength} vs ${full.byteLength} B)`);

    const dec = jpeg.decode(Buffer.from(small), { useTArray: true });
    assert.ok(Math.max(dec.width, dec.height) <= thumb.MAX_SIDE, 'dłuższy bok w limicie');
    assert.equal(dec.width / dec.height > 1, true, 'proporcje zachowane (obraz poziomy)');

    const res2 = await fetch(`${url}?t=1`, { headers: { Cookie: cookie } });
    assert.match(res2.headers.get('cache-control') || '', /immutable/, 'miniatura cachowana długo');
    await res2.arrayBuffer();
  } finally {
    await cleanup(f);
  }
});

test('format, którego nie dekodujemy (GIF), nie psuje listy — leci oryginał', async (t) => {
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');
  const gif = Buffer.from('47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b', 'hex');
  const f = await fixture('thumbgif', 'ikona.gif', 'image/gif', gif);
  try {
    const res = await fetch(`${base}/admin/transfers/${f.transfer.id}/preview/${f.file.id}?t=1`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    assert.equal((await res.arrayBuffer()).byteLength, gif.length, 'spokojny powrót do oryginału');
  } finally {
    await cleanup(f);
  }
});

test('uszkodzony plik nie wywraca podglądu (miniatura to nie jest ścieżka krytyczna)', async () => {
  const rel = 'nieistniejacy/plik.jpg';
  assert.equal(thumb.generate(rel, 'image/jpeg', 'plik.jpg'), null);
  const bad = await fixture('thumbbad', 'zepsuty.jpg', 'image/jpeg', Buffer.from('to nie jest obraz'));
  try {
    assert.equal(thumb.generate(bad.file.storedPath, 'image/jpeg', 'zepsuty.jpg'), null, 'null = wołający poda oryginał');
  } finally {
    await cleanup(bad);
  }
});

test('miniatury działają też na stronach klienta (/t) — tam boli najbardziej, bo komórka', async () => {
  const bytes = bigJpeg(1200, 900);
  const f = await fixture('thumbpub', 'foto.jpg', 'image/jpeg', bytes);
  try {
    const url = `${base}/t/${f.transfer.token}/preview/${f.file.id}`;
    await (await fetch(`${url}?t=1`)).arrayBuffer();                     // rozgrzewka: planuje generację
    const cachePath = thumb.cachePath(f.file.storedPath);
    for (let i = 0; i < 100 && !fs.existsSync(cachePath); i++) await new Promise((r) => setTimeout(r, 100));
    const small = await (await fetch(`${url}?t=1`)).arrayBuffer();
    const full = await (await fetch(url)).arrayBuffer();
    assert.ok(small.byteLength * 10 < full.byteLength, 'klient też dostaje miniaturę');
    assert.equal(full.byteLength, bytes.length);
  } finally {
    await cleanup(f);
  }
});
