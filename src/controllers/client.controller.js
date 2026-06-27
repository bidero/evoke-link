// Panel: baza klientów + publiczny portal klienta (/c/:token) z jego projektami.
const clientService = require('../services/client.service');
const projectService = require('../services/project.service');
const events = require('../services/event.service');
const mail = require('../services/mail.service');
const config = require('../config');

const PUBLIC_LAYOUT = 'layouts/public';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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
    res.render('admin/clients/show', {
      title: data.client.name,
      active: 'clients',
      client: data.client,
      transfers: data.transfers,
      events: data.events,
      portalUrl: `${config.appUrl}/c/${data.client.token}`,
    });
  } catch (err) {
    next(err);
  }
}

async function createClient(req, res, next) {
  try {
    const { name, email, note, company, phone, status, tags } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).render('admin/clients/new', { title: 'Nowy klient', active: 'clients', error: 'Podaj nazwę klienta.', tagCloud: await clientService.tagCloud() });
    }
    const client = await clientService.create({ name, email, note, company, phone, status, tags });
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
    const toList = req.body.redirect === 'list'; // wysyłka jednym kliknięciem z listy klientów
    const to = ((req.body.email || '').trim()) || (client.email || '');
    if (!EMAIL_RE.test(to)) return res.redirect(toList ? '/admin/clients?sent=invalid' : `/admin/clients/${client.id}/edit?panel=invalid`);
    const url = `${config.appUrl}/c/${client.token}`;
    try {
      await mail.sendPanelLink({ to, url, clientName: client.name });
      res.redirect(toList ? '/admin/clients?sent=ok' : `/admin/clients/${client.id}/edit?panel=sent`);
    } catch (e) {
      console.error('[mail] panel klienta:', e.message);
      res.redirect(toList ? '/admin/clients?sent=error' : `/admin/clients/${client.id}/edit?panel=error`);
    }
  } catch (err) {
    next(err);
  }
}

async function updateClient(req, res, next) {
  try {
    const { name, email, note, company, phone, status, tags } = req.body;
    if (!name || !name.trim()) {
      const client = await clientService.getById(req.params.id);
      return res.status(400).render('admin/clients/edit', { title: 'Edytuj klienta', active: 'clients', client, error: 'Podaj nazwę klienta.', portalUrl: `${config.appUrl}/c/${client.token}`, mailReady: mail.isConfigured(), tagCloud: await clientService.tagCloud() });
    }
    await clientService.update(req.params.id, { name, email, note, company, phone, status, tags });
    res.redirect(`/admin/clients/${req.params.id}/edit`);
  } catch (err) {
    next(err);
  }
}

// Dodanie ręcznej notatki do klienta (trafia na jego oś czasu jako zdarzenie typu 'note').
async function addNote(req, res, next) {
  try {
    const text = (req.body.note || '').trim();
    if (text) await events.log({ type: 'note', message: text, clientId: Number(req.params.id), ip: req.ip });
    res.redirect(`/admin/clients/${req.params.id}`);
  } catch (err) {
    next(err);
  }
}

async function deleteClient(req, res, next) {
  try {
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

module.exports = { listClients, showCreateForm, showClient, createClient, showEditForm, updateClient, addNote, deleteClient, sendPanel, showClientPortal };
