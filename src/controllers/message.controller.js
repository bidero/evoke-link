// Panel: skrzynka wiadomości od klientów (Faza A — jednokierunkowo).
const messageService = require('../services/message.service');
const storage = require('../services/storage.service');
const mail = require('../services/mail.service');
const config = require('../config');

async function listMessages(req, res, next) {
  try {
    const threads = await messageService.listThreads();
    res.render('admin/messages/index', { title: 'Wiadomości', active: 'messages', threads });
  } catch (err) {
    next(err);
  }
}

async function markRead(req, res, next) {
  try {
    const m = await messageService.getById(req.params.id);
    if (m) await messageService.markThreadRead(m);
    res.redirect('/admin/messages');
  } catch (err) {
    next(err);
  }
}

async function markAllRead(req, res, next) {
  try {
    await messageService.markAllRead();
    res.redirect('/admin/messages');
  } catch (err) {
    next(err);
  }
}

async function deleteMessage(req, res, next) {
  try {
    const m = await messageService.getById(req.params.id);
    if (m) await messageService.deleteThread(m);
    res.redirect('/admin/messages');
  } catch (err) {
    next(err);
  }
}

// Odpowiedź agencji na wiadomość klienta (Faza B) → out-message + mail do klienta.
async function replyMessage(req, res, next) {
  try {
    const original = await messageService.getById(req.params.id);
    if (!original) return res.redirect('/admin/messages');
    const reply = await messageService.reply({ original, body: req.body.body });
    if (reply) {
      await messageService.markThreadRead(original);
      const to = (original.senderEmail || (original.client && original.client.email) || '').trim();
      if (to) {
        // Link zwrotny: projekt → /p, inaczej klient → /c.
        let link = '';
        if (original.project && original.project.clientToken) link = `${config.appUrl}/p/${original.project.clientToken}`;
        else if (original.client && original.client.token) link = `${config.appUrl}/c/${original.client.token}`;
        mail.sendClientReply({ to, body: reply.body, link }).catch((e) => console.error('[mail] odpowiedź:', e.message));
      }
    }
    res.redirect('/admin/messages');
  } catch (err) {
    next(err);
  }
}

// Pobranie załącznika wiadomości (panel, wymaga logowania). Wymuszamy download (nie inline).
async function downloadAttachment(req, res, next) {
  try {
    const att = await messageService.attachment(req.params.id);
    if (!att) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
    res.setHeader('Content-Type', att.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(att.name)}"`);
    storage.readStream(att.path).on('error', () => res.status(404).end()).pipe(res);
  } catch (err) {
    next(err);
  }
}

module.exports = { listMessages, replyMessage, markRead, markAllRead, deleteMessage, downloadAttachment };
