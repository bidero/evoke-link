// Ostrzeżenie o wygasaniu transferu (cron reminders → runExpiryWarnings).
const { test, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const prisma = require('../src/db/client');
const settingsService = require('../src/services/settings.service');
const job = require('../src/jobs/reminders.job'); // require.main guard → nie odpala run()

after(async () => { await prisma.$disconnect(); });

test('niepobrany wygasający → ostrzeżony; pobrany → pominięty; druga próba bez powtórki', async () => {
  const s0 = await settingsService.get();
  const orig = s0.emails.expiryWarn;
  await settingsService.update({ emails: { ...s0.emails, expiryWarn: true } });

  const exp = new Date(Date.now() + 12 * 3600000); // za 12 h
  const tWarn = await prisma.transfer.create({ data: { token: 'tex_' + Date.now(), direction: 'outgoing', status: 'active', expiresAt: exp, downloadCount: 0 } });
  const tDl = await prisma.transfer.create({ data: { token: 'texd_' + Date.now(), direction: 'outgoing', status: 'active', expiresAt: exp, downloadCount: 1 } });
  try {
    await job.runExpiryWarnings(await settingsService.get());
    const a = await prisma.transfer.findUnique({ where: { id: tWarn.id } });
    const b = await prisma.transfer.findUnique({ where: { id: tDl.id } });
    assert.ok(a.expiryWarnedAt, 'niepobrany ostrzeżony');
    assert.equal(b.expiryWarnedAt, null, 'pobrany pominięty');

    const firstTs = new Date(a.expiryWarnedAt).getTime();
    await job.runExpiryWarnings(await settingsService.get());
    const a2 = await prisma.transfer.findUnique({ where: { id: tWarn.id } });
    assert.equal(new Date(a2.expiryWarnedAt).getTime(), firstTs, 'anty-powtórka — znacznik bez zmian');
  } finally {
    await prisma.transfer.delete({ where: { id: tWarn.id } });
    await prisma.transfer.delete({ where: { id: tDl.id } });
    const s = await settingsService.get();
    await settingsService.update({ emails: { ...s.emails, expiryWarn: orig } });
  }
});
