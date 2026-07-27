// PWA: manifest budowany z Settings, ikona zastępcza, tagi <head> tylko gdy włączone.
// UWAGA: dotyka wiersza Settings (kolumna pwa) — snapshot + restore w finally (wspólna dev-DB).
// settingsService.update({ pwa }) patchuje TYLKO kolumnę pwa (reszta ustawień nietknięta).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const settingsService = require('../src/services/settings.service');
const pwaUtil = require('../src/utils/pwa');

let base, server, savedPwa;
before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}`;
  savedPwa = (await settingsService.get()).pwa; // snapshot
});
after(async () => {
  await settingsService.update({ pwa: savedPwa }); // restore
  await new Promise((r) => server.close(r));
  await prisma.$disconnect();
});

test('manifest: struktura + wartości z ustawień + typ MIME', async () => {
  await settingsService.update({ pwa: { enabled: true, name: 'Moja Apka', shortName: 'Apka', themeColor: '#123456', background: '#ffffff', display: 'standalone', iconPath: null } });
  const res = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/manifest\+json/);
  const m = await res.json();
  assert.equal(m.name, 'Moja Apka');
  assert.equal(m.short_name, 'Apka');
  assert.equal(m.start_url, '/admin');
  assert.equal(m.display, 'standalone');
  assert.equal(m.theme_color, '#123456');
  assert.ok(m.icons.some((i) => i.src === '/pwa/icon.svg'), 'fallback SVG zawsze w icons');
});

test('manifest: wgrana ikona PNG deklaruje 192/512 + maskable', async () => {
  await settingsService.update({ pwa: { enabled: true, name: '', shortName: '', themeColor: '', background: '', display: 'minimal-ui', iconPath: '/branding/pwa_abc.png' } });
  const m = await (await fetch(`${base}/manifest.webmanifest`)).json();
  const png = m.icons.filter((i) => i.src === '/branding/pwa_abc.png');
  assert.equal(png.length, 3, '192 + 512 + maskable');
  assert.ok(png.some((i) => i.purpose === 'maskable'));
  assert.ok(png.every((i) => i.type === 'image/png'));
  assert.equal(m.display, 'minimal-ui');
});

test('ikona zastępcza: SVG z inicjałem nazwy', async () => {
  await settingsService.update({ pwa: { enabled: true, name: 'Zenit Studio', shortName: '', themeColor: '#6e00a5', background: '', display: 'standalone', iconPath: null } });
  const res = await fetch(`${base}/pwa/icon.svg`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /image\/svg\+xml/);
  const svg = await res.text();
  assert.match(svg, /<svg/);
  assert.match(svg, />Z</, 'inicjał „Z" z nazwy');
});

test('normalizacja pwa: display z whitelisty, hex, iconPath', () => {
  // przez utils (czysta funkcja przez settingsService.get po zapisie)
  const bad = { enabled: 'yes', name: '  X  ', shortName: 'Y', themeColor: 'zzz', background: '#fff', display: 'kosmos', iconPath: '' };
  // symulacja przez get: zapiszemy i odczytamy
  return settingsService.update({ pwa: bad }).then((s) => {
    assert.equal(s.pwa.enabled, true);
    assert.equal(s.pwa.name, 'X', 'trim');
    assert.equal(s.pwa.themeColor, '', 'zły hex → puste (fallback do primary)');
    assert.equal(s.pwa.background, '#fff');
    assert.equal(s.pwa.display, 'standalone', 'nieznany tryb → standalone');
    assert.equal(s.pwa.iconPath, null, 'puste → null');
  });
});

test('tagi <head>: emitowane tylko gdy włączone', () => {
  const on = pwaUtil.headTags({ appName: 'A', colors: { primary: '#6e00a5' }, faviconPath: null, pwa: { enabled: true, display: 'standalone' } });
  assert.match(on, /rel="manifest"/);
  assert.match(on, /serviceWorker/);
  const off = pwaUtil.headTags({ appName: 'A', colors: { primary: '#6e00a5' }, faviconPath: null, pwa: { enabled: false } });
  assert.equal(off, '', 'wyłączone = brak tagów');
});

test('service worker serwowany z roota (scope /)', async () => {
  const res = await fetch(`${base}/sw.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /javascript/);
  assert.match(await res.text(), /addEventListener\('fetch'/);
});
