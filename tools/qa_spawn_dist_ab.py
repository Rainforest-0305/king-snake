# -*- coding: utf-8 -*-
"""qa_spawn_dist_ab.py - 시작 시점 크기 분포 검사기(qa_spawn_dist.mjs)의 «양성대조».

  「0건/PASS 는 부재의 증거가 아니다」 - 검사기가 살아 있는지 먼저 증명한다.
  world.ts 의 sampleSpawnMass 호출을 «교정 전 식»(START_MASS * [1, 3.2))으로
  되돌린 사본을 만들어 같은 검사를 돌린다. 이 사본에서 검사가 «반드시 FAIL» 해야
  본 검사의 PASS 가 의미를 가진다. config 상수는 건드리지 않는다 - 상수를 0 으로
  만들면 상수에서 유도한 문턱도 0 이 되어 검사가 «통과해 버린다»(잘못된 대조군).

  실행: python tools/qa_spawn_dist_ab.py [--seeds N]
  종료코드 0 = 대조군 FAIL 확인(검사기 정상) / 1 = 대조군이 통과함(검사기 고장)
"""
from __future__ import annotations
import os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
ESBUILD = ROOT / "node_modules" / ".bin" / "esbuild.cmd"
TMP = Path(os.environ.get("SIM_TMP", Path(tempfile.gettempdir()) / "coilrush_spawn_ab"))


def bundle(name: str, patch) -> Path:
    d = TMP / name
    if d.exists():
        shutil.rmtree(d)
    (d / "src").mkdir(parents=True)
    shutil.copytree(ROOT / "src" / "game", d / "src" / "game")
    (d / "tools").mkdir()
    shutil.copy(ROOT / "tools" / "sim_entry.ts", d / "tools" / "sim_entry.ts")
    if patch:
        patch(d)
    out = d / "bundle.mjs"
    subprocess.run([str(ESBUILD), str(d / "tools" / "sim_entry.ts"), "--bundle",
                    "--format=esm", "--platform=node", "--log-level=warning",
                    "--outfile=" + str(out)], check=True)
    return out


def patch_all_small(d: Path) -> None:
    w = d / "src" / "game" / "world.ts"
    src = w.read_text(encoding="utf-8")
    new, n = re.subn(r"sampleSpawnMass\(this\.rng\)", "START_MASS * this.rng.range(1, 3.2)", src)
    if n != 1:
        raise SystemExit("patch failed: sampleSpawnMass call not found exactly once (%d)" % n)
    w.write_text(new, encoding="utf-8")


def run_check(b: Path, seeds: int) -> int:
    r = subprocess.run(["node", str(ROOT / "tools" / "qa_spawn_dist.mjs"), str(b),
                        "--seeds", str(seeds), "--check"], capture_output=True, text=True)
    print(r.stdout)
    if r.stderr.strip():
        print(r.stderr)
    return r.returncode


def main() -> int:
    seeds = 12
    a = sys.argv[1:]
    if "--seeds" in a:
        seeds = int(a[a.index("--seeds") + 1])

    print("== CURRENT (must PASS) ==")
    cur = run_check(bundle("current", None), seeds)
    print("== CONTROL: all bots spawn small (must FAIL) ==")
    ctl = run_check(bundle("control_small", patch_all_small), seeds)

    ok = cur == 0 and ctl != 0
    print("\ncurrent exit=%d  control exit=%d  ->  %s" % (cur, ctl, "CHECKER ALIVE" if ok else "CHECKER BROKEN"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
