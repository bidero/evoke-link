// Pobieranie przez krótkotrwały podpisany link (`/dl/:token`) — patrz `utils/signedLink.js`.
// Powód istnienia: PWA na iOS. Adres jest CELOWO poza `scope: '/admin'`, żeby otwierał się
// poza oknem aplikacji, i CELOWO nie wymaga sesji (web-apka ma w iOS osobne ciasteczka).
const signed = require('../utils/signedLink');
const transferService = require('../services/transfer.service');
const documentService = require('../services/document.service');
const messageService = require('../services/message.service');
const storage = require('../services/storage.service');
const zipService = require('../services/zip.service');

// --- Wystawienie linku (tylko dla zalogowanego) ---
// Rodzaj + id sprawdzamy TU, żeby nie dało się podpisać wskazania na nieistniejący zasób.
async function mintToken(req, res, next) {
  try {
    const { kind, id, extra } = req.body || {};
    if (!signed.KINDS.includes(kind)) return res.status(400).json({ error: 'bad_kind' });

    let ok = false;
    if (kind === 'file' || kind === 'zip') {
      const transfer = await transferService.getById(id);
      ok = !!transfer && (kind === 'zip'
        ? transfer.files.length > 0
        : transfer.files.some((f) => String(f.id) === String(extra)));
    } else if (kind === 'document') {
      ok = !!(await documentService.getById(id));
    } else if (kind === 'attachment') {
      const m = await messageService.getById(id);
      ok = !!(m && m.attachmentPath);
    }
    if (!ok) return res.status(404).json({ error: 'not_found' });

    const token = signed.sign(kind, id, extra);
    if (!token) return res.status(400).json({ error: 'bad_kind' });
    res.set('Cache-Control', 'no-store').json({ url: `/dl/${token}`, ttl: signed.TTL_MS });
  } catch (err) {
    next(err);
  }
}

// --- Wydanie pliku (publiczne, autoryzuje podpis) ---
async function serve(req, res, next) {
  try {
    const data = signed.verify(req.params.token);
    // Ten sam komunikat dla złego podpisu i przeterminowania — nie podpowiadamy, co poszło
    // nie tak. Powód `dl_expired` tłumaczy, co zrobić dalej (dotąd było mylące „nie znaleziono").
    if (!data) return res.status(404).render('public/unavailable', { title: 'Link wygasł', layout: 'layouts/public', reason: 'dl_expired' });

    if (data.kind === 'zip') {
      const transfer = await transferService.getById(data.id);
      if (!transfer || !transfer.files.length) return res.status(404).end();
      return zipService.streamTransferZip(res, transfer);
    }
    if (data.kind === 'file') {
      const transfer = await transferService.getById(data.id);
      const file = transfer && transfer.files.find((f) => String(f.id) === String(data.extra));
      if (!file) return res.status(404).end();
      return sendAttachment(res, file.originalName.split('/').pop(), file.mimeType, file.storedPath, Number(file.size));
    }
    if (data.kind === 'document') {
      const doc = await documentService.getById(data.id);
      if (!doc) return res.status(404).end();
      return sendAttachment(res, doc.name, doc.mime, doc.storedPath, Number(doc.size));
    }
    if (data.kind === 'attachment') {
      const m = await messageService.getById(data.id);
      if (!m || !m.attachmentPath) return res.status(404).end();
      return sendAttachment(res, m.attachmentName, m.attachmentMime, m.attachmentPath, Number(m.attachmentSize));
    }
    res.status(404).end();
  } catch (err) {
    next(err);
  }
}

function sendAttachment(res, name, mime, storedPath, size) {
  res.setHeader('Content-Type', mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name || 'plik')}`);
  if (Number.isFinite(size) && size > 0) res.setHeader('Content-Length', size);
  res.setHeader('Cache-Control', 'no-store');
  return storage.pipeDownload(res, storedPath);
}

module.exports = { mintToken, serve };
