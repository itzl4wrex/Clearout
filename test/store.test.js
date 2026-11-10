'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../src/main/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'clearout-'));

test('settings: defaults, validation, persistence', () => {
  const dir = tmp();
  const s = createStore(dir, fs);
  assert.deepEqual(s.getSettings(), { theme: 'system', accent: '#7c5cff', silent: false, adminBannerDismissed: false });
  s.setSettings({ theme: 'dark', accent: '#14b8a6', silent: true });
  s.setSettings({ theme: 'neon', accent: 'red', silent: 'yes' });                 // nonsense is ignored
  const again = createStore(dir, fs).getSettings();
  assert.deepEqual([again.theme, again.accent, again.silent], ['dark', '#14b8a6', true]);
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);                       // no temp file left behind
});

test('history: newest first, capped, sanitised; a corrupt file is survived', () => {
  const dir = tmp();
  const s = createStore(dir, fs);
  for (let i = 0; i < 505; i++) s.addHistory({ name: `P${i}`, result: 'ok', freedKB: i });
  const h = s.getHistory();
  assert.equal(h.length, 500);
  assert.equal(h[0].name, 'P504');
  const e = s.addHistory({ name: 'x'.repeat(500), result: 'bogus', freedKB: -5 })[0];
  assert.equal(e.name.length, 200); assert.equal(e.result, 'failed'); assert.equal(e.freedKB, 0);
  fs.writeFileSync(path.join(dir, 'history.json'), '{not json');
  assert.deepEqual(s.getHistory(), []);
  fs.writeFileSync(path.join(dir, 'settings.json'), 'garbage');
  assert.equal(s.getSettings().theme, 'system');
});
