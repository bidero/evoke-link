// Krótkotrwałe, JEDNORAZOWE linki pobierania (poza `/admin`).
//
// PO CO: w zainstalowanej aplikacji na iOS (standalone) WebKit ignoruje atrybut `download`
// i nawiguje okno apki na plik — a okno standalone nie ma paska przeglądarki, więc nie ma
// drogi powrotnej. Adres spoza zasięgu aplikacji (`scope: '/admin'`) otwiera się POZA jej
// oknem, ale wtedy nie ma sesji: web-apka z ekranu głównego ma w iOS OSOBNE ciasteczka niż
// Safari. Dlatego zamiast sesji autoryzuje tu podpis.
//
// MODEL BEZPIECZEŃSTWA: podpis HMAC-SHA256 sekretem serwera, ważny 60 s, związany z JEDNYM
// konkretnym zasobem (rodzaj + id), zużywany przy pierwszym użyciu. Link wystawia wyłącznie
// zalogowany użytkownik (mint za `requireAuth`).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const storage = require('../services/storage.service');

const TTL_MS = 60 * 1000;                 // okno na kliknięcie i start pobierania
const USED_DIR = path.join(storage.TMP_DIR, 'dl');
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

// Jednorazowość MIĘDZY PROCESAMI (Passenger uruchamia ich kilka, więc pamięć procesu nie
// wystarcza): znacznik tworzony flagą 'wx' — atomowe „utwórz albo poległ".
function consume(nonce) {
  try {
    fs.mkdirSync(USED_DIR, { recursive: true });
    fs.closeSync(fs.openSync(path.join(USED_DIR, nonce.replace(/[^\w-]/g, '')), 'wx'));
    return true;
  } catch (_) {
    return false; // już użyty (EEXIST) albo dysk nie pozwala — w obu wypadkach nie wydajemy pliku
  }
}

// Sprzątanie znaczników starszych niż godzina (wołane przy starcie, wzorzec chunk.sweepOld).
function sweepUsed() {
  try {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const name of fs.readdirSync(USED_DIR)) {
      const p = path.join(USED_DIR, name);
      try { if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true }); } catch (_) { /* wyścig */ }
    }
  } catch (_) { /* katalogu jeszcze nie ma */ }
}

// Sprzątanie przy starcie (wzorzec chunk.service.sweepOld).
try { sweepUsed(); } catch (_) {}

module.exports = { sign, verify, consume, sweepUsed, KINDS, TTL_MS };
