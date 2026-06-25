// Strona publiczna: pobieranie plików przez klienta (link /t/:token).
const transferService = require('../services/transfer.service');
const zipService = require('../services/zip.service');
const storage = require('../services/storage.service');
const events = require('../services/event.service');

const PUBLIC_LAYOUT = 'layouts/public';

// Czy w tej sesji klient odblokował już hasłem dany transfer?
function isUnlocked(req, token) {
  return Boolean(req.session.unlocked && req.session.unlocked[token]);
}
function markUnlocked(req, token) {
  req.session.unlocked = req.session.unlocked || {};
  req.session.unlocked[token] = true;
}

// Wspólne wczytanie + walidacja dostępności. Zwraca transfer albo renderuje
// stronę "niedostępny" i zwraca null.
async function loadAvailable(req, res) {
  const transfer = await transferService.getByToken(req.params.token);
  const { ok, reason } = transferService.checkAvailability(transfer);
  if (!ok) {
    res.status(reason === 'not_found' ? 404 : 410).render('public/unavailable', {
      title: 'Link niedostępny',
      layout: PUBLIC_LAYOUT,
      reason,
    });
    return null;
  }
  return transfer;
}

// Strona z listą plików (lub bramka hasła).
async function showDownloadPage(req, res, next) {
  try {
    const transfer = await loadAvailable(req, res);
    if (!transfer) return;

    if (transferService.requiresPassword(transfer) && !isUnlocked(req, transfer.token)) {
      return res.render('public/password', {
        title: 'Plik chroniony hasłem',
        layout: PUBLIC_LAYOUT,
        token: transfer.token,
        error: null,
      });
    }

    res.render('public/download', {
      title: transfer.title || 'Pobierz pliki',
      layout: PUBLIC_LAYOUT,
      transfer,
    });
  } catch (err) {
    next(err);
  }
}

// Sprawdzenie hasła z bramki.
async function submitPassword(req, res, next) {
  try {
    const transfer = await loadAvailable(req, res);
    if (!transfer) return;

    if (transferService.verifyPassword(transfer, req.body.password)) {
      markUnlocked(req, transfer.token);
      return res.redirect(`/t/${transfer.token}`);
    }

    res.status(401).render('public/password', {
      title: 'Plik chroniony hasłem',
      layout: PUBLIC_LAYOUT,
      token: transfer.token,
      error: 'Nieprawidłowe hasło.',
    });
  } catch (err) {
    next(err);
  }
}

// Strażnik dla faktycznego pobierania: dostępność + hasło.
async function guard(req, res) {
  const transfer = await loadAvailable(req, res);
  if (!transfer) return null;
  if (transferService.requiresPassword(transfer) && !isUnlocked(req, transfer.token)) {
    res.redirect(`/t/${transfer.token}`);
    return null;
  }
  return transfer;
}

// Pobranie pojedynczego pliku.
async function downloadFile(req, res, next) {
  try {
    const transfer = await guard(req, res);
    if (!transfer) return;

    const file = transfer.files.find((f) => String(f.id) === String(req.params.fileId));
    if (!file) return res.status(404).render('public/unavailable', { title: 'Nie znaleziono', layout: PUBLIC_LAYOUT, reason: 'not_found' });

    await transferService.incrementDownload(transfer.id);
    await events.log({ type: 'downloaded', message: `Pobrano plik: ${file.originalName}`, transferId: transfer.id, projectId: transfer.projectId, ip: req.ip });

    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`);
    res.setHeader('Content-Length', Number(file.size));
    storage.readStream(file.storedPath).pipe(res);
  } catch (err) {
    next(err);
  }
}

// Pobranie wszystkich plików jako ZIP.
async function downloadZip(req, res, next) {
  try {
    const transfer = await guard(req, res);
    if (!transfer) return;

    await transferService.incrementDownload(transfer.id);
    await events.log({ type: 'downloaded', message: 'Pobrano ZIP (wszystkie pliki)', transferId: transfer.id, projectId: transfer.projectId, ip: req.ip });

    zipService.streamTransferZip(res, transfer);
  } catch (err) {
    next(err);
  }
}

module.exports = { showDownloadPage, submitPassword, downloadFile, downloadZip };
