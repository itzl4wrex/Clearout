'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, nativeTheme, shell, dialog, Menu } = require('electron');
const { register, overlayFor } = require('./main/ipc');
const { createStore } = require('./main/store');
const { runPs, runExe, runFile } = require('./main/ps');
const { sizeKB } = require('./main/sizes');

let win = null;

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 920, minHeight: 600, show: false,
    backgroundColor: dark ? '#16161a' : '#f5f5f8',
    title: 'Clearout',
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayFor(dark),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    const store = createStore(app.getPath('userData'), fs);
    nativeTheme.themeSource = store.getSettings().theme;
    const fsx = {
      exists: async (p) => { try { await fs.promises.access(p); return true; } catch { return false; } },
      sizeKB: (p) => sizeKB(p, fs.promises),
      mkdir: (p) => fs.promises.mkdir(p, { recursive: true }),
      writeFile: (p, data) => fs.promises.writeFile(p, data, 'utf8'),
    };
    register({ ipcMain, app, shell, dialog, nativeTheme, runPs, runExe, runFile, fsx, env: process.env, store, getWindow: () => win });
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
