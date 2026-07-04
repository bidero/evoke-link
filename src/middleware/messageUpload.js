// Załącznik wiadomości (klient↔agencja) — pojedynczy plik do katalogu tymczasowego.
// message.service.create przenosi go do storage (_messages/) po zapisaniu wiadomości,
// albo sprząta tmp, gdy treść pusta. Dowolny typ (agencja odbiera to, co przyśle klient).
const multer = require('multer');
const storage = require('../services/storage.service');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, storage.TMP_DIR),
    filename: (req, file, cb) => cb(null, storage.makeStoredName(file.originalname)),
  }),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB — zwykły załącznik (nie duże pliki = to transfery)
});

// .single('attachment') — pole opcjonalne; brak pliku nie jest błędem.
module.exports = upload.single('attachment');
