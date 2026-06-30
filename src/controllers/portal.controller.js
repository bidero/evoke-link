// Strona publiczna: panel projektu dla klienta (link /p/:token).
// Pokazuje pliki oznaczone jako widoczne dla klienta i pozwala wgrywać własne.
const projectService = require('../services/project.service');
const transferService = require('../services/transfer.service');
const storage = require('../services/storage.service');
const zip = require('../services/zip.service');
const mail = require('../services/mail.service');
const events = require('../services/event.service');
const messageService = require('../services/message.service');
const { isRaster } = require('../utils/fileIcon');

const PUBLIC_LAYOUT = 'layouts/public';

function isUnlocked(req, token) {
  return Boolean(req.session.portalUnlocked && req.session.portalUnlocked[token]);
}
function markUnlocked(req, token) {
  req.session.portalUnlocked = req.session.portalUnlocked || {};
  req.session.portalUnlocked[token] = true;
}

// „Otwarcie" panelu — logujemy raz na sesję (oś czasu klienta), bez zaśmiecania.
function firstViewThisSession(req, token) {
  req.session.viewedLinks = req.session.viewedLinks || {};
  if (req.session.viewedLinks[token]) return false;
  req.session.viewedLinks[token] = true;
  return true;
}

async function loadProject(req, res) {
  const project = await projectService.getByClientToken(req.params.token);
  if (!project || project.status === 'deleted') {
    res.status(404).render('public/unavailable', { title: 'Nie znaleziono', layout: PUBLIC_LAYOUT, reason: 'not_found' });
    return null;
  }
  return project;
}

// Dzieli widoczne transfery na „od nas" (do pobrania) i „od klienta" (wgrane).
function visibleSets(project) {
  const live = project.transfers.filter((t) => t.status !== 'deleted');
  return {
    // „Od nas" — tylko transfery wychodzące oznaczone jako widoczne dla klienta.
    fromUs: live.filter((t) => t.direction === 'outgoing' && t.clientVisible),
    // „Twoje pliki" — WSZYSTKIE pliki przesłane przez klienta (jego własne), niezależnie
    // od flagi clientVisible (dotyczy też uploadów z osobnych linków /upload/:token).
    fromClient: live.filter((t) => t.direction === 'incoming'),
  };
}

function gate(req, res, project) {
  if (projectService.requiresClientPassword(project) && !isUnlocked(req, project.clientToken)) {
    res.render('public/password', { title: 'Panel projektu', layout: PUBLIC_LAYOUT, token: project.clientToken, action: `/p/${project.clientToken}/password`, error: null });
    return false;
  }
  return true;
}

async function showPortal(req, res, next) {
  try {
    const project = await loadProject(req, res);
    if (!project) return;
    if (!gate(req, res, project)) return;
    if (firstViewThisSession(req, project.clientToken)) {
      events.log({ type: 'viewed', message: 'Klient otworzył panel projektu', projectId: project.id, ip: req.ip });
    }
    res.locals.msgContext = { action: `/p/${project.clientToken}/message`, seen: `/p/${project.clientToken}/messages/seen`, scope: `projekt „${project.name}"` };
    res.locals.msgSent = req.query.msg === '1';
    res.locals.msgThread = await messageService.thread({ projectId: project.id });
    res.locals.msgHasReply = messageService.hasUnseen(res.locals.msgThread, (req.session.msgSeen || {})[project.clientToken]);
    const { fromUs, fromClient } = visibleSets(project);
    res.render('public/portal', { title: project.name, layout: PUBLIC_LAYOUT, project, fromUs, fromClient, sent: req.query.sent === '1' });
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

// Wiadomość od klienta z panelu projektu (/p) → skrzynka + mail do agencji.
async function submitMessage(req, res, next) {
  try {
    const project = await loadProject(req, res);
    if (!project) return;
    const { body, senderName, senderEmail } = req.body;
    const msg = await messageService.create({ body, senderName, senderEmail, projectId: project.id, clientId: project.clientId, ip: req.ip });
    if (msg) mail.sendNewMessageNotification({ message: msg, client: project.client, project }).catch((e) => console.error('[mail] wiadomość:', e.message));
    res.redirect(`/p/${project.clientToken}?msg=1`);
  } catch (err) {
    next(err);
  }
}

async function submitPassword(req, res, next) {
  try {
    const project = await loadProject(req, res);
    if (!project) return;
    if (projectService.verifyClientPassword(project, req.body.password)) {
      markUnlocked(req, project.clientToken);
      return res.redirect(`/p/${project.clientToken}`);
    }
    res.status(401).render('public/password', { title: 'Panel projektu', layout: PUBLIC_LAYOUT, token: project.clientToken, action: `/p/${project.clientToken}/password`, error: 'Nieprawidłowe hasło.' });
  } catch (err) {
    next(err);
  }
}

// Klient wgrywa pliki z panelu → nowy transfer przychodzący w projekcie (widoczny dla klienta).
async function submitUpload(req, res, next) {
  try {
    const project = await loadProject(req, res);
    if (!project) {
      (req.files || []).forEach((f) => storage.removeTmp(f.path));
      return;
    }
    if (projectService.requiresClientPassword(project) && !isUnlocked(req, project.clientToken)) {
      (req.files || []).forEach((f) => storage.removeTmp(f.path));
      return res.redirect(`/p/${project.clientToken}`);
    }
    const files = req.files || [];
    if (files.length === 0) return res.redirect(`/p/${project.clientToken}`);

    const { name, email } = req.body;
    const t = await transferService.createUploadRequest({
      title: `${project.name} — ${new Date().toLocaleDateString('pl-PL')}`,
      projectId: project.id,
      clientVisible: true,
    });
    const updated = await transferService.addFiles(t, files);

    await events.log({
      type: 'uploaded',
      message: `Klient przesłał ${files.length} plik(ów) z panelu` + (name ? ` (${name})` : ''),
      transferId: t.id,
      projectId: project.id,
      meta: { name: name || null, email: email || null },
      ip: req.ip,
    });
    mail
      .sendUploadNotification({ transfer: updated, fileNames: files.map((f) => f.originalname), uploaderName: name, uploaderEmail: email, projectName: project.name, client: project.client })
      .catch((e) => console.error('[mail] błąd:', e.message));

    res.redirect(`/p/${project.clientToken}?sent=1`);
  } catch (err) {
    (req.files || []).forEach((f) => storage.removeTmp(f.path));
    next(err);
  }
}

// Pobranie pliku — plik musi należeć do widocznego transferu w tym projekcie.
async function downloadFile(req, res, next) {
  try {
    const project = await loadProject(req, res);
    if (!project) return;
    if (projectService.requiresClientPassword(project) && !isUnlocked(req, project.clientToken)) return res.redirect(`/p/${project.clientToken}`);

    let file = null;
    let owner = null;
    for (const t of project.transfers) {
      // Klient może pobrać: pliki „od nas" widoczne (outgoing+clientVisible)
      // oraz wszystkie SWOJE wysłane pliki (incoming).
      const allowed = (t.direction === 'outgoing' && t.clientVisible) || t.direction === 'incoming';
      if (!allowed) continue;
      const f = t.files.find((x) => String(x.id) === String(req.params.fileId));
      if (f) { file = f; owner = t; break; }
    }
    if (!file) return res.status(404).render('public/unavailable', { title: 'Nie znaleziono', layout: PUBLIC_LAYOUT, reason: 'not_found' });

    await events.log({ type: 'downloaded', message: `Klient pobrał (panel): ${file.originalName}`, transferId: owner.id, projectId: project.id, ip: req.ip });

    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`);
    res.setHeader('Content-Length', Number(file.size));
    storage.readStream(file.storedPath).pipe(res);
  } catch (err) {
    next(err);
  }
}

// Podgląd miniatury (tylko rastrowy obraz) — inline, bez logowania zdarzeń.
async function previewFile(req, res, next) {
  try {
    const project = await loadProject(req, res);
    if (!project) return;
    if (projectService.requiresClientPassword(project) && !isUnlocked(req, project.clientToken)) return res.status(403).end();
    let file = null;
    for (const t of project.transfers) {
      const allowed = (t.direction === 'outgoing' && t.clientVisible) || t.direction === 'incoming';
      if (!allowed) continue;
      const f = t.files.find((x) => String(x.id) === String(req.params.fileId));
      if (f) { file = f; break; }
    }
    if (!file || !isRaster(file.originalName, file.mimeType)) return res.status(404).end();
    res.setHeader('Content-Type', file.mimeType || 'image/jpeg');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    storage.readStream(file.storedPath).pipe(res);
  } catch (err) {
    next(err);
  }
}

// Pobranie wszystkich plików „od nas" jednym ZIP-em.
async function downloadAllZip(req, res, next) {
  try {
    const project = await loadProject(req, res);
    if (!project) return;
    if (projectService.requiresClientPassword(project) && !isUnlocked(req, project.clientToken)) return res.redirect(`/p/${project.clientToken}`);

    const { fromUs } = visibleSets(project);
    const files = fromUs.flatMap((t) => t.files);
    if (!files.length) return res.redirect(`/p/${project.clientToken}`);

    await events.log({ type: 'downloaded', message: 'Klient pobrał ZIP z panelu', projectId: project.id, ip: req.ip });
    zip.streamFilesZip(res, files, project.name);
  } catch (err) {
    next(err);
  }
}

module.exports = { showPortal, submitMessage, markSeen, submitPassword, submitUpload, downloadFile, previewFile, downloadAllZip };
