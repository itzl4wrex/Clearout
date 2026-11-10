'use strict';
// Finds files an uninstaller left behind, and decides what is SAFE to move to the Recycle Bin.
// Uses Windows path rules everywhere, so it behaves the same when tested on another system.
const path = require('path').win32;

const DENY = new Set(['windows', 'microsoft', 'common files', 'program files', 'programdata', 'users', 'temp', 'tmp',
  'packages', 'system32', 'data', 'apps', 'app', 'application', 'application data', 'local', 'roaming', 'programs',
  'downloads', 'desktop', 'documents', 'setup', 'installer', 'update', 'updates', 'cache', 'logs', 'common', 'shared',
  'default', 'public', 'system', 'tools', 'bin', 'lib', 'windowsapps', 'microsoft shared', 'google', 'adobe', 'java']);

const norm = (p) => path.normalize(String(p)).replace(/[\\/]+$/, '').toLowerCase();
const inside = (child, parent) => child.startsWith(parent + '\\');

function roots(env) {
  const g = (k) => env[k] || '';
  const R = {
    pf: g('ProgramFiles'), pf86: g('ProgramFiles(x86)'), pd: g('ProgramData'), local: g('LOCALAPPDATA'),
    roam: g('APPDATA'), user: g('USERPROFILE'), pub: g('PUBLIC'), sys: g('SystemRoot') || g('windir') || 'C:\\Windows',
  };
  R.localPrograms = R.local && path.join(R.local, 'Programs');
  R.desktop = R.user && path.join(R.user, 'Desktop');
  R.pubDesktop = R.pub && path.join(R.pub, 'Desktop');
  R.smUser = R.roam && path.join(R.roam, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  R.smCommon = R.pd && path.join(R.pd, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  return R;
}

/** The ONLY gate for deleting anything: strictly inside a known user/program folder, never a container or Windows itself. */
function isSafeToTrash(p, env) {
  if (typeof p !== 'string' || !p || p.includes('\0') || !path.isAbsolute(p)) return false;
  const n = norm(p);
  const R = roots(env);
  const sys = norm(R.sys);
  if (n === sys || inside(n, sys)) return false;
  const allowed = [R.pf, R.pf86, R.pd, R.local, R.roam, R.desktop, R.pubDesktop].filter(Boolean).map(norm);
  if (!allowed.some((r) => inside(n, r))) return false;
  const j = (...a) => norm(path.join(...a));
  const exact = new Set();
  const add = (base, ...rest) => { if (base) exact.add(j(base, ...rest)); };
  for (const b of [R.pf, R.pf86]) { add(b, 'Common Files'); add(b, 'WindowsApps'); add(b, 'Microsoft'); }
  add(R.local, 'Programs'); add(R.local, 'Microsoft'); add(R.local, 'Microsoft', 'Windows'); add(R.local, 'Temp'); add(R.local, 'Packages');
  add(R.roam, 'Microsoft'); add(R.roam, 'Microsoft', 'Windows'); add(R.roam, 'Microsoft', 'Windows', 'Start Menu');
  add(R.pd, 'Microsoft'); add(R.pd, 'Microsoft', 'Windows'); add(R.pd, 'Microsoft', 'Windows', 'Start Menu');
  if (R.smUser) exact.add(norm(R.smUser));
  if (R.smCommon) exact.add(norm(R.smCommon));
  if (exact.has(n)) return false;
  const trees = [];
  for (const b of [R.pf, R.pf86]) {
    if (b) for (const x of ['WindowsApps', 'Windows Defender', 'Windows NT', 'Common Files', 'Internet Explorer', 'Windows Mail']) trees.push(j(b, x));
  }
  if (R.local) { trees.push(j(R.local, 'Packages')); trees.push(j(R.local, 'Microsoft', 'Windows')); }
  if (trees.some((t) => n === t || inside(n, t))) return false;
  for (const base of [R.roam, R.pd]) {         // Microsoft\Windows is off limits, except Start Menu\Programs
    if (!base) continue;
    if (inside(n, j(base, 'Microsoft', 'Windows')) && !inside(n, j(base, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))) return false;
  }
  return true;
}

function cleanName(name) {
  return String(name)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(x64|x86|64-bit|32-bit|64bit|32bit)\b/gi, ' ')
    .replace(/\s+v?\d+(\.\d+)+\S*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function usable(n) {
  const s = String(n || '').trim();
  return s.length >= 3 && !DENY.has(s.toLowerCase()) && !/[\\/:*?"<>|]/.test(s) && !/^\.+$/.test(s);
}

/** Places where this program's files might still be. kind: install | data | shortcut. */
function candidatePaths(p, env) {
  const R = roots(env);
  const out = new Map();
  const add = (pth, kind, checked) => {
    if (!pth || !isSafeToTrash(pth, env)) return;
    const k = norm(pth);
    if (!out.has(k)) out.set(k, { path: path.normalize(pth), kind, defaultChecked: checked });
  };
  const exact = usable(p.name) ? String(p.name).trim() : null;
  const stripped = usable(cleanName(p.name)) ? cleanName(p.name) : null;
  const pub = usable(p.publisher) ? String(p.publisher).trim() : null;
  const names = [...new Set([exact, stripped].filter(Boolean))];

  if (p.installLocation) add(p.installLocation, 'install', true);
  for (const base of [R.pf, R.pf86]) if (base) for (const n of names) add(path.join(base, n), 'install', n === exact);
  if (R.localPrograms && exact) add(path.join(R.localPrograms, exact), 'install', true);
  for (const base of [R.local, R.roam, R.pd]) {            // settings and data: never ticked automatically
    if (!base) continue;
    for (const n of names) {
      add(path.join(base, n), 'data', false);
      if (pub) add(path.join(base, pub, n), 'data', false);
    }
  }
  for (const sm of [R.smUser, R.smCommon]) {
    if (sm) for (const n of names) { add(path.join(sm, n), 'shortcut', true); add(path.join(sm, n + '.lnk'), 'shortcut', true); }
  }
  for (const d of [R.desktop, R.pubDesktop]) if (d) for (const n of names) add(path.join(d, n + '.lnk'), 'shortcut', true);
  return [...out.values()];
}

/** Candidates that really exist, minus anything that belongs to another program still installed. */
async function scanLeftovers(p, env, fsx, others = []) {
  const otherLocs = others.filter((o) => o.id !== p.id && o.installLocation).map((o) => norm(o.installLocation));
  const items = [];
  for (const c of candidatePaths(p, env)) {
    if (!(await fsx.exists(c.path))) continue;
    const n = norm(c.path);
    if (otherLocs.some((l) => l === n || inside(l, n) || inside(n, l))) continue;
    let sizeKB = 0;
    try { sizeKB = await fsx.sizeKB(c.path); } catch { /* unknown size */ }
    items.push({ ...c, sizeKB });
  }
  return items;
}

module.exports = { isSafeToTrash, candidatePaths, scanLeftovers, cleanName, usable, norm };
