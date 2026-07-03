// Retainery: generowanie cyklicznych pozycji Charge (anty-duplikat per miesiąc),
// dzień generowania, wstrzymywanie, MRR. Serwis testowany z wstrzykiwanymi datami.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app'); // spójność z resztą testów (i tak nie startujemy tras)
const prisma = require('../src/db/client');
const retainerService = require('../src/services/retainer.service');

after(async () => { await prisma.$disconnect(); });

test('retainer: pełny cykl — generacja, anty-duplikat, kolejny miesiąc, dzień, pauza, MRR', async () => {
  const cl = await prisma.client.create({ data: { name: 'RetTest', token: 'ret_' + Date.now() } });
  try {
    // walidacja: bez nazwy/kwoty nie tworzymy
    assert.equal(await retainerService.create(cl.id, { label: '', amount: '100' }), null);
    assert.equal(await retainerService.create(cl.id, { label: 'X', amount: '' }), null);

    // create: parsowanie kwoty (przecinek), VAT, zaciskanie dnia i terminu
    const r = await retainerService.create(cl.id, { label: 'Abonament www', amount: '1500,00', vatRate: '23', dayOfMonth: '10', dueDays: '7' });
    assert.equal(r.amount, 150000);
    assert.equal(r.vatRate, 23);
    assert.equal(r.dayOfMonth, 10);
    const r2 = await retainerService.create(cl.id, { label: 'Hosting', amount: '100', vatRate: '', dayOfMonth: '31', dueDays: '999' });
    assert.equal(r2.dayOfMonth, 28, 'dzień zaciśnięty do 28');
    assert.equal(r2.dueDays, 60, 'termin zaciśnięty do 60');

    // przed dniem generowania (5 lipca < dzień 10) → nic
    let n = await retainerService.generateDue(new Date(2026, 6, 5));
    const only = await prisma.charge.findMany({ where: { clientId: cl.id } });
    // (r2 ma dzień 28 — też jeszcze nie; hosting wygeneruje się dopiero 28-go)
    assert.equal(only.filter((c) => c.label.startsWith('Abonament')).length, 0, 'za wcześnie — brak pozycji');

    // po dniu generowania (15 lipca) → pozycja z miesiącem w nazwie, VAT i terminem +7 dni
    n = await retainerService.generateDue(new Date(2026, 6, 15));
    assert.equal(n, 1, 'wygenerowano dokładnie 1 (hosting czeka na 28.)');
    const ch = await prisma.charge.findFirst({ where: { clientId: cl.id, label: { contains: 'Abonament' } } });
    assert.equal(ch.label, 'Abonament www — lipiec 2026');
    assert.equal(ch.amount, 150000);
    assert.equal(ch.vatRate, 23);
    assert.equal(new Date(ch.dueDate).getDate(), 22, 'termin +7 dni (15+7)');
    assert.equal((await retainerService.getById(r.id)).lastPeriod, '2026-07');

    // anty-duplikat: ten sam miesiąc → 0
    n = await retainerService.generateDue(new Date(2026, 6, 20));
    assert.equal(n, 0, 'bez duplikatu w tym samym miesiącu');

    // event w osi czasu klienta
    assert.ok(await prisma.event.findFirst({ where: { clientId: cl.id, type: 'created', message: { contains: 'Pozycja cykliczna' } } }));

    // kolejny miesiąc → generuje ponownie
    n = await retainerService.generateDue(new Date(2026, 7, 10));
    assert.equal(n, 1);
    assert.ok(await prisma.charge.findFirst({ where: { clientId: cl.id, label: 'Abonament www — sierpień 2026' } }));

    // wstrzymany nie generuje; wznowiony — tak (ręcznie, mimo dnia)
    await retainerService.toggle(r.id);
    n = await retainerService.generateDue(new Date(2026, 8, 15));
    assert.equal(n, 0, 'wstrzymany pomijany (hosting już po sierpniowej generacji? — nie: hosting dzień 28 > 15)');
    await retainerService.toggle(r.id);
    const manual = await retainerService.generateNow(r.id, new Date(2026, 8, 2)); // 2 września, przed dniem 10
    assert.ok(manual, '„Generuj teraz" działa przed dniem generowania');
    assert.equal(manual.label, 'Abonament www — wrzesień 2026');
    assert.equal(await retainerService.generateNow(r.id, new Date(2026, 8, 20)), null, 'ręczny też ma anty-duplikat');

    // MRR: tylko aktywne, brutto
    const { mrr, count } = await retainerService.mrrActive();
    const mine = (await retainerService.listByClient(cl.id)).filter((x) => x.active);
    assert.equal(mine.length, 2);
    // nasz wkład do MRR: 1500*1.23 + 100 (bez VAT) = 184500 + 10000
    assert.ok(mrr >= 194500, 'MRR obejmuje oba aktywne retainery brutto');
    assert.ok(count >= 2);
    await retainerService.toggle(r2.id);
    const after2 = await retainerService.mrrActive();
    assert.equal(mrr - after2.mrr, 10000, 'wstrzymany wypada z MRR');
  } finally {
    await prisma.charge.deleteMany({ where: { clientId: cl.id } });
    await prisma.retainer.deleteMany({ where: { clientId: cl.id } });
    await prisma.event.deleteMany({ where: { clientId: cl.id } });
    await prisma.client.delete({ where: { id: cl.id } });
  }
});
