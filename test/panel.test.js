// Konfigurowalny panel: scalanie menu/widżetów (panelUi) + zapis układu pulpitu.
// UWAGA: test dotyka wiersza Settings — snapshot + restore w finally (wspólna baza dev).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const panelUi = require('../src/utils/panelUi');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

async function login() {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }), redirect: 'manual' });
  return (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}

test('panelUi: scalanie i sanityzacja menu/widżetów', () => {
  // pusta konfiguracja = pełna lista domyślna, nic ukryte
  const def = panelUi.mergeMenu([]);
  assert.equal(def.length, panelUi.MENU.length);
  assert.ok(def.every((m) => !m.hidden));

  // zapisana kolejność + ukrycie + własna etykieta; nieznany klucz odrzucony; brakujące doklejone
  const merged = panelUi.mergeMenu([
    { key: 'clients', hidden: false, label: 'Kontrahenci' },
    { key: 'pulse', hidden: true },
    { key: 'zmyslony', hidden: true },
    { key: 'settings', hidden: true }, // wymuszane widoczne
  ]);
  assert.equal(merged[0].key, 'clients');
  assert.equal(merged[0].label, 'Kontrahenci');
  assert.equal(merged[0].defaultLabel, 'Klienci');
  assert.equal(merged[1].key, 'pulse');
  assert.equal(merged[1].hidden, true);
  assert.equal(merged.find((m) => m.key === 'settings').hidden, false, 'Ustawienia zawsze widoczne');
  assert.ok(!merged.some((m) => m.key === 'zmyslony'));
  assert.equal(merged.length, panelUi.MENU.length, 'brakujące pozycje doklejone');
  assert.equal(merged.find((m) => m.key === 'dashboard').hidden, false);

  // sanityzacja widżetów: whitelist + duplikaty
  const w = panelUi.sanitizeWidgets([{ key: 'activity', hidden: true }, { key: 'activity' }, { key: 'nope' }]);
  assert.deepEqual(w, [{ key: 'activity', hidden: true }]);
});

test('panelUi: wysokość widżetu (rows) przechodzi przez scalanie i sanityzację', () => {
  // sanityzacja: rows z whitelisty zapisane, poza listą pomijane (zostanie domyślne)
  const s = panelUi.sanitizeWidgets([
    { key: 'activity', span: 6, rows: 6 },
    { key: 'tasks', span: 4, rows: 5 },   // 5 nie jest w ROWS
    { key: 'revenue', span: 4, rows: '3' }, // string → Number()
  ]);
  assert.deepEqual(s[0], { key: 'activity', hidden: false, span: 6, rows: 6 });
  assert.deepEqual(s[1], { key: 'tasks', hidden: false, span: 4 }, 'nieznana wysokość pomijana');
  assert.equal(s[2].rows, 3, 'wartość liczbowa ze stringa');

  // scalanie: zapisana wysokość wygrywa, nieznana wraca do domyślnej z rejestru
  const m = panelUi.mergeWidgets(s);
  const byKey = Object.fromEntries(m.map((w) => [w.key, w]));
  const def = Object.fromEntries(panelUi.WIDGETS.map((w) => [w.key, w]));
  assert.equal(byKey.activity.rows, 6);
  assert.equal(byKey.tasks.rows, def.tasks.rows, 'brak zapisu → domyślna wysokość');
  assert.equal(byKey.revenue.rows, 3);
  // widżety bez wpisu w konfiguracji dostają wysokość z rejestru
  assert.equal(byKey['stat-transfers'].rows, def['stat-transfers'].rows);
  assert.ok(panelUi.WIDGETS.every((w) => panelUi.ROWS.includes(w.rows)), 'domyślne rows z whitelisty');
});

test('panelUi: minRows — wykres nie schodzi poniżej wysokości swojej treści', () => {
  // Wykres ma treść o STAŁEJ wysokości (przełącznik + SVG 196px + wiersz z kwotą) i przy
  // rows < 4 była ucinana. Zapisane niższe wartości są podnoszone na obu ścieżkach:
  // przy odczycie (samoleczenie starych układów) i przy zapisie (konfiguracja nie kłamie).
  const chart = panelUi.WIDGETS.find((w) => w.key === 'chart');
  assert.equal(chart.minRows, 4);
  assert.ok(chart.rows >= chart.minRows, 'domyślna wysokość nie mniejsza niż minimum');

  const merged = (cfg, key) => panelUi.mergeWidgets(cfg).find((w) => w.key === key).rows;
  assert.equal(merged([{ key: 'chart', rows: 2 }], 'chart'), 4, 'rows 2 → podniesione do minimum');
  assert.equal(merged([{ key: 'chart', rows: 3 }], 'chart'), 4, 'rows 3 → podniesione do minimum');
  assert.equal(merged([{ key: 'chart', rows: 6 }], 'chart'), 6, 'wyższa wartość zostaje');

  assert.equal(panelUi.sanitizeWidgets([{ key: 'chart', rows: 2 }])[0].rows, 4, 'zapis też podnosi');

  // Widżety-listy minimum NIE mają — tam wewnętrzny scroll jest naturalny.
  assert.equal(merged([{ key: 'activity', rows: 2 }], 'activity'), 2, 'lista może być niska');
  assert.equal(panelUi.sanitizeWidgets([{ key: 'activity', rows: 2 }])[0].rows, 2);
});

test('panelUi: osobny układ mobilny (mspan + morder) w scalaniu i sanityzacji', () => {
  // sanityzacja: mspan z whitelisty (1|2), morder = nieujemna liczba całkowita
  const s = panelUi.sanitizeWidgets([
    { key: 'attention', mspan: 2, morder: 0 },
    { key: 'chart', mspan: 9, morder: -3 },   // obie wartości poza zakresem → pomijane
    { key: 'tasks', mspan: '1', morder: '4' }, // stringi → Number()
  ]);
  assert.deepEqual(s[0], { key: 'attention', hidden: false, mspan: 2, morder: 0 });
  assert.deepEqual(s[1], { key: 'chart', hidden: false }, 'zła szerokość i ujemna pozycja pomijane');
  assert.equal(s[2].mspan, 1);
  assert.equal(s[2].morder, 4);

  // scalanie: zapis wygrywa, brak → domyślna z rejestru
  const m = panelUi.mergeWidgets(s);
  const byKey = Object.fromEntries(m.map((w) => [w.key, w]));
  const def = Object.fromEntries(panelUi.WIDGETS.map((w) => [w.key, w]));
  assert.equal(byKey.attention.mspan, 2);
  assert.equal(byKey.chart.mspan, def.chart.mspan, 'brak zapisu → domyślna szerokość mobilna');
  assert.equal(byKey['stat-transfers'].mspan, 1, 'kafelki KPI domyślnie ½ (jak dotąd)');
  assert.ok(panelUi.WIDGETS.every((w) => panelUi.MOBILE_SPANS.includes(w.mspan)), 'domyślne mspan z whitelisty');

  // morder jest ZAWSZE ciągły 0..n-1 (nawet gdy zapis miał dziury/duplikaty) i zachowuje
  // względną kolejność — attention (morder 0) przed tasks (morder 4).
  const orders = m.map((w) => w.morder).sort((a, b) => a - b);
  assert.deepEqual(orders, m.map((_, i) => i), 'ciągłe pozycje bez dziur');
  assert.ok(byKey.attention.morder < byKey.tasks.morder, 'względna kolejność zachowana');
});

test('pulpit: tryb Dostosuj zapisuje układ (snapshot+restore Settings)', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');

  const snap = await prisma.settings.findUnique({ where: { id: 1 }, select: { panel: true } });
  try {
    // pulpit renderuje przycisk Dostosuj i domyślne widżety
    let html = await (await fetch(`${base}/admin`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /Dostosuj/);
    assert.match(html, /Szybkie akcje/);
    assert.match(html, /Nadchodzące zadania/);

    // zapis układu: aktywność na początku (½ szerokości, XL wysokości), na telefonie ½ i PIERWSZA
    const layout = [{ key: 'activity', hidden: false, span: 6, rows: 6, mspan: 1, morder: 0 }, { key: 'actions', hidden: true }];
    const r = await fetch(`${base}/admin/dashboard/layout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams({ layout: JSON.stringify(layout) }),
    });
    assert.equal(r.status, 204);

    // po zapisie: akcje jako placeholder ukrytego, aktywność przed kafelkami
    html = await (await fetch(`${base}/admin`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /ukryty — dane po włączeniu/);
    assert.ok(html.indexOf('Ostatnia aktywność') < html.indexOf('Aktywne transfery'), 'kolejność zapisana');
    // szerokość i WYSOKOŚĆ z zapisu trafiają na klasy siatki
    assert.match(html, /lg:col-span-6 lg:row-span-6/, 'zapisana wysokość na elemencie siatki');
    assert.match(html, /lg:auto-rows-\[96px\]/, 'jednostka wysokości siatki');
    // Układ telefonu jedzie zmiennymi CSS (--ms/--mo), NIE klasami — regułę ma input.css.
    assert.match(html, /style="--ms: 1; --mo: 0;"/, 'szerokość i pozycja mobilna widżetu');
    assert.match(html, /data-resize/, 'uchwyt zmiany rozmiaru w nakładce edycji');
    // JSON idzie przez <%= %>, więc cudzysłowy są w HTML zescapowane (&#34;).
    assert.match(html, /&#34;chart&#34;:4/, 'minimalna wysokość wykresu przekazana do uchwytu');
    assert.match(html, /Układ na telefonie/, 'przełącznik trybu edycji Desktop\/Telefon');

    // menu boczne: edytor w ustawieniach obecny
    const sHtml = await (await fetch(`${base}/admin/settings`, { headers: { Cookie: cookie } })).text();
    assert.match(sHtml, /menuEditor/);
    assert.match(sHtml, /menuLabel_clients/);
  } finally {
    await prisma.settings.update({ where: { id: 1 }, data: { panel: snap ? snap.panel : null } });
  }
});
