// bench.mjs — 헤드리스 밸런스/성능 벤치.
//
// ★ 「재밌는가」는 감이지만, 감을 «좁히는» 숫자는 있다:
//     · 생존 시간 분포 — 5초 만에 죽으면 화가 나고, 10분을 살면 지루하다.
//     · 사망 원인 분포 — 전부 「경계」면 맵이 좁은 것이고, 전부 「정면충돌」이면
//       봇이 자살하는 것이다.
//     · 최종 순위/점수 — 잘하면 올라갈 수 있는가(천장이 있는가).
//     · 시뮬 1스텝 비용(ms) — 렌더를 빼고도 60fps 예산(16.6ms)을 먹으면 안 된다.
//   이 스크립트는 그 숫자를 «실측»한다. 브라우저 없이 game/ 만 번들해 돌린다
//   (game/ 이 DOM 을 import 하지 않는다는 단방향 규칙 덕에 가능하다).
//
// 실행:
//   node tools/bench.mjs                 # 기본 24판
//   node tools/bench.mjs --runs 60 --tier hunter
//
// ★ 플레이어 자리를 «regular 등급 봇»이 조종한다. 사람보다는 못하지만
//   「가만히 서 있는 허수아비」보다 훨씬 나은 대리 지표다. 사람 기준은
//   이 값보다 대체로 길게 나온다고 보면 된다.

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}

const RUNS = Number(arg('runs', 24));
const TIER = arg('tier', 'regular');
const MAX_SECONDS = Number(arg('max', 300));
const STEP = 1 / 60;

const dir = mkdtempSync(join(tmpdir(), 'coilbench-'));
const out = join(dir, 'game.mjs');

await build({
  entryPoints: ['src/game/world.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2020',
  outfile: out,
  logLevel: 'error',
});

const mod = await import(pathToFileURL(out).href);
const { World } = mod;

// bots.ts / rng.ts 는 world 번들 안에 있지만 export 되지 않는다.
// 플레이어를 봇 두뇌로 굴리려면 world 가 이미 들고 있는 botStates 를 쓰면 된다:
// autoPilot=true 로 만들면 0번(플레이어)에 봇 두뇌가 붙는다. 다만 autoPilot 은
// 죽어도 리스폰하므로, 여기서는 «첫 사망 시각»을 직접 감지해 판을 끝낸다.

const results = [];
let stepMsTotal = 0;
let stepCount = 0;

for (let run = 0; run < RUNS; run++) {
  const seed = (run * 2654435761 + 12345) >>> 0;
  const w = new World(seed, 'BENCH', 'ember', true);
  const b = w.botStates[0];
  if (b) b.tier = TIER;

  const p = w.player;
  let t = 0;
  let peakMass = p.mass;
  let died = false;
  let cause = 'timeout';
  let kills = 0;
  let rankAtDeath = 0;

  // autoPilot 이라 world 가 사망을 알려주지 않는다. alive 플래그를 직접 본다.
  while (t < MAX_SECONDS) {
    const t0 = process.hrtime.bigint();
    w.step(STEP);
    const t1 = process.hrtime.bigint();
    stepMsTotal += Number(t1 - t0) / 1e6;
    stepCount++;
    t += STEP;

    if (p.mass > peakMass) peakMass = p.mass;
    kills = p.kills;
    // ★ 순위는 «살아 있는 동안» 매 스텝 기록해 둔다.
    //   죽은 뒤에 rankOf 를 부르면 ranking 에서 이미 빠져 「꼴찌+1」이 나온다
    //   (실제로 첫 벤치에서 전 판이 27~29위로 찍혀 오해했다. 게임 코드는 정상 -
    //    world 는 updateRanking 전에 rankOf 를 부르므로 «죽기 직전» 순위를 쓴다).
    if (p.alive) rankAtDeath = w.rankOf(p.id);
    if (!p.alive) {
      died = true;
      // 사망 원인은 world 가 훅으로만 알려준다. autoPilot 이면 훅이 안 불린다.
      // 대신 위치로 추정한다(경계 밖이면 border).
      cause = Math.hypot(p.x, p.y) > 2200 ? 'border' : 'body';
      break;
    }
  }

  results.push({
    seed,
    seconds: Number(t.toFixed(1)),
    died,
    cause: died ? cause : 'survived',
    peak: Math.round(peakMass),
    kills,
    rank: rankAtDeath,
    topBot: Math.round(w.snakes[w.ranking[0]].mass),
    orbs: w.orbs.n,
    bodyPts: w.bodyPointCount,
  });
  process.stdout.write('.');
}
process.stdout.write('\n');
rmSync(dir, { recursive: true, force: true });

function stats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return {
    min: s[0],
    p25: q(0.25),
    median: q(0.5),
    p75: q(0.75),
    max: s[s.length - 1],
    mean: Number((s.reduce((a, b) => a + b, 0) / s.length).toFixed(1)),
  };
}

const secs = results.map((r) => r.seconds);
const peaks = results.map((r) => r.peak);
const ranks = results.map((r) => r.rank);
const causeCount = {};
for (const r of results) causeCount[r.cause] = (causeCount[r.cause] ?? 0) + 1;

console.log('\n== King Snake bench ==');
console.log('runs', RUNS, ' tier', TIER, ' maxSeconds', MAX_SECONDS);
console.log('생존시간(초) ', JSON.stringify(stats(secs)));
console.log('최고질량     ', JSON.stringify(stats(peaks)));
console.log('사망시 순위  ', JSON.stringify(stats(ranks)));
console.log('킬 합계      ', results.reduce((a, r) => a + r.kills, 0));
console.log('사망 원인    ', JSON.stringify(causeCount));
console.log('1등 봇 질량  ', JSON.stringify(stats(results.map((r) => r.topBot))));
console.log('오브 수      ', JSON.stringify(stats(results.map((r) => r.orbs))));
console.log('충돌점 수    ', JSON.stringify(stats(results.map((r) => r.bodyPts))));
console.log(
  'sim 1스텝    ',
  (stepMsTotal / stepCount).toFixed(3),
  'ms  (60fps 예산 16.6ms 중',
  ((stepMsTotal / stepCount / 16.6) * 100).toFixed(1) + '%)',
);
