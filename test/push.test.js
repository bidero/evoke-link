// Web Push: klucze VAPID, subskrypcje per przeglądarka, bramki i service worker.
// UWAGA: dotyka wiersza Settings (kolumna pwa) — snapshot + restore w finally.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const settingsService = require('../src/services/settings.service');
const pushService = require('../src/services/push.service');

let base, server, savedPwa;
before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}`;
  savedPwa = (await settingsService.get()).pwa;
});
after(async () => {
  await settingsService.update({ pwa: savedPwa });
  await new Promise((r) => server.close(r));
  await prisma.$disconnect();
});

async function login() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: process.env.ADMIN_EMAIL, password }), redirect: 'manual' });
  return (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}

const fakeSub = (n) => ({
  endpoint: 'https://fcm.googleapis.com/fcm/send/UNIT-' + n,
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
});

test('klucze VAPID: w pliku storage, NIGDY w ustawieniach (te trafiają do locals widoków)', async () => {
  const pub = pushService.publicKey();
  assert.ok(pub && pub.length > 60, 'klucz publiczny wygenerowany');
  assert.ok(fs.existsSync(pushService.KEYS_FILE), 'zapisany w storage/vapid.json');

  const onDisk = JSON.parse(fs.readFileSync(pushService.KEYS_FILE, 'utf8'));
  assert.ok(onDisk.privateKey, 'klucz prywatny na dysku');
  assert.equal(onDisk.publicKey, pub, 'ten sam klucz przy kolejnym odczycie (nie regenerujemy)');

  // Kluczowa właściwość bezpieczeństwa: ustawienia lądują w res.locals KAŻDEGO widoku
  // (i bywają serializowane do JSON w atrybutach Alpine) — prywatnego klucza tam być nie może.
  const s = await settingsService.get();
  assert.ok(!JSON.stringify(s).includes(onDisk.privateKey), 'klucz prywatny nie przecieka do ustawień');
});

test('subskrypcje: zapis bez duplikatów, etykieta urządzenia, wypisanie', async () => {
  const sub = fakeSub('a-' + Date.now());
  try {
    const first = await pushService.subscribe(sub, { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605.1' });
    assert.ok(first && first.id);
    assert.equal(first.label, 'iPhone/iPad · Safari', 'czytelna etykieta urządzenia');

    // Ten sam endpoint = odświeżenie, nie duplikat.
    await pushService.subscribe(sub, { ua: 'Mozilla/5.0 (Macintosh; Mac OS X) Chrome/120' });
    assert.equal(await prisma.pushSubscription.count({ where: { endpoint: sub.endpoint } }), 1, 'brak duplikatu');
    const again = await prisma.pushSubscription.findUnique({ where: { endpoint: sub.endpoint } });
    assert.equal(again.label, 'Mac · Chrome', 'etykieta odświeżona');

    // Śmieciowe dane odrzucone.
    assert.equal(await pushService.subscribe({ endpoint: 'x' }), null, 'brak kluczy = odrzucone');
    assert.equal(await pushService.subscribe(null), null);

    await pushService.unsubscribe(sub.endpoint);
    assert.equal(await prisma.pushSubscription.count({ where: { endpoint: sub.endpoint } }), 0, 'wypisane');
  } finally {
    await prisma.pushSubscription.deleteMany({ where: { endpoint: { contains: 'UNIT-' } } });
  }
});

test('notify: bramka ustawień i brak subskrypcji (nic nie wysyłamy po cichu)', async () => {
  await settingsService.update({ pwa: { enabled: true, display: 'standalone', push: false } });
  assert.deepEqual(await pushService.notify({ title: 't', body: 'b' }), { skipped: true }, 'push wyłączony w ustawieniach');

  await settingsService.update({ pwa: { enabled: false, display: 'standalone', push: true } });
  assert.deepEqual(await pushService.notify({ title: 't', body: 'b' }), { skipped: true }, 'PWA wyłączone');

  // Włączone, ale nikt nie zasubskrybował → też nic (i bez błędu).
  await settingsService.update({ pwa: { enabled: true, display: 'standalone', push: true } });
  await prisma.pushSubscription.deleteMany({});
  assert.deepEqual(await pushService.notify({ title: 't', body: 'b' }), { skipped: true }, 'brak urządzeń');
});

test('endpointy push wymagają logowania; /push/config oddaje klucz publiczny', async (t) => {
  for (const [m, url] of [['GET', '/admin/push/config'], ['POST', '/admin/push/subscribe'], ['POST', '/admin/push/test']]) {
    const r = await fetch(base + url, { method: m, redirect: 'manual' });
    assert.match(r.headers.get('location') || '', /\/admin\/login/, `${m} ${url} za bramką logowania`);
  }

  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');

  await settingsService.update({ pwa: { enabled: true, display: 'standalone', push: true } });
  const cfg = await (await fetch(`${base}/admin/push/config`, { headers: { Cookie: cookie } })).json();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.publicKey, pushService.publicKey());
  assert.ok(!('privateKey' in cfg), 'klucz prywatny nigdy nie opuszcza serwera');

  // Przy wyłączonym push subskrypcja jest odrzucana (a nie po cichu zapisywana).
  await settingsService.update({ pwa: { enabled: true, display: 'standalone', push: false } });
  const res = await fetch(`${base}/admin/push/subscribe`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ subscription: fakeSub('gate') }),
  });
  assert.equal(res.status, 403);
  assert.equal(await prisma.pushSubscription.count({ where: { endpoint: { contains: 'UNIT-gate' } } }), 0);
});

test('service worker: obsługa push, kliknięcia i licznika na ikonie', async () => {
  const sw = await (await fetch(`${base}/sw.js`)).text();
  assert.match(sw, /addEventListener\('push'/, 'handler push (budzi apkę przy zamkniętym oknie)');
  assert.match(sw, /notificationclick/, 'klik w powiadomienie otwiera/podnosi okno');
  assert.match(sw, /setAppBadge/, 'push aktualizuje licznik na ikonie');
  assert.match(sw, /showNotification/, 'banerek — wymagany przez userVisibleOnly');
});
