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
  colors: { primary: '#6e00a5', adminAccent: '', adminText: '', adminSidebar: '#ffffff', adminBg: '#f8fafc' },
  texts: { heroTitle: '', heroSubtitle: '', footer: 'Evoke LINK · bezpieczna wymiana plików' },
  background: { ...background.DEFAULTS },
  logo: { size: 36, align: 'left' }, // wysokość px, wyrównanie left|center|right
  customCss: '',
};

const ALIGNS = ['left', 'center', 'right'];

function normLogo(l) {
  const x = l && typeof l === 'object' ? l : {};
  const size = Math.min(120, Math.max(16, parseInt(x.size, 10) || DEFAULTS.logo.size));
  const align = ALIGNS.includes(x.align) ? x.align : DEFAULTS.logo.align;
  return { size, align };
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
  return {
    appName: row.appName || DEFAULTS.appName,
    logoPath: row.logoPath || null,
    faviconPath: row.faviconPath || null,
    colors: { ...DEFAULTS.colors, ...colors },
    texts: { ...DEFAULTS.texts, ...texts },
    background: background.normalize(bg),
    logo: normLogo(logo),
    customCss: row.customCss || '',
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
  if (data.customCss !== undefined) patch.customCss = data.customCss;

  const row = await prisma.settings.upsert({
    where: { id: 1 },
    update: patch,
    create: { id: 1, appName: DEFAULTS.appName, colors: JSON.stringify(DEFAULTS.colors), texts: JSON.stringify(DEFAULTS.texts), ...patch },
  });
  cache = normalize(row);
  return cache;
}

module.exports = { get, update, DEFAULTS };
