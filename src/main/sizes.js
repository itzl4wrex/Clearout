'use strict';
const path = require('path');

/** Size of a file or folder in KB. Stops early (returning what it has) on huge folders. */
async function sizeKB(p, fsp, { maxEntries = 200000, maxMs = 15000 } = {}) {
  const st = await fsp.stat(p);
  if (st.isFile()) return Math.round(st.size / 1024);
  const t0 = Date.now();
  let bytes = 0, n = 0;
  const stack = [p];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (++n > maxEntries || Date.now() - t0 > maxMs) return Math.round(bytes / 1024);
      const full = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) { try { bytes += (await fsp.stat(full)).size; } catch { /* skip */ } }
    }
  }
  return Math.round(bytes / 1024);
}

module.exports = { sizeKB };
