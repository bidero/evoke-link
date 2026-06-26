// Middleware uploadu dzielonego na kawałki (chunked) z fallbackiem do multipart.
//
// chunkParser   — parsuje multipart kawałka (pole `chunk` + metadane jako pola formularza).
// receiveChunk  — handler endpointu /chunk: zapisuje bajty kawałka.
// receiveUpload — zamiennik `upload.array(field)` na endpointach tworzących:
//   * jeśli żądanie ma pole `uploadId` (lub nagłówek X-Upload-Id) → składa pliki z kawałków,
//   * w przeciwnym razie działa zwykły multipart (multer) — wstecznie kompatybilne.
//
// Transport kawałków to multipart/form-data (NIE octet-stream + nagłówki X-*),
// bo to standardowy upload, którego WAF/proxy hostingu współdzielonego nie blokują.
const multer = require('multer');
const chunk = require('../services/chunk.service');
const baseUpload = require('./upload');

// Kawałek trzymamy chwilowo w pamięci (≤ ~8 MB: kawałek 5 MB + zapas), potem
// chunk.service zapisuje go na dysk.
const chunkParser = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } }).single('chunk');

function receiveChunk(req, res) {
  try {
    const b = req.body || {};
    // Pusty kawałek (np. plik 0-bajtowy) jest dozwolony → pusty bufor.
    const buf = req.file && Buffer.isBuffer(req.file.buffer) ? req.file.buffer : Buffer.alloc(0);
    chunk.writeChunk(b.uploadId, b.fileIndex, buf, {
      name: b.fileName || '',
      type: b.fileType || '',
      chunkIndex: b.chunkIndex,
      totalChunks: b.totalChunks,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

function receiveUpload(field) {
  const multipart = baseUpload.array(field);
  return async (req, res, next) => {
    const uploadId = (req.body && req.body.uploadId) || req.get('X-Upload-Id');
    if (uploadId) {
      try {
        req.files = await chunk.assembleFiles(uploadId);
        // Sprzątamy katalog sesji po wysłaniu odpowiedzi (pliki części zostały
        // już przeniesione do katalogu transferu przez warstwę storage).
        res.on('finish', () => chunk.cleanup(uploadId));
        return next();
      } catch (err) {
        return next(err);
      }
    }
    return multipart(req, res, next);
  };
}

module.exports = { chunkParser, receiveChunk, receiveUpload };
