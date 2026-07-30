// Panel: „Mój profil" — profil administratora (nazwa/rola/telefon/avatar) + zmiana hasła.
const config = require('../config');
const { verifyCredentials, setAdminPassword, hasDbPassword } = require('../services/auth.service');
const authService = require('../services/auth.service');
const totp = require('../utils/totp');
const qr = require('../utils/qr');
const webauthn = require('../services/webauthn.service');
const settingsService = require('../services/settings.service');
const { sanitizeIfSvg } = require('../utils/svgSanitize');
const events = require('../services/event.service');

async function baseLocals(req, extra) {
  const settings = await settingsService.get();
  const me = (req && req.session && req.session.user) || {};
  // Stan 2FA bieżącego konta (gdy sesja pochodzi jeszcze z bootstrapu .env — brak id).
  let user = null;
  if (me.id) user = await authService.findByEmail(me.email);
  return {
    title: 'Mój profil',
    active: 'account',
    email: me.email || config.admin.email,
    profile: settings.profile,
    usingDbPassword: await hasDbPassword(),
    canUse2fa: !!me.id,                                  // 2FA wymaga konta w bazie
    twoFaOn: authService.has2fa(user),
    recoveryLeft: authService.recoveryCodesLeft(user),
    passkeys: me.id ? await webauthn.listForUser(me.id) : [],
    passkeysSupported: webauthn.isSupportedOrigin(),     // HTTPS albo localhost
    appUrlHost: webauthn.rp().id,
    setupSecret: null, setupUri: null, setupQr: null, newCodes: null,
    saved: false,
    savedProfile: false,
    error: null,
    ...extra,
  };
}

async function showAccount(req, res, next) {
  try {
    res.render('admin/account', await baseLocals(req, { saved: req.query.saved === '1', savedProfile: req.query.profile === '1' }));
  } catch (err) {
    next(err);
  }
}

async function render(req, res, status, extra) {
  res.status(status).render('admin/account', await baseLocals(req, extra));
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
    const me = (req.session && req.session.user) || {};
    const email = me.email || config.admin.email;

    // WAŻNE (multi-user): sprawdzamy i zmieniamy hasło ZALOGOWANEGO konta,
    // nie konta z .env — inaczej pracownik zmieniłby hasło administratorowi.
    if (!(await verifyCredentials(email, currentPassword))) {
      return render(req, res, 401, { error: 'Obecne hasło jest nieprawidłowe.' });
    }
    if (!newPassword || newPassword.length < 8) {
      return render(req, res, 400, { error: 'Nowe hasło musi mieć co najmniej 8 znaków.' });
    }
    if (newPassword !== confirmPassword) {
      return render(req, res, 400, { error: 'Powtórzone hasło nie zgadza się.' });
    }

    if (me.id) await authService.updateUser(me.id, { password: newPassword });
    else await setAdminPassword(newPassword); // sesja z bootstrapu .env — zakłada konto admina
    await events.log({ type: 'updated', message: `Zmieniono hasło konta: ${email}`, ip: req.ip });

    res.redirect('/admin/account?saved=1');
  } catch (err) {
    next(err);
  }
}

// ── 2FA (TOTP) ───────────────────────────────────────────────────────────────
// Krok 1: wygeneruj sekret i pokaż QR (jeszcze nieaktywne).
async function start2fa(req, res, next) {
  try {
    const me = (req.session && req.session.user) || {};
    if (!me.id) return res.redirect('/admin/account');
    const secret = await authService.begin2fa(me.id);
    const settings = await settingsService.get();
    const uri = totp.otpauthUri({ secret, account: me.email, issuer: settings.appName || 'Evoke LINK' });
    res.render('admin/account', await baseLocals(req, { setupSecret: secret, setupUri: uri, setupQr: qr.svg(uri, { cell: 4, margin: 2 }) }));
  } catch (err) {
    next(err);
  }
}

// Krok 2: potwierdź kodem z aplikacji → włącz 2FA i pokaż kody zapasowe (jedyny raz).
async function confirm2fa(req, res, next) {
  try {
    const me = (req.session && req.session.user) || {};
    if (!me.id) return res.redirect('/admin/account');
    const codes = await authService.confirm2fa(me.id, req.body.token);
    if (!codes) {
      const user = await authService.findByEmail(me.email);
      const settings = await settingsService.get();
      const uri = user && user.totpSecret ? totp.otpauthUri({ secret: user.totpSecret, account: me.email, issuer: settings.appName || 'Evoke LINK' }) : null;
      return render(req, res, 400, {
        error: 'Nieprawidłowy kod — sprawdź, czy zegar telefonu jest zsynchronizowany.',
        setupSecret: user ? user.totpSecret : null, setupUri: uri, setupQr: uri ? qr.svg(uri, { cell: 4, margin: 2 }) : null,
      });
    }
    await events.log({ type: 'updated', message: `Włączono 2FA: ${me.email}`, ip: req.ip });
    res.render('admin/account', await baseLocals(req, { newCodes: codes }));
  } catch (err) {
    next(err);
  }
}

async function disable2fa(req, res, next) {
  try {
    const me = (req.session && req.session.user) || {};
    if (!me.id) return res.redirect('/admin/account');
    // Wyłączenie wymaga potwierdzenia hasłem (2FA to zabezpieczenie konta).
    if (!(await verifyCredentials(me.email, req.body.password))) {
      return render(req, res, 401, { error: 'Aby wyłączyć 2FA, podaj poprawne hasło.' });
    }
    await authService.disable2fa(me.id);
    await events.log({ type: 'updated', message: `Wyłączono 2FA: ${me.email}`, ip: req.ip });
    res.redirect('/admin/account');
  } catch (err) {
    next(err);
  }
}

async function newRecoveryCodes(req, res, next) {
  try {
    const me = (req.session && req.session.user) || {};
    if (!me.id) return res.redirect('/admin/account');
    const codes = await authService.regenerateRecoveryCodes(me.id);
    if (!codes) return res.redirect('/admin/account');
    res.render('admin/account', await baseLocals(req, { newCodes: codes }));
  } catch (err) {
    next(err);
  }
}

// ── Passkeys (WebAuthn) ──────────────────────────────────────────────────────
// Rejestracja przebiega przez JSON: przeglądarka prosi o opcje, tworzy klucz
// i odsyła odpowiedź do weryfikacji. Challenge trzymamy w sesji.
async function passkeyOptions(req, res, next) {
  try {
    const me = (req.session && req.session.user) || {};
    if (!me.id) return res.status(400).json({ error: 'Passkey wymaga konta w bazie.' });
    const settings = await settingsService.get();
    const options = await webauthn.registrationOptions(me, settings.appName);
    req.session.pkChallenge = options.challenge;
    res.json(options);
  } catch (err) {
    next(err);
  }
}

async function passkeyVerify(req, res, next) {
  try {
    const me = (req.session && req.session.user) || {};
    const challenge = req.session && req.session.pkChallenge;
    if (!me.id || !challenge) return res.status(400).json({ error: 'Sesja rejestracji wygasła.' });
    const cred = await webauthn.verifyRegistration(me, req.body.response, challenge, req.body.label);
    req.session.pkChallenge = null;
    if (!cred) return res.status(400).json({ error: 'Nie udało się zweryfikować klucza.' });
    await events.log({ type: 'updated', message: `Dodano passkey: ${me.email}`, ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

async function passkeyDelete(req, res, next) {
  try {
    const me = (req.session && req.session.user) || {};
    if (!me.id) return res.redirect('/admin/account');
    await webauthn.removeCredential(me.id, req.params.id);
    await events.log({ type: 'updated', message: `Usunięto passkey: ${me.email}`, ip: req.ip });
    res.redirect('/admin/account');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  showAccount, updateProfile, changePassword, start2fa, confirm2fa, disable2fa, newRecoveryCodes,
  passkeyOptions, passkeyVerify, passkeyDelete,
};
