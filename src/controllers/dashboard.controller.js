// Pulpit — konfigurowalne widżety (Settings.panel.dashboard: kolejność + ukrywanie,
// edycja drag&drop na samym pulpicie). Dane pobieramy tylko dla widocznych widżetów;
// ukryte renderują się jako placeholder (widoczny w trybie edycji).
const prisma = require('../db/client');
const storage = require('../services/storage.service');
const events = require('../services/event.service');
const chargeService = require('../services/charge.service');
const settingsService = require('../services/settings.service');
const calendarService = require('../services/calendar.service');
const statsService = require('../services/stats.service');
const messageService = require('../services/message.service');
const panelUi = require('../utils/panelUi');

async function showDashboard(req, res, next) {
  try {
    let widgets = panelUi.mergeWidgets([]);
    try {
      const s = await settingsService.get();
      widgets = panelUi.mergeWidgets(s.panel.dashboard);
    } catch (_) { /* domyślny układ */ }
    const visible = new Set(widgets.filter((w) => !w.hidden).map((w) => w.key));

    // Liczniki liczymy odpornie: jeśli baza jest jeszcze pusta/niezmigrowana,
    // pokazujemy zera zamiast wywalać stronę.
    let stats = { transfers: 0, projects: 0, pendingUploads: 0, storageBytes: 0, outstanding: 0, overdue: 0 };
    let recent = [];
    let upcoming = [];
    let pulse = null;
    let msgThreads = [];
    try {
      const [transfers, projects, pendingUploads, outstanding, overdue, recentEvents, upcomingEvents, pulseData, threads] = await Promise.all([
        prisma.transfer.count({ where: { status: 'active' } }),
        prisma.project.count({ where: { status: 'active' } }),
        prisma.transfer.count({ where: { direction: 'incoming', status: 'active' } }),
        chargeService.totalOutstanding(),
        chargeService.overdueTotal(),
        visible.has('activity') ? events.recent(8) : [],
        visible.has('tasks') ? calendarService.upcomingEvents(14) : [],
        visible.has('revenue') ? statsService.pulse() : null,
        visible.has('messages') ? messageService.listThreads(50) : [],
      ]);
      stats = { transfers, projects, pendingUploads, storageBytes: storage.totalUsedBytes(), outstanding, overdue };
      recent = recentEvents;
      upcoming = upcomingEvents.slice(0, 7);
      pulse = pulseData;
      msgThreads = threads.filter((t) => t.unread > 0).slice(0, 5);
    } catch (_) {
      // baza nie jest jeszcze gotowa — zostają zera
    }

    res.render('admin/dashboard', {
      title: 'Pulpit',
      active: 'dashboard',
      widgets,
      hiddenMap: Object.fromEntries(widgets.map((w) => [w.key, w.hidden])),
      spansMap: Object.fromEntries(widgets.map((w) => [w.key, w.span])),
      stats,
      recent,
      upcoming,
      pulse,
      msgThreads,
    });
  } catch (err) {
    next(err);
  }
}

// Zapis układu pulpitu (fetch z trybu „Dostosuj"): body.layout = JSON [{key,hidden}].
async function saveDashboardLayout(req, res, next) {
  try {
    let layout = [];
    try { layout = JSON.parse(req.body.layout || '[]'); } catch (_) {}
    const current = await settingsService.get();
    await settingsService.update({ panel: { menu: current.panel.menu, dashboard: layout } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = { showDashboard, saveDashboardLayout };
