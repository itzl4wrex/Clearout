'use strict';
const { execFile, spawn } = require('child_process');

/** Run a PowerShell script, resolve with its text output. */
function runPs(script, { timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;' + script],
      { maxBuffer: 1 << 26, windowsHide: true, timeout, encoding: 'utf8' },
      (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().slice(0, 500))) : resolve(stdout)));
  });
}

/** Run a program with arguments (no shell). Never rejects on a non-zero exit code. */
function runExe(file, args, { timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/** Start an uninstaller and wait for it to finish. */
function runFile(file, args, { verbatim = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsVerbatimArguments: verbatim, stdio: 'ignore', windowsHide: false });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code }));
  });
}

module.exports = { runPs, runExe, runFile };
