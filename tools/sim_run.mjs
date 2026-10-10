// sim_run.mjs — 브라우저 없이 «시뮬만» 돌려 성장 곡선을 잰다(창 없음, 렌더 없음).
// 사용: node tools/sim_run.mjs <bundle.mjs> <seedStart> <seedCount> <seconds>
import { pathToFileURL } from 'node:url';

const [, , bundle, seedStart, seedCount, secs] = process.argv;
const { World } = await import(pathToFileURL(bundle).href);

const DT = 1 / 60;
const T = Number(secs || 150);
const N = Number(seedCount || 12);
const S0 = Number(seedStart || 20260818);
const STEPS = Math.round(T / DT);
const SAMPLE = Math.round(5 / DT);

const runs = [];
for (let k = 0; k < N; k++) {
  const seed = S0 + k * 7919;
  const w = new World(seed, 'QA', 'default', true);
  let eatValue = 0, eatCount = 0;
  // 킬 직후 3초 회수량 — President 불만 ①(「죽였는데 왜 성장이 안 돼」)의 직접 지표.
  const recov = [];
  let killAt = -1, killMass = 0;
  w.hooks = {
    onEat: (x, y, c, v) => { eatValue += v; eatCount++; },
    onKill: (e) => { if (e.killerIsPlayer && killAt < 0) { killAt = 0; killMass = w.player.mass; } },
  };
  let peak = 0, deaths = 0, aliveSteps = 0;
  let wasAlive = true;
  const series = [];
  let botPeak = 0;
  for (let i = 0; i < STEPS; i++) {
    w.step(DT);
    const p = w.player;
    if (killAt >= 0) {
      killAt += DT;
      if (killAt >= 3 || !p.alive) {
        if (p.alive) recov.push(p.mass - killMass);
        killAt = -1;
      }
    }
    if (p.alive) { aliveSteps++; if (p.mass > peak) peak = p.mass; }
    if (wasAlive && !p.alive) deaths++;
    wasAlive = p.alive;
    if ((i + 1) % SAMPLE === 0) {
      series.push(Math.round(p.alive ? p.mass : 0));
      for (const s of w.snakes) if (!s.isPlayer && s.alive && s.mass > botPeak) botPeak = s.mass;
    }
  }
  const aliveT = aliveSteps * DT;
  runs.push({ seed, peak: Math.round(peak), final: series[series.length - 1] | 0, deaths,
              eatRate: eatValue / Math.max(1, aliveT),
              orbRate: eatCount / Math.max(1, aliveT), aliveT: +aliveT.toFixed(1),
              recov: recov.map(v => Math.round(v * 10) / 10),
              kills: recov.length,
              botPeak: Math.round(botPeak), series });
}
const med = (a) => { const b = [...a].sort((x, y) => x - y); const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
console.log(JSON.stringify({
  n: N, seconds: T,
  peakMed: med(runs.map(r => r.peak)), peakMean: Math.round(mean(runs.map(r => r.peak))),
  finalMed: med(runs.map(r => r.final)),
  deathsMean: +mean(runs.map(r => r.deaths)).toFixed(2),
  eatRateMed: +med(runs.map(r => r.eatRate)).toFixed(2),
  orbRateMed: +med(runs.map(r => r.orbRate)).toFixed(2),
  recovMed: +med(runs.flatMap(r => r.recov).concat([0])).toFixed(1),
  recovN: runs.reduce((s2, r) => s2 + r.kills, 0),
  killsMean: +mean(runs.map(r => r.kills)).toFixed(2),
  botPeakMed: med(runs.map(r => r.botPeak)),
  peaks: runs.map(r => r.peak),
  runs,
}));
