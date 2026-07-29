// Personalizacja logowania (Etap 3): normLogin + render obu układów (card/split) z tekstami.
// Dotyka wiersza Settings (kolumna login) — snapshot + restore w finally.
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

test('logowanie: normalizacja ustawień + render układów card/split z własnymi tekstami', async () => {
  const snap = await prisma.settings.findUnique({ where: { id: 1 }, select: { login: true } });
  try {
    // domyślne
    assert.equal(settingsService.DEFAULTS.login.style, 'card');

    // nieznany układ/strona → wartości domyślne; teksty przycinane
    let s = await settingsService.update({ login: { style: 'zmyslony', side: 'gdzies', title: '  Witaj  ', hideName: 'on' } });
    assert.equal(s.login.style, 'card', 'nieznany układ → card');
    assert.equal(s.login.side, 'left', 'nieznana strona → left');
    assert.equal(s.login.title, 'Witaj', 'tytuł przycięty (trim)');
    assert.equal(s.login.hideName, true, 'koercja do bool');

    // card z własnymi tekstami — widoczne na stronie logowania
    await settingsService.update({ login: { style: 'card', side: 'left', title: 'Witaj ponownie', subtitle: 'Panel Evoke.', heroTitle: '', heroSubtitle: '', hideName: false, footer: 'Stopka testowa' } });
    let html = await (await fetch(`${base}/admin/login`)).text();
    assert.match(html, /Witaj ponownie/, 'własny nagłówek');
    assert.match(html, /Panel Evoke\./, 'własny podpis');
    assert.match(html, /Stopka testowa/, 'własna stopka');

    // split z hero — panel marki obecny
    await settingsService.update({ login: { style: 'split', side: 'right', title: 'Zaloguj', subtitle: '', heroTitle: 'HERO_TYTUL', heroSubtitle: 'HERO_PODPIS', hideName: false, footer: '' } });
    html = await (await fetch(`${base}/admin/login`)).text();
    assert.match(html, /HERO_TYTUL/, 'hero tytuł w panelu marki');
    assert.match(html, /HERO_PODPIS/, 'hero podpis');
    assert.match(html, /md:order-2/, 'kolejność kolumn (formularz po prawej)');
    assert.match(html, /name="password"/, 'formularz logowania obecny w układzie split');
  } finally {
    await prisma.settings.update({ where: { id: 1 }, data: { login: snap ? snap.login : null } });
    await settingsService.get();
  }
});
