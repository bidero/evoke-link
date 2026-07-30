// Eksport CSV — jeden format dla wszystkich list (pozycje klienta, klienci, transfery).
// Separator `;` (Excel PL otwiera w kolumnach bez kreatora importu), BOM UTF-8 (polskie znaki),
// końce linii CRLF. Cudzysłowy/średniki/nowe linie w komórce → wartość w cudzysłowach z podwojeniem.
const SEP = ';';
const BOM = '﻿';

function cell(v) {
  const s = String(v == null ? '' : v);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// build(rows) → gotowa treść pliku. rows = tablica tablic (pierwszy wiersz = nagłówki).
function build(rows) {
  return BOM + (rows || []).map((r) => (r || []).map(cell).join(SEP)).join('\r\n') + '\r\n';
}

// Kwota w groszach → „1234,56" (przecinek dziesiętny, bez separatora tysięcy — Excel PL).
function money(grosze) {
  return ((Number(grosze) || 0) / 100).toFixed(2).replace('.', ',');
}

// Nazwa pliku z nazwy klienta/listy: bez ogonków, tylko [a-z0-9-].
// `ł` podmieniamy RĘCZNIE — to jedyna polska litera, która nie rozkłada się przez NFD
// na literę + znak diakrytyczny (inaczej „Żółta" dawało „zo-ta").
function slug(name, fallback = 'lista') {
  const s = String(name || '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return s || fallback;
}

// Ustawia nagłówki pobierania i wysyła plik.
function send(res, filename, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(build(rows));
}

module.exports = { build, send, cell, money, slug, SEP, BOM };
