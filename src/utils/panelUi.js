// Konfigurowalny panel admina: kanoniczne listy pozycji menu i widżetów pulpitu
// + scalanie z zapisaną konfiguracją (Settings.panel JSON).
// Zapis trzyma tylko delty: { menu: [{key,hidden,label}], dashboard: [{key,hidden}] } w kolejności.
// Scalanie = unia: zapisana kolejność najpierw, nieznane klucze odrzucane,
// brakujące (nowe pozycje po aktualizacji aplikacji) doklejane na końcu jako widoczne.

// Menu boczne. Badge'y (notifications/messages/calendar) są wpięte po `key` w layoucie.
const MENU = [
  { key: 'dashboard', label: 'Pulpit', href: '/admin', icon: 'home' },
  { key: 'pulse', label: 'Puls agencji', href: '/admin/pulse', icon: 'activity' },
  { key: 'calendar', label: 'Kalendarz', href: '/admin/calendar', icon: 'calendarDays' },
  { key: 'projects', label: 'Projekty', href: '/admin/projects', icon: 'folder' },
  { key: 'clients', label: 'Klienci', href: '/admin/clients', icon: 'users' },
  { key: 'transfers', label: 'Transfery', href: '/admin/transfers', icon: 'send' },
  { key: 'messages', label: 'Wiadomości', href: '/admin/messages', icon: 'mail' },
  { key: 'notifications', label: 'Powiadomienia', href: '/admin/notifications', icon: 'bell' },
  { key: 'settings', label: 'Ustawienia', href: '/admin/settings', icon: 'cog' },
];

// Widżety pulpitu. span = szerokość na lg w jednostkach siatki 12-kolumnowej
// (3 = ¼, 4 = ⅓, 6 = ½, 8 = ⅔, 12 = pełna) — użytkownik zmienia ją przełącznikiem w trybie edycji.
// Renderery: views/admin/_widgets/<key>.ejs.
const SPANS = [3, 4, 6, 8, 12];
const WIDGETS = [
  { key: 'stat-transfers', label: 'Aktywne transfery', span: 4, icon: 'send' },
  { key: 'stat-projects', label: 'Aktywne projekty', span: 4, icon: 'folder' },
  { key: 'stat-uploads', label: 'Oczekujące uploady', span: 4, icon: 'cloudUpload' },
  { key: 'stat-outstanding', label: 'Do rozliczenia', span: 4, icon: 'banknote' },
  { key: 'stat-overdue', label: 'Przeterminowane', span: 4, icon: 'clock' },
  { key: 'stat-storage', label: 'Wykorzystane miejsce', span: 4, icon: 'archive' },
  { key: 'actions', label: 'Szybkie akcje', span: 4, icon: 'plus' },
  { key: 'activity', label: 'Ostatnia aktywność', span: 8, icon: 'activity' },
  { key: 'tasks', label: 'Nadchodzące zadania', span: 4, icon: 'calendarDays' },
  { key: 'revenue', label: 'Przychód i top klienci', span: 4, icon: 'trendingUp' },
  { key: 'messages', label: 'Nieprzeczytane wiadomości', span: 4, icon: 'mail' },
  { key: 'followup', label: 'Do odezwania się', span: 4, icon: 'phone' },
];

const MENU_KEYS = MENU.map((m) => m.key);
const WIDGET_KEYS = WIDGETS.map((w) => w.key);

// Scala zapisaną konfigurację z listą kanoniczną. Zwraca pełne pozycje w docelowej
// kolejności z flagą hidden; „Ustawienia" zawsze widoczne (droga powrotna).
function mergeMenu(cfg) {
  const saved = Array.isArray(cfg) ? cfg : [];
  const byKey = Object.fromEntries(MENU.map((m) => [m.key, m]));
  const out = [];
  const seen = new Set();
  for (const s of saved) {
    const base = s && byKey[s.key];
    if (!base || seen.has(s.key)) continue;
    seen.add(s.key);
    const label = typeof s.label === 'string' && s.label.trim() ? s.label.trim().slice(0, 30) : base.label;
    out.push({ ...base, label, defaultLabel: base.label, hidden: s.key === 'settings' ? false : !!s.hidden });
  }
  for (const m of MENU) if (!seen.has(m.key)) out.push({ ...m, defaultLabel: m.label, hidden: false });
  return out;
}

function mergeWidgets(cfg) {
  const saved = Array.isArray(cfg) ? cfg : [];
  const byKey = Object.fromEntries(WIDGETS.map((w) => [w.key, w]));
  const out = [];
  const seen = new Set();
  for (const s of saved) {
    const base = s && byKey[s.key];
    if (!base || seen.has(s.key)) continue;
    seen.add(s.key);
    out.push({ ...base, hidden: !!s.hidden, span: SPANS.includes(s.span) ? s.span : base.span });
  }
  for (const w of WIDGETS) if (!seen.has(w.key)) out.push({ ...w, hidden: false });
  return out;
}

// Czyszczenie przed zapisem (whitelist kluczy, przycięte etykiety, boole).
function sanitizeMenu(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    if (!s || !MENU_KEYS.includes(s.key) || seen.has(s.key)) continue;
    seen.add(s.key);
    const custom = typeof s.label === 'string' ? s.label.trim().slice(0, 30) : '';
    const def = MENU.find((m) => m.key === s.key).label;
    out.push({ key: s.key, hidden: s.key === 'settings' ? false : !!s.hidden, ...(custom && custom !== def ? { label: custom } : {}) });
  }
  return out;
}

function sanitizeWidgets(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    if (!s || !WIDGET_KEYS.includes(s.key) || seen.has(s.key)) continue;
    seen.add(s.key);
    const span = Number(s.span);
    out.push({ key: s.key, hidden: !!s.hidden, ...(SPANS.includes(span) ? { span } : {}) });
  }
  return out;
}

module.exports = { MENU, WIDGETS, SPANS, mergeMenu, mergeWidgets, sanitizeMenu, sanitizeWidgets };
