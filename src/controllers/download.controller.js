// Strona publiczna: pobieranie plików przez klienta (link /t/:token).
const transferService = require('../services/transfer.service');
const zipService = require('../services/zip.service');
const storage = require('../services/storage.service');
const thumbService = require('../services/thumb.service');
const events = require('../services/event.service');
const messageService = require('../services/message.service');
const mail = require('../services/mail.service');
const { isRaster } = require('../utils/fileIcon');
const { contentRailNav, contentMsgNav } = require('../utils/contentNav');
const messagePoll = require('../utils/messagePoll');

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

    res.locals.msgContext = { action: `/t/${transfer.token}/message`, page: `/t/${transfer.token}/wiadomosci`, scope: transfer.title || '' };
    res.locals.msgSent = req.query.msg === '1';
    res.locals.msgThread = await messageService.thread({ transferId: transfer.id });
    res.locals.msgHasReply = messageService.hasUnseen(res.locals.msgThread, (req.session.msgSeen || {})[transfer.token]);
    res.render('public/download', {
      title: transfer.title || 'Pobierz pliki',
      layout: PUBLIC_LAYOUT,
      transfer,
      portalNav: contentRailNav(res, { msgHref: `/t/${transfer.token}/wiadomosci`, msgDot: res.locals.msgHasReply }),
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

// Podstrona wiadomości (/t/:token/wiadomosci) — wątek + formularz (zastępuje dawny popup).
async function showMessages(req, res, next) {
  try {
    const transfer = await loadAvailable(req, res);
    if (!transfer) return;
    if (transferService.requiresPassword(transfer) && !isUnlocked(req, transfer.token)) {
      return res.render('public/password', { title: 'Plik chroniony hasłem', layout: PUBLIC_LAYOUT, token: transfer.token, error: null });
    }
    res.locals.msgContext = { action: `/t/${transfer.token}/message`, page: `/t/${transfer.token}/wiadomosci`, scope: transfer.title || '' };
    res.locals.msgSent = req.query.msg === '1';
    res.locals.msgThread = await messageService.thread({ transferId: transfer.id });
    // Wejście na podstronę = obejrzenie wątku (chowa kropkę nowej odpowiedzi).
    req.session.msgSeen = req.session.msgSeen || {};
    req.session.msgSeen[transfer.token] = Date.now();
    // Otwarcie wątku = przeczytanie wiadomości agencji → ptaszki ✓✓ po jej stronie.
    await messageService.markThreadOutRead({ transferId: transfer.id });
    const back = { href: `/t/${transfer.token}`, label: transfer.title || 'Pobierz pliki' };
    res.render('public/messages', {
      title: 'Wiadomości', layout: PUBLIC_LAYOUT, msgBack: back,
      portalNav: contentMsgNav(res, { backHref: back.href, backLabel: back.label, msgHref: `/t/${transfer.token}/wiadomosci` }),
      msgKnownSender: !!(transfer.project && transfer.project.clientId), // anonimowy transfer → zostaw imię/e-mail
    });
  } catch (err) {
    next(err);
  }
}

// Polling wątku (live) — ta sama bramka (dostępność + hasło) co showMessages.
async function pollMessages(req, res, next) {
  try {
    const transfer = await transferService.getByToken(req.params.token);
    const { ok } = transferService.checkAvailability(transfer);
    if (!ok) return res.status(404).json({ error: 'not_found' });
    if (transferService.requiresPassword(transfer) && !isUnlocked(req, transfer.token)) return res.status(403).json({ error: 'locked' });
    await messagePoll.respond(res, {
      scope: { transferId: transfer.id },
      after: req.query.after,
      meta: req.query.meta === '1',   // tryb kropki: bez renderu bąbelków
      msgContext: { page: `/t/${transfer.token}/wiadomosci` },
    });
  } catch (err) {
    next(err);
  }
}

// Wiadomość od klienta ze strony pobierania (/t) → skrzynka + mail do agencji.
async function submitMessage(req, res, next) {
  try {
    const transfer = await loadAvailable(req, res);
    if (!transfer) return;
    const { body, senderName, senderEmail } = req.body;
    const msg = await messageService.create({ body, senderName, senderEmail, transferId: transfer.id, projectId: transfer.projectId, clientId: transfer.project ? transfer.project.clientId : null, ip: req.ip, file: req.file });
    if (msg) mail.sendNewMessageNotification({ message: msg, project: transfer.project, transfer }).catch((e) => console.error('[mail] wiadomość:', e.message));
    // Wysyłka bez przeładowania (live): oddaj gotowy bąbelek zamiast redirectu.
    // Fallback bez JS (zwykły submit) → dotychczasowy redirect z ?msg=1 i toastem.
    if ((req.get('accept') || '').includes('application/json')) {
      const html = msg ? await messagePoll.renderToString(res, 'public/_msg_bubble', { mm: msg, msgContext: { page: `/t/${transfer.token}/wiadomosci` } }) : '';
      return res.set('Cache-Control', 'no-store').json({ ok: !!msg, lastId: msg ? msg.id : 0, html });
    }
    res.redirect(`/t/${transfer.token}/wiadomosci?msg=1`);
  } catch (err) {
    next(err);
  }
}

// Pobranie załącznika wiadomości w wątku transferu (/t). Chroniony hasłem = wymaga unlocka.
async function downloadMessageAttachment(req, res, next) {
  try {
    const transfer = await loadAvailable(req, res);
    if (!transfer) return;
    if (transferService.requiresPassword(transfer) && !isUnlocked(req, transfer.token)) return res.status(403).end();
    const att = await messageService.attachmentInThread(req.params.msgId, { transferId: transfer.id });
    if (!att) return res.status(404).end();
    res.setHeader('Content-Type', att.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(att.name)}"`);
    storage.pipeDownload(res, att.path);
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
    // originalName może być ścieżką z folderu ('katalog/plik.pdf') — do nagłówka sama nazwa.
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName.split('/').pop())}`);
    res.setHeader('Content-Length', Number(file.size));
    storage.pipeDownload(res, file.storedPath);
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
    // `?t=1` = miniatura z listy plików; bez tego pełny podgląd (Quick Look).
    await thumbService.send(res, file, req.query.t === '1');
  } catch (err) {
    next(err);
  }
}

// Pobranie wszystkich plików jako ZIP.
async function downloadZip(req, res, next) {
  try {
    const transfer = await guard(req, res);
    if (!transfer) return;
    // Transfer bez plików (admin mógł usunąć wszystkie z panelu): nie wydajemy pustego
    // archiwum i — co ważniejsze — NIE zliczamy pobrania, bo zjadłoby limit i mogło
    // wygasić transfer. Panel zachowuje się tak samo (adminDownloadZip → 404).
    if (!transfer.files.length) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });

    maybeNotifyDownload(transfer, req);
    await transferService.incrementDownload(transfer.id);
    await events.log({ type: 'downloaded', message: 'Pobrano ZIP (wszystkie pliki)', transferId: transfer.id, projectId: transfer.projectId, ip: req.ip });

    zipService.streamTransferZip(res, transfer);
  } catch (err) {
    next(err);
  }
}

module.exports = { showDownloadPage, showMessages, submitMessage, downloadMessageAttachment, submitDecision, markSeen, submitPassword, downloadFile, previewFile, downloadZip, pollMessages, };
