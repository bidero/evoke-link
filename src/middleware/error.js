// Obsługa 404 i błędów serwera — na końcu łańcucha middleware.
const config = require('../config');

function notFound(req, res) {
  res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
}

function errorHandler(err, req, res, next) {
  console.error('[ERROR]', err);
  // Jeśli odpowiedź już poszła (np. błąd podczas strumieniowania/zapisu sesji),
  // nie próbujemy renderować strony błędu — tylko bezpiecznie zamykamy połączenie.
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || 500).render('errors/500', {
    title: 'Błąd serwera',
    layout: 'layouts/auth',
    message: config.isProd ? null : err.message,
  });
}

module.exports = { notFound, errorHandler };
