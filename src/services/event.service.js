// Zapisywanie zdarzeń (historia + powiadomienia + dane do widżetów).
// Celowo "nie wybuchowe": błąd logowania zdarzenia nie może wywalić uploadu/pobrania.
const prisma = require('../db/client');

async function log({ type, message, projectId, transferId, meta, ip }) {
  try {
    await prisma.event.create({
      data: {
        type,
        message: message || null,
        projectId: projectId || null,
        transferId: transferId || null,
        meta: meta ? JSON.stringify(meta) : null,
        ip: ip || null,
      },
    });
  } catch (e) {
    console.error('[event] nie udało się zapisać zdarzenia:', e.message);
  }
}

// Typy zdarzeń traktowane jako POWIADOMIENIA (akcje klienta + błędy).
// 'created'/'updated' to akcje agencji — są w historii projektu, ale nie zaśmiecają powiadomień.
const NOTIFY_TYPES = ['uploaded', 'downloaded', 'error'];

// Ostatnia aktywność (do dashboardu) — wszystkie typy.
function recent(limit = 8) {
  return prisma.event.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { transfer: true, project: true },
  });
}

// Lista powiadomień (tylko typy NOTIFY_TYPES; pomijamy „usunięte" z listy).
function listNotifications(limit = 100) {
  return prisma.event.findMany({
    where: { type: { in: NOTIFY_TYPES }, dismissed: false },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { transfer: true, project: true },
  });
}

// Liczba nieprzeczytanych powiadomień (do dzwonka w nagłówku).
function unreadCount() {
  return prisma.event.count({ where: { type: { in: NOTIFY_TYPES }, isRead: false, dismissed: false } });
}

function findById(id) {
  return prisma.event.findUnique({ where: { id: Number(id) } });
}

async function markRead(id) {
  try {
    await prisma.event.update({ where: { id: Number(id) }, data: { isRead: true } });
  } catch (_) {
    /* ignorujemy */
  }
}

function markAllRead() {
  return prisma.event.updateMany({ where: { type: { in: NOTIFY_TYPES }, isRead: false }, data: { isRead: true } });
}

// „Usuwa" pojedyncze powiadomienie z listy (miękko — zdarzenie zostaje w historii projektu).
// updateMany zamiast update: nie rzuca, gdy id nie istnieje.
function dismiss(id) {
  return prisma.event.updateMany({ where: { id: Number(id) }, data: { dismissed: true } });
}

// Czyści całą listę powiadomień (historia projektu pozostaje).
function dismissAll() {
  return prisma.event.updateMany({ where: { type: { in: NOTIFY_TYPES }, dismissed: false }, data: { dismissed: true } });
}

// Oznacza powiadomienia jednego projektu jako przeczytane (po wejściu w projekt).
function markProjectRead(projectId) {
  return prisma.event.updateMany({
    where: { projectId: Number(projectId), type: { in: NOTIFY_TYPES }, isRead: false },
    data: { isRead: true },
  });
}

module.exports = { log, recent, listNotifications, unreadCount, findById, markRead, markAllRead, markProjectRead, dismiss, dismissAll, NOTIFY_TYPES };

