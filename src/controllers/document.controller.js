// Dokumenty klienta — zakładka „Dokumenty" na 360° (admin) + pobieranie widocznych
// dokumentów przez klienta w portalu /c. Pliki serwowane z wymuszonym download.
const documentService = require('../services/document.service');
const clientService = require('../services/client.service');
const storage = require('../services/storage.service');

const back = (clientId, status) => `/admin/clients/${clientId}?tab=dokumenty&sent=${status}#dokumenty`;

function sendFile(res, doc) {
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.name || 'dokument')}"`);
  storage.readStream(doc.storedPath).on('error', () => res.status(404).end()).pipe(res);
}

// --- Admin ---

async function uploadDocument(req, res, next) {
  try {
    const client = await clientService.getById(req.params.id);
    if (!client) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
    const doc = await documentService.create(client.id, { file: req.file, label: req.body.label, visibleToClient: req.body.visibleToClient === 'on' });
    res.redirect(back(client.id, doc ? 'doc-new' : 'doc-nofile'));
  } catch (err) {
    next(err);
  }
}

async function ownDoc(req) {
  const d = await documentService.getById(req.params.docId);
  return d && d.clientId === Number(req.params.id) ? d : null;
}

async function toggleDocument(req, res, next) {
  try {
    const d = await ownDoc(req);
    if (d) await documentService.toggleVisible(d.id);
    res.redirect(back(req.params.id, d ? 'doc-vis' : 'doc-nofile'));
  } catch (err) {
    next(err);
  }
}

async function deleteDocument(req, res, next) {
  try {
    const d = await ownDoc(req);
    if (d) await documentService.remove(d.id);
    res.redirect(back(req.params.id, d ? 'doc-del' : 'doc-nofile'));
  } catch (err) {
    next(err);
  }
}

async function downloadDocument(req, res, next) {
  try {
    const d = await ownDoc(req);
    if (!d) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
    sendFile(res, d);
  } catch (err) {
    next(err);
  }
}

// --- Public (portal /c) — tylko dokumenty oznaczone jako widoczne dla klienta ---

async function downloadClientDocument(req, res, next) {
  try {
    const client = await clientService.getByToken(req.params.token);
    if (!client) return res.status(404).render('public/unavailable', { title: 'Nie znaleziono', layout: 'layouts/public', reason: 'not_found' });
    const d = await documentService.getById(req.params.docId);
    if (!d || d.clientId !== client.id || !d.visibleToClient) {
      return res.status(404).render('public/unavailable', { title: 'Nie znaleziono', layout: 'layouts/public', reason: 'not_found' });
    }
    sendFile(res, d);
  } catch (err) {
    next(err);
  }
}

module.exports = { uploadDocument, toggleDocument, deleteDocument, downloadDocument, downloadClientDocument };
