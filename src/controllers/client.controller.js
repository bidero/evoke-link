// Panel: baza klientów + publiczny portal klienta (/c/:token) z jego projektami.
const clientService = require('../services/client.service');
const projectService = require('../services/project.service');
const chargeService = require('../services/charge.service');
const settingsService = require('../services/settings.service');
const pdfService = require('../services/pdf.service');
const events = require('../services/event.service');
const mail = require('../services/mail.service');
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
    const clients = await clientService.list({ q, status });
    res.render('admin/clients/index', { title: 'Klienci', active: 'clients', clients, appUrl: config.appUrl, q, status, mailReady: mail.isConfigured(), sent: req.query.sent || null });
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
    const TABS = ['przeglad', 'projekty', 'rozliczenia', 'transfery', 'historia'];
    res.render('admin/clients/show', {
      title: data.client.name,
      active: 'clients',
      client: data.client,
      transfers: data.transfers,
      events: data.events,
      billing: data.billing,
      charges: data.charges,
      portalUrl: `${config.appUrl}/c/${data.client.token}`,
      sent: req.query.sent || null,
      activeTab: TABS.includes(req.query.tab) ? req.query.tab : 'przeglad',
    });
  } catch (err) {
    next(err);
  }
}

async function createClient(req, res, next) {
  try {
    const { name, email, note, company, phone, nip, address, status, tags } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).render('admin/clients/new', { title: 'Nowy klient', active: 'clients', error: 'Podaj nazwę klienta.', tagCloud: await clientService.tagCloud() });
    }
    const client = await clientService.create({ name, email, note, company, phone, nip, address, status, tags });
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
      await mail.sendPanelLink({ to, url, clientName: client.name });
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
    const { name, email, note, company, phone, nip, address, status, tags } = req.body;
    if (!name || !name.trim()) {
      const client = await clientService.getById(req.params.id);
      return res.status(400).render('admin/clients/edit', { title: 'Edytuj klienta', active: 'clients', client, error: 'Podaj nazwę klienta.', portalUrl: `${config.appUrl}/c/${client.token}`, mailReady: mail.isConfigured(), tagCloud: await clientService.tagCloud() });
    }
    await clientService.update(req.params.id, { name, email, note, company, phone, nip, address, status, tags });
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
      await chargeService.create({ projectId, clientId: projectId ? null : cid, label, amount, date: req.body.date, dueDate: req.body.dueDate });
      await events.log({
        type: 'updated',
        message: `Dodano pozycję rozliczeniową${label ? ': ' + label : ''} — ${fmt.money(amount)}`,
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
        await chargeService.update(charge.id, { label: req.body.label, amount, date: req.body.date, dueDate: req.body.dueDate, projectId }, cid);
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
async function addNote(req, res, next) {
  try {
    const text = (req.body.note || '').trim();
    if (text) await events.log({ type: 'note', message: text, clientId: Number(req.params.id), ip: req.ip });
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

    res.render('public/client-portal', { title: client.name, layout: PUBLIC_LAYOUT, client });
  } catch (err) {
    next(err);
  }
}

module.exports = { listClients, showCreateForm, showClient, createClient, showEditForm, updateClient, addNote, addCharge, updateCharge, toggleCharge, deleteCharge, clientStatementPdf, sendStatement, deleteClient, sendPanel, showClientPortal };
