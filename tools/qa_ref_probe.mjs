// qa_ref_probe.mjs — 「자(refPlayer)가 보는 값의 «분포»」를 찍는다. 창 0.
//
//   node tools/qa_ref_probe.mjs <bundle.mjs> [--seeds N] [--refruns Q]
//
// ★왜: REF v2 의 부스트 문턱(threat > 0.55, bestScore > 0.09)을 «봇에서 베껴 왔는데»
//   자의 부스트 사용률이 0.1~1.3% 밖에 안 나왔다(봇은 15.9%). 문턱이 자가 도달하는
//   범위 «밖»에 있다는 뜻이다. 추측으로 문턱을 내리지 말고 분포를 먼저 본다.
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const bundle = argv[0];
let seeds = 8;
let refRunsPerSeed = 2;
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === '--seeds') seeds = Number(argv[++i]);
  else if (argv[i] === '--refruns') refRunsPerSeed = Number(argv[++i]);
}

const mod = await import(pathToFileURL(bundle).href);
const { World } = mod;
const cfg = mod.__cfg ?? {};
const DT = 1 / 60;
const S0 = 20260818;
const STRIDE = 7919;
const WORLD_R = cfg.WORLD_R ?? 4330;
const R_MIN = cfg.R_MIN ?? 6.2;
const REF = { look: 190, reaction: 0.10, noise: 0.22, foodScan: 480, wAvoid: 3.2, wFood: 1.2 };

const threats = [];
const scores = [];

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

function think(w, p, r, time) {
  const urgent = r.threat > 0.62;
  if (!urgent && time < r.thinkAt) return;
  r.thinkAt = time + REF.reaction;
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
  threats.push(threat);
  scores.push(bestScore);
}

for (let k = 0; k < seeds; k++) {
  for (let q = 0; q < refRunsPerSeed; q++) {
    const seed = S0 + k * STRIDE + q * 104729;
    const w = new World(seed, 'REF', 'default', false);
    const p = w.player;
    const r = makeRef(seed);
    for (let i = 0; i <= Math.round(300 / DT); i++) {
      think(w, p, r, i * DT);
      w.step(DT);
      if (!p.alive) break;
    }
  }
}

const q = (a, x) => { const b = [...a].sort((m, n) => m - n); return b[Math.min(b.length - 1, Math.floor(x * b.length))]; };
const frac = (a, t) => a.filter((v) => v > t).length / a.length;
console.log(JSON.stringify({
  thinks: threats.length,
  threat: { p50: +q(threats, .5).toFixed(4), p90: +q(threats, .9).toFixed(4), p99: +q(threats, .99).toFixed(4),
            gt0_38: +frac(threats, 0.38).toFixed(4), gt0_45: +frac(threats, 0.45).toFixed(4),
            gt0_55: +frac(threats, 0.55).toFixed(4), gt0_60: +frac(threats, 0.60).toFixed(4) },
  bestScore: { p50: +q(scores, .5).toFixed(4), p75: +q(scores, .75).toFixed(4), p90: +q(scores, .9).toFixed(4),
               p99: +q(scores, .99).toFixed(4),
               gt0_03: +frac(scores, 0.03).toFixed(4), gt0_05: +frac(scores, 0.05).toFixed(4),
               gt0_07: +frac(scores, 0.07).toFixed(4), gt0_09: +frac(scores, 0.09).toFixed(4) },
}, null, 1));
