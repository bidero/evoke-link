// Trasy panelu — wszystkie chronione logowaniem (requireAuth).
// Kolejne sekcje (projekty, transfery, ustawienia) dojdą w następnych etapach.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { chunkParser, receiveChunk, receiveUpload } = require('../middleware/chunkUpload');
const { showDashboard } = require('../controllers/dashboard.controller');
const transfers = require('../controllers/transfer.controller');
const projects = require('../controllers/project.controller');
const notifications = require('../controllers/notification.controller');
const settings = require('../controllers/settings.controller');
const account = require('../controllers/account.controller');
const brandingUpload = require('../middleware/brandingUpload');
const events = require('../services/event.service');

const router = express.Router();

router.use(requireAuth);

// Licznik nieprzeczytanych powiadomień — dostępny w każdym widoku panelu (dzwonek).
router.use(async (req, res, next) => {
  try {
    res.locals.unreadCount = await events.unreadCount();
  } catch (_) {
    res.locals.unreadCount = 0;
  }
  next();
});

router.get('/', showDashboard);

// Transfery. Ważne: trasy z konkretnym słowem (new, new-upload, upload)
// muszą być PRZED trasami z :id, żeby Express nie potraktował ich jak id.
router.get('/transfers', transfers.listTransfers);
router.get('/transfers/new', transfers.showCreateForm);
router.get('/transfers/new-upload', transfers.showCreateUploadForm);
router.post('/transfers/chunk', chunkParser, receiveChunk); // kawałki uploadu (przed :id!)
router.post('/transfers', receiveUpload('files'), transfers.createTransfer); // wychodzący
router.post('/transfers/upload', transfers.createUpload); // link uploadu (przychodzący)
router.get('/transfers/:id', transfers.showTransfer);
router.get('/transfers/:id/edit', transfers.showEditForm);
router.get('/transfers/:id/zip', transfers.adminDownloadZip);
router.get('/transfers/:id/file/:fileId', transfers.adminDownloadFile);
router.post('/transfers/:id', transfers.updateTransfer);
router.post('/transfers/:id/delete', transfers.deleteTransfer);

// Projekty (Etap 3).
router.get('/projects', projects.listProjects);
router.get('/projects/new', projects.showCreateForm);
router.post('/projects', projects.createProject);
router.get('/projects/:id', projects.showProject);
router.get('/projects/:id/edit', projects.showEditForm);
router.post('/projects/:id', projects.updateProject);
router.post('/projects/:id/delete', projects.deleteProject);

// Powiadomienia (Etap 4).
router.get('/notifications', notifications.index);
router.post('/notifications/read-all', notifications.readAll);
router.get('/notifications/:id/open', notifications.open);

// Customizacja (Etap 5 + 6: kolory panelu, tło stron klienta).
router.get('/settings', settings.showSettings);
router.post(
  '/settings',
  brandingUpload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'favicon', maxCount: 1 },
    { name: 'bg', maxCount: 1 },
  ]),
  settings.updateSettings
);

// Konto admina — zmiana hasła.
router.get('/account', account.showAccount);
router.post('/account/password', account.changePassword);

module.exports = router;
