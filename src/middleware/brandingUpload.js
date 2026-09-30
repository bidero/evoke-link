// Upload logo/favicon do public/branding/ (serwowane statycznie pod /branding/...).
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const BRANDING_DIR = path.join(__dirname, '..', '..', 'public', 'branding');

// GOTCHA BEZPIECZEŃSTWA: pliki lądują w public/ i są serwowane statycznie Z DOMENY PANELU.
// Typ MIME deklaruje przeglądarka (da się go podać dowolnie), więc sam filtr `image/*`
// przepuszczał np. `strona.html` wysłany jako image/png — plik zapisywał się z rozszerzeniem
// .html i otwierał jako strona z dostępem do sesji panelu. Rozszerzenie bierzemy WYŁĄCZNIE
// z listy dozwolonych obrazów; wszystko inne jest odrzucane.
const ALLOWED_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico'];
const extOf = (name) => String(path.extname(name || '')).toLowerCase();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, BRANDING_DIR),
  filename: (req, file, cb) => {
    cb(null, file.fieldname + '_' + crypto.randomBytes(6).toString('hex') + extOf(file.originalname));
  },
});

// Tylko obrazy (w tym SVG), do 5 MB — obraz tła bywa większy niż logo.
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype) && ALLOWED_EXT.includes(extOf(file.originalname))),
});
upload.ALLOWED_EXT = ALLOWED_EXT;

module.exports = upload;
