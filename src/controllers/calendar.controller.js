// Kalendarz / menedżer zadań: siatka miesiąca + lista nadchodzących + CRUD przypomnień.
const calendar = require('../services/calendar.service');
const reminderService = require('../services/reminder.service');
const clientService = require('../services/client.service');
const projectService = require('../services/project.service');

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthKey = (y, m0) => `${y}-${pad2(m0 + 1)}`;

async function index(req, res, next) {
  try {
    const now = new Date();
    let y = now.getFullYear();
    let m = now.getMonth();
    const mm = /^(\d{4})-(\d{2})$/.exec(req.query.month || '');
    if (mm) { y = parseInt(mm[1], 10); m = Math.min(11, Math.max(0, parseInt(mm[2], 10) - 1)); }

    const monthStart = new Date(y, m, 1);
    const monthEnd = new Date(y, m + 1, 1);
    const events = await calendar.eventsInRange(monthStart, monthEnd);
    const byDay = {};
    events.forEach((e) => { const k = ymd(new Date(e.date)); (byDay[k] = byDay[k] || []).push(e); });

    // Siatka od poniedziałku tygodnia z 1. dniem miesiąca.
    const startOffset = (monthStart.getDay() + 6) % 7; // pn = 0
    const cur = new Date(y, m, 1 - startOffset);
    const todayKey = ymd(now);
    const weeks = [];
    for (let w = 0; w < 6; w++) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const k = ymd(cur);
        week.push({ key: k, day: cur.getDate(), inMonth: cur.getMonth() === m, isToday: k === todayKey, events: byDay[k] || [] });
        cur.setDate(cur.getDate() + 1);
      }
      weeks.push(week);
      if (cur >= monthEnd) break;
    }

    const prev = new Date(y, m - 1, 1);
    const next = new Date(y, m + 1, 1);
    res.render('admin/calendar/index', {
      title: 'Kalendarz',
      active: 'calendar',
      weeks,
      upcoming: await calendar.upcomingEvents(14),
      monthLabel: `${MONTHS[m]} ${y}`,
      prevMonth: monthKey(prev.getFullYear(), prev.getMonth()),
      nextMonth: monthKey(next.getFullYear(), next.getMonth()),
      curMonth: monthKey(y, m),
      thisMonth: monthKey(now.getFullYear(), now.getMonth()),
      clients: await clientService.options(),
      projects: await projectService.list({ status: 'active' }),
      priorities: reminderService.PRIORITIES,
    });
  } catch (err) {
    next(err);
  }
}

const back = (req) => (req.body.month ? `/admin/calendar?month=${req.body.month}` : '/admin/calendar');

async function createReminder(req, res, next) {
  try { await reminderService.create(req.body); res.redirect(back(req)); } catch (err) { next(err); }
}
async function updateReminder(req, res, next) {
  try { await reminderService.update(req.params.id, req.body); res.redirect(back(req)); } catch (err) { next(err); }
}
async function toggleReminder(req, res, next) {
  try { await reminderService.toggleDone(req.params.id); res.redirect(back(req)); } catch (err) { next(err); }
}
async function deleteReminder(req, res, next) {
  try { await reminderService.remove(req.params.id); res.redirect(back(req)); } catch (err) { next(err); }
}

module.exports = { index, createReminder, updateReminder, toggleReminder, deleteReminder };
