// Przełączalny motyw panelu (classic|modern) + ukrycie pasków przewijania.
// normLayout waliduje adminTheme (whitelista) i hideScroll (bool); layout admina
// dokłada klasy `theme-modern`/`hide-scrollbars` na <html> tylko gdy ustawione.
// UWAGA: test dotyka wiersza Settings (kolumna layout) — snapshot + restore w finally.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const settingsService = require('../src/services/settings.service');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

async function login() {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }), redirect: 'manual' });
  return (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}

test('normLayout: adminTheme z whitelisty, hideScroll bool (domyślnie classic/false)', async () => {
  const snap = await prisma.settings.findUnique({ where: { id: 1 }, select: { layout: true } });
  try {
    // domyślne
    assert.equal(settingsService.DEFAULTS.layout.adminTheme, 'classic');
    assert.equal(settingsService.DEFAULTS.layout.hideScroll, false);

    const cur = (await settingsService.get()).layout;

    // modern + hideScroll przechodzą
    let s = await settingsService.update({ layout: { ...cur, adminTheme: 'modern', hideScroll: true } });
    assert.equal(s.layout.adminTheme, 'modern');
    assert.equal(s.layout.hideScroll, true);

    // nieznany motyw → classic; hideScroll koercja do bool
    s = await settingsService.update({ layout: { ...cur, adminTheme: 'zmyslony', hideScroll: 'on' } });
    assert.equal(s.layout.adminTheme, 'classic');
    assert.equal(s.layout.hideScroll, true);

    // puste → classic/false
    s = await settingsService.update({ layout: { ...cur, adminTheme: undefined, hideScroll: undefined } });
    assert.equal(s.layout.adminTheme, 'classic');
    assert.equal(s.layout.hideScroll, false);
  } finally {
    await prisma.settings.update({ where: { id: 1 }, data: { layout: snap ? snap.layout : null } });
    await settingsService.get(); // odśwież cache do stanu przed testem (update cache'uje)
  }
});

test('layout admina: klasy theme-modern/hide-scrollbars na <html> tylko gdy ustawione', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');

  const snap = await prisma.settings.findUnique({ where: { id: 1 }, select: { layout: true } });
  try {
    const cur = (await settingsService.get()).layout;

    // modern + hideScroll → obie klasy na <html>
    await settingsService.update({ layout: { ...cur, adminTheme: 'modern', hideScroll: true } });
    let html = await (await fetch(`${base}/admin`, { headers: { Cookie: cookie } })).text();
    let htmlTag = html.slice(0, html.indexOf('>', html.indexOf('<html')) + 1);
    assert.match(htmlTag, /class="[^"]*theme-modern[^"]*"/, 'theme-modern obecne przy modern');
    assert.match(htmlTag, /class="[^"]*hide-scrollbars[^"]*"/, 'hide-scrollbars obecne przy hideScroll');

    // classic bez ukrywania → żadnej z klas (regresja: classic nietknięty)
    await settingsService.update({ layout: { ...cur, adminTheme: 'classic', hideScroll: false } });
    html = await (await fetch(`${base}/admin`, { headers: { Cookie: cookie } })).text();
    htmlTag = html.slice(0, html.indexOf('>', html.indexOf('<html')) + 1);
    assert.ok(!/theme-modern/.test(htmlTag), 'brak theme-modern w classic');
    assert.ok(!/hide-scrollbars/.test(htmlTag), 'brak hide-scrollbars gdy wyłączone');
  } finally {
    await prisma.settings.update({ where: { id: 1 }, data: { layout: snap ? snap.layout : null } });
    await settingsService.get();
  }
});
