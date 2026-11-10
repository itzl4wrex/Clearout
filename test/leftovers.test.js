'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/main/leftovers');

const env = {
  ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramData: 'C:\\ProgramData',
  LOCALAPPDATA: 'C:\\Users\\Bob\\AppData\\Local', APPDATA: 'C:\\Users\\Bob\\AppData\\Roaming',
  USERPROFILE: 'C:\\Users\\Bob', PUBLIC: 'C:\\Users\\Public', SystemRoot: 'C:\\Windows',
};

test('safe to trash: normal leftovers are allowed', () => {
  for (const p of [
    'C:\\Program Files\\7-Zip', 'c:\\program files\\7-zip', 'C:\\Program Files (x86)\\Old App\\data',
    'C:\\Users\\Bob\\AppData\\Roaming\\Foo', 'C:\\Users\\Bob\\AppData\\Local\\Programs\\Foo',
    'C:\\Users\\Bob\\Desktop\\Foo.lnk', 'C:\\Users\\Public\\Desktop\\Foo.lnk', 'C:\\ProgramData\\Foo',
    'C:\\Users\\Bob\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Foo.lnk',
    'C:\\Users\\Bob\\AppData\\Local\\Microsoft\\Teams',
  ]) assert.equal(L.isSafeToTrash(p, env), true, p);
});

test('safe to trash: system, personal and container folders are refused', () => {
  for (const p of [
    'C:\\', 'C:\\Windows', 'C:\\Windows\\System32\\x.dll', 'C:\\Windows\\Temp\\a', 'C:\\Program Files', 'C:\\Program Files (x86)',
    'C:\\Program Files\\Common Files\\x', 'C:\\Program Files\\WindowsApps\\Some.App', 'C:\\Program Files\\Windows Defender\\x',
    'C:\\Users', 'C:\\Users\\Bob', 'C:\\Users\\Bob\\Documents\\thesis.docx', 'C:\\Users\\Bob\\Downloads', 'C:\\Users\\Bob\\Pictures\\a.jpg',
    'C:\\Users\\Bob\\AppData\\Local', 'C:\\Users\\Bob\\AppData\\Roaming', 'C:\\Users\\Bob\\AppData\\Local\\Programs',
    'C:\\Users\\Bob\\AppData\\Local\\Microsoft', 'C:\\Users\\Bob\\AppData\\Local\\Microsoft\\Windows\\INetCache',
    'C:\\Users\\Bob\\AppData\\Local\\Temp', 'C:\\Users\\Bob\\AppData\\Local\\Packages\\X',
    'C:\\Users\\Bob\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs',
    'C:\\Users\\Bob\\AppData\\Roaming\\Microsoft\\Windows\\Recent\\x', 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu',
    'C:\\Users\\Bob\\Desktop', 'D:\\Games\\Foo', 'relative\\path', '', '..', 'C:\\Program Files\\..\\Windows\\x',
    'C:\\Program Files\\7-Zip\0.exe', 'C:\\PROGRAM FILES',
  ]) assert.equal(L.isSafeToTrash(p, env), false, JSON.stringify(p));
  assert.equal(L.isSafeToTrash(null, env), false);
  assert.equal(L.isSafeToTrash('C:\\Program Files\\Foo', {}), false);        // unknown environment: refuse
});

test('candidates: exact install folder is ticked, settings never are', () => {
  const c = L.candidatePaths({ name: '7-Zip 23.01 (x64)', publisher: 'Igor Pavlov', installLocation: 'C:\\Program Files\\7-Zip' }, env);
  const by = (p) => c.find((x) => x.path.toLowerCase() === p.toLowerCase());
  assert.equal(by('C:\\Program Files\\7-Zip').defaultChecked, true);
  assert.equal(c.filter((x) => x.path.toLowerCase() === 'c:\\program files\\7-zip').length, 1);          // not listed twice
  assert.equal(by('C:\\Users\\Bob\\AppData\\Roaming\\7-Zip').defaultChecked, false);
  assert.equal(by('C:\\Users\\Bob\\AppData\\Roaming\\Igor Pavlov\\7-Zip').kind, 'data');
  assert.equal(by('C:\\Users\\Bob\\Desktop\\7-Zip.lnk').defaultChecked, true);
  assert.ok(c.every((x) => L.isSafeToTrash(x.path, env)), 'every candidate must pass the safety gate');
});

test('candidates: never guesses a parent folder shared by several versions', () => {
  const c = L.candidatePaths({ name: 'Python 3.12.1 (64-bit)', publisher: 'Python Software Foundation' }, env);
  const paths = c.map((x) => x.path.toLowerCase());
  assert.ok(!paths.includes('c:\\users\\bob\\appdata\\local\\programs\\python'));     // would remove every Python version
  const pf = c.find((x) => x.path === 'C:\\Program Files\\Python');
  assert.equal(pf && pf.defaultChecked, false);                                       // a guess is never pre-ticked
});

test('candidates: generic names and bad characters are ignored', () => {
  assert.deepEqual(L.candidatePaths({ name: 'Microsoft', publisher: 'Microsoft' }, env), []);
  assert.deepEqual(L.candidatePaths({ name: 'Java', publisher: 'Oracle' }, env), []);
  assert.deepEqual(L.candidatePaths({ name: 'AB', publisher: '' }, env), []);
  assert.deepEqual(L.candidatePaths({ name: 'Evil\\..\\..\\Windows', publisher: '' }, env), []);
  assert.equal(L.cleanName('Python 3.12.1 (64-bit)'), 'Python');
  assert.equal(L.cleanName('7-Zip 23.01 (x64)'), '7-Zip');
  assert.equal(L.cleanName('Git'), 'Git');
});

test('scan keeps only what exists and skips folders of other installed programs', async () => {
  const there = new Set(['c:\\program files\\foo', 'c:\\users\\bob\\appdata\\roaming\\foo', 'c:\\users\\bob\\desktop\\foo.lnk']);
  const fsx = { exists: async (p) => there.has(p.toLowerCase()), sizeKB: async () => 10 };
  const me = { id: 'a', name: 'Foo 1.2.3', publisher: '', installLocation: null };
  const items = await L.scanLeftovers(me, env, fsx, [me]);
  assert.deepEqual(items.map((i) => i.path.toLowerCase()).sort(),
    ['c:\\program files\\foo', 'c:\\users\\bob\\appdata\\roaming\\foo', 'c:\\users\\bob\\desktop\\foo.lnk']);
  assert.equal(items[0].sizeKB, 10);
  // another program is still installed inside "Program Files\Foo": the folder must not be offered
  const other = { id: 'b', name: 'Foo Plugin', installLocation: 'C:\\Program Files\\Foo\\Plugin' };
  const items2 = await L.scanLeftovers(me, env, fsx, [me, other]);
  assert.ok(!items2.some((i) => i.path.toLowerCase() === 'c:\\program files\\foo'));
  assert.ok(items2.some((i) => i.path.toLowerCase().endsWith('\\roaming\\foo')));
});
