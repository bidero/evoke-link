// Panel: zarządzanie projektami.
const projectService = require('../services/project.service');
const clientService = require('../services/client.service');
const events = require('../services/event.service');
const config = require('../config');

const parseClientId = (v) => (v ? parseInt(v, 10) : null);

async function listProjects(req, res, next) {
  try {
    const { status } = req.query;
    const projects = await projectService.list({ status });
    res.render('admin/projects/index', {
      title: 'Projekty',
      active: 'projects',
      projects,
      filter: { status: status || '' },
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
    });
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

module.exports = { listProjects, showCreateForm, createProject, showProject, showEditForm, updateProject, deleteProject };
