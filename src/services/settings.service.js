// Ustawienia/branding — jeden wiersz (id=1). Trzymamy w pamięci podręcznej,
// bo czytane są przy każdym żądaniu, a zmieniają się rzadko.
const prisma = require('../db/client');
const background = require('../utils/background');

const DEFAULTS = {
  appName: 'Evoke LINK',
  logoPath: null,
  faviconPath: null,
  // primary = kolor przewodni (strona klienta). adminAccent/Sidebar/Bg = elementy panelu;
  // adminAccent puste = dziedziczy primary.
  colors: { primary: '#6e00a5', adminAccent: '', adminText: '', adminSidebar: '#ffffff', adminBg: '#f8fafc', darkBg: '#0f172a', darkSurface: '#1e293b', darkText: '#e5e7eb' },
  texts: { heroTitle: '', heroSubtitle: '', footer: 'Evoke LINK · bezpieczna wymiana plików' },
  background: { ...background.DEFAULTS },
  logo: { size: 36, align: 'left', darkPath: null }, // wysokość px, wyrównanie, osobne logo dla trybu ciemnego
  // Układ stron klienta. style: classic (obecny) | centered | split.
  // card: solid | glass | elevated. radius w px. button: rounded | pill.
  layout: { style: 'classic', card: 'solid', cardSide: 'right', hideName: false, heroOnBg: true, applyToLogin: false, radius: 24, button: 'rounded' },
  customCss: '',
  // E-mail: osobne logo + treści + powiadomienie do klienta. Puste pola = domyślne.
  emails: {
    logoPath: null,
    linkSubject: '', linkIntro: '',
    panelSubject: '', panelIntro: '',
    uploadSubject: '', downloadSubject: '',
    clientConfirm: false, clientConfirmSubject: '', clientConfirmBody: '',
  },
};

const ALIGNS = ['left', 'center', 'right'];
const LAYOUT_STYLES = ['classic', 'centered', 'split', 'hero-card', 'minimal', 'banner'];
const CARD_STYLES = ['solid', 'glass', 'elevated'];
const BUTTON_STYLES = ['rounded', 'pill'];

function normLogo(l) {
  const x = l && typeof l === 'object' ? l : {};
  const size = Math.min(120, Math.max(16, parseInt(x.size, 10) || DEFAULTS.logo.size));
  const align = ALIGNS.includes(x.align) ? x.align : DEFAULTS.logo.align;
  return { size, align, darkPath: x.darkPath || null };
}

function normLayout(l) {
  const x = l && typeof l === 'object' ? l : {};
  const r = parseInt(x.radius, 10);
  return {
    style: LAYOUT_STYLES.includes(x.style) ? x.style : DEFAULTS.layout.style,
    card: CARD_STYLES.includes(x.card) ? x.card : DEFAULTS.layout.card,
    cardSide: ['left', 'right'].includes(x.cardSide) ? x.cardSide : DEFAULTS.layout.cardSide,
    hideName: !!x.hideName,
    heroOnBg: x.heroOnBg === undefined ? DEFAULTS.layout.heroOnBg : !!x.heroOnBg,
    applyToLogin: !!x.applyToLogin,
    radius: Math.min(40, Math.max(0, Number.isInteger(r) ? r : DEFAULTS.layout.radius)),
    button: BUTTON_STYLES.includes(x.button) ? x.button : DEFAULTS.layout.button,
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
  return {
    appName: row.appName || DEFAULTS.appName,
    logoPath: row.logoPath || null,
    faviconPath: row.faviconPath || null,
    colors: { ...DEFAULTS.colors, ...colors },
    texts: { ...DEFAULTS.texts, ...texts },
    background: background.normalize(bg),
    logo: normLogo(logo),
    layout: normLayout(layout),
    customCss: row.customCss || '',
    emails: { ...DEFAULTS.emails, ...emails },
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
  if (data.colors !== undefined) patch.colors = JSON.stringify(data.colors);
  if (data.texts !== undefined) patch.texts = JSON.stringify(data.texts);
  if (data.background !== undefined) patch.background = JSON.stringify(data.background);
  if (data.logo !== undefined) patch.logo = JSON.stringify(data.logo);
  if (data.layout !== undefined) patch.layout = JSON.stringify(data.layout);
  if (data.customCss !== undefined) patch.customCss = data.customCss;
  if (data.emails !== undefined) patch.emails = JSON.stringify(data.emails);

  const row = await prisma.settings.upsert({
    where: { id: 1 },
    update: patch,
    create: { id: 1, appName: DEFAULTS.appName, colors: JSON.stringify(DEFAULTS.colors), texts: JSON.stringify(DEFAULTS.texts), ...patch },
  });
  cache = normalize(row);
  return cache;
}

module.exports = { get, update, DEFAULTS };
