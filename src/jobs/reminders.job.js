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
const { grossOf } = require('../services/charge.service'); // kwoty BRUTTO (amount = netto)
const retainerService = require('../services/retainer.service');
const updateService = require('../services/update.service');

const EVERY_DAYS = parseInt(process.env.REMIND_EVERY_DAYS, 10) || 7;

async function run() {
  // Retainery i sprawdzenie aktualizacji ZAWSZE (nie wymagają SMTP) — bramka mailowa jest niżej.
  await runRetainers();
  await runUpdateCheck();
  const s = await settingsService.get();
  if (!mail.isConfigured()) { console.log('[reminders] SMTP niewłączony — pomijam maile'); return; }
  await runPaymentReminders(s);
  await runExpiryWarnings(s);
  await runDailyDigest(s);
}

// Cykliczne pozycje rozliczeniowe: aktywne retainery po dniu generowania → nowe Charge.
async function runRetainers() {
  try {
    const n = await retainerService.generateDue(new Date());
    console.log(`[retainers] wygenerowano pozycji cyklicznych: ${n}`);
  } catch (e) {
    console.error('[retainers] błąd:', e.message);
  }
}

// Powiadomienie o dostępnej aktualizacji z GitHuba (dzwonek) — gdy włączone (plik-flaga,
// Ustawienia → Zaawansowane). Anty-duplikat: hash origin/main zapamiętany w pliku stanu.
async function runUpdateCheck() {
  try {
    if (updateService.isNotifyDisabled()) { console.log('[update] powiadomienia wyłączone — pomijam'); return; }
    const r = await updateService.checkForUpdates();
    if (!r.behind) { console.log('[update] wersja aktualna'); return; }
    if (updateService.readStatus().notifiedHash === r.remoteHash) { console.log('[update] już powiadomiono o tej wersji'); return; }
    const to = r.remote ? `v${r.remote}` : 'nowszej wersji';
    await events.log({ type: 'update', message: `Dostępna aktualizacja do ${to} (zmian: ${r.behind}) — Ustawienia → Zaawansowane` });
    updateService.writeStatus({ notifiedHash: r.remoteHash });
    console.log(`[update] powiadomiono o aktualizacji do ${to}`);
  } catch (e) {
    console.error('[update] błąd sprawdzania:', updateService.redact(e.message));
  }
}

// Przypomnienia o przeterminowanych płatnościach (gdy włączone w Ustawieniach → E-mail).
async function runPaymentReminders(s) {
  if (!(s.emails && s.emails.reminders)) { console.log('[reminders] przypomnienia wyłączone — pomijam'); return; }

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
    const total = list.reduce((n, c) => n + grossOf(c), 0);
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

// Ostrzeżenie o wygasaniu transferów (gdy włączone w Ustawieniach → E-mail).
// Wychodzące, aktywne, wygasające w ciągu 24 h, NIE pobrane, jeszcze nie ostrzeżone.
async function runExpiryWarnings(s) {
  if (!(s.emails && s.emails.expiryWarn)) { console.log('[expiry] ostrzeżenia o wygasaniu wyłączone — pomijam'); return; }
  const now = new Date();
  const soon = new Date(now.getTime() + 24 * 3600000);
  const transfers = await prisma.transfer.findMany({
    where: { direction: 'outgoing', status: 'active', downloadCount: 0, expiryWarnedAt: null, expiresAt: { gt: now, lte: soon } },
    include: { project: { select: { name: true } } },
    orderBy: { expiresAt: 'asc' },
  });
  if (!transfers.length) { console.log('[expiry] brak wygasających do ostrzeżenia'); return; }
  try {
    await mail.sendExpiryWarning({ transfers });
    await prisma.transfer.updateMany({ where: { id: { in: transfers.map((t) => t.id) } }, data: { expiryWarnedAt: now } });
    console.log(`[expiry] ostrzeżenie wysłane (${transfers.length} transfer(ów))`);
  } catch (e) {
    console.error('[expiry] błąd:', e.message);
  }
}

// Dzienne podsumowanie (gdy włączone w Ustawieniach → E-mail). Pomijane, gdy nic się nie dzieje.
async function runDailyDigest(s) {
  if (!(s.emails && s.emails.dailyDigest)) { console.log('[digest] wyłączone — pomijam'); return; }
  const now = new Date();
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
  const last24 = new Date(now.getTime() - 24 * 3600000);
  const [reminders, messages, activity, overdueCharges] = await Promise.all([
    prisma.reminder.findMany({ where: { done: false, dueAt: { lte: endToday } }, include: { client: { select: { name: true } }, project: { select: { name: true } } }, orderBy: { dueAt: 'asc' }, take: 50 }),
    prisma.message.findMany({ where: { direction: 'in', isRead: false }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.event.findMany({ where: { type: { in: ['downloaded', 'uploaded'] }, createdAt: { gte: last24 } }, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.charge.findMany({ where: { paidAt: null, dueDate: { lt: now } }, take: 200 }),
  ]);
  reminders.forEach((r) => { r.sub = r.project ? r.project.name : (r.client ? r.client.name : null); });
  if (!reminders.length && !messages.length && !activity.length && !overdueCharges.length) { console.log('[digest] brak nowości — nie wysyłam'); return; }
  try {
    await mail.sendDailyDigest({ reminders, messages, activity, overdueCharges });
    console.log('[digest] wysłano podsumowanie dnia');
  } catch (e) {
    console.error('[digest] błąd:', e.message);
  }
}

// Auto-uruchom tylko gdy plik odpalono bezpośrednio (cron), nie przy require (testy).
if (require.main === module) {
  run()
    .catch((e) => { console.error('[reminders] błąd:', e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); });
}

module.exports = { run, runRetainers, runUpdateCheck, runPaymentReminders, runExpiryWarnings, runDailyDigest };
