// Puls agencji — agregacje z danych, które już zbieramy (Charge, Transfer, File, Event).
// Bez nowego modelu; wszystko liczone na żądanie (skala jednej agencji — OK).
const prisma = require('../db/client');

const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`;

// Klient pozycji: bezpośredni lub z projektu.
const chargeClientId = (c) => (c.clientId != null ? c.clientId : (c.project ? c.project.clientId : null));

async function pulse() {
  const now = new Date();
  const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const chartStart = new Date(now.getFullYear(), now.getMonth() - 5, 1); // 6 miesięcy z bieżącym
  const d30 = new Date(now.getTime() - 30 * 86400000);

  const [paidCharges, unpaid, outgoing30, filesOut30, filesIn30, downloads30, views30, engagementEvents] = await Promise.all([
    // Opłacone od początku okna wykresu (6 mies.) — starczy na kafelki + wykres + top klientów.
    prisma.charge.findMany({
      where: { paidAt: { gte: chartStart } },
      select: { amount: true, paidAt: true, clientId: true, project: { select: { clientId: true } } },
    }),
    prisma.charge.findMany({ where: { paidAt: null }, select: { amount: true, dueDate: true } }),
    prisma.transfer.findMany({ where: { direction: 'outgoing', createdAt: { gte: d30 } }, select: { downloadCount: true } }),
    prisma.file.count({ where: { createdAt: { gte: d30 }, transfer: { direction: 'outgoing' } } }),
    prisma.file.count({ where: { createdAt: { gte: d30 }, transfer: { direction: 'incoming' } } }),
    prisma.event.count({ where: { type: 'downloaded', createdAt: { gte: d30 } } }),
    prisma.event.count({ where: { type: 'viewed', createdAt: { gte: d30 } } }),
    // Zaangażowanie klientów: kto cokolwiek robił w 30 dni (otwierał/pobierał/wgrywał).
    prisma.event.findMany({
      where: { createdAt: { gte: d30 }, type: { in: ['viewed', 'downloaded', 'uploaded'] } },
      select: { clientId: true, project: { select: { clientId: true } } },
    }),
  ]);

  // Przychód: bieżący i poprzedni miesiąc + seria 6 miesięcy do wykresu.
  let paidThisMonth = 0;
  let paidPrevMonth = 0;
  const byMonth = {};
  const byClient = {};
  for (const c of paidCharges) {
    const d = new Date(c.paidAt);
    if (d >= mStart) paidThisMonth += c.amount;
    else if (d >= prevStart && d < mStart) paidPrevMonth += c.amount;
    byMonth[monthKey(d)] = (byMonth[monthKey(d)] || 0) + c.amount;
    const cid = chargeClientId(c);
    if (cid != null) byClient[cid] = (byClient[cid] || 0) + c.amount;
  }
  const chart = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    chart.push({ label: MONTHS_SHORT[d.getMonth()], value: byMonth[monthKey(d)] || 0, current: i === 0 });
  }

  // Należności.
  let outstanding = 0;
  let overdue = 0;
  for (const c of unpaid) { outstanding += c.amount; if (c.dueDate && new Date(c.dueDate) < now) overdue += c.amount; }

  // Skuteczność dostarczeń: ile wysłanych transferów (30 dni) klient faktycznie pobrał.
  const sent30 = outgoing30.length;
  const pickedUp = outgoing30.filter((t) => t.downloadCount > 0).length;
  const pickupRate = sent30 ? Math.round((pickedUp / sent30) * 100) : null;

  // Aktywni klienci (30 dni) — unikalni z zdarzeń.
  const activeSet = new Set();
  engagementEvents.forEach((e) => { const cid = e.clientId != null ? e.clientId : (e.project ? e.project.clientId : null); if (cid != null) activeSet.add(cid); });

  // Top klienci wg opłaconego przychodu (okno 6 mies.).
  const topIds = Object.entries(byClient).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => Number(id));
  const topClients = topIds.length
    ? (await prisma.client.findMany({ where: { id: { in: topIds } }, select: { id: true, name: true } }))
        .map((c) => ({ ...c, paid: byClient[c.id] || 0 }))
        .sort((a, b) => b.paid - a.paid)
    : [];

  const totalClients = await prisma.client.count();

  return {
    money: { paidThisMonth, paidPrevMonth, outstanding, overdue, chart },
    delivery: { sent30, pickedUp, pickupRate, filesOut30, filesIn30, downloads30, views30 },
    clients: { active30: activeSet.size, total: totalClients, top: topClients },
  };
}

module.exports = { pulse };
