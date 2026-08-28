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

test('zwijane lewe menu: markery paska + przełącznik toggleRail w layoucie', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');

  const snap = await prisma.settings.findUnique({ where: { id: 1 }, select: { panel: true } });
  try {
    // Zapewnij co najmniej jedną widoczną pozycję paska (Pulpit) — „Ustawienia"/„Konto"
    // są teraz w menu profilu (prawy górny róg) i celowo pominięte w pasku.
    const cur = (await settingsService.get()).panel;
    await settingsService.update({ panel: { menu: [{ key: 'dashboard', hidden: false }], dashboard: cur.dashboard, actions: cur.actions } });

    const html = await (await fetch(`${base}/admin`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /data-admin-sidebar/, 'aside ma data-admin-sidebar');
    assert.match(html, /data-rail-item/, 'pozycje menu mają data-rail-item');
    assert.match(html, /data-rail-label/, 'etykiety mają data-rail-label (chowane po zwinięciu)');
    assert.match(html, /rail-collapsed/, 'init klasy rail-collapsed w <head>');
    assert.match(html, /window\.toggleRail\s*=/, 'globalny toggleRail zdefiniowany');
    // Ustawienia/Wyloguj przeniesione do menu profilu w nagłówku
    assert.match(html, /Menu konta/, 'przycisk menu profilu w nagłówku');
  } finally {
    await prisma.settings.update({ where: { id: 1 }, data: { panel: snap ? snap.panel : null } });
    await settingsService.get();
  }
});

test('offcanvas na telefonie: pełna szerokość, zamykanie i sekcja konta + sync theme-color', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');

  const html = await (await fetch(`${base}/admin`, { headers: { Cookie: cookie } })).text();

  // Telefon: menu na CAŁĄ szerokość; od md wraca pasek 15rem (zero regresji na desktopie).
  assert.match(html, /data-admin-sidebar[^>]*\bw-full md:w-60\b/, 'offcanvas pełnoekranowy tylko poniżej md');
  assert.match(html, /data-nav-close/, 'przycisk zamknięcia menu (brak przyciemnienia do kliknięcia)');
  assert.match(html, /overflow-hidden md:overflow-visible/, 'blokada przewijania tła przy otwartym menu');
  // Przyciemnienia NIE MA (v0.99.83): przy fixed-menu na iOS zostawało w odsłoniętym skrawku
  // i barwiło paski Safari na szaro. Zamykanie zapewnia przycisk X, nie klik w tło.
  assert.ok(!/bg-black\/40/.test(html), 'brak przyciemnienia pod offcanvasem');

  // Sekcja konta w menu — tylko na telefonie, z tymi samymi trasami co dropdown w nagłówku.
  const acc = html.slice(html.indexOf('data-nav-account'), html.indexOf('</aside>'));
  assert.match(acc, /md:hidden/, 'sekcja konta ukryta na desktopie');
  assert.match(acc, /\/admin\/account/);
  assert.match(acc, /\/admin\/users/);
  assert.match(acc, /\/admin\/settings/);
  assert.match(acc, /action="\/admin\/logout"/, 'wylogowanie jako POST (jak w dropdownie)');

  // Pozycje konta są ZWINIĘTE — rozwija je dopiero pasek z awatarem i nazwą.
  assert.match(acc, /data-nav-account-toggle/, 'pasek użytkownika jest przyciskiem');
  assert.match(acc, /x-data="\{ acct: false \}"/, 'domyślnie zwinięte');
  assert.match(acc, /x-effect="if \(!nav\) acct = false"/, 'zamknięcie menu zwija sekcję');
  // Same pozycje siedzą za x-show — przycisk jest PRZED nimi w dokumencie.
  const toggleAt = acc.indexOf('data-nav-account-toggle');
  const listAt = acc.indexOf('x-show="acct"');
  assert.ok(listAt > toggleAt && listAt > -1, 'lista pozycji za przełącznikiem, sterowana x-show');

  // Nagłówek trzyma się góry na KAŻDEJ szerokości, ale INNYM mechanizmem (v0.99.90):
  // telefon = `fixed` + rozpórka (iOS gubi `sticky` przy inercyjnym przewijaniu),
  // desktop = `sticky` (fixed nachodziłby na pasek boczny).
  assert.match(html, /<header class="h-16 shrink-0 fixed inset-x-0 top-0 z-20 md:sticky md:inset-x-auto/, 'nagłówek fixed na telefonie, sticky od md');
  assert.match(html, /<div class="h-16 shrink-0 md:hidden" aria-hidden="true"><\/div>/, 'rozpórka pod fixed nagłówkiem');
  // Offcanvas mierzony w `dvh`, nie `inset-y-0` — inaczej na iOS dolna sekcja (konto)
  // wypada pod krawędź ekranu (Safari liczy bottom:0 do DUŻEGO viewportu).
  assert.match(html, /data-admin-sidebar[^>]*\bh-\[100dvh\]/, 'wysokość menu w dvh');
  assert.ok(!/data-admin-sidebar[^>]*\binset-y-0\b/.test(html), 'brak inset-y-0 na offcanvasie');

  // Pasek systemowy: kolor synchronizowany z treścią (nagłówek / otwarte menu / dark mode).
  assert.match(html, /window\.evokeSyncThemeColor\s*=/, 'funkcja synchronizująca theme-color');
  assert.match(html, /nav-open/, 'klasa nav-open steruje źródłem koloru');
  assert.match(html, /toggleTheme[\s\S]{0,220}evokeSyncThemeColor/, 'zmiana dark mode przelicza kolor paska');
});

test('powiadomienia: akcje w stosie na telefonie + krótka etykieta + większy obszar dotyku', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');
  // Przyciski nagłówka renderują się tylko, gdy JEST co czyścić (a „przeczytane" — gdy są nowe).
  const ev = await prisma.event.create({ data: { type: 'uploaded', message: 'TEST notif mobile ' + Date.now(), isRead: false } });
  try {
    const html = await (await fetch(`${base}/admin/notifications`, { headers: { Cookie: cookie } })).text();

    // Stos na telefonie, rząd od sm: — w jednym rzędzie przyciski wychodziły poza 390 px.
    assert.match(html, /class="page-head mb-6"/, 'nagłówek ekranu z warstwy komponentów');
    // Pasek akcji z warstwy komponentów: dzieli rząd na telefonie i zawija zamiast wypychać.
    assert.match(html, /class="actions sm:shrink-0"/);
    assert.match(html, /class="btn btn-secondary/, 'przyciski z warstwy komponentów, nie klasy ad hoc');
    assert.match(html, /class="btn btn-danger/);

    // Długa etykieta skrócona na telefonie, pełna od sm:.
    assert.match(html, /<span class="sm:hidden">Przeczytane<\/span>/);
    assert.match(html, /<span class="hidden sm:inline">Oznacz wszystkie jako przeczytane<\/span>/);

    // Kosz: obszar dotyku pilnuje teraz .btn-icon (min 44 px poniżej md).
    assert.match(html, /class="btn-icon/);
  } finally {
    await prisma.event.delete({ where: { id: ev.id } });
  }
});
