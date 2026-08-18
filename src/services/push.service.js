// Web Push — jedyny mechanizm, który budzi aplikację, gdy jest ZAMKNIĘTA.
// Dzięki niemu licznik na ikonie (i banerek) pojawia się bez otwierania panelu;
// odświeżanie z `public/js/badges.js` działa tylko przy otwartej karcie.
//
// DLACZEGO BIBLIOTEKA: szyfrowanie ładunku (ECDH + HKDF + AES128GCM) i podpis VAPID
// dałoby się napisać na wbudowanym `crypto`, ale to dokładnie ten rodzaj kodu, w którym
// subtelny błąd oznacza ciche niedostarczanie albo dziurę. `web-push` jest czystym JS-em
// (zero kompilacji natywnej), więc mieści się w zasadzie „shared-hosting-safe".
//
// KLUCZE VAPID trzymamy w pliku `storage/vapid.json`, a NIE w Settings — obiekt ustawień
// ląduje w `res.locals` każdego widoku (i bywa serializowany do JSON w atrybutach Alpine),
// więc klucz PRYWATNY nie ma prawa się tam znaleźć. Plik jest poza repo (storage/ w
// .gitignore) i wchodzi do kopii zapasowej razem z resztą storage.
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const prisma = require('../db/client');
const config = require('../config');

const ROOT = path.join(__dirname, '..', '..');
const KEYS_FILE = path.join(ROOT, 'storage', 'vapid.json');

let cache = null;

// Para kluczy VAPID: czytamy z pliku, a przy pierwszym użyciu generujemy i zapisujemy.
// Wymiana kluczy unieważnia WSZYSTKIE istniejące subskrypcje, więc pliku nie nadpisujemy.
function keys() {
  if (cache) return cache;
  try {
    if (fs.existsSync(KEYS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
      if (parsed && parsed.publicKey && parsed.privateKey) {
        cache = parsed;
        return cache;
      }
    }
  } catch (_) { /* uszkodzony plik — wygenerujemy nowy niżej */ }

  const generated = webpush.generateVAPIDKeys();
  try {
    fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
    fs.writeFileSync(KEYS_FILE, JSON.stringify(generated, null, 2), { mode: 0o600 });
  } catch (e) {
    console.error('[push] nie udało się zapisać kluczy VAPID:', e.message);
  }
  cache = generated;
  return cache;
}

function publicKey() {
  return keys().publicKey;
}

// `mailto:` jest wymagane przez specyfikację VAPID (kontakt do właściciela aplikacji).
function applyVapid() {
  const k = keys();
  const contact = config.admin && config.admin.email ? `mailto:${config.admin.email}` : 'mailto:admin@example.com';
  webpush.setVapidDetails(contact, k.publicKey, k.privateKey);
}

// Skrót User-Agent na czytelną etykietę urządzenia (lista subskrypcji w profilu).
function labelFor(ua) {
  const s = String(ua || '');
  const os = /iPhone|iPad/i.test(s) ? 'iPhone/iPad' : /Android/i.test(s) ? 'Android' : /Mac OS X/i.test(s) ? 'Mac' : /Windows/i.test(s) ? 'Windows' : /Linux/i.test(s) ? 'Linux' : '';
  const br = /Edg\//i.test(s) ? 'Edge' : /Chrome\//i.test(s) ? 'Chrome' : /Firefox\//i.test(s) ? 'Firefox' : /Safari\//i.test(s) ? 'Safari' : '';
  return [os, br].filter(Boolean).join(' · ') || null;
}

// Zapis subskrypcji z przeglądarki. `endpoint` jest unikalny — ponowne zapisanie tej samej
// przeglądarki odświeża klucze zamiast tworzyć duplikat.
async function subscribe(sub, { userId, ua } = {}) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return null;
  const data = {
    endpoint: String(sub.endpoint).slice(0, 1000),
    p256dh: String(sub.keys.p256dh),
    auth: String(sub.keys.auth),
    label: labelFor(ua),
    userId: userId || null,
  };
  return prisma.pushSubscription.upsert({
    where: { endpoint: data.endpoint },
    create: data,
    update: { p256dh: data.p256dh, auth: data.auth, label: data.label, userId: data.userId },
  });
}

function unsubscribe(endpoint) {
  if (!endpoint) return Promise.resolve({ count: 0 });
  return prisma.pushSubscription.deleteMany({ where: { endpoint: String(endpoint) } });
}

function list(userId) {
  return prisma.pushSubscription.findMany({
    where: userId ? { userId: Number(userId) } : {},
    orderBy: { createdAt: 'desc' },
  });
}

function count() {
  return prisma.pushSubscription.count();
}

// Wysyłka do WSZYSTKICH zapisanych urządzeń. Powiadomienia w tej aplikacji są „agencyjne"
// (dzwonek i liczniki też są wspólne, nie per użytkownik), więc nie rozdzielamy odbiorców.
// Subskrypcje odrzucone przez serwer push (404/410 = odinstalowana/wyczyszczona przeglądarka)
// kasujemy — inaczej lista rosłaby w nieskończoność.
async function sendToAll({ title, body, url, badge }) {
  const subs = await prisma.pushSubscription.findMany();
  if (!subs.length) return { sent: 0, removed: 0 };

  applyVapid();
  const payload = JSON.stringify({
    title: title || 'Evoke LINK',
    body: body || '',
    url: url || '/admin',
    badge: Number.isFinite(badge) ? badge : null,
  });

  let sent = 0;
  const dead = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) dead.push(s.endpoint);
      else console.error('[push] wysyłka nieudana:', (e && e.message) || e);
    }
  }));

  if (dead.length) await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: dead } } });
  if (sent) {
    await prisma.pushSubscription.updateMany({
      where: { endpoint: { notIn: dead } },
      data: { lastOkAt: new Date() },
    }).catch(() => {});
  }
  return { sent, removed: dead.length };
}

// Bramka wysyłki: ustawienia + istnienie choćby jednej subskrypcji. Zwraca ustawienia albo null.
// Wydzielona, żeby budowanie treści (np. dociągnięcie nazwy klienta) działo się DOPIERO po jej
// przejściu — przy wyłączonym pushu nie robimy ani jednego dodatkowego zapytania.
async function canSend() {
  const settingsService = require('./settings.service');
  const s = await settingsService.get();
  if (!(s.pwa && s.pwa.enabled && s.pwa.push)) return null;
  if ((await count()) === 0) return null; // nikt nie ma włączonych powiadomień
  return s;
}

// Aktualny stan liczników → kropka na ikonie ustawiana przez service workera.
// GOTCHA (cykl require): `event.service` woła funkcje z tego pliku, a my potrzebujemy z niego
// licznika. Dlatego oba serwisy ładujemy LENIWIE, w środku wywołania — w tym momencie moduły
// są już w pełni załadowane, więc nie dostajemy pustego obiektu z połowicznego cyklu.
async function badgeCount() {
  const events = require('./event.service');
  const messageService = require('./message.service');
  const [a, b] = await Promise.all([events.unreadCount(), messageService.unreadCount()]);
  return a + b;
}

// Powiadomienie z gotowym tytułem/treścią (używa go „Wyślij testowe" w profilu).
// „Nie wybuchowe" — błąd wysyłki nie może wywrócić uploadu ani zapisu wiadomości.
async function notify({ title, body, url }) {
  try {
    if (!(await canSend())) return { skipped: true };
    return await sendToAll({ title, body, url, badge: await badgeCount() });
  } catch (e) {
    console.error('[push] powiadomienie nieudane:', (e && e.message) || e);
    return { error: true };
  }
}

// Krótkie, ludzkie tytuły zdarzeń. WAŻNE: tytułem NIE może być nazwa aplikacji — przeglądarka
// i tak dokleja atrybucję („… from Evoke LINK"), więc wychodziło „Evoke LINK from Evoke LINK".
// Klucze = NOTIFY_TYPES z event.service (tylko te typy w ogóle dzwonią).
const EVENT_LABELS = {
  uploaded: 'Nowe pliki od klienta',
  downloaded: 'Klient pobrał pliki',
  approved: 'Klient zatwierdził pliki',
  changes: 'Klient zgłosił poprawki',
  onboarded: 'Klient uzupełnił dane',
  paid_declared: 'Klient zgłosił wpłatę',
  offer_accepted: 'Oferta zaakceptowana',
  offer_rejected: 'Oferta odrzucona',
  update: 'Dostępna aktualizacja',
  error: 'Błąd',
};
const eventTitle = (type) => EVENT_LABELS[type] || 'Powiadomienie';

// Zdarzenie: tytuł = etykieta typu, treść = opisowe zdanie, które i tak już mamy w historii.
async function notifyEvent({ type, message, url }) {
  try {
    if (!(await canSend())) return { skipped: true };
    return await sendToAll({
      title: eventTitle(type),
      body: message || '',
      url: url || '/admin/notifications',
      badge: await badgeCount(),
    });
  } catch (e) {
    console.error('[push] powiadomienie nieudane:', (e && e.message) || e);
    return { error: true };
  }
}

// Wiadomość od klienta. Tytuł: podpis nadawcy → nazwa klienta z bazy → ogólny fallback.
// W portalach pola „Imię"/„E-mail" są ukryte (znany nadawca, v0.99.17), więc `senderName`
// bywa pusty MIMO że wiemy, kto pisze — stąd dociąganie nazwy klienta.
// Fragment treści pokazujemy tylko przy `pwa.pushBody` (powiadomienia widać na ekranie blokady).
async function notifyMessage({ clientId, senderName, text }) {
  try {
    const s = await canSend();
    if (!s) return { skipped: true };

    let who = (senderName || '').trim();
    if (!who && clientId) {
      const c = await prisma.client.findUnique({ where: { id: Number(clientId) }, select: { name: true } });
      if (c) who = c.name;
    }

    return await sendToAll({
      title: who ? `Wiadomość od ${who}` : 'Nowa wiadomość',
      body: s.pwa.pushBody ? String(text || '').slice(0, 160) : '',
      url: '/admin/messages',
      badge: await badgeCount(),
    });
  } catch (e) {
    console.error('[push] powiadomienie nieudane:', (e && e.message) || e);
    return { error: true };
  }
}

module.exports = { publicKey, subscribe, unsubscribe, list, count, sendToAll, notify, notifyEvent, notifyMessage, eventTitle, EVENT_LABELS, labelFor, KEYS_FILE };
