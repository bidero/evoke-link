// Panel: baza klientów + publiczny portal klienta (/c/:token) z jego projektami.
const prisma = require('../db/client');
const clientService = require('../services/client.service');
const projectService = require('../services/project.service');
const chargeService = require('../services/charge.service');
const settingsService = require('../services/settings.service');
const pdfService = require('../services/pdf.service');
const events = require('../services/event.service');
const mail = require('../services/mail.service');
const messageService = require('../services/message.service');
const reminderService = require('../services/reminder.service');
const offerService = require('../services/offer.service');
const payment = require('../utils/payment');
const config = require('../config');
const fmt = require('../utils/format');

const PUBLIC_LAYOUT = 'layouts/public';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const parseProjectId = (v) => (v ? parseInt(v, 10) : null);

// Sprawdza, czy projekt o danym id należy do tego klienta (zwraca id lub null).
async function clientProjectId(projectId, clientId) {
  if (!projectId) return null;
  const p = await projectService.getById(projectId);
  return p && p.clientId === clientId ? p.id : null;
}

async function listClients(req, res, next) {
  try {
    const q = req.query.q || '';
    const status = ['lead', 'active', 'inactive'].includes(req.query.status) ? req.query.status : '';
    const sort = clientService.SORTS.includes(req.query.sort) ? req.query.sort : 'name_asc';
    const clients = await clientService.list({ q, status, sort });
    res.render('admin/clients/index', { title: 'Klienci', active: 'clients', clients, appUrl: config.appUrl, q, status, sort, mailReady: mail.isConfigured(), sent: req.query.sent || null });
  } catch (err) {
    next(err);
  }
}

async function showCreateForm(req, res, next) {
  try {
    res.render('admin/clients/new', { title: 'Nowy klient', active: 'clients', error: null, tagCloud: await clientService.tagCloud() });
  } catch (err) {
    next(err);
  }
}

// Strona klienta 360° — kontakt + jego projekty + ostatnie transfery + oś czasu.
async function showClient(req, res, next) {
  try {
    const data = await clientService.overview(req.params.id);
    if (!data) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
    const TABS = ['przeglad', 'projekty', 'rozliczenia', 'oferty', 'transfery', 'historia'];
    res.render('admin/clients/show', {
      title: data.client.name,
      active: 'clients',
      client: data.client,
      transfers: data.transfers,
      events: data.events,
      billing: data.billing,
      charges: data.charges,
      retainers: data.retainers,
      offers: data.offers.map((o) => ({ ...o, gross: offerService.totals(o.items).gross, st: offerService.state(o) })),
      offerBaseUrl: config.appUrl,
      metrics: data.metrics,
      portalUrl: `${config.appUrl}/c/${data.client.token}`,
      onboardUrl: data.client.onboardingToken ? `${config.appUrl}/onboard/${data.client.onboardingToken}` : null,
      onboarding: clientService.onboardingState(data.client),
      sent: req.query.sent || null,
      activeTab: TABS.includes(req.query.tab) ? req.query.tab : 'przeglad',
    });
  } catch (err) {
    next(err);
  }
}

async function createClient(req, res, next) {
  try {
    const { name, firstName, lastName, email, note, company, phone, nip, address, status, tags } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).render('admin/clients/new', { title: 'Nowy klient', active: 'clients', error: 'Podaj nazwę klienta.', tagCloud: await clientService.tagCloud() });
    }
    const client = await clientService.create({ name, firstName, lastName, email, note, company, phone, nip, address, status, tags });
    res.redirect(`/admin/clients/${client.id}/edit`);
  } catch (err) {
    next(err);
  }
}

async function showEditForm(req, res, next) {
  try {
    const client = await clientService.getById(req.params.id);
    if (!client) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
    res.render('admin/clients/edit', { title: client.name, active: 'clients', client, error: null, portalUrl: `${config.appUrl}/c/${client.token}`, panel: req.query.panel || null, mailReady: mail.isConfigured(), tagCloud: await clientService.tagCloud() });
  } catch (err) {
    next(err);
  }
}

// „Przypomnij" z widżetu „Do odezwania się" — zadanie „Odezwij się do X" na jutro 9:00.
async function createFollowup(req, res, next) {
  try {
    const client = await clientService.getById(req.params.id);
    if (!client) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
    const due = new Date();
    due.setDate(due.getDate() + 1);
    due.setHours(9, 0, 0, 0);
    await reminderService.create({ title: `Odezwij się: ${client.name}`, dueAt: due, priority: 'normal', clientId: client.id });
    res.redirect(req.get('referer') || '/admin');
  } catch (err) {
    next(err);
  }
}

// Wysyłka linku do portalu klienta (/c/:token) na e-mail.
async function sendPanel(req, res, next) {
  try {
    const client = await clientService.getById(req.params.id);
    if (!client) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
    // Skąd wywołano wysyłkę — decyduje, dokąd wrócić: lista / strona klienta / (domyślnie) edycja.
    const dest = req.body.redirect;
    const back = (status) => {
      if (dest === 'list') return `/admin/clients?sent=${status}`;
      if (dest === 'show') return `/admin/clients/${client.id}?sent=${status}`;
      const panel = status === 'ok' || status === 'dev' ? 'sent' : status; // strona edycji używa panel=sent/invalid/error
      return `/admin/clients/${client.id}/edit?panel=${panel}`;
    };
    const to = ((req.body.email || '').trim()) || (client.email || '');
    if (!EMAIL_RE.test(to)) return res.redirect(back('invalid'));
    const url = `${config.appUrl}/c/${client.token}`;
    try {
      await mail.sendPanelLink({ to, url, clientName: client.name, client });
      res.redirect(back(mail.isConfigured() ? 'ok' : 'dev'));
    } catch (e) {
      console.error('[mail] panel klienta:', e.message);
      res.redirect(back('error'));
    }
  } catch (err) {
    next(err);
  }
}

async function updateClient(req, res, next) {
  try {
    const { name, firstName, lastName, email, note, company, phone, nip, address, status, tags } = req.body;
    if (!name || !name.trim()) {
      const client = await clientService.getById(req.params.id);
      return res.status(400).render('admin/clients/edit', { title: 'Edytuj klienta', active: 'clients', client, error: 'Podaj nazwę klienta.', portalUrl: `${config.appUrl}/c/${client.token}`, mailReady: mail.isConfigured(), tagCloud: await clientService.tagCloud() });
    }
    await clientService.update(req.params.id, { name, firstName, lastName, email, note, company, phone, nip, address, status, tags });
    res.redirect(`/admin/clients/${req.params.id}/edit`);
  } catch (err) {
    next(err);
  }
}

// Wydruk PDF rozliczenia klienta (przefiltrowane pozycje: zakres dat / status / zaznaczone).
async function clientStatementPdf(req, res, next) {
  try {
    const client = await clientService.getById(req.params.id);
    if (!client) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
    const { from, to, status } = req.query;
    let ids = req.query.ids;
    if (ids && !Array.isArray(ids)) ids = [ids];
    const charges = await chargeService.forStatement(client.id, { from, to, status, ids });
    const settings = await settingsService.get();
    pdfService.clientStatement(res, { client, charges, filters: { from, to, status }, settings });
  } catch (err) {
    next(err);
  }
}

// Eksport pozycji klienta do CSV (do księgowości) — respektuje ten sam filtr co wydruk.
async function clientChargesCsv(req, res, next) {
  try {
    const client = await clientService.getById(req.params.id);
    if (!client) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
    const { from, to, status } = req.query;
    let ids = req.query.ids;
    if (ids && !Array.isArray(ids)) ids = [ids];
    const charges = await chargeService.forStatement(client.id, { from, to, status, ids });

    const SEP = ';'; // średnik — Excel PL otwiera w kolumnach bez importu
    const cell = (v) => { const s = String(v == null ? '' : v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const money = (g) => (g / 100).toFixed(2).replace('.', ',');
    const date = (d) => (d ? fmt.dateOnly(d) : '');
    const rows = [['Data', 'Termin', 'Projekt', 'Pozycja', 'Netto', 'VAT %', 'Brutto', 'Status', 'Rozliczono']];
    charges.forEach((c) => rows.push([
      date(c.date), date(c.dueDate),
      (c.project && c.project.name) || 'Bez projektu',
      c.label || 'Pozycja',
      money(c.amount), c.vatRate != null ? String(c.vatRate) : '', money(chargeService.grossOf(c)),
      c.paidAt ? 'Rozliczone' : 'Do zapłaty', date(c.paidAt),
    ]));
    const csv = '﻿' + rows.map((r) => r.map(cell).join(SEP)).join('\r\n') + '\r\n'; // BOM dla Excela
    const slug = String(client.name || 'klient').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'klient';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pozycje-${slug}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
}

// Wysyłka rozliczenia/proformy do klienta e-mailem (PDF w załączniku, respektuje filtr).
async function sendStatement(req, res, next) {
  try {
    const client = await clientService.getById(req.params.id);
    if (!client) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
    const email = (client.email || '').trim();
    if (!EMAIL_RE.test(email)) return res.redirect(`/admin/clients/${client.id}?tab=rozliczenia&sent=stmt-noemail`);
    let ids = req.body.ids;
    if (ids && !Array.isArray(ids)) ids = [ids];
    const filters = { from: req.body.from, to: req.body.to, status: req.body.status };
    const charges = await chargeService.forStatement(client.id, { ...filters, ids });
    const settings = await settingsService.get();
    const title = settings.pdf && settings.pdf.docType === 'proforma' ? 'Proforma' : 'Rozliczenie';
    const pdfBuffer = await pdfService.clientStatementBuffer({ client, charges, filters, settings });
    const filename = pdfService.statementFilename(client, settings);
    try {
      await mail.sendClientStatement({ to: email, client, pdfBuffer, filename, title });
      await events.log({ type: 'email_sent', message: `Wysłano ${title.toLowerCase()} do ${email}`, clientId: client.id, ip: req.ip });
      res.redirect(`/admin/clients/${client.id}?tab=rozliczenia&sent=${mail.isConfigured() ? 'stmt-ok' : 'stmt-dev'}`);
    } catch (e) {
      console.error('[mail] rozliczenie:', e.message);
      res.redirect(`/admin/clients/${client.id}?tab=rozliczenia&sent=stmt-error`);
    }
  } catch (err) {
    next(err);
  }
}

// --- Pozycje rozliczeniowe z poziomu klienta (centralna, edytowalna lista) ---

// Dodanie pozycji do wybranego projektu klienta LUB wprost do klienta („bez projektu").
async function addCharge(req, res, next) {
  try {
    const cid = Number(req.params.id);
    const amount = chargeService.parseAmount(req.body.amount);
    if (amount > 0) {
      const projectId = await clientProjectId(parseProjectId(req.body.projectId), cid);
      const label = (req.body.label || '').trim();
      const vatRate = chargeService.parseVatRate(req.body.vatRate);
      await chargeService.create({ projectId, clientId: projectId ? null : cid, label, amount, vatRate, date: req.body.date, dueDate: req.body.dueDate });
      await events.log({
        type: 'updated',
        message: `Dodano pozycję rozliczeniową${label ? ': ' + label : ''} — ${fmt.money(chargeService.grossOf({ amount, vatRate }))}`,
        projectId: projectId || undefined,
        clientId: projectId ? undefined : cid,
        ip: req.ip,
      });
    }
    res.redirect(`/admin/clients/${cid}?tab=rozliczenia`);
  } catch (err) {
    next(err);
  }
}

// Edycja pozycji (nazwa/kwota/data + przypisanie do projektu/„bez projektu").
async function updateCharge(req, res, next) {
  try {
    const cid = Number(req.params.id);
    const charge = await chargeService.getByIdWithProject(req.params.chargeId);
    if (charge && chargeService.ownerClientId(charge) === cid) {
      const amount = chargeService.parseAmount(req.body.amount);
      if (amount > 0) {
        const projectId = await clientProjectId(parseProjectId(req.body.projectId), cid);
        await chargeService.update(charge.id, { label: req.body.label, amount, vatRate: chargeService.parseVatRate(req.body.vatRate), date: req.body.date, dueDate: req.body.dueDate, paidAt: req.body.paidAt, projectId }, cid);
      }
    }
    res.redirect(`/admin/clients/${cid}?tab=rozliczenia`);
  } catch (err) {
    next(err);
  }
}

// Przełączenie rozliczone/nierozliczone.
async function toggleCharge(req, res, next) {
  try {
    const cid = Number(req.params.id);
    const charge = await chargeService.getByIdWithProject(req.params.chargeId);
    if (charge && chargeService.ownerClientId(charge) === cid) await chargeService.setPaid(charge.id, !charge.paidAt);
    res.redirect(`/admin/clients/${cid}?tab=rozliczenia`);
  } catch (err) {
    next(err);
  }
}

// Usunięcie pozycji.
async function deleteCharge(req, res, next) {
  try {
    const cid = Number(req.params.id);
    const charge = await chargeService.getByIdWithProject(req.params.chargeId);
    if (charge && chargeService.ownerClientId(charge) === cid) await chargeService.remove(charge.id);
    res.redirect(`/admin/clients/${cid}?tab=rozliczenia`);
  } catch (err) {
    next(err);
  }
}

// Dodanie ręcznej notatki do klienta (trafia na jego oś czasu jako zdarzenie typu 'note').
// Interakcja z osi czasu 360°: typ (notatka/telefon/spotkanie/e-mail) w prefiksie
// + opcjonalny follow-up (Reminder „Follow-up: {klient}" za X dni, 9:00).
const NOTE_KINDS = { note: null, call: 'Telefon', meeting: 'Spotkanie', email: 'E-mail' };

async function addNote(req, res, next) {
  try {
    const text = (req.body.note || '').trim();
    const kind = Object.prototype.hasOwnProperty.call(NOTE_KINDS, req.body.kind) ? req.body.kind : 'note';
    if (text) {
      const label = NOTE_KINDS[kind];
      await events.log({ type: 'note', message: label ? `${label}: ${text}` : text, clientId: Number(req.params.id), meta: { kind }, ip: req.ip });
      const days = parseInt(req.body.followupDays, 10);
      if (Number.isFinite(days) && days >= 1 && days <= 365) {
        const client = await clientService.getById(req.params.id);
        if (client) {
          const due = new Date();
          due.setDate(due.getDate() + days);
          due.setHours(9, 0, 0, 0);
          await reminderService.create({ title: `Follow-up: ${client.name}`, note: text.slice(0, 300), dueAt: due, priority: 'normal', clientId: client.id });
        }
      }
    }
    res.redirect(`/admin/clients/${req.params.id}?tab=historia`);
  } catch (err) {
    next(err);
  }
}

async function deleteClient(req, res, next) {
  try {
    // Pozycje rozliczeniowe „bez projektu" istnieją tylko przy kliencie — blokujemy usunięcie.
    if (await chargeService.directCount(req.params.id) > 0) {
      return res.redirect(`/admin/clients/${req.params.id}?sent=has-charges`);
    }
    await clientService.remove(req.params.id);
    res.redirect('/admin/clients');
  } catch (err) {
    next(err);
  }
}

// Publiczny portal klienta — lista jego projektów (każdy linkuje do swojego panelu /p/:token).
// „Otwarcie" portalu klienta — raz na sesję (oś czasu klienta).
function firstViewThisSession(req, token) {
  req.session.viewedLinks = req.session.viewedLinks || {};
  if (req.session.viewedLinks[token]) return false;
  req.session.viewedLinks[token] = true;
  return true;
}

async function showClientPortal(req, res, next) {
  try {
    const client = await clientService.getByToken(req.params.token);
    if (!client) return res.status(404).render('public/unavailable', { title: 'Nie znaleziono', layout: PUBLIC_LAYOUT, reason: 'not_found' });

    // Upewnij się, że każdy projekt ma token panelu klienta (do linku /p/:token).
    for (const p of client.projects) {
      if (!p.clientToken) {
        const upd = await projectService.ensureClientToken(p);
        p.clientToken = upd.clientToken;
      }
    }

    res.locals.msgContext = { action: `/c/${client.token}/message`, seen: `/c/${client.token}/messages/seen`, scope: '' };
    res.locals.msgSent = req.query.msg === '1';
    res.locals.msgThread = await messageService.thread({ clientId: client.id });
    res.locals.msgHasReply = messageService.hasUnseen(res.locals.msgThread, (req.session.msgSeen || {})[client.token]);
    if (firstViewThisSession(req, client.token)) {
      events.log({ type: 'viewed', message: 'Klient otworzył portal', clientId: client.id, ip: req.ip });
    }

    // Sekcja „Do zapłaty": nierozliczone pozycje + dane do przelewu (+ QR wg ZBP, gdy konto = 26 cyfr).
    // Wyłączana przełącznikiem w Ustawienia → Rozliczenia (PDF) (`pdf.portalBilling`).
    const pdfCfg = (await settingsService.get()).pdf || {};
    const rows = pdfCfg.portalBilling ? await chargeService.unpaidForClient(client.id) : [];
    const unpaid = rows.map((c) => ({ ...c, gross: chargeService.grossOf(c) }));
    const unpaidTotal = unpaid.reduce((s, c) => s + c.gross, 0);
    const seller = pdfCfg.seller || {};
    const account = payment.bankDigits(seller.bank);
    const transferTitle = `Rozliczenie — ${client.name}`.slice(0, 32);
    const paymentQr = account && unpaidTotal > 0
      ? payment.zbpPayload({ nip: seller.nip, account, amountGr: unpaidTotal, name: seller.name, title: transferTitle })
      : null;

    // Chip „Zgłoszono wpłatę" — ostatnia deklaracja z 7 dni (do potwierdzenia przez agencję).
    const lastDeclared = unpaid.length
      ? await prisma.event.findFirst({ where: { clientId: client.id, type: 'paid_declared' }, orderBy: { createdAt: 'desc' } })
      : null;
    const paidDeclaredAt = lastDeclared && (Date.now() - new Date(lastDeclared.createdAt).getTime()) < 7 * 86400000
      ? lastDeclared.createdAt : null;

    // Oferty klienta do wglądu/akceptacji (oczekujące na górze).
    const offerRows = await offerService.list(client.id);
    const offers = offerRows
      .map((o) => ({ title: o.title, token: o.token, gross: offerService.totals(o.items).gross, st: offerService.state(o), validUntil: o.validUntil }))
      .filter((o) => o.st !== 'expired'); // wygasłe chowamy przed klientem

    res.render('public/client-portal', {
      title: client.name, layout: PUBLIC_LAYOUT, client,
      unpaid, unpaidTotal, seller, transferTitle, paymentQr,
      paidDeclaredAt, paidFlash: req.query.paid === '1',
      offers,
    });
  } catch (err) {
    next(err);
  }
}

// Klient zgłasza wykonanie przelewu (portal /c) → dzwonek + mail do agencji, do potwierdzenia.
// Anty-spam: jedna deklaracja na 7 dni; sekcja musi być włączona (pdf.portalBilling).
async function submitPaidDeclaration(req, res, next) {
  try {
    const client = await clientService.getByToken(req.params.token);
    if (!client) return res.status(404).render('public/unavailable', { title: 'Nie znaleziono', layout: PUBLIC_LAYOUT, reason: 'not_found' });
    const s = await settingsService.get();
    if (!(s.pdf && s.pdf.portalBilling)) return res.redirect(`/c/${client.token}`);

    const rows = await chargeService.unpaidForClient(client.id);
    const total = rows.reduce((sum, c) => sum + chargeService.grossOf(c), 0);
    const recent = await prisma.event.findFirst({ where: { clientId: client.id, type: 'paid_declared', createdAt: { gte: new Date(Date.now() - 7 * 86400000) } } });
    if (!rows.length || recent) return res.redirect(`/c/${client.token}?paid=1`); // idempotentnie

    await events.log({ type: 'paid_declared', message: `Klient zgłosił wpłatę (${rows.length} poz., ${fmt.money(total)})`, clientId: client.id, ip: req.ip });
    mail.sendPaymentDeclared({ client, total, count: rows.length }).catch((e) => console.error('[mail] wpłata:', e.message));
    res.redirect(`/c/${client.token}?paid=1`);
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

// Wiadomość od klienta z portalu klienta (/c) → skrzynka + mail do agencji.
async function submitClientMessage(req, res, next) {
  try {
    const client = await clientService.getByToken(req.params.token);
    if (!client) return res.status(404).render('public/unavailable', { title: 'Nie znaleziono', layout: PUBLIC_LAYOUT, reason: 'not_found' });
    const { body, senderName, senderEmail } = req.body;
    const msg = await messageService.create({ body, senderName, senderEmail, clientId: client.id, ip: req.ip, file: req.file });
    if (msg) mail.sendNewMessageNotification({ message: msg, client }).catch((e) => console.error('[mail] wiadomość:', e.message));
    res.redirect(`/c/${client.token}?msg=1`);
  } catch (err) {
    next(err);
  }
}

module.exports = { listClients, showCreateForm, showClient, createClient, showEditForm, updateClient, addNote, addCharge, updateCharge, toggleCharge, deleteCharge, clientStatementPdf, clientChargesCsv, sendStatement, deleteClient, sendPanel, createFollowup, showClientPortal, submitClientMessage, submitPaidDeclaration, markSeen };
