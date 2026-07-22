// Panel: komunikator agencji ↔ klient (dwupanel: lista klientów ↔ jeden strumień rozmowy).
// Agencja może odpowiadać I zagajać (out) w wybranym kontekście (Ogólne / projekt / transfer).
const messageService = require('../services/message.service');
const clientService = require('../services/client.service');
const storage = require('../services/storage.service');
const mail = require('../services/mail.service');
const config = require('../config');

// scope z formularza: 'c' (ogólne/kliencki) | 'p:<id>' (projekt) | 't:<id>' (transfer).
function parseScope(scope, client) {
  if (typeof scope === 'string') {
    if (scope.startsWith('p:')) { const id = Number(scope.slice(2)); if ((client.projects || []).some((p) => p.id === id)) return { projectId: id }; }
    else if (scope.startsWith('t:')) { const id = Number(scope.slice(2)); if (Number.isFinite(id)) return { transferId: id }; }
  }
  return {};
}

async function listMessages(req, res, next) {
  try {
    const selId = req.query.client;
    let client = null, messages = [], projects = [], selected = null;
    if (selId === 'none') { selected = 'none'; messages = await messageService.conversation(null); }
    else if (selId) {
      client = await clientService.getById(Number(selId));
      if (client) {
        selected = String(client.id);
        await messageService.markClientRead(client.id);          // otwarcie = trwałe przeczytanie
        res.locals.unreadMessages = await messageService.unreadCount(); // odśwież badge w menu (po read)
        messages = await messageService.conversation(client.id);
        projects = client.projects || [];
      }
    }
    // Lista PO markClientRead → badge wybranego klienta od razu = 0.
    const conversations = await messageService.conversationList();
    const allClients = await clientService.options(); // do „+ Nowa rozmowa" (klienci bez wiadomości też)
    res.render('admin/messages/index', { title: 'Wiadomości', active: 'messages', conversations, selected, messages, client, projects, allClients, scopeHint: req.query.scope || null });
  } catch (err) {
    next(err);
  }
}

// Agencja wysyła (odpowiedź lub zagajenie) w wybranym kontekście + opcjonalny mail do klienta.
async function sendMessage(req, res, next) {
  try {
    const client = await clientService.getById(Number(req.params.clientId));
    if (!client) return res.redirect('/admin/messages');
    const scope = parseScope(req.body.scope, client);
    const msg = await messageService.send({ clientId: client.id, projectId: scope.projectId, transferId: scope.transferId, body: req.body.body });
    if (msg) {
      await messageService.markClientRead(client.id); // wysłanie = obejrzałem wątek
      if (req.body.notify && client.email) {
        // Link zwrotny zależny od kontekstu: projekt → /p, inaczej klient → /c.
        let link = `${config.appUrl}/c/${client.token}`;
        if (scope.projectId) { const p = (client.projects || []).find((x) => x.id === scope.projectId); if (p && p.clientToken) link = `${config.appUrl}/p/${p.clientToken}`; }
        mail.sendClientReply({ to: client.email, body: msg.body, link }).catch((e) => console.error('[mail] wiadomość:', e.message));
      }
    }
    res.redirect(`/admin/messages?client=${client.id}`);
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

async function deleteConversation(req, res, next) {
  try {
    const id = req.params.clientId;
    await messageService.deleteClientConversation(id === 'none' ? null : Number(id));
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

module.exports = { listMessages, sendMessage, markAllRead, deleteConversation, downloadAttachment };
