// Middleware uploadu dzielonego na kawałki (chunked) z fallbackiem do multipart.
//
// receiveChunk  — handler endpointu /chunk: przyjmuje surowe bajty kawałka i dopisuje je.
// receiveUpload — zamiennik `upload.array(field)` na endpointach tworzących:
//   * jeśli żądanie ma nagłówek X-Upload-Id → składa pliki z kawałków w req.files,
//   * w przeciwnym razie działa zwykły multipart (multer) — wstecznie kompatybilne.
const express = require('express');
const chunk = require('../services/chunk.service');
const baseUpload = require('./upload');

// Surowe ciało kawałka (do ~8 MB, kawałek klienta ma 5 MB + zapas).
const rawChunk = express.raw({ type: 'application/octet-stream', limit: '8mb' });

function receiveChunk(req, res) {
  try {
    const uploadId = req.get('X-Upload-Id');
    const fileIndex = req.get('X-File-Index');
    // Pusty kawałek (np. plik 0-bajtowy) jest dozwolony → pusty bufor.
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    chunk.appendChunk(uploadId, fileIndex, buf, {
      name: decodeURIComponent(req.get('X-File-Name') || ''),
      type: req.get('X-File-Type') || '',
      chunkIndex: req.get('X-Chunk-Index'),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

function receiveUpload(field) {
  const multipart = baseUpload.array(field);
  return (req, res, next) => {
    const uploadId = req.get('X-Upload-Id');
    if (uploadId) {
      try {
        req.files = chunk.assembleFiles(uploadId);
        // Posprzątaj katalog sesji po wysłaniu odpowiedzi (pliki części zostały
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

module.exports = { rawChunk, receiveChunk, receiveUpload };
