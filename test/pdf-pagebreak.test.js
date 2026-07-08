// PDF rozliczenia: dokument z wieloma projektami (wielostronicowy) generuje się bez błędu.
// Chroni ścieżkę z callbackiem pageBreakBefore (tytuł projektu nie zostaje osierocony na
// dole strony). Nie parsujemy layoutu — asercja: poprawny, niepusty PDF i brak wyjątku.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const pdfService = require('../src/services/pdf.service');

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
