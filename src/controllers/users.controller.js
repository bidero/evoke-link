// Panel: konta użytkowników (tylko admin — bramka requireAdmin na prefiksie /users).
// Role: admin (wszystko) | staff (bez Ustawień, aktualizacji i kont).
const authService = require('../services/auth.service');
const config = require('../config');
const events = require('../services/event.service');

const back = (msg) => `/admin/users${msg ? `?msg=${msg}` : ''}`;

async function index(req, res, next) {
  try {
    const users = await authService.listUsers();
    res.render('admin/users/index', {
      title: 'Konta',
      active: 'users',
      users,
      envEmail: (config.admin.email || '').trim().toLowerCase(),
      msg: req.query.msg || null,
      error: req.query.error || null,
    });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { email, password, name, role } = req.body;
    if (!email || !password || password.length < 8) return res.redirect('/admin/users?error=weak');
    const existing = await authService.findByEmail(email);
    if (existing) return res.redirect('/admin/users?error=dup');
    const u = await authService.createUser({ email, password, name, role });
    if (!u) return res.redirect('/admin/users?error=weak');
    await events.log({ type: 'updated', message: `Dodano konto: ${u.email} (${u.role})`, ip: req.ip });
    res.redirect(back('created'));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const id = Number(req.params.id);
    const me = req.session.user || {};
    const body = req.body;
    // Zabezpieczenie: nie odbieraj sobie własnej roli admina ani nie wyłączaj siebie.
    const self = me.id === id;
    const patch = { name: body.name, password: body.password || undefined };
    if (!self) {
      patch.role = body.role;
      patch.active = body.active === 'on';
    }
    const u = await authService.updateUser(id, patch);
    if (!u) return res.redirect('/admin/users?error=weak');
    await events.log({ type: 'updated', message: `Zmieniono konto: ${u.email}`, ip: req.ip });
    res.redirect(back('saved'));
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const id = Number(req.params.id);
    const me = req.session.user || {};
    if (me.id === id) return res.redirect('/admin/users?error=self'); // nie usuwaj siebie
    const users = await authService.listUsers();
    const target = users.find((u) => u.id === id);
    // Nie usuwaj ostatniego aktywnego admina (zablokowałoby dostęp do Ustawień).
    const admins = users.filter((u) => u.role === 'admin' && u.active !== false);
    if (target && target.role === 'admin' && admins.length <= 1) return res.redirect('/admin/users?error=lastadmin');
    await authService.deleteUser(id);
    if (target) await events.log({ type: 'updated', message: `Usunięto konto: ${target.email}`, ip: req.ip });
    res.redirect(back('deleted'));
  } catch (err) {
    next(err);
  }
}

module.exports = { index, create, update, remove };
