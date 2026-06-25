// Centralne wczytanie konfiguracji z .env.
// Dzięki temu reszta kodu nie sięga bezpośrednio do process.env.
require('dotenv').config();

const path = require('path');

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),

  admin: {
    email: process.env.ADMIN_EMAIL || '',
    password: process.env.ADMIN_PASSWORD || '',
    passwordHash: process.env.ADMIN_PASSWORD_HASH || '',
  },

  sessionSecret: process.env.SESSION_SECRET || 'zmien-mnie',

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
