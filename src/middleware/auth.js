const authService = require('../services/auth.service');

// Strażnik tras panelu. Jeśli użytkownik nie jest zalogowany,
// przekierowuje na stronę logowania.
//
// Sesję weryfikujemy z BAZĄ przy każdym żądaniu (jedno zapytanie po kluczu głównym): konto
// wyłączone albo usunięte zostaje wylogowane od razu, a zmiana roli/nazwy działa od następnego
// kliknięcia — bez tego podpisane ciasteczko dawało dostęp jeszcze przez 7 dni.
async function requireAuth(req, res, next) {
  const u = req.session && req.session.user;
  if (!u) return res.redirect('/admin/login');
  try {
    const fresh = await authService.refreshSessionUser(u);
    if (!fresh) {
      req.session = null;
      return res.redirect('/admin/login');
    }
    // Zapis do sesji tylko przy realnej zmianie (cookie-session przepisuje ciasteczko przy każdej).
    if (fresh.role !== u.role || fresh.name !== u.name || fresh.email !== u.email) {
      req.session.user = Object.assign({}, u, fresh);
    }
    res.locals.currentUser = req.session.user;
    res.locals.isAdmin = req.session.user.role !== 'staff';
    return next();
  } catch (e) {
    return next(e);
  }
}

// Udostępnia dane zalogowanego użytkownika wszystkim szablonom (jako res.locals.currentUser),
// żeby nie przekazywać ich ręcznie przy każdym renderze. `isAdmin` = bramka w widokach.
function injectUser(req, res, next) {
  const u = req.session ? req.session.user : null;
  res.locals.currentUser = u;
  res.locals.isAdmin = !u || u.role !== 'staff'; // brak roli (stare sesje) = admin
  next();
}

// Strażnik tras tylko dla admina (Ustawienia, rozliczenia, konta).
// Pracownik dostaje 403 zamiast cichego przekierowania — jasny komunikat.
function requireAdmin(req, res, next) {
  const u = req.session ? req.session.user : null;
  if (!u) return res.redirect('/admin/login');
  if (u.role === 'staff') {
    return res.status(403).render('errors/403', { title: 'Brak dostępu', layout: 'layouts/admin', active: '' });
  }
  return next();
}

module.exports = { requireAuth, requireAdmin, injectUser };
