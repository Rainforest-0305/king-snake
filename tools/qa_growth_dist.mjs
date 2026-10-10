// qa_growth_dist.mjs — 「기록 돌파 리워드」의 «도달률»과 «랭킹 공정성»을 실측한다.
//
// ══ 이 도구가 답하는 두 질문 (President 요구, 2026-08-31) ═════════════════
//  ① 문턱 2,000 · 5,000 · 10,000 이 «실제로 도달 가능한가».
//     못 닿으면 이 기능은 거의 안 뜬다 — 배수를 논하기 전에 답해야 한다.
//  ② 광고를 본 유저가 «순위표에서» 얼마나 유리해지는가.
//     1.2배가 여러 번 걸리면 누적된다. 격차를 수치로 낸다.
//
// ══ 방법 ═════════════════════════════════════════════════════════════════
//  브라우저 없이 World 만 돌린다(창 0·렌더 0). autoPilot=true 로 두면 0번 슬롯
//  (플레이어 자리)을 «봇 AI» 가 조종한다 — 사람 대신 두는 대리 플레이어다.
//  ⚠️대리다. 숙련된 사람은 더 높이 간다. 그래서 봇 최고 질량(botPeak)도 같이 낸다 —
//    그건 «이 경제에서 어떤 뱀이든 도달한 상한»이라 사람의 천장을 가늠하는 대조군이다.
//
//  A안(대조군) : 아무것도 안 한다.
//  B안(처치군) : 점수가 문턱/개인최고를 넘는 «순간» 질량 x1.2. 판당 최대 CAP 회.
//               개인 최고 기록은 시드 안에서 «판을 넘어» 이어진다(실제 유저와 같다).
//
// 사용: node tools/qa_growth_dist.mjs <bundle.mjs> <seedStart> <seedCount> <seconds>
//         [minGapS]                       ← 생략하면 쿨다운 0(=규칙 없음)으로 잰다
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [, , bundle, seedStart, seedCount, secs] = process.argv;
const { World } = await import(pathToFileURL(bundle).href);

const DT = 1 / 60;
const T = Number(secs || 900);
const N = Number(seedCount || 16);
const S0 = Number(seedStart || 20260831);
const STEPS = Math.round(T / DT);

/* ★상수를 «손으로 베끼지 않는다» — 정본 소스에서 읽는다.
     베껴 두면 상수를 바꿔도 옛 값으로 측정하는 «죽은 시뮬»이 된다
     (auto-memory 「테스트가 틀린 값을 고정한다」의 실사고 형태).
     여기서 import 하지 않는 이유는 이 파일이 esbuild 로 만든 «게임 전용» 번들만
     읽기 때문이다(World). 그래서 텍스트로 읽되, 못 찾으면 «즉시 죽는다». */
const SRC = readFileSync(new URL('../src/reward/growthTriggers.ts', import.meta.url), 'utf8');
const pick = (name, re) => {
  const m = SRC.match(re);
  if (!m) throw new Error(`growthTriggers.ts 에서 ${name} 를 못 읽었다 — 시뮬을 멈춘다`);
  return m[1];
};
const TH = JSON.parse(pick('GROWTH_THRESHOLDS',
  /GROWTH_THRESHOLDS:\s*readonly number\[\]\s*=\s*(\[[^\]]*\])/));
const CAP = Number(pick('GROWTH_MAX_PER_RUN', /GROWTH_MAX_PER_RUN\s*=\s*(\d+)/));
const BEST_MIN = Number(pick('GROWTH_BEST_MIN', /GROWTH_BEST_MIN\s*=\s*(\d+)/));
/* 배너가 떠 있는 시간(초). 이 시간이 지나면 사라지고 그 기회는 없어진다. */
const OFFER_S = Number(pick('GROWTH_OFFER_S', /GROWTH_OFFER_S\s*=\s*(\d+)/));
/* 성장 배수만은 gameEffects.ts 소관이라 여기 남는다. R13-a 가 운영 코드로 잰다. */
const K = 1.2;
/* 제안 사이 «최소 플레이 시간»(초). 0 이면 쿨다운 없음. 4번째 인자로 덮어쓸 수 있다.
   ★ 벽시계가 아니라 «월드 시계»다 — 멈춰 있는 동안은 안 흐른다. */
const GAP_S = Number(process.argv[6] || 0);

function simulate(seed, treat) {
  const w = new World(seed, 'QA', 'default', true);
  w.hooks = {};
  const p = w.player;
  const lives = [];
  let best = 0;                    // 시드 안에서 이어지는 «개인 최고 기록»
  let peak = 0, wasAlive = p.alive, t0 = 0;
  let used = TH.map(() => false), bestUsed = false, grants = 0;
  let shown = 0, offersThisRun = 0, grantsThisRun = 0;
  /* 지금 떠 있는 배너: 만료 «월드 시각». -1 = 없음. */
  let bannerUntil = -1;
  let bannerExpired = 0, bannerDiedWith = 0;
  const firedIdx = TH.map(() => 0);
  let bestFired = 0, capBound = false, lastOfferT = -1e9;
  const gaps = [];
  let blockedByCap = 0;   // 상한 때문에 «못 뜬» 트리거(문턱 기준)
  let botPeak = 0;
  let lastScore = 0, lastRank = 0;

  const resetRun = () => {
    peak = 0; t0 = w.time;
    used = TH.map(() => false); bestUsed = false; shown = 0;
    offersThisRun = 0; grantsThisRun = 0; bannerUntil = -1;
    capBound = false; lastOfferT = -1e9;
  };

  for (let i = 0; i < STEPS; i++) {
    w.step(DT);
    if (p.alive) {
      if (!wasAlive) resetRun();
      const score = Math.floor(p.mass);
      if (score > peak) peak = score;
      lastScore = score;
      lastRank = w.rankOf(p.id);
      /* ★배너 만료 = «수락 가능한 순간». 여기서 비로소 보상이 들어간다.
         이 시점의 질량이 기준이다(President 2026-09-01: 광고 직전 x 1.2).
         ⇒ 「전원이 5초 뒤에 누른다」는 «상한» 가정이다. 실제 탭률은 알 수 없고
           추측하지 않는다 — 아래 요약이 offers 와 grants 를 따로 낸다. */
      if (treat && bannerUntil >= 0 && w.time >= bannerUntil) {
        bannerUntil = -1;
        bannerExpired++;
        grants++; grantsThisRun++;
        p.mass *= K;
        p.updateDerived();
        p.rebuildCollisionPoints();
      }
      if (treat && shown >= CAP) {
        // 상한에 막혀 «못 뜬» 트리거를 센다(중복 계수를 막으려고 닫으며 센다).
        for (let k = 0; k < TH.length; k++) if (!used[k] && score >= TH[k]) { used[k] = true; blockedByCap++; capBound = true; }
        if (!bestUsed && best >= BEST_MIN && score > best) bestUsed = true;
      }
      if (treat && shown < CAP && bannerUntil < 0 && w.time - lastOfferT >= GAP_S) {
        // growthTriggers.evaluate 와 «같은 순서»: 문턱 우선, 그다음 개인 최고.
        let hit = -1;
        // ★growthTriggers.evaluate 와 «같게» — 가장 «높은» 미소비 문턱을 고른다.
        for (let k = TH.length - 1; k >= 0; k--) if (!used[k] && score >= TH[k]) { hit = k; break; }
        // ★최고기록은 «저단» 슬롯이다 — 고단 슬롯을 잡아먹지 않는다.
        const bestHit = !bestUsed && best >= BEST_MIN && score > best;
        if (hit >= 0 || bestHit) {
          // consume: «그 순간 걸린 트리거를 전부» 닫는다(동시 발동 시 하나만 뜬다).
          for (let k = 0; k < TH.length; k++) if (!used[k] && score >= TH[k]) used[k] = true;
          if (bestHit) bestUsed = true;
          if (hit >= 0) firedIdx[hit]++; else bestFired++;
          if (lastOfferT > -1e8) gaps.push(+(w.time - lastOfferT).toFixed(2));
          lastOfferT = w.time;
          shown++;
          offersThisRun++;
          /* ★보상은 «여기서» 안 준다. 배너가 5초 떠 있고, 그 5초를 살아남아야
             누를 수 있다. 못 살아남으면 이 제안은 그냥 사라진다(의도된 결과). */
          bannerUntil = w.time + OFFER_S;
        }
      }
    } else if (wasAlive) {
      if (bannerUntil >= 0) { bannerDiedWith++; bannerUntil = -1; }
      lives.push({
        peak, seconds: +(w.time - t0).toFixed(1), endScore: lastScore, endRank: lastRank,
        offers: offersThisRun, grants: grantsThisRun,
      });
      if (lastScore > best) best = lastScore;
      peak = 0;
    }
    wasAlive = p.alive;
    if (i % 60 === 0) for (const s of w.snakes) if (!s.isPlayer && s.alive && s.mass > botPeak) botPeak = s.mass;
  }
  return {
    lives, grants, botPeak: Math.round(botPeak), firedIdx, bestFired, gaps, blockedByCap,
    bannerExpired, bannerDiedWith,
  };
}

const q = (a, f) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * f))] : 0);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

function summarize(all, grants) {
  const peaks = all.map((l) => l.peak).sort((x, y) => x - y);
  const ranks = all.map((l) => l.endRank).filter((r) => r > 0).sort((x, y) => x - y);
  const rate = (th) => +((100 * all.filter((l) => l.peak >= th).length) / all.length).toFixed(1);
  return {
    lives: all.length,
    grantsPerRun: +(grants / all.length).toFixed(3),
    secMedian: q(all.map((l) => l.seconds).sort((x, y) => x - y), 0.5),
    peak: {
      p25: q(peaks, 0.25), median: q(peaks, 0.5), p75: q(peaks, 0.75),
      p90: q(peaks, 0.9), p95: q(peaks, 0.95), p99: q(peaks, 0.99),
      max: peaks[peaks.length - 1], mean: Math.round(mean(peaks)),
    },
    endRank: { best: ranks[0], median: q(ranks, 0.5), mean: +mean(ranks).toFixed(2) },
    /** 한 판에 배너를 몇 번 «봤는가»의 분포(%). 수락 여부와 무관한 «노출» 수다. */
    offersPerRun: (() => {
      const n = all.length, o = all.map((l) => l.offers || 0);
      const pct = (f) => +((100 * o.filter(f).length) / n).toFixed(2);
      return {
        0: pct((x) => x === 0), 1: pct((x) => x === 1), 2: pct((x) => x === 2),
        '3plus': pct((x) => x >= 3), max: o.length ? Math.max(...o) : 0,
      };
    })(),
    /** 판당 «노출» 수(제안). 지급(grantsPerRun)과 다르다 — 5초를 못 버티면 사라진다. */
    offersPerRunMean: +(all.reduce((s, l) => s + (l.offers || 0), 0) / all.length).toFixed(3),
    top3Pct: +((100 * ranks.filter((r) => r <= 3).length) / Math.max(1, ranks.length)).toFixed(1),
    top10Pct: +((100 * ranks.filter((r) => r <= 10).length) / Math.max(1, ranks.length)).toFixed(1),
    reach: {
      300: rate(300), 500: rate(500), 1000: rate(1000), 1600: rate(1600),
      2000: rate(2000), 3000: rate(3000), 5000: rate(5000), 10000: rate(10000),
    },
  };
}

const out = {
  seeds: N, secondsPerSeed: T, thresholds: TH, k: K,
  capPerRun: CAP, offerS: OFFER_S, bestMin: BEST_MIN, minGapS: GAP_S,
};
for (const arm of ['control', 'treat']) {
  const all = [];
  let grants = 0, blocked = 0, bestFired = 0, bannerExpired = 0, bannerDiedWith = 0;
  const fired = TH.map(() => 0);
  const gaps = [];
  const botPeaks = [];
  for (let i = 0; i < N; i++) {
    const r = simulate((S0 + i * 7919) >>> 0, arm === 'treat');
    all.push(...r.lives);
    grants += r.grants;
    blocked += r.blockedByCap;
    bestFired += r.bestFired;
    bannerExpired += r.bannerExpired;
    bannerDiedWith += r.bannerDiedWith;
    for (let k = 0; k < TH.length; k++) fired[k] += r.firedIdx[k];
    gaps.push(...r.gaps);
    botPeaks.push(r.botPeak);
  }
  botPeaks.sort((a, b) => a - b);
  out[arm] = summarize(all, grants);
  gaps.sort((a, b) => a - b);
  out[arm].offers = {
    byThreshold: TH.map((t, k) => [t, fired[k]]),
    byBestRecord: bestFired,
    blockedByRunCap: blocked,
    /** 같은 판 안에서 «연속 제안» 사이 간격(초, 월드 시계 = 실제 플레이 시간). */
    gapSeconds: {
      n: gaps.length, min: gaps[0], p10: q(gaps, 0.1), p25: q(gaps, 0.25),
      median: q(gaps, 0.5), p75: q(gaps, 0.75), max: gaps[gaps.length - 1],
      under3s: gaps.filter((g) => g < 3).length,
      under5s: gaps.filter((g) => g < 5).length,
      under10s: gaps.filter((g) => g < 10).length,
    },
  };
  out[arm].offers.bannerSurvived = bannerExpired;
  out[arm].offers.bannerDiedWith = bannerDiedWith;
  /** ★배너가 뜬 뒤 5초를 «살아남은» 비율. 이게 수락률의 천장이다. */
  out[arm].offers.survive5sPct = (bannerExpired + bannerDiedWith)
    ? +((100 * bannerExpired) / (bannerExpired + bannerDiedWith)).toFixed(1) : 0;
  out[arm].botPeakMedian = botPeaks[botPeaks.length >> 1];
  out[arm].botPeakMax = botPeaks[botPeaks.length - 1];
}
// 격차: 같은 분위수에서 처치군이 대조군보다 몇 배인가.
out.gap = {};
for (const k of ['median', 'p75', 'p90', 'p95', 'p99', 'mean']) {
  out.gap[k] = +(out.treat.peak[k] / Math.max(1, out.control.peak[k])).toFixed(3);
}
out.gap.meanRankDelta = +(out.control.endRank.mean - out.treat.endRank.mean).toFixed(2);
out.gap.top3PctDelta = +(out.treat.top3Pct - out.control.top3Pct).toFixed(1);
console.log(JSON.stringify(out, null, 1));
