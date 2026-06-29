// Globalna wyszukiwarka — klienci + projekty + transfery (SQLite LIKE „contains").
const prisma = require('../db/client');

async function search(q, limit = 20) {
  const s = (q || '').trim();
  if (s.length < 2) return { q: s, clients: [], projects: [], transfers: [] };

  const [clients, projects, transfers] = await Promise.all([
    prisma.client.findMany({
      where: { OR: [
        { name: { contains: s } }, { email: { contains: s } }, { company: { contains: s } },
        { phone: { contains: s } }, { tags: { contains: s } }, { nip: { contains: s } },
      ] },
      include: { _count: { select: { projects: true } } },
      orderBy: { name: 'asc' },
      take: limit,
    }),
    prisma.project.findMany({
      where: { status: { not: 'deleted' }, OR: [
        { name: { contains: s } }, { clientName: { contains: s } }, { client: { name: { contains: s } } },
      ] },
      include: { client: { select: { name: true } }, _count: { select: { transfers: true } } },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    }),
    prisma.transfer.findMany({
      where: { status: { not: 'deleted' }, OR: [
        { title: { contains: s } }, { token: { contains: s } },
        { files: { some: { originalName: { contains: s } } } },
      ] },
      include: { project: { select: { name: true } }, _count: { select: { files: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
  ]);

  return { q: s, clients, projects, transfers };
}

module.exports = { search };
