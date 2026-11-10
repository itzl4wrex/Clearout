'use strict';
// Tiny JSON storage for settings and uninstall history (written safely: temp file, then rename).
const path = require('path');

const DEFAULTS = { theme: 'system', accent: '#7c5cff', silent: false, adminBannerDismissed: false };
const THEMES = ['system', 'light', 'dark'];

function createStore(dir, fs) {
  const file = (name) => path.join(dir, name);
  const read = (name, fallback) => {
    try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
  };
  const write = (name, data) => {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file(name) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file(name));
  };
  return {
    getSettings() { return { ...DEFAULTS, ...read('settings.json', {}) }; },
    setSettings(partial) {
      const next = this.getSettings();
      const p = partial || {};
      if (THEMES.includes(p.theme)) next.theme = p.theme;
      if (typeof p.accent === 'string' && /^#[0-9a-f]{6}$/i.test(p.accent)) next.accent = p.accent;
      if (typeof p.silent === 'boolean') next.silent = p.silent;
      if (typeof p.adminBannerDismissed === 'boolean') next.adminBannerDismissed = p.adminBannerDismissed;
      write('settings.json', next);
      return next;
    },
    getHistory() { const h = read('history.json', []); return Array.isArray(h) ? h : []; },
    addHistory(entry) {
      const e = {
        name: String(entry.name || '').slice(0, 200), version: String(entry.version || '').slice(0, 60),
        date: new Date().toISOString(), result: ['ok', 'cancelled', 'failed'].includes(entry.result) ? entry.result : 'failed',
        freedKB: Math.max(0, Math.round(Number(entry.freedKB) || 0)),
      };
      const list = [e, ...this.getHistory()].slice(0, 500);
      write('history.json', list);
      return list;
    },
  };
}

module.exports = { createStore, DEFAULTS };
