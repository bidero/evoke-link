// Proofing: klient zatwierdza / zgłasza poprawki do dostarczonych plików (/t i portal /p).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), redirect: 'manual' });

test('proofing na /t: panel, poprawki z komentarzem, walidacja, zmiana decyzji', async () => {
  const t = await prisma.transfer.create({ data: { token: 'prf_' + Date.now(), direction: 'outgoing', status: 'active', title: 'Proof', proofing: true } });
  try {
    // panel widoczny na stronie pobierania
    const html = await (await fetch(`${base}/t/${t.token}`)).text();
    assert.match(html, /Czy akceptujesz te pliki\?/);
    assert.match(html, /Zatwierdzam/);

    // poprawki BEZ komentarza → odrzucone (bez zmiany)
    await post(`${base}/t/${t.token}/decision`, { decision: 'changes', comment: '' });
    assert.equal((await prisma.transfer.findUnique({ where: { id: t.id } })).approvalStatus, null);

    // poprawki z komentarzem → zapis + event 'changes'
    await post(`${base}/t/${t.token}/decision`, { decision: 'changes', comment: 'Logo za małe', name: 'Ala' });
    await wait(300);
    const after1 = await prisma.transfer.findUnique({ where: { id: t.id } });
    assert.equal(after1.approvalStatus, 'changes');
    assert.equal(after1.approvalComment, 'Logo za małe');
    assert.equal(after1.approvalBy, 'Ala');
    assert.ok(await prisma.event.findFirst({ where: { transferId: t.id, type: 'changes' } }), 'event changes zapisany');

    // zmiana decyzji na zatwierdzenie
    await post(`${base}/t/${t.token}/decision`, { decision: 'approved' });
    await wait(300);
    assert.equal((await prisma.transfer.findUnique({ where: { id: t.id } })).approvalStatus, 'approved');
    assert.ok(await prisma.event.findFirst({ where: { transferId: t.id, type: 'approved' } }), 'event approved zapisany');

    // zła decyzja → ignorowana
    await post(`${base}/t/${t.token}/decision`, { decision: 'hack' });
    assert.equal((await prisma.transfer.findUnique({ where: { id: t.id } })).approvalStatus, 'approved');
  } finally {
    await prisma.event.deleteMany({ where: { transferId: t.id } });
    await prisma.transfer.delete({ where: { id: t.id } });
  }
});

test('proofing z portalu /p: decyzja dla transferu projektu', async () => {
  const token = 'prfp_' + Date.now();
  const p = await prisma.project.create({ data: { name: 'ProofProj', clientToken: token } });
  const t = await prisma.transfer.create({ data: { token: 'prft_' + Date.now(), direction: 'outgoing', status: 'active', projectId: p.id, clientVisible: true, proofing: true } });
  // bez pliku portal pokazuje „Brak udostępnionych plików" i pomija sekcję (a z nią proofing)
  await prisma.file.create({ data: { transferId: t.id, originalName: 'a.pdf', storedName: 'a.pdf', storedPath: t.token + '/a.pdf', size: 10n, mimeType: 'application/pdf' } });
  try {
    const html = await (await fetch(`${base}/p/${token}`)).text();
    assert.match(html, /Czy akceptujesz te pliki\?/, 'panel proofingu w portalu');

    await post(`${base}/p/${token}/decision/${t.id}`, { decision: 'approved', name: 'Ola' });
    await wait(300);
    const after1 = await prisma.transfer.findUnique({ where: { id: t.id } });
    assert.equal(after1.approvalStatus, 'approved');
    assert.equal(after1.approvalBy, 'Ola');

    // chip statusu w portalu po decyzji
    const html2 = await (await fetch(`${base}/p/${token}`)).text();
    assert.match(html2, /Zatwierdzone ✓/);
  } finally {
    await prisma.event.deleteMany({ where: { projectId: p.id } });
    await prisma.transfer.delete({ where: { id: t.id } });
    await prisma.project.delete({ where: { id: p.id } });
  }
});
