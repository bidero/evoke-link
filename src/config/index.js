// Centralne wczytanie konfiguracji z .env.
// Dzięki temu reszta kodu nie sięga bezpośrednio do process.env.
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Sekret podpisu ciasteczka sesji. GOTCHA BEZPIECZEŃSTWA: przy wartości domyślnej z kodu albo
// z `.env.example` każdy, kto zna repozytorium, może PODPISAĆ własne ciasteczko sesji
// (cookie-session) — czyli zalogować się jako administrator bez hasła. Dlatego wartości znane
// publicznie (i zbyt krótkie) odrzucamy i używamy losowego sekretu zapisanego raz w
// `storage/session-secret` (poza repo, jak klucze VAPID). Skutek uboczny pierwszego startu:
// jednorazowe wylogowanie wszystkich — nic więcej.
const PUBLIC_SECRETS = ['zmien-mnie', 'zmien-na-dlugi-losowy-ciag'];
function resolveSessionSecret() {
  const env = (process.env.SESSION_SECRET || '').trim();
  if (env.length >= 16 && !PUBLIC_SECRETS.includes(env)) return env;
  const file = path.join(__dirname, '..', '..', 'storage', 'session-secret');
  if (process.env.NODE_ENV !== 'test') console.warn('[config] SESSION_SECRET w .env jest pusty, domyślny albo za krótki — używam losowego sekretu z storage/session-secret. Ustaw własny (min. 16 znaków) w .env.');
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved.length >= 32) return saved;
  } catch (e) { /* brak pliku — wygenerujemy */ }
  const fresh = crypto.randomBytes(48).toString('hex');
  // Passenger startuje kilka procesów naraz — każdy MUSI dostać ten sam sekret (inaczej sesja
  // podpisana w jednym procesie byłaby nieważna w drugim). Zapis przez plik tymczasowy + link:
  // `linkSync` jest atomowy i kończy się EEXIST, gdy inny proces był szybszy — wtedy czytamy
  // jego (kompletny) sekret.
  const tmp = file + '.' + process.pid + '.tmp';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, fresh, { mode: 0o600 });
    try {
      fs.linkSync(tmp, file);
    } catch (e) {
      if (e.code === 'EEXIST') {
        const other = fs.readFileSync(file, 'utf8').trim();
        if (other.length >= 32) return other;
      }
      throw e;
    } finally {
      try { fs.unlinkSync(tmp); } catch (e) { /* już sprzątnięty */ }
    }
  } catch (e) {
    console.warn('[config] Nie udało się zapisać storage/session-secret — sesje nie przeżyją restartu:', e.message);
  }
  return fresh;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),

  admin: {
    email: process.env.ADMIN_EMAIL || '',
    password: process.env.ADMIN_PASSWORD || '',
    passwordHash: process.env.ADMIN_PASSWORD_HASH || '',
  },

  sessionSecret: resolveSessionSecret(),

  // Katalog na pliki — zawsze jako ścieżka absolutna.
  storageDir: path.resolve(
    process.cwd(),
    process.env.STORAGE_DIR || './storage/transfers'
  ),

  mail: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Evoke LINK <no-reply@example.com>',
  },
};

config.isProd = config.env === 'production';

module.exports = config;
