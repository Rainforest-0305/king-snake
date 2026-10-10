#!/usr/bin/env node
// make_pwa.mjs — thin shim so `npm run pwa` / `npm run build:store`
// (package.json, which this task must not edit) keep working.
//
// The real PWA assembler is tools/build_pwa.py (ported from
// territory-clash/store/build_pwa.py). This just spawns it. Run the Python
// script directly if you prefer:
//
//     python tools/build_pwa.py

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'build_pwa.py');

for (const py of ['python', 'python3']) {
  const res = spawnSync(py, [script], { stdio: 'inherit' });
  if (!res.error) {
    process.exit(res.status ?? 0);
  }
}
console.error('[make_pwa] could not find a "python" or "python3" on PATH.');
process.exit(1);
