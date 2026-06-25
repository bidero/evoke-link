// Upload logo/favicon do public/branding/ (serwowane statycznie pod /branding/...).
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const BRANDING_DIR = path.join(__dirname, '..', '..', 'public', 'branding');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, BRANDING_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 10) || '';
    cb(null, file.fieldname + '_' + crypto.randomBytes(6).toString('hex') + ext);
  },
});

// Tylko obrazy (w tym SVG), do 5 MB — obraz tła bywa większy niż logo.
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

module.exports = upload;
