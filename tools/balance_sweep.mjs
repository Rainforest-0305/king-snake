// balance_sweep.mjs — ② 난도 후보를 «측정»으로 고른다. 브라우저 없음(창 0).
//
//   node tools/balance_sweep.mjs [--seeds 24]
//
// ★ 왜 스윕인가: 「봇을 좀 늘리면 어려워지겠지」는 «추측»이다. 이 게임은 밀도가
//   MAP_SCALE 에 묶여 있어서 상수 하나를 올려도 체감이 안 바뀌는 일이 실제로 있다
//   (맵 2.0→3.0 이 deathsMean 3.92→3.88 로 «거의 안 움직였다» — 이 레인 실측).
//   그래서 후보를 여러 개 만들어 «같은 시드»로 재고, 숫자로 고른다.
//
// ★ config.ts 를 «임시로» 고쳐 번들을 만들고 «반드시 되돌린다». 원본은 메모리에
//   들고 있다가 finally 에서 복원한다 — 중간에 죽어도 워킹트리가 안 더러워진다.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SEEDS = process.argv.includes('--seeds')
  ? Number(process.argv[process.argv.indexOf('--seeds') + 1]) : 24;

const CFG = new URL('../src/game/config.ts', import.meta.url);
const ORIGINAL = readFileSync(CFG, 'utf8');
mkdirSync(new URL('../_bal/', import.meta.url), { recursive: true });

/** 후보: [이름, [ [정규식, 치환], ... ] ] */
const CANDIDATES = [
  ['base   (변경 없음)', []],
  ['A bot31', [[/export const BOT_COUNT_BASE = 28;/, 'export const BOT_COUNT_BASE = 31;']]],
  ['B bot30+big.14', [
    [/export const BOT_COUNT_BASE = 28;/, 'export const BOT_COUNT_BASE = 30;'],
    [/export const SPAWN_MASS_BIG_FRAC = 0.11;/, 'export const SPAWN_MASS_BIG_FRAC = 0.14;'],
  ]],
  ['C big.15+med.34', [
    [/export const SPAWN_MASS_BIG_FRAC = 0.11;/, 'export const SPAWN_MASS_BIG_FRAC = 0.15;'],
    [/export const SPAWN_MASS_MED_FRAC = 0.30;/, 'export const SPAWN_MASS_MED_FRAC = 0.34;'],
  ]],
  ['D bot31+big.14', [
    [/export const BOT_COUNT_BASE = 28;/, 'export const BOT_COUNT_BASE = 31;'],
    [/export const SPAWN_MASS_BIG_FRAC = 0.11;/, 'export const SPAWN_MASS_BIG_FRAC = 0.14;'],
  ]],
  ['E bot33', [[/export const BOT_COUNT_BASE = 28;/, 'export const BOT_COUNT_BASE = 33;']]],
];

const rows = [];
try {
  for (const [name, edits] of CANDIDATES) {
    let src = ORIGINAL;
    for (const [re, to] of edits) {
      if (!re.test(src)) throw new Error(`${name}: 패턴을 못 찾았다 — ${re}`); // 죽은 스윕 방지
      src = src.replace(re, to);
    }
    writeFileSync(CFG, src);
    const out = new URL(`../_bal/sweep.mjs`, import.meta.url);
    execFileSync('npx', ['esbuild', 'src/game/world.ts', '--bundle', '--format=esm',
      '--platform=node', `--outfile=_bal/sweep.mjs`, '--log-level=error'],
      { stdio: 'inherit', shell: true });
    const raw = execFileSync('node', ['tools/qa_early.mjs', '_bal/sweep.mjs', '--seeds', String(SEEDS)],
      { encoding: 'utf8' });
    const j = JSON.parse(raw.trim().split('\n').pop());
    rows.push({
      name,
      deaths150: j.earlyDeath.deathsMean150s,
      le30: j.earlyDeath.firstDeathLe30s,
      le60: j.earlyDeath.firstDeathLe60s,
      cross: j.cross3s.pct,
      minDistMed: j.cross3s.minDistMed,
    });
    console.log(`${name.padEnd(20)} deaths150=${j.earlyDeath.deathsMean150s}  <=30s=${j.earlyDeath.firstDeathLe30s}/${SEEDS}  <=60s=${j.earlyDeath.firstDeathLe60s}/${SEEDS}  cross3s=${j.cross3s.pct}%`);
    void out;
  }
} finally {
  writeFileSync(CFG, ORIGINAL); // ★무슨 일이 있어도 원복
  console.log('\nconfig.ts 원복 완료');
}

const base = rows[0];
console.log('\n기준(base) 대비 변화율');
for (const r of rows.slice(1)) {
  const d = ((r.deaths150 - base.deaths150) / base.deaths150) * 100;
  console.log(`  ${r.name.padEnd(20)} deaths150 ${base.deaths150} -> ${r.deaths150}  (${d >= 0 ? '+' : ''}${d.toFixed(1)}%)`);
}
void pathToFileURL;
