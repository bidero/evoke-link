// Przypomnienia o płatności — wysyła klientom maile o przeterminowanych pozycjach.
// Cron DirectAdmin (NIE node-cron). Anty-spam: jeden klient nie częściej niż co REMIND_EVERY_DAYS.
//
// Cron (przykład — codziennie o 8:00):
//   0 8 * * *  cd /home/UZYTKOWNIK/domena && /sciezka/do/node src/jobs/reminders.job.js
//
// Działa tylko gdy: włączone w Ustawieniach (E-mail → przypomnienia) ORAZ skonfigurowany SMTP.
const prisma = require('../db/client');
const settingsService = require('../services/settings.service');
const mail = require('../services/mail.service');
const events = require('../services/event.service');

const EVERY_DAYS = parseInt(process.env.REMIND_EVERY_DAYS, 10) || 7;

async function run() {
  const s = await settingsService.get();
  if (!(s.emails && s.emails.reminders)) { console.log('[reminders] wyłączone w ustawieniach — pomijam'); return; }
  if (!mail.isConfigured()) { console.log('[reminders] SMTP niewłączony — pomijam'); return; }

  const now = new Date();
  const cooldown = new Date(now.getTime() - EVERY_DAYS * 86400000);

  // Przeterminowane, nieopłacone, nieprzypomniane w okresie cooldown.
  const charges = await prisma.charge.findMany({
    where: {
      paidAt: null,
      dueDate: { not: null, lt: now },
      OR: [{ remindedAt: null }, { remindedAt: { lt: cooldown } }],
    },
    include: { project: { select: { clientId: true, status: true } } },
  });

  // Grupowanie po kliencie (bezpośrednim lub z projektu); pomijamy usunięte projekty.
  const byClient = {};
  for (const c of charges) {
    if (c.projectId && c.project && c.project.status === 'deleted') continue;
    const cid = c.clientId != null ? c.clientId : (c.project ? c.project.clientId : null);
    if (cid == null) continue;
    (byClient[cid] = byClient[cid] || []).push(c);
  }
  const cids = Object.keys(byClient).map(Number);
  if (!cids.length) { console.log('[reminders] brak przeterminowanych do przypomnienia'); return; }

  const clients = await prisma.client.findMany({ where: { id: { in: cids } } });
  let sent = 0;
  for (const client of clients) {
    if (!client.email) continue;
    const list = byClient[client.id];
    const total = list.reduce((n, c) => n + c.amount, 0);
    try {
      await mail.sendPaymentReminder({ to: client.email, client, charges: list, total });
      await prisma.charge.updateMany({ where: { id: { in: list.map((c) => c.id) } }, data: { remindedAt: now } });
      await events.log({ type: 'email_sent', message: `Wysłano przypomnienie o płatności (${list.length} poz., ${(total / 100).toFixed(2)} zł)`, clientId: client.id });
      sent++;
    } catch (e) {
      console.error('[reminders] błąd dla', client.email, '-', e.message);
    }
  }
  console.log(`[reminders] wysłano przypomnień: ${sent}`);
}

run()
  .catch((e) => { console.error('[reminders] błąd:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
