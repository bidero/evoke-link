// Obsługa requestów logowania/wylogowania (cienka warstwa — logika w auth.service).
// Logowanie dwuetapowe: hasło → (gdy konto ma 2FA) kod z aplikacji albo kod zapasowy.
const { authenticate, touchLogin, verifySecondFactor } = require('../services/auth.service');
const webauthn = require('../services/webauthn.service');

const loginView = (extra) => ({ title: 'Logowanie', layout: 'layouts/auth', error: null, email: '', ...extra });

function showLogin(req, res) {
  if (req.session && req.session.user) {
    return res.redirect('/admin');
  }
  res.render('admin/login', loginView({}));
}

// Zalogowanie użytkownika (po haśle albo po drugim składniku).
function finish(req, res, user) {
  delete user.needs2fa;
  req.session.pending2fa = null;
  req.session.user = user; // { id, email, name, role }
  touchLogin(user.id);     // best-effort — nie blokuje logowania
  return res.redirect('/admin');
}

async function doLogin(req, res, next) {
  try {
    const { email, password } = req.body;

    const user = await authenticate(email, password);
    if (user) {
      if (user.needs2fa) {
        // Hasło poprawne — trzymamy użytkownika „w poczekalni" do czasu podania kodu.
        req.session.pending2fa = { user, at: Date.now() };
        return res.render('admin/login-2fa', { title: 'Weryfikacja dwuetapowa', layout: 'layouts/auth', error: null });
      }
      return finish(req, res, user);
    }

    res.status(401).render('admin/login', loginView({ error: 'Nieprawidłowy e-mail lub hasło.', email: email || '' }));
  } catch (err) {
    next(err);
  }
}

// Drugi krok: kod z aplikacji (TOTP) albo kod zapasowy.
async function doVerify2fa(req, res, next) {
  try {
    const pending = req.session && req.session.pending2fa;
    // Poczekalnia wygasa po 10 minutach — wtedy logowanie od nowa.
    if (!pending || !pending.user || Date.now() - (pending.at || 0) > 10 * 60 * 1000) {
      req.session.pending2fa = null;
      return res.status(401).render('admin/login', loginView({ error: 'Sesja logowania wygasła — zaloguj się ponownie.' }));
    }
    if (await verifySecondFactor(pending.user.id, req.body.token)) {
      return finish(req, res, pending.user);
    }
    res.status(401).render('admin/login-2fa', { title: 'Weryfikacja dwuetapowa', layout: 'layouts/auth', error: 'Nieprawidłowy kod. Spróbuj ponownie lub użyj kodu zapasowego.' });
  } catch (err) {
    next(err);
  }
}

// ── Logowanie passkeyem (bez hasła) ──────────────────────────────────────────
// Klucz jest „czymś, co masz" + weryfikacja użytkownika na urządzeniu (Touch ID/PIN),
// więc sam w sobie jest dwuskładnikowy — nie prosimy dodatkowo o kod TOTP.
async function passkeyOptions(req, res, next) {
  try {
    const options = await webauthn.authenticationOptions();
    req.session.pkLoginChallenge = options.challenge;
    res.json(options);
  } catch (err) {
    next(err);
  }
}

async function passkeyLogin(req, res, next) {
  try {
    const challenge = req.session && req.session.pkLoginChallenge;
    if (!challenge) return res.status(400).json({ error: 'Sesja logowania wygasła — odśwież stronę.' });
    const user = await webauthn.verifyAuthentication(req.body.response, challenge);
    req.session.pkLoginChallenge = null;
    if (!user) return res.status(401).json({ error: 'Nie rozpoznano klucza.' });
    req.session.pending2fa = null;
    req.session.user = user;
    touchLogin(user.id);
    res.json({ ok: true, redirect: '/admin' });
  } catch (err) {
    next(err);
  }
}

function doLogout(req, res) {
  req.session = null;
  res.redirect('/admin/login');
}

module.exports = { showLogin, doLogin, doVerify2fa, doLogout, passkeyOptions, passkeyLogin };
