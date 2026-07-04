// Dokument klienta (umowa, NDA, brief…) — pojedynczy plik do katalogu tymczasowego.
// document.service.create przenosi go do storage (_documents/) po zapisie wiersza.
const multer = require('multer');
const storage = require('../services/storage.service');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, storage.TMP_DIR),
    filename: (req, file, cb) => cb(null, storage.makeStoredName(file.originalname)),
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB — umowy/PDF/skany
});

module.exports = upload.single('document');
