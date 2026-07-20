// Aktualizacja aplikacji z GitHuba — uruchamiana jako ODŁĄCZONY proces przez
// update.service.startUpdate() (panel: Ustawienia → Zaawansowane), ręcznie: node src/jobs/update.job.js.
// Kroki: backup → git pull --ff-only → npm install → prisma migrate deploy → tmp/restart.txt.
// Postęp: storage/tmp/update.log + update-status.json (panel polluje GET /admin/update/status).
// Proces jest odłączony od aplikacji, więc przeżywa restart Passengera, którego sam żąda na końcu.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const upd = require('../services/update.service');

const KEEP = parseInt(process.env.BACKUP_KEEP, 10) || 14;
// npm na Windows to npm.cmd — skrypty .cmd wymagają shella (Node odmawia spawnu bez niego).
// Argumenty są stałe (żadnych danych od użytkownika), więc shell jest tu bezpieczny.
const IS_WIN = process.platform === 'win32';
const NPM = IS_WIN ? 'npm.cmd' : 'npm';

function log(line) { upd.appendLog(line); console.log(line); }

// Uruchamia komendę, strumieniując stdout/stderr do logu (linia po linii, z redakcją).
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    log(`$ ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, { cwd: upd.ROOT, windowsHide: true, shell: opts.shell || false });
    let buf = '';
    const onData = (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach((l) => { if (l.trim()) log('  ' + l); });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => reject(new Error(upd.redact(e.message))));
    child.on('close', (code) => {
      if (buf.trim()) log('  ' + buf);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args[0]} zakończone kodem ${code}`));
    });
  });
}

async function main() {
  // --no-backup (z startUpdate opts.skipBackup): pomija krok kopii zapasowej.
  const skipBackup = process.argv.includes('--no-backup');
  const from = upd.currentVersion();
  upd.writeStatus({ state: 'running', step: 'backup', startedAt: upd.readStatus().startedAt || new Date().toISOString(), from, error: null });
  log(`== Aktualizacja Evoke LINK (z v${from}) — ${new Date().toISOString()} ==`);

  // 1. Kopia zapasowa (błąd przerywa aktualizację). Można pominąć (skipBackup).
  const prisma = require('../db/client');
  if (skipBackup) {
    log('[1/4] Kopia zapasowa — POMINIĘTA (na życzenie).');
  } else {
    log('[1/4] Kopia zapasowa (baza + pliki)…');
    const backup = require('../services/backup.service');
    const r = await backup.saveBackup('all');
    backup.rotate(KEEP);
    log(`  zapisano ${path.basename(r.path)} (${(r.size / 1048576).toFixed(1)} MB)`);
  }
  // Zwolnij silnik Prismy PRZED npm install (GOTCHA Windows: EPERM na pliku silnika).
  await prisma.$disconnect();

  // 2. Pobranie zmian. --ff-only: przy lokalnych commitach/rozjechanej historii czysto odmawia.
  upd.writeStatus({ step: 'git' });
  log('[2/4] Pobieranie zmian z GitHuba…');
  await run('git', ['pull', '--ff-only', 'origin', upd.BRANCH]);

  // 3. Zależności.
  upd.writeStatus({ step: 'npm' });
  log('[3/4] Instalacja zależności (npm install)…');
  await run(NPM, ['install', '--no-audit', '--no-fund'], { shell: IS_WIN });

  // 4. Migracje bazy.
  upd.writeStatus({ step: 'prisma' });
  log('[4/4] Migracje bazy (prisma migrate deploy)…');
  await run(NPM, ['run', 'prisma:deploy'], { shell: IS_WIN });

  // Restart Passengera (tmp/restart.txt). Na localhost bez Passengera — restart ręczny.
  const to = upd.currentVersion();
  fs.mkdirSync(path.join(upd.ROOT, 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(upd.ROOT, 'tmp', 'restart.txt'), new Date().toISOString());
  log(`Gotowe: v${from} → v${to}. Aplikacja zrestartuje się przy następnym żądaniu (Passenger).`);
  log('(Środowisko dev bez Passengera: zrestartuj serwer ręcznie.)');
  upd.writeStatus({ state: 'done', step: 'done', finishedAt: new Date().toISOString(), to });
}

if (require.main === module) {
  main().catch((e) => {
    const msg = upd.redact(e.message || String(e));
    log(`BŁĄD: ${msg}`);
    if (/EPERM/i.test(msg)) log('(Windows: zatrzymaj lokalny serwer przed npm install — GOTCHA silnika Prismy.)');
    upd.writeStatus({ state: 'failed', finishedAt: new Date().toISOString(), error: msg });
    process.exit(1);
  });
}

module.exports = { main, run };
