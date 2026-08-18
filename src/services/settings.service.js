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
  // portalNav: nawigacja sekcji portali /c i /p — none (stos) | tabs | side-left | side-right.
  // adminTheme = wygląd PANELU admina: classic (obecny) | modern (styl TailAdmin, warstwa CSS). hideScroll = ukryj paski przewijania.
  layout: { style: 'classic', card: 'solid', cardSide: 'right', panelWidth: 'md', hideName: false, hideBgLogo: false, heroOnBg: true, applyToLogin: false, radius: 24, button: 'rounded', stickyHeader: false, font: 'system', portalNav: 'none', adminTheme: 'classic', hideScroll: false },
  customCss: '',
  // E-mail: osobne logo + treści + powiadomienie do klienta. Puste pola = domyślne.
  emails: {
    logoPath: null,
    theme: 'classic', // wygląd wszystkich maili: classic | minimal | rail | tint | badge
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
  pdf: { template: 'standard', docType: 'rozliczenie', logoHeight: 48, portalBilling: true, hideSeller: false, seller: { name: '', address: '', nip: '', bank: '' } },
  // Układ panelu admina: kolejność/ukrywanie pozycji menu i widżetów pulpitu (delty, puste = domyślnie).
  panel: { menu: [], dashboard: [] },
  // Instalowalna aplikacja (PWA): manifest budowany z tych pól. enabled = emituj <link manifest> + SW.
  // Puste name/themeColor/background = dziedziczy appName / colors.primary / biel. iconPath = wgrana ikona.
  // splashMs = własny ekran startowy po otwarciu zainstalowanej aplikacji (0 = wyłącz);
  // splashMode = jego zawartość: icon (ikona+nazwa) | logo (logo brandingu) | name (sama nazwa).
  // logoPath = osobne logo PWA składane w ikonę (na kolorze marki); logoScale = jego rozmiar (%).
  // iconPath = gotowa ikona NADPISUJĄCA logo (override — użyta bez zmian, gdy wgrana).
  // splashSize = wielkość grafiki (ikona/logo) na ekranie startowym (px).
  pwa: { enabled: false, name: '', shortName: '', themeColor: '', background: '', display: 'standalone', iconPath: null, logoPath: null, logoScale: 62, splashMs: 1200, splashMode: 'icon', splashSize: 120, badge: true, push: true, pushBody: true },
  // Strona logowania (niezależna od stron klienta). Puste teksty = domyślne z widoku.
  login: { style: 'card', side: 'left', width: 'md', title: '', subtitle: '', heroTitle: '', heroSubtitle: '', hideName: false, footer: '', hideLogo: false, hideTitle: false, hideHero: false, hideFooter: false },
};

const ALIGNS = ['left', 'center', 'right'];
const LAYOUT_STYLES = ['classic', 'centered', 'split', 'hero-card', 'minimal', 'banner', 'showcase', 'panel', 'panel-bg', 'sidebar', 'corner'];
const CARD_STYLES = ['solid', 'glass', 'elevated'];
const BUTTON_STYLES = ['rounded', 'pill'];
// Szerokość białego panelu w kompozycjach „Panel na tle" (panel) i „Panel na tle 2" (panel-bg).
const PANEL_WIDTHS = ['sm', 'md', 'lg', 'xl', '2xl'];
// W karcie: tabs | side-*. Pływające przy karcie: top (pasek nad kartą) | bar-* (panel obok).
// W chrome strony: header (menu w nagłówku obok logo) | rail-* (pełnowysoki brandowy pas pionowy).
const PORTAL_NAVS = ['none', 'tabs', 'side-left', 'side-right', 'top', 'bar-left', 'bar-right', 'header', 'rail-left', 'rail-right'];
const ADMIN_THEMES = ['classic', 'modern']; // wygląd panelu admina (modern = warstwa CSS .theme-modern)
const PDF_TEMPLATES = ['standard', 'band', 'accent', 'proforma', 'accent-card', 'accent-band', 'accent-min', 'clean'];
const PDF_DOCTYPES = ['rozliczenie', 'proforma'];
const PWA_DISPLAYS = ['standalone', 'minimal-ui', 'fullscreen', 'browser'];
const PWA_SPLASH_MODES = ['icon', 'logo', 'name'];

function normPwa(p) {
  const x = p && typeof p === 'object' ? p : {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const hex = (v) => { const s = str(v); return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : ''; };
  const ms = parseInt(x.splashMs, 10);
  const scale = parseInt(x.logoScale, 10);
  const ssz = parseInt(x.splashSize, 10);
  return {
    enabled: !!x.enabled,
    name: str(x.name).slice(0, 60),
    shortName: str(x.shortName).slice(0, 30),
    themeColor: hex(x.themeColor),   // puste = colors.primary
    background: hex(x.background),    // puste = biel
    display: PWA_DISPLAYS.includes(x.display) ? x.display : DEFAULTS.pwa.display,
    iconPath: x.iconPath || null,    // gotowa ikona — NADPISUJE logo (override)
    logoPath: x.logoPath || null,    // osobne logo składane w ikonę (gdy brak gotowej ikony)
    logoScale: Number.isFinite(scale) ? Math.min(100, Math.max(30, scale)) : DEFAULTS.pwa.logoScale, // % rozmiaru logo w ikonie (30..100)
    splashMs: Number.isFinite(ms) ? Math.min(5000, Math.max(0, ms)) : DEFAULTS.pwa.splashMs, // 0..5000; 0 = wyłącz
    splashMode: PWA_SPLASH_MODES.includes(x.splashMode) ? x.splashMode : DEFAULTS.pwa.splashMode,
    splashSize: Number.isFinite(ssz) ? Math.max(48, ssz) : DEFAULTS.pwa.splashSize, // px grafiki na splashu — bez górnego limitu
    // Licznik na ikonie zainstalowanej aplikacji (Badging API). Brak pola w zapisie =
    // domyślnie WŁĄCZONY (istniejące instalacje dostają licznik po włączeniu PWA).
    badge: x.badge === undefined ? DEFAULTS.pwa.badge : !!x.badge,
    // Powiadomienia push (budzą aplikację przy zamkniętym oknie). Bezczynne, dopóki
    // ktoś nie włączy ich na swoim urządzeniu — to i tak wymaga zgody w przeglądarce.
    push: x.push === undefined ? DEFAULTS.pwa.push : !!x.push,
    // Czy powiadomienie pokazuje FRAGMENT wiadomości od klienta. Dotyczy tylko wiadomości —
    // opisy zdarzeń to nasze własne teksty, nie treść pisana przez klienta.
    pushBody: x.pushBody === undefined ? DEFAULTS.pwa.pushBody : !!x.pushBody,
  };
}

// Strona logowania — niezależna od stron klienta. `style`: card (wyśrodkowana karta,
// dotychczasowy wygląd) | split (formularz obok brandowego panelu z hero)
// | panel (panel PEŁNEJ WYSOKOŚCI przy krawędzi, hero na tle — jak „Panel na tle" u klienta).
const LOGIN_STYLES = ['card', 'split', 'panel'];
const LOGIN_WIDTHS = ['sm', 'md', 'lg', 'xl', '2xl'];
function normLogin(l) {
  const x = l && typeof l === 'object' ? l : {};
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  return {
    style: LOGIN_STYLES.includes(x.style) ? x.style : DEFAULTS.login.style,
    side: x.side === 'right' ? 'right' : 'left', // po której stronie FORMULARZ (split/panel)
    width: LOGIN_WIDTHS.includes(x.width) ? x.width : DEFAULTS.login.width, // szerokość panelu (panel)
    title: str(x.title, 80),
    subtitle: str(x.subtitle, 160),
    heroTitle: str(x.heroTitle, 120),
    heroSubtitle: str(x.heroSubtitle, 240),
    hideName: !!x.hideName,
    footer: str(x.footer, 200),
    // Wyłączanie elementów (puste teksty i tak nie renderują się — to twarde ukrycie).
    hideLogo: !!x.hideLogo,
    hideTitle: !!x.hideTitle,
    hideHero: !!x.hideHero,
    hideFooter: !!x.hideFooter,
  };
}

function normProfile(p) {
  const x = p && typeof p === 'object' ? p : {};
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  return {
    name: str(x.name, 120),
    role: str(x.role, 120),
    phone: str(x.phone, 60),
    avatarPath: x.avatarPath || null,
  };
}

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
    hideSeller: !!x.hideSeller, // ukryj dane sprzedawcy w PDF (czasem potrzebny sam wykaz pozycji)
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
    panelWidth: PANEL_WIDTHS.includes(x.panelWidth) ? x.panelWidth : DEFAULTS.layout.panelWidth,
    hideName: !!x.hideName,
    hideBgLogo: !!x.hideBgLogo,
    heroOnBg: x.heroOnBg === undefined ? DEFAULTS.layout.heroOnBg : !!x.heroOnBg,
    applyToLogin: !!x.applyToLogin,
    radius: Math.min(40, Math.max(0, Number.isInteger(r) ? r : DEFAULTS.layout.radius)),
    button: BUTTON_STYLES.includes(x.button) ? x.button : DEFAULTS.layout.button,
    stickyHeader: !!x.stickyHeader,
    font: fonts.PAIRS[x.font] ? x.font : DEFAULTS.layout.font,
    portalNav: PORTAL_NAVS.includes(x.portalNav) ? x.portalNav : DEFAULTS.layout.portalNav,
    adminTheme: ADMIN_THEMES.includes(x.adminTheme) ? x.adminTheme : DEFAULTS.layout.adminTheme,
    hideScroll: !!x.hideScroll,
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
  let pwa = {};
  try { pwa = row.pwa ? JSON.parse(row.pwa) : {}; } catch (_) {}
  let profile = {};
  try { profile = row.profile ? JSON.parse(row.profile) : {}; } catch (_) {}
  let login = {};
  try { login = row.login ? JSON.parse(row.login) : {}; } catch (_) {}
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
    panel: { menu: panelUi.sanitizeMenu(panel.menu), dashboard: panelUi.sanitizeWidgets(panel.dashboard), actions: panelUi.sanitizeActions(panel.actions) },
    pwa: normPwa(pwa),
    profile: normProfile(profile),
    login: normLogin(login),
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
  if (data.panel !== undefined) patch.panel = JSON.stringify({ menu: panelUi.sanitizeMenu(data.panel.menu), dashboard: panelUi.sanitizeWidgets(data.panel.dashboard), actions: panelUi.sanitizeActions(data.panel.actions) });
  if (data.pwa !== undefined) patch.pwa = JSON.stringify(normPwa(data.pwa));
  if (data.profile !== undefined) patch.profile = JSON.stringify(normProfile(data.profile));
  if (data.login !== undefined) patch.login = JSON.stringify(normLogin(data.login));

  const row = await prisma.settings.upsert({
    where: { id: 1 },
    update: patch,
    create: { id: 1, appName: DEFAULTS.appName, colors: JSON.stringify(DEFAULTS.colors), texts: JSON.stringify(DEFAULTS.texts), ...patch },
  });
  cache = normalize(row);
  return cache;
}

module.exports = { get, update, DEFAULTS };
