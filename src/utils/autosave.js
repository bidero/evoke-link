// Odpowiedź na zapis wywołany przez AUTO-ZAPIS (public/js/autosave.js) albo zwykły submit.
//
// Auto-zapis prosi o JSON nagłówkiem `Accept` — dostaje 204 przy zapisie i 4xx przy odmowie,
// więc potrafi pokazać „Zapisano" albo „Nie udało się zapisać". Zwykły formularz (przeglądarka
// bez JS) dostaje przekierowanie na stronę, dokładnie jak dotąd.
//
// PO CO TO JEST: dopóki każda odpowiedź była przekierowaniem, skrypt nie miał jak odróżnić
// zapisu od braku zapisu i meldował sukces ZAWSZE — także wtedy, gdy kontroler nie miał czego
// zapisać (patrz GOTCHA o multipart w public/js/autosave.js). Cicha „udana" porażka jest
// gorsza niż widoczny błąd, bo znika bez śladu razem z danymi użytkownika.
function wantsJson(req) {
  return String(req.get('accept') || '').includes('application/json');
}

// Zapis się udał.
function saved(req, res, redirectTo) {
  if (wantsJson(req)) return res.status(204).end();
  return res.redirect(redirectTo);
}

// Zapisu NIE wykonano (błędne dane, brak pozycji, uszkodzone żądanie).
function refused(req, res, redirectTo, reason, status) {
  if (wantsJson(req)) return res.status(status || 422).json({ error: reason });
  return res.redirect(redirectTo);
}

module.exports = { wantsJson, saved, refused };
