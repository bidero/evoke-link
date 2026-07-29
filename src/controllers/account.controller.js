// Panel: „Mój profil" — profil administratora (nazwa/rola/telefon/avatar) + zmiana hasła.
const fs = require('fs');
const config = require('../config');
const { verifyCredentials, setAdminPassword, hasDbPassword } = require('../services/auth.service');
const settingsService = require('../services/settings.service');
const { sanitizeSvg, looksLikeSvg } = require('../utils/svgSanitize');
const events = require('../services/event.service');

async function baseLocals(extra) {
  const settings = await settingsService.get();
  return {
    title: 'Mój profil',
    active: 'account',
    email: config.admin.email,
    profile: settings.profile,
    usingDbPassword: await hasDbPassword(),
    saved: false,
    savedProfile: false,
    error: null,
    ...extra,
  };
}

async function showAccount(req, res, next) {
  try {
    res.render('admin/account', await baseLocals({ saved: req.query.saved === '1', savedProfile: req.query.profile === '1' }));
  } catch (err) {
    next(err);
  }
}

async function render(res, status, extra) {
  res.status(status).render('admin/account', await baseLocals(extra));
}

// Jeśli avatar to SVG — oczyść na dysku (XSS/XXE), jak reszta brandingu.
function sanitizeIfSvg(file) {
  if (!file) return;
  const isSvg = /svg/i.test(file.mimetype) || /\.svg$/i.test(file.originalname);
  if (!isSvg) return;
  try {
    const raw = fs.readFileSync(file.path, 'utf8');
    if (looksLikeSvg(raw)) fs.writeFileSync(file.path, sanitizeSvg(raw), 'utf8');
  } catch (_) { /* nie blokuj zapisu przez błąd I/O */ }
}

async function updateProfile(req, res, next) {
  try {
    const cur = (await settingsService.get()).profile;
    const profile = {
      name: req.body.name,
      role: req.body.role,
      phone: req.body.phone,
      avatarPath: cur.avatarPath,
    };
    if (req.file) {
      sanitizeIfSvg(req.file);
      profile.avatarPath = '/branding/' + req.file.filename;
    } else if (req.body.removeAvatar === '1') {
      profile.avatarPath = null;
    }
    await settingsService.update({ profile });
    res.redirect('/admin/account?profile=1');
  } catch (err) {
    next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!(await verifyCredentials(config.admin.email, currentPassword))) {
      return render(res, 401, { error: 'Obecne hasło jest nieprawidłowe.' });
    }
    if (!newPassword || newPassword.length < 8) {
      return render(res, 400, { error: 'Nowe hasło musi mieć co najmniej 8 znaków.' });
    }
    if (newPassword !== confirmPassword) {
      return render(res, 400, { error: 'Powtórzone hasło nie zgadza się.' });
    }

    await setAdminPassword(newPassword);
    await events.log({ type: 'updated', message: 'Zmieniono hasło administratora', ip: req.ip });

    res.redirect('/admin/account?saved=1');
  } catch (err) {
    next(err);
  }
}

module.exports = { showAccount, updateProfile, changePassword };
