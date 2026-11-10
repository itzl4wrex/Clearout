'use strict';
// Turns what Windows reports (registry + Store apps) into one clean list, and builds uninstall commands.

const SKIP_RELEASE = /^(update|security update|hotfix|update rollup|service pack|critical update)$/i;
const GUID = /\{[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}\}/;
const pad = (n) => String(n).padStart(2, '0');
const str = (v) => (v == null ? '' : String(v).trim());

function toKB(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function isoDate(v) {
  const s = str(v);
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s) || /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1990 || y > new Date().getUTCFullYear() + 1) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

function iconPath(displayIcon, uninstallString) {
  let s = str(displayIcon);
  if (s) {
    s = s.replace(/^"([^"]+)".*$/, '$1').replace(/,\s*-?\d+$/, '');
    if (/\.(exe|ico|dll)$/i.test(s)) return s;
  }
  const u = str(uninstallString);
  const m = /^"([^"]+\.exe)"/i.exec(u) || /^([^\s"]+\.exe)/i.exec(u);
  return m && !/msiexec/i.test(m[1]) ? m[1] : null;
}

function parseRegistry(rows) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    const name = str(r && r.DisplayName);
    if (!name) continue;
    if (Number(r.SystemComponent) === 1) continue;
    if (str(r.ParentKeyName) || str(r.ParentDisplayName)) continue;
    if (SKIP_RELEASE.test(str(r.ReleaseType))) continue;
    if (/^(KB\d{6,}|Security Update for|Update for Microsoft)/i.test(name)) continue;
    const m = /Registry::(HKEY_[A-Z_]+)\\(.+)$/i.exec(str(r.PSPath));
    if (!m) continue;
    const hiveName = m[1].toUpperCase();
    const hive = hiveName === 'HKEY_LOCAL_MACHINE' ? 'HKLM' : hiveName === 'HKEY_CURRENT_USER' ? 'HKCU' : null;
    if (!hive) continue;
    const keyPath = m[2];
    const version = str(r.DisplayVersion);
    const publisher = str(r.Publisher);
    const key = `${name.toLowerCase()}|${version}|${publisher.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const uninstallString = str(r.UninstallString) || null;
    const quiet = str(r.QuietUninstallString) || null;
    const isMsi = Number(r.WindowsInstaller) === 1 || /msiexec/i.test(uninstallString || '');
    let msiGuid = null;
    if (isMsi) {
      const g = GUID.exec(str(r.PSChildName)) || GUID.exec(uninstallString || '');
      msiGuid = g ? g[0] : null;
    }
    out.push({
      id: `reg:${hive}:${keyPath}`,
      source: 'registry',
      name,
      version,
      publisher,
      installDate: isoDate(r.InstallDate),
      installLocation: str(r.InstallLocation).replace(/^"|"$/g, '').replace(/\\+$/, '') || null,
      sizeKB: toKB(r.EstimatedSize),
      uninstallString,
      quietUninstallString: quiet,
      msiGuid,
      regKey: `${hive}\\${keyPath}`,
      hive,
      wow64: /WOW6432Node/i.test(keyPath),
      iconPath: iconPath(r.DisplayIcon, uninstallString),
      packageFullName: null,
      canUninstall: !!(uninstallString || quiet || msiGuid),
    });
  }
  return out;
}

function prettyStoreName(name) {
  let parts = String(name).split('.').filter(Boolean);
  if (parts.length >= 3 && /^(com|net|org)$/i.test(parts[1])) parts = parts.slice(2);     // king.com.CandyCrush -> CandyCrush
  else if (parts.length >= 2) parts = parts.slice(1);                                     // Vendor.AppName -> AppName
  return parts.join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim() || String(name);
}

function parseStore(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.PackageFullName && r.Name)
    .map((r) => {
      const cn = /CN=([^,]+)/.exec(str(r.Publisher));
      return {
        id: `store:${r.PackageFullName}`,
        source: 'store',
        name: prettyStoreName(r.Name),
        version: str(r.Version),
        publisher: cn ? cn[1].replace(/"/g, '') : str(r.Publisher),
        installDate: null,
        installLocation: str(r.InstallLocation) || null,
        sizeKB: null,
        uninstallString: null,
        quietUninstallString: null,
        msiGuid: null,
        regKey: null,
        hive: null,
        wow64: false,
        iconPath: null,
        packageFullName: str(r.PackageFullName),
        canUninstall: true,
      };
    });
}

/** What to run to uninstall `p`. Returns null when there is no way to do it. */
function buildUninstallCommand(p, { silent = false } = {}) {
  if (!p) return null;
  if (p.source === 'store') {
    if (!/^[\w.\-~]+$/.test(p.packageFullName || '')) return null;
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
        `Remove-AppxPackage -Package '${p.packageFullName}'`],
      verbatim: false,
    };
  }
  if (p.msiGuid) {
    return { file: 'msiexec.exe', args: ['/x', p.msiGuid, ...(silent ? ['/qn', '/norestart'] : [])], verbatim: false };
  }
  const cmd = silent && p.quietUninstallString ? p.quietUninstallString : p.uninstallString;
  if (!cmd) return null;
  return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${cmd}"`], verbatim: true };
}

const psq = (s) => String(s).replace(/'/g, "''");

/** PowerShell that prints True/False: is this program still installed? */
function stillInstalledScript(p) {
  if (p.source === 'store') {
    return `@(Get-AppxPackage | Where-Object { $_.PackageFullName -eq '${psq(p.packageFullName)}' }).Count -gt 0`;
  }
  const full = p.hive === 'HKCU' ? 'HKEY_CURRENT_USER' : 'HKEY_LOCAL_MACHINE';
  const rest = p.regKey.replace(/^HK(LM|CU)\\/, '');
  return `Test-Path -LiteralPath 'Registry::${full}\\${psq(rest)}'`;
}

const REG_SCRIPT = String.raw`$p='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'; $r=@(Get-ItemProperty -Path $p -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object DisplayName,DisplayVersion,Publisher,InstallDate,InstallLocation,UninstallString,QuietUninstallString,DisplayIcon,EstimatedSize,SystemComponent,WindowsInstaller,ParentKeyName,ParentDisplayName,ReleaseType,PSChildName,PSPath); ConvertTo-Json -InputObject $r -Compress -Depth 3`;
const STORE_SCRIPT = String.raw`$r=@(Get-AppxPackage | Where-Object { -not $_.IsFramework -and -not $_.NonRemovable -and $_.SignatureKind -ne 'System' -and $_.InstallLocation } | Select-Object Name,PackageFullName,Publisher,Version,InstallLocation); ConvertTo-Json -InputObject $r -Compress -Depth 3`;
const ADMIN_SCRIPT = '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)';

module.exports = {
  parseRegistry, parseStore, prettyStoreName, buildUninstallCommand, stillInstalledScript,
  isoDate, iconPath, psq, REG_SCRIPT, STORE_SCRIPT, ADMIN_SCRIPT,
};
