// Ustawienia/branding — jeden wiersz (id=1). Trzymamy w pamięci podręcznej,
// bo czytane są przy każdym żądaniu, a zmieniają się rzadko.
const prisma = require('../db/client');
const background = require('../utils/background');
const fonts = require('../utils/fonts');
const panelUi = require('../utils/panelUi');

const DEFAULTS = {
  appName: 'Evoke LINK',
  logoPath: null,
  faviconPath: null,
  ogImagePath: null,
  // primary = kolor przewodni (strona klienta). adminAccent/Sidebar/Bg = elementy panelu;
  // adminAccent puste = dziedziczy primary.
  colors: { primary: '#6e00a5', adminAccent: '', adminText: '', adminSidebar: '#ffffff', adminHeader: '', adminBg: '#f8fafc', darkBg: '#0f172a', darkSurface: '#1e293b', darkText: '#e5e7eb' },
  texts: { heroTitle: '', heroSubtitle: '', footer: 'Evoke LINK · bezpieczna wymiana plików' },
  background: { ...background.DEFAULTS },
  logo: { size: 36, align: 'left', darkPath: null }, // wysokość px, wyrównanie, osobne logo dla trybu ciemnego
  // Układ stron klienta. style: classic (obecny) | centered | split.
  // card: solid | glass | elevated. radius w px. button: rounded | pill.
  layout: { style: 'classic', card: 'solid', cardSide: 'right', hideName: false, heroOnBg: true, applyToLogin: false, radius: 24, button: 'rounded', stickyHeader: false, font: 'system' },
  customCss: '',
  // E-mail: osobne logo + treści + powiadomienie do klienta. Puste pola = domyślne.
  emails: {
    logoPath: null,
    linkSubject: '', linkIntro: '',
    panelSubject: '', panelIntro: '',
    onboardSubject: '', onboardIntro: '',
    uploadSubject: '', downloadSubject: '',
    clientConfirm: false, clientConfirmSubject: '', clientConfirmBody: '',
    reminders: false, reminderSubject: '', reminderIntro: '',
    retainerNotify: false, retainerSubject: '', retainerIntro: '', // mail do klienta o nowej pozycji cyklicznej
    expiryWarn: false,
    dailyDigest: false,
  },
  // Wydruk PDF rozliczenia: szablon + wysokość logo (px) + dane sprzedawcy na dokument.
  // portalBilling: sekcja „Do zapłaty" (pozycje + dane do przelewu + QR) w portalu klienta /c.
  pdf: { template: 'standard', docType: 'rozliczenie', logoHeight: 48, portalBilling: true, seller: { name: '', address: '', nip: '', bank: '' } },
  // Układ panelu admina: kolejność/ukrywanie pozycji menu i widżetów pulpitu (delty, puste = domyślnie).
  panel: { menu: [], dashboard: [] },
};

const ALIGNS = ['left', 'center', 'right'];
const LAYOUT_STYLES = ['classic', 'centered', 'split', 'hero-card', 'minimal', 'banner', 'showcase', 'panel', 'panel-bg', 'sidebar', 'corner'];
const CARD_STYLES = ['solid', 'glass', 'elevated'];
const BUTTON_STYLES = ['rounded', 'pill'];
const PDF_TEMPLATES = ['standard', 'band', 'accent', 'proforma', 'accent-card', 'accent-band', 'accent-min', 'clean'];
const PDF_DOCTYPES = ['rozliczenie', 'proforma'];

function normPdf(p) {
  const x = p && typeof p === 'object' ? p : {};
  const h = parseInt(x.logoHeight, 10);
  const s = x.seller && typeof x.seller === 'object' ? x.seller : {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  return {
    template: PDF_TEMPLATES.includes(x.template) ? x.template : DEFAULTS.pdf.template,
    docType: PDF_DOCTYPES.includes(x.docType) ? x.docType : DEFAULTS.pdf.docType,
    logoHeight: Math.min(90, Math.max(20, Number.isFinite(h) ? h : DEFAULTS.pdf.logoHeight)),
    portalBilling: x.portalBilling === undefined ? DEFAULTS.pdf.portalBilling : !!x.portalBilling,
    seller: { name: str(s.name), address: str(s.address), nip: str(s.nip), bank: str(s.bank) },
  };
}

function normLogo(l) {
  const x = l && typeof l === 'object' ? l : {};
  const size = Math.min(120, Math.max(16, parseInt(x.size, 10) || DEFAULTS.logo.size));
  const align = ALIGNS.includes(x.align) ? x.align : DEFAULTS.logo.align;
  return {
    size, align, darkPath: x.darkPath || null,
    // osobne logo per powierzchnia (puste = dziedziczy bazowe logoPath/darkPath)
    adminPath: x.adminPath || null, adminDarkPath: x.adminDarkPath || null,
    loginPath: x.loginPath || null, loginDarkPath: x.loginDarkPath || null,
  };
}

function normLayout(l) {
  const x = l && typeof l === 'object' ? l : {};
  const r = parseInt(x.radius, 10);
  return {
    style: LAYOUT_STYLES.includes(x.style) ? x.style : DEFAULTS.layout.style,
    card: CARD_STYLES.includes(x.card) ? x.card : DEFAULTS.layout.card,
    cardSide: ['left', 'right', 'center'].includes(x.cardSide) ? x.cardSide : DEFAULTS.layout.cardSide,
    hideName: !!x.hideName,
    heroOnBg: x.heroOnBg === undefined ? DEFAULTS.layout.heroOnBg : !!x.heroOnBg,
    applyToLogin: !!x.applyToLogin,
    radius: Math.min(40, Math.max(0, Number.isInteger(r) ? r : DEFAULTS.layout.radius)),
    button: BUTTON_STYLES.includes(x.button) ? x.button : DEFAULTS.layout.button,
    stickyHeader: !!x.stickyHeader,
    font: fonts.PAIRS[x.font] ? x.font : DEFAULTS.layout.font,
  };
}

let cache = null;

function normalize(row) {
  let colors = {};
  let texts = {};
  let bg = {};
  let logo = {};
  try { colors = row.colors ? JSON.parse(row.colors) : {}; } catch (_) {}
  try { texts = row.texts ? JSON.parse(row.texts) : {}; } catch (_) {}
  try { bg = row.background ? JSON.parse(row.background) : {}; } catch (_) {}
  try { logo = row.logo ? JSON.parse(row.logo) : {}; } catch (_) {}
  let layout = {};
  try { layout = row.layout ? JSON.parse(row.layout) : {}; } catch (_) {}
  let emails = {};
  try { emails = row.emails ? JSON.parse(row.emails) : {}; } catch (_) {}
  let pdf = {};
  try { pdf = row.pdf ? JSON.parse(row.pdf) : {}; } catch (_) {}
  let panel = {};
  try { panel = row.panel ? JSON.parse(row.panel) : {}; } catch (_) {}
  return {
    appName: row.appName || DEFAULTS.appName,
    logoPath: row.logoPath || null,
    faviconPath: row.faviconPath || null,
    ogImagePath: row.ogImagePath || null,
    colors: { ...DEFAULTS.colors, ...colors },
    texts: { ...DEFAULTS.texts, ...texts },
    background: background.normalize(bg),
    loginBackground: (() => { try { return row.loginBackground ? background.normalize(JSON.parse(row.loginBackground)) : null; } catch (_) { return null; } })(),
    logo: normLogo(logo),
    layout: normLayout(layout),
    customCss: row.customCss || '',
    emails: { ...DEFAULTS.emails, ...emails },
    pdf: normPdf(pdf),
    panel: { menu: panelUi.sanitizeMenu(panel.menu), dashboard: panelUi.sanitizeWidgets(panel.dashboard) },
  };
}

// Zwraca znormalizowane ustawienia (tworzy wiersz domyślny przy pierwszym razie).
async function get() {
  if (cache) return cache;
  let row = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!row) {
    row = await prisma.settings.create({
      data: { id: 1, appName: DEFAULTS.appName, colors: JSON.stringify(DEFAULTS.colors), texts: JSON.stringify(DEFAULTS.texts) },
    });
  }
  cache = normalize(row);
  return cache;
}

// Aktualizacja. data: { appName?, logoPath?, faviconPath?, colors?, texts?, background? }
async function update(data) {
  const patch = {};
  if (data.appName !== undefined) patch.appName = data.appName || DEFAULTS.appName;
  if (data.logoPath !== undefined) patch.logoPath = data.logoPath;
  if (data.faviconPath !== undefined) patch.faviconPath = data.faviconPath;
  if (data.ogImagePath !== undefined) patch.ogImagePath = data.ogImagePath;
  if (data.colors !== undefined) patch.colors = JSON.stringify(data.colors);
  if (data.texts !== undefined) patch.texts = JSON.stringify(data.texts);
  if (data.background !== undefined) patch.background = JSON.stringify(data.background);
  if (data.loginBackground !== undefined) patch.loginBackground = data.loginBackground ? JSON.stringify(data.loginBackground) : null;
  if (data.logo !== undefined) patch.logo = JSON.stringify(data.logo);
  if (data.layout !== undefined) patch.layout = JSON.stringify(data.layout);
  if (data.customCss !== undefined) patch.customCss = data.customCss;
  if (data.emails !== undefined) patch.emails = JSON.stringify(data.emails);
  if (data.pdf !== undefined) patch.pdf = JSON.stringify(data.pdf);
  if (data.panel !== undefined) patch.panel = JSON.stringify({ menu: panelUi.sanitizeMenu(data.panel.menu), dashboard: panelUi.sanitizeWidgets(data.panel.dashboard) });

  const row = await prisma.settings.upsert({
    where: { id: 1 },
    update: patch,
    create: { id: 1, appName: DEFAULTS.appName, colors: JSON.stringify(DEFAULTS.colors), texts: JSON.stringify(DEFAULTS.texts), ...patch },
  });
  cache = normalize(row);
  return cache;
}

module.exports = { get, update, DEFAULTS };
