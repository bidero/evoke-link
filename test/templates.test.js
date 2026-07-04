// Szablony projektów (parsowanie + rozstawienie na projekcie) i interakcje 360° (typ + follow-up).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const templateService = require('../src/services/template.service');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

async function login() {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }), redirect: 'manual' });
  return (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}

test('szablony: parsowanie definicji i rozstawienie braków + przypomnień na projekcie', async () => {
  let tpl, project;
  try {
    // walidacja + parsowanie linii (etykieta | notatka; tytuł | +dni | priorytet)
    assert.equal(await templateService.create({ name: '  ' }), null, 'bez nazwy nie tworzymy');
    tpl = await templateService.create({
      name: 'Strona www',
      description: 'projekt z CMS',
      fileRequestsText: 'Logo w wektorze | AI lub SVG\nTeksty na stronę\n\n   \nZdjęcia | min. 20 szt.',
      remindersText: 'Wysłać brief | +1\nPierwsza wersja | 7 | high\nFollow-up po wdrożeniu | +30 | zły-priorytet\nBez dni',
    });
    const items = templateService.itemsOf(tpl);
    assert.equal(items.fileRequests.length, 3, 'puste linie pomijane');
    assert.deepEqual(items.fileRequests[0], { label: 'Logo w wektorze', note: 'AI lub SVG' });
    assert.deepEqual(items.fileRequests[1], { label: 'Teksty na stronę' });
    assert.equal(items.reminders.length, 4);
    assert.deepEqual(items.reminders[0], { title: 'Wysłać brief', offsetDays: 1, priority: 'normal' });
    assert.deepEqual(items.reminders[1], { title: 'Pierwsza wersja', offsetDays: 7, priority: 'high' });
    assert.equal(items.reminders[2].priority, 'normal', 'nieznany priorytet → normal');
    assert.equal(items.reminders[3].offsetDays, 1, 'brak dni → +1');

    // rozstawienie na projekcie: FileRequests + Remindery z przesuniętym terminem
    project = await prisma.project.create({ data: { name: 'TplProj', clientToken: 'tpl_' + Date.now() } });
    const applied = await templateService.applyToProject(tpl.id, project, new Date(2026, 6, 1));
    assert.deepEqual(applied, { fileRequests: 3, reminders: 4 });
    assert.equal(await prisma.fileRequest.count({ where: { projectId: project.id } }), 3);
    const rems = await prisma.reminder.findMany({ where: { projectId: project.id }, orderBy: { dueAt: 'asc' } });
    assert.equal(rems.length, 4);
    assert.equal(new Date(rems[0].dueAt).getDate(), 2, '+1 dzień od 1 lipca');
    assert.equal(rems.find((r) => r.title === 'Pierwsza wersja').priority, 'high');
    assert.equal(new Date(rems.find((r) => r.title === 'Follow-up po wdrożeniu').dueAt).getDate(), 31, '+30 dni');

    // nieistniejący szablon = nic nie robi
    assert.deepEqual(await templateService.applyToProject(999999, project), { fileRequests: 0, reminders: 0 });
  } finally {
    if (project) {
      await prisma.reminder.deleteMany({ where: { projectId: project.id } });
      await prisma.fileRequest.deleteMany({ where: { projectId: project.id } });
      await prisma.event.deleteMany({ where: { projectId: project.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
    if (tpl) await prisma.projectTemplate.delete({ where: { id: tpl.id } });
  }
});

test('interakcje 360°: typ w prefiksie + follow-up tworzy przypomnienie', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');
  const cl = await prisma.client.create({ data: { name: 'IntTest', token: 'int_' + Date.now() } });
  try {
    const post = (fields) => fetch(`${base}/admin/clients/${cl.id}/note`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams(fields), redirect: 'manual',
    });

    // telefon z follow-upem za 3 dni
    await post({ kind: 'call', note: 'Rozmowa o nowej stronie', followupDays: '3' });
    const ev = await prisma.event.findFirst({ where: { clientId: cl.id, type: 'note' }, orderBy: { id: 'desc' } });
    assert.equal(ev.message, 'Telefon: Rozmowa o nowej stronie');
    assert.match(ev.meta || '', /"kind":"call"/);
    const rem = await prisma.reminder.findFirst({ where: { clientId: cl.id } });
    assert.ok(rem && rem.title === `Follow-up: ${cl.name}`, 'przypomnienie follow-up utworzone');
    const days = Math.round((new Date(rem.dueAt) - Date.now()) / 86400000);
    assert.ok(days >= 2 && days <= 3, 'termin ~3 dni');

    // zwykła notatka bez follow-upu i bez prefiksu
    await post({ kind: 'note', note: 'Sama notatka' });
    const ev2 = await prisma.event.findFirst({ where: { clientId: cl.id, type: 'note', message: 'Sama notatka' } });
    assert.ok(ev2, 'notatka bez prefiksu');
    assert.equal(await prisma.reminder.count({ where: { clientId: cl.id } }), 1, 'bez dodatkowego przypomnienia');

    // nieznany typ → traktowany jak notatka
    await post({ kind: 'hack', note: 'Dziwny typ' });
    const ev3 = await prisma.event.findFirst({ where: { clientId: cl.id, message: 'Dziwny typ' } });
    assert.ok(ev3, 'nieznany kind nie wywala i nie prefiksuje');
  } finally {
    await prisma.reminder.deleteMany({ where: { clientId: cl.id } });
    await prisma.event.deleteMany({ where: { clientId: cl.id } });
    await prisma.client.delete({ where: { id: cl.id } });
  }
});
