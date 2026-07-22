// Komunikator agencji: agregacja per klient (conversationList/conversation), send (zagajenie),
// trwałe przeczytanie (markClientRead). Poziom serwisu — na dev-DB, sprząta własne rekordy.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const prisma = require('../src/db/client');
const messageService = require('../src/services/message.service');
const clientService = require('../src/services/client.service');

after(async () => { await prisma.$disconnect(); });

test('conversationList/conversation/send/markClientRead — agregacja per klient', async () => {
  const c = await clientService.create({ name: 'TEST_conv_' + Date.now(), status: 'active' });
  const p = await prisma.project.create({ data: { name: 'TEST conv proj', clientId: c.id, clientToken: 'tconv_' + Date.now() } });
  try {
    // klient pisze w projekcie (in, nieprzeczytane) + wiadomość kliencka ogólna (in)
    const m1 = await messageService.create({ body: 'pytanie projektowe', projectId: p.id, clientId: c.id, senderName: 'Ala' });
    const m2 = await messageService.create({ body: 'pytanie ogólne', clientId: c.id, senderName: 'Ala' });

    // lista rozmów: jeden wpis dla klienta, unread = 2, najnowsza treść = m2
    let list = await messageService.conversationList();
    let entry = list.find((e) => e.clientId === c.id);
    assert.ok(entry, 'klient jest na liście rozmów');
    assert.equal(entry.unread, 2, 'dwie nieprzeczytane przychodzące');
    assert.equal(entry.lastBody, 'pytanie ogólne', 'podgląd = najnowsza wiadomość');

    // strumień: obie wiadomości + kontekst projektu na wiadomości projektowej
    const conv = await messageService.conversation(c.id);
    assert.equal(conv.length, 2, 'obie wiadomości w strumieniu');
    const projMsg = conv.find((m) => m.id === m1.id);
    assert.equal(projMsg.project && projMsg.project.name, 'TEST conv proj', 'chip kontekstu = nazwa projektu');

    // agencja ZAGAJA/odpowiada w kontekście projektu (out)
    const out = await messageService.send({ clientId: c.id, projectId: p.id, body: 'odpowiedź agencji' });
    assert.ok(out && out.direction === 'out' && out.clientId === c.id && out.projectId === p.id, 'out z kontekstem projektu');

    // trwałe przeczytanie: markClientRead → 0 nieprzeczytanych, po ponownym odczycie dalej 0
    await messageService.markClientRead(c.id);
    list = await messageService.conversationList();
    entry = list.find((e) => e.clientId === c.id);
    assert.equal(entry.unread, 0, 'po markClientRead brak nieprzeczytanych (trwale)');
    const stillRead = await prisma.message.count({ where: { clientId: c.id, direction: 'in', isRead: false } });
    assert.equal(stillRead, 0, 'w bazie wszystkie in przeczytane');
  } finally {
    await prisma.message.deleteMany({ where: { clientId: c.id } });
    await prisma.project.delete({ where: { id: p.id } });
    await clientService.remove(c.id);
  }
});
