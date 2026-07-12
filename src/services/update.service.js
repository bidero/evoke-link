// Aktualizacje z GitHuba (panel, bez terminala) — porównanie HEAD z origin/main oraz start
// aktualizacji jako ODŁĄCZONY proces (src/jobs/update.job.js), który przeżywa restart Passengera.
// Używa poświadczeń gita zapisanych na serwerze (jak ręczny deploy) — zero nowych tokenów.
// Bezpieczeństwo: komendy przez execFile/spawn z tablicą argumentów (bez shella dla gita);
// KAŻDA linia trafiająca do logu przechodzi przez redact() — token z URL-a nie może wyciec.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TMP_DIR = path.join(ROOT, 'storage', 'tmp');
const STATUS_FILE = path.join(TMP_DIR, 'update-status.json');
const LOG_FILE = path.join(TMP_DIR, 'update.log');
// Flaga wyłączonych powiadomień o nowych wersjach (wzorzec: backup.service DISABLED_FLAG).
const NOTIFY_OFF_FLAG = path.join(ROOT, 'storage', 'update-notify-off');
const BRANCH = process.env.UPDATE_BRANCH || 'main';
// Lock starszy niż 30 min uznajemy za martwy (job padł bez zapisu stanu).
const STALE_MS = 30 * 60000;

// Redakcja danych dostępowych w URL-ach (git potrafi wypisać remote z tokenem przy błędzie).
function redact(s) {
  return String(s == null ? '' : s).replace(/(https?:\/\/)[^@/\s]+@/gi, '$1***@');
}

function git(args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: ROOT, timeout: opts.timeout || 60000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(redact(stderr || err.message).trim() || `git ${args[0]}: błąd`));
      resolve(String(stdout).trim());
    });
  });
}

// Wersja z package.json czytana z dysku (nie require — po git pull ma być świeża).
function currentVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || null; } catch (_) { return null; }
}

// Format git log: hash\x1ftemat\x1fdata (US-owy separator nie występuje w tematach commitów).
function parseCommits(raw) {
  return String(raw || '').split('\n').filter(Boolean).map((line) => {
    const [hash, subject, date] = line.split('\x1f');
    return { hash: hash || '', subject: redact(subject || ''), date: date || null };
  });
}

function readStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch (_) { return { state: 'idle' }; }
}

// Płytki merge do pliku stanu — job i panel dopisują różne pola (step, notifiedHash, lastCheck).
function writeStatus(patch) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const next = { ...readStatus(), ...patch };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(next, null, 2));
  return next;
}

function appendLog(line) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, redact(line).replace(/\s+$/, '') + '\n');
}

function tailLog(lines = 200) {
  try {
    const all = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
    return all.slice(Math.max(0, all.length - lines)).join('\n').trim();
  } catch (_) { return ''; }
}

// Czy nowsza wersja czeka na origin/main? Wynik ląduje też w pliku stanu (lastCheck) —
// cron używa go do anty-duplikacji powiadomień (notifiedHash).
async function checkForUpdates() {
  await git(['fetch', 'origin'], { timeout: 120000 });
  const [localHash, remoteHash] = await Promise.all([
    git(['rev-parse', 'HEAD']),
    git(['rev-parse', `origin/${BRANCH}`]),
  ]);
  const behind = parseInt(await git(['rev-list', '--count', `HEAD..origin/${BRANCH}`]), 10) || 0;
  const commits = behind ? parseCommits(await git(['log', `HEAD..origin/${BRANCH}`, '--pretty=format:%h\x1f%s\x1f%cs', '-n', '30'])) : [];
  let remote = null;
  try { remote = JSON.parse(await git(['show', `origin/${BRANCH}:package.json`])).version || null; } catch (_) { /* brak package.json na gałęzi */ }
  const result = {
    current: currentVersion(), remote, behind, commits,
    localHash, remoteHash, upToDate: behind === 0, checkedAt: new Date().toISOString(),
  };
  writeStatus({ lastCheck: result });
  return result;
}

function isRunning() {
  const st = readStatus();
  if (st.state !== 'running') return false;
  return !(st.startedAt && Date.now() - new Date(st.startedAt).getTime() > STALE_MS);
}

// Start aktualizacji: czyści log, ustawia lock i odpala job jako proces odłączony
// (detached + unref — przeżyje restart aplikacji, którego sam na końcu zażąda).
function startUpdate() {
  if (isRunning()) throw new Error('Aktualizacja już trwa');
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, '');
  writeStatus({ state: 'running', step: 'start', startedAt: new Date().toISOString(), finishedAt: null, error: null, from: currentVersion(), to: null });
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'jobs', 'update.job.js')], {
    cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.unref();
}

function isNotifyDisabled() { try { return fs.existsSync(NOTIFY_OFF_FLAG); } catch (_) { return false; } }
function setNotify(enabled) {
  if (enabled) { try { fs.unlinkSync(NOTIFY_OFF_FLAG); } catch (_) { /* już nie istnieje */ } }
  else fs.writeFileSync(NOTIFY_OFF_FLAG, 'Powiadomienia o aktualizacjach wyłączone z panelu.\n');
}

module.exports = {
  ROOT, BRANCH, STATUS_FILE, LOG_FILE,
  redact, git, currentVersion, parseCommits,
  readStatus, writeStatus, appendLog, tailLog,
  checkForUpdates, isRunning, startUpdate,
  isNotifyDisabled, setNotify,
};
