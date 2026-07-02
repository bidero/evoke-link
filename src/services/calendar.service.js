// Agregacja wydarzeń kalendarza: przypomnienia + terminy płatności (Charge.dueDate)
// + wygasanie transferów (Transfer.expiresAt). Jeden ujednolicony kształt wydarzenia.
const prisma = require('../db/client');
const reminderService = require('./reminder.service');
const { grossOf } = require('./charge.service'); // kwoty BRUTTO (amount = netto)
const fmt = require('../utils/format');

function mapReminder(r) {
  return {
    kind: 'reminder', id: r.id, date: r.dueAt, title: r.title, note: r.note, done: r.done, priority: r.priority,
    clientId: r.clientId, projectId: r.projectId,
    href: r.projectId ? `/admin/projects/${r.projectId}` : (r.clientId ? `/admin/clients/${r.clientId}` : null),
    sub: r.project ? r.project.name : (r.client ? r.client.name : null),
  };
}
function mapCharge(c) {
  const cid = c.clientId || (c.project && c.project.clientId) || null;
  return {
    kind: 'charge', id: c.id, date: c.dueDate, title: `${c.label || 'Płatność'} · ${fmt.money(grossOf(c))}`, done: !!c.paidAt,
    href: cid ? `/admin/clients/${cid}?tab=rozliczenia` : (c.projectId ? `/admin/projects/${c.projectId}` : null),
    sub: c.project ? c.project.name : null,
  };
}
function mapTransfer(t) {
  return {
    kind: 'transfer', id: t.id, date: t.expiresAt, title: `Wygasa: ${t.title || ('Transfer ' + t.token)}`, done: false,
    href: `/admin/transfers/${t.id}`, sub: t.project ? t.project.name : null,
  };
}

// Wydarzenia w zakresie [from, to) — do siatki miesiąca.
async function eventsInRange(from, to) {
  const [reminders, charges, transfers] = await Promise.all([
    reminderService.inRange(from, to),
    prisma.charge.findMany({ where: { dueDate: { gte: from, lt: to } }, include: { project: { select: { id: true, name: true, clientId: true } } } }),
    prisma.transfer.findMany({ where: { direction: 'outgoing', status: { not: 'deleted' }, expiresAt: { gte: from, lt: to } }, include: { project: { select: { id: true, name: true } } } }),
  ]);
  const ev = [...reminders.map(mapReminder), ...charges.map(mapCharge), ...transfers.map(mapTransfer)];
  ev.sort((a, b) => new Date(a.date) - new Date(b.date));
  return ev;
}

// „Nadchodzące" — zaległe i nadchodzące do `days` dni; tylko aktywne (nieukończone/nieopłacone).
async function upcomingEvents(days = 14) {
  const now = new Date();
  const to = new Date(now.getTime() + days * 86400000);
  const [reminders, charges, transfers] = await Promise.all([
    prisma.reminder.findMany({ where: { done: false, dueAt: { lt: to } }, include: { client: { select: { id: true, name: true } }, project: { select: { id: true, name: true } } }, orderBy: { dueAt: 'asc' }, take: 60 }),
    prisma.charge.findMany({ where: { paidAt: null, dueDate: { lt: to } }, include: { project: { select: { id: true, name: true, clientId: true } } }, orderBy: { dueDate: 'asc' }, take: 60 }),
    prisma.transfer.findMany({ where: { direction: 'outgoing', status: 'active', expiresAt: { gte: now, lt: to } }, include: { project: { select: { id: true, name: true } } }, orderBy: { expiresAt: 'asc' }, take: 60 }),
  ]);
  const ev = [...reminders.map(mapReminder), ...charges.map(mapCharge), ...transfers.map(mapTransfer)];
  ev.forEach((e) => { e.overdue = !e.done && new Date(e.date) < now; });
  ev.sort((a, b) => new Date(a.date) - new Date(b.date));
  return ev;
}

// Ostatnio wykonane przypomnienia (do sekcji „Zrobione" — przywracanie/usuwanie).
async function recentDone(limit = 40) {
  const rs = await prisma.reminder.findMany({
    where: { done: true },
    include: { client: { select: { id: true, name: true } }, project: { select: { id: true, name: true } } },
    orderBy: [{ doneAt: 'desc' }, { dueAt: 'desc' }],
    take: limit,
  });
  return rs.map(mapReminder);
}

module.exports = { eventsInRange, upcomingEvents, recentDone };
