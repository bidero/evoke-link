// Kalendarz / menedżer zadań: siatka miesiąca + lista nadchodzących + CRUD przypomnień.
const calendar = require('../services/calendar.service');
const reminderService = require('../services/reminder.service');
const clientService = require('../services/client.service');
const projectService = require('../services/project.service');

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const DOW = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
const DOW_FULL = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthKey = (y, m0) => `${y}-${pad2(m0 + 1)}`;
const dow0 = (d) => (d.getDay() + 6) % 7; // pn = 0
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function weekLabel(mon, sun) {
  if (mon.getMonth() === sun.getMonth()) return `${mon.getDate()}–${sun.getDate()} ${MONTHS_GEN[mon.getMonth()]} ${mon.getFullYear()}`;
  return `${mon.getDate()} ${MONTHS_GEN[mon.getMonth()]} – ${sun.getDate()} ${MONTHS_GEN[sun.getMonth()]} ${sun.getFullYear()}`;
}
const dayLabel = (d) => `${DOW_FULL[dow0(d)]}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;

async function index(req, res, next) {
  try {
    const now = new Date();
    const todayKey = ymd(now);
    const view = ['month', 'week', 'day'].includes(req.query.view) ? req.query.view : 'month';
    // Data referencyjna dla week/day (?date=YYYY-MM-DD albo dziś).
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(req.query.date || '');
    const refDate = dm ? new Date(parseInt(dm[1], 10), parseInt(dm[2], 10) - 1, parseInt(dm[3], 10)) : new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let rangeStart, rangeEnd, weeks = null, days = null, label, prevLink, nextLink, todayLink, viewDate, curMonth, isToday;

    if (view === 'month') {
      let y = now.getFullYear(), m = now.getMonth();
      const mm = /^(\d{4})-(\d{2})$/.exec(req.query.month || '');
      if (mm) { y = parseInt(mm[1], 10); m = Math.min(11, Math.max(0, parseInt(mm[2], 10) - 1)); }
      rangeStart = new Date(y, m, 1); rangeEnd = new Date(y, m + 1, 1);
      label = `${MONTHS[m]} ${y}`;
      const prev = new Date(y, m - 1, 1), next = new Date(y, m + 1, 1);
      prevLink = `/admin/calendar?month=${monthKey(prev.getFullYear(), prev.getMonth())}`;
      nextLink = `/admin/calendar?month=${monthKey(next.getFullYear(), next.getMonth())}`;
      todayLink = '/admin/calendar';
      curMonth = monthKey(y, m);
      isToday = (y === now.getFullYear() && m === now.getMonth());
      viewDate = isToday ? todayKey : ymd(rangeStart);
    } else if (view === 'week') {
      const mon = addDays(refDate, -dow0(refDate));
      rangeStart = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate());
      rangeEnd = addDays(rangeStart, 7);
      label = weekLabel(rangeStart, addDays(rangeStart, 6));
      prevLink = `/admin/calendar?view=week&date=${ymd(addDays(rangeStart, -7))}`;
      nextLink = `/admin/calendar?view=week&date=${ymd(addDays(rangeStart, 7))}`;
      todayLink = `/admin/calendar?view=week&date=${todayKey}`;
      curMonth = monthKey(rangeStart.getFullYear(), rangeStart.getMonth());
      viewDate = ymd(refDate);
      isToday = now >= rangeStart && now < rangeEnd;
    } else { // day
      rangeStart = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
      rangeEnd = addDays(rangeStart, 1);
      label = dayLabel(rangeStart);
      prevLink = `/admin/calendar?view=day&date=${ymd(addDays(rangeStart, -1))}`;
      nextLink = `/admin/calendar?view=day&date=${ymd(addDays(rangeStart, 1))}`;
      todayLink = `/admin/calendar?view=day&date=${todayKey}`;
      curMonth = monthKey(rangeStart.getFullYear(), rangeStart.getMonth());
      viewDate = ymd(rangeStart);
      isToday = ymd(rangeStart) === todayKey;
    }

    const events = await calendar.eventsInRange(rangeStart, rangeEnd);
    const byDay = {};
    events.forEach((e) => { const k = ymd(new Date(e.date)); (byDay[k] = byDay[k] || []).push(e); });

    if (view === 'month') {
      const startOffset = dow0(rangeStart);
      const cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1 - startOffset);
      weeks = [];
      for (let w = 0; w < 6; w++) {
        const week = [];
        for (let d = 0; d < 7; d++) {
          const k = ymd(cur);
          week.push({ key: k, day: cur.getDate(), inMonth: cur.getMonth() === rangeStart.getMonth(), isToday: k === todayKey, events: byDay[k] || [] });
          cur.setDate(cur.getDate() + 1);
        }
        weeks.push(week);
        if (cur >= rangeEnd) break;
      }
    } else if (view === 'week') {
      days = [];
      for (let i = 0; i < 7; i++) {
        const cur = addDays(rangeStart, i);
        const k = ymd(cur);
        days.push({ key: k, day: cur.getDate(), isToday: k === todayKey, dowLabel: DOW[dow0(cur)], dateLabel: `${cur.getDate()}.${pad2(cur.getMonth() + 1)}`, events: byDay[k] || [] });
      }
    } else {
      const k = ymd(rangeStart);
      const evs = (byDay[k] || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
      days = [{ key: k, day: rangeStart.getDate(), isToday: k === todayKey, dowLabel: DOW_FULL[dow0(rangeStart)], dateLabel: label, events: evs }];
    }

    res.render('admin/calendar/index', {
      title: 'Kalendarz',
      active: 'calendar',
      view, weeks, days, label,
      upcoming: await calendar.upcomingEvents(14),
      doneReminders: await calendar.recentDone(40),
      prevLink, nextLink, todayLink, viewDate, isToday,
      curMonth,
      thisMonth: monthKey(now.getFullYear(), now.getMonth()),
      clients: await clientService.options(),
      projects: await projectService.list({ status: 'active' }),
      priorities: reminderService.PRIORITIES,
    });
  } catch (err) {
    next(err);
  }
}

// Powrót po zapisie: zachowaj bieżący widok (miesiąc/tydzień/dzień).
const back = (req) => {
  const v = req.body.view;
  if (v === 'week' && req.body.date) return `/admin/calendar?view=week&date=${req.body.date}`;
  if (v === 'day' && req.body.date) return `/admin/calendar?view=day&date=${req.body.date}`;
  return req.body.month ? `/admin/calendar?month=${req.body.month}` : '/admin/calendar';
};

async function createReminder(req, res, next) {
  try { await reminderService.create(req.body); res.redirect(back(req)); } catch (err) { next(err); }
}
async function updateReminder(req, res, next) {
  try { await reminderService.update(req.params.id, req.body); res.redirect(back(req)); } catch (err) { next(err); }
}
// Drag & drop: przeniesienie przypomnienia na inny dzień (fetch JSON).
async function moveReminder(req, res, next) {
  try {
    const updated = await reminderService.moveToDay(req.params.id, (req.body && req.body.day) || '');
    res.json({ ok: !!updated });
  } catch (err) {
    next(err);
  }
}

async function toggleReminder(req, res, next) {
  try { await reminderService.toggleDone(req.params.id); res.redirect(back(req)); } catch (err) { next(err); }
}
async function deleteReminder(req, res, next) {
  try { await reminderService.remove(req.params.id); res.redirect(back(req)); } catch (err) { next(err); }
}

module.exports = { index, createReminder, updateReminder, toggleReminder, moveReminder, deleteReminder };
