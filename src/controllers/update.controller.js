// Panel: aktualizacja aplikacji z GitHuba (Ustawienia → Zaawansowane).
// check/run/status to JSON dla Alpine (fetch + polling); notify to zwykły form POST.
const updateService = require('../services/update.service');
const events = require('../services/event.service');

// Sprawdzenie dostępności nowszej wersji (git fetch + porównanie z origin/main).
async function check(req, res) {
  try {
    res.json(await updateService.checkForUpdates());
  } catch (e) {
    res.status(500).json({ error: updateService.redact(e.message) });
  }
}

// Start aktualizacji — odłączony job; postęp śledzi endpoint statusu.
async function run(req, res) {
  try {
    if (updateService.isRunning()) return res.status(409).json({ error: 'Aktualizacja już trwa' });
    // skipBackup=true (checkbox „bez kopii") pomija krok backupu w jobie.
    const skipBackup = req.body && (req.body.skipBackup === true || req.body.skipBackup === 'on' || req.body.skipBackup === '1');
    updateService.startUpdate({ skipBackup });
    await events.log({ type: 'updated', message: `Uruchomiono aktualizację z GitHuba${skipBackup ? ' (bez kopii)' : ''}`, ip: req.ip });
    res.json({ started: true, skipBackup });
  } catch (e) {
    res.status(500).json({ error: updateService.redact(e.message) });
  }
}

// Stan + ogon logu. Po restarcie Passengera to żądanie wybudza nowy proces —
// panel polluje aż zobaczy state done/failed i świeżą wersję.
function status(req, res) {
  const st = updateService.readStatus();
  res.json({
    state: st.state || 'idle', step: st.step || null, error: st.error || null,
    from: st.from || null, to: st.to || null,
    version: updateService.currentVersion(),
    running: updateService.isRunning(),
    log: updateService.tailLog(),
  });
}

// Włączenie/wyłączenie powiadomień o nowych wersjach (cron sprawdza flagę).
function toggleNotify(req, res, next) {
  try {
    updateService.setNotify(req.body.enable === 'on');
    res.redirect('/admin/settings?saved=1&tab=advanced');
  } catch (err) {
    next(err);
  }
}

module.exports = { check, run, status, toggleNotify };
