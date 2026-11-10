'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/renderer/logic.js');
const NOW = new Date(Date.UTC(2026, 10, 10));
const progs = [
  { id: '1', name: 'Zoom', publisher: 'Zoom Video', version: '5.1', sizeKB: 300000, installDate: '2026-11-01', source: 'registry' },
  { id: '2', name: 'Visual Studio', publisher: 'Microsoft', version: '17', sizeKB: 6 * 1024 * 1024, installDate: '2025-01-01', source: 'registry' },
  { id: '3', name: 'Clipchamp', publisher: 'Microsoft Corporation', version: '2.9', sizeKB: null, installDate: null, source: 'store' },
  { id: '4', name: 'apple Music', publisher: 'Apple', version: '1', sizeKB: 50, installDate: '2026-10-20', source: 'registry' },
];

test('sizes and dates read well', async () => {
  const L = await load();
  assert.deepEqual([L.formatSize(null), L.formatSize(0), L.formatSize(300), L.formatSize(2048), L.formatSize(5 * 1024 * 1024)], ['—', '—', '300 KB', '2.0 MB', '5.00 GB']);
  assert.equal(L.formatDate('2024-01-15'), '15 Jan 2024');
  assert.equal(L.formatDate('nope'), '—');
  assert.deepEqual(['2026-11-10', '2026-11-09', '2026-11-01', '2026-06-10', '2024-11-10'].map((d) => L.ago(d, NOW)), ['today', 'yesterday', '9 days ago', '5 months ago', '2 years ago']);
});

test('filters, search and counts', async () => {
  const L = await load();
  assert.deepEqual(L.filterPrograms(progs, { filter: 'large' }, NOW).map((p) => p.id), ['2']);        // 300 MB is below the 500 MB line
  assert.deepEqual(L.filterPrograms(progs, { filter: 'recent' }, NOW).map((p) => p.id), ['1', '4']);
  assert.deepEqual(L.filterPrograms(progs, { filter: 'store' }, NOW).map((p) => p.id), ['3']);
  assert.deepEqual(L.filterPrograms(progs, { query: 'microsoft' }, NOW).map((p) => p.id), ['2', '3']);  // matches publisher too
  assert.deepEqual(L.filterPrograms(progs, { query: 'ZOOM 5' }, NOW).map((p) => p.id), ['1']);          // every word must match
  assert.deepEqual(L.countFilters(progs, NOW), { all: 4, large: 1, recent: 2, store: 1 });
});

test('sorting puts unknown values last in both directions', async () => {
  const L = await load();
  assert.deepEqual(L.sortPrograms(progs, 'name').map((p) => p.name), ['apple Music', 'Clipchamp', 'Visual Studio', 'Zoom']);   // case-insensitive
  assert.deepEqual(L.sortPrograms(progs, 'size', -1).map((p) => p.id), ['2', '1', '4', '3']);
  assert.deepEqual(L.sortPrograms(progs, 'size', 1).map((p) => p.id), ['4', '1', '2', '3']);
  assert.deepEqual(L.sortPrograms(progs, 'date', -1).map((p) => p.id), ['1', '4', '2', '3']);
});

test('CSV export is escaped and safe to open in a spreadsheet', async () => {
  const L = await load();
  const csv = L.toCsv([{ name: '=SUM(A1)', version: '1', publisher: 'A, "B"', installDate: '2024-01-02', sizeKB: 2048, source: 'store', installLocation: 'C:\\x' }]);
  const [head, line] = csv.split('\r\n');
  assert.equal(head, 'Name,Version,Publisher,Installed,Size (MB),Source,Location');
  assert.equal(line, `'=SUM(A1),1,"A, ""B""",2024-01-02,2.0,Store,C:\\x`);     // formula neutralised, quotes doubled
  assert.equal(L.initials('Visual Studio Code'), 'VS');
  assert.equal(L.initials('7-Zip'), '7Z');
});
