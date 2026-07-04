// Oferty/wyceny — sekcja w kartotece 360° (zakładka „Oferty") + publiczna strona /o/:token
// z akceptacją/odrzuceniem. Wzorzec granularności jak onboarding.controller (admin + public razem).
const offerService = require('../services/offer.service');
const clientService = require('../services/client.service');
const projectService = require('../services/project.service');
const events = require('../services/event.service');
const mail = require('../services/mail.service');
const config = require('../config');

const PUBLIC_LAYOUT = 'layouts/public';
const back = (clientId, status) => `/admin/clients/${clientId}?tab=oferty&sent=${status}#oferty`;

// --- Admin ---

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

async function sendOffer(req, res, next) {
  try {
    const o = await ownOffer(req);
    if (!o) return res.redirect(back(req.params.id, 'off-invalid'));
    const to = o.client.email || '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.redirect(back(req.params.id, 'off-noemail'));
    const url = `${config.appUrl}/o/${o.token}`;
    try {
      await mail.sendOfferLink({ to, url, offer: o, client: o.client, total: offerService.totals(o.items).gross });
      await events.log({ type: 'email_sent', message: `Wysłano ofertę „${o.title}" do ${to}`, clientId: o.clientId });
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
    res.render('public/offer', {
      title: offer.title, layout: PUBLIC_LAYOUT, offer, state: st,
      totals: offerService.totals(offer.items), error: null,
      done: req.query.done === '1',
    });
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

    // Odrzucenie wymaga powodu (żeby wiedzieć, co poprawić).
    if (decision === 'rejected' && !(req.body.comment || '').trim()) {
      return res.status(400).render('public/offer', {
        title: offer.title, layout: PUBLIC_LAYOUT, offer, state: offerService.state(offer),
        totals: offerService.totals(offer.items), done: false,
        error: 'Podaj krótko powód — pomoże nam poprawić ofertę.',
      });
    }

    const r = await offerService.decide(offer, { decision, name: req.body.name, comment: req.body.comment });
    if (!r.ok) return res.redirect(`/o/${offer.token}`); // już zdecydowana/wygasła → pokaż stan
    mail.sendOfferDecision({ offer, decision, comment: req.body.comment, name: req.body.name, total: offerService.totals(offer.items).gross })
      .catch((e) => console.error('[mail] oferta decyzja:', e.message));
    res.redirect(`/o/${offer.token}?done=1`);
  } catch (err) {
    next(err);
  }
}

module.exports = { createOffer, deleteOffer, sendOffer, showOffer, submitDecision };
