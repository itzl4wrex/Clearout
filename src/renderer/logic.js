// Pure helpers for the window (no DOM): formatting, searching, sorting, CSV.

export const LARGE_KB = 500 * 1024;          // "Large" = 500 MB or more
export const RECENT_DAYS = 30;

export function formatSize(kb) {
  if (kb == null || !Number.isFinite(kb) || kb <= 0) return '—';
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 100 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function formatDate(iso) {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '—';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function daysSince(iso, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  const then = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - then) / 86400000);
}

export function ago(iso, now = new Date()) {
  const d = daysSince(iso, now);
  if (d == null) return '';
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  if (d < 365) { const m = Math.round(d / 30); return `${m} month${m > 1 ? 's' : ''} ago`; }
  const y = Math.round(d / 365);
  return `${y} year${y > 1 ? 's' : ''} ago`;
}

export const FILTERS = [
  { id: 'all', label: 'All programs', test: () => true },
  { id: 'large', label: 'Large', test: (p) => (p.sizeKB || 0) >= LARGE_KB },
  { id: 'recent', label: 'Recently installed', test: (p, now) => { const d = daysSince(p.installDate, now); return d != null && d <= RECENT_DAYS; } },
  { id: 'store', label: 'Store apps', test: (p) => p.source === 'store' },
];

export function countFilters(list, now = new Date()) {
  const out = {};
  for (const f of FILTERS) out[f.id] = list.filter((p) => f.test(p, now)).length;
  return out;
}

export function filterPrograms(list, { query = '', filter = 'all' } = {}, now = new Date()) {
  const f = FILTERS.find((x) => x.id === filter) || FILTERS[0];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((p) => {
    if (!f.test(p, now)) return false;
    const hay = `${p.name} ${p.publisher} ${p.version}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export function sortPrograms(list, key = 'name', dir = 1) {
  const val = {
    name: (p) => p.name.toLowerCase(),
    size: (p) => (p.sizeKB == null ? null : p.sizeKB),
    date: (p) => p.installDate || null,
  }[key] || ((p) => p.name.toLowerCase());
  return [...list].sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null && y == null) return a.name.localeCompare(b.name);
    if (x == null) return 1;                    // unknown values always go last
    if (y == null) return -1;
    if (x < y) return -dir;
    if (x > y) return dir;
    return a.name.localeCompare(b.name);
  });
}

export const totalKB = (list) => list.reduce((s, p) => s + (p.sizeKB || 0), 0);

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;     // stop spreadsheet formulas from running
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(list) {
  const head = ['Name', 'Version', 'Publisher', 'Installed', 'Size (MB)', 'Source', 'Location'];
  const rows = list.map((p) => [p.name, p.version, p.publisher, p.installDate || '',
    p.sizeKB ? (p.sizeKB / 1024).toFixed(1) : '', p.source === 'store' ? 'Store' : 'Desktop', p.installLocation || '']);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function initials(name) {
  const w = String(name).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  return ((w[0] || '?')[0] + (w[1] ? w[1][0] : '')).toUpperCase();
}

export function hueFor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}
