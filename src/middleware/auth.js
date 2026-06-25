// Strażnik tras panelu. Jeśli użytkownik nie jest zalogowany,
// przekierowuje na stronę logowania.
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  return res.redirect('/admin/login');
}

// Udostępnia dane zalogowanego użytkownika wszystkim szablonom (jako res.locals.currentUser),
// żeby nie przekazywać ich ręcznie przy każdym renderze.
function injectUser(req, res, next) {
  res.locals.currentUser = req.session ? req.session.user : null;
  next();
}

module.exports = { requireAuth, injectUser };
