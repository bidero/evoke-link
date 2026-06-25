// Budowa i konfiguracja aplikacji Express. Eksportuje gotową aplikację;
// faktyczne nasłuchiwanie portu jest w głównym pliku app.js (entry dla Passengera).
const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const expressLayouts = require('express-ejs-layouts');
const helmet = require('helmet');

const config = require('./config');
const fmt = require('./utils/format');
const { icon, eventIcon } = require('./utils/icons');
const color = require('./utils/color');
const bg = require('./utils/background');
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

// Bezpieczeństwo nagłówków. CSP wyłączone na start (włączymy świadomie w Etapie 6,
// gdy ustabilizują się źródła CSS/JS), żeby nie blokować Alpine/Tailwind w dev.
app.use(helmet({ contentSecurityPolicy: false }));

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
  res.locals.fmt = fmt;
  res.locals.icon = icon;
  res.locals.eventIcon = eventIcon;
  next();
});

// Branding/ustawienia dostępne w każdym widoku + nadpisanie koloru przewodniego
// (zmienne CSS --brand-* generowane z wybranego koloru, bez rebuildu CSS).
function paletteVars(hex) {
  const pal = color.palette(hex);
  return pal ? Object.entries(pal).map(([k, v]) => `--brand-${k}:${v}`).join(';') : '';
}

app.use(async (req, res, next) => {
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
    const adminVars = [
      accent.toLowerCase() !== '#6e00a5' ? paletteVars(accent) : '',
      `--admin-bg:${adminBg}`,
      `--admin-text:${adminText}`,
      `--admin-sidebar:${adminSidebar}`,
      `--admin-sidebar-text:${color.readableText(adminSidebar)}`,
    ].filter(Boolean).join(';');
    res.locals.adminStyleTag = `<style>:root{${adminVars}}</style>`;

    // Tło stron klienta (gradient/obraz/kolor + ziarno).
    res.locals.bgStyle = bg.bodyStyle(s.background);
    res.locals.bgOverlay = bg.overlayHtml(s.background);
    res.locals.bgDark = bg.isDark(s.background);

    // Własny CSS admina (escape hatch) — wstrzykiwany do wszystkich layoutów.
    res.locals.customStyleTag = s.customCss ? `<style>${sanitizeCss(s.customCss)}</style>` : '';
  } catch (_) {
    res.locals.settings = settingsService.DEFAULTS;
    res.locals.brandStyleTag = '';
    res.locals.adminStyleTag = '';
    res.locals.bgStyle = bg.bodyStyle(bg.DEFAULTS);
    res.locals.bgOverlay = '';
    res.locals.bgDark = false;
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
