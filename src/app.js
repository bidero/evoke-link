// Budowa i konfiguracja aplikacji Express. Eksportuje gotową aplikację;
// faktyczne nasłuchiwanie portu jest w głównym pliku app.js (entry dla Passengera).
const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const expressLayouts = require('express-ejs-layouts');
const helmet = require('helmet');

const pkg = require('../package.json');
const config = require('./config');
const fmt = require('./utils/format');
const { icon, eventIcon } = require('./utils/icons');
const { fileMeta } = require('./utils/fileIcon');
const { logoTag, hasLogo } = require('./utils/logo');
const qr = require('./utils/qr');
const color = require('./utils/color');
const bg = require('./utils/background');
const fonts = require('./utils/fonts');
const { sanitizeCss } = require('./utils/css');
const settingsService = require('./services/settings.service');
const { injectUser } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/error');

const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const publicRoutes = require('./routes/public.routes');

const app = express();

// Za reverse-proxy (Passenger/nginx) — żeby ciasteczka secure i IP działały poprawnie.
app.set('trust proxy', 1);

// Silnik widoków: EJS + układy (layouts).
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/admin'); // domyślny układ panelu

// Bezpieczeństwo nagłówków + CSP. Wszystkie zasoby z własnego origin (Alpine i Sortable
// serwowane lokalnie z /js — brak CDN). 'unsafe-inline' dla stylów (wstrzykiwane <style>
// brandingu + atrybuty style) i dla skryptów (inline theme-toggle + atrybuty onclick/onsubmit);
// 'unsafe-eval' bo Alpine 3 ewaluuje wyrażenia. Bez upgrade-insecure-requests (działa też po http w dev).
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        formAction: ["'self'"],
      },
    },
  })
);

// Parsowanie formularzy.
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Pliki statyczne (zbudowany CSS, logo, favicon).
app.use(express.static(path.join(__dirname, '..', 'public')));

// Sesje w zaszyfrowanym ciasteczku (cookie-session) — brak plików/bazy,
// przeżywa restart Passengera, identycznie na Windows i Linux.
app.use(
  cookieSession({
    name: 'evoke',
    keys: [config.sessionSecret],
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd, // HTTPS na produkcji
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dni
  })
);

// Dane zalogowanego użytkownika dostępne we wszystkich widokach.
app.use(injectUser);

// Pomocniki dostępne w każdym szablonie: fmt.* (formatowanie) i icon() (ikony SVG).
app.use((req, res, next) => {
  res.locals.assetVer = pkg.version; // cache-busting ?v= dla app.css — świeży CSS po każdym releasie
  res.locals.fmt = fmt;
  res.locals.icon = icon;
  res.locals.eventIcon = eventIcon;
  res.locals.fileMeta = fileMeta;
  res.locals.logoTag = logoTag;
  res.locals.hasLogo = hasLogo;
  res.locals.qrSvg = qr.svg; // kod QR jako inline SVG: <%- qrSvg(url) %>
  next();
});

// Branding/ustawienia dostępne w każdym widoku + nadpisanie koloru przewodniego
// (zmienne CSS --brand-* generowane z wybranego koloru, bez rebuildu CSS).
function paletteVars(hex) {
  const pal = color.palette(hex);
  return pal ? Object.entries(pal).map(([k, v]) => `--brand-${k}:${v}`).join(';') : '';
}

// Zmienne CSS dla .evoke-card / .evoke-btn z konfiguracji układu (styl karty, rogi, przycisk).
function surfaceVars(layout) {
  const L = layout || {};
  const vars = [];
  let extra = '';
  if (Number.isInteger(L.radius) && L.radius !== 24) vars.push(`--card-radius:${L.radius}px`);
  if (L.button === 'pill') vars.push('--btn-radius:9999px');
  if (L.card === 'glass') {
    // Krycie szkła 0.74 (było 0.62): przy 0.62 tekst pomocniczy (slate-400/500) i przerywana
    // ramka dropzone gubiły się na jasnym tle — 0.74 wciąż daje efekt „mrożonego szkła" (blur),
    // ale skutecznie rozjaśnia tło karty → czcionki i ramki są czytelne.
    vars.push(
      '--card-bg:rgba(255,255,255,0.74)',
      '--card-border-color:rgba(255,255,255,0.6)',
      '--card-shadow:0 10px 40px rgba(2,6,23,0.18)'
    );
    // backdrop-filter LITERALNIE (nie przez var()): Safari NIE stosuje
    // -webkit-backdrop-filter podanego jako var(...) — literał blur(14px) działa.
    // Reguła po linku do app.css → wygrywa; `.evoke-panel-mode .evoke-card` (wyższa
    // specyficzność) i tak ją zeruje, gdy styl to panel.
    extra = '.evoke-card{-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}'
      // Szklany panel: kompozycje „Panel na tle" / „Panel na tle 2" — biały flush panel też
      // robi się półprzezroczysty (tło prześwituje). Nadpisuje utility .bg-white (ta sama
      // specyficzność, ale reguła wstrzykiwana PO app.css). Dark mode: !important, bo
      // html.dark .bg-white ma !important.
      + '.evoke-panel{background-color:rgba(255,255,255,0.74);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}'
      + 'html.dark .evoke-panel{background-color:rgba(15,23,42,0.62)!important}';
  } else if (L.card === 'elevated') {
    vars.push('--card-shadow:0 30px 60px -15px rgba(2,6,23,0.35)');
  }
  const root = vars.length ? `:root{${vars.join(';')}}` : '';
  return (root || extra) ? `<style>${root}${extra}</style>` : '';
}

app.use(async (req, res, next) => {
  res.locals.appUrl = config.appUrl;
  res.locals.canonicalUrl = config.appUrl + req.path; // og:url / kanoniczny link (bez query)
  try {
    const s = await settingsService.get();
    res.locals.settings = s;
    const c = s.colors || {};

    // Strona klienta: paleta brand-* z koloru przewodniego (primary).
    const primary = c.primary;
    const clientVars = primary && primary.toLowerCase() !== '#6e00a5' ? paletteVars(primary) : '';
    res.locals.brandStyleTag = clientVars ? `<style>:root{${clientVars}}</style>` : '';

    // Panel admina: paleta brand-* z koloru akcentu (gdy pusty → primary),
    // plus zmienne tła panelu i sidebara (klasy bg-[var(--admin-bg)] / bg-[var(--admin-sidebar)]).
    const accent = color.safeHex(c.adminAccent, color.safeHex(primary, '#6e00a5'));
    const adminSidebar = color.safeHex(c.adminSidebar, '#ffffff');
    const adminBg = color.safeHex(c.adminBg, '#f8fafc');
    // Kolor czcionki panelu: jawny albo auto-kontrast z tła panelu.
    const adminText = color.safeHex(c.adminText, '') || color.readableText(adminBg);
    // Pasek nagłówka panelu — osobny kolor; puste = jak sidebar (zgodność wstecz).
    const adminHeader = color.safeHex(c.adminHeader, '') || adminSidebar;
    const adminVars = [
      accent.toLowerCase() !== '#6e00a5' ? paletteVars(accent) : '',
      `--admin-bg:${adminBg}`,
      `--admin-text:${adminText}`,
      `--admin-sidebar:${adminSidebar}`,
      `--admin-sidebar-text:${color.readableText(adminSidebar)}`,
      `--admin-header:${adminHeader}`,
      `--admin-header-text:${color.readableText(adminHeader)}`,
    ].filter(Boolean).join(';');
    res.locals.adminStyleTag = `<style>:root{${adminVars}}</style>`;

    // Dark mode: kolory ciemne z ustawień (puste → wartości domyślne z input.css).
    const darkBg = color.safeHex(c.darkBg, '#0f172a');
    const darkSurface = color.safeHex(c.darkSurface, '#1e293b');
    const darkText = color.safeHex(c.darkText, '#e5e7eb');
    res.locals.darkStyleTag =
      `<style>html.dark{--dk-bg:${darkBg};--dk-surface:${darkSurface};--dk-text:${darkText};` +
      `--dk-surface-2:color-mix(in srgb, ${darkSurface} 82%, #fff);` +
      `--dk-border:color-mix(in srgb, ${darkSurface} 66%, #fff)}</style>`;

    // Tło stron klienta (gradient/obraz/kolor + ziarno).
    res.locals.bgStyle = bg.bodyStyle(s.background);
    res.locals.bgOverlay = bg.overlayHtml(s.background);
    res.locals.bgSlideshow = bg.slideshowHtml(s.background);
    res.locals.bgDark = bg.isDark(s.background);

    // Tło strony logowania — własne (Settings.loginBackground) albo dziedziczone z klienta.
    const lb = s.loginBackground;
    res.locals.loginBgStyle = lb ? bg.bodyStyle(lb) : res.locals.bgStyle;
    res.locals.loginBgOverlay = lb ? bg.overlayHtml(lb) : res.locals.bgOverlay;
    res.locals.loginBgSlideshow = lb ? bg.slideshowHtml(lb) : res.locals.bgSlideshow;
    res.locals.loginBgDark = lb ? bg.isDark(lb) : res.locals.bgDark;

    // Układ stron klienta + zmienne karty/rogów/przycisku (.evoke-card / .evoke-btn).
    // UWAGA: nazwa `uiLayout`, NIE `layout` — `layout` koliduje z express-ejs-layouts
    // (tam `layout` to nazwa pliku układu przekazywana przez kontrolery).
    res.locals.uiLayout = s.layout;
    res.locals.surfaceStyleTag = surfaceVars(s.layout);
    res.locals.typographyStyleTag = fonts.styleTag(s.layout && s.layout.font);

    // Efektywny tryb nawigacji portali (/c, /p): w wąskich kompozycjach (panel/showcase/
    // corner/split — brak miejsca na kolumnę) menu w karcie degraduje do zakładek,
    // a pasek boczny strony do paska u góry.
    const narrowStyles = ['panel', 'panel-bg', 'showcase', 'corner', 'split'];
    let pn = s.layout.portalNav || 'none';
    if (narrowStyles.includes(s.layout.style)) {
      if (pn.startsWith('side')) pn = 'tabs';
      else if (pn.startsWith('bar')) pn = 'top';
    }
    res.locals.portalNavMode = pn;

    // Własny CSS admina (escape hatch) — wstrzykiwany do wszystkich layoutów.
    res.locals.customStyleTag = s.customCss ? `<style>${sanitizeCss(s.customCss)}</style>` : '';
  } catch (_) {
    res.locals.settings = settingsService.DEFAULTS;
    res.locals.brandStyleTag = '';
    res.locals.adminStyleTag = '';
    res.locals.darkStyleTag = '';
    res.locals.bgStyle = bg.bodyStyle(bg.DEFAULTS);
    res.locals.bgOverlay = '';
    res.locals.bgSlideshow = '';
    res.locals.bgDark = false;
    res.locals.loginBgStyle = res.locals.bgStyle;
    res.locals.loginBgOverlay = '';
    res.locals.loginBgSlideshow = '';
    res.locals.loginBgDark = false;
    res.locals.uiLayout = settingsService.DEFAULTS.layout;
    res.locals.portalNavMode = 'none';
    res.locals.surfaceStyleTag = '';
    res.locals.typographyStyleTag = '';
    res.locals.customStyleTag = '';
  }
  next();
});

// Trasy.
app.use('/admin', authRoutes); // /admin/login, /admin/logout
app.use('/admin', adminRoutes); // pulpit i sekcje (chronione)
app.use('/', publicRoutes); // strony publiczne

// 404 + błędy.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
