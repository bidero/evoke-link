// Panel: zarządzanie projektami.
const projectService = require('../services/project.service');
const clientService = require('../services/client.service');
const chargeService = require('../services/charge.service');
const events = require('../services/event.service');
const mail = require('../services/mail.service');
const config = require('../config');
const fmt = require('../utils/format');

const parseClientId = (v) => (v ? parseInt(v, 10) : null);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function listProjects(req, res, next) {
  try {
    const { q } = req.query;
    const SORTS = ['activity', 'created', 'name', 'manual'];
    const STATUSES = ['active', 'archived', 'all']; // 'all' = bez filtra

    // Zapamiętujemy ostatnio wybrane sortowanie i zakładkę statusu w sesji;
    // wejście bez parametru (np. z menu bocznego) używa zapamiętanych.
    let sort;
    if (SORTS.includes(req.query.sort)) {
      sort = req.query.sort;
      if (req.session) req.session.projectSort = sort;
    } else {
      sort = (req.session && SORTS.includes(req.session.projectSort)) ? req.session.projectSort : 'activity';
    }

    let statusSel;
    if (STATUSES.includes(req.query.status)) {
      statusSel = req.query.status;
      if (req.session) req.session.projectStatus = statusSel;
    } else {
      statusSel = (req.session && STATUSES.includes(req.session.projectStatus)) ? req.session.projectStatus : 'all';
    }
    const status = statusSel === 'all' ? '' : statusSel; // '' → serwis nie filtruje

    const projects = await projectService.list({ status, q, sort });
    res.render('admin/projects/index', {
      title: 'Projekty',
      active: 'projects',
      projects,
      filter: { status: status || '', q: q || '', sort },
    });
  } catch (err) {
    next(err);
  }
}

async function showCreateForm(req, res, next) {
  try {
    const clients = await clientService.options();
    res.render('admin/projects/new', { title: 'Nowy projekt', active: 'projects', error: null, clients, selectedClientId: req.query.client ? parseInt(req.query.client, 10) : null });
  } catch (err) {
    next(err);
  }
}

async function createProject(req, res, next) {
  try {
    const { name, clientName, description } = req.body;
    if (!name || !name.trim()) {
      const clients = await clientService.options();
      return res.status(400).render('admin/projects/new', { title: 'Nowy projekt', active: 'projects', error: 'Podaj nazwę projektu.', clients, selectedClientId: parseClientId(req.body.clientId) });
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
      chargeTotals: chargeService.totals(project.charges),
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
      await mail.sendPanelLink({ to, url, projectName: project.name, clientName: project.client ? project.client.name : null, client: project.client || null });
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

// Dodanie pozycji rozliczeniowej do projektu.
async function addCharge(req, res, next) {
  try {
    const amount = chargeService.parseAmount(req.body.amount);
    if (amount > 0) {
      const label = (req.body.label || '').trim();
      await chargeService.create({ projectId: req.params.id, label, amount, vatRate: chargeService.parseVatRate(req.body.vatRate), note: req.body.note, date: req.body.date, dueDate: req.body.dueDate });
      await events.log({ type: 'updated', message: `Dodano pozycję rozliczeniową${label ? ': ' + label : ''} — ${fmt.money(amount)}`, projectId: Number(req.params.id), ip: req.ip });
    }
    res.redirect(`/admin/projects/${req.params.id}#rozliczenia`);
  } catch (err) {
    next(err);
  }
}

// Przełączenie pozycji rozliczone/nierozliczone.
async function toggleCharge(req, res, next) {
  try {
    const charge = await chargeService.getById(req.params.chargeId);
    if (charge && charge.projectId === Number(req.params.id)) {
      const willPay = !charge.paidAt;
      await chargeService.setPaid(charge.id, willPay);
      await events.log({ type: 'updated', message: `${willPay ? 'Rozliczono' : 'Cofnięto rozliczenie'}${charge.label ? ': ' + charge.label : ''} — ${fmt.money(charge.amount)}`, projectId: Number(req.params.id), ip: req.ip });
    }
    res.redirect(`/admin/projects/${req.params.id}#rozliczenia`);
  } catch (err) {
    next(err);
  }
}

// Zmiana daty rozliczenia pozycji (po oznaczeniu jako rozliczone — edycja daty).
async function setChargePaidDate(req, res, next) {
  try {
    const charge = await chargeService.getById(req.params.chargeId);
    if (charge && charge.projectId === Number(req.params.id)) {
      await chargeService.setPaidDate(charge.id, req.body.paidAt);
    }
    res.redirect(`/admin/projects/${req.params.id}#rozliczenia`);
  } catch (err) {
    next(err);
  }
}

// Usunięcie pozycji rozliczeniowej.
async function deleteCharge(req, res, next) {
  try {
    const charge = await chargeService.getById(req.params.chargeId);
    if (charge && charge.projectId === Number(req.params.id)) await chargeService.remove(charge.id);
    res.redirect(`/admin/projects/${req.params.id}#rozliczenia`);
  } catch (err) {
    next(err);
  }
}

// Zapis ręcznej kolejności (drag & drop). Body: { ids: [..] }.
async function reorderProjects(req, res, next) {
  try {
    await projectService.reorder(req.body.ids || []);
    res.json({ ok: true });
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

// Archiwizacja / przywrócenie jednym kliknięciem. redirect=list → wróć na listę.
async function archiveProject(req, res, next) {
  try {
    const project = await projectService.getById(req.params.id);
    if (project) {
      const target = project.status === 'archived' ? 'active' : 'archived';
      await projectService.setStatus(project.id, target);
      await events.log({
        type: 'updated',
        message: target === 'archived' ? 'Zarchiwizowano projekt' : 'Przywrócono projekt z archiwum',
        projectId: project.id,
        ip: req.ip,
      });
    }
    res.redirect(req.body.redirect === 'list' ? '/admin/projects' : `/admin/projects/${req.params.id}`);
  } catch (err) {
    next(err);
  }
}

// Tablica kanban (pipeline: Lead → Aktywny → Dostarczony → Zapłacony).
async function showBoard(req, res, next) {
  try {
    res.render('admin/projects/board', { title: 'Tablica projektów', active: 'projects', columns: await projectService.board() });
  } catch (err) {
    next(err);
  }
}

// Zmiana etapu (drag & drop na tablicy; fetch JSON).
async function setStage(req, res, next) {
  try {
    const updated = await projectService.setStage(req.params.id, (req.body && req.body.stage) || '');
    if (updated) await events.log({ type: 'updated', message: `Etap projektu: ${projectService.STAGE_LABELS[updated.stage] || updated.stage}`, projectId: updated.id, ip: req.ip });
    res.json({ ok: !!updated });
  } catch (err) {
    next(err);
  }
}

// --- Lista braków (checklist materiałów od klienta) ---
const fileRequestService = require('../services/fileRequest.service');

async function addFileRequest(req, res, next) {
  try {
    await fileRequestService.create(req.params.id, { label: req.body.label, note: req.body.note });
    res.redirect(`/admin/projects/${req.params.id}`);
  } catch (err) { next(err); }
}
async function toggleFileRequest(req, res, next) {
  try {
    await fileRequestService.toggle(req.params.rid, req.params.id);
    res.redirect(`/admin/projects/${req.params.id}`);
  } catch (err) { next(err); }
}
async function deleteFileRequest(req, res, next) {
  try {
    await fileRequestService.remove(req.params.rid, req.params.id);
    res.redirect(`/admin/projects/${req.params.id}`);
  } catch (err) { next(err); }
}

module.exports = { listProjects, showCreateForm, createProject, showProject, sendPanel, showEditForm, updateProject, reorderProjects, showBoard, setStage, archiveProject, addCharge, toggleCharge, setChargePaidDate, deleteCharge, addFileRequest, toggleFileRequest, deleteFileRequest, deleteProject };
