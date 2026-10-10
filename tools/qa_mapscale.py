# -*- coding: utf-8 -*-
"""qa_mapscale.py - MAP_SCALE 후보를 «시뮬만» 돌려 비교한다(브라우저·창 없음).

  config.ts 의 MAP_SCALE 만 바꾼 사본을 OS 임시 폴더에 만들어 esbuild 로 번들하고,
  후보마다 아래를 잰다:
    · 맵 수치(반지름·봇 수·먹이 수·밀도)
    · qa_early.mjs   : 3초 거대 봇 가로지름 · 초반 사망(30/60s) · 150초 평균 사망
    · qa_spawn_dist  : 스폰 안전거리(플레이어 머리→가장 가까운 남의 몸)
    · 시뮬 1스텝 비용(ms, 60초 평균 - 렌더 제외 순수 게임 규칙 비용)

  python tools/qa_mapscale.py [1.0,1.5,2.0] [--seeds N]
산출물: qa/lane12/mapscale.json
"""
from __future__ import annotations
import json, math, os, re, shutil, subprocess, sys, tempfile, time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
ESBUILD = ROOT / "node_modules" / ".bin" / "esbuild.cmd"
TMP = Path(os.environ.get("SIM_TMP", Path(tempfile.gettempdir()) / "coilrush_mapscale"))

STEP_BENCH = """
import { pathToFileURL } from 'node:url';
const { World } = await import(pathToFileURL(process.argv[2]).href);
const DT = 1/60; const out = [];
for (let k = 0; k < 6; k++) {
  const w = new World(20260818 + k * 7919, 'QA', 'default', true);
  const n = Math.round(60 / DT);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) w.step(DT);
  out.push(Number(process.hrtime.bigint() - t0) / 1e6 / n);
}
out.sort((a,b)=>a-b);
console.log(JSON.stringify({ stepMsMed: +out[3].toFixed(4), stepMsMax: +out[5].toFixed(4) }));
"""


def bundle(scale: float) -> Path:
    d = TMP / ("s%s" % str(scale).replace(".", "_"))
    if d.exists():
        shutil.rmtree(d)
    (d / "src").mkdir(parents=True)
    shutil.copytree(ROOT / "src" / "game", d / "src" / "game")
    (d / "tools").mkdir()
    shutil.copy(ROOT / "tools" / "sim_entry.ts", d / "tools" / "sim_entry.ts")
    cfg = d / "src" / "game" / "config.ts"
    src = cfg.read_text(encoding="utf-8")
    new, n = re.subn(r"(export const MAP_SCALE\s*=\s*)[-0-9.eE]+", r"\g<1>%s" % scale, src)
    if n != 1:
        raise SystemExit("MAP_SCALE not found exactly once (%d)" % n)
    cfg.write_text(new, encoding="utf-8")
    out = d / "bundle.mjs"
    subprocess.run([str(ESBUILD), str(d / "tools" / "sim_entry.ts"), "--bundle", "--format=esm",
                    "--platform=node", "--log-level=warning", "--outfile=" + str(out)], check=True)
    (d / "stepbench.mjs").write_text(STEP_BENCH, encoding="utf-8")
    return out


def main() -> int:
    scales = [1.0, 1.5, 2.0]
    seeds = 24
    a = sys.argv[1:]
    if a and not a[0].startswith("--"):
        scales = [float(x) for x in a[0].split(",")]
    if "--seeds" in a:
        seeds = int(a[a.index("--seeds") + 1])
    res = {}
    for sc in scales:
        b = bundle(sc)
        print("== MAP_SCALE %s ==" % sc, flush=True)
        r = subprocess.run(["node", str(ROOT / "tools" / "qa_early.mjs"), str(b), "--seeds", str(seeds)],
                           capture_output=True, text=True, check=True)
        early = json.loads(r.stdout.strip().splitlines()[-1])
        r2 = subprocess.run(["node", str(ROOT / "tools" / "qa_spawn_dist.mjs"), str(b), "--seeds", str(seeds),
                             "--json", str(b.parent / "dist.json")], capture_output=True, text=True)
        dist = json.loads((b.parent / "dist.json").read_text(encoding="utf-8"))
        r3 = subprocess.run(["node", str(b.parent / "stepbench.mjs"), str(b)], capture_output=True, text=True, check=True)
        step = json.loads(r3.stdout.strip())
        R = early["worldR"]
        area = math.pi * R * R
        row = {
            "worldR": R, "bots": early["botCount"], "food": early["foodTarget"],
            "areaMu": round(area / 1e6, 2),
            "botPerMu": round(early["botCount"] / (area / 1e6), 3),
            "foodPerMu": round(early["foodTarget"] / (area / 1e6), 1),
            "cross3s": early["cross3s"], "earlyDeath": early["earlyDeath"],
            "spawnSafety": {k: round(v, 1) for k, v in dist["spawnSafety"]["all"].items()},
            "nearestIsBig": dist["spawnSafety"]["bigCases"],
            "t0botMass": {k: round(v, 1) for k, v in dist["marks"]["t0"]["bot"].items()},
            "trailPtsMed": round(dist["marks"]["t60"]["trailPtsPerWorld"]["med"]),
            "step": step,
        }
        res[str(sc)] = row
        print(json.dumps(row), flush=True)
    (ROOT / "qa" / "lane12").mkdir(parents=True, exist_ok=True)
    (ROOT / "qa" / "lane12" / "mapscale.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    print("\n%-6s %6s %5s %6s %8s %9s | %-22s | %-28s | %-14s | %s" % (
        "scale", "R", "bots", "food", "bot/Mu", "food/Mu", "cross3s(seeds,medDist)", "death(<=30s,<=60s,mean150)", "spawnSafe(min)", "stepMs"))
    for k, v in res.items():
        print("%-6s %6d %5d %6d %8.3f %9.1f | %2d/%d  med %5d      | %2d / %2d / %.2f            | %6.0f      | %.3f" % (
            k, v["worldR"], v["bots"], v["food"], v["botPerMu"], v["foodPerMu"],
            v["cross3s"]["seeds"], seeds, v["cross3s"]["minDistMed"],
            v["earlyDeath"]["firstDeathLe30s"], v["earlyDeath"]["firstDeathLe60s"], v["earlyDeath"]["deathsMean150s"],
            v["spawnSafety"]["min"], v["step"]["stepMsMed"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
