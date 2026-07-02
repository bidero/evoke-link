// Strona publiczna: pobieranie plików przez klienta (link /t/:token).
const transferService = require('../services/transfer.service');
const zipService = require('../services/zip.service');
const storage = require('../services/storage.service');
const events = require('../services/event.service');
const messageService = require('../services/message.service');
const mail = require('../services/mail.service');
const { isRaster } = require('../utils/fileIcon');

const PUBLIC_LAYOUT = 'layouts/public';

// Powiadomienie e-mail do agencji przy PIERWSZYM pobraniu (gdy włączone na transferze).
// transfer.downloadCount to wartość sprzed inkrementacji, więc 0 = pierwsze pobranie.
function maybeNotifyDownload(transfer, req) {
  if (transfer.notifyOnDownload && transfer.downloadCount === 0) {
    mail.sendDownloadNotification({ transfer, ip: req.ip }).catch((e) => console.error('[mail] powiadomienie o pobraniu:', e.message));
  }
}

// Czy w tej sesji klient odblokował już hasłem dany transfer?
function isUnlocked(req, token) {
  return Boolean(req.session.unlocked && req.session.unlocked[token]);
}
function markUnlocked(req, token) {
  req.session.unlocked = req.session.unlocked || {};
  req.session.unlocked[token] = true;
}

// „Otwarcie" linku — logujemy raz na sesję (oś czasu), żeby odświeżanie nie zaśmiecało.
function firstViewThisSession(req, token) {
  req.session.viewedLinks = req.session.viewedLinks || {};
  if (req.session.viewedLinks[token]) return false;
  req.session.viewedLinks[token] = true;
  return true;
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

    if (firstViewThisSession(req, transfer.token)) {
      events.log({ type: 'viewed', message: 'Klient otworzył link do pobrania', transferId: transfer.id, projectId: transfer.projectId, ip: req.ip });
    }

    res.locals.msgContext = { action: `/t/${transfer.token}/message`, seen: `/t/${transfer.token}/messages/seen`, scope: transfer.title || '' };
    res.locals.msgSent = req.query.msg === '1';
    res.locals.msgThread = await messageService.thread({ transferId: transfer.id });
    res.locals.msgHasReply = messageService.hasUnseen(res.locals.msgThread, (req.session.msgSeen || {})[transfer.token]);
    res.render('public/download', {
      title: transfer.title || 'Pobierz pliki',
      layout: PUBLIC_LAYOUT,
      transfer,
    });
  } catch (err) {
    next(err);
  }
}

// Oznacz wątek jako „obejrzany" przez klienta (chowa badge nowej odpowiedzi).
function markSeen(req, res) {
  req.session.msgSeen = req.session.msgSeen || {};
  req.session.msgSeen[req.params.token] = Date.now();
  res.status(204).end();
}

// Wiadomość od klienta ze strony pobierania (/t) → skrzynka + mail do agencji.
async function submitMessage(req, res, next) {
  try {
    const transfer = await loadAvailable(req, res);
    if (!transfer) return;
    const { body, senderName, senderEmail } = req.body;
    const msg = await messageService.create({ body, senderName, senderEmail, transferId: transfer.id, projectId: transfer.projectId, clientId: transfer.project ? transfer.project.clientId : null, ip: req.ip });
    if (msg) mail.sendNewMessageNotification({ message: msg, project: transfer.project, transfer }).catch((e) => console.error('[mail] wiadomość:', e.message));
    res.redirect(`/t/${transfer.token}?msg=1`);
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

// Proofing: decyzja klienta (zatwierdzenie / poprawki) ze strony pobierania.
async function submitDecision(req, res, next) {
  try {
    const transfer = await guard(req, res);
    if (!transfer) return;
    if (!transfer.proofing || transfer.direction !== 'outgoing') return res.redirect(`/t/${transfer.token}`);
    const { decision, comment, name } = req.body;
    const updated = await transferService.setDecision(transfer.id, { decision, comment, name });
    if (updated) {
      const approved = decision === 'approved';
      events.log({
        type: approved ? 'approved' : 'changes',
        message: (approved ? 'Klient zatwierdził pliki' : 'Klient zgłosił poprawki') + (name && name.trim() ? ` (${name.trim()})` : '') + (comment && comment.trim() ? `: ${comment.trim().slice(0, 300)}` : ''),
        transferId: transfer.id,
        projectId: transfer.projectId,
        ip: req.ip,
      });
      mail
        .sendProofingDecision({ transfer, decision, comment, name, projectName: transfer.project ? transfer.project.name : null })
        .catch((e) => console.error('[mail] proofing:', e.message));
    }
    res.redirect(`/t/${transfer.token}?decided=1`);
  } catch (err) {
    next(err);
  }
}

// Pobranie pojedynczego pliku.
async function downloadFile(req, res, next) {
  try {
    const transfer = await guard(req, res);
    if (!transfer) return;

    const file = transfer.files.find((f) => String(f.id) === String(req.params.fileId));
    if (!file) return res.status(404).render('public/unavailable', { title: 'Nie znaleziono', layout: PUBLIC_LAYOUT, reason: 'not_found' });

    maybeNotifyDownload(transfer, req);
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

// Podgląd miniatury (tylko rastrowy obraz) — inline, BEZ liczenia pobrań/powiadomień.
async function previewFile(req, res, next) {
  try {
    const transfer = await guard(req, res);
    if (!transfer) return;
    const file = transfer.files.find((f) => String(f.id) === String(req.params.fileId));
    if (!file || !isRaster(file.originalName, file.mimeType)) return res.status(404).end();
    res.setHeader('Content-Type', file.mimeType || 'image/jpeg');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
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

    maybeNotifyDownload(transfer, req);
    await transferService.incrementDownload(transfer.id);
    await events.log({ type: 'downloaded', message: 'Pobrano ZIP (wszystkie pliki)', transferId: transfer.id, projectId: transfer.projectId, ip: req.ip });

    zipService.streamTransferZip(res, transfer);
  } catch (err) {
    next(err);
  }
}

module.exports = { showDownloadPage, submitMessage, submitDecision, markSeen, submitPassword, downloadFile, previewFile, downloadZip };
