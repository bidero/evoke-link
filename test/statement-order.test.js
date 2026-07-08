// Kolejność pozycji na rozliczeniu (PDF/CSV): chronologiczna. Blok projektu z NAJSTARSZĄ
// pozycją na górze; wewnątrz projektu od najstarszej do najnowszej; pozycja bez daty
// używa createdAt zamiast skakać na górę (regresja sortowania SQL, gdzie NULL był pierwszy).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config'); // wczytuje .env (DATABASE_URL) przez dotenv
const prisma = require('../src/db/client');
const chargeService = require('../src/services/charge.service');

let client, projOld, projNew;
before(async () => {
  client = await prisma.client.create({ data: { name: 'STMT order', token: 'stord_' + Date.now() } });
  // „Beta" jest alfabetycznie po „Alfa", ale ma STARSZĄ czynność → musi być wyżej.
  projNew = await prisma.project.create({ data: { name: 'Alfa (nowszy)', clientId: client.id, clientToken: 'sa_' + Date.now() } });
  projOld = await prisma.project.create({ data: { name: 'Beta (starszy)', clientId: client.id, clientToken: 'sb_' + Date.now() } });
});
after(async () => {
  await prisma.charge.deleteMany({ where: { clientId: client.id } });
  await prisma.charge.deleteMany({ where: { project: { clientId: client.id } } });
  await prisma.project.deleteMany({ where: { clientId: client.id } });
  await prisma.client.delete({ where: { id: client.id } });
  await prisma.$disconnect();
});

const d = (s) => new Date(s + 'T12:00:00');

test('bloki projektów wg najstarszej pozycji; w projekcie od najstarszej', async () => {
  // Beta: styczeń + marzec. Alfa: luty. Chronologicznie: Beta(sty), Beta(mar) potem Alfa(lut)?
  // NIE — grupujemy po projekcie, więc: cała Beta (min=styczeń) przed całą Alfa (min=luty).
  await prisma.charge.create({ data: { projectId: projOld.id, label: 'Beta marzec', amount: 300, date: d('2026-03-01') } });
  await prisma.charge.create({ data: { projectId: projOld.id, label: 'Beta styczeń', amount: 100, date: d('2026-01-01') } });
  await prisma.charge.create({ data: { projectId: projNew.id, label: 'Alfa luty', amount: 200, date: d('2026-02-01') } });

  const rows = await chargeService.forStatement(client.id);
  const labels = rows.map((c) => c.label);
  assert.deepEqual(labels, ['Beta styczeń', 'Beta marzec', 'Alfa luty'],
    'Beta (najstarsza pozycja) przed Alfa; w Becie od najstarszej');
});

test('pozycja bez daty używa createdAt, nie skacze na górę grupy', async () => {
  await prisma.charge.deleteMany({ where: { OR: [{ clientId: client.id }, { project: { clientId: client.id } }] } });
  const early = await prisma.charge.create({ data: { clientId: client.id, label: 'Z datą (styczeń)', amount: 100, date: d('2026-01-01') } });
  // createdAt starszy od „stycznia" NIE — chcemy, by pozycja bez daty trafiła wg createdAt (teraz),
  // czyli PO styczniowej. Ustawiamy createdAt tej bez-daty na późniejszy niż styczeń.
  await prisma.charge.create({ data: { clientId: client.id, label: 'Bez daty', amount: 50, createdAt: d('2026-06-01') } });
  void early;

  const rows = await chargeService.forStatement(client.id);
  const labels = rows.map((c) => c.label);
  assert.deepEqual(labels, ['Z datą (styczeń)', 'Bez daty'], 'bez daty nie wskakuje przed styczniową');
});
