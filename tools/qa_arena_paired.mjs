// qa_arena.mjs — 아레나 «전체»를 한 번에 재는 계측기. 브라우저 없음(창 0).
//
//   node tools/qa_arena.mjs <bundle.mjs> [--seeds N] [--secs S] [--json out]
//
// ══ 왜 새로 만드나 ═══════════════════════════════════════════════════════
//  기존 qa_early.mjs 는 「초반 사망 + 거대봇 가로지름」 둘만 잰다. 이번 지시는
//  레버가 6개(②난도·④봇실력·⑥바깥분포·⑦초거대·⑧가두리·⑨맵확대)라 서로를
//  밀고 당긴다. 「봇을 세게 했으니 어려워졌겠지」는 추측이고, 지난 레인에서
//  «큰 봇 비율을 올렸더니 오히려 쉬워진» 반직관 사례가 실제로 나왔다.
//  ⇒ 하나의 «최종 상태»에서 전 지표를 같은 시드로 동시에 뽑는다.
//
// ══ 무엇을 재나 ══════════════════════════════════════════════════════════
//  A. 난도    — 150/180초 사망 수, 첫 사망 시각, 플레이어 최고 질량(=점수), 사망 원인
//  B. 초반    — cross3s(시작 3초에 거대 봇이 가로지르는 비율). ★이 지표로 안을 기각한 이력
//  C. 1등     — 플레이어가 1위에 오른 시간 비율·최초 1위 시각·1위 봇 질량 분포
//  D. 분포    — 봇 «반경별» 분포(0~.3R / .3~.6R / .6~1R)와 면적 정규화 밀도
//  E. 크기    — 봇 질량 분위수·초거대(임계 이상) 마릿수·«화면에 보일» 총 몸길이/면적
//  F. 초거대  — 평균 생존시간, 상시 존재 비율, «플레이어가 잡은» 비율
//  G. 가두리  — bots.ts 가 노출하는 카운터(있으면)
//
// ★ 플레이어는 «봇 두뇌»(autoPilot)가 조종한다. 사람보다 못하지만 «같은 두뇌»로
//   전/후를 재므로 «변화»는 정직하다. 절대값을 사람 실력으로 읽지 마라.
//   ⚠ 봇 실력을 올리면 autoPilot 플레이어도 같이 세진다 — 그래서 난도 변화가
//     «과소»평가된다. 이 한계는 보고서에 그대로 적는다.
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const bundle = argv[0];
if (!bundle) {
  console.error('usage: node tools/qa_arena.mjs <bundle.mjs> [--seeds N] [--secs S] [--json out]');
  process.exit(2);
}
let seeds = 16;
let secs = 180;
let jsonOut = '';
/* --refonly : 기준 플레이어 판«만» 돈다(봇 생태계 계측 생략). 표본을 크게 늘려
   생존시간 중앙값의 검정력을 확보하기 위한 모드다. --refruns 는 시드당 판 수. */
let refOnly = false;
let refRunsPerSeed = 4;
/* ★자 버전. 1 = 2026-09-02 원본(부스트를 «안 쓴다»), 2 = 2026-09-05 교정판.
   기본값을 1 로 두는 것이 «양성대조»의 조건이다 — 옛 결과가 그대로 나와야 한다. */
let refVer = 1;
/* v2 의 「먹이 무더기로 달려들기」 확률(생각 1회당). 봇과 같은 0.03 이 기본. */
let RUSH_P = 0.21;
/* v2 의 「먹이가 쓸 만하다」 문턱. ★자의 bestScore 분포 실측(14,520 결정):
   중앙 0.018 · p75 0.030 · p90 0.044 · p99 0.084.
   봇에서 베껴 온 0.09 는 자에게 «p99 바깥»이라 0.85% 밖에 안 걸렸다 - 그래서 0.03. */
let RUSH_SC = 0.03;
/* v2 의 도주 문턱. ★자의 threat 분포 실측: 중앙 0 · p90 0.077 · p99 0.309.
   0.55(regular 봇)는 0.13%, 0.45(hunter 급)는 0.25% 다. 어느 쪽이든 도주 부스트는
   «드물다» - 자의 부스트 사용량은 사실상 먹이 달려들기가 만든다. */
let FLEE_AT = 0.45;
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === '--seeds') seeds = Number(argv[++i]);
  else if (argv[i] === '--secs') secs = Number(argv[++i]);
  else if (argv[i] === '--json') jsonOut = argv[++i];
  else if (argv[i] === '--refonly') refOnly = true;
  else if (argv[i] === '--refruns') refRunsPerSeed = Number(argv[++i]);
  else if (argv[i] === '--ref2') refVer = 2;
  else if (argv[i] === '--rushp') RUSH_P = Number(argv[++i]);
  else if (argv[i] === '--rushsc') RUSH_SC = Number(argv[++i]);
  else if (argv[i] === '--fleeat') FLEE_AT = Number(argv[++i]);
}

const mod = await import(pathToFileURL(bundle).href);
const { World } = mod;
const cfg = mod.__cfg ?? {};
const botDebug = mod.__botDebug ?? null;

const DT = 1 / 60;
const S0 = 20260818;
const STRIDE = 7919;
const WORLD_R = cfg.WORLD_R ?? 4330;
const R_MIN = cfg.R_MIN ?? 6.2;
const R_MAX = cfg.R_MAX ?? 34;
const CROSS = R_MIN + R_MAX + 60;
const LEN_MIN = cfg.LEN_MIN ?? 150;
const LEN_K = cfg.LEN_K ?? 46;
const LEN_POW = cfg.LEN_POW ?? 0.55;

/** «초거대»의 정의. 절대값이라 맵·상수를 바꿔도 전/후 비교가 성립한다. */
const GIANT = 2000;
const MEGA = 5000;

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const pct = (a, p) => {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  const k = (b.length - 1) * p;
  const lo = Math.floor(k);
  const hi = Math.ceil(k);
  return lo === hi ? b[lo] : b[lo] + (b[hi] - b[lo]) * (k - lo);
};
const r2 = (x) => Math.round(x * 100) / 100;
const r1 = (x) => Math.round(x * 10) / 10;
// Math.max(...arr) 는 배열이 크면 스택이 터진다(실측: 수십만 표본에서 RangeError).
const maxOf = (a) => a.reduce((m, x) => (x > m ? x : m), 0);
const bodyLenOf = (m) => LEN_MIN + LEN_K * Math.pow(Math.max(1, m), LEN_POW);


/* ═══════════════════════════════════════════════════════════════════════════
 * ★★ 기준 플레이어(refPlayer) — «변하지 않는 자»
 *
 *  왜 필요한가 (1차 스윕이 가르쳐 준 것):
 *    autoPilot 은 «봇 두뇌»로 플레이어 슬롯을 조종한다. 그런데 이번 작업은
 *    그 봇 두뇌를 «대폭 상향»한다 ⇒ 봇이 세지면 플레이어도 같이 세진다.
 *    실제로 1차 스윕에서 「+skill」을 켜자 난도가 «움직이지 않았다»(deaths 3.47 → 3.47).
 *    상대가 세진 만큼 나도 세졌으니 당연하다. 그 숫자는 사람의 체감과 무관하다.
 *    ⇒ 사람의 실력은 우리 패치로 «변하지 않는다». 그러니 자도 변하면 안 된다.
 *
 *  ⛔이 상수들을 «절대 튜닝하지 마라». 게임 밸런스가 아니라 «자»다.
 *    여기를 건드리는 순간 전/후 비교가 전부 무의미해진다.
 *    (game/bots.ts 의 TIERS 를 참조하지 «않는» 것도 같은 이유다 — 저기가 바뀌면
 *     자도 같이 바뀐다. 값을 여기 복사해 «화석»으로 박아 둔다.)
 *
 *  ★어느 정도 실력인가: 2026-09-02 라이브(-23)의 regular 등급을 본떴다.
 *    반응 0.10초·잡음 0.22 — 「피할 줄 알고 먹이를 고를 줄 아는 보통 사람」.
 *    사냥은 «하지 않는다»(자는 단순해야 한다).
 * ══════════════════════════════════════════════════════════════════════════ */
const REF = {
  look: 190, reaction: 0.10, noise: 0.22, foodScan: 480,
  wAvoid: 3.2, wFood: 1.2, boostAt: 0.60,
};

/* ═══════════════════════════════════════════════════════════════════════════
 * ★★ REF v2 — 「자가 사람을 안 닮았다」를 고친 판 (2026-09-05)
 *
 *  왜 고치나 (실측): v1 의 자는 부스트를 «재생시간의 0.02%» 밖에 안 썼다
 *  (tools/qa_arena_boost.mjs, 80판. 판당 0.01초). 같은 판에서 봇은 15.9% 를 썼다.
 *  ⇒ BOOST_DRAIN 같은 «부스트 경제» 손잡이가 자에 아예 닿지 않는다. 안 움직이는 게
 *    당연했다. 그건 「난도와 무관」의 증거가 아니라 「못 쟀다」였다.
 *
 *  v1 이 안 쓴 이유는 둘이다:
 *    1) 문턱이 threat > 0.60 인데, threat = (0.25+0.75*fwd)*(1-d/look)^2 이라
 *       0.60 을 넘으려면 몸통이 정면 «45유닛 안»에 있어야 한다 = 대개 이미 죽는 거리.
 *       (regular 봇의 도주 문턱은 0.55, hunter 0.44, elite 0.38 이다 — 자가 제일 높았다.)
 *    2) 봇이 가진 부스트 사유 «4개 중 1개»만 있었다.
 *       봇: ①도주 ②감기(wrap) ③사냥 근접 ④먹이 무더기로 달려들기(3% 확률)
 *       자: ①도주뿐. 그런데 봇 사용량의 대부분은 ④다.
 *
 *  v2 가 고치는 것 — «지각·조향은 한 글자도 안 건드린다». 부스트 «정책»만 바꾼다:
 *    ① 도주 문턱 0.60 → 0.55 (regular 봇과 동일) + 「등지고 있을 때만」 조건 추가.
 *       정면으로 돌진하는 부스트는 사람도 안 한다 — 자살이다(봇도 같은 조건이다).
 *    ④ 먹이 무더기 달려들기 추가(bestScore > 0.09, 생각당 3%, 0.30초).
 *  ⛔사냥·감기는 «안 넣는다». 자는 단순해야 한다는 원본 규율을 지킨다
 *    (자가 사냥을 배우면 봇 실력을 올릴 때 자도 같이 세져서 v1 의 실패를 반복한다).
 *
 *  ⚠v2 로 재면 v1 의 베이스라인(생존 중앙 64.1초)은 «무효»다. 자가 다르면 눈금이 다르다.
 *  ⚠v2 는 자 전용 rng(r.rnd)를 한 번 더 뽑을 수 있다 — 월드 rng 는 «안 건드린다».
 *    그래서 시드별 월드 생성은 v1 과 완전히 같고, 시드 페어링이 그대로 성립한다.
 * ══════════════════════════════════════════════════════════════════════════ */
/* ★문턱을 «봇에서 베껴 오면 안 된다»는 것이 이번 교정의 핵심 교훈이다.
   봇과 자는 같은 공식으로 threat/bestScore 를 계산하지만 «행동»이 달라서(자는
   사냥·감기를 안 한다) 도달하는 값의 분포가 다르다. 그래서 봇의 0.55/0.09 를
   그대로 쓰면 자에게는 사실상 «도달 불가»가 된다(실측 0.13% / 0.85%).
   ⇒ 문턱은 자의 «자기 분포»에서 잡는다. tools/qa_ref_probe.mjs 가 그 분포를 찍는다. */
const REF2 = {
  fleeHold: 0.45,      // 도주 부스트 지속(봇과 동일)
  awayCos: 1.1,        // 「위협을 등졌다」 판정(봇과 동일한 각도 여유)
  rushHold: 0.30,      // 먹이 달려들기 지속(봇과 동일)
};

function makeRef(seed) {
  // 자 전용 난수(월드 rng 를 «쓰지 않는다» — 쓰면 월드 시퀀스가 변해 시드가 달라진다).
  let st = (seed ^ 0x9e3779b9) >>> 0;
  const rnd = () => {
    st ^= st << 13; st >>>= 0;
    st ^= st >> 17;
    st ^= st << 5; st >>>= 0;
    return st / 4294967296;
  };
  return { thinkAt: 0, wander: rnd() * 6.283 - 3.1415, boostUntil: 0, threat: 0, rnd };
}

/** 기준 플레이어 1틱. world 의 Sensors 를 그대로 쓴다(봇과 «같은 감각기관»). */
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
  // 경계 회피 — 자는 «옛 규칙 그대로»(0.8R, 4.5). 봇의 벽 규칙이 바뀌어도 자는 안 바뀐다.
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
  const canBoost = p.mass > (cfg.BOOST_MIN_MASS ?? 22) * 1.7;
  if (refVer === 1) {
    if (canBoost && threat > REF.boostAt) r.boostUntil = time + 0.45;
  } else if (canBoost) {
    if (threat > FLEE_AT) {
      // ① 도주 — «등지고 있을 때만». 정면 돌진 부스트는 자살이다(봇과 같은 규칙).
      const aw = Math.atan2(ay, ax);
      let dd = p.targetAngle - aw;
      while (dd > Math.PI) dd -= Math.PI * 2;
      while (dd < -Math.PI) dd += Math.PI * 2;
      if (Math.abs(dd) < REF2.awayCos) r.boostUntil = time + REF2.fleeHold;
    } else if (bestScore > RUSH_SC && r.rnd() < RUSH_P) {
      // ④ 먹이 무더기로 달려들기 — 봇 부스트 사용량의 «대부분»이 여기서 나온다.
      r.boostUntil = time + REF2.rushHold;
    }
  }
  p.boosting = time < r.boostUntil && p.mass > (cfg.BOOST_MIN_MASS ?? 22);
}

/**
 * 기준 플레이어로 «한 판»을 끝까지 돈다(죽을 때까지, 최대 maxSecs).
 * ★autoPilot=false 로 만든다 ⇒ 진짜 플레이어와 «같은» 스폰 보호(3초)를 받고,
 *   죽으면 «판이 끝난다»(리스폰 없음). 그게 실제 유저의 한 판이다.
 */
function refRun(seed, maxSecs) {
  const w = new World(seed, 'REF', 'default', false);
  const p = w.player;
  const r = makeRef(seed);
  let cause = null;
  w.hooks = { onPlayerDeath(info) { cause = info; } };
  const steps = Math.round(maxSecs / DT);
  let peak = p.mass;
  let rank1 = 0, rankTicks = 0, firstRank1 = -1;
  let boostTicks = 0;
  let i = 0;
  for (; i <= steps; i++) {
    const time = i * DT;
    refThink(w, p, r, time);
    if (p.boosting) boostTicks++;
    w.step(DT);
    if (!p.alive) break;
    if (p.mass > peak) peak = p.mass;
    rankTicks++;
    if (w.ranking.length && w.ranking[0] === p.id) { rank1++; if (firstRank1 < 0) firstRank1 = time; }
  }
  return {
    lifeS: i * DT,
    peak,
    boostS: boostTicks * DT,
    boostFrac: i ? boostTicks / i : 0,
    died: !p.alive,
    cause: cause ? cause.cause : null,
    rankAtEnd: cause ? cause.rank : w.rankOf(p.id),
    rank1Frac: rankTicks ? rank1 / rankTicks : 0,
    firstRank1,
  };
}

/* ───────────────────────────────────────────────────────────────────────────
 * 1) cross3s — 「손을 대기 전 3초」에 거대 봇이 플레이어를 가로지르는가.
 *    qa_early.mjs 와 «같은 정의»를 쓴다(비교 가능해야 한다).
 * ────────────────────────────────────────────────────────────────────────── */
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

function measureCross3s() {
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
  return {
    threshold: Math.round(CROSS),
    pct: r1((100 * crossed) / seeds),
    minDistMed: Math.round(pct(minD, 0.5)),
    diedIn3s: diedIn3,
  };
}

/* ───────────────────────────────────────────────────────────────────────────
 * 2) 본 측정 — autoPilot 판 하나를 secs 초 돌리며 전 지표를 동시에 뽑는다.
 * ────────────────────────────────────────────────────────────────────────── */
function runOne(seed) {
  const w = new World(seed, 'QA', 'default', true);

  const n = w.snakes.length;
  const bornAt = new Float64Array(n);
  const wasAlive = new Uint8Array(n);
  const peakMass = new Float64Array(n);
  for (let i = 0; i < n; i++) { wasAlive[i] = w.snakes[i].alive ? 1 : 0; peakMass[i] = w.snakes[i].mass; }

  // 이름 → index (킬 이벤트에서 희생자 질량을 알아내기 위해)
  const byName = new Map();
  for (let i = 0; i < n; i++) byName.set(w.snakes[i].name, i);

  const lifeAll = [];        // 봇 생존시간(초)
  const lifeGiant = [];      // «초거대까지 자란» 개체의 생존시간
  const causeCount = { body: 0, border: 0, headon: 0 };
  const causeInferred = { border: 0, bodyOrHeadon: 0 };
  let botKills = 0;
  let playerKills = 0;
  let playerGiantKills = 0;
  let giantDeaths = 0;       // 초거대가 죽은 횟수(누가 죽였든)

  w.hooks = {
    onKill(e) {
      if (e.killerIsPlayer) {
        playerKills++;
        const vi = byName.get(e.victimName);
        if (vi !== undefined && peakMass[vi] >= GIANT) playerGiantKills++;
      } else if (!e.victimIsPlayer) botKills++;
    },
    /* ⚠autoPilot 에서는 «불리지 않는다» — world.ts:502 가 `s.isPlayer && !this.autoPilot`
       로 막는다(실측 확인: 1차 측정에서 세 원인이 전부 0 이었다). 그래서 아래
       생사 전이 추적에서 «위치로» 원인을 유도한다. 이 훅은 비-autoPilot 경로용으로
       남겨 둔다(정의가 어긋나면 바로 드러나게). */
    onPlayerDeath(info) {
      if (causeCount[info.cause] !== undefined) causeCount[info.cause]++;
    },
  };

  const steps = Math.round(secs / DT);
  const SAMPLE_EVERY = Math.round(0.5 / DT); // 0.5초마다 분포 표본

  /* ★구간을 5칸으로 «쪼갠» 이유(1차 실측이 가르쳐 준 것):
     3칸(0~.3/.3~.6/.6~1)으로 재니 면적 정규화 밀도가 1.09/1.12/0.94 = 거의 균등이라
     「바깥에 안 간다」가 «없는 문제»로 보였다. 그런데 bots.ts 의 경계 회피는
     WORLD_R*0.8 부터 «세게»(가중치 4.5) 밀어낸다 — 즉 죽은 공간은 0.6~1 전체가
     아니라 «0.8~1.0» 이다. 그 구간은 면적의 36% 다. 굵은 구간으로 재면
     0.6~0.8 의 붐빔이 0.8~1.0 의 공백을 «가려 준다». 구간이 지표를 만든다. */
  const radial = [0, 0, 0, 0, 0];    // 0~.3 / .3~.6 / .6~.8 / .8~.9 / .9~1 (봇 «머리»)
  const radialLen = [0, 0, 0, 0, 0]; // 같은 구간의 «몸 길이» 합(공간 점유)
  let radialSamples = 0;
  const massSamples = [];    // 표본 시점의 봇 질량 전부
  const leaderMass = [];     // 표본 시점의 1위 질량
  const giantAlive = [];     // 표본 시점의 초거대 마릿수
  const megaAlive = [];
  const totalLen = [];       // 표본 시점의 총 몸길이
  let playerRank1Ticks = 0;
  let playerRankSamples = 0;
  let firstRank1 = -1;
  let playerPeak = 0;
  let playerDeaths = 0;
  let firstDeath = -1;
  let playerAliveTicks = 0;
  const playerRunPeaks = [];
  let curRunPeak = 0;

  for (let i = 1; i <= steps; i++) {
    w.step(DT);
    const time = i * DT;

    // ── 생사 전이 추적 ────────────────────────────────────────────────────
    for (let j = 0; j < n; j++) {
      const s = w.snakes[j];
      const a = s.alive ? 1 : 0;
      if (a) { if (s.mass > peakMass[j]) peakMass[j] = s.mass; }
      if (wasAlive[j] && !a) {
        const life = time - bornAt[j];
        if (j > 0) {
          lifeAll.push(life);
          if (peakMass[j] >= GIANT) { lifeGiant.push(life); giantDeaths++; }
        } else {
          playerDeaths++;
          if (firstDeath < 0) firstDeath = time;
          playerRunPeaks.push(curRunPeak);
          curRunPeak = 0;
          /* 원인 유도: 죽은 «자리»가 경계면 border, 아니면 몸통 충돌.
             world.ts 는 headon 을 따로 구분하지만 여기서는 위치만으로 갈리지
             않는다 — 그래서 body 로 묶고 이름도 bodyOrHeadon 으로 적는다.
             ★있지도 않은 정밀도를 이름으로 주장하지 않는다. */
          if (Math.hypot(s.x, s.y) >= WORLD_R * 0.985) causeInferred.border++;
          else causeInferred.bodyOrHeadon++;
        }
      } else if (!wasAlive[j] && a) {
        bornAt[j] = time;
        peakMass[j] = s.mass;
      }
      wasAlive[j] = a;
    }

    const p = w.player;
    if (p.alive) {
      playerAliveTicks++;
      if (p.mass > playerPeak) playerPeak = p.mass;
      if (p.mass > curRunPeak) curRunPeak = p.mass;
      playerRankSamples++;
      if (w.ranking.length && w.ranking[0] === p.id) {
        playerRank1Ticks++;
        if (firstRank1 < 0) firstRank1 = time;
      }
    }

    // ── 분포 표본 ─────────────────────────────────────────────────────────
    if (i % SAMPLE_EVERY === 0) {
      radialSamples++;
      let tl = 0;
      let g = 0;
      let mg = 0;
      for (let j = 1; j < n; j++) {
        const s = w.snakes[j];
        if (!s.alive) continue;
        const rr = Math.hypot(s.x, s.y) / WORLD_R;
        const b = rr < 0.3 ? 0 : rr < 0.6 ? 1 : rr < 0.8 ? 2 : rr < 0.9 ? 3 : 4;
        radial[b]++;
        const bl = bodyLenOf(s.mass);
        radialLen[b] += bl;
        tl += bl;
        massSamples.push(s.mass);
        if (s.mass >= GIANT) g++;
        if (s.mass >= MEGA) mg++;
      }
      totalLen.push(tl);
      giantAlive.push(g);
      megaAlive.push(mg);
      if (w.ranking.length) leaderMass.push(w.snakes[w.ranking[0]].mass);
    }
  }

  if (curRunPeak > 0) playerRunPeaks.push(curRunPeak);

  return {
    radial, radialLen, radialSamples,
    massSamples, leaderMass, giantAlive, megaAlive, totalLen,
    lifeAll, lifeGiant, causeCount,
    botKills, playerKills, playerGiantKills, giantDeaths,
    playerRank1Frac: playerRankSamples ? playerRank1Ticks / playerRankSamples : 0,
    firstRank1, playerPeak, playerDeaths, firstDeath,
    playerAliveFrac: playerAliveTicks / steps,
    playerRunPeaks,
    causeInferred,
  };
}

/* ───────────────────────────────────────────────────────────────────────────
 * 3) 집계
 * ────────────────────────────────────────────────────────────────────────── */
if (botDebug && botDebug.reset) botDebug.reset();

const runs = [];
const runSeeds = [];
if (!refOnly) {
  for (let k = 0; k < seeds; k++) { runSeeds.push(S0 + k * STRIDE); runs.push(runOne(S0 + k * STRIDE)); }
} else {
  runSeeds.push(S0); runs.push(runOne(S0));   // 최소 1판(집계 코드가 빈 배열을 못 견딘다)
}

/* ★기준 플레이어 판 — 시드당 «여러 판»을 돈다. 한 판만 재면 분산이 커서
   전/후 차이가 잡음에 묻힌다(실측: 시드 12개 1판이면 표준오차가 평균의 30%). */
const REF_RUNS_PER_SEED = refRunsPerSeed;
const refRuns = [];
const refRows = [];
for (let k = 0; k < seeds; k++) {
  for (let q = 0; q < REF_RUNS_PER_SEED; q++) {
    const sd = S0 + k * STRIDE + q * 104729;
    const x = refRun(sd, 300);
    refRuns.push(x);
    refRows.push({ seed: sd, k, q, lifeS: x.lifeS, peak: x.peak, died: x.died,
                   cause: x.cause, rankAtEnd: x.rankAtEnd,
                   boostS: x.boostS, boostFrac: x.boostFrac });
  }
}
const refCause = { body: 0, border: 0, headon: 0, survived: 0 };
for (const x of refRuns) {
  if (!x.died) refCause.survived++;
  else if (refCause[x.cause] !== undefined) refCause[x.cause]++;
}

const cat = (f) => runs.flatMap(f);
const area = Math.PI * WORLD_R * WORLD_R;
// 반경 구간의 «면적»(정규화 밀도용): 0~.3 / .3~.6 / .6~1
const RING_EDGES = [0, 0.3, 0.6, 0.8, 0.9, 1.0];
const ringArea = RING_EDGES.slice(1).map(
  (e, i) => (e * e - RING_EDGES[i] * RING_EDGES[i]) * area,
);
/** 면적 비(참고용) — 바깥이 «넓다»는 것을 보고서에서 숫자로 보이기 위해. */
const ringAreaPct = ringArea.map((x) => r1((100 * x) / area));

const radialTot = [0, 0, 0, 0, 0];
const radialLenTot = [0, 0, 0, 0, 0];
let radialSampleTot = 0;
for (const r of runs) {
  for (let i = 0; i < 5; i++) { radialTot[i] += r.radial[i]; radialLenTot[i] += r.radialLen[i]; }
  radialSampleTot += r.radialSamples;
}
const radialSum = radialTot.reduce((a, b) => a + b, 0) || 1;
const radialLenSum = radialLenTot.reduce((a, b) => a + b, 0) || 1;

const allMass = cat((r) => r.massSamples);
const allLeader = cat((r) => r.leaderMass);
const allLifeAll = cat((r) => r.lifeAll);
const allLifeGiant = cat((r) => r.lifeGiant);
const allTotalLen = cat((r) => r.totalLen);
const allGiant = cat((r) => r.giantAlive);
const allMega = cat((r) => r.megaAlive);
const allRunPeaks = cat((r) => r.playerRunPeaks);

const causeSum = { body: 0, border: 0, headon: 0 };
for (const r of runs) for (const k of Object.keys(causeSum)) causeSum[k] += r.causeCount[k];
const causeInf = { border: 0, bodyOrHeadon: 0 };
for (const r of runs) for (const k of Object.keys(causeInf)) causeInf[k] += r.causeInferred[k];

const playerGiantKills = runs.reduce((s, r) => s + r.playerGiantKills, 0);
const giantDeaths = runs.reduce((s, r) => s + r.giantDeaths, 0);

const report = {
  meta: {
    seeds, secs,
    mapScale: cfg.MAP_SCALE ?? null,
    worldR: WORLD_R,
    botCount: cfg.BOT_COUNT ?? null,
    foodTarget: cfg.FOOD_TARGET ?? null,
    areaMunits2: r2(area / 1e6),
    botsPerMunits2: cfg.BOT_COUNT ? r2(cfg.BOT_COUNT / (area / 1e6)) : null,
    giantThreshold: GIANT, megaThreshold: MEGA,
  },
  // A. 난도
  difficulty: {
    deathsMean: r2(mean(runs.map((r) => r.playerDeaths))),
    deathsPer150s: r2(mean(runs.map((r) => r.playerDeaths)) * (150 / secs)),
    firstDeathMed: r1(pct(runs.filter((r) => r.firstDeath >= 0).map((r) => r.firstDeath), 0.5)),
    firstDeathLe30s: runs.filter((r) => r.firstDeath >= 0 && r.firstDeath <= 30).length,
    firstDeathLe60s: runs.filter((r) => r.firstDeath >= 0 && r.firstDeath <= 60).length,
    aliveFrac: r2(mean(runs.map((r) => r.playerAliveFrac))),
    lifeMeanS: r2(mean(allRunPeaks.length ? runs.map((r) => (r.playerAliveFrac * secs) / Math.max(1, r.playerDeaths)) : [0])),
    cause: causeSum,          // ⚠autoPilot 에서는 전부 0 이 «정상»이다(위 주석)
    causeInferred: causeInf,  // 실제로 쓰는 원인 분포
  },
  // B. 초반
  cross3s: refOnly ? null : measureCross3s(),
  // C. 1등 난이도 · 플레이어 점수
  compete: {
    rank1Frac: r2(mean(runs.map((r) => r.playerRank1Frac))),
    everRank1: runs.filter((r) => r.firstRank1 >= 0).length,
    firstRank1Med: r1(pct(runs.filter((r) => r.firstRank1 >= 0).map((r) => r.firstRank1), 0.5)),
    playerPeakMean: Math.round(mean(runs.map((r) => r.playerPeak))),
    playerPeakMax: Math.round(maxOf(runs.map((r) => r.playerPeak))),
    // 한 «판»(사망까지)의 점수 — 실제 유저의 「이번 판 점수」에 대응한다
    runPeakMean: Math.round(mean(allRunPeaks)),
    runPeakP90: Math.round(pct(allRunPeaks, 0.9)),
    runPeakMax: Math.round(maxOf(allRunPeaks)),
    leaderMassMean: Math.round(mean(allLeader)),
    leaderMassP90: Math.round(pct(allLeader, 0.9)),
    leaderMassMax: Math.round(maxOf(allLeader)),
  },
  // D. 반경별 분포
  radial: {
    headPct: radialTot.map((x) => r1((100 * x) / radialSum)),
    bodyLenPct: radialLenTot.map((x) => r1((100 * x) / radialLenSum)),
    // ★면적으로 나눈 «밀도». 균등하면 셋이 같아진다(면적 비 9:27:64 를 상쇄).
    densityRel: radialTot.map((x, i) => r2((x / ringArea[i]) / (radialSum / area))),
    edges: RING_EDGES,
    areaPct: ringAreaPct,
    /** ★「죽은 공간」 = 면적의 36% 인 0.8~1.0 R 에 봇이 몇 % 있는가. */
    outerHeadPct: r1((100 * (radialTot[3] + radialTot[4])) / radialSum),
    outerAreaPct: r1(ringAreaPct[3] + ringAreaPct[4]),
    samples: radialSampleTot,
  },
  // E. 크기 분포
  size: {
    massMed: Math.round(pct(allMass, 0.5)),
    massP90: Math.round(pct(allMass, 0.9)),
    massP99: Math.round(pct(allMass, 0.99)),
    massMax: Math.round(maxOf(allMass)),
    giantAliveMean: r2(mean(allGiant)),
    megaAliveMean: r2(mean(allMega)),
    giantPresentFrac: r2(allGiant.filter((x) => x > 0).length / Math.max(1, allGiant.length)),
    megaPresentFrac: r2(allMega.filter((x) => x > 0).length / Math.max(1, allMega.length)),
    // «채워짐» = 총 몸길이 / 맵면적. 마릿수가 같아도 큰 뱀이 있으면 오른다.
    fillLenPerMunits2: Math.round(mean(allTotalLen) / (area / 1e6)),
  },
  // F. 초거대의 생존과 사냥
  giants: {
    lifeMeanS: r2(mean(allLifeGiant)),
    lifeMedS: r1(pct(allLifeGiant, 0.5)),
    samples: allLifeGiant.length,
    botLifeMeanS: r2(mean(allLifeAll)),
    deaths: giantDeaths,
    playerKilledGiants: playerGiantKills,
    playerKillShareOfGiantDeaths: giantDeaths ? r2(playerGiantKills / giantDeaths) : 0,
  },
  /* ★★ H. 기준 플레이어 — «사람 체감»에 가장 가까운 지표.
        봇 두뇌와 «독립»이라 봇을 세게 해도 자가 같이 세지지 않는다. */
  refPlayer: {
    refVer,
    rushP: refVer === 2 ? RUSH_P : null,
    rushSc: refVer === 2 ? RUSH_SC : null,
    fleeAt: refVer === 2 ? FLEE_AT : null,
    // ★자가 부스트를 «실제로 쓰는가». v1 은 0.0002 였다(=자에 손잡이가 안 닿았다).
    boostFrac: r2(mean(refRuns.map((x) => x.boostFrac)) * 1000) / 1000,
    boostMeanS: r2(mean(refRuns.map((x) => x.boostS))),
    runs: refRuns.length,
    lifeMeanS: r1(mean(refRuns.map((x) => x.lifeS))),
    lifeMedS: r1(pct(refRuns.map((x) => x.lifeS), 0.5)),
    peakMean: Math.round(mean(refRuns.map((x) => x.peak))),
    peakMed: Math.round(pct(refRuns.map((x) => x.peak), 0.5)),
    peakP90: Math.round(pct(refRuns.map((x) => x.peak), 0.9)),
    peakMax: Math.round(maxOf(refRuns.map((x) => x.peak))),
    rankAtEndMed: Math.round(pct(refRuns.map((x) => x.rankAtEnd), 0.5)),
    rankAtEndBest: Math.round(pct(refRuns.map((x) => x.rankAtEnd), 0)),
    everRank1: refRuns.filter((x) => x.firstRank1 >= 0).length,
    rank1Frac: r2(mean(refRuns.map((x) => x.rank1Frac))),
    cause: refCause,
  },
  // G. 봇 전술 카운터(bots.ts 가 노출할 때만)
  tactics: botDebug && botDebug.snapshot ? botDebug.snapshot() : null,
  rows: {
    ref: refRows,
    perSeed: runs.map((r, i) => ({
      seed: runSeeds[i],
      giantAliveMean: r2(mean(r.giantAlive)),
      megaAliveMean: r2(mean(r.megaAlive)),
      massMax: Math.round(maxOf(r.massSamples)),
      massMed: Math.round(pct(r.massSamples, 0.5)),
      massP99: Math.round(pct(r.massSamples, 0.99)),
      botLifeMean: r2(mean(r.lifeAll)),
      totalLenMean: Math.round(mean(r.totalLen)),
      playerDeaths: r.playerDeaths,
      runPeakMean: Math.round(mean(r.playerRunPeaks)),
    })),
  },
};

console.log(JSON.stringify(report));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
