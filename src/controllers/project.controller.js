// Panel: zarządzanie projektami.
const projectService = require('../services/project.service');
const clientService = require('../services/client.service');
const events = require('../services/event.service');
const mail = require('../services/mail.service');
const config = require('../config');

const parseClientId = (v) => (v ? parseInt(v, 10) : null);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function listProjects(req, res, next) {
  try {
    const { status, q } = req.query;
    const projects = await projectService.list({ status, q });
    res.render('admin/projects/index', {
      title: 'Projekty',
      active: 'projects',
      projects,
      filter: { status: status || '', q: q || '' },
    });
  } catch (err) {
    next(err);
  }
}

async function showCreateForm(req, res, next) {
  try {
    const clients = await clientService.options();
    res.render('admin/projects/new', { title: 'Nowy projekt', active: 'projects', error: null, clients });
  } catch (err) {
    next(err);
  }
}

async function createProject(req, res, next) {
  try {
    const { name, clientName, description } = req.body;
    if (!name || !name.trim()) {
      const clients = await clientService.options();
      return res.status(400).render('admin/projects/new', { title: 'Nowy projekt', active: 'projects', error: 'Podaj nazwę projektu.', clients });
    }
    const project = await projectService.create({ name, clientName, description, clientId: parseClientId(req.body.clientId) });
    await events.log({ type: 'created', message: `Utworzono projekt: ${project.name}`, projectId: project.id, ip: req.ip });
    res.redirect(`/admin/projects/${project.id}`);
  } catch (err) {
    next(err);
  }
}

async function showProject(req, res, next) {
  try {
    const project = await projectService.getById(req.params.id);
    if (!project) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });

    // Starsze projekty mogą nie mieć tokenu panelu — dogeneruj przy wejściu.
    if (!project.clientToken) {
      const upd = await projectService.ensureClientToken(project);
      project.clientToken = upd.clientToken;
    }

    const history = await projectService.getHistory(project.id);
    // Wejście w projekt = „zobaczone" → czyścimy jego badge nieprzeczytanych.
    try { await events.markProjectRead(project.id); } catch (_) {}
    const outgoing = project.transfers.filter((t) => t.direction === 'outgoing');
    const incoming = project.transfers.filter((t) => t.direction === 'incoming');

    res.render('admin/projects/show', {
      title: project.name,
      active: 'projects',
      project,
      outgoing,
      incoming,
      history,
      portalUrl: `${config.appUrl}/p/${project.clientToken}`,
      panel: req.query.panel || null, // sent | invalid | error (flash po wysyłce panelu)
      clientEmail: project.client ? project.client.email || '' : '',
      mailReady: mail.isConfigured(),
    });
  } catch (err) {
    next(err);
  }
}

// Wysyłka linku do panelu klienta (projektu) na e-mail.
async function sendPanel(req, res, next) {
  try {
    const project = await projectService.getById(req.params.id);
    if (!project) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
    const to = (req.body.email || '').trim();
    if (!EMAIL_RE.test(to)) return res.redirect(`/admin/projects/${project.id}?panel=invalid`);
    if (!project.clientToken) {
      const u = await projectService.ensureClientToken(project);
      project.clientToken = u.clientToken;
    }
    const url = `${config.appUrl}/p/${project.clientToken}`;
    try {
      await mail.sendPanelLink({ to, url, projectName: project.name, clientName: project.client ? project.client.name : null });
      await events.log({ type: 'email_sent', message: `Wysłano panel projektu do ${to}`, projectId: project.id, ip: req.ip });
      res.redirect(`/admin/projects/${project.id}?panel=sent`);
    } catch (e) {
      console.error('[mail] panel projektu:', e.message);
      res.redirect(`/admin/projects/${project.id}?panel=error`);
    }
  } catch (err) {
    next(err);
  }
}

async function showEditForm(req, res, next) {
  try {
    const project = await projectService.getById(req.params.id);
    if (!project) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
    const clients = await clientService.options();
    res.render('admin/projects/edit', { title: 'Edytuj projekt', active: 'projects', project, error: null, clients });
  } catch (err) {
    next(err);
  }
}

async function updateProject(req, res, next) {
  try {
    const { name, clientName, description, status } = req.body;
    if (!name || !name.trim()) {
      const project = await projectService.getById(req.params.id);
      const clients = await clientService.options();
      return res.status(400).render('admin/projects/edit', { title: 'Edytuj projekt', active: 'projects', project, error: 'Podaj nazwę projektu.', clients });
    }
    await projectService.update(req.params.id, {
      name, clientName, description, status,
      clientId: parseClientId(req.body.clientId),
      newClientPassword: req.body.clientPassword && req.body.clientPassword.trim() ? req.body.clientPassword.trim() : null,
      removeClientPassword: req.body.removeClientPassword === 'on',
    });
    res.redirect(`/admin/projects/${req.params.id}`);
  } catch (err) {
    next(err);
  }
}

async function deleteProject(req, res, next) {
  try {
    await projectService.remove(req.params.id);
    res.redirect('/admin/projects');
  } catch (err) {
    next(err);
  }
}

module.exports = { listProjects, showCreateForm, createProject, showProject, sendPanel, showEditForm, updateProject, deleteProject };
