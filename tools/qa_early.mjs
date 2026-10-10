// qa_early.mjs - 판 «초반» 실측: 거대 봇 가로지름 · 초반 사망. 브라우저 없음(창 없음).
//
// ★ 왜 (2026-08-29 레인 -12): 직전 레인의 미결 2건이 맵 확장으로 바뀌는지 «다시 재라».
//   1) 「거대 봇이 시작 3초 안에 플레이어를 가로지름」
//      = t<=3s 동안 «질량이 플레이어의 4배 이상인 봇»의 몸통 점이 플레이어 머리에
//        가장 가까이 온 거리(min). 그 값이 CROSS 유닛 아래로 들어온 시드 수를 «가로지름»으로 센다.
//        CROSS = 플레이어 시작 반지름 + R_MAX + 60 ≈ 100 유닛(= 한 번 꺾어야 피하는 거리).
//        플레이어는 «입력 없이 직진»한다(사람이 아직 손을 못 댄 3초를 흉내낸다).
//   2) 「초반 사망」 = autoPilot(봇 두뇌가 플레이어 조종) 판에서 30초·60초 안에 죽은 시드 비율,
//      그리고 직전 레인과 같은 150초 평균 사망 수(deathsMean).
//
// 사용: node tools/qa_early.mjs <bundle.mjs> [--seeds N] [--json out]
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const bundle = argv[0];
if (!bundle) { console.error('usage: node tools/qa_early.mjs <bundle.mjs> [--seeds N] [--json out]'); process.exit(2); }
let seeds = 24;
let jsonOut = '';
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === '--seeds') seeds = Number(argv[++i]);
  else if (argv[i] === '--json') jsonOut = argv[++i];
}
const mod = await import(pathToFileURL(bundle).href);
const { World } = mod;
const cfg = mod.__cfg ?? {};
const DT = 1 / 60;
const S0 = 20260818;
const STRIDE = 7919;
const CROSS = (cfg.R_MIN ?? 6.2) + (cfg.R_MAX ?? 34) + 60;

const med = (a) => { const b = [...a].sort((x, y) => x - y); if (!b.length) return 0; const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;

/** 플레이어 머리 → «거대 봇» 몸까지 최소 거리(이 프레임). */
function nearestBig(w) {
  const p = w.player;
  let best = Infinity;
  for (const s of w.snakes) {
    if (s === p || !s.alive || s.mass < p.mass * 4) continue;
    const n = s.trail.count;
    for (let i = 0; i < n; i += 2) {
      const d = Math.hypot(s.trail.x(i) - p.x, s.trail.y(i) - p.y);
      if (d < best) best = d;
    }
    const dh = Math.hypot(s.x - p.x, s.y - p.y);
    if (dh < best) best = dh;
  }
  return best;
}

// 1) 가로지름(직진 플레이어, 3초)
const minD = [];
let crossed = 0;
let diedIn3 = 0;
for (let k = 0; k < seeds; k++) {
  const w = new World(S0 + k * STRIDE, 'QA', 'default', false);
  let best = nearestBig(w);
  for (let i = 1; i <= Math.round(3 / DT); i++) {
    w.step(DT);
    if (!w.player.alive) { diedIn3++; break; }
    const d = nearestBig(w);
    if (d < best) best = d;
  }
  minD.push(best);
  if (best < CROSS) crossed++;
}

// 2) 초반 사망(autoPilot, 150초)
let d30 = 0, d60 = 0;
const deaths = [];
for (let k = 0; k < seeds; k++) {
  const w = new World(S0 + k * STRIDE, 'QA', 'default', true);
  let n = 0, wasAlive = true, first = -1;
  const steps = Math.round(150 / DT);
  for (let i = 1; i <= steps; i++) {
    w.step(DT);
    const a = w.player.alive;
    if (wasAlive && !a) { n++; if (first < 0) first = i * DT; }
    wasAlive = a;
  }
  deaths.push(n);
  if (first >= 0 && first <= 30) d30++;
  if (first >= 0 && first <= 60) d60++;
}

const report = {
  seeds, worldR: cfg.WORLD_R, botCount: cfg.BOT_COUNT, foodTarget: cfg.FOOD_TARGET, mapScale: cfg.MAP_SCALE,
  crossThreshold: CROSS,
  cross3s: { seeds: crossed, pct: Math.round(1000 * crossed / seeds) / 10, minDistMed: Math.round(med(minD)), minDistMin: Math.round(Math.min(...minD)), diedIn3s: diedIn3 },
  earlyDeath: { firstDeathLe30s: d30, firstDeathLe60s: d60, deathsMean150s: Math.round(mean(deaths) * 100) / 100 },
};
console.log(JSON.stringify(report));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
