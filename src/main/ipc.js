'use strict';
// Everything the window may ask for. The window only ever sends program IDs; this side looks the
// program up itself, so the window can never make us run an arbitrary command.
const path = require('path');
const P = require('./programs');
const { scanLeftovers, isSafeToTrash } = require('./leftovers');

function overlayFor(dark) {
  return dark ? { color: '#16161a', symbolColor: '#ededf2', height: 44 } : { color: '#f5f5f8', symbolColor: '#1b1b22', height: 44 };
}

function register(deps) {
  const { ipcMain, app, shell, dialog, nativeTheme, runPs, runExe, runFile, fsx, env, store, getWindow } = deps;
  let programs = new Map();
  let generation = 0;

  const send = (channel, payload) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };
  const handle = (channel, fn) => ipcMain.handle(channel, async (_event, ...args) => fn(...args));
  const parse = (text) => { try { return JSON.parse(text || '[]'); } catch { return []; } };
  const applyOverlay = () => {
    const w = getWindow();
    if (w && typeof w.setTitleBarOverlay === 'function') {
      try { w.setTitleBarOverlay(overlayFor(nativeTheme.shouldUseDarkColors)); } catch { /* not supported */ }
    }
  };

  async function background(list, gen) {          // icons and missing sizes arrive later, one by one
    for (const p of list) {
      if (gen !== generation) return;
      if (!p.iconPath) continue;
      try {
        const img = await app.getFileIcon(p.iconPath, { size: 'normal' });
        if (img && !img.isEmpty()) send('program:icon', { id: p.id, dataUrl: img.toDataURL() });
      } catch { /* no icon */ }
    }
    for (const p of list) {
      if (gen !== generation) return;
      if (p.sizeKB == null && p.installLocation) {
        try {
          const kb = await fsx.sizeKB(p.installLocation);
          if (kb > 0) { p.sizeKB = kb; send('program:size', { id: p.id, sizeKB: kb }); }
        } catch { /* folder missing */ }
      }
    }
  }

  handle('programs:list', async () => {
    const [reg, store_] = await Promise.all([runPs(P.REG_SCRIPT), runPs(P.STORE_SCRIPT).catch(() => '[]')]);
    const list = [...P.parseRegistry(parse(reg)), ...P.parseStore(parse(store_))];
    programs = new Map(list.map((p) => [p.id, p]));
    generation += 1;
    background(list, generation);
    return list;
  });

  handle('programs:uninstall', async (id, silent) => {
    const p = programs.get(id);
    if (!p) return { ok: false, message: 'Unknown program. Refresh the list and try again.' };
    const cmd = P.buildUninstallCommand(p, { silent: !!silent });
    if (!cmd) return { ok: false, message: 'This program has no uninstaller. You can remove its broken entry instead.' };
    let code;
    try {
      ({ code } = await runFile(cmd.file, cmd.args, { verbatim: cmd.verbatim }));
    } catch (e) {
      return { ok: false, message: `Couldn't start the uninstaller: ${e.message}` };
    }
    let still = true;
    try { still = /true/i.test(await runPs(P.stillInstalledScript(p))); } catch { still = code !== 0; }
    let message = '';
    if (still) message = code ? `The uninstaller reported an error (code ${code}).` : 'The program is still installed. The uninstall may have been cancelled.';
    else if (code === 3010 || code === 1641) message = 'Done. A restart is needed to finish.';
    return { ok: !still, stillInstalled: still, code, message };
  });

  handle('programs:leftovers', async (id) => {
    const p = programs.get(id);
    if (!p) return [];
    return scanLeftovers(p, env, fsx, [...programs.values()]);
  });

  handle('leftovers:trash', async (paths) => {
    const ok = [];
    const failed = [];
    for (const p of Array.isArray(paths) ? paths : []) {
      if (!isSafeToTrash(p, env)) { failed.push({ path: p, error: 'Not allowed: this location is protected.' }); continue; }
      try { await shell.trashItem(p); ok.push(p); } catch (e) { failed.push({ path: p, error: e.message }); }
    }
    return { ok, failed };
  });

  handle('programs:removeEntry', async (id) => {
    const p = programs.get(id);
    if (!p || p.source !== 'registry' || !p.regKey) return { ok: false, message: 'This is not a registry entry.' };
    const dir = path.join(app.getPath('userData'), 'backups');
    await fsx.mkdir(dir);
    const safe = p.name.replace(/[^\w.-]+/g, '_').slice(0, 60);
    const file = path.join(dir, `${safe}-${Date.now()}.reg`);
    const exp = await runExe('reg.exe', ['export', p.regKey, file, '/y']);
    if (exp.code !== 0) return { ok: false, message: 'Could not back up the entry first, so nothing was removed.' };
    const del = await runExe('reg.exe', ['delete', p.regKey, '/f']);
    if (del.code !== 0) return { ok: false, message: 'Windows refused. Try "Restart as administrator" first.' };
    programs.delete(id);
    return { ok: true, backup: file };
  });

  handle('programs:openFolder', async (id) => {
    const p = programs.get(id);
    return p && p.installLocation ? shell.openPath(p.installLocation) : 'No install folder known.';
  });

  handle('system:isAdmin', async () => { try { return /true/i.test(await runPs(P.ADMIN_SCRIPT)); } catch { return false; } });
  handle('system:relaunchAdmin', async () => {
    const exe = String(process.execPath).replace(/'/g, "''");
    const r = await runExe('powershell.exe', ['-NoProfile', '-Command', `Start-Process -FilePath '${exe}' -Verb RunAs`]);
    if (r.code === 0) { setTimeout(() => app.quit(), 300); return { ok: true }; }
    return { ok: false, message: 'Administrator permission was not given.' };
  });

  handle('settings:get', () => store.getSettings());
  handle('settings:set', (partial) => {
    const s = store.setSettings(partial);
    nativeTheme.themeSource = s.theme;
    applyOverlay();
    return s;
  });
  handle('history:get', () => store.getHistory());
  handle('history:add', (entry) => store.addHistory(entry || {}));

  handle('export:csv', async (text) => {
    if (typeof text !== 'string' || text.length > 5e6) return { ok: false, message: 'Nothing to export.' };
    const r = await dialog.showSaveDialog(getWindow(), { defaultPath: 'installed-programs.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    await fsx.writeFile(r.filePath, '\ufeff' + text);
    return { ok: true, path: r.filePath };
  });

  nativeTheme.on('updated', () => {
    applyOverlay();
    send('theme:changed', { dark: nativeTheme.shouldUseDarkColors });
  });
}

module.exports = { register, overlayFor };
