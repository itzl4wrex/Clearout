'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/main/programs');

const row = (o) => ({ PSPath: `Microsoft.PowerShell.Core\\Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${o.PSChildName}`, ...o });

test('registry rows become a clean, de-duplicated list', () => {
  const list = P.parseRegistry([
    row({ PSChildName: '7-Zip', DisplayName: '7-Zip 23.01 (x64)', DisplayVersion: '23.01', Publisher: 'Igor Pavlov', InstallDate: '20240115', InstallLocation: 'C:\\Program Files\\7-Zip\\', UninstallString: '"C:\\Program Files\\7-Zip\\Uninstall.exe"', DisplayIcon: 'C:\\Program Files\\7-Zip\\7zFM.exe', EstimatedSize: 5500 }),
    row({ PSChildName: '7-Zip', DisplayName: '7-Zip 23.01 (x64)', DisplayVersion: '23.01', Publisher: 'Igor Pavlov' }),                 // duplicate
    row({ PSChildName: 'KB5001', DisplayName: 'Update for Microsoft Windows (KB5001234)', UninstallString: 'x' }),                         // update
    row({ PSChildName: 'Hidden', DisplayName: 'Hidden component', SystemComponent: 1, UninstallString: 'x' }),                          // system component
    row({ PSChildName: 'Child', DisplayName: 'Child patch', ParentKeyName: 'Parent', UninstallString: 'x' }),                           // belongs to a parent
    row({ PSChildName: 'Hotfix', DisplayName: 'Some hotfix', ReleaseType: 'Hotfix', UninstallString: 'x' }),
    { DisplayName: 'No path', UninstallString: 'x' },                                                                                     // no registry path
    row({ PSChildName: '', DisplayName: '' }),                                                                                           // no name
  ]);
  assert.equal(list.length, 1);
  const p = list[0];
  assert.equal(p.name, '7-Zip 23.01 (x64)');
  assert.equal(p.installDate, '2024-01-15');
  assert.equal(p.installLocation, 'C:\\Program Files\\7-Zip');
  assert.equal(p.sizeKB, 5500);
  assert.equal(p.iconPath, 'C:\\Program Files\\7-Zip\\7zFM.exe');
  assert.equal(p.hive, 'HKLM');
  assert.equal(p.canUninstall, true);
  assert.ok(p.regKey.startsWith('HKLM\\SOFTWARE'));
});

test('MSI programs, per-user programs and 32-bit programs are recognised', () => {
  const guid = '{AC76BA86-7AD7-1033-7B44-AC0F074E4100}';
  const list = P.parseRegistry([
    row({ PSChildName: guid, DisplayName: 'Reader', WindowsInstaller: 1, UninstallString: `MsiExec.exe /I${guid}` }),
    { PSPath: 'Microsoft.PowerShell.Core\\Registry::HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Discord', PSChildName: 'Discord', DisplayName: 'Discord', UninstallString: '"C:\\Users\\Bob\\AppData\\Local\\Discord\\Update.exe" --uninstall -s' },
    { PSPath: 'Microsoft.PowerShell.Core\\Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Old', PSChildName: 'Old', DisplayName: 'Old 32-bit app', UninstallString: 'C:\\old\\unins000.exe' },
  ]);
  assert.equal(list[0].msiGuid, guid);
  assert.equal(list[1].hive, 'HKCU');
  assert.equal(list[1].iconPath, 'C:\\Users\\Bob\\AppData\\Local\\Discord\\Update.exe');
  assert.equal(list[2].wow64, true);
  assert.equal(list[2].iconPath, 'C:\\old\\unins000.exe');
});

test('dates, sizes and icon paths from messy registry values', () => {
  assert.equal(P.isoDate('20240229'), '2024-02-29');
  assert.equal(P.isoDate('20230229'), null);          // not a real day
  assert.equal(P.isoDate('1899-01-01'), null);
  assert.equal(P.isoDate('garbage'), null);
  assert.equal(P.iconPath('"C:\\a b\\x.exe",0'), 'C:\\a b\\x.exe');
  assert.equal(P.iconPath('C:\\x.exe,-101'), 'C:\\x.exe');
  assert.equal(P.iconPath('', 'MsiExec.exe /X{1}'), null);
  assert.equal(P.iconPath(null, '"C:\\p q\\un.exe" /S'), 'C:\\p q\\un.exe');
});

test('store app names are made readable', () => {
  assert.equal(P.prettyStoreName('Microsoft.WindowsCalculator'), 'Windows Calculator');
  assert.equal(P.prettyStoreName('Microsoft.MicrosoftSolitaireCollection'), 'Microsoft Solitaire Collection');
  assert.equal(P.prettyStoreName('SpotifyAB.SpotifyMusic'), 'Spotify Music');
  assert.equal(P.prettyStoreName('Clipchamp.Clipchamp'), 'Clipchamp');
  assert.equal(P.prettyStoreName('king.com.CandyCrushSaga'), 'Candy Crush Saga');
  assert.equal(P.prettyStoreName('Calculator'), 'Calculator');
  const apps = P.parseStore([{ Name: 'Clipchamp.Clipchamp', PackageFullName: 'Clipchamp.Clipchamp_2.9.1.0_neutral__yxz26nhyzhsrt', Publisher: 'CN=Microsoft Corporation, O=Microsoft', Version: '2.9.1.0', InstallLocation: 'C:\\Program Files\\WindowsApps\\x' }, { Name: '' }]);
  assert.equal(apps.length, 1);
  assert.equal(apps[0].publisher, 'Microsoft Corporation');
  assert.equal(apps[0].canUninstall, true);
});

test('uninstall commands', () => {
  const guid = '{AC76BA86-7AD7-1033-7B44-AC0F074E4100}';
  const msi = { source: 'registry', msiGuid: guid, uninstallString: `MsiExec.exe /I${guid}` };
  assert.deepEqual(P.buildUninstallCommand(msi), { file: 'msiexec.exe', args: ['/x', guid], verbatim: false });
  assert.deepEqual(P.buildUninstallCommand(msi, { silent: true }).args, ['/x', guid, '/qn', '/norestart']);

  const exe = { source: 'registry', uninstallString: '"C:\\a b\\unins000.exe" /x', quietUninstallString: '"C:\\a b\\unins000.exe" /VERYSILENT' };
  assert.deepEqual(P.buildUninstallCommand(exe), { file: 'cmd.exe', args: ['/d', '/s', '/c', '""C:\\a b\\unins000.exe" /x"'], verbatim: true });
  assert.match(P.buildUninstallCommand(exe, { silent: true }).args[3], /VERYSILENT/);
  assert.match(P.buildUninstallCommand({ source: 'registry', uninstallString: 'u.exe' }, { silent: true }).args[3], /u\.exe/);   // no quiet string: normal one

  assert.equal(P.buildUninstallCommand({ source: 'registry' }), null);
  const store = { source: 'store', packageFullName: 'Clipchamp.Clipchamp_2.9.1.0_neutral__yxz26nhyzhsrt' };
  assert.match(P.buildUninstallCommand(store).args.at(-1), /^Remove-AppxPackage -Package 'Clipchamp/);
  assert.equal(P.buildUninstallCommand({ source: 'store', packageFullName: "x'; Remove-Item C:\\ -Recurse; '" }), null);   // injection attempt
});

test('"still installed?" scripts quote safely', () => {
  const s = P.stillInstalledScript({ source: 'registry', hive: 'HKCU', regKey: "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Bob's App" });
  assert.match(s, /Registry::HKEY_CURRENT_USER\\SOFTWARE/);
  assert.match(s, /Bob''s App/);
  assert.match(P.stillInstalledScript({ source: 'store', packageFullName: 'A_1_x' }), /Get-AppxPackage/);
});
