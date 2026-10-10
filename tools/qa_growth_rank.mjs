// qa_growth_rank.mjs — 「1.2배가 «순위»를 몇 자리 올려 주는가」를 직접 잰다.
//
// ══ 왜 A/B 분포 비교로는 부족한가 ═════════════════════════════════════════
//  qa_growth_dist.mjs 는 «기능이 켜진 세계 전체»의 분포를 본다. 그런데 이 기능은
//  아주 드물게 발동해서(실측 0.06회/판) 전체 분포가 거의 안 움직인다 —
//  「영향이 없다」로 읽히기 쉽지만 그건 «발동했을 때의 영향»이 아니다.
//  ⇒ 여기서는 조건부로 잰다: «지금 이 순간» 내 질량이 1.2배였다면 몇 위였겠는가.
//     순위는 world.ranking 이 mass 순 정렬이므로 「나보다 큰 뱀 수 + 1」로 정확히 계산된다.
//
// 사용: node tools/qa_growth_rank.mjs <bundle.mjs> <seedStart> <seedCount> <seconds>
import { pathToFileURL } from 'node:url';

const [, , bundle, seedStart, seedCount, secs] = process.argv;
const { World } = await import(pathToFileURL(bundle).href);

const DT = 1 / 60;
const T = Number(secs || 600);
const N = Number(seedCount || 12);
const S0 = Number(seedStart || 20260831);
const STEPS = Math.round(T / DT);
const SAMPLE_EVERY = 30;     // 0.5초마다
const K = 1.2;

/** 점수 구간. 문턱(2000)과 도달률이 있는 대역을 함께 본다. */
const BANDS = [
  [100, 300], [300, 500], [500, 1000], [1000, 2000], [2000, 5000], [5000, 1e9],
];

const rows = BANDS.map(() => ({ n: 0, rank: 0, rankK: 0, gain: 0, top10: 0, top10K: 0, top3: 0, top3K: 0 }));

for (let k = 0; k < N; k++) {
  const w = new World((S0 + k * 7919) >>> 0, 'QA', 'default', true);
  w.hooks = {};
  const p = w.player;
  for (let i = 0; i < STEPS; i++) {
    w.step(DT);
    if (i % SAMPLE_EVERY !== 0 || !p.alive) continue;
    const score = Math.floor(p.mass);
    let bi = -1;
    for (let b = 0; b < BANDS.length; b++) if (score >= BANDS[b][0] && score < BANDS[b][1]) { bi = b; break; }
    if (bi < 0) continue;
    // 순위 = 「나보다 큰 살아 있는 뱀 수 + 1」. world.updateRanking 과 같은 정의다.
    let above = 0, aboveK = 0;
    const boosted = p.mass * K;
    for (const s of w.snakes) {
      if (!s.alive || s.isPlayer) continue;
      if (s.mass > p.mass) above++;
      if (s.mass > boosted) aboveK++;
    }
    const r = rows[bi];
    r.n++;
    r.rank += above + 1;
    r.rankK += aboveK + 1;
    r.gain += above - aboveK;
    if (above + 1 <= 10) r.top10++;
    if (aboveK + 1 <= 10) r.top10K++;
    if (above + 1 <= 3) r.top3++;
    if (aboveK + 1 <= 3) r.top3K++;
  }
}

const out = { seeds: N, secondsPerSeed: T, k: K, bands: [] };
for (let b = 0; b < BANDS.length; b++) {
  const r = rows[b];
  if (!r.n) continue;
  out.bands.push({
    band: BANDS[b][1] > 1e8 ? `${BANDS[b][0]}+` : `${BANDS[b][0]}~${BANDS[b][1]}`,
    samples: r.n,
    rankNow: +(r.rank / r.n).toFixed(2),
    rankIfGrown: +(r.rankK / r.n).toFixed(2),
    placesGained: +(r.gain / r.n).toFixed(2),
    top10Pct: +((100 * r.top10) / r.n).toFixed(1),
    top10PctIfGrown: +((100 * r.top10K) / r.n).toFixed(1),
    top3Pct: +((100 * r.top3) / r.n).toFixed(1),
    top3PctIfGrown: +((100 * r.top3K) / r.n).toFixed(1),
  });
}
console.log(JSON.stringify(out, null, 1));
