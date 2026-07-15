// PDF rozliczenia: dokument z wieloma projektami (wielostronicowy) generuje się bez błędu.
// Chroni ścieżkę z callbackiem pageBreakBefore (tytuł projektu nie zostaje osierocony na
// dole strony). Nie parsujemy layoutu — asercja: poprawny, niepusty PDF i brak wyjątku.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const pdfService = require('../src/services/pdf.service');
const { buildDoc } = pdfService;

const settings = { appName: 'Evoke LINK', colors: { primary: '#6e00a5' }, pdf: {} };
const client = { id: 42, name: 'Klient Testowy', company: 'ACME', token: 'x' };

// Dużo pozycji w kilku projektach — wymusza podział na strony i tytuły projektów
// w różnych miejscach (część blisko dolnej krawędzi).
function makeCharges() {
  const out = [];
  for (let p = 1; p <= 5; p++) {
    const project = { id: p, name: 'Projekt numer ' + p };
    for (let i = 0; i < 12; i++) {
      out.push({
        project,
        label: `Pozycja ${i + 1} projektu ${p}`,
        amount: 12300 + i * 100,
        vatRate: i % 2 ? 23 : null,
        date: new Date(2026, 0, 1 + p * 3 + i),
        paidAt: i % 3 === 0 ? new Date(2026, 1, 1) : null,
      });
    }
  }
  return out;
}

test('wielostronicowy PDF z wieloma projektami generuje się poprawnie', async () => {
  const buf = await pdfService.clientStatementBuffer({ client, charges: makeCharges(), filters: {}, settings });
  assert.ok(Buffer.isBuffer(buf), 'zwraca Buffer');
  assert.equal(buf.slice(0, 5).toString('latin1'), '%PDF-', 'nagłówek PDF');
  assert.ok(buf.length > 3000, 'niepusty dokument (' + buf.length + ' B)');
});

test('pusta lista pozycji też generuje PDF', async () => {
  const buf = await pdfService.clientStatementBuffer({ client, charges: [], filters: {}, settings });
  assert.equal(buf.slice(0, 5).toString('latin1'), '%PDF-');
});

// Rekurencyjnie zbiera wszystkie węzły `text` z docDef (do asercji obecności etykiet).
function allText(node, acc = []) {
  if (node == null) return acc;
  if (Array.isArray(node)) { node.forEach((n) => allText(n, acc)); return acc; }
  if (typeof node === 'object') {
    if (typeof node.text === 'string') acc.push(node.text);
    Object.keys(node).forEach((k) => { if (k !== 'text' && typeof node[k] === 'object') allText(node[k], acc); });
  }
  return acc;
}

test('hideSeller: dokument bez „Sprzedawca" i bez linii z kontem', () => {
  const seller = { name: 'EVOKE Sp. z o.o.', address: 'ul. Testowa 1', nip: '1234567890', bank: 'PL61109010140000071219812874' };
  const charges = makeCharges();
  const withSeller = buildDoc({ client, charges, filters: {}, settings: { ...settings, pdf: { seller } } });
  const hidden = buildDoc({ client, charges, filters: {}, settings: { ...settings, pdf: { seller, hideSeller: true } } });

  const tWith = allText(withSeller.content).join(' | ');
  const tHidden = allText(hidden.content).join(' | ');
  assert.match(tWith, /Sprzedawca/, 'domyślnie sprzedawca jest');
  assert.ok(!/Sprzedawca/.test(tHidden), 'hideSeller: brak etykiety „Sprzedawca"');
  assert.ok(!tHidden.includes('EVOKE Sp. z o.o.'), 'hideSeller: brak nazwy sprzedawcy');
  assert.ok(!/Do zapłaty na konto/.test(tHidden), 'hideSeller: brak linii z numerem konta');
  assert.match(tHidden, /Nabywca|Klient/, 'nabywca nadal jest');
});

test('status pozycji ma noWrap (nie zawija się w wąskich szablonach)', () => {
  const charges = [{ project: { id: 1, name: 'P' }, label: 'x', amount: 1000, date: new Date(2026, 0, 1), paidAt: new Date(2026, 0, 2) }];
  const doc = buildDoc({ client, charges, filters: {}, settings: { ...settings, pdf: { template: 'accent' } } });
  // zbierz WSZYSTKIE węzły „Rozliczono" (jest też etykieta w podsumowaniu bez noWrap) —
  // komórka statusu w tabeli MUSI mieć noWrap.
  const nodes = [];
  (function walk(n) {
    if (n == null) return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n === 'object') { if (n.text === 'Rozliczono') nodes.push(n); Object.values(n).forEach((v) => { if (typeof v === 'object') walk(v); }); }
  })(doc.content);
  assert.ok(nodes.length, 'komórka „Rozliczono" istnieje');
  assert.ok(nodes.some((n) => n.noWrap === true), 'status w tabeli ma noWrap');
});
