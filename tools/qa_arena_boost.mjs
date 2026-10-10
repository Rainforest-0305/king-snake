// qa_arena_boost.mjs — 「기준 플레이어가 부스트를 «얼마나 쓰는가»」만 잰다. 창 0.
//
//   node tools/qa_arena_boost.mjs <bundle.mjs> [--seeds N] [--refruns Q] [--json out]
//
// ★왜 따로 만드나: BOOST_DRAIN 을 올렸는데 난도 지표가 안 움직였다면 두 해석이 있다.
//     (a) 정말로 난도와 무관한 손잡이다
//     (b) «자»(기준 플레이어)가 부스트를 거의 안 써서 손잡이가 자에 닿지 않는다
//   이 둘은 완전히 다른 결론이다. 부스트 «사용량»을 재야 갈린다.
//   qa_arena_paired.mjs 를 고치지 않고 새 파일로 만든 이유는 그 파일이 지금
//   장시간 스윕에서 돌고 있어서다(실행 중 파일을 바꾸면 다음 웨이브가 오염된다).
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const bundle = argv[0];
let seeds = 20;
let refRunsPerSeed = 4;
let jsonOut = '';
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === '--seeds') seeds = Number(argv[++i]);
  else if (argv[i] === '--refruns') refRunsPerSeed = Number(argv[++i]);
  else if (argv[i] === '--json') jsonOut = argv[++i];
}

const mod = await import(pathToFileURL(bundle).href);
const { World } = mod;
const cfg = mod.__cfg ?? {};

const DT = 1 / 60;
const S0 = 20260818;
const STRIDE = 7919;
const WORLD_R = cfg.WORLD_R ?? 4330;
const R_MIN = cfg.R_MIN ?? 6.2;

// ★ qa_arena.mjs 의 REF 와 «동일한 화석». 값이 어긋나면 비교가 무의미해진다.
const REF = { look: 190, reaction: 0.10, noise: 0.22, foodScan: 480,
              wAvoid: 3.2, wFood: 1.2, boostAt: 0.60 };

function makeRef(seed) {
  let st = (seed ^ 0x9e3779b9) >>> 0;
  const rnd = () => {
    st ^= st << 13; st >>>= 0;
    st ^= st >> 17;
    st ^= st << 5; st >>>= 0;
    return st / 4294967296;
  };
  return { thinkAt: 0, wander: rnd() * 6.283 - 3.1415, boostUntil: 0, threat: 0, rnd };
}

function refThink(w, p, r, time) {
  const urgent = r.threat > 0.62;
  if (!urgent && time < r.thinkAt) {
    p.boosting = time < r.boostUntil && p.mass > (cfg.BOOST_MIN_MASS ?? 22);
    return;
  }
  r.thinkAt = time + (urgent ? 0 : REF.reaction);
  const cos = Math.cos(p.angle);
  const sin = Math.sin(p.angle);
  const look = REF.look * (1 + (p.radius - R_MIN) / 55) * (p.boosting ? 1.45 : 1);
  let ax = 0, ay = 0, threat = 0;
  const bn = w.queryBody(p.x, p.y, look, p.id);
  for (let i = 0; i < bn; i++) {
    const dx = p.x - w.bodyX[i];
    const dy = p.y - w.bodyY[i];
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-6) continue;
    const d = Math.sqrt(d2);
    if (d > look) continue;
    const fwd = (-dx * cos - dy * sin) / d;
    if (fwd < -0.35) continue;
    const near = 1 - d / look;
    const wgt = (0.25 + 0.75 * Math.max(0, fwd)) * near * near;
    ax += (dx / d) * wgt; ay += (dy / d) * wgt;
    if (wgt > threat) threat = wgt;
  }
  const rc = Math.hypot(p.x, p.y);
  const wallStart = WORLD_R * 0.8;
  if (rc > wallStart) {
    const k = Math.min(1, (rc - wallStart) / (WORLD_R - wallStart));
    ax += (-p.x / rc) * k * 4.5; ay += (-p.y / rc) * k * 4.5;
    if (k > threat) threat = k;
  }
  let bestScore = 0, fdx = 0, fdy = 0;
  const on = w.queryOrbs(p.x, p.y, REF.foodScan);
  for (let i = 0; i < on; i++) {
    const dx = w.orbX[i] - p.x;
    const dy = w.orbY[i] - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) continue;
    const fwd = (dx * cos + dy * sin) / d;
    const sc = (w.orbV[i] / (d + 70)) * (0.45 + 0.55 * Math.max(0, fwd));
    if (sc > bestScore) { bestScore = sc; fdx = dx / d; fdy = dy / d; }
  }
  const calm = 1 - Math.min(1, threat / 0.8);
  let dx = cos * 0.55, dy = sin * 0.55;
  dx += ax * REF.wAvoid; dy += ay * REF.wAvoid;
  if (bestScore > 0) {
    dx += fdx * REF.wFood * (0.25 + 0.75 * calm);
    dy += fdy * REF.wFood * (0.25 + 0.75 * calm);
  }
  r.wander += (r.rnd() - 0.5) * REF.noise;
  if (r.wander > Math.PI) r.wander -= Math.PI * 2;
  else if (r.wander < -Math.PI) r.wander += Math.PI * 2;
  dx += Math.cos(r.wander) * 0.22 * calm;
  dy += Math.sin(r.wander) * 0.22 * calm;
  if (dx * dx + dy * dy > 1e-8) p.targetAngle = Math.atan2(dy, dx);
  r.threat = threat;
  if (p.mass > (cfg.BOOST_MIN_MASS ?? 22) * 1.7 && threat > REF.boostAt) {
    r.boostUntil = time + 0.45;
  }
  p.boosting = time < r.boostUntil && p.mass > (cfg.BOOST_MIN_MASS ?? 22);
}

/** 봇(전 개체)의 부스트 사용도 같이 잰다 — 손잡이가 «누구에게» 닿는지 보려고. */
function run(seed, maxSecs) {
  const w = new World(seed, 'REF', 'default', false);
  const p = w.player;
  const r = makeRef(seed);
  const steps = Math.round(maxSecs / DT);
  let boostTicks = 0, aliveTicks = 0, i = 0;
  let botBoostTicks = 0, botAliveTicks = 0;
  for (; i <= steps; i++) {
    refThink(w, p, r, i * DT);
    w.step(DT);
    if (!p.alive) break;
    aliveTicks++;
    if (p.boosting) boostTicks++;
    if (i % 6 === 0) {
      for (let j = 1; j < w.snakes.length; j++) {
        const s = w.snakes[j];
        if (!s.alive) continue;
        botAliveTicks++;
        if (s.boosting) botBoostTicks++;
      }
    }
  }
  return {
    lifeS: i * DT,
    boostS: boostTicks * DT,
    boostFrac: aliveTicks ? boostTicks / aliveTicks : 0,
    botBoostFrac: botAliveTicks ? botBoostTicks / botAliveTicks : 0,
  };
}

const rows = [];
for (let k = 0; k < seeds; k++) {
  for (let q = 0; q < refRunsPerSeed; q++) rows.push(run(S0 + k * STRIDE + q * 104729, 300));
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const drain = cfg.BOOST_DRAIN ?? 0;
const dropBack = cfg.BOOST_DROP_RATIO ?? 0;
const out = {
  meta: { seeds, refRunsPerSeed, runs: rows.length, BOOST_DRAIN: drain, BOOST_DROP_RATIO: dropBack },
  refPlayer: {
    lifeMeanS: +mean(rows.map((x) => x.lifeS)).toFixed(1),
    boostMeanS: +mean(rows.map((x) => x.boostS)).toFixed(2),
    boostFrac: +mean(rows.map((x) => x.boostFrac)).toFixed(4),
    // 부스트로 «태운» 질량과, 회수 안 되고 사라진 «순손실»
    massBurned: +(mean(rows.map((x) => x.boostS)) * drain).toFixed(1),
    massNetLost: +(mean(rows.map((x) => x.boostS)) * drain * (1 - dropBack)).toFixed(1),
  },
  bots: { boostFrac: +mean(rows.map((x) => x.botBoostFrac)).toFixed(4) },
};
console.log(JSON.stringify(out));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2));
