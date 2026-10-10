#!/usr/bin/env node
// make_icons.mjs — thin shim so `npm run icons` / `npm run build:store`
// (package.json, which this task must not edit) keep working.
//
// The real icon generator is tools/make_icons.py (Python + Pillow/numpy —
// same stack as the territory-clash precedent it was ported from). This
// just spawns it. Run the Python script directly if you prefer:
//
//     python tools/make_icons.py

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'make_icons.py');

for (const py of ['python', 'python3']) {
  const res = spawnSync(py, [script], { stdio: 'inherit' });
  if (!res.error) {
    process.exit(res.status ?? 0);
  }
}
console.error('[make_icons] could not find a "python" or "python3" on PATH.');
process.exit(1);
