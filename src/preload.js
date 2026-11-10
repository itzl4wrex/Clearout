'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel) => (cb) => {
  const fn = (_e, data) => cb(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('api', {
  listPrograms: call('programs:list'),
  uninstall: call('programs:uninstall'),
  scanLeftovers: call('programs:leftovers'),
  trash: call('leftovers:trash'),
  removeEntry: call('programs:removeEntry'),
  openFolder: call('programs:openFolder'),
  isAdmin: call('system:isAdmin'),
  relaunchAdmin: call('system:relaunchAdmin'),
  getSettings: call('settings:get'),
  setSettings: call('settings:set'),
  getHistory: call('history:get'),
  addHistory: call('history:add'),
  exportCsv: call('export:csv'),
  onIcon: on('program:icon'),
  onSize: on('program:size'),
  onTheme: on('theme:changed'),
});
