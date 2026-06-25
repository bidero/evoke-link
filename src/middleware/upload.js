// Konfiguracja Multera — przyjmuje pliki z formularza i zapisuje je
// najpierw do katalogu tymczasowego (storage/tmp). Dopiero kontroler
// przenosi je do katalogu transferu po utworzeniu rekordu (i tokenu).
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const storage = require('../services/storage.service');

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, storage.TMP_DIR),
  filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname)),
});

// Limit: 2 GB na plik (lokalnie spokojnie wystarczy). Na produkcji i tak
// dojdzie upload dzielony na kawałki, omijający limity hostingu.
const upload = multer({
  storage: diskStorage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

module.exports = upload;
