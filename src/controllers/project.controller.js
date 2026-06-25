// Panel: zarządzanie projektami.
const projectService = require('../services/project.service');
const events = require('../services/event.service');
const config = require('../config');

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

function showCreateForm(req, res) {
  res.render('admin/projects/new', { title: 'Nowy projekt', active: 'projects', error: null });
}

async function createProject(req, res, next) {
  try {
    const { name, clientName, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).render('admin/projects/new', { title: 'Nowy projekt', active: 'projects', error: 'Podaj nazwę projektu.' });
    }
    const project = await projectService.create({ name, clientName, description });
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
    res.render('admin/projects/edit', { title: 'Edytuj projekt', active: 'projects', project, error: null });
  } catch (err) {
    next(err);
  }
}

async function updateProject(req, res, next) {
  try {
    const { name, clientName, description, status } = req.body;
    if (!name || !name.trim()) {
      const project = await projectService.getById(req.params.id);
      return res.status(400).render('admin/projects/edit', { title: 'Edytuj projekt', active: 'projects', project, error: 'Podaj nazwę projektu.' });
    }
    await projectService.update(req.params.id, {
      name, clientName, description, status,
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
