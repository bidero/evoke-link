// Trasy panelu — wszystkie chronione logowaniem (requireAuth).
// Kolejne sekcje (projekty, transfery, ustawienia) dojdą w następnych etapach.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { chunkParser, receiveChunk, receiveUpload } = require('../middleware/chunkUpload');
const { showDashboard } = require('../controllers/dashboard.controller');
const transfers = require('../controllers/transfer.controller');
const projects = require('../controllers/project.controller');
const clients = require('../controllers/client.controller');
const notifications = require('../controllers/notification.controller');
const settings = require('../controllers/settings.controller');
const search = require('../controllers/search.controller');
const account = require('../controllers/account.controller');
const brandingUpload = require('../middleware/brandingUpload');
const events = require('../services/event.service');
const messages = require('../controllers/message.controller');
const messageService = require('../services/message.service');
const calendar = require('../controllers/calendar.controller');
const reminderService = require('../services/reminder.service');

const router = express.Router();

router.use(requireAuth);

// Licznik nieprzeczytanych powiadomień — dostępny w każdym widoku panelu (dzwonek).
router.use(async (req, res, next) => {
  try {
    res.locals.unreadCount = await events.unreadCount();
    res.locals.unreadMessages = await messageService.unreadCount();
    res.locals.calendarDue = await reminderService.dueCount();
  } catch (_) {
    res.locals.unreadCount = 0;
    res.locals.unreadMessages = 0;
    res.locals.calendarDue = 0;
  }
  next();
});

router.get('/', showDashboard);
router.get('/pulse', require('../controllers/pulse.controller').showPulse);
router.get('/search', search.index);

// Wiadomości od klientów (skrzynka).
// Kalendarz / przypomnienia.
router.get('/calendar', calendar.index);
router.post('/calendar/reminders', calendar.createReminder);
router.post('/calendar/reminders/:id', calendar.updateReminder);
router.post('/calendar/reminders/:id/toggle', calendar.toggleReminder);
router.post('/calendar/reminders/:id/delete', calendar.deleteReminder);

router.get('/messages', messages.listMessages);
router.post('/messages/read-all', messages.markAllRead);
router.post('/messages/:id/reply', messages.replyMessage);
router.post('/messages/:id/read', messages.markRead);
router.post('/messages/:id/delete', messages.deleteMessage);

// Transfery. Ważne: trasy z konkretnym słowem (new, new-upload, upload)
// muszą być PRZED trasami z :id, żeby Express nie potraktował ich jak id.
router.get('/transfers', transfers.listTransfers);
router.get('/transfers/new', transfers.showCreateForm);
router.get('/transfers/new-upload', transfers.showCreateUploadForm);
router.post('/transfers/chunk', chunkParser, receiveChunk); // kawałki uploadu (przed :id!)
router.post('/transfers/bulk-delete', transfers.bulkDelete); // przed :id!
router.post('/transfers', receiveUpload('files'), transfers.createTransfer); // wychodzący
router.post('/transfers/upload', transfers.createUpload); // link uploadu (przychodzący)
router.get('/transfers/:id', transfers.showTransfer);
router.get('/transfers/:id/edit', transfers.showEditForm);
router.post('/transfers/:id/send', transfers.sendLinkEmail);
router.get('/transfers/:id/zip', transfers.adminDownloadZip);
router.get('/transfers/:id/file/:fileId', transfers.adminDownloadFile);
router.get('/transfers/:id/preview/:fileId', transfers.adminPreviewFile);
router.post('/transfers/:id', transfers.updateTransfer);
router.post('/transfers/:id/extend', transfers.extendTransfer);
router.post('/transfers/:id/delete', transfers.deleteTransfer);

// Projekty (Etap 3).
router.get('/projects', projects.listProjects);
router.get('/projects/new', projects.showCreateForm);
router.post('/projects/reorder', projects.reorderProjects); // przed :id!
router.post('/projects', projects.createProject);
router.get('/projects/:id', projects.showProject);
router.post('/projects/:id/send-panel', projects.sendPanel);
router.post('/projects/:id/charges', projects.addCharge);
router.post('/projects/:id/charges/:chargeId/toggle', projects.toggleCharge);
router.post('/projects/:id/charges/:chargeId/delete', projects.deleteCharge);
router.get('/projects/:id/edit', projects.showEditForm);
router.post('/projects/:id', projects.updateProject);
router.post('/projects/:id/delete', projects.deleteProject);

// Klienci (Grupa 4).
router.get('/clients', clients.listClients);
router.get('/clients/new', clients.showCreateForm);
router.post('/clients', clients.createClient);
router.post('/clients/:id/send-panel', clients.sendPanel);
router.get('/clients/:id/edit', clients.showEditForm);
router.post('/clients/:id/note', clients.addNote);
router.get('/clients/:id/rozliczenie.pdf', clients.clientStatementPdf);
router.get('/clients/:id/pozycje.csv', clients.clientChargesCsv);
router.post('/clients/:id/rozliczenie/send', clients.sendStatement);
router.post('/clients/:id/charges', clients.addCharge);                       // dodaj pozycję (projekt lub „bez projektu")
router.post('/clients/:id/charges/:chargeId/toggle', clients.toggleCharge);
router.post('/clients/:id/charges/:chargeId/delete', clients.deleteCharge);
router.post('/clients/:id/charges/:chargeId', clients.updateCharge);          // edycja (po wariantach /toggle, /delete)
router.get('/clients/:id', clients.showClient);
router.post('/clients/:id', clients.updateClient);
router.post('/clients/:id/delete', clients.deleteClient);

// Powiadomienia (Etap 4).
router.get('/notifications', notifications.index);
router.post('/notifications/read-all', notifications.readAll);
router.post('/notifications/clear', notifications.clearAll); // przed :id
router.get('/notifications/:id/open', notifications.open);
router.post('/notifications/:id/dismiss', notifications.dismiss);

// Customizacja (Etap 5 + 6: kolory panelu, tło stron klienta).
router.get('/settings', settings.showSettings);
router.post('/settings/test-email', settings.sendTestEmail);
router.post('/settings/apply-theme', settings.applyTheme);
router.post('/settings/backup', settings.downloadBackup);
router.post('/settings/backup-auto', settings.toggleAutoBackup);
router.post(
  '/settings',
  brandingUpload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'logoDark', maxCount: 1 },
    { name: 'favicon', maxCount: 1 },
    { name: 'ogImage', maxCount: 1 },
    { name: 'bg', maxCount: 6 },
    { name: 'mailLogo', maxCount: 1 },
  ]),
  settings.updateSettings
);

// Konto admina — zmiana hasła.
router.get('/account', account.showAccount);
router.post('/account/password', account.changePassword);

module.exports = router;
