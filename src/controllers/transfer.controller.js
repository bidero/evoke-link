// Panel: zarządzanie transferami wychodzącymi.
const transferService = require('../services/transfer.service');
const projectService = require('../services/project.service');
const storage = require('../services/storage.service');
const zipService = require('../services/zip.service');
const events = require('../services/event.service');
const config = require('../config');

// Parsuje projectId z formularza ('' → null, inaczej liczba).
function parseProjectId(value) {
  return value ? parseInt(value, 10) : null;
}

// Lista transferów z prostym filtrowaniem (?status=...&direction=...).
async function listTransfers(req, res, next) {
  try {
    const { status, direction } = req.query;
    const transfers = await transferService.list({ status, direction });
    res.render('admin/transfers/index', {
      title: 'Transfery',
      active: 'transfers',
      transfers,
      filter: { status: status || '', direction: direction || '' },
    });
  } catch (err) {
    next(err);
  }
}

// Formularz nowego transferu.
async function showCreateForm(req, res, next) {
  try {
    const projects = await projectService.list({ status: 'active' });
    res.render('admin/transfers/new', {
      title: 'Nowy transfer',
      active: 'transfers',
      projects,
      selectedProjectId: req.query.project ? parseInt(req.query.project, 10) : null,
      error: null,
    });
  } catch (err) {
    next(err);
  }
}

// Utworzenie transferu z wgranych plików.
async function createTransfer(req, res, next) {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      const projects = await projectService.list({ status: 'active' });
      return res.status(400).render('admin/transfers/new', {
        title: 'Nowy transfer',
        active: 'transfers',
        projects,
        selectedProjectId: req.body.projectId ? parseInt(req.body.projectId, 10) : null,
        error: 'Dodaj przynajmniej jeden plik.',
      });
    }

    const { title, message, password, expiresAt, maxDownloads, projectId } = req.body;

    const transfer = await transferService.createOutgoingTransfer({
      title: title && title.trim() ? title.trim() : null,
      message: message && message.trim() ? message.trim() : null,
      password: password && password.trim() ? password.trim() : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      maxDownloads: maxDownloads ? parseInt(maxDownloads, 10) : null,
      projectId: parseProjectId(projectId),
      clientVisible: req.body.clientVisible === 'on',
      uploadedFiles: files,
    });

    await events.log({
      type: 'created',
      message: `Utworzono transfer: ${transfer.title || transfer.token} (${files.length} plików)`,
      transferId: transfer.id,
      projectId: transfer.projectId,
      ip: req.ip,
    });

    res.redirect(`/admin/transfers/${transfer.id}`);
  } catch (err) {
    // Sprzątamy pliki tymczasowe, jeśli coś padło w trakcie.
    (req.files || []).forEach((f) => storage.removeTmp(f.path));
    next(err);
  }
}

// Buduje publiczny URL zależnie od kierunku transferu.
function publicUrlFor(transfer) {
  const path = transfer.direction === 'incoming' ? 'upload' : 't';
  return `${config.appUrl}/${path}/${transfer.token}`;
}

// Szczegóły transferu (z gotowym linkiem publicznym).
async function showTransfer(req, res, next) {
  try {
    const transfer = await transferService.getById(req.params.id);
    if (!transfer) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });

    res.render('admin/transfers/show', {
      title: transfer.title || 'Transfer',
      active: 'transfers',
      transfer,
      publicUrl: publicUrlFor(transfer),
    });
  } catch (err) {
    next(err);
  }
}

// Formularz nowego linku uploadu (transfer przychodzący).
async function showCreateUploadForm(req, res, next) {
  try {
    const projects = await projectService.list({ status: 'active' });
    res.render('admin/transfers/new-upload', {
      title: 'Nowy link uploadu',
      active: 'transfers',
      projects,
      selectedProjectId: req.query.project ? parseInt(req.query.project, 10) : null,
      error: null,
    });
  } catch (err) {
    next(err);
  }
}

// Utworzenie linku uploadu.
async function createUpload(req, res, next) {
  try {
    const { title, message, password, expiresAt, projectId } = req.body;
    const transfer = await transferService.createUploadRequest({
      title: title && title.trim() ? title.trim() : null,
      message: message && message.trim() ? message.trim() : null,
      password: password && password.trim() ? password.trim() : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      projectId: parseProjectId(projectId),
    });
    await events.log({ type: 'created', message: `Utworzono link uploadu: ${transfer.title || transfer.token}`, transferId: transfer.id, projectId: transfer.projectId, ip: req.ip });
    res.redirect(`/admin/transfers/${transfer.id}`);
  } catch (err) {
    next(err);
  }
}

// Format daty pod pole <input type="datetime-local"> (YYYY-MM-DDTHH:mm, czas lokalny).
function toLocalInput(date) {
  if (!date) return '';
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Formularz edycji transferu.
async function showEditForm(req, res, next) {
  try {
    const transfer = await transferService.getById(req.params.id);
    if (!transfer) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
    const projects = await projectService.list({ status: 'active' });
    res.render('admin/transfers/edit', {
      title: 'Edytuj transfer',
      active: 'transfers',
      transfer,
      projects,
      expiresLocal: toLocalInput(transfer.expiresAt),
      error: null,
    });
  } catch (err) {
    next(err);
  }
}

// Zapis edycji transferu.
async function updateTransfer(req, res, next) {
  try {
    const { title, message, expiresAt, maxDownloads, password, removePassword, projectId } = req.body;
    const updated = await transferService.update(req.params.id, {
      title,
      message,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      maxDownloads: maxDownloads ? parseInt(maxDownloads, 10) : null,
      newPassword: password && password.trim() ? password.trim() : null,
      removePassword: removePassword === 'on',
      projectId: parseProjectId(projectId),
      clientVisible: req.body.clientVisible === 'on',
    });
    if (!updated) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
    await events.log({ type: 'updated', message: `Zmieniono ustawienia transferu`, transferId: updated.id, projectId: updated.projectId, ip: req.ip });
    res.redirect(`/admin/transfers/${updated.id}`);
  } catch (err) {
    next(err);
  }
}

// Pobranie pliku przez admina (bez bramki hasła/limitu — admin jest uprawniony,
// nie zwiększa licznika pobrań klienta).
async function adminDownloadFile(req, res, next) {
  try {
    const transfer = await transferService.getById(req.params.id);
    const file = transfer && transfer.files.find((f) => String(f.id) === String(req.params.fileId));
    if (!file) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`);
    res.setHeader('Content-Length', Number(file.size));
    storage.readStream(file.storedPath).pipe(res);
  } catch (err) {
    next(err);
  }
}

// Pobranie ZIP przez admina.
async function adminDownloadZip(req, res, next) {
  try {
    const transfer = await transferService.getById(req.params.id);
    if (!transfer || transfer.files.length === 0) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
    zipService.streamTransferZip(res, transfer);
  } catch (err) {
    next(err);
  }
}

// Usunięcie transferu (plus pliki z dysku).
async function deleteTransfer(req, res, next) {
  try {
    const transfer = await transferService.getById(req.params.id);
    if (transfer) await transferService.remove(transfer);
    res.redirect('/admin/transfers');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listTransfers,
  showCreateForm,
  createTransfer,
  showCreateUploadForm,
  createUpload,
  showTransfer,
  showEditForm,
  updateTransfer,
  adminDownloadFile,
  adminDownloadZip,
  deleteTransfer,
};
