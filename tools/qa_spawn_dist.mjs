// qa_spawn_dist.mjs - 시작 시점 봇 «크기 분포» 실측 + 판정. 브라우저 없음(창 없음).
//
// ★ 왜 필요한가 (2026-08-29 President): 「게임 시작하면 애들이 다 작은데,
//   시작 시점에도 크기가 상이하면 좋겠다. slither.io 참고.」
//   slither.io 는 «상시 운영» 세계라 접속 순간 작은 뱀~거대 뱀이 섞여 있다.
//   우리는 판마다 새로 시작하므로 t=0 에 «이미 자란» 봇을 섞어 스폰해야 같은 인상이 난다.
//
// ★ 측정 항목 (seed 여러 개, t=0 / 30 / 60 초):
//   · 봇 질량 min / p25 / median / p75 / p90 / max, 히스토그램(구간별 마리수)
//   · 플레이어 질량(작게 시작해야 한다 = START_MASS 그대로)
//   · t=0 «스폰 안전거리»: 플레이어 머리 ↔ 가장 가까운 봇 몸통 점 거리(min/median)
//   · 봇 몸통 점 총합(렌더 비용 대리 지표)
//
// ★ 판정(--check): 분포 파라미터에서 «유도»한 문턱을 쓴다 - 문자열 전문 박은
//   테스트가 아니다(수치를 상수에서 유도해 검증한다는 규율).
//   양성대조: --check 를 «전부 작게» 스폰한 사본에 돌리면 반드시 FAIL 이어야 한다
//   (tools/qa_spawn_dist_ab.py 가 그 사본을 만들어 돌린다).
//
// 사용:
//   node tools/qa_spawn_dist.mjs <bundle.mjs> [--seeds N] [--check] [--json out.json]
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const bundle = argv[0];
if (!bundle) {
  console.error('usage: node tools/qa_spawn_dist.mjs <bundle.mjs> [--seeds N] [--check] [--json out]');
  process.exit(2);
}
let seeds = 24;
let check = false;
let jsonOut = '';
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === '--seeds') seeds = Number(argv[++i]);
  else if (argv[i] === '--check') check = true;
  else if (argv[i] === '--json') jsonOut = argv[++i];
}

const mod = await import(pathToFileURL(bundle).href);
const { World } = mod;
const cfg = mod.__cfg ?? {};

const DT = 1 / 60;
const MARKS = [0, 30, 60];
const S0 = 20260818;
const STRIDE = 7919;

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const k = (sorted.length - 1) * p;
  const lo = Math.floor(k);
  const hi = Math.ceil(k);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo);
}
function stats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0] ?? 0,
    p25: pct(s, 0.25),
    med: pct(s, 0.5),
    p75: pct(s, 0.75),
    p90: pct(s, 0.9),
    max: s[s.length - 1] ?? 0,
  };
}
const BINS = [0, 25, 50, 100, 200, 400, 800, 1600, Infinity];
function hist(arr) {
  const out = new Array(BINS.length - 1).fill(0);
  for (const v of arr) {
    for (let b = 0; b < BINS.length - 1; b++) {
      if (v >= BINS[b] && v < BINS[b + 1]) { out[b]++; break; }
    }
  }
  return out;
}
function binLabel(b) {
  const hi = BINS[b + 1];
  return BINS[b] + (hi === Infinity ? '+' : '-' + hi);
}

/** 플레이어 머리에서 가장 가까운 «다른 뱀 몸통 점»까지의 거리. */
function nearestBody(w) {
  const p = w.player;
  let best = Infinity;
  let bestId = -1;
  for (const s of w.snakes) {
    if (s === p || !s.alive) continue;
    const n = s.trail.count;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(s.trail.x(i) - p.x, s.trail.y(i) - p.y);
      if (d < best) { best = d; bestId = s.id; }
    }
    const dh = Math.hypot(s.x - p.x, s.y - p.y);
    if (dh < best) { best = dh; bestId = s.id; }
  }
  return { d: best, id: bestId };
}

const perMark = MARKS.map(() => ({ bot: [], player: [], trailPts: [], collPts: [] }));
const safety = [];
const safetyBig = []; // 가장 가까운 뱀이 «큰 뱀»(질량 >= 4x 플레이어)일 때의 거리
const t0Sets = [];

for (let k = 0; k < seeds; k++) {
  const seed = S0 + k * STRIDE;
  const w = new World(seed, 'QA', 'default', false);
  const steps = Math.round(MARKS[MARKS.length - 1] / DT);
  let mi = 0;
  const sample = () => {
    const bots = w.snakes.filter((s) => !s.isPlayer && s.alive).map((s) => s.mass);
    perMark[mi].bot.push(...bots);
    perMark[mi].player.push(w.player.mass);
    let tp = 0, cp = 0;
    for (const s of w.snakes) { if (!s.alive) continue; tp += s.trail.count; cp += s.collN; }
    perMark[mi].trailPts.push(tp);
    perMark[mi].collPts.push(cp);
  };
  sample();
  t0Sets.push(w.snakes.filter((s) => !s.isPlayer && s.alive).map((s) => Math.round(s.mass)));
  const nb = nearestBody(w);
  safety.push(nb.d);
  const near = w.snakes[nb.id];
  if (near && near.mass >= w.player.mass * 4) safetyBig.push(nb.d);
  for (let i = 1; i <= steps; i++) {
    // ★ 플레이어는 봇처럼 «자동 조종»하지 않는다(autoPilot=false). 입력이 없으면
    //   직진해서 벽에 죽는다 - 그래도 봇 분포 측정에는 영향이 없다. 플레이어 사망
    //   뒤에도 world.step 은 계속 돈다(사망 화면 뒤에서 도는 것과 같은 경로).
    w.step(DT);
    const t = i * DT;
    if (mi + 1 < MARKS.length && t >= MARKS[mi + 1] - 1e-9) { mi++; sample(); }
  }
}

const report = { seeds, cfg, marks: {} };
for (let m = 0; m < MARKS.length; m++) {
  const d = perMark[m];
  report.marks['t' + MARKS[m]] = {
    bot: stats(d.bot),
    hist: hist(d.bot),
    player: stats(d.player),
    trailPtsPerWorld: stats(d.trailPts),
    collPtsPerWorld: stats(d.collPts),
  };
}
report.spawnSafety = { all: stats(safety), nearestIsBig: stats(safetyBig), bigCases: safetyBig.length };
report.t0Example = t0Sets[0].sort((a, b) => b - a);

const f1 = (v) => (Math.round(v * 10) / 10).toString();
console.log('== bot mass distribution (' + seeds + ' seeds, ' + (cfg.BOT_COUNT ?? '?') + ' bots) ==');
console.log('bins: ' + BINS.slice(0, -1).map((_, b) => binLabel(b)).join(' | '));
for (const key of Object.keys(report.marks)) {
  const r = report.marks[key];
  console.log(
    key.padEnd(4) + ' min ' + f1(r.bot.min).padStart(6) + ' p25 ' + f1(r.bot.p25).padStart(6) +
    ' med ' + f1(r.bot.med).padStart(6) + ' p75 ' + f1(r.bot.p75).padStart(6) +
    ' p90 ' + f1(r.bot.p90).padStart(6) + ' max ' + f1(r.bot.max).padStart(7) +
    ' | hist ' + r.hist.join('/') +
    ' | player med ' + f1(r.player.med) +
    ' | trailPts med ' + f1(r.trailPtsPerWorld.med) + ' collPts med ' + f1(r.collPtsPerWorld.med),
  );
}
console.log('t0 example (seed ' + S0 + '): ' + report.t0Example.join(' '));
console.log('spawn safety: player head -> nearest other body  min ' + f1(report.spawnSafety.all.min) +
  '  med ' + f1(report.spawnSafety.all.med) + '  (nearest is big snake in ' + safetyBig.length + '/' + seeds +
  ' seeds, min ' + f1(report.spawnSafety.nearestIsBig.min) + ')');

if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));

if (check) {
  // ★ 문턱은 «분포 파라미터에서 유도»한다. 상수가 바뀌면 문턱도 따라 움직인다.
  //   필요한 값이 번들에 없으면(옛 빌드) 판정 자체가 불가능하므로 FAIL 로 떨어뜨린다.
  const need = ['START_MASS', 'BOT_COUNT', 'SPAWN_MASS_BIG', 'SPAWN_MASS_BIG_FRAC', 'SPAWN_MASS_MED', 'SPAWN_MASS_MED_FRAC'];
  const missing = need.filter((k) => typeof cfg[k] !== 'number');
  const fails = [];
  if (missing.length) {
    fails.push('bundle exposes no __cfg for: ' + missing.join(', '));
  } else {
    const t0 = report.marks.t0;
    const expectBig = cfg.BOT_COUNT * cfg.SPAWN_MASS_BIG_FRAC;      // 기대 «거대» 마리수(판당)
    const expectMed = cfg.BOT_COUNT * cfg.SPAWN_MASS_MED_FRAC;      // 기대 «중간 이상» 마리수(판당)
    const perGameBig = perMark[0].bot.filter((m) => m >= cfg.SPAWN_MASS_BIG * 0.5).length / seeds;
    const perGameMed = perMark[0].bot.filter((m) => m >= cfg.SPAWN_MASS_MED * 0.5).length / seeds;
    // 1) 오른쪽 꼬리: 판당 거대 봇이 기대치의 절반 이상은 나와야 한다.
    if (perGameBig < expectBig * 0.5) fails.push('too few big bots at t0: ' + f1(perGameBig) + '/game < ' + f1(expectBig * 0.5));
    // 2) 중간층도 있어야 한다.
    if (perGameMed < expectMed * 0.5) fails.push('too few medium bots at t0: ' + f1(perGameMed) + '/game < ' + f1(expectMed * 0.5));
    // 3) «대부분 작다»: 중앙값은 시작질량의 6배 아래(작은 뱀이 과반).
    if (t0.bot.med > cfg.START_MASS * 6) fails.push('median too big at t0: ' + f1(t0.bot.med) + ' > ' + cfg.START_MASS * 6);
    // 4) 플레이어는 작게 시작한다.
    if (Math.abs(t0.player.med - cfg.START_MASS) > 1e-6) fails.push('player does not start at START_MASS: ' + f1(t0.player.med));
    // 5) 최대값이 실제로 «거대»여야 한다(최소 한 판은 SPAWN_MASS_BIG 을 넘긴다).
    if (t0.bot.max < cfg.SPAWN_MASS_BIG) fails.push('max at t0 never reaches SPAWN_MASS_BIG: ' + f1(t0.bot.max) + ' < ' + cfg.SPAWN_MASS_BIG);
  }
  if (fails.length) {
    console.log('\n[FAIL]');
    for (const f of fails) console.log('  - ' + f);
    process.exit(1);
  }
  console.log('\n[PASS] t0 distribution: long right tail present, majority small, player small.');
}
