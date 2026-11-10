'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { register } = require('../src/main/ipc');

const REG = JSON.stringify([
  { PSPath: 'Microsoft.PowerShell.Core\\Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Foo', PSChildName: 'Foo', DisplayName: 'Foo', DisplayVersion: '1.0', UninstallString: '"C:\\Program Files\\Foo\\unins.exe"', DisplayIcon: 'C:\\Program Files\\Foo\\foo.exe', InstallLocation: 'C:\\Program Files\\Foo' },
  { PSPath: 'Microsoft.PowerShell.Core\\Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{AC76BA86-7AD7-1033-7B44-AC0F074E4100}', PSChildName: '{AC76BA86-7AD7-1033-7B44-AC0F074E4100}', DisplayName: 'Reader', WindowsInstaller: 1, UninstallString: 'MsiExec.exe /I{AC76BA86-7AD7-1033-7B44-AC0F074E4100}' },
]);
const STORE = JSON.stringify([{ Name: 'Clipchamp.Clipchamp', PackageFullName: 'Clipchamp.Clipchamp_2.9_neutral__x', Publisher: 'CN=Microsoft', Version: '2.9', InstallLocation: 'C:\\x' }]);
const env = { ProgramFiles: 'C:\\Program Files', ProgramData: 'C:\\ProgramData', LOCALAPPDATA: 'C:\\Users\\Bob\\AppData\\Local', APPDATA: 'C:\\Users\\Bob\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\Bob', SystemRoot: 'C:\\Windows' };

function setup(over = {}) {
  const handlers = {}, sent = [], calls = { runFile: [], runExe: [], trash: [], ps: [] }, settings = { theme: 'system' };
  const win = { isDestroyed: () => false, webContents: { send: (c, d) => sent.push([c, d]) }, setTitleBarOverlay() {} };
  const deps = {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = (...a) => fn({}, ...a); } },
    app: { getFileIcon: async () => ({ isEmpty: () => false, toDataURL: () => 'data:image/png;base64,AAA' }), getPath: () => 'C:\\ud', quit() {} },
    shell: { trashItem: async (p) => { calls.trash.push(p); }, openPath: async () => '' },
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: 'C:\\out.csv' }) },
    nativeTheme: { themeSource: 'system', shouldUseDarkColors: false, on() {} },
    runPs: async (s) => { calls.ps.push(s); if (/Uninstall\\\*/.test(s)) return REG; if (/Get-AppxPackage \| Where-Object \{ -not/.test(s)) return STORE; if (/Test-Path/.test(s)) return over.stillInstalled ? 'True' : 'False'; if (/IsInRole/.test(s)) return 'False'; return ''; },
    runExe: async (f, a) => { calls.runExe.push([f, a]); return { code: (over.exeCodes || [])[calls.runExe.length - 1] || 0, stdout: '', stderr: '' }; },
    runFile: async (f, a, o) => { calls.runFile.push([f, a, o]); return { code: over.code || 0 }; },
    fsx: { exists: async () => false, sizeKB: async () => 42, mkdir: async () => {}, writeFile: async (p, d) => { calls.written = [p, d]; } },
    env, getWindow: () => win,
    store: { getSettings: () => settings, setSettings: (p) => Object.assign(settings, p), getHistory: () => [], addHistory: () => [] },
  };
  register(deps);
  return { h: handlers, sent, calls, deps, settings };
}
const tick = () => new Promise((r) => setTimeout(r, 20));

test('listing: registry + store apps, then icons and sizes arrive in the background', async () => {
  const { h, sent } = setup();
  const list = await h['programs:list']();
  assert.deepEqual(list.map((p) => p.name).sort(), ['Clipchamp', 'Foo', 'Reader']);
  await tick();
  assert.ok(sent.some(([c, d]) => c === 'program:icon' && d.dataUrl.startsWith('data:image')));
  assert.ok(sent.some(([c, d]) => c === 'program:size' && d.sizeKB === 42));
});

test('uninstall: the right command runs, and success is judged by the program disappearing', async () => {
  let t = setup();
  await t.h['programs:list']();
  let r = await t.h['programs:uninstall']('reg:HKLM:SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Foo', false);
  assert.deepEqual(r, { ok: true, stillInstalled: false, code: 0, message: '' });
  assert.equal(t.calls.runFile[0][0], 'cmd.exe');
  assert.equal(t.calls.runFile[0][2].verbatim, true);

  t = setup({ code: 0, stillInstalled: true });                                  // user pressed Cancel in the uninstaller
  await t.h['programs:list']();
  r = await t.h['programs:uninstall']('reg:HKLM:SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Foo', false);
  assert.equal(r.ok, false); assert.match(r.message, /cancelled/);

  t = setup({ code: 1603, stillInstalled: true });
  await t.h['programs:list']();
  r = await t.h['programs:uninstall']('reg:HKLM:SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Foo', false);
  assert.match(r.message, /1603/);

  t = setup();
  await t.h['programs:list']();
  await t.h['programs:uninstall']('reg:HKLM:SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{AC76BA86-7AD7-1033-7B44-AC0F074E4100}', true);
  assert.deepEqual(t.calls.runFile[0].slice(0, 2), ['msiexec.exe', ['/x', '{AC76BA86-7AD7-1033-7B44-AC0F074E4100}', '/qn', '/norestart']]);
  await t.h['programs:uninstall']('store:Clipchamp.Clipchamp_2.9_neutral__x', false);
  assert.equal(t.calls.runFile[1][0], 'powershell.exe');
  assert.equal((await t.h['programs:uninstall']('nope', false)).ok, false);       // the window cannot invent a program
});

test('the window cannot make us run or delete arbitrary things', async () => {
  const { h, calls } = setup();
  await h['programs:list']();
  const r = await h['leftovers:trash'](['C:\\Windows\\System32\\x.dll', 'C:\\Users\\Bob\\Documents\\a.docx', 'C:\\Program Files\\Foo', 'C:\\Users\\Bob\\AppData\\Roaming\\Foo']);
  assert.deepEqual(calls.trash, ['C:\\Program Files\\Foo', 'C:\\Users\\Bob\\AppData\\Roaming\\Foo']);
  assert.equal(r.ok.length, 2);
  assert.equal(r.failed.length, 2);
  assert.deepEqual((await h['leftovers:trash']('not an array')), { ok: [], failed: [] });
});

test('removing a broken entry: backup first, then delete, nothing if the backup fails', async () => {
  const id = 'reg:HKLM:SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Foo';
  let t = setup();
  await t.h['programs:list']();
  let r = await t.h['programs:removeEntry'](id);
  assert.equal(r.ok, true);
  assert.equal(t.calls.runExe[0][0], 'reg.exe'); assert.equal(t.calls.runExe[0][1][0], 'export');
  assert.deepEqual(t.calls.runExe[1], ['reg.exe', ['delete', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Foo', '/f']]);

  t = setup({ exeCodes: [1] });                                                  // export fails
  await t.h['programs:list']();
  r = await t.h['programs:removeEntry'](id);
  assert.equal(r.ok, false); assert.equal(t.calls.runExe.length, 1);
  assert.equal((await t.h['programs:removeEntry']('store:Clipchamp.Clipchamp_2.9_neutral__x')).ok, false);
});

test('settings, admin check, CSV export', async () => {
  const t = setup();
  const s = await t.h['settings:set']({ theme: 'dark' });
  assert.equal(s.theme, 'dark'); assert.equal(t.deps.nativeTheme.themeSource, 'dark');
  assert.equal(await t.h['system:isAdmin'](), false);
  assert.deepEqual(await t.h['export:csv']('a,b'), { ok: true, path: 'C:\\out.csv' });
  assert.deepEqual(t.calls.written, ['C:\\out.csv', '\ufeffa,b']);
  assert.equal((await t.h['export:csv'](123)).ok, false);
});
