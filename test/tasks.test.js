// Zadania (kanban): render + szybkie dodanie do kubełka + drag (move → termin / done).
// HTTP E2E na dev-DB; sprząta własne rekordy. Wymaga ADMIN_PASSWORD (inaczej skip).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

async function login() {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }), redirect: 'manual' });
  return (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}
const ymd = (d) => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`; };

test('zadania: render + dodanie do kubełka + move (termin/done)', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');
  const title = 'TASK_KANBAN_' + Date.now();
  let id;
  try {
    const page = await fetch(`${base}/admin/tasks`, { headers: { Cookie: cookie } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Zaległe/);
    assert.match(html, /Ten tydzień/);

    // dodanie do kubełka „Później" → termin >= dziś (należy do przyszłego tygodnia)
    const cr = await fetch(`${base}/admin/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: new URLSearchParams({ title, bucket: 'pozniej', priority: 'high' }), redirect: 'manual' });
    assert.equal(cr.status, 302, 'dodanie → redirect');
    const rem = await prisma.reminder.findFirst({ where: { title } });
    assert.ok(rem, 'zadanie utworzone');
    id = rem.id;
    assert.equal(rem.priority, 'high');
    assert.ok(new Date(rem.dueAt) > new Date(), 'kubełek „Później" = termin w przyszłości');

    // move → done
    let mv = await fetch(`${base}/admin/tasks/${id}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ bucket: 'done' }) });
    assert.equal(mv.status, 200);
    assert.equal((await mv.json()).ok, true);
    assert.equal((await prisma.reminder.findUnique({ where: { id } })).done, true, 'move→done oznacza wykonane');

    // move → dziś: odznacza done + ustawia termin na dziś
    mv = await fetch(`${base}/admin/tasks/${id}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ bucket: 'dzis' }) });
    assert.equal(mv.status, 200);
    const after = await prisma.reminder.findUnique({ where: { id } });
    assert.equal(after.done, false, 'move z done → nieukończone');
    assert.equal(ymd(after.dueAt), ymd(new Date()), 'kubełek „Dziś" = termin dzisiejszy');
  } finally {
    if (id) await prisma.reminder.deleteMany({ where: { id } });
    else await prisma.reminder.deleteMany({ where: { title } });
  }
});
