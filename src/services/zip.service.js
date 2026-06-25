// Strumieniowe pakowanie plików transferu do ZIP-a w locie.
// Nie tworzymy pliku ZIP na dysku — strumień leci prosto do odpowiedzi HTTP,
// więc nie obciąża pamięci ani dysku (ważne na hostingu współdzielonym).
const archiver = require('archiver');
const storage = require('./storage.service');

// Strumieniuje dowolny zbiór plików (rekordy File) jako ZIP do odpowiedzi.
function streamFilesZip(res, files, zipName) {
  const safeName = (zipName || 'evoke').replace(/[^\w.-]+/g, '_') + '.zip';

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => {
    console.error('[zip] błąd archiwum:', err);
    res.destroy(err);
  });
  archive.pipe(res);

  for (const file of files) {
    archive.append(storage.readStream(file.storedPath), { name: file.originalName });
  }
  archive.finalize();
}

// ZIP pojedynczego transferu (nazwa z tytułu/tokenu).
function streamTransferZip(res, transfer) {
  streamFilesZip(res, transfer.files, transfer.title || 'evoke-' + transfer.token);
}

module.exports = { streamTransferZip, streamFilesZip };
