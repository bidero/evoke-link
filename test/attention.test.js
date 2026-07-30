// Widżet „Wymaga uwagi" (stats.service.attention) + widżet wykresu na pulpicie.
// UWAGA: test dotyka wiersza Settings (układ pulpitu) — snapshot + restore w finally.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const statsService = require('../src/services/stats.service');
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

test('attention(): łapie 4 sygnały, liczy BRUTTO i linkuje do właściwych ekranów', async () => {
  const stamp = Date.now();
  const before0 = await statsService.attention();
  const keysBefore = new Set(before0.items.map((i) => i.key));

  const cl = await prisma.client.create({ data: { name: 'Uwaga ' + stamp, token: 'uwt_' + stamp } });
  const ch = await prisma.charge.create({ data: { clientId: cl.id, label: 'Zaległa', amount: 100000, vatRate: 23, dueDate: new Date(Date.now() - 5 * 86400e3) } });
  const tr = await prisma.transfer.create({ data: { token: 'uwtt_' + stamp, direction: 'outgoing', title: 'Wygasa ' + stamp, expiresAt: new Date(Date.now() + 20 * 3600e3) } });
  const msg = await prisma.message.create({ data: { direction: 'in', body: 'pytanie', clientId: cl.id, isRead: false } });
  const rem = await prisma.reminder.create({ data: { title: 'Zaległe ' + stamp, dueAt: new Date(Date.now() - 86400e3) } });
  try {
    const a = await statsService.attention();
    const by = Object.fromEntries(a.items.map((i) => [i.key, i]));
    assert.equal(a.count, a.items.length);
    for (const k of ['overdue', 'expiring', 'messages', 'tasks']) assert.ok(by[k], 'sygnał obecny: ' + k);

    // Kwota po terminie liczona BRUTTO (100000 gr netto + 23% = 123000 gr).
    assert.match(by.overdue.value, /1 ?230,00/, 'brutto z VAT: ' + by.overdue.value);
    assert.equal(by.overdue.tone, 'red');
    assert.match(by.expiring.href, /^\/admin\/transfers\?/);
    assert.equal(by.messages.href, '/admin/messages');
    assert.equal(by.tasks.href, '/admin/tasks');
    // Każdy sygnał ma to, czego widok potrzebuje do renderu.
    a.items.forEach((i) => ['label', 'value', 'sub', 'icon', 'tone', 'href'].forEach((f) => assert.ok(i[f], `${i.key}.${f}`)));

    // Transfer POBRANY przestaje być sygnałem (ten sam warunek co ostrzeżenie mailowe).
    await prisma.transfer.update({ where: { id: tr.id }, data: { downloadCount: 1 } });
    const a2 = await statsService.attention();
    const exp2 = a2.items.find((i) => i.key === 'expiring');
    const expected = keysBefore.has('expiring') ? Number(by.expiring.value) - 1 : 0;
    assert.equal(exp2 ? Number(exp2.value) : 0, expected, 'pobrany transfer wypada z sygnału');
  } finally {
    await prisma.reminder.delete({ where: { id: rem.id } }).catch(() => {});
    await prisma.message.delete({ where: { id: msg.id } }).catch(() => {});
    await prisma.transfer.delete({ where: { id: tr.id } }).catch(() => {});
    await prisma.charge.delete({ where: { id: ch.id } }).catch(() => {});
    await prisma.client.delete({ where: { id: cl.id } }).catch(() => {});
  }
});

test('pulpit: widżety „Wymaga uwagi" i wykres w rejestrze i w renderze (snapshot+restore Settings)', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');

  // Rejestr: nowe klucze są znane i mają domyślne rozmiary z whitelisty.
  const reg = Object.fromEntries(panelUi.WIDGETS.map((w) => [w.key, w]));
  for (const k of ['attention', 'chart']) {
    assert.ok(reg[k], 'widżet w rejestrze: ' + k);
    assert.ok(panelUi.SPANS.includes(reg[k].span) && panelUi.ROWS.includes(reg[k].rows));
  }

  const snap = await prisma.settings.findUnique({ where: { id: 1 }, select: { panel: true } });
  try {
    const layout = [{ key: 'attention', hidden: false, span: 4, rows: 4 }, { key: 'chart', hidden: false, span: 8, rows: 4 }];
    const r = await fetch(`${base}/admin/dashboard/layout`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams({ layout: JSON.stringify(layout) }),
    });
    assert.equal(r.status, 204);

    const html = await (await fetch(`${base}/admin`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /Wymaga uwagi/);
    assert.match(html, /Przychód — 6 miesięcy/);
    assert.match(html, /evoke-chart-type/, 'przełącznik typu wykresu z pamięcią');
    // Geometria wykresu liczy się PO STRONIE KLIENTA (ResizeObserver + real-px SVG, v0.99.79) —
    // sprawdzamy obecność kontenera/danych i mechanizmu rysowania, nie statycznego <path>/<rect>.
    assert.match(html, /data-chart-mount/, 'kontener z danymi wykresu');
    assert.match(html, /data-chart-svg/, 'pusty SVG wypełniany przez JS');
    assert.match(html, /ResizeObserver/, 'redraw na zmianę szerokości (nie tylko window resize)');
    assert.match(html, /evokeChartRedraw/, 'redraw przy przełączniku linia\/słupki');
    assert.match(html, /"current":true/, 'flaga bieżącego miesiąca w danych (do rysowania w JS)');
    assert.ok(html.indexOf('Wymaga uwagi') < html.indexOf('Przychód — 6 miesięcy'), 'kolejność z zapisanego układu');
  } finally {
    await prisma.settings.update({ where: { id: 1 }, data: { panel: snap ? snap.panel : null } });
  }
});
