// Podpisany link pobierania (`/dl/:token`) — obejście pułapki PWA na iOS.
//
// TO JEST POWIERZCHNIA PUBLICZNA (pomija `requireAuth`), więc test pilnuje całego modelu
// bezpieczeństwa: podpisu, czasu życia, związania z jednym zasobem i jednorazowości.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const storage = require('../src/services/storage.service');
const signed = require('../src/utils/signedLink');

let base, server, cookie;
before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}`;
  if (!process.env.ADMIN_PASSWORD) return;
  const r = await fetch(`${base}/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
    redirect: 'manual',
  });
  cookie = (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
});
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

const mint = (body) => fetch(`${base}/admin/dl-token`, {
  method: 'POST', redirect: 'manual',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json', Cookie: cookie || '' },
  body: JSON.stringify(body),
});

// Transfer z jednym prawdziwym plikiem na dysku.
async function fixture(tag, content) {
  const transfer = await prisma.transfer.create({ data: { token: `${tag}_${Date.now()}`, direction: 'outgoing', title: 'Podpisany link', status: 'active' } });
  const rel = `${transfer.token}/plik.txt`;
  fs.mkdirSync(path.dirname(storage.absolutePath(rel)), { recursive: true });
  fs.writeFileSync(storage.absolutePath(rel), content);
  const file = await prisma.file.create({ data: { transferId: transfer.id, originalName: 'plik.txt', storedName: 'plik.txt', storedPath: rel, size: BigInt(Buffer.byteLength(content)), mimeType: 'text/plain' } });
  return { transfer, file };
}
async function cleanup({ transfer }) {
  await prisma.file.deleteMany({ where: { transferId: transfer.id } });
  await prisma.event.deleteMany({ where: { transferId: transfer.id } });
  await prisma.transfer.delete({ where: { id: transfer.id } });
  storage.removeTransfer(transfer.token);
}

test('podpis: poprawny token przechodzi, podrobiony i nieznany rodzaj — nie', () => {
  const t = signed.sign('file', 12, 34);
  const data = signed.verify(t);
  assert.equal(data.kind, 'file');
  assert.equal(data.id, '12');
  assert.equal(data.extra, '34');
  assert.ok(data.nonce);

  // Podmiana ładunku przy zachowanym podpisie = odrzucenie (o to chodzi w HMAC).
  const [payload, sig] = t.split('.');
  const other = signed.sign('file', 99, 1).split('.')[0];
  assert.equal(signed.verify(`${other}.${sig}`), null, 'cudzy ładunek z tym podpisem');
  assert.equal(signed.verify(`${payload}.${sig}x`), null, 'naruszony podpis');
  assert.equal(signed.verify('bezkropki'), null);
  assert.equal(signed.verify(''), null);
  assert.equal(signed.sign('backup', 1), null, 'rodzaj spoza whitelisty');
});

test('podpis: token po czasie życia jest odrzucany', () => {
  const realNow = Date.now;
  const t = signed.sign('file', 1, 2);
  try {
    Date.now = () => realNow() + signed.TTL_MS + 1000;
    assert.equal(signed.verify(t), null, 'po TTL link nie działa');
  } finally {
    Date.now = realNow;
  }
  assert.ok(signed.verify(t), 'w oknie TTL dalej działa');
});

test('jednorazowość: drugie zużycie tego samego nonce nie przechodzi', () => {
  const nonce = 'test-' + Date.now();
  assert.equal(signed.consume(nonce), true);
  assert.equal(signed.consume(nonce), false, 'drugi raz = odmowa');
});

test('wystawianie linku wymaga logowania i istniejącego zasobu', async (t) => {
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');
  const f = await fixture('sdauth', 'x');
  try {
    const anon = await fetch(`${base}/admin/dl-token`, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'file', id: f.transfer.id, extra: f.file.id }),
    });
    assert.equal(anon.status, 302, 'bez sesji → przekierowanie na logowanie');

    assert.equal((await mint({ kind: 'backup', id: 1 })).status, 400, 'rodzaj spoza whitelisty');
    assert.equal((await mint({ kind: 'file', id: 999999, extra: 1 })).status, 404, 'nieistniejący transfer');
    assert.equal((await mint({ kind: 'file', id: f.transfer.id, extra: 999999 })).status, 404, 'plik spoza transferu');

    const ok = await mint({ kind: 'file', id: f.transfer.id, extra: f.file.id });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('cache-control') || '', /no-store/);
    const { url } = await ok.json();
    assert.match(url, /^\/dl\//, 'adres poza /admin — poza scope aplikacji');
  } finally {
    await cleanup(f);
  }
});

test('pobranie linkiem: oddaje bajty, potem link jest zużyty', async (t) => {
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');
  const content = 'zawartosc pliku ' + Date.now();
  const f = await fixture('sdget', content);
  try {
    const { url } = await (await mint({ kind: 'file', id: f.transfer.id, extra: f.file.id })).json();

    // Pobranie działa BEZ ciasteczka sesji — o to w tym chodzi (iOS: osobne ciasteczka).
    const res = await fetch(base + url);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition') || '', /^attachment/);
    assert.equal(await res.text(), content, 'bajty zgodne z plikiem');

    const again = await fetch(base + url);
    assert.equal(again.status, 410, 'link jednorazowy — drugie wejście odrzucone');
    await again.arrayBuffer();

    const forged = await fetch(`${base}/dl/podrobiony.token`);
    assert.equal(forged.status, 404);
    await forged.arrayBuffer();
  } finally {
    await cleanup(f);
  }
});

test('pobranie linkiem: brak pliku na dysku = 404, a NIE wiszące żądanie', async (t) => {
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');
  const f = await fixture('sdmiss', 'y');
  try {
    fs.rmSync(storage.absolutePath(f.file.storedPath), { force: true }); // plik znika z dysku
    const { url } = await (await mint({ kind: 'file', id: f.transfer.id, extra: f.file.id })).json();
    const res = await fetch(base + url, { signal: AbortSignal.timeout(5000) });
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('content-length'), null, 'nagłówki pliku zdjęte przed 404');
    await res.arrayBuffer();
  } finally {
    await cleanup(f);
  }
});

test('widok transferu: linki pobierania niosą marker data-dl dla skryptu iOS', async (t) => {
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');
  const f = await fixture('sdview', 'z');
  try {
    const html = await (await fetch(`${base}/admin/transfers/${f.transfer.id}`, { headers: { Cookie: cookie } })).text();
    assert.match(html, new RegExp(`data-dl="zip:${f.transfer.id}"`), 'ZIP');
    assert.match(html, new RegExp(`data-dl="file:${f.transfer.id}:${f.file.id}"`), 'plik');
    assert.match(html, /src="\/js\/pwa-downloads\.js"/, 'skrypt wpięty w layout');
  } finally {
    await cleanup(f);
  }
});

test('skrypt iOS: nawiguje bieżące okno, NIE używa window.open (pułapka zerwanego uchwytu)', async () => {
  const res = await fetch(`${base}/js/pwa-downloads.js`);
  assert.equal(res.status, 200);
  const js = await res.text();
  // W iOS standalone uchwyt zwrócony przez window.open jest zerwany — podstawienie
  // `win.location` nie ma skutku i wewnętrzna przeglądarka zostaje na about:blank
  // (zgłoszone z iPhone'a po v1.0.3). Wolno o tym pisać w komentarzu, nie wolno WYWOŁYWAĆ.
  assert.doesNotMatch(js, /window\.open\s*\(/, 'żadnego wywołania window.open');
  assert.match(js, /window\.location\.href = d\.url/, 'nawigacja bieżącego okna na podpisany link');
  assert.match(js, /navigator\.standalone/, 'bramka: tylko zainstalowana aplikacja');
});
