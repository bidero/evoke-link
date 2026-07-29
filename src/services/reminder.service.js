// Zadania/przypomnienia kalendarza (menedżer zadań). Powiązanie opcjonalne z klientem/projektem.
const crypto = require('crypto');
const prisma = require('../db/client');

const PRIORITIES = ['low', 'normal', 'high'];
const DURATION_UNITS = ['min', 'hour', 'day'];
const COLORS = ['sky', 'emerald', 'amber', 'rose', 'violet', 'slate']; // presety; null = wg priorytetu
const normColor = (c) => (COLORS.includes(c) ? c : null);
const REPEATS = ['daily', 'weekly', 'monthly'];
const MAX_OCCURRENCES = 200; // twardy limit materializacji serii

function nextOccurrence(d, repeat) {
  const x = new Date(d);
  if (repeat === 'daily') x.setDate(x.getDate() + 1);
  else if (repeat === 'weekly') x.setDate(x.getDate() + 7);
  else if (repeat === 'monthly') x.setMonth(x.getMonth() + 1);
  return x;
}
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

// Długość z godziny ZAKOŃCZENIA: (koniec − start) w minutach. Puste/≤start = null (domyślnie 60).
function durationFromEnd(dueAt, endAt) {
  if (!endAt || !dueAt) return null;
  const s = new Date(dueAt).getTime(), e = new Date(endAt).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
  return Math.min(Math.round((e - s) / 60000), 1440 * 30);
}
// Długość z formularza: preferuj `endAt` (nowy modal); wstecznie `durationValue`/`durationUnit`.
function durationFromForm(dueAt, { endAt, durationValue, durationUnit }) {
  if (endAt !== undefined) return durationFromEnd(dueAt, endAt);
  return parseDurationMin(durationValue, durationUnit);
}

async function create({ title, note, dueAt, priority, clientId, projectId, durationValue, durationUnit, endAt, color, repeat, repeatUntil }) {
  const t = (title || '').trim();
  if (!t || !dueAt) return null;
  const base = {
    title: t.slice(0, 200), note: clean(note), durationMin: durationFromForm(dueAt, { endAt, durationValue, durationUnit }),
    color: normColor(color), priority: normPriority(priority), clientId: num(clientId), projectId: num(projectId),
  };
  const rep = REPEATS.includes(repeat) ? repeat : null;
  if (!rep) return prisma.reminder.create({ data: { ...base, dueAt: new Date(dueAt) } });

  // Seria cykliczna: materializuj powtórzenia (wspólny seriesId) do repeatUntil
  // albo domyślnie 6 miesięcy; twardy limit MAX_OCCURRENCES.
  const seriesId = crypto.randomBytes(8).toString('hex');
  const start = new Date(dueAt);
  const until = repeatUntil ? new Date(repeatUntil + 'T23:59') : (() => { const h = new Date(start); h.setMonth(h.getMonth() + 6); return h; })();
  const rows = [];
  let cur = new Date(start);
  for (let i = 0; i < MAX_OCCURRENCES && cur <= until; i++) {
    rows.push({ ...base, dueAt: new Date(cur), repeat: rep, repeatUntil: repeatUntil ? new Date(repeatUntil + 'T23:59') : null, seriesId });
    cur = nextOccurrence(cur, rep);
  }
  await prisma.$transaction(rows.map((data) => prisma.reminder.create({ data })));
  return { seriesId, count: rows.length };
}

function update(id, { title, note, dueAt, priority, clientId, projectId, durationValue, durationUnit, endAt, color }) {
  const data = {};
  if (title !== undefined) data.title = ((title || '').trim().slice(0, 200)) || 'Bez tytułu';
  if (note !== undefined) data.note = clean(note);
  if (dueAt) data.dueAt = new Date(dueAt);
  if (endAt !== undefined) data.durationMin = durationFromEnd(dueAt, endAt);
  else if (durationValue !== undefined) data.durationMin = parseDurationMin(durationValue, durationUnit);
  if (color !== undefined) data.color = normColor(color);
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

// Usuń całą serię powtórzeń (wszystkie z tym samym seriesId). Gdy brak serii — sam wpis.
async function removeSeries(id) {
  const r = await prisma.reminder.findUnique({ where: { id: Number(id) }, select: { seriesId: true } });
  if (r && r.seriesId) return prisma.reminder.deleteMany({ where: { seriesId: r.seriesId } });
  return remove(id);
}

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

// Zadania (kanban): otwarte (wszystkie, do bucketowania) + ostatnio zrobione.
async function forTasks() {
  const inc = { client: { select: { id: true, name: true } }, project: { select: { id: true, name: true } } };
  const [open, done] = await Promise.all([
    prisma.reminder.findMany({ where: { done: false }, orderBy: { dueAt: 'asc' }, take: 300, include: inc }),
    prisma.reminder.findMany({ where: { done: true }, orderBy: [{ doneAt: 'desc' }, { dueAt: 'desc' }], take: 40, include: inc }),
  ]);
  return { open, done };
}

// Przełożenie na konkretny termin (data + godzina) — drag na siatce godzin (tydzień/dzień).
function reschedule(id, dueAt) {
  const d = new Date(dueAt);
  if (isNaN(d.getTime())) return Promise.resolve(null);
  return prisma.reminder.update({ where: { id: Number(id) }, data: { dueAt: d } });
}

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

module.exports = { create, update, toggleDone, remove, removeSeries, moveToDay, reschedule, getById, forTasks, inRange, dueCount, PRIORITIES, REPEATS, COLORS };
