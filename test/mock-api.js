// Stand-in for the Windows side, so the window can be tried in any browser (used by tests only).
(() => {
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const mk = (id, name, publisher, version, sizeMB, days, extra = {}) => ({
    id, source: 'registry', name, publisher, version, installDate: days == null ? null : day(days),
    installLocation: `C:\\Program Files\\${name.split(' ')[0]}`, sizeKB: sizeMB == null ? null : Math.round(sizeMB * 1024),
    uninstallString: `"C:\\Program Files\\${name.split(' ')[0]}\\unins000.exe"`, quietUninstallString: null, msiGuid: null,
    regKey: `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${id}`, hive: 'HKLM', wow64: false, iconPath: 'x.exe',
    packageFullName: null, canUninstall: true, ...extra,
  });
  const store = (id, name, ver, days) => ({ ...mk(id, name, 'Microsoft Corporation', ver, null, days), source: 'store', id: 'store:' + id, installLocation: null, uninstallString: null, regKey: null, hive: null, packageFullName: id, iconPath: null });
  let list = [
    mk('r1', '7-Zip 23.01 (x64)', 'Igor Pavlov', '23.01', 5.4, 120),
    mk('r2', 'Google Chrome', 'Google LLC', '131.0.6778', 612, 3),
    mk('r3', 'Visual Studio Community 2022', 'Microsoft Corporation', '17.12', 6400, 200),
    mk('r4', 'Discord', 'Discord Inc.', '1.0.9175', 380, 12),
    mk('r5', 'Steam', 'Valve Corporation', '3.0', 2300, 340),
    mk('r6', 'Spotify', 'Spotify AB', '1.2.50', 310, 2),
    mk('r7', 'VLC media player', 'VideoLAN', '3.0.21', 180, 500),
    mk('r8', 'Notepad++', 'Notepad++ Team', '8.6.9', 12, 60),
    mk('r9', 'Python 3.12.1 (64-bit)', 'Python Software Foundation', '3.12.1', 98, 90),
    mk('r10', 'Zoom Workplace', 'Zoom Communications', '6.2.0', 420, 25),
    mk('r11', 'WinRAR 7.01', 'win.rar GmbH', '7.01', null, null, { canUninstall: false, uninstallString: null }),
    mk('r12', 'Node.js', 'Node.js Foundation', '22.11.0', 76, 15, { msiGuid: '{11111111-2222-3333-4444-555555555555}' }),
    store('Clipchamp.Clipchamp_2.9_x', 'Clipchamp', '2.9.1', 30),
    store('Microsoft.MicrosoftSolitaireCollection_4_x', 'Microsoft Solitaire Collection', '4.20', 400),
    store('Microsoft.XboxApp_48_x', 'Xbox', '48.1', 8),
  ];
  let history = [];
  let settings = { theme: 'system', accent: '#7c5cff', silent: false, adminBannerDismissed: false };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const iconFor = (name, hue) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="hsl(${hue} 70% 55%)"/><text x="16" y="21" font-size="14" text-anchor="middle" fill="white" font-family="sans-serif">${name[0]}</text></svg>`);
  const cb = { icon: [], size: [], theme: [] };
  window.__calls = [];
  window.api = {
    listPrograms: async () => {
      await sleep(250);
      setTimeout(() => { list.slice(0, 6).forEach((p, i) => cb.icon.forEach((f) => f({ id: p.id, dataUrl: iconFor(p.name, i * 60) }))); }, 200);
      setTimeout(() => { const p = list.find((x) => x.id === 'r11'); if (p) cb.size.forEach((f) => f({ id: 'r11', sizeKB: 45000 })); }, 400);
      return list.map((p) => ({ ...p }));
    },
    uninstall: async (id, silent) => {
      window.__calls.push(['uninstall', id, silent]);
      await sleep(350);
      if (id === 'r10') return { ok: false, stillInstalled: true, code: 0, message: 'The program is still installed. The uninstall may have been cancelled.' };
      if (id === 'r4') return { ok: false, stillInstalled: true, code: 1603, message: 'The uninstaller reported an error (code 1603).' };
      list = list.filter((p) => p.id !== id);
      return { ok: true, stillInstalled: false, code: 0, message: '' };
    },
    scanLeftovers: async (id) => (id === 'r1' ? [
      { path: 'C:\\Program Files\\7-Zip', kind: 'install', defaultChecked: true, sizeKB: 1200 },
      { path: 'C:\\Users\\Bob\\AppData\\Roaming\\7-Zip', kind: 'data', defaultChecked: false, sizeKB: 12 },
      { path: 'C:\\Users\\Bob\\Desktop\\7-Zip.lnk', kind: 'shortcut', defaultChecked: true, sizeKB: 1 },
    ] : []),
    trash: async (paths) => { window.__calls.push(['trash', paths]); await sleep(150); return { ok: paths, failed: [] }; },
    removeEntry: async (id) => { window.__calls.push(['removeEntry', id]); list = list.filter((p) => p.id !== id); return { ok: true, backup: 'C:\\b.reg' }; },
    openFolder: async () => '',
    isAdmin: async () => false,
    relaunchAdmin: async () => ({ ok: true }),
    getSettings: async () => ({ ...settings }),
    setSettings: async (p) => { settings = { ...settings, ...p }; return { ...settings }; },
    getHistory: async () => history,
    addHistory: async (e) => { history = [{ ...e, date: new Date().toISOString() }, ...history]; return history; },
    exportCsv: async (text) => { window.__csv = text; return { ok: true, path: 'C:\\x.csv' }; },
    onIcon: (f) => { cb.icon.push(f); }, onSize: (f) => { cb.size.push(f); }, onTheme: (f) => { cb.theme.push(f); },
  };
})();
