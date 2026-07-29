// Zadania/przypomnienia kalendarza (menedżer zadań). Powiązanie opcjonalne z klientem/projektem.
const prisma = require('../db/client');

const PRIORITIES = ['low', 'normal', 'high'];
const DURATION_UNITS = ['min', 'hour', 'day'];
const clean = (v) => { const s = (v == null ? '' : String(v)).trim(); return s || null; };
const normPriority = (p) => (PRIORITIES.includes(p) ? p : 'normal');
const num = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) ? n : null; };

// Długość → minuty (wartość + jednostka min/godz/dni). Puste/0 = null (domyślnie 60 min).
function parseDurationMin(value, unit) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0) return null;
  const mult = unit === 'day' ? 1440 : (unit === 'hour' ? 60 : 1);
  return Math.min(n * mult, 1440 * 30); // twardy cap 30 dni
}

function create({ title, note, dueAt, priority, clientId, projectId, durationValue, durationUnit }) {
  const t = (title || '').trim();
  if (!t || !dueAt) return null;
  return prisma.reminder.create({
    data: { title: t.slice(0, 200), note: clean(note), dueAt: new Date(dueAt), durationMin: parseDurationMin(durationValue, durationUnit), priority: normPriority(priority), clientId: num(clientId), projectId: num(projectId) },
  });
}

function update(id, { title, note, dueAt, priority, clientId, projectId, durationValue, durationUnit }) {
  const data = {};
  if (title !== undefined) data.title = ((title || '').trim().slice(0, 200)) || 'Bez tytułu';
  if (note !== undefined) data.note = clean(note);
  if (dueAt) data.dueAt = new Date(dueAt);
  if (durationValue !== undefined) data.durationMin = parseDurationMin(durationValue, durationUnit);
  if (priority !== undefined) data.priority = normPriority(priority);
  if (clientId !== undefined) data.clientId = num(clientId);
  if (projectId !== undefined) data.projectId = num(projectId);
  return prisma.reminder.update({ where: { id: Number(id) }, data });
}

async function toggleDone(id) {
  const r = await prisma.reminder.findUnique({ where: { id: Number(id) } });
  if (!r) return null;
  return prisma.reminder.update({ where: { id: r.id }, data: { done: !r.done, doneAt: r.done ? null : new Date() } });
}

function remove(id) { return prisma.reminder.deleteMany({ where: { id: Number(id) } }); }

// Przeniesienie na inny dzień (drag & drop w kalendarzu) — zachowuje godzinę.
async function moveToDay(id, day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
  if (!m) return null;
  const r = await prisma.reminder.findUnique({ where: { id: Number(id) } });
  if (!r) return null;
  const cur = new Date(r.dueAt);
  const next = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), cur.getHours(), cur.getMinutes());
  return prisma.reminder.update({ where: { id: r.id }, data: { dueAt: next } });
}
function getById(id) { return prisma.reminder.findUnique({ where: { id: Number(id) } }); }

// Przypomnienia w zakresie dat (do siatki miesiąca).
function inRange(from, to) {
  return prisma.reminder.findMany({
    where: { dueAt: { gte: from, lt: to } },
    include: { client: { select: { id: true, name: true } }, project: { select: { id: true, name: true } } },
    orderBy: { dueAt: 'asc' },
  });
}

// Licznik „do zrobienia": nieukończone z terminem do końca dziś (zaległe + dzisiejsze) — badge w menu.
function dueCount() {
  const end = new Date(); end.setHours(23, 59, 59, 999);
  return prisma.reminder.count({ where: { done: false, dueAt: { lte: end } } });
}

module.exports = { create, update, toggleDone, remove, moveToDay, getById, inRange, dueCount, PRIORITIES };
