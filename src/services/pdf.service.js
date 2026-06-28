// Generowanie PDF (pdfmake — czysty JS, font Roboto z polskimi znakami w pakiecie).
// Wydruk rozliczenia/proformy klienta w jednym z 4 układów (Settings.pdf).
const fs = require('fs');
const path = require('path');
const PdfPrinter = require('pdfmake/src/printer');
const vfsRaw = require('pdfmake/build/vfs_fonts.js');
const vfs = vfsRaw.pdfMake && vfsRaw.pdfMake.vfs ? vfsRaw.pdfMake.vfs : vfsRaw;
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
const MUTED = '#64748b';

// Węzeł logo dla pdfmake: SVG → { svg }, rastry → { image: dataURL }. Błąd/brak = null.
function logoNode(settings, height) {
  try {
    if (!settings.logoPath) return null;
    const file = path.join(PUBLIC_DIR, settings.logoPath.replace(/^\//, ''));
    if (!fs.existsSync(file)) return null;
    const fit = [Math.round(height * 3.4), height];
    if (/\.svg$/i.test(file)) return { svg: fs.readFileSync(file, 'utf8'), fit };
    const ext = (path.extname(file).slice(1) || 'png').toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return { image: `data:image/${mime};base64,${fs.readFileSync(file).toString('base64')}`, fit };
  } catch (_) {
    return null;
  }
}

function slug(s) {
  return String(s || 'klient').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'klient';
}

// Tabele pozycji grupowane po projekcie. style: 'light' | 'bordered'.
function projectTables(charges, brand, style) {
  const header = () => [
    { text: 'Data', bold: true, color: MUTED, fontSize: 9 },
    { text: 'Pozycja', bold: true, color: MUTED, fontSize: 9 },
    { text: 'Status', bold: true, color: MUTED, fontSize: 9 },
    { text: 'Kwota', bold: true, color: MUTED, fontSize: 9, alignment: 'right' },
  ];
  const lightLayout = {
    hLineWidth: (i, node) => (i <= 1 || i === node.table.body.length ? 0.5 : 0.3),
    vLineWidth: () => 0,
    hLineColor: () => '#e2e8f0',
    paddingTop: () => 5,
    paddingBottom: () => 5,
  };
  const borderedLayout = {
    hLineWidth: () => 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => '#cbd5e1',
    vLineColor: () => '#cbd5e1',
    fillColor: (rowIndex) => (rowIndex === 0 ? '#eef2f7' : rowIndex % 2 === 0 ? '#f8fafc' : null),
    paddingTop: () => 5,
    paddingBottom: () => 5,
  };
  const out = [];
  let cur = null;
  let rows = null;
  const flush = () => {
    if (cur === null) return;
    out.push({ text: cur, bold: true, color: brand, fontSize: 11, margin: [0, 14, 0, 5] });
    out.push({
      table: { headerRows: 1, widths: ['auto', '*', 'auto', 'auto'], body: [header(), ...rows] },
      layout: style === 'bordered' ? borderedLayout : lightLayout,
    });
  };
  charges.forEach((c) => {
    const name = (c.project && c.project.name) || 'Bez projektu';
    if (name !== cur) { flush(); cur = name; rows = []; }
    rows.push([
      { text: fmt.dateOnly(c.date), fontSize: 10 },
      { text: c.label || 'Pozycja', fontSize: 10 },
      { text: c.paidAt ? 'Rozliczono' : 'Do zapłaty', fontSize: 9, color: c.paidAt ? '#16a34a' : '#d97706' },
      { text: fmt.money(c.amount), fontSize: 10, alignment: 'right' },
    ]);
  });
  flush();
  return out;
}

// Strony dokumentu. Sprzedawca pokazywany TYLKO gdy uzupełniono jego dane.
function partiesBlock(seller, appName, client, boxed) {
  const hasSeller = !!(seller.name || seller.address || seller.nip);
  const buyer = [{ text: 'Nabywca', color: MUTED, fontSize: 9 }, { text: client.name + (client.company ? ` · ${client.company}` : ''), bold: true, fontSize: 12 }];
  if (client.address) buyer.push({ text: client.address, fontSize: 10, color: '#334155' });
  if (client.nip) buyer.push({ text: `NIP: ${client.nip}`, fontSize: 10, color: MUTED });
  if (client.email) buyer.push({ text: client.email, fontSize: 10, color: MUTED });

  if (!hasSeller) {
    const single = [{ text: 'Klient', color: MUTED, fontSize: 9 }].concat(buyer.slice(1));
    return { margin: [0, 34, 0, 0], stack: single };
  }

  const sStack = [{ text: 'Sprzedawca', color: MUTED, fontSize: 9 }, { text: seller.name || appName, bold: true, fontSize: 12 }];
  if (seller.address) sStack.push({ text: seller.address, fontSize: 10, color: '#334155' });
  if (seller.nip) sStack.push({ text: `NIP: ${seller.nip}`, fontSize: 10, color: MUTED });

  if (boxed) {
    const L = { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#e2e8f0', vLineColor: () => '#e2e8f0', paddingLeft: () => 9, paddingRight: () => 9, paddingTop: () => 7, paddingBottom: () => 7 };
    return {
      margin: [0, 34, 0, 0],
      columns: [
        { width: '*', margin: [0, 0, 6, 0], table: { widths: ['*'], body: [[{ stack: sStack }]] }, layout: L },
        { width: '*', margin: [6, 0, 0, 0], table: { widths: ['*'], body: [[{ stack: buyer }]] }, layout: L },
      ],
    };
  }
  return {
    margin: [0, 34, 0, 0],
    columns: [
      { width: '*', margin: [0, 0, 10, 0], stack: sStack },
      { width: '*', margin: [10, 0, 0, 0], stack: buyer },
    ],
  };
}

// Podsumowanie — gruba brandowa linia nad „Do zapłaty" (bez tła), na szerokość pola.
function totalsBlock(total, paid, brand, seller) {
  const outstanding = total - paid;
  const box = {
    table: {
      widths: ['*', 'auto'],
      body: [
        [{ text: 'Wartość', color: MUTED, alignment: 'right' }, { text: fmt.money(total), alignment: 'right' }],
        [{ text: 'Rozliczono', color: MUTED, alignment: 'right' }, { text: fmt.money(paid), alignment: 'right', color: '#16a34a' }],
        [{ text: 'Do zapłaty', bold: true, fontSize: 16, alignment: 'right', margin: [0, 7, 0, 0] }, { text: fmt.money(outstanding), bold: true, fontSize: 16, color: brand, alignment: 'right', margin: [0, 7, 0, 0] }],
      ],
    },
    layout: {
      hLineWidth: (i) => (i === 2 ? 3 : 0),
      vLineWidth: () => 0,
      hLineColor: () => brand,
      paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 5, paddingBottom: () => 5,
    },
  };
  const stack = [box];
  if (outstanding > 0 && seller.bank) stack.push({ text: `Do zapłaty na konto: ${seller.bank}`, color: MUTED, fontSize: 9, alignment: 'right', margin: [0, 8, 0, 0] });
  return { margin: [0, 36, 0, 0], columns: [{ width: '*', text: '' }, { width: '50%', stack }] };
}

function filterLine(filters) {
  const p = [];
  if (filters.from) p.push(`od ${fmt.dateOnly(filters.from)}`);
  if (filters.to) p.push(`do ${fmt.dateOnly(filters.to)}`);
  if (filters.status === 'unpaid') p.push('tylko nierozliczone');
  else if (filters.status === 'paid') p.push('tylko rozliczone');
  return p.length ? { text: `Zakres: ${p.join(', ')}`, color: '#94a3b8', fontSize: 9, margin: [0, 8, 0, 0] } : null;
}

// Buduje definicję dokumentu pdfmake (wspólne dla strumienia i Buffera).
function buildDoc({ client, charges, filters = {}, settings }) {
  const brand = safeHex(settings.colors && settings.colors.primary, '#6e00a5');
  const appName = settings.appName || 'Evoke LINK';
  const pdfCfg = settings.pdf || {};
  const tpl = pdfCfg.template || 'standard';
  const logoH = pdfCfg.logoHeight || 48;
  const seller = pdfCfg.seller || { name: '', address: '', nip: '', bank: '' };
  const title = pdfCfg.docType === 'proforma' ? 'Proforma' : 'Rozliczenie';
  const today = fmt.dateOnly(new Date());
  const now = new Date();
  const docNr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${client.id}`;
  const meta = `Nr ${docNr} · wystawiono ${today}`;

  let total = 0;
  let paid = 0;
  charges.forEach((c) => { total += c.amount; if (c.paidAt) paid += c.amount; });

  const logo = logoNode(settings, logoH);
  const sections = charges.length
    ? projectTables(charges, brand, tpl === 'proforma' ? 'bordered' : 'light')
    : [{ text: 'Brak pozycji dla wybranych kryteriów.', color: MUTED, italics: true, margin: [0, 18, 0, 0] }];
  const fLine = filterLine(filters);

  const content = [];
  const docDef = {
    pageSize: 'A4',
    pageMargins: tpl === 'accent' ? [60, 48, 48, 56] : [48, 48, 48, 56],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: '#0f172a', lineHeight: 1.15 },
    content,
    footer: (cp, pc) => ({ text: `${appName} · strona ${cp}/${pc}`, alignment: 'center', color: '#94a3b8', fontSize: 8, margin: [0, 16, 0, 0] }),
  };

  // --- Nagłówek wg szablonu ---
  if (tpl === 'band') {
    docDef.content.push({
      table: {
        widths: ['*'],
        body: [[{
          fillColor: brand,
          margin: [16, 14, 16, 14],
          columns: [
            logo ? { width: 'auto', ...logo } : { width: '*', text: appName, color: '#ffffff', bold: true, fontSize: 18 },
            { width: '*', text: title, color: '#ffffff', bold: true, fontSize: 20, alignment: 'right', margin: [0, logoH > 30 ? 10 : 0, 0, 0] },
          ],
        }]],
      },
      layout: 'noBorders',
    });
    docDef.content.push({ text: meta, color: MUTED, fontSize: 9, margin: [0, 10, 0, 0] });
  } else if (tpl === 'accent') {
    docDef.background = (cp, pageSize) => ({ canvas: [{ type: 'rect', x: 0, y: 0, w: 16, h: pageSize.height, color: brand }] });
    docDef.content.push({
      columns: [
        logo ? { width: 'auto', ...logo } : { width: 'auto', text: appName, bold: true, fontSize: 16, color: brand },
        {
          width: '*',
          stack: [
            { text: title, color: brand, bold: true, fontSize: 13, alignment: 'right' },
            { text: 'Do zapłaty', color: MUTED, fontSize: 9, alignment: 'right', margin: [0, 6, 0, 0] },
            { text: fmt.money(total - paid), color: brand, bold: true, fontSize: 24, alignment: 'right' },
          ],
        },
      ],
    });
    docDef.content.push({ text: meta, color: MUTED, fontSize: 9, margin: [0, 10, 0, 0] });
  } else if (tpl === 'proforma') {
    docDef.content.push({
      columns: [
        logo ? { width: 'auto', ...logo } : { width: 'auto', text: appName, bold: true, fontSize: 16, color: brand },
        { width: '*', stack: [
          { text: title, color: brand, bold: true, fontSize: 18, alignment: 'right' },
          { text: `nr ${docNr}`, color: MUTED, fontSize: 10, alignment: 'right' },
          { text: `Wystawiono: ${today}`, color: MUTED, fontSize: 9, alignment: 'right' },
        ] },
      ],
    });
  } else {
    docDef.content.push({
      columns: [
        logo ? { width: 'auto', ...logo } : { width: 'auto', text: appName, bold: true, fontSize: 18, color: brand },
        { width: '*', stack: [
          { text: title, fontSize: 20, bold: true, alignment: 'right', color: brand },
          { text: meta, alignment: 'right', color: MUTED, fontSize: 9, margin: [0, 3, 0, 0] },
        ] },
      ],
    });
  }

  docDef.content.push(partiesBlock(seller, appName, client, tpl === 'proforma'));
  if (fLine) docDef.content.push(fLine);
  sections.forEach((s) => docDef.content.push(s));
  docDef.content.push(totalsBlock(total, paid, brand, seller));

  return docDef;
}

function statementFilename(client, settings) {
  const dt = settings.pdf && settings.pdf.docType === 'proforma' ? 'proforma' : 'rozliczenie';
  return `${dt}-${slug(client.name)}-${fmt.dateOnly(new Date()).replace(/\./g, '-')}.pdf`;
}

// Strumieniuje PDF rozliczenia klienta do odpowiedzi (podgląd/pobranie).
function clientStatement(res, opts) {
  const docDef = buildDoc(opts);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${statementFilename(opts.client, opts.settings)}"`);
  const doc = printer.createPdfKitDocument(docDef);
  doc.pipe(res);
  doc.end();
}

// PDF jako Buffer (do załącznika e-mail).
function clientStatementBuffer(opts) {
  const docDef = buildDoc(opts);
  return new Promise((resolve, reject) => {
    const doc = printer.createPdfKitDocument(docDef);
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

module.exports = { clientStatement, clientStatementBuffer, statementFilename };
