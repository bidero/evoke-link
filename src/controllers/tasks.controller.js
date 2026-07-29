// Zadania (kanban): widok przypomnień (Reminder) w kubełkach czasowych
// Zaległe / Dziś / Ten tydzień / Później / Zrobione + drag&drop (zmiana terminu).
const prisma = require('../db/client');
const reminderService = require('../services/reminder.service');

const BUCKETS = ['zalegle', 'dzis', 'tydzien', 'pozniej'];

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d) => { const x = startOfDay(d); return addDays(x, -((x.getDay() + 6) % 7)); };

function bounds(now) {
  const todayStart = startOfDay(now);
  return { todayStart, tomorrow: addDays(todayStart, 1), weekEnd: addDays(mondayOf(now), 7) };
}
function bucketOf(dueAt, b) {
  const d = new Date(dueAt);
  if (d < b.todayStart) return 'zalegle';
  if (d < b.tomorrow) return 'dzis';
  if (d < b.weekEnd) return 'tydzien';
  return 'pozniej';
}
// Reprezentacyjny termin dla kubełka (zachowuje godzinę {h,m}).
function targetDate(bucket, keep) {
  const b = bounds(new Date());
  let base;
  if (bucket === 'zalegle') base = addDays(b.todayStart, -1);
  else if (bucket === 'dzis') base = b.todayStart;
  else if (bucket === 'tydzien') base = addDays(b.weekEnd, -1); // niedziela bieżącego tygodnia
  else base = b.weekEnd; // pozniej = poniedziałek następnego tygodnia
  const t = new Date(base);
  t.setHours(keep.h, keep.m, 0, 0);
  return t;
}

async function index(req, res, next) {
  try {
    const { open, done } = await reminderService.forTasks();
    const b = bounds(new Date());
    const cols = { zalegle: [], dzis: [], tydzien: [], pozniej: [] };
    open.forEach((r) => cols[bucketOf(r.dueAt, b)].push(r));
    res.render('admin/tasks/index', {
      title: 'Zadania', active: 'tasks',
      cols, done,
      counts: { zalegle: cols.zalegle.length, dzis: cols.dzis.length, tydzien: cols.tydzien.length, pozniej: cols.pozniej.length, done: done.length },
      priorities: reminderService.PRIORITIES,
    });
  } catch (err) {
    next(err);
  }
}

// Szybkie dodanie zadania (tytuł + kubełek + priorytet).
async function create(req, res, next) {
  try {
    const bucket = BUCKETS.includes(req.body.bucket) ? req.body.bucket : 'dzis';
    const due = targetDate(bucket, { h: 9, m: 0 });
    await reminderService.create({ title: req.body.title, dueAt: due, priority: req.body.priority });
    res.redirect('/admin/tasks');
  } catch (err) {
    next(err);
  }
}

// Drag&drop: przeniesienie do kubełka = zmiana terminu (albo „done"). JSON.
async function move(req, res, next) {
  try {
    const bucket = req.body && req.body.bucket;
    const r = await reminderService.getById(req.params.id);
    if (!r) return res.json({ ok: false });
    if (bucket === 'done') {
      if (!r.done) await prisma.reminder.update({ where: { id: r.id }, data: { done: true, doneAt: new Date() } });
      return res.json({ ok: true });
    }
    if (!BUCKETS.includes(bucket)) return res.json({ ok: false });
    const cur = new Date(r.dueAt);
    const target = targetDate(bucket, { h: cur.getHours(), m: cur.getMinutes() });
    await prisma.reminder.update({ where: { id: r.id }, data: { dueAt: target, done: false, doneAt: null } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

async function toggle(req, res, next) {
  try { await reminderService.toggleDone(req.params.id); res.redirect('/admin/tasks'); } catch (err) { next(err); }
}
async function remove(req, res, next) {
  try { await reminderService.remove(req.params.id); res.redirect('/admin/tasks'); } catch (err) { next(err); }
}

module.exports = { index, create, move, toggle, remove };
