// PWA: manifest budowany z Settings, ikona zastępcza, tagi <head> tylko gdy włączone.
// UWAGA: dotyka wiersza Settings (kolumna pwa) — snapshot + restore w finally (wspólna dev-DB).
// settingsService.update({ pwa }) patchuje TYLKO kolumnę pwa (reszta ustawień nietknięta).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
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

test('manifest: wgrana ikona PNG = 192/512 „any", bez SVG-fallbacku i bez maskable', async () => {
  await settingsService.update({ pwa: { enabled: true, name: '', shortName: '', themeColor: '', background: '', display: 'minimal-ui', iconPath: '/branding/pwa_abc.png' } });
  const m = await (await fetch(`${base}/manifest.webmanifest`)).json();
  const png = m.icons.filter((i) => i.src === '/branding/pwa_abc.png');
  assert.equal(png.length, 2, '192 + 512 (any)');
  assert.ok(png.every((i) => i.purpose === 'any'), 'wgrana ikona bez maskable → system jej nie przycina');
  assert.ok(png.every((i) => i.type === 'image/png'));
  // KLUCZOWE: przy wgranej ikonie NIE dokładamy SVG (skalowalny SVG wygrywał z PNG w Chrome → ikona usera znikała)
  assert.ok(!m.icons.some((i) => i.src === '/pwa/icon.svg'), 'brak SVG-fallbacku obok wgranej ikony');
  assert.ok(!m.icons.some((i) => /maskable/.test(i.purpose || '')), 'zero maskable (bez przycinania i bez problemów z parsowaniem w Safari)');
  assert.equal(m.display, 'minimal-ui');
});

test('manifest: osobne logo → składana ikona (any + maskable), logo wygrywa z gotową ikoną', async () => {
  await settingsService.update({ pwa: { enabled: true, name: '', themeColor: '', background: '', display: 'standalone', iconPath: '/branding/ready.png', logoPath: '/branding/mark.png', logoScale: 60 } });
  const m = await (await fetch(`${base}/manifest.webmanifest`)).json();
  const svgs = m.icons.filter((i) => i.src.split('?')[0] === '/pwa/icon.svg');
  assert.equal(svgs.length, 2, 'dwa warianty: any + maskable');
  assert.ok(svgs.some((i) => i.purpose === 'any' && i.src === '/pwa/icon.svg'), 'any (zaokrąglony)');
  assert.ok(svgs.some((i) => i.purpose === 'maskable' && /mask=1/.test(i.src)), 'maskable (osobny wpis, ?mask=1)');
  assert.ok(!m.icons.some((i) => i.src === '/branding/ready.png'), 'gotowa ikona ignorowana, gdy jest logo');
});

test('ikona składana: /pwa/icon.svg osadza logo (data URI); maskable=full-bleed, any=zaokrąglony', async () => {
  const dir = path.join(__dirname, '..', 'public', 'branding');
  const file = path.join(dir, '_pwatest.png');
  // 1×1 czerwony PNG
  fs.writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  try {
    await settingsService.update({ pwa: { enabled: true, name: '', themeColor: '#6e00a5', background: '', display: 'standalone', iconPath: null, logoPath: '/branding/_pwatest.png', logoScale: 60 } });
    const any = await (await fetch(`${base}/pwa/icon.svg`)).text();
    assert.match(any, /<image[^>]+data:image\/png;base64,/, 'logo osadzone jako data URI');
    assert.match(any, /rx="96"/, 'any: zaokrąglone rogi');
    const mask = await (await fetch(`${base}/pwa/icon.svg?mask=1`)).text();
    assert.match(mask, /rx="0"/, 'maskable: full-bleed (bez zaokrągleń, OS nakłada maskę)');
    assert.match(mask, /<image/, 'maskable też ma logo');
  } finally {
    try { fs.unlinkSync(file); } catch (e) {}
  }
});

test('normalizacja logoScale: clamp 30..90, brak → 62', () => {
  return settingsService.update({ pwa: { enabled: true, logoScale: 999 } }).then((s) => {
    assert.equal(s.pwa.logoScale, 90, 'clamp do 90');
    return settingsService.update({ pwa: { enabled: true, logoScale: 5 } });
  }).then((s) => {
    assert.equal(s.pwa.logoScale, 30, 'clamp do 30');
    return settingsService.update({ pwa: { enabled: true, logoScale: 'x' } });
  }).then((s) => {
    assert.equal(s.pwa.logoScale, 62, 'brak → domyślne 62');
  });
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

test('splash: overlay + skrypt gdy włączone i splashMs>0; brak gdy 0/wyłączone', () => {
  const base = { appName: 'A', colors: { primary: '#6e00a5' }, faviconPath: null };
  const on = pwaUtil.splashHtml({ ...base, pwa: { enabled: true, splashMs: 1500, iconPath: null, background: '#101018' } });
  assert.match(on, /id="evoke-splash"/);
  assert.match(on, /display-mode: standalone/, 'pokazywany tylko w zainstalowanej aplikacji');
  assert.match(on, /sessionStorage/, 'raz na uruchomienie');
  assert.match(on, /1500/, 'użyty czas splashMs');
  assert.equal(pwaUtil.splashHtml({ ...base, pwa: { enabled: true, splashMs: 0 } }), '', 'splashMs=0 → brak');
  assert.equal(pwaUtil.splashHtml({ ...base, pwa: { enabled: false, splashMs: 1500 } }), '', 'wyłączone → brak');
});

test('splash: tryb zawartości (icon / logo / name)', () => {
  const base = { appName: 'Evoke', colors: { primary: '#6e00a5' }, faviconPath: null, logoPath: '/branding/logo.svg', logo: { darkPath: '/branding/logo_dark.svg' } };
  const icon = pwaUtil.splashHtml({ ...base, pwa: { enabled: true, splashMs: 1200, iconPath: null, background: '#ffffff', splashMode: 'icon' } });
  assert.match(icon, /pwa\/icon\.svg/, 'icon: ikona zastępcza');
  assert.match(icon, />Evoke</, 'icon: + nazwa');

  const name = pwaUtil.splashHtml({ ...base, pwa: { enabled: true, splashMs: 1200, background: '#ffffff', splashMode: 'name' } });
  assert.ok(!/<img/.test(name), 'name: bez żadnego obrazka');
  assert.match(name, />Evoke</);

  const logoLight = pwaUtil.splashHtml({ ...base, pwa: { enabled: true, splashMs: 1200, background: '#ffffff', splashMode: 'logo' } });
  assert.match(logoLight, /\/branding\/logo\.svg/, 'logo na jasnym tle: logoPath');
  const logoDark = pwaUtil.splashHtml({ ...base, pwa: { enabled: true, splashMs: 1200, background: '#101018', splashMode: 'logo' } });
  assert.match(logoDark, /\/branding\/logo_dark\.svg/, 'logo na ciemnym tle: wariant darkPath');
});

test('normalizacja splashMs: clamp 0..5000, brak → domyślne 1200', () => {
  return settingsService.update({ pwa: { enabled: true, splashMs: 99999 } }).then((s) => {
    assert.equal(s.pwa.splashMs, 5000, 'clamp do 5000');
    return settingsService.update({ pwa: { enabled: true, splashMs: 'abc' } });
  }).then((s) => {
    assert.equal(s.pwa.splashMs, 1200, 'nieprawidłowe → domyślne 1200');
  });
});

test('service worker serwowany z roota (scope /)', async () => {
  const res = await fetch(`${base}/sw.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /javascript/);
  assert.match(await res.text(), /addEventListener\('fetch'/);
});
