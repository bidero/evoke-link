// Panel: komunikator agencji ↔ klient (dwupanel: lista klientów ↔ jeden strumień rozmowy).
// Agencja może odpowiadać I zagajać (out) w wybranym kontekście (Ogólne / projekt / transfer).
const messageService = require('../services/message.service');
const clientService = require('../services/client.service');
const storage = require('../services/storage.service');
const mail = require('../services/mail.service');
const events = require('../services/event.service');
const config = require('../config');

// scope z formularza: 'c' (ogólne/kliencki) | 'p:<id>' (projekt) | 't:<id>' (transfer).
function parseScope(scope, client) {
  if (typeof scope === 'string') {
    if (scope.startsWith('p:')) { const id = Number(scope.slice(2)); if ((client.projects || []).some((p) => p.id === id)) return { projectId: id }; }
    else if (scope.startsWith('t:')) { const id = Number(scope.slice(2)); if (Number.isFinite(id)) return { transferId: id }; }
  }
  return {};
}

// --- Zakładki wątków w rozmowie -----------------------------------------------------------
// Klucz wątku wiadomości — ten sam alfabet co `scope` w composerze ('c' | 'p:<id>' | 't:<id>'),
// żeby „gdzie patrzę" i „gdzie piszę" były TĄ SAMĄ wartością (stąd brak pomyłek kontekstu).
const threadKeyOf = (m) => (m.projectId ? 'p:' + m.projectId : (m.transferId ? 't:' + m.transferId : 'c'));

// Lista zakładek + liczniki nieprzeczytanych — z już wczytanej rozmowy, bez dodatkowych zapytań.
function buildThreads(messages) {
  const map = new Map();
  (messages || []).forEach((m) => {
    const key = threadKeyOf(m);
    const label = m.project ? m.project.name : (m.transfer ? (m.transfer.title || 'Transfer') : 'Ogólne');
    const t = map.get(key) || { key, label, unread: 0, lastId: 0 };
    if (m.direction === 'in' && !m.isRead) t.unread += 1;
    if (m.id > t.lastId) t.lastId = m.id;
    map.set(key, t);
  });
  // „Ogólne" zawsze pierwsze, reszta wg najnowszej aktywności.
  return Array.from(map.values()).sort((a, b) => (a.key === 'c' ? -1 : b.key === 'c' ? 1 : b.lastId - a.lastId));
}

// scope (obiekt do zapytań) z klucza zakładki. 'all' → null = cała rozmowa.
function scopeFromKey(key, clientId) {
  if (!key || key === 'all') return null;
  if (key.startsWith('p:')) return { projectId: Number(key.slice(2)) };
  if (key.startsWith('t:')) return { transferId: Number(key.slice(2)) };
  return { clientId: Number(clientId) };
}

// --- Live (polling / wysyłka bez przeładowania) ------------------------------------------
// Chip kontekstu wiadomości (musi zgadzać się z `_bubble.ejs`).
const chipOf = (m) => (m && m.project ? m.project.name : (m && m.transfer ? (m.transfer.title || 'Transfer') : null));

// Render widoku do STRINGA (bez layoutu) — bąbelki wracają tym samym partialem co render strony,
// więc markup istnieje w jednym miejscu (zero duplikowania HTML-a w JS).
function renderToString(res, view, locals) {
  return new Promise((resolve, reject) => {
    res.render(view, { ...locals, layout: false }, (err, html) => (err ? reject(err) : resolve(html)));
  });
}

async function renderBubbles(res, messages, prevChip = null) {
  let prev = prevChip;
  let html = '';
  for (const m of messages) {
    html += await renderToString(res, 'admin/messages/_bubble', { m, prevChip: prev });
    prev = chipOf(m);
  }
  return html;
}

// Polling otwartej rozmowy: TYLKO wiadomości nowsze od kursora `after`.
// Zwraca gotowe bąbelki + nowy kursor + id przeczytanych (ptaszki ✓✓).
async function pollConversation(req, res, next) {
  try {
    const selId = req.query.client;
    const after = Number(req.query.after) || 0;
    let clientId = null;
    if (selId && selId !== 'none') {
      const client = await clientService.getById(Number(selId));
      if (!client) return res.status(404).json({ error: 'not_found' });
      clientId = client.id;
    }
    const scope = scopeFromKey(req.query.thread, clientId);
    const fresh = await messageService.conversationNewerThan(clientId, after, scope);
    // Otwarta rozmowa w WIDOCZNEJ karcie = czytam ją → nowe przychodzące oznaczamy jako przeczytane.
    if (clientId && fresh.some((m) => m.direction === 'in')) {
      if (scope) await messageService.markScopeRead(clientId, scope);
      else await messageService.markClientRead(clientId);
      res.locals.unreadMessages = await messageService.unreadCount();
    }
    const prevChip = chipOf(await messageService.conversationLastBefore(clientId, after));
    const html = fresh.length ? await renderBubbles(res, fresh, prevChip) : '';
    const readIds = await messageService.readIdsFor(clientId ? { clientId } : { clientId: null }, 'out');
    res.set('Cache-Control', 'no-store').json({
      lastId: fresh.length ? fresh[fresh.length - 1].id : after,
      html,
      readIds,
      // Plakietki zakładek (inne wątki mogły dostać nowe wiadomości, choć patrzysz na jeden).
      threads: clientId ? buildThreads(await messageService.conversation(clientId)).map((t) => ({ key: t.key, unread: t.unread })) : [],
      unread: typeof res.locals.unreadMessages === 'number' ? res.locals.unreadMessages : undefined,
    });
  } catch (err) {
    next(err);
  }
}

async function listMessages(req, res, next) {
  try {
    const selId = req.query.client;
    let client = null, messages = [], projects = [], selected = null, threads = [], activeThread = 'all';
    if (selId === 'none') { selected = 'none'; messages = await messageService.conversation(null); }
    else if (selId) {
      client = await clientService.getById(Number(selId));
      if (client) {
        selected = String(client.id);
        const all = await messageService.conversation(client.id);
        threads = buildThreads(all);
        // Domyślna zakładka = wątek NAJNOWSZEJ wiadomości (a nie „Wszystko"): otwierasz rozmowę
        // i jesteś od razu tam, gdzie klient napisał — odpowiedź nie ma jak trafić w inny wątek.
        // ?scope=… z linku „Napisz do klienta" (kartoteka/projekt) ma pierwszeństwo.
        const wanted = req.query.thread || req.query.scope || (all.length ? threadKeyOf(all[all.length - 1]) : 'c');
        activeThread = wanted === 'all' || threads.some((t) => t.key === wanted) ? wanted : 'c';
        const scope = scopeFromKey(activeThread, client.id);
        // Przeczytane oznaczamy TYLKO w otwartym wątku (pozostałe zachowują plakietkę).
        if (scope) await messageService.markScopeRead(client.id, scope);
        else await messageService.markClientRead(client.id);
        res.locals.unreadMessages = await messageService.unreadCount(); // odśwież badge w menu (po read)
        messages = scope ? all.filter((m) => threadKeyOf(m) === activeThread) : all;
        threads = buildThreads(all); // po oznaczeniu — plakietki aktualne
        projects = client.projects || [];
      }
    }
    // Lista PO markClientRead → badge wybranego klienta od razu = 0.
    const conversations = await messageService.conversationList();
    const allClients = await clientService.options(); // do „+ Nowa rozmowa" (klienci bez wiadomości też)
    res.render('admin/messages/index', { title: 'Wiadomości', active: 'messages', conversations, selected, messages, convClient: client, projects, allClients, threads, activeThread, scopeHint: req.query.scope || null });
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
    const msg = await messageService.send({ clientId: client.id, projectId: scope.projectId, transferId: scope.transferId, body: req.body.body, file: req.file });
    if (msg) {
      await messageService.markClientRead(client.id); // wysłanie = obejrzałem wątek
      if (req.body.notify && client.email) {
        // Link zwrotny zależny od kontekstu: projekt → /p, inaczej klient → /c.
        let link = `${config.appUrl}/c/${client.token}`;
        if (scope.projectId) { const p = (client.projects || []).find((x) => x.id === scope.projectId); if (p && p.clientToken) link = `${config.appUrl}/p/${p.clientToken}`; }
        // Wysyłka „w tle" (nie blokuje odpowiedzi HTTP), ale ślad w historii zostawiamy —
        // wcześniej powiadomienie o wiadomości znikało bez śladu w osi czasu klienta.
        mail.sendClientReply({ to: client.email, body: msg.body, link })
          .then((info) => events.emailSent({
            kind: 'Powiadomienie o wiadomości', to: client.email, info,
            clientId: client.id, projectId: scope.projectId || null, transferId: scope.transferId || null, ip: req.ip,
          }))
          .catch((e) => console.error('[mail] wiadomość:', e.message));
      }
    }
    // Wysyłka bez przeładowania (live): zwróć gotowy bąbelek zamiast redirectu.
    // Fallback bez JS (zwykły submit formularza) → dotychczasowy redirect.
    if ((req.get('accept') || '').includes('application/json')) {
      const withCtx = msg ? await messageService.conversationNewerThan(client.id, msg.id - 1) : [];
      const prevChip = msg ? chipOf(await messageService.conversationLastBefore(client.id, msg.id - 1)) : null;
      const html = withCtx.length ? await renderBubbles(res, withCtx, prevChip) : '';
      return res.set('Cache-Control', 'no-store').json({ ok: !!msg, lastId: msg ? msg.id : 0, html });
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

module.exports = { listMessages, pollConversation, sendMessage, markAllRead, deleteConversation, downloadAttachment };
