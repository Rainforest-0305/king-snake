// sim_bots.mjs — «봇 세계»를 잰다. 브라우저 없음, 창 없음.
//
// ★ 왜 새로 만드나 (2026-09-04)
//   sim_run.mjs 는 «오토파일럿 플레이어»의 peak 를 잰다. 그 대리인은 peak
//   중앙값이 1,300 이라 President 실력대(3만+)를 대표하지 못한다. 약한 대리인으로
//   재니 난도 변화가 분산에 통째로 묻혔다(16시드 A/B 비단조).
//   ⇒ 봇을 바꾸면 «봇 세계»가 먼저 바뀐다. 그쪽을 직접 잰다.
//
// ★ 사망 원인은 «계측을 새로 넣지 않고» 읽는다.
//   world.resolveCollisions 가 매 스텝 deadIds/deadKiller/deadCause 를 채운다
//   ('border' | 'body' | 'headon'). TypeScript private 은 컴파일 타임 표시일
//   뿐이라 런타임에서는 그냥 속성이다. step() 직후에 읽으면 그 스텝의 사망이다.
//   ⇒ 운영 코드를 한 줄도 안 건드리고 사망 원인 분포가 나온다.
//
// 지표
//   ★초거대(태어날 때 질량 >= TITAN) 평균 생존시간 + 사망원인 분포  ← 이번 주 지표
//   상위 봇 T초 질량 / 분당 킬 / 중위 봇 생존 / 가두리 발동·킬비율 / 오토파일럿 peak(보조)
//
// 사용: node tools/sim_bots.mjs <bundle.mjs> <seedStart> <seedCount> <seconds>
import { pathToFileURL } from 'node:url';

const [, , bundle, seedStart, seedCount, secs] = process.argv;
const mod = await import(pathToFileURL(bundle).href);
const { World, __botDebug, __cfg, __gridDebug } = mod;

const DT = 1 / 60;
const T = Number(secs || 180);
const N = Number(seedCount || 20);
const S0 = Number(seedStart || 20260818);
const STEPS = Math.round(T / DT);
const MARKS = [60, 120, 180].filter((m) => m <= T);
// 초거대 기준은 «상수에서 유도»한다. 손으로 3000 을 박으면 상수가 바뀔 때 조용히 틀린다.
const TITAN = (__cfg && __cfg.SPAWN_MASS_TITAN) || 3000;
/** 「초반에 죽었다」의 정의(초). 자기 생 기준. */
const EARLY = 10;

const med = (a) => {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};
const r2 = (x) => Math.round(x * 100) / 100;
const pct = (a, b) => (b ? r2((a / b) * 100) : 0);

const runs = [];
for (let k = 0; k < N; k++) {
  const seed = S0 + k * 7919;
  if (__botDebug) __botDebug.reset();
  if (__gridDebug) __gridDebug.reset();
  const w = new World(seed, 'QA', 'default', true);

  const n = w.snakes.length;
  const prevKills = new Int32Array(n);
  const prevAlive = new Uint8Array(n);
  const bornAt = new Float64Array(n);
  const bornMass = new Float64Array(n);
  const lifetimes = [];
  const titanLives = [];
  const titanCause = { border: 0, body: 0, headon: 0, other: 0 };
  let titanEarly = 0;
  let titanDeaths = 0;
  const allCause = { border: 0, body: 0, headon: 0, other: 0 };
  let kills = 0;
  let wrapKills = 0;
  // ★「죽는 순간 질주 중이었나」 — 질주 가설의 «직접» 증거.
  //   질주하면 회전 반경이 102 -> 192 가 되므로, 이 비율이 낮으면 그 가설은
  //   A/B 를 볼 것도 없이 틀린 것이다.
  let titanDeadBoosting = 0;
  let allDeadBoosting = 0;
  let playerPeak = 0;
  const topAt = {};
  /* ★플레이어 쪽 지표 — 킬이 줄었을 때 「난도 상승」인지 「심심해짐」인지 가른다.
     · 오브 총량/개수 : 킬이 줄면 흘리는 것도 준다 → 성장이 느려지면 체감은
                        「어렵다」가 아니라 「느리다」가 된다. 그건 개선이 아니다.
     · 1위 3만 도달 시각 : 세계의 «속도». 느려지면 판이 늘어진다.
     · 초거대 동시 존재 수 : 생존이 2배면 이것도 늘어야 정상이다. 안 늘면
                             어딘가에서 상쇄되고 있다는 뜻이다. */
  let orbNSum = 0;
  let orbVSum = 0;
  let orbSamples = 0;
  let titanConcSum = 0;
  let top1Reach30k = -1;

  for (let i = 0; i < n; i++) {
    prevAlive[i] = w.snakes[i].alive ? 1 : 0;
    prevKills[i] = w.snakes[i].kills | 0;
    bornMass[i] = w.snakes[i].mass;
  }

  for (let s = 0; s < STEPS; s++) {
    // ★ 스텝 «전»에 wrapping 을 스냅샷한다. 스텝 안에서 상태가 정리되면
    //   그 킬을 누구 공으로 돌릴지 알 수 없게 된다.
    const wrapNow = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const b = w.botStates[i];
      wrapNow[i] = b && b.wrapping ? 1 : 0;
    }
    w.step(DT);
    const t = (s + 1) * DT;

    // ── 이 스텝의 사망: 원인별로 «태어날 때 초거대였는가»와 함께 센다
    const dIds = w.deadIds || [];
    const dCause = w.deadCause || [];
    for (let q = 0; q < dIds.length; q++) {
      const id = dIds[q];
      const c = dCause[q] || 'other';
      const bucket = (c === 'border' || c === 'body' || c === 'headon') ? c : 'other';
      allCause[bucket]++;
      // boosting 은 botThink 가 매 스텝 갱신하고 사망 처리는 그것을 지우지
      // 않는다 - 죽은 그 프레임의 상태가 그대로 남아 있다.
      const wasBoost = w.snakes[id] && w.snakes[id].boosting ? 1 : 0;
      allDeadBoosting += wasBoost;
      if (w.snakes[id] && w.snakes[id].isPlayer) continue;
      if (bornMass[id] >= TITAN) {
        titanDeadBoosting += wasBoost;
        titanCause[bucket]++;
        titanDeaths++;
        const age = t - bornAt[id];
        titanLives.push(age);
        if (age <= EARLY) titanEarly++;
      }
    }

    for (let i = 0; i < n; i++) {
      const sn = w.snakes[i];
      const kNow = sn.kills | 0;
      if (kNow > prevKills[i]) {
        const d = kNow - prevKills[i];
        kills += d;
        if (wrapNow[i]) wrapKills += d;
        prevKills[i] = kNow;
      }
      const a = sn.alive ? 1 : 0;
      if (prevAlive[i] && !a) {
        if (!sn.isPlayer) lifetimes.push(t - bornAt[i]);
      } else if (!prevAlive[i] && a) {
        bornAt[i] = t;
        bornMass[i] = sn.mass;          // 리스폰은 «작게» 태어난다 - 초거대 아님
        prevKills[i] = sn.kills | 0;
      }
      prevAlive[i] = a;
    }
    if (w.player.alive && w.player.mass > playerPeak) playerPeak = w.player.mass;

    // 1초에 한 번만 표본을 뜬다(매 스텝 훑으면 시뮬이 느려진다).
    if (s % 60 === 59) {
      let on = 0;
      let ov = 0;
      for (let i = 0; i < w.orbs.n; i++) { on++; ov += w.orbs.vs[i]; }
      orbNSum += on;
      orbVSum += ov;
      orbSamples++;
      let conc = 0;
      let top = 0;
      for (const sn of w.snakes) {
        if (sn.isPlayer || !sn.alive) continue;
        if (sn.mass >= TITAN) conc++;
        if (sn.mass > top) top = sn.mass;
      }
      titanConcSum += conc;
      if (top1Reach30k < 0 && top >= 30000) top1Reach30k = t;
    }

    for (const m of MARKS) {
      if (topAt[m] === undefined && t >= m) {
        const ms = w.snakes.filter((x) => !x.isPlayer && x.alive)
          .map((x) => x.mass).sort((a2, b2) => b2 - a2);
        topAt[m] = {
          top1: Math.round(ms[0] || 0),
          top5: Math.round(ms.slice(0, 5).reduce((p, c) => p + c, 0)
            / Math.max(1, Math.min(5, ms.length))),
        };
      }
    }
  }

  // 살아남은 초거대도 생존시간에 포함한다(안 넣으면 «죽은 것만» 세어 편향된다).
  let titanAlive = 0;
  for (let i = 0; i < n; i++) {
    if (w.snakes[i].isPlayer) continue;
    if (bornMass[i] >= TITAN && w.snakes[i].alive) {
      titanAlive++;
      titanLives.push(T - bornAt[i]);
    }
  }

  runs.push({
    seed,
    killsPerMin: kills / (T / 60),
    wrapKillPct: kills ? (wrapKills / kills) * 100 : 0,
    lifeMed: med(lifetimes),
    deaths: lifetimes.length,
    titanN: titanDeaths + titanAlive,
    titanLifeMed: med(titanLives),
    titanEarlyPct: pct(titanEarly, titanDeaths + titanAlive),
    titanSurvivePct: pct(titanAlive, titanDeaths + titanAlive),
    titanCause: { ...titanCause },
    allCause: { ...allCause },
    topAt,
    playerPeak: Math.round(playerPeak),
    wrapStart: __botDebug ? __botDebug.wrapStart : 0,
    elitePromote: __botDebug ? __botDebug.elitePromote : 0,
    shelterTicks: __botDebug ? (__botDebug.shelterTicks || 0) : 0,
    shelterShieldTicks: __botDebug ? (__botDebug.shelterShieldTicks || 0) : 0,
    // ★후보 버퍼가 넘쳐 «조용히» 잘린 횟수. 0 이 아니면 이 실험은 무효다.
    gridTruncated: __gridDebug ? __gridDebug.truncated : 0,
    orbNAvg: orbSamples ? orbNSum / orbSamples : 0,
    orbVAvg: orbSamples ? orbVSum / orbSamples : 0,
    titanConcAvg: orbSamples ? titanConcSum / orbSamples : 0,
    top1Reach30k,
    titanDeadBoostPct: pct(titanDeadBoosting, titanDeaths),
    allDeadBoostPct: pct(allDeadBoosting, lifetimes.length),
  });
}

const sumC = (key) => {
  const o = { border: 0, body: 0, headon: 0, other: 0 };
  for (const r of runs) for (const k2 of Object.keys(o)) o[k2] += r[key][k2];
  const tot = Object.values(o).reduce((a, b) => a + b, 0);
  return { ...o, total: tot,
    borderPct: pct(o.border, tot), bodyPct: pct(o.body, tot),
    headonPct: pct(o.headon, tot) };
};

const out = {
  n: N, seconds: T, titanMass: TITAN,
  // ★주 지표
  titanLifeMed: r2(med(runs.map((r) => r.titanLifeMed))),
  titanEarlyPctMed: r2(med(runs.map((r) => r.titanEarlyPct))),
  titanSurvivePctMed: r2(med(runs.map((r) => r.titanSurvivePct))),
  titanNMed: med(runs.map((r) => r.titanN)),
  titanCause: sumC('titanCause'),
  allCause: sumC('allCause'),
  // 보조
  killsPerMinMed: r2(med(runs.map((r) => r.killsPerMin))),
  wrapKillPctMed: r2(med(runs.map((r) => r.wrapKillPct))),
  lifeMedMed: r2(med(runs.map((r) => r.lifeMed))),
  wrapStartPerMinMed: r2(med(runs.map((r) => r.wrapStart / (T / 60)))),
  elitePromoteMed: med(runs.map((r) => r.elitePromote)),
  playerPeakMed: med(runs.map((r) => r.playerPeak)),
  gridTruncated: runs.reduce((a, r) => a + r.gridTruncated, 0),
  shelterTicksMed: med(runs.map((r) => r.shelterTicks)),
  orbNMed: r2(med(runs.map((r) => r.orbNAvg))),
  orbVMed: r2(med(runs.map((r) => r.orbVAvg))),
  titanConcMed: r2(med(runs.map((r) => r.titanConcAvg))),
  reach30kN: runs.filter((r) => r.top1Reach30k >= 0).length,
  reach30kMed: r2(med(runs.filter((r) => r.top1Reach30k >= 0)
    .map((r) => r.top1Reach30k))),
  shelterShieldPctMed: r2(med(runs.map((r) =>
    r.shelterTicks ? (r.shelterShieldTicks / r.shelterTicks) * 100 : 0))),
  titanDeadBoostPctMed: r2(med(runs.map((r) => r.titanDeadBoostPct))),
  allDeadBoostPctMed: r2(med(runs.map((r) => r.allDeadBoostPct))),
};
for (const m of MARKS) {
  out['top1_' + m] = med(runs.map((r) => (r.topAt[m] || {}).top1 || 0));
  out['top5_' + m] = med(runs.map((r) => (r.topAt[m] || {}).top5 || 0));
}
out.runs = runs;
console.log(JSON.stringify(out));
