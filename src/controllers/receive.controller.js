// Strona publiczna: klient wgrywa pliki do agencji (link /upload/:token).
const transferService = require('../services/transfer.service');
const storage = require('../services/storage.service');
const mail = require('../services/mail.service');
const events = require('../services/event.service');
const messageService = require('../services/message.service');
const { contentRailNav, contentMsgNav } = require('../utils/contentNav');
const messagePoll = require('../utils/messagePoll');

const PUBLIC_LAYOUT = 'layouts/public';

function isUnlocked(req, token) {
  return Boolean(req.session.unlocked && req.session.unlocked[token]);
}
function markUnlocked(req, token) {
  req.session.unlocked = req.session.unlocked || {};
  req.session.unlocked[token] = true;
}

// „Otwarcie" linku — raz na sesję (oś czasu), żeby odświeżanie nie zaśmiecało.
function firstViewThisSession(req, token) {
  req.session.viewedLinks = req.session.viewedLinks || {};
  if (req.session.viewedLinks[token]) return false;
  req.session.viewedLinks[token] = true;
  return true;
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

    if (firstViewThisSession(req, transfer.token)) {
      events.log({ type: 'viewed', message: 'Klient otworzył link do wgrania plików', transferId: transfer.id, projectId: transfer.projectId, ip: req.ip });
    }
    // Wiadomości (jak na /t): kontekst wątku = transfer przychodzący.
    res.locals.msgContext = { action: `/upload/${transfer.token}/message`, page: `/upload/${transfer.token}/wiadomosci`, scope: transfer.title || '' };
    res.locals.msgSent = req.query.msg === '1';
    res.locals.msgThread = await messageService.thread({ transferId: transfer.id });
    res.locals.msgHasReply = messageService.hasUnseen(res.locals.msgThread, (req.session.msgSeen || {})[transfer.token]);
    res.render('public/upload', {
      title: transfer.title || 'Prześlij pliki', layout: PUBLIC_LAYOUT, transfer, sent: false,
      portalNav: contentRailNav(res, { msgHref: `/upload/${transfer.token}/wiadomosci`, msgDot: res.locals.msgHasReply }),
    });
  } catch (err) {
    next(err);
  }
}

// Podstrona wiadomości (/upload/:token/wiadomosci) — wątek + formularz.
async function showMessages(req, res, next) {
  try {
    const transfer = await loadIncoming(req, res);
    if (!transfer) return;
    if (transferService.requiresPassword(transfer) && !isUnlocked(req, transfer.token)) {
      return res.render('public/password', { title: 'Chronione hasłem', layout: PUBLIC_LAYOUT, token: transfer.token, action: `/upload/${transfer.token}/password`, error: null });
    }
    res.locals.msgContext = { action: `/upload/${transfer.token}/message`, page: `/upload/${transfer.token}/wiadomosci`, scope: transfer.title || '' };
    res.locals.msgSent = req.query.msg === '1';
    res.locals.msgThread = await messageService.thread({ transferId: transfer.id });
    req.session.msgSeen = req.session.msgSeen || {};
    req.session.msgSeen[transfer.token] = Date.now();
    // Otwarcie wątku = przeczytanie wiadomości agencji → ptaszki ✓✓ po jej stronie.
    await messageService.markThreadOutRead({ transferId: transfer.id });
    const back = { href: `/upload/${transfer.token}`, label: transfer.title || 'Prześlij pliki' };
    res.render('public/messages', {
      title: 'Wiadomości', layout: PUBLIC_LAYOUT, msgBack: back,
      portalNav: contentMsgNav(res, { backHref: back.href, backLabel: back.label, msgHref: `/upload/${transfer.token}/wiadomosci` }),
      msgKnownSender: !!(transfer.project && transfer.project.clientId), // anonimowy transfer → zostaw imię/e-mail
    });
  } catch (err) {
    next(err);
  }
}

// Polling wątku (live) — ta sama bramka (typ incoming + dostępność + hasło) co showMessages.
async function pollMessages(req, res, next) {
  try {
    const transfer = await transferService.getByToken(req.params.token);
    if (!transfer || transfer.direction !== 'incoming') return res.status(404).json({ error: 'not_found' });
    const { ok } = transferService.checkAvailability(transfer);
    if (!ok) return res.status(404).json({ error: 'not_found' });
    if (transferService.requiresPassword(transfer) && !isUnlocked(req, transfer.token)) return res.status(403).json({ error: 'locked' });
    await messagePoll.respond(res, {
      scope: { transferId: transfer.id },
      after: req.query.after,
      meta: req.query.meta === '1',   // tryb kropki: bez renderu bąbelków
      msgContext: { page: `/upload/${transfer.token}/wiadomosci` },
    });
  } catch (err) {
    next(err);
  }
}

// Wiadomość od klienta ze strony uploadu (/upload) → skrzynka + mail do agencji.
async function submitMessage(req, res, next) {
  try {
    const transfer = await loadIncoming(req, res);
    if (!transfer) return;
    const { body, senderName, senderEmail } = req.body;
    const msg = await messageService.create({ body, senderName, senderEmail, transferId: transfer.id, projectId: transfer.projectId, clientId: transfer.project ? transfer.project.clientId : null, ip: req.ip, file: req.file });
    if (msg) mail.sendNewMessageNotification({ message: msg, project: transfer.project, transfer }).catch((e) => console.error('[mail] wiadomość:', e.message));
    // Wysyłka bez przeładowania (live): oddaj gotowy bąbelek zamiast redirectu.
    // Fallback bez JS (zwykły submit) → dotychczasowy redirect z ?msg=1 i toastem.
    if ((req.get('accept') || '').includes('application/json')) {
      const html = msg ? await messagePoll.renderToString(res, 'public/_msg_bubble', { mm: msg, msgContext: { page: `/upload/${transfer.token}/wiadomosci` } }) : '';
      return res.set('Cache-Control', 'no-store').json({ ok: !!msg, lastId: msg ? msg.id : 0, html });
    }
    res.redirect(`/upload/${transfer.token}/wiadomosci?msg=1`);
  } catch (err) {
    next(err);
  }
}

// Pobranie załącznika wiadomości w wątku transferu przychodzącego (/upload).
async function downloadMessageAttachment(req, res, next) {
  try {
    const transfer = await loadIncoming(req, res);
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

    // Potwierdzenie do klienta (jeśli włączone w ustawieniach i podał e-mail).
    if (email) {
      mail
        .sendUploadConfirmation({ to: email, transfer: updated, projectName: transfer.project ? transfer.project.name : null })
        .catch((e) => console.error('[mail] potwierdzenie klienta:', e.message));
    }

    res.render('public/upload', {
      title: transfer.title || 'Dziękujemy', layout: PUBLIC_LAYOUT,
      transfer: { ...updated, project: transfer.project }, sent: true, count: files.length,
      portalNav: contentRailNav(res, { msgHref: `/upload/${transfer.token}/wiadomosci`, msgDot: false }),
    });
  } catch (err) {
    (req.files || []).forEach((f) => storage.removeTmp(f.path));
    next(err);
  }
}

module.exports = { showUploadPage, showMessages, submitMessage, downloadMessageAttachment, submitPassword, submitUpload, pollMessages, };
