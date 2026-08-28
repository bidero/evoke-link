// Krótkotrwałe linki pobierania (poza `/admin`).
//
// PO CO: w zainstalowanej aplikacji na iOS (standalone) WebKit ignoruje atrybut `download`
// i nawiguje okno apki na plik — a okno standalone nie ma paska przeglądarki, więc nie ma
// drogi powrotnej. Adres spoza zasięgu aplikacji (`scope: '/admin'`) otwiera się POZA jej
// oknem, ale wtedy nie ma sesji: web-apka z ekranu głównego ma w iOS OSOBNE ciasteczka niż
// Safari. Dlatego zamiast sesji autoryzuje tu podpis.
//
// MODEL BEZPIECZEŃSTWA: podpis HMAC-SHA256 sekretem serwera, ważny 5 minut, związany
// z JEDNYM konkretnym zasobem (rodzaj + id). Link wystawia wyłącznie zalogowany użytkownik
// (mint za `requireAuth`).
//
// DLACZEGO NIE JEDNORAZOWY (zmiana z v1.0.6): pierwotnie link zużywał się przy pierwszym
// użyciu, ale w arkuszu zapisu na iOS jest opcja „otwórz link" — a ta trafiała już na
// zużyty adres i pokazywała błąd (zgłoszone z iPhone'a). W oknie ważności link działa więc
// wielokrotnie. Ochroną zostaje krótki czas życia i związanie z jednym plikiem.
const crypto = require('crypto');
const config = require('../config');

const TTL_MS = 5 * 60 * 1000;             // tyle czasu ma sens „otwórz link" z arkusza zapisu
const KINDS = ['file', 'zip', 'document', 'attachment']; // whitelist — nic spoza listy nie przejdzie

const b64 = (buf) => Buffer.from(buf).toString('base64url');

function secret() {
  // Ten sam sekret co sesja: żyje wyłącznie na serwerze i nigdy nie trafia do widoku.
  return crypto.createHash('sha256').update('evoke-dl:' + config.sessionSecret).digest();
}

function mac(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest();
}

// token = <payload base64url>.<hmac base64url>
function sign(kind, id, extra) {
  if (!KINDS.includes(kind)) return null;
  const payload = b64(JSON.stringify({
    k: kind,
    i: String(id),
    x: extra === undefined || extra === null ? '' : String(extra),
    e: Date.now() + TTL_MS,
    n: crypto.randomBytes(9).toString('base64url'),  // nonce = tożsamość jednorazowości
  }));
  return `${payload}.${b64(mac(payload))}`;
}

// Zwraca { kind, id, extra, nonce } albo null (zły podpis / po czasie / śmieci).
function verify(token) {
  if (typeof token !== 'string' || token.length > 512) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  let given;
  try { given = Buffer.from(token.slice(dot + 1), 'base64url'); } catch (_) { return null; }
  const want = mac(payload);
  // Porównanie stałoczasowe (i tylko przy zgodnej długości — timingSafeEqual rzuca inaczej).
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch (_) { return null; }
  if (!data || !KINDS.includes(data.k) || !data.n) return null;
  if (!(Number(data.e) > Date.now())) return null;
  return { kind: data.k, id: data.i, extra: data.x || null, nonce: data.n };
}

module.exports = { sign, verify, KINDS, TTL_MS };
