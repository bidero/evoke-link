// Panel: powiadomienia (zdarzenia: nowe pliki od klienta, pobrania, błędy).
const events = require('../services/event.service');
const messageService = require('../services/message.service');
const reminderService = require('../services/reminder.service');

// Aktualne liczniki dla otwartej karty panelu (dzwonek, badge menu, licznik na ikonie PWA).
// Bez tego liczby są prawdziwe tylko w chwili wczytania strony — kto siedzi na jednym
// ekranie, nie zobaczyłby nowej wiadomości aż do przeładowania.
async function badgeCounts(req, res, next) {
  try {
    const [notifications, messages, calendar] = await Promise.all([
      events.unreadCount(), messageService.unreadCount(), reminderService.dueCount(),
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({ notifications, messages, calendar });
  } catch (err) {
    next(err);
  }
}

async function index(req, res, next) {
  try {
    const notifications = await events.listNotifications();
    res.render('admin/notifications', { title: 'Powiadomienia', active: 'notifications', notifications });
  } catch (err) {
    next(err);
  }
}

// Oznacza wszystkie jako przeczytane.
async function readAll(req, res, next) {
  try {
    await events.markAllRead();
    res.redirect('/admin/notifications');
  } catch (err) {
    next(err);
  }
}

// Otwiera powiadomienie: oznacza jako przeczytane i przenosi do powiązanego
// transferu (a jeśli go brak — do projektu, inaczej z powrotem na listę).
async function open(req, res, next) {
  try {
    await events.markRead(req.params.id);
    const ev = await events.findById(req.params.id);
    if (ev && ev.type === 'update') return res.redirect('/admin/settings?tab=advanced'); // sekcja „Aktualizacje"
    if (ev && ev.transferId) return res.redirect(`/admin/transfers/${ev.transferId}`);
    if (ev && ev.projectId) return res.redirect(`/admin/projects/${ev.projectId}`);
    if (ev && ev.clientId) return res.redirect(`/admin/clients/${ev.clientId}`);
    res.redirect('/admin/notifications');
  } catch (err) {
    next(err);
  }
}

// „Usuwa" pojedyncze powiadomienie z listy (miękko — zostaje w historii projektu).
async function dismiss(req, res, next) {
  try {
    await events.dismiss(req.params.id);
    res.redirect('/admin/notifications');
  } catch (err) {
    next(err);
  }
}

// Czyści całą listę powiadomień.
async function clearAll(req, res, next) {
  try {
    await events.dismissAll();
    res.redirect('/admin/notifications');
  } catch (err) {
    next(err);
  }
}

module.exports = { index, readAll, open, dismiss, clearAll, badgeCounts };
