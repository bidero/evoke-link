// Panel: customizacja (branding, kolory panelu, tło stron klienta, treści).
const fs = require('fs');
const settingsService = require('../services/settings.service');
const events = require('../services/event.service');
const mail = require('../services/mail.service');
const config = require('../config');
const { safeHex } = require('../utils/color');
const { sanitizeSvg, looksLikeSvg } = require('../utils/svgSanitize');
const { sanitizeCss } = require('../utils/css');
const background = require('../utils/background');

// parseInt z zakresem i domyślną wartością. Ważne: ZACHOWUJE 0
// (wzorzec `parseInt(x) || dflt` mylił 0 z brakiem wartości — przez to kąt 0° nie zapisywał się).
function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}

async function showSettings(req, res, next) {
  try {
    const settings = await settingsService.get();
    res.render('admin/settings', {
      title: 'Ustawienia',
      active: 'settings',
      settings,
      presets: background.PRESETS,
      saved: req.query.saved === '1',
      mailReady: mail.isConfigured(),
      adminEmail: config.admin.email,
      placeholders: mail.PLACEHOLDERS,
      test: req.query.test || null, // sent | dev | error
    });
  } catch (err) {
    next(err);
  }
}

function uploadedFile(req, field) {
  return req.files && req.files[field] && req.files[field][0];
}

// Po wgraniu pliku graficznego: jeśli to SVG, oczyść go na dysku (XSS/XXE).
function sanitizeIfSvg(file) {
  if (!file) return;
  const isSvg = /svg/i.test(file.mimetype) || /\.svg$/i.test(file.originalname);
  if (!isSvg) return;
  try {
    const raw = fs.readFileSync(file.path, 'utf8');
    if (looksLikeSvg(raw)) fs.writeFileSync(file.path, sanitizeSvg(raw), 'utf8');
  } catch (_) { /* nie blokuj zapisu ustawień przez błąd I/O */ }
}

async function updateSettings(req, res, next) {
  try {
    const b = req.body;

    // --- Kolory ---
    const primary = safeHex(b.primary, '#6e00a5');
    const colors = {
      primary,
      adminAccent: safeHex(b.adminAccent, '') || '', // puste = dziedziczy primary
      adminText: safeHex(b.adminText, '') || '',      // puste = auto-kontrast z tła
      adminSidebar: safeHex(b.adminSidebar, '#ffffff'),
      adminBg: safeHex(b.adminBg, '#f8fafc'),
      darkBg: safeHex(b.darkBg, '#0f172a'),
      darkSurface: safeHex(b.darkSurface, '#1e293b'),
      darkText: safeHex(b.darkText, '#e5e7eb'),
    };

    // --- Treści ---
    const texts = {
      heroTitle: (b.heroTitle || '').trim(),
      heroSubtitle: (b.heroSubtitle || '').trim(),
      footer: (b.footer || '').trim(),
    };

    // --- Tło stron klienta ---
    const current = await settingsService.get();
    const background = {
      type: ['gradient', 'custom', 'image', 'solid'].includes(b.bgType) ? b.bgType : 'gradient',
      preset: b.bgPreset || 'brand-soft',
      color: safeHex(b.bgColor, '#f4f6fb'),
      custom: {
        c1: safeHex(b.gradC1, '#6e00a5'),
        c2: safeHex(b.gradC2, '#a31fde'),
        c3: safeHex(b.gradC3, '') || '',
        angle: Math.min(360, Math.max(0, parseInt(b.gradAngle, 10) || 0)),
      },
      imagePath: current.background.imagePath || null,
      overlay: Math.min(80, Math.max(0, parseInt(b.bgOverlay, 10) || 0)),
      imageGradient: b.bgImageGradient === 'on',
      imageGrad: { c1: safeHex(b.imgGradC1, '#6e00a5'), c2: safeHex(b.imgGradC2, '') || '', angle: clampInt(b.imgGradAngle, 0, 360, 135) },
      grain: b.bgGrain === 'on',
      grainType: b.bgGrainType,
      grainStrength: Math.min(100, Math.max(0, parseInt(b.bgGrainStrength, 10) || 0)),
    };

    // --- Logo: rozmiar + wyrównanie ---
    const logoCfg = {
      size: Math.min(120, Math.max(16, parseInt(b.logoSize, 10) || 36)),
      align: ['left', 'center', 'right'].includes(b.logoAlign) ? b.logoAlign : 'left',
      darkPath: current.logo.darkPath || null, // zachowaj; nadpisywane niżej przy uploadzie/usuwaniu
    };

    // --- Układ stron klienta ---
    const layout = {
      style: ['classic', 'centered', 'split', 'hero-card', 'minimal', 'banner'].includes(b.layoutStyle) ? b.layoutStyle : 'classic',
      card: ['solid', 'glass', 'elevated'].includes(b.layoutCard) ? b.layoutCard : 'solid',
      cardSide: ['left', 'right'].includes(b.cardSide) ? b.cardSide : 'right',
      hideName: b.hideName === 'on',
      heroOnBg: b.heroOnBg === 'on',
      applyToLogin: b.applyToLogin === 'on',
      radius: Math.min(40, Math.max(0, parseInt(b.layoutRadius, 10) >= 0 ? parseInt(b.layoutRadius, 10) : 24)),
      button: ['rounded', 'pill'].includes(b.layoutButton) ? b.layoutButton : 'rounded',
    };

    const data = {
      appName: b.appName && b.appName.trim() ? b.appName.trim() : null,
      colors,
      texts,
      background,
      logo: logoCfg,
      layout,
      customCss: sanitizeCss(b.customCss || ''),
      emails: {
        logoPath: current.emails.logoPath || null,
        linkSubject: (b.linkSubject || '').trim(),
        linkIntro: (b.linkIntro || '').trim(),
        panelSubject: (b.panelSubject || '').trim(),
        panelIntro: (b.panelIntro || '').trim(),
        uploadSubject: (b.uploadSubject || '').trim(),
        downloadSubject: (b.downloadSubject || '').trim(),
        clientConfirm: b.clientConfirm === 'on',
        clientConfirmSubject: (b.clientConfirmSubject || '').trim(),
        clientConfirmBody: (b.clientConfirmBody || '').trim(),
      },
    };

    // --- Pliki: logo / favicon (sanityzacja SVG) ---
    const logo = uploadedFile(req, 'logo');
    if (logo) { sanitizeIfSvg(logo); data.logoPath = `/branding/${logo.filename}`; }
    else if (b.removeLogo === 'on') data.logoPath = null;

    const logoDark = uploadedFile(req, 'logoDark');
    if (logoDark) { sanitizeIfSvg(logoDark); data.logo.darkPath = `/branding/${logoDark.filename}`; }
    else if (b.removeLogoDark === 'on') data.logo.darkPath = null;

    const fav = uploadedFile(req, 'favicon');
    if (fav) { sanitizeIfSvg(fav); data.faviconPath = `/branding/${fav.filename}`; }
    else if (b.removeFavicon === 'on') data.faviconPath = null;

    // --- Plik: obraz tła ---
    const bgImg = uploadedFile(req, 'bg');
    if (bgImg) background.imagePath = `/branding/${bgImg.filename}`;
    else if (b.removeBg === 'on') background.imagePath = null;

    // --- Plik: osobne logo w mailach ---
    const mailLogo = uploadedFile(req, 'mailLogo');
    if (mailLogo) { sanitizeIfSvg(mailLogo); data.emails.logoPath = `/branding/${mailLogo.filename}`; }
    else if (b.removeMailLogo === 'on') data.emails.logoPath = null;

    await settingsService.update(data);
    await events.log({ type: 'updated', message: 'Zmieniono ustawienia / branding', ip: req.ip });

    res.redirect('/admin/settings?saved=1');
  } catch (err) {
    next(err);
  }
}

// Wysyłka testowego e-maila (weryfikacja SMTP z .env).
async function sendTestEmail(req, res, next) {
  try {
    const to = (req.body.testTo || '').trim() || config.admin.email;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.redirect('/admin/settings?test=error');
    await mail.sendTest({ to });
    res.redirect('/admin/settings?test=' + (mail.isConfigured() ? 'sent' : 'dev'));
  } catch (e) {
    console.error('[mail] test:', e.message);
    res.redirect('/admin/settings?test=error');
  }
}

module.exports = { showSettings, updateSettings, sendTestEmail };
