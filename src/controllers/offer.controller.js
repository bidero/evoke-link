// Oferty/wyceny — sekcja w kartotece 360° (zakładka „Oferty") + publiczna strona /o/:token
// z akceptacją/odrzuceniem. Wzorzec granularności jak onboarding.controller (admin + public razem).
const offerService = require('../services/offer.service');
const clientService = require('../services/client.service');
const projectService = require('../services/project.service');
const events = require('../services/event.service');
const mail = require('../services/mail.service');
const messageService = require('../services/message.service');
const storage = require('../services/storage.service');
const { contentRailNav, contentMsgNav } = require('../utils/contentNav');
const config = require('../config');
const messagePoll = require('../utils/messagePoll');

const PUBLIC_LAYOUT = 'layouts/public';
const back = (clientId, status) => `/admin/clients/${clientId}?tab=oferty&sent=${status}#oferty`;

// --- Admin ---

// Lejek sprzedaży — wszystkie oferty ponad klientem: wartość lejka + skuteczność + follow-up.
async function showPipeline(req, res, next) {
  try {
    const data = await offerService.pipeline();
    res.render('admin/sales', { title: 'Sprzedaż', active: 'sales', ...data });
  } catch (err) {
    next(err);
  }
}

async function createOffer(req, res, next) {
  try {
    const client = await clientService.getById(req.params.id);
    if (!client) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
    // Projekt tylko jeśli należy do tego klienta (ochrona przed obcym id).
    let projectId = null;
    if (req.body.projectId) {
      const p = await projectService.getById(req.body.projectId);
      if (p && p.clientId === client.id) projectId = p.id;
    }
    const created = await offerService.create(client.id, {
      projectId, title: req.body.title, intro: req.body.intro,
      validUntil: req.body.validUntil, itemsText: req.body.itemsText,
    });
    res.redirect(back(client.id, created ? 'off-new' : 'off-invalid'));
  } catch (err) {
    next(err);
  }
}

async function ownOffer(req) {
  const o = await offerService.getById(req.params.oid);
  return o && o.clientId === Number(req.params.id) ? o : null;
}

async function deleteOffer(req, res, next) {
  try {
    const o = await ownOffer(req);
    if (o) await offerService.remove(o.id);
    res.redirect(back(req.params.id, o ? 'off-del' : 'off-invalid'));
  } catch (err) {
    next(err);
  }
}

// Edycja oferty (każdej oprócz zaakceptowanej) — resetuje do „otwarta" i pozwala wysłać ponownie.
async function editOffer(req, res, next) {
  try {
    const o = await ownOffer(req);
    if (!o) return res.redirect(back(req.params.id, 'off-invalid'));
    // Projekt tylko jeśli należy do tego klienta (ochrona przed obcym id) — jak w createOffer.
    let projectId = null;
    if (req.body.projectId) {
      const p = await projectService.getById(req.body.projectId);
      if (p && p.clientId === Number(req.params.id)) projectId = p.id;
    }
    const updated = await offerService.update(o.id, {
      projectId, title: req.body.title, intro: req.body.intro,
      validUntil: req.body.validUntil, itemsText: req.body.itemsText,
    });
    res.redirect(back(req.params.id, updated ? 'off-edit' : 'off-invalid'));
  } catch (err) {
    next(err);
  }
}

async function sendOffer(req, res, next) {
  try {
    const o = await ownOffer(req);
    if (!o) return res.redirect(back(req.params.id, 'off-invalid'));
    const to = o.client.email || '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.redirect(back(req.params.id, 'off-noemail'));
    const url = `${config.appUrl}/o/${o.token}`;
    try {
      const info = await mail.sendOfferLink({ to, url, offer: o, client: o.client, total: offerService.totals(o.items).gross });
      await events.emailSent({ kind: 'Oferta', to, info, clientId: o.clientId });
      res.redirect(back(req.params.id, mail.isConfigured() ? 'off-ok' : 'off-dev'));
    } catch (e) {
      console.error('[mail] oferta:', e.message);
      res.redirect(back(req.params.id, 'off-error'));
    }
  } catch (err) {
    next(err);
  }
}

// --- Public (/o/:token) ---

// „Otwarcie" oferty — raz na sesję (oś czasu klienta).
function firstViewThisSession(req, token) {
  req.session.viewedLinks = req.session.viewedLinks || {};
  if (req.session.viewedLinks['offer:' + token]) return false;
  req.session.viewedLinks['offer:' + token] = true;
  return true;
}

async function showOffer(req, res, next) {
  try {
    const offer = await offerService.getByToken(req.params.token);
    if (!offer) return res.status(404).render('public/unavailable', { title: 'Nie znaleziono', layout: PUBLIC_LAYOUT, reason: 'not_found' });
    const st = offerService.state(offer);
    if (st === 'open' && firstViewThisSession(req, offer.token)) {
      events.log({ type: 'viewed', message: `Klient otworzył ofertę „${offer.title}"`, clientId: offer.clientId, projectId: offer.projectId || undefined, ip: req.ip });
    }
    // Wiadomości: wątek klienta-właściciela oferty (ten sam co w portalu /c).
    res.locals.msgContext = { action: `/o/${offer.token}/message`, page: `/o/${offer.token}/wiadomosci`, scope: `oferta „${offer.title}"` };
    res.locals.msgSent = req.query.msg === '1';
    res.locals.msgThread = await messageService.thread({ clientId: offer.clientId });
    res.locals.msgHasReply = messageService.hasUnseen(res.locals.msgThread, (req.session.msgSeen || {})[offer.token]);
    res.render('public/offer', {
      title: offer.title, layout: PUBLIC_LAYOUT, offer, state: st,
      totals: offerService.totals(offer.items), error: null,
      done: req.query.done === '1',
      portalNav: contentRailNav(res, { msgHref: `/o/${offer.token}/wiadomosci`, msgDot: res.locals.msgHasReply }),
    });
  } catch (err) {
    next(err);
  }
}

// Podstrona wiadomości (/o/:token/wiadomosci) — wątek klienta + formularz.
async function showMessages(req, res, next) {
  try {
    const offer = await offerService.getByToken(req.params.token);
    if (!offer) return res.status(404).render('public/unavailable', { title: 'Nie znaleziono', layout: PUBLIC_LAYOUT, reason: 'not_found' });
    res.locals.msgContext = { action: `/o/${offer.token}/message`, page: `/o/${offer.token}/wiadomosci`, scope: `oferta „${offer.title}"` };
    res.locals.msgSent = req.query.msg === '1';
    res.locals.msgThread = await messageService.thread({ clientId: offer.clientId });
    req.session.msgSeen = req.session.msgSeen || {};
    req.session.msgSeen[offer.token] = Date.now();
    // Otwarcie wątku = przeczytanie wiadomości agencji → ptaszki ✓✓ po jej stronie.
    await messageService.markThreadOutRead({ clientId: offer.clientId });
    const back = { href: `/o/${offer.token}`, label: offer.title };
    res.render('public/messages', {
      title: 'Wiadomości', layout: PUBLIC_LAYOUT, msgBack: back,
      portalNav: contentMsgNav(res, { backHref: back.href, backLabel: back.label, msgHref: `/o/${offer.token}/wiadomosci` }),
      msgKnownSender: true, // oferta należy do klienta
    });
  } catch (err) {
    next(err);
  }
}

// Polling wątku klienta-właściciela oferty (live).
async function pollMessages(req, res, next) {
  try {
    const offer = await offerService.getByToken(req.params.token);
    if (!offer) return res.status(404).json({ error: 'not_found' });
    await messagePoll.respond(res, {
      scope: { clientId: offer.clientId },
      after: req.query.after,
      meta: req.query.meta === '1',   // tryb kropki: bez renderu bąbelków
      msgContext: { page: `/o/${offer.token}/wiadomosci` },
    });
  } catch (err) {
    next(err);
  }
}

// Wiadomość od klienta ze strony oferty (/o) → wątek klienta + mail do agencji.
async function submitMessage(req, res, next) {
  try {
    const offer = await offerService.getByToken(req.params.token);
    if (!offer) return res.status(404).render('public/unavailable', { title: 'Nie znaleziono', layout: PUBLIC_LAYOUT, reason: 'not_found' });
    const { body, senderName, senderEmail } = req.body;
    const msg = await messageService.create({ body, senderName, senderEmail, clientId: offer.clientId, ip: req.ip, file: req.file });
    if (msg) mail.sendNewMessageNotification({ message: msg, client: offer.client }).catch((e) => console.error('[mail] wiadomość:', e.message));
    // Wysyłka bez przeładowania (live): oddaj gotowy bąbelek zamiast redirectu.
    // Fallback bez JS (zwykły submit) → dotychczasowy redirect z ?msg=1 i toastem.
    if ((req.get('accept') || '').includes('application/json')) {
      const html = msg ? await messagePoll.renderToString(res, 'public/_msg_bubble', { mm: msg, msgContext: { page: `/o/${offer.token}/wiadomosci` } }) : '';
      return res.set('Cache-Control', 'no-store').json({ ok: !!msg, lastId: msg ? msg.id : 0, html });
    }
    res.redirect(`/o/${offer.token}/wiadomosci?msg=1`);
  } catch (err) {
    next(err);
  }
}

// Pobranie załącznika wiadomości w wątku oferty (/o) — wątek klienta-właściciela oferty.
async function downloadMessageAttachment(req, res, next) {
  try {
    const offer = await offerService.getByToken(req.params.token);
    if (!offer) return res.status(404).end();
    const att = await messageService.attachmentInThread(req.params.msgId, { clientId: offer.clientId });
    if (!att) return res.status(404).end();
    res.setHeader('Content-Type', att.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(att.name)}"`);
    storage.pipeDownload(res, att.path);
  } catch (err) {
    next(err);
  }
}

async function submitDecision(req, res, next) {
  try {
    const offer = await offerService.getByToken(req.params.token);
    if (!offer) return res.status(404).render('public/unavailable', { title: 'Nie znaleziono', layout: PUBLIC_LAYOUT, reason: 'not_found' });
    const decision = req.body.decision === 'accepted' ? 'accepted' : (req.body.decision === 'rejected' ? 'rejected' : null);
    if (!decision) return res.redirect(`/o/${offer.token}`);

    // Etap 2: Turbo Stream → podmiana karty oferty w miejscu, bez reloadu (fallback: redirect/render).
    const wantsStream = (req.get('accept') || '').includes('turbo-stream');
    const totals = offerService.totals(offer.items);
    const offerStream = ({ state, done, error, status }) => {
      res.status(status || 200).type('text/vnd.turbo-stream.html');
      return res.render('public/streams/offer', { layout: false, offer, state, totals, done: !!done, error: error || null });
    };

    // Odrzucenie wymaga powodu (żeby wiedzieć, co poprawić).
    if (decision === 'rejected' && !(req.body.comment || '').trim()) {
      const error = 'Podaj krótko powód — pomoże nam poprawić ofertę.';
      if (wantsStream) return offerStream({ state: offerService.state(offer), error, status: 422 });
      return res.status(400).render('public/offer', {
        title: offer.title, layout: PUBLIC_LAYOUT, offer, state: offerService.state(offer),
        totals, done: false, error,
      });
    }

    const r = await offerService.decide(offer, { decision, name: req.body.name, comment: req.body.comment });
    if (!r.ok) { // już zdecydowana/wygasła → pokaż aktualny stan
      if (wantsStream) return offerStream({ state: offerService.state(offer) });
      return res.redirect(`/o/${offer.token}`);
    }
    mail.sendOfferDecision({ offer, decision, comment: req.body.comment, name: req.body.name, total: totals.gross })
      .catch((e) => console.error('[mail] oferta decyzja:', e.message));
    if (wantsStream) return offerStream({ state: decision, done: true });
    res.redirect(`/o/${offer.token}?done=1`);
  } catch (err) {
    next(err);
  }
}

module.exports = { showPipeline, createOffer, editOffer, deleteOffer, sendOffer, showOffer, showMessages, submitMessage, downloadMessageAttachment, submitDecision, pollMessages, };
