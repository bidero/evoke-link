// Strażnik tras panelu. Jeśli użytkownik nie jest zalogowany,
// przekierowuje na stronę logowania.
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  return res.redirect('/admin/login');
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
