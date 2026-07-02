// Onboarding klienta — jednorazowy link /onboard/:token, przez który klient
// sam uzupełnia dane CRM (firma, NIP, adres, kontakt). Generowanie i wysyłka z panelu.
const clientService = require('../services/client.service');
const events = require('../services/event.service');
const mail = require('../services/mail.service');
const config = require('../config');

const PUBLIC_LAYOUT = 'layouts/public';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// „Otwarcie" formularza — raz na sesję (oś czasu klienta); ten sam wzorzec co portal /c.
function firstViewThisSession(req, token) {
  req.session.viewedLinks = req.session.viewedLinks || {};
  if (req.session.viewedLinks[token]) return false;
  req.session.viewedLinks[token] = true;
  return true;
}

// Admin: generuje (lub wymienia) link onboardingowy — stary przestaje działać.
async function generateLink(req, res, next) {
  try {
    const client = await clientService.getById(req.params.id);
    if (!client) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
    await clientService.generateOnboarding(client.id);
    events.log({ type: 'updated', message: 'Wygenerowano link onboardingowy', clientId: client.id, ip: req.ip });
    res.redirect(`/admin/clients/${client.id}?sent=onb-new`);
  } catch (err) {
    next(err);
  }
}

// Admin: wysyłka linku onboardingowego na e-mail klienta.
async function sendLink(req, res, next) {
  try {
    const client = await clientService.getById(req.params.id);
    if (!client) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
    const back = (status) => `/admin/clients/${client.id}?sent=${status}`;
    if (clientService.onboardingState(client) !== 'active') return res.redirect(back('onb-nolink'));
    const to = client.email || '';
    if (!EMAIL_RE.test(to)) return res.redirect(back('onb-invalid'));
    const url = `${config.appUrl}/onboard/${client.onboardingToken}`;
    try {
      await mail.sendOnboardingLink({ to, url, client, expiresAt: client.onboardingExpiresAt });
      events.log({ type: 'email_sent', message: `Wysłano link onboardingowy do ${to}`, clientId: client.id });
      res.redirect(back(mail.isConfigured() ? 'onb-ok' : 'onb-dev'));
    } catch (e) {
      console.error('[mail] onboarding:', e.message);
      res.redirect(back('onb-error'));
    }
  } catch (err) {
    next(err);
  }
}

// Wspólna bramka publicznych tras: klient po tokenie + rozstrzygnięcie stanu linku.
// Zwraca { client, state } lub null (odpowiedź już wysłana).
async function gate(req, res) {
  const client = await clientService.getByOnboardingToken(req.params.token);
  if (!client) {
    res.status(404).render('public/unavailable', { title: 'Nie znaleziono', layout: PUBLIC_LAYOUT, reason: 'not_found' });
    return null;
  }
  const state = clientService.onboardingState(client);
  if (state === 'expired') {
    res.status(410).render('public/unavailable', { title: 'Link wygasł', layout: PUBLIC_LAYOUT, reason: 'onboard_expired' });
    return null;
  }
  return { client, state };
}

// Publiczny GET /onboard/:token — formularz (lub „Dziękujemy" po wypełnieniu).
// GOTCHA: local dla widoku nazywa się onbClient, NIE client — locala `client` ejs.renderFile
// traktuje jak opcję kompilatora (tryb client-side) i include() przestaje istnieć.
async function showForm(req, res, next) {
  try {
    const g = await gate(req, res);
    if (!g) return;
    if (g.state === 'completed') {
      return res.render('public/onboard', { title: 'Dziękujemy', layout: PUBLIC_LAYOUT, onbClient: g.client, done: true, error: null, values: null });
    }
    if (firstViewThisSession(req, g.client.onboardingToken)) {
      events.log({ type: 'viewed', message: 'Klient otworzył formularz onboardingowy', clientId: g.client.id, ip: req.ip });
    }
    res.render('public/onboard', { title: 'Uzupełnij swoje dane', layout: PUBLIC_LAYOUT, onbClient: g.client, done: false, error: null, values: g.client });
  } catch (err) {
    next(err);
  }
}

// Publiczny POST /onboard/:token — zapis danych, event + mail do agencji, redirect na „Dziękujemy".
async function submitForm(req, res, next) {
  try {
    const g = await gate(req, res);
    if (!g) return;
    // Już wypełniony → idempotentnie na stronę podziękowania, bez zapisu.
    if (g.state === 'completed') return res.redirect(`/onboard/${g.client.onboardingToken}`);

    const emailEditable = !g.client.email;
    const email = (req.body.email || '').trim();
    if (emailEditable && email && !EMAIL_RE.test(email)) {
      return res.status(400).render('public/onboard', {
        title: 'Uzupełnij swoje dane', layout: PUBLIC_LAYOUT, onbClient: g.client, done: false,
        error: 'Podaj poprawny adres e-mail.', values: { ...req.body, email },
      });
    }

    const updated = await clientService.completeOnboarding(g.client, req.body);
    await events.log({ type: 'onboarded', message: 'Klient uzupełnił swoje dane (onboarding)', clientId: g.client.id, ip: req.ip });
    mail.sendOnboardingCompleted({ client: updated }).catch((e) => console.error('[mail] onboarding:', e.message));
    res.redirect(`/onboard/${g.client.onboardingToken}`);
  } catch (err) {
    next(err);
  }
}

module.exports = { generateLink, sendLink, showForm, submitForm };
