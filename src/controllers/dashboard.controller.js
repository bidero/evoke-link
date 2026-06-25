// Dashboard. W Etapie 0 pokazuje puste widżety (zera) — realne liczby
// podłączymy w Etapie 4, gdy będą już transfery, projekty i zdarzenia.
const prisma = require('../db/client');
const storage = require('../services/storage.service');
const events = require('../services/event.service');

async function showDashboard(req, res, next) {
  try {
    // Liczniki liczymy odpornie: jeśli baza jest jeszcze pusta/niezmigrowana,
    // pokazujemy zera zamiast wywalać stronę.
    let stats = { transfers: 0, projects: 0, pendingUploads: 0, storageBytes: 0 };
    let recent = [];
    try {
      const [transfers, projects, pendingUploads, recentEvents] = await Promise.all([
        prisma.transfer.count({ where: { status: 'active' } }),
        prisma.project.count({ where: { status: 'active' } }),
        prisma.transfer.count({ where: { direction: 'incoming', status: 'active' } }),
        events.recent(8),
      ]);
      stats = { transfers, projects, pendingUploads, storageBytes: storage.totalUsedBytes() };
      recent = recentEvents;
    } catch (_) {
      // baza nie jest jeszcze gotowa — zostają zera
    }

    res.render('admin/dashboard', {
      title: 'Pulpit',
      active: 'dashboard',
      stats,
      recent,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { showDashboard };
