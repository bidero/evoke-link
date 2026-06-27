// Generowanie PDF (pdfmake — czysty JS, font Roboto z polskimi znakami w pakiecie).
const fs = require('fs');
const path = require('path');
const PdfPrinter = require('pdfmake/src/printer');
const vfsRaw = require('pdfmake/build/vfs_fonts.js');
const vfs = vfsRaw.pdfMake && vfsRaw.pdfMake.vfs ? vfsRaw.pdfMake.vfs : vfsRaw; // base64 fontów Roboto
const fmt = require('../utils/format');
const { safeHex } = require('../utils/color');

const fonts = {
  Roboto: {
    normal: Buffer.from(vfs['Roboto-Regular.ttf'], 'base64'),
    bold: Buffer.from(vfs['Roboto-Medium.ttf'], 'base64'),
    italics: Buffer.from(vfs['Roboto-Italic.ttf'], 'base64'),
    bolditalics: Buffer.from(vfs['Roboto-MediumItalic.ttf'], 'base64'),
  },
};
const printer = new PdfPrinter(fonts);

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

// Węzeł logo dla pdfmake: SVG → { svg }, rastry → { image: dataURL }. Błąd = brak logo.
function logoNode(settings) {
  try {
    if (!settings.logoPath) return null;
    const file = path.join(PUBLIC_DIR, settings.logoPath.replace(/^\//, ''));
    if (!fs.existsSync(file)) return null;
    if (/\.svg$/i.test(file)) return { svg: fs.readFileSync(file, 'utf8'), fit: [150, 56] };
    const ext = (path.extname(file).slice(1) || 'png').toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return { image: `data:image/${mime};base64,${fs.readFileSync(file).toString('base64')}`, fit: [150, 56] };
  } catch (_) {
    return null;
  }
}

function slug(s) {
  return String(s || 'klient').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'klient';
}

// Strumieniuje PDF rozliczenia klienta do odpowiedzi.
// charges: [{ label, amount, date, paidAt, project:{name} }] — już przefiltrowane i posortowane po projekcie.
function clientStatement(res, { client, charges, filters = {}, settings }) {
  const brand = safeHex(settings.colors && settings.colors.primary, '#6e00a5');
  const muted = '#64748b';

  let total = 0;
  let paid = 0;
  charges.forEach((c) => { total += c.amount; if (c.paidAt) paid += c.amount; });

  // Grupowanie po projekcie (charges są już posortowane po nazwie projektu).
  const sections = [];
  let cur = null;
  let rows = null;
  const flush = () => {
    if (cur === null) return;
    sections.push({ text: cur, bold: true, color: brand, margin: [0, 12, 0, 4] });
    sections.push({
      table: {
        headerRows: 1,
        widths: ['auto', '*', 'auto', 'auto'],
        body: [
          [
            { text: 'Data', bold: true, color: muted, fontSize: 8 },
            { text: 'Pozycja', bold: true, color: muted, fontSize: 8 },
            { text: 'Status', bold: true, color: muted, fontSize: 8 },
            { text: 'Kwota', bold: true, color: muted, fontSize: 8, alignment: 'right' },
          ],
          ...rows,
        ],
      },
      layout: {
        hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 0.5 : 0.3),
        vLineWidth: () => 0,
        hLineColor: () => '#e2e8f0',
        paddingTop: () => 4,
        paddingBottom: () => 4,
      },
    });
  };
  charges.forEach((c) => {
    const name = (c.project && c.project.name) || 'Bez projektu';
    if (name !== cur) { flush(); cur = name; rows = []; }
    rows.push([
      { text: fmt.dateOnly(c.date), fontSize: 9 },
      { text: c.label || 'Pozycja', fontSize: 9 },
      { text: c.paidAt ? 'Rozliczono' : 'Do zapłaty', fontSize: 8, color: c.paidAt ? '#16a34a' : '#d97706' },
      { text: fmt.money(c.amount), fontSize: 9, alignment: 'right' },
    ]);
  });
  flush();

  // Opis filtra (jeśli użyty).
  const fparts = [];
  if (filters.from) fparts.push(`od ${fmt.dateOnly(filters.from)}`);
  if (filters.to) fparts.push(`do ${fmt.dateOnly(filters.to)}`);
  if (filters.status === 'unpaid') fparts.push('tylko nierozliczone');
  else if (filters.status === 'paid') fparts.push('tylko rozliczone');

  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 50],
    defaultStyle: { font: 'Roboto', fontSize: 9, color: '#0f172a' },
    content: [
      {
        columns: [
          logoNode(settings) || { text: settings.appName || 'Evoke LINK', bold: true, fontSize: 16, color: brand },
          {
            width: '*',
            stack: [
              { text: 'Rozliczenie', fontSize: 18, bold: true, alignment: 'right', color: brand },
              { text: settings.appName || 'Evoke LINK', alignment: 'right', color: muted, fontSize: 9 },
              { text: `Wystawiono: ${fmt.dateOnly(new Date())}`, alignment: 'right', color: muted, fontSize: 8, margin: [0, 2, 0, 0] },
            ],
          },
        ],
      },
      { text: 'Klient', color: muted, fontSize: 8, margin: [0, 18, 0, 0] },
      { text: client.name + (client.company ? ` · ${client.company}` : ''), bold: true, fontSize: 11 },
      ...(client.email ? [{ text: client.email, color: muted, fontSize: 9 }] : []),
      ...(fparts.length ? [{ text: `Zakres: ${fparts.join(', ')}`, color: '#94a3b8', fontSize: 8, margin: [0, 6, 0, 0] }] : []),
      ...(sections.length ? sections : [{ text: 'Brak pozycji dla wybranych kryteriów.', color: muted, italics: true, margin: [0, 16, 0, 0] }]),
      {
        margin: [0, 16, 0, 0],
        table: {
          widths: ['*', 'auto'],
          body: [
            [{ text: 'Wartość', alignment: 'right', color: muted }, { text: fmt.money(total), alignment: 'right' }],
            [{ text: 'Rozliczono', alignment: 'right', color: muted }, { text: fmt.money(paid), alignment: 'right', color: '#16a34a' }],
            [{ text: 'Do zapłaty', alignment: 'right', bold: true, fontSize: 12 }, { text: fmt.money(total - paid), alignment: 'right', bold: true, fontSize: 12, color: brand }],
          ],
        },
        layout: 'noBorders',
      },
    ],
    footer: (currentPage, pageCount) => ({
      text: `${settings.appName || 'Evoke LINK'} · strona ${currentPage}/${pageCount}`,
      alignment: 'center',
      color: '#94a3b8',
      fontSize: 7,
      margin: [0, 16, 0, 0],
    }),
  };

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="rozliczenie-${slug(client.name)}-${fmt.dateOnly(new Date()).replace(/\./g, '-')}.pdf"`);
  const doc = printer.createPdfKitDocument(docDefinition);
  doc.pipe(res);
  doc.end();
}

module.exports = { clientStatement };
