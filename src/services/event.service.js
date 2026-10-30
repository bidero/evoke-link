// Zapisywanie zdarzeń (historia + powiadomienia + dane do widżetów).
// Celowo "nie wybuchowe": błąd logowania zdarzenia nie może wywalić uploadu/pobrania.
const prisma = require('../db/client');

async function log({ type, message, projectId, transferId, clientId, meta, ip }) {
  try {
    // Powiązanie z klientem (oś czasu): jawne clientId lub doczytane z projektu.
    let cid = clientId || null;
    // Transfer przypisany wprost do klienta (bez projektu) — klient z transferu.
    if (!cid && transferId) {
      try {
        const t = await prisma.transfer.findUnique({ where: { id: Number(transferId) }, select: { clientId: true } });
        cid = t ? t.clientId : null;
      } catch (_) { /* brak transferu — trudno */ }
    }
    if (!cid && projectId) {
      try {
        const p = await prisma.project.findUnique({ where: { id: Number(projectId) }, select: { clientId: true } });
        cid = p ? p.clientId : null;
      } catch (_) { /* brak projektu — trudno */ }
    }
    await prisma.event.create({
      data: {
        type,
        message: message || null,
        projectId: projectId || null,
        transferId: transferId || null,
        clientId: cid,
        meta: meta ? JSON.stringify(meta) : null,
        ip: ip || null,
      },
    });
    // Powiadomienie push (aplikacja może być ZAMKNIĘTA) — tylko typy, które i tak dzwonią.
    // Świadomie bez `await`: zdarzenie ma być zapisane niezależnie od tego, czy push wyszedł.
    if (NOTIFY_TYPES.includes(type)) {
      require('./push.service')
        .notifyEvent({ type, message, url: '/admin/notifications' })
        .catch(() => {});
    }
  } catch (e) {
    console.error('[event] nie udało się zapisać zdarzenia:', e.message);
  }
}

// Zdarzenie „wysłano e-mail" w JEDNYM, spójnym formacie: „Rodzaj → adresat · „temat"".
// Wcześniej każde miejsce budowało własne zdanie i część wpisów gubiła adresata albo temat.
// `info` to wynik z mail.service — niesie realny `subject`, więc w historii ląduje ten temat,
// który dostał klient (także z szablonu w Ustawieniach → E-mail). `extra` to opcjonalny
// dopisek w nawiasie (np. liczba pozycji i kwota). Komplet trafia też do `meta`.
function emailSent({ kind, to, info, extra, projectId, transferId, clientId, ip }) {
  const subject = (info && info.subject) || '';
  const addr = to || (info && info.to) || '';
  let message = kind || 'E-mail';
  if (addr) message += ` → ${addr}`;
  if (subject) message += ` · „${subject}"`;
  if (extra) message += ` (${extra})`;
  return log({
    type: 'email_sent', message, projectId, transferId, clientId, ip,
    meta: { kind: kind || null, to: addr || null, subject: subject || null },
  });
}

// Typy zdarzeń traktowane jako POWIADOMIENIA (akcje klienta + błędy).
// 'created'/'updated' to akcje agencji — są w historii projektu, ale nie zaśmiecają powiadomień.
const NOTIFY_TYPES = ['uploaded', 'downloaded', 'error', 'approved', 'changes', 'onboarded', 'paid_declared', 'offer_accepted', 'offer_rejected', 'update'];

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

// Filtry zakładki „Cała aktywność" (strona Powiadomienia). Klucz → lista typów zdarzeń.
// Pełna historia: także akcje agencji i wysłane e-maile, których lista powiadomień nie pokazuje.
const ACTIVITY_FILTERS = {
  all: { label: 'Wszystko', types: null },
  email: { label: 'Wysłane e-maile', types: ['email_sent'] },
  client: { label: 'Akcje klientów', types: ['uploaded', 'downloaded', 'viewed', 'approved', 'changes', 'onboarded', 'paid_declared', 'offer_accepted', 'offer_rejected'] },
  agency: { label: 'Akcje agencji', types: ['created', 'updated', 'note', 'expired'] },
  error: { label: 'Błędy', types: ['error'] },
};
const ACTIVITY_PAGE = 50;

// Pełna historia zdarzeń z filtrem, wyszukiwaniem (w treści — czyli też po adresie e-mail
// i temacie wysłanej wiadomości) i stronicowaniem. Zwraca { items, total, page, pages }.
async function activity({ filter = 'all', q = '', page = 1 } = {}) {
  const f = ACTIVITY_FILTERS[filter] || ACTIVITY_FILTERS.all;
  const where = {};
  if (f.types) where.type = { in: f.types };
  const s = String(q || '').trim().slice(0, 200);
  if (s) {
    where.OR = [
      { message: { contains: s } },
      { project: { name: { contains: s } } },
      { client: { name: { contains: s } } },
      { transfer: { title: { contains: s } } },
    ];
  }
  const total = await prisma.event.count({ where });
  const pages = Math.max(1, Math.ceil(total / ACTIVITY_PAGE));
  const p = Math.min(pages, Math.max(1, parseInt(page, 10) || 1));
  const items = await prisma.event.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: (p - 1) * ACTIVITY_PAGE,
    take: ACTIVITY_PAGE,
    include: {
      transfer: { select: { id: true, title: true, token: true, direction: true } },
      project: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
    },
  });
  return { items, total, page: p, pages };
}

// Wysyłki e-mail powiązane z transferami (najnowsze pierwsze) — do kolumny „wysłano" na liście.
function lastEmailsForTransfers(ids) {
  return prisma.event.findMany({
    where: { type: 'email_sent', transferId: { in: ids.map(Number) } },
    orderBy: { createdAt: 'desc' },
    select: { transferId: true, createdAt: true, meta: true },
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

module.exports = { ACTIVITY_FILTERS, activity, lastEmailsForTransfers, log, emailSent, recent, listNotifications, unreadCount, findById, markRead, markAllRead, markProjectRead, dismiss, dismissAll, NOTIFY_TYPES };

