import { formatSize, formatDate, ago, filterPrograms, sortPrograms, totalKB, toCsv, initials, hueFor, countFilters, FILTERS } from './logic.js';
import { icon, iconSvg } from './icons.js';

const api = window.api;
const $ = (s, r = document) => r.querySelector(s);

/** Build DOM safely: all text goes in as text nodes, never as HTML. */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'checked' || k === 'value' || k === 'disabled' || k === 'hidden') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

if (!api) {
  document.body.textContent = 'Clearout must be opened from its desktop app.';
  throw new Error('window.api is missing');
}

const ACCENTS = ['#7c5cff', '#3b82f6', '#14b8a6', '#f59e0b', '#ef4444', '#ec4899'];
const state = {
  programs: [], icons: new Map(), filter: 'all', view: 'programs', query: '', sort: { key: 'name', dir: 1 },
  selected: new Set(), detailId: null, settings: { theme: 'system', accent: '#7c5cff', silent: false, adminBannerDismissed: false },
  history: [], loading: true, error: null, isAdmin: true,
};

document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = iconSvg(el.dataset.icon); });

// ---------------------------------------------------------------- theme
function applyTheme() {
  const t = state.settings.theme;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--accent', state.settings.accent);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
if (api.onTheme) api.onTheme(applyTheme);

async function saveSettings(partial) {
  state.settings = await api.setSettings(partial);
  applyTheme();
  renderAll();
}

// ---------------------------------------------------------------- helpers
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderList(); renderDetail(); renderActionBar(); renderNav(); });
}

function toast(msg, bad = false) {
  const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4200);
}

function avatar(p, big = false) {
  const url = state.icons.get(p.id);
  if (url) return h('div', { class: 'avatar' + (big ? ' big' : '') }, h('img', { src: url, alt: '' }));
  const a = h('div', { class: 'avatar' + (big ? ' big' : '') }, initials(p.name));
  a.style.background = `hsl(${hueFor(p.name)} 52% 52%)`;
  return a;
}

const visible = () => sortPrograms(filterPrograms(state.programs, { query: state.query, filter: state.filter }), state.sort.key, state.sort.dir);
const byId = (id) => state.programs.find((p) => p.id === id);

// ---------------------------------------------------------------- modals
const modalStack = [];
function openModal({ title, body, footer = [], dismissible = true, onClose }) {
  const scrim = h('div', { class: 'scrim', onmousedown: (e) => { if (e.target === scrim && dismissible) close(); } });
  const bodyEl = h('div', { class: 'body' }, body);
  const footEl = h('footer', {}, footer);
  const titleEl = h('h2', {}, title);
  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', {}, titleEl, dismissible ? h('button', { class: 'btn ghost icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('x')) : null),
    bodyEl, footEl);
  scrim.append(modal);
  $('#modals').append(scrim);
  const handle = { el: modal, bodyEl, footEl, dismissible, close, setTitle: (t) => { titleEl.textContent = t; }, setFooter: (f) => footEl.replaceChildren(...[f].flat()) };
  function close(result) {
    if (!scrim.isConnected) return;
    scrim.remove();
    const i = modalStack.indexOf(handle);
    if (i >= 0) modalStack.splice(i, 1);
    if (onClose) onClose(result);
  }
  modalStack.push(handle);
  return handle;
}

function confirmModal({ title, body, confirmText = 'Continue', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    const m = openModal({
      title, body, onClose: () => finish(false),
      footer: [h('button', { class: 'btn', type: 'button', onclick: () => finish(false) }, 'Cancel'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', onclick: () => finish(true) }, confirmText)],
    });
  });
}

// ---------------------------------------------------------------- sidebar + header
function renderNav() {
  const counts = countFilters(state.programs);
  const nav = $('#nav');
  const icons = { all: 'box', large: 'weight', recent: 'clock', store: 'store' };
  nav.replaceChildren(
    ...FILTERS.map((f) => h('button', {
      class: 'nav-item' + (state.view === 'programs' && state.filter === f.id ? ' active' : ''), type: 'button',
      onclick: () => { state.view = 'programs'; state.filter = f.id; renderAll(); },
    }, icon(icons[f.id]), h('span', {}, f.label), h('span', { class: 'count' }, state.loading ? '' : counts[f.id]))),
    h('div', { class: 'nav-sep' }),
    h('button', {
      class: 'nav-item' + (state.view === 'history' ? ' active' : ''), type: 'button',
      onclick: async () => { state.view = 'history'; state.detailId = null; state.history = await api.getHistory(); renderAll(); },
    }, icon('history'), h('span', {}, 'History')));
  const total = totalKB(state.programs);
  $('#summary').replaceChildren(h('b', {}, state.loading ? '…' : String(state.programs.length)), `programs · ${formatSize(total)} known size`);
}

function renderHeader() {
  const title = state.view === 'history' ? 'History' : (FILTERS.find((f) => f.id === state.filter) || FILTERS[0]).label;
  $('#title').textContent = title;
  if (state.view === 'history') {
    $('#subtitle').textContent = 'Everything you removed with Clearout';
  } else if (state.loading) {
    $('#subtitle').textContent = 'Reading your installed programs…';
  } else {
    const items = visible();
    $('#subtitle').textContent = `${items.length} ${items.length === 1 ? 'program' : 'programs'} · ${formatSize(totalKB(items))}`;
  }
  document.querySelector('.tools').hidden = state.view === 'history';
  document.querySelector('#btn-refresh .ico').classList.toggle('spin', !!state.refreshing);
  $('#sort').value = `${state.sort.key}:${state.sort.dir}`;
}

function renderBanner() {
  const b = $('#admin-banner');
  if (state.isAdmin || state.settings.adminBannerDismissed) { b.hidden = true; return; }
  b.hidden = false;
  b.replaceChildren(icon('shield'), h('div', { class: 'grow' }, 'Some programs and folders need administrator rights to be removed.'),
    h('button', { class: 'btn small', type: 'button', onclick: restartAsAdmin }, 'Restart as administrator'),
    h('button', { class: 'btn ghost small icon-btn', type: 'button', 'aria-label': 'Dismiss', onclick: () => saveSettings({ adminBannerDismissed: true }) }, icon('x')));
}

async function restartAsAdmin() {
  const r = await api.relaunchAdmin();
  if (!r.ok) toast(r.message || 'Could not restart as administrator.', true);
}

// ---------------------------------------------------------------- list
function toggleSelect(id) {
  if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
  renderList(); renderActionBar();
}

function emptyState(iconName, title, text, action) {
  return h('div', { class: 'empty' }, icon(iconName), h('h3', {}, title), h('div', {}, text), action || null);
}

function headRow(items) {
  const allOn = items.length > 0 && items.every((p) => state.selected.has(p.id));
  const sortBtn = (key, label, cls = '') => h('button', {
    type: 'button', class: cls,
    onclick: () => { state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : (key === 'name' ? 1 : -1) }; renderAll(); },
  }, label, state.sort.key === key ? (state.sort.dir === 1 ? ' ↑' : ' ↓') : '');
  return h('div', { class: 'list-head' },
    h('label', { class: 'check', title: 'Select all shown' },
      h('input', { type: 'checkbox', checked: allOn, 'aria-label': 'Select all shown', onchange: (e) => { items.forEach((p) => (e.target.checked ? state.selected.add(p.id) : state.selected.delete(p.id))); renderList(); renderActionBar(); } }),
      h('span', { class: 'box' }, icon('check'))),
    h('span'), sortBtn('name', 'Name'), sortBtn('size', 'Size', 'right'), sortBtn('date', 'Installed'), h('span'));
}

function row(p) {
  const on = state.selected.has(p.id);
  return h('div', {
    class: 'row' + (on ? ' selected' : '') + (state.detailId === p.id ? ' active' : ''), role: 'listitem', tabindex: '0', 'data-id': p.id,
    onclick: () => openDetail(p.id),
    onkeydown: (e) => { if (e.key === 'Enter') openDetail(p.id); },
  },
    h('label', { class: 'check', onclick: (e) => e.stopPropagation() },
      h('input', { type: 'checkbox', checked: on, 'aria-label': `Select ${p.name}`, onchange: () => toggleSelect(p.id) }),
      h('span', { class: 'box' }, icon('check'))),
    avatar(p),
    h('div', { class: 'name' }, h('div', { class: 'title' }, p.name), h('div', { class: 'sub' }, [p.publisher, p.version].filter(Boolean).join(' · ') || (p.source === 'store' ? 'Microsoft Store' : ''))),
    h('div', { class: 'size right' }, formatSize(p.sizeKB)),
    h('div', { class: 'date' }, p.installDate ? formatDate(p.installDate) : '—'),
    h('button', { class: 'btn small act', type: 'button', onclick: (e) => { e.stopPropagation(); startUninstall([p]); } }, icon('trash'), 'Uninstall'));
}

function renderList() {
  renderHeader();
  const list = $('#list');
  if (state.view === 'history') { renderHistory(list); return; }
  if (state.loading) {
    list.replaceChildren(...Array.from({ length: 8 }, () => h('div', { class: 'skeleton' },
      h('i', { style: 'width:20px;height:20px' }), h('i', { style: 'width:36px;height:36px;border-radius:10px' }),
      h('i', { style: 'flex:1;height:14px' }), h('i', { style: 'width:70px;height:14px' }))));
    return;
  }
  if (state.error) {
    list.replaceChildren(emptyState('alert', "Couldn't read your programs", state.error,
      h('button', { class: 'btn primary', type: 'button', onclick: () => refresh() }, 'Try again')));
    return;
  }
  const items = visible();
  if (!items.length) {
    list.replaceChildren(emptyState('search', 'Nothing found',
      state.query ? `No program matches “${state.query}”.` : 'No programs in this view yet.'));
    return;
  }
  list.replaceChildren(headRow(items), ...items.map(row));
}

function renderHistory(list) {
  if (!state.history.length) {
    list.replaceChildren(emptyState('history', 'Nothing here yet', 'Programs you uninstall with Clearout will be listed here.'));
    return;
  }
  const freed = state.history.reduce((s, e) => s + (e.freedKB || 0), 0);
  const chip = { ok: ['ok', 'Removed'], cancelled: ['warn', 'Cancelled'], failed: ['fail', 'Failed'] };
  list.replaceChildren(
    h('div', { class: 'item', style: 'padding:14px 18px' }, icon('sparkle'), h('div', { class: 'grow' }, h('div', { class: 't' }, `${formatSize(freed)} freed so far`), h('div', { class: 's' }, `${state.history.length} entries`))),
    ...state.history.map((e) => h('div', { class: 'item', style: 'padding:12px 18px' },
      h('div', { class: 'grow' }, h('div', { class: 't' }, e.name), h('div', { class: 's' }, [e.version, `${formatDate(e.date)}`].filter(Boolean).join(' · '))),
      h('span', { class: 'chip ' + (chip[e.result] || chip.failed)[0] }, (chip[e.result] || chip.failed)[1]),
      h('span', { class: 'note', style: 'width:80px;text-align:right' }, e.freedKB ? formatSize(e.freedKB) : ''))));
}

// ---------------------------------------------------------------- detail panel
function openDetail(id) { state.detailId = id; renderList(); renderDetail(); }
function closeDetail() { state.detailId = null; renderList(); renderDetail(); }

function renderDetail() {
  const el = $('#detail');
  const p = byId(state.detailId);
  if (!p || state.view !== 'programs') { el.hidden = true; el.replaceChildren(); return; }
  el.hidden = false;
  const kv = (k, v) => [h('dt', {}, k), h('dd', {}, v)];
  el.replaceChildren(
    h('div', { class: 'head' }, avatar(p, true),
      h('div', {}, h('h2', {}, p.name), h('div', { class: 'note' }, p.publisher || 'Unknown publisher')),
      h('button', { class: 'btn ghost icon-btn close', type: 'button', 'aria-label': 'Close details', onclick: closeDetail }, icon('x'))),
    h('dl', { class: 'kv' },
      kv('Version', p.version || '—'), kv('Size', formatSize(p.sizeKB)),
      kv('Installed', p.installDate ? `${formatDate(p.installDate)} (${ago(p.installDate)})` : '—'),
      kv('Type', p.source === 'store' ? 'Microsoft Store app' : p.wow64 ? 'Desktop program (32-bit)' : 'Desktop program'),
      p.installLocation ? kv('Location', p.installLocation) : null),
    p.installLocation ? h('button', { class: 'btn small', type: 'button', style: 'align-self:flex-start', onclick: () => api.openFolder(p.id) }, icon('external'), 'Open install folder') : null,
    p.uninstallString ? h('div', {}, h('div', { class: 'note', style: 'margin-bottom:4px' }, 'Uninstall command'), h('div', { class: 'mono' }, p.uninstallString)) : null,
    h('div', { class: 'stack' },
      p.canUninstall
        ? h('button', { class: 'btn danger', type: 'button', onclick: () => startUninstall([p]) }, icon('trash'), 'Uninstall')
        : h('p', { class: 'note' }, 'This program has no uninstaller of its own.'),
      p.source === 'registry' ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => removeEntryFlow(p) }, 'Remove broken entry from the list…') : null));
}

async function removeEntryFlow(p) {
  const ok = await confirmModal({
    title: 'Remove this entry?', danger: true, confirmText: 'Remove entry',
    body: h('div', {}, h('p', {}, `“${p.name}” will disappear from Windows' list of installed programs. Its files are not deleted.`),
      h('p', { class: 'note' }, 'Use this only when the uninstaller is missing or broken. A backup of the entry is saved first.')),
  });
  if (!ok) return;
  const r = await api.removeEntry(p.id);
  toast(r.ok ? 'Entry removed. A backup was saved.' : r.message || 'Could not remove the entry.', !r.ok);
  if (r.ok) { state.detailId = null; await refresh(); }
}

// ---------------------------------------------------------------- action bar
function renderActionBar() {
  const bar = $('#actionbar');
  const sel = state.programs.filter((p) => state.selected.has(p.id));
  if (!sel.length || state.view !== 'programs') { bar.hidden = true; bar.replaceChildren(); return; }
  bar.hidden = false;
  bar.replaceChildren(
    h('div', { class: 'info' }, h('b', {}, `${sel.length} selected`), h('span', {}, formatSize(totalKB(sel)))),
    h('label', { class: 'toggle', title: 'Skip the uninstaller windows when the program supports it' },
      h('input', { type: 'checkbox', checked: state.settings.silent, onchange: (e) => saveSettings({ silent: e.target.checked }) }), 'Silent'),
    h('button', { class: 'btn ghost', type: 'button', onclick: () => { state.selected.clear(); renderList(); renderActionBar(); } }, 'Clear'),
    h('button', { class: 'btn danger', type: 'button', onclick: () => startUninstall(sel) }, icon('trash'), sel.length === 1 ? 'Uninstall' : `Uninstall ${sel.length}`));
}

// ---------------------------------------------------------------- uninstall flow
async function startUninstall(list) {
  const items = list.filter((p) => p.canUninstall);
  if (!items.length) { toast('Nothing selected can be uninstalled.', true); return; }
  const silent = h('input', { type: 'checkbox', checked: state.settings.silent });
  const shown = items.slice(0, 6);
  const ok = await confirmModal({
    title: items.length === 1 ? `Uninstall ${items[0].name}?` : `Uninstall ${items.length} programs?`,
    confirmText: 'Uninstall', danger: true,
    body: h('div', {},
      ...shown.map((p) => h('div', { class: 'item' }, avatar(p), h('div', { class: 'grow' }, h('div', { class: 't' }, p.name), h('div', { class: 's' }, [p.version, formatSize(p.sizeKB)].filter((x) => x && x !== '—').join(' · '))))),
      items.length > shown.length ? h('p', { class: 'note' }, `…and ${items.length - shown.length} more`) : null,
      h('p', { class: 'note' }, "Each program's own uninstaller does the work. Afterwards Clearout looks for leftover files and lets you choose what to remove."),
      h('label', { class: 'toggle' }, silent, 'Silent mode (skip uninstaller windows when possible)')),
  });
  if (!ok) return;
  if (silent.checked !== state.settings.silent) saveSettings({ silent: silent.checked });
  closeDetail();

  const ui = new Map();
  const setStatus = (id, kind, text, detail) => {
    const u = ui.get(id);
    u.chip.className = 'chip ' + ({ run: 'run', ok: 'ok', warn: 'warn', fail: 'fail' }[kind] || '');
    u.chip.textContent = text;
    u.sub.textContent = detail || '';
  };
  const body = h('div', {}, items.map((p) => {
    const chip = h('span', { class: 'chip' }, 'Waiting');
    const sub = h('div', { class: 's' }, '');
    ui.set(p.id, { chip, sub });
    return h('div', { class: 'item' }, avatar(p), h('div', { class: 'grow' }, h('div', { class: 't' }, p.name), sub), chip);
  }));
  const progress = openModal({ title: 'Uninstalling…', body, dismissible: false });

  let removed = 0, freed = 0;
  for (const p of items) {
    setStatus(p.id, 'run', 'Running', silent.checked ? 'Working in the background…' : "Follow the uninstaller's window");
    let r;
    try { r = await api.uninstall(p.id, silent.checked); } catch (e) { r = { ok: false, message: e.message }; }
    if (r.ok) {
      removed += 1;
      setStatus(p.id, 'ok', 'Removed', r.message || 'Looking for leftovers…');
      let left = [];
      try { left = await api.scanLeftovers(p.id); } catch { left = []; }
      const freedLeft = left.length ? await leftoversModal(p, left) : 0;
      freed += (p.sizeKB || 0) + freedLeft;
      setStatus(p.id, 'ok', 'Removed', freedLeft ? `Leftovers cleared (${formatSize(freedLeft)})` : (r.message || ''));
      await api.addHistory({ name: p.name, version: p.version, result: 'ok', freedKB: (p.sizeKB || 0) + freedLeft });
    } else {
      const cancelled = r.stillInstalled && !r.code;
      setStatus(p.id, cancelled ? 'warn' : 'fail', cancelled ? 'Cancelled' : 'Failed', r.message);
      await api.addHistory({ name: p.name, version: p.version, result: cancelled ? 'cancelled' : 'failed', freedKB: 0 });
    }
  }
  progress.setTitle(removed === items.length ? 'All done' : `Finished: ${removed} of ${items.length} removed`);
  progress.bodyEl.append(h('p', { class: 'note', style: 'margin-top:10px' }, freed ? `About ${formatSize(freed)} freed.` : 'Nothing was freed.'));
  progress.setFooter(h('button', { class: 'btn primary', type: 'button', onclick: () => progress.close() }, 'Close'));
  state.selected.clear();
  await refresh();
}

const KIND = { install: 'Program files', data: 'Settings and data', shortcut: 'Shortcut' };

function leftoversModal(p, items) {
  return new Promise((resolve) => {
    const boxes = items.map((it) => h('input', { type: 'checkbox', checked: it.defaultChecked, 'aria-label': it.path }));
    const body = h('div', {},
      h('p', { class: 'note', style: 'margin-top:0' }, `${p.name} left these behind. Tick what you want to remove. Everything goes to the Recycle Bin, so you can restore it.`),
      ...items.map((it, i) => h('div', { class: 'item' },
        h('label', { class: 'check' }, boxes[i], h('span', { class: 'box' }, icon('check'))),
        h('div', { class: 'grow' }, h('div', { class: 't' }, KIND[it.kind] || 'Item'), h('div', { class: 's' }, it.path),
          it.kind === 'data' ? h('div', { class: 's' }, 'May contain your settings or saved data.') : null),
        h('span', { class: 'note' }, it.sizeKB ? formatSize(it.sizeKB) : ''))),
      h('p', { class: 'note' }, 'Very large items may be deleted permanently if they do not fit in your Recycle Bin.'));
    let done = false;
    const finish = (kb) => { if (done) return; done = true; m.close(); resolve(kb); };
    const trashBtn = h('button', {
      class: 'btn primary', type: 'button',
      onclick: async () => {
        const chosen = items.filter((_, i) => boxes[i].checked);
        if (!chosen.length) { finish(0); return; }
        trashBtn.disabled = true; trashBtn.textContent = 'Moving…';
        const r = await api.trash(chosen.map((c) => c.path));
        const okSet = new Set(r.ok);
        const kb = chosen.filter((c) => okSet.has(c.path)).reduce((s, c) => s + (c.sizeKB || 0), 0);
        toast(r.failed.length ? `Moved ${r.ok.length}, ${r.failed.length} could not be removed (try administrator mode).` : `Moved ${r.ok.length} item${r.ok.length === 1 ? '' : 's'} to the Recycle Bin.`, r.failed.length > 0);
        finish(kb);
      },
    }, 'Move selected to Recycle Bin');
    const m = openModal({
      title: `Leftovers from ${p.name}`, body, dismissible: false,
      footer: [h('button', { class: 'btn', type: 'button', onclick: () => finish(0) }, 'Keep them'), trashBtn],
    });
  });
}

// ---------------------------------------------------------------- settings
function openSettings() {
  const body = h('div', {});
  const draw = () => {
    const s = state.settings;
    body.replaceChildren(
      h('div', { class: 'setting' }, h('div', {}, 'Theme', h('small', {}, 'System follows Windows')),
        h('div', { class: 'seg' }, ...['system', 'light', 'dark'].map((t) => h('button', { type: 'button', class: s.theme === t ? 'on' : '', onclick: async () => { await saveSettings({ theme: t }); draw(); } }, t[0].toUpperCase() + t.slice(1))))),
      h('div', { class: 'setting' }, 'Accent color',
        h('div', { class: 'swatches' }, ...ACCENTS.map((c) => { const b = h('button', { type: 'button', class: s.accent === c ? 'on' : '', 'aria-label': c, onclick: async () => { await saveSettings({ accent: c }); draw(); } }); b.style.background = c; return b; }))),
      h('div', { class: 'setting' }, h('div', {}, 'Silent uninstall', h('small', {}, 'Skip uninstaller windows when a program supports it')),
        h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: s.silent, onchange: async (e) => { await saveSettings({ silent: e.target.checked }); } }))),
      h('div', { class: 'setting' }, h('div', {}, 'Export program list', h('small', {}, 'Save what you see as a CSV file')),
        h('button', { class: 'btn small', type: 'button', onclick: async () => { const r = await api.exportCsv(toCsv(visible())); if (r.ok) toast('Saved.'); else if (!r.canceled) toast(r.message || 'Could not save.', true); } }, icon('download'), 'Export')),
      h('div', { class: 'setting' }, h('div', {}, 'Administrator mode', h('small', {}, state.isAdmin ? 'Clearout has administrator rights.' : 'Needed to remove some programs and folders.')),
        state.isAdmin ? h('span', { class: 'chip ok' }, 'Active') : h('button', { class: 'btn small', type: 'button', onclick: restartAsAdmin }, 'Restart as administrator')));
  };
  draw();
  openModal({ title: 'Settings', body, footer: [h('button', { class: 'btn primary', type: 'button', onclick: () => modalStack[modalStack.length - 1].close() }, 'Done')] });
}

// ---------------------------------------------------------------- load + wire up
async function refresh() {
  state.loading = state.programs.length === 0;       // first load shows placeholders; later refreshes keep the list
  state.refreshing = true; state.error = null;
  renderAll();
  try { state.programs = await api.listPrograms(); } catch (e) { state.error = e.message || String(e); state.programs = []; }
  state.loading = false; state.refreshing = false;
  const ids = new Set(state.programs.map((p) => p.id));
  state.selected = new Set([...state.selected].filter((id) => ids.has(id)));
  if (state.detailId && !ids.has(state.detailId)) state.detailId = null;
  renderAll();
}

function renderAll() { renderNav(); renderList(); renderDetail(); renderActionBar(); renderBanner(); }

$('#q').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });
$('#sort').addEventListener('change', (e) => { const [key, dir] = e.target.value.split(':'); state.sort = { key, dir: Number(dir) }; renderList(); });
$('#btn-refresh').addEventListener('click', () => refresh());
$('#btn-settings').addEventListener('click', openSettings);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#q').focus(); $('#q').select(); }
  if (e.key === 'Escape') {
    const top = modalStack[modalStack.length - 1];
    if (top) { if (top.dismissible) top.close(); } else if (state.detailId) closeDetail();
  }
});
if (api.onIcon) api.onIcon(({ id, dataUrl }) => { state.icons.set(id, dataUrl); scheduleRender(); });
if (api.onSize) api.onSize(({ id, sizeKB }) => { const p = byId(id); if (p) { p.sizeKB = sizeKB; scheduleRender(); } });

(async function init() {
  try { state.settings = await api.getSettings(); } catch { /* defaults */ }
  applyTheme();
  refresh();
  try { state.isAdmin = await api.isAdmin(); } catch { state.isAdmin = true; }
  renderBanner();
})();
