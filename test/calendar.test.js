// Kalendarz / przypomnienia: strona, dodaj → licznik → zrobione → usuń.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const reminderService = require('../src/services/reminder.service');
const calendarService = require('../src/services/calendar.service');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

const pad = (n) => String(n).padStart(2, '0');
async function login() {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }), redirect: 'manual' });
  return (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}

test('kalendarz: strona + dodanie/licznik/zrobione/usuń przypomnienia', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');

  const page = await fetch(`${base}/admin/calendar`, { headers: { Cookie: cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Nadchodzące/);

  const now = new Date();
  const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const dueStr = `${month}-${pad(now.getDate())}T10:00`;
  const title = 'TASK_TEST_' + Date.now();
  let id;
  try {
    const cr = await fetch(`${base}/admin/calendar/reminders`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: new URLSearchParams({ title, dueAt: dueStr, priority: 'high', month }), redirect: 'manual' });
    assert.equal(cr.status, 302);
    const r = await prisma.reminder.findFirst({ where: { title } });
    id = r && r.id;
    assert.ok(r && r.priority === 'high' && r.done === false, 'utworzone');

    assert.ok((await reminderService.dueCount()) >= 1, 'liczone w badge (termin dziś)');
    assert.match(await (await fetch(`${base}/admin/calendar?month=${month}`, { headers: { Cookie: cookie } })).text(), new RegExp(title));

    const toggle = () => fetch(`${base}/admin/calendar/reminders/${id}/toggle`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: new URLSearchParams({ month }), redirect: 'manual' });
    await toggle();
    assert.equal((await prisma.reminder.findUnique({ where: { id } })).done, true, 'oznaczone zrobione');
    assert.ok((await calendarService.recentDone(60)).some((x) => x.id === id), 'widoczne w „Zrobione"');

    await toggle(); // przywróć
    assert.equal((await prisma.reminder.findUnique({ where: { id } })).done, false, 'przywrócone (odznaczone)');

    await fetch(`${base}/admin/calendar/reminders/${id}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: new URLSearchParams({ month }), redirect: 'manual' });
    assert.equal(await prisma.reminder.findUnique({ where: { id } }), null, 'usunięte');
    id = null;
  } finally {
    if (id) await prisma.reminder.deleteMany({ where: { id } });
  }
});

test('przypomnienie: długość (durationValue/unit → durationMin) + widoki tydzień/dzień', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');
  const ids = [];
  try {
    const r1 = await reminderService.create({ title: 'DUR_min_' + Date.now(), dueAt: '2026-07-15T09:00', durationValue: '90', durationUnit: 'min' });
    const r2 = await reminderService.create({ title: 'DUR_h_' + Date.now(), dueAt: '2026-07-15T09:00', durationValue: '2', durationUnit: 'hour' });
    const r3 = await reminderService.create({ title: 'DUR_d_' + Date.now(), dueAt: '2026-07-15T09:00', durationValue: '1', durationUnit: 'day' });
    const r4 = await reminderService.create({ title: 'DUR_none_' + Date.now(), dueAt: '2026-07-15T09:00', durationValue: '', durationUnit: 'min' });
    ids.push(r1.id, r2.id, r3.id, r4.id);
    assert.equal(r1.durationMin, 90, '90 min');
    assert.equal(r2.durationMin, 120, '2 godz = 120 min');
    assert.equal(r3.durationMin, 1440, '1 dzień = 1440 min');
    assert.equal(r4.durationMin, null, 'puste = null (domyślnie 60)');
    const u = await reminderService.update(r1.id, { durationValue: '3', durationUnit: 'hour' });
    assert.equal(u.durationMin, 180, 'update długości → 180 min');

    // Widoki tydzień/dzień renderują siatkę godzin (marker openAt) i status 200.
    const wk = await fetch(`${base}/admin/calendar?view=week&date=2026-07-15`, { headers: { Cookie: cookie } });
    assert.equal(wk.status, 200, 'widok tygodnia 200');
    const dy = await fetch(`${base}/admin/calendar?view=day&date=2026-07-15`, { headers: { Cookie: cookie } });
    assert.equal(dy.status, 200, 'widok dnia 200');
    assert.match(await dy.text(), /openAt\(/, 'siatka godzin (klik → openAt) obecna');
  } finally {
    if (ids.length) await prisma.reminder.deleteMany({ where: { id: { in: ids } } });
  }
});
