// Trasy publiczne (bez logowania) — strony dla klienta.
// W Etapie 1 dojdzie pobieranie /t/:token, w Etapie 2 upload /upload/:token.
const express = require('express');
const download = require('../controllers/download.controller');
const receive = require('../controllers/receive.controller');
const portal = require('../controllers/portal.controller');
const clientCtrl = require('../controllers/client.controller');
const { chunkParser, receiveChunk, receiveUpload } = require('../middleware/chunkUpload');
const { passwordLimiter, messageLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// Strona główna — w MVP przekierowuje do panelu.
// Docelowo (Etap 6) może to być brandowana strona-wizytówka.
router.get('/', (req, res) => res.redirect('/admin'));

// Publiczne pobieranie (Etap 1).
router.get('/t/:token', download.showDownloadPage);
router.post('/t/:token', passwordLimiter, download.submitPassword);
router.get('/t/:token/zip', download.downloadZip);
router.get('/t/:token/preview/:fileId', download.previewFile);
router.get('/t/:token/file/:fileId', download.downloadFile);
router.post('/t/:token/message', messageLimiter, download.submitMessage);

// Publiczny upload od klienta (Etap 2).
router.get('/upload/:token', receive.showUploadPage);
router.post('/upload/:token/password', passwordLimiter, receive.submitPassword);
router.post('/upload/:token/chunk', chunkParser, receiveChunk);
router.post('/upload/:token', receiveUpload('files'), receive.submitUpload);

// Panel klienta na poziomie projektu (/p/:token).
router.get('/p/:token', portal.showPortal);
router.post('/p/:token/password', passwordLimiter, portal.submitPassword);
router.get('/p/:token/zip', portal.downloadAllZip);
router.get('/p/:token/preview/:fileId', portal.previewFile);
router.get('/p/:token/file/:fileId', portal.downloadFile);
router.post('/p/:token/chunk', chunkParser, receiveChunk);
router.post('/p/:token/upload', receiveUpload('files'), portal.submitUpload);
router.post('/p/:token/message', messageLimiter, portal.submitMessage);

// Portal klienta — wszystkie projekty przypisane do klienta (/c/:token).
router.get('/c/:token', clientCtrl.showClientPortal);
router.post('/c/:token/message', messageLimiter, clientCtrl.submitClientMessage);

module.exports = router;
