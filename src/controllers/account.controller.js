// Panel: konto admina — zmiana hasła (zapis do bazy, zob. auth.service).
const config = require('../config');
const { verifyCredentials, setAdminPassword, hasDbPassword } = require('../services/auth.service');
const events = require('../services/event.service');

async function showAccount(req, res, next) {
  try {
    res.render('admin/account', {
      title: 'Konto',
      active: 'account',
      email: config.admin.email,
      usingDbPassword: await hasDbPassword(),
      saved: req.query.saved === '1',
      error: null,
    });
  } catch (err) {
    next(err);
  }
}

async function render(res, status, extra) {
  res.status(status).render('admin/account', {
    title: 'Konto',
    active: 'account',
    email: config.admin.email,
    usingDbPassword: await hasDbPassword(),
    saved: false,
    error: null,
    ...extra,
  });
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

module.exports = { showAccount, changePassword };
