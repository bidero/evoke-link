// Strona publiczna: klient wgrywa pliki do agencji (link /upload/:token).
const transferService = require('../services/transfer.service');
const storage = require('../services/storage.service');
const mail = require('../services/mail.service');
const events = require('../services/event.service');

const PUBLIC_LAYOUT = 'layouts/public';

function isUnlocked(req, token) {
  return Boolean(req.session.unlocked && req.session.unlocked[token]);
}
function markUnlocked(req, token) {
  req.session.unlocked = req.session.unlocked || {};
  req.session.unlocked[token] = true;
}

// Wczytanie + walidacja: musi istnieć, być typu 'incoming' i dostępny.
async function loadIncoming(req, res) {
  const transfer = await transferService.getByToken(req.params.token);
  if (!transfer || transfer.direction !== 'incoming') {
    res.status(404).render('public/unavailable', { title: 'Nie znaleziono', layout: PUBLIC_LAYOUT, reason: 'not_found' });
    return null;
  }
  const { ok, reason } = transferService.checkAvailability(transfer);
  if (!ok) {
    res.status(410).render('public/unavailable', { title: 'Link niedostępny', layout: PUBLIC_LAYOUT, reason });
    return null;
  }
  return transfer;
}

// Strona z formularzem uploadu (lub bramka hasła).
async function showUploadPage(req, res, next) {
  try {
    const transfer = await loadIncoming(req, res);
    if (!transfer) return;

    if (transferService.requiresPassword(transfer) && !isUnlocked(req, transfer.token)) {
      return res.render('public/password', { title: 'Chronione hasłem', layout: PUBLIC_LAYOUT, token: transfer.token, action: `/upload/${transfer.token}/password`, error: null });
    }

    res.render('public/upload', { title: transfer.title || 'Prześlij pliki', layout: PUBLIC_LAYOUT, transfer, sent: false });
  } catch (err) {
    next(err);
  }
}

// Sprawdzenie hasła (ten sam formularz/bramka co przy pobieraniu).
async function submitPassword(req, res, next) {
  try {
    const transfer = await loadIncoming(req, res);
    if (!transfer) return;
    if (transferService.verifyPassword(transfer, req.body.password)) {
      markUnlocked(req, transfer.token);
      return res.redirect(`/upload/${transfer.token}`);
    }
    res.status(401).render('public/password', { title: 'Chronione hasłem', layout: PUBLIC_LAYOUT, token: transfer.token, action: `/upload/${transfer.token}/password`, error: 'Nieprawidłowe hasło.' });
  } catch (err) {
    next(err);
  }
}

// Odbiór wgranych plików od klienta.
async function submitUpload(req, res, next) {
  try {
    const transfer = await loadIncoming(req, res);
    if (!transfer) {
      (req.files || []).forEach((f) => storage.removeTmp(f.path));
      return;
    }
    if (transferService.requiresPassword(transfer) && !isUnlocked(req, transfer.token)) {
      (req.files || []).forEach((f) => storage.removeTmp(f.path));
      return res.redirect(`/upload/${transfer.token}`);
    }

    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).render('public/upload', {
        title: transfer.title || 'Prześlij pliki', layout: PUBLIC_LAYOUT, transfer, sent: false,
        error: 'Dodaj przynajmniej jeden plik.',
      });
    }

    const updated = await transferService.addFiles(transfer, files);
    const { name, email } = req.body;

    await events.log({
      type: 'uploaded',
      message: `Klient przesłał ${files.length} plik(ów)` + (name ? ` (${name})` : ''),
      transferId: transfer.id,
      projectId: transfer.projectId,
      meta: { name: name || null, email: email || null },
      ip: req.ip,
    });

    // E-mail do agencji (nie blokuje odpowiedzi, gdy SMTP padnie).
    mail
      .sendUploadNotification({
        transfer: updated,
        fileNames: files.map((f) => f.originalname),
        uploaderName: name,
        uploaderEmail: email,
        projectName: transfer.project ? transfer.project.name : null,
      })
      .catch((e) => console.error('[mail] błąd wysyłki powiadomienia:', e.message));

    res.render('public/upload', { title: transfer.title || 'Dziękujemy', layout: PUBLIC_LAYOUT, transfer: updated, sent: true, count: files.length });
  } catch (err) {
    (req.files || []).forEach((f) => storage.removeTmp(f.path));
    next(err);
  }
}

module.exports = { showUploadPage, submitPassword, submitUpload };
