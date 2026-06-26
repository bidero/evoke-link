// Panel: customizacja (branding, kolory panelu, tło stron klienta, treści).
const fs = require('fs');
const settingsService = require('../services/settings.service');
const events = require('../services/event.service');
const { safeHex } = require('../utils/color');
const { sanitizeSvg, looksLikeSvg } = require('../utils/svgSanitize');
const { sanitizeCss } = require('../utils/css');
const background = require('../utils/background');

async function showSettings(req, res, next) {
  try {
    const settings = await settingsService.get();
    res.render('admin/settings', {
      title: 'Ustawienia',
      active: 'settings',
      settings,
      presets: background.PRESETS,
      saved: req.query.saved === '1',
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
      grain: b.bgGrain === 'on',
      grainStrength: Math.min(100, Math.max(0, parseInt(b.bgGrainStrength, 10) || 0)),
    };

    // --- Logo: rozmiar + wyrównanie ---
    const logoCfg = {
      size: Math.min(120, Math.max(16, parseInt(b.logoSize, 10) || 36)),
      align: ['left', 'center', 'right'].includes(b.logoAlign) ? b.logoAlign : 'left',
    };

    // --- Układ stron klienta ---
    const layout = {
      style: ['classic', 'centered', 'split'].includes(b.layoutStyle) ? b.layoutStyle : 'classic',
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
    };

    // --- Pliki: logo / favicon (sanityzacja SVG) ---
    const logo = uploadedFile(req, 'logo');
    if (logo) { sanitizeIfSvg(logo); data.logoPath = `/branding/${logo.filename}`; }
    else if (b.removeLogo === 'on') data.logoPath = null;

    const fav = uploadedFile(req, 'favicon');
    if (fav) { sanitizeIfSvg(fav); data.faviconPath = `/branding/${fav.filename}`; }
    else if (b.removeFavicon === 'on') data.faviconPath = null;

    // --- Plik: obraz tła ---
    const bgImg = uploadedFile(req, 'bg');
    if (bgImg) background.imagePath = `/branding/${bgImg.filename}`;
    else if (b.removeBg === 'on') background.imagePath = null;

    await settingsService.update(data);
    await events.log({ type: 'updated', message: 'Zmieniono ustawienia / branding', ip: req.ip });

    res.redirect('/admin/settings?saved=1');
  } catch (err) {
    next(err);
  }
}

module.exports = { showSettings, updateSettings };
