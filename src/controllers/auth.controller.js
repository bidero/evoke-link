// Obsługa requestów logowania/wylogowania (cienka warstwa — logika w auth.service).
const { authenticate, touchLogin } = require('../services/auth.service');

function showLogin(req, res) {
  if (req.session && req.session.user) {
    return res.redirect('/admin');
  }
  res.render('admin/login', {
    title: 'Logowanie',
    layout: 'layouts/auth',
    error: null,
    email: '',
  });
}

async function doLogin(req, res, next) {
  try {
    const { email, password } = req.body;

    const user = await authenticate(email, password);
    if (user) {
      req.session.user = user; // { id, email, name, role }
      touchLogin(user.id);     // best-effort — nie blokuje logowania
      return res.redirect('/admin');
    }

    res.status(401).render('admin/login', {
      title: 'Logowanie',
      layout: 'layouts/auth',
      error: 'Nieprawidłowy e-mail lub hasło.',
      email: email || '',
    });
  } catch (err) {
    next(err);
  }
}

function doLogout(req, res) {
  req.session = null;
  res.redirect('/admin/login');
}

module.exports = { showLogin, doLogin, doLogout };
