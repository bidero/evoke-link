// Panel: skrzynka wiadomości od klientów (Faza A — jednokierunkowo).
const messageService = require('../services/message.service');

async function listMessages(req, res, next) {
  try {
    const list = await messageService.listInbox();
    res.render('admin/messages/index', { title: 'Wiadomości', active: 'messages', messages: list });
  } catch (err) {
    next(err);
  }
}

async function markRead(req, res, next) {
  try {
    await messageService.markRead(req.params.id);
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
    await messageService.remove(req.params.id);
    res.redirect('/admin/messages');
  } catch (err) {
    next(err);
  }
}

module.exports = { listMessages, markRead, markAllRead, deleteMessage };
