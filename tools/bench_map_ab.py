# -*- coding: utf-8 -*-
"""bench_map_ab.py — 맵 3.0 + 난도 B 의 «프레임 비용»을 쌍(pair)으로 잰다. headless, 창 0.

  python tools/bench_map_ab.py [--pairs 3] [--sec 40] [--n 30]

★왜 쌍인가: 단발 벤치는 쌍내 편차가 4fps 나 된다(레인 5 실측). 대조군과 처치군을
  «번갈아» 돌려야 머신 부하가 흔들려도 차이가 살아남는다.
★대조군 = MAP_SCALE 2.0 + BOT_COUNT_BASE 28 + SPAWN_MASS_BIG_FRAC 0.11
  (= 이 레인 «직전» 상태). config.ts 를 임시로 되돌려 빌드하고 «반드시» 원복한다.
★ps1 로 먼저 짰다가 파서 오류로 죽었다 — .ps1 은 ASCII 여야 한다(auto-memory
  deploy-discipline). 파이썬은 UTF-8 을 그대로 다루므로 이쪽으로 옮겼다.
"""
from __future__ import annotations

import json
import statistics as st
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
CFG = ROOT / "src" / "game" / "config.ts"
BENCH = ROOT / "_gfx_evidence_260830" / "bench"

CTRL_EDITS = [
    ("export const MAP_SCALE = 3.0;", "export const MAP_SCALE = 2.0;"),
    ("export const BOT_COUNT_BASE = 30;", "export const BOT_COUNT_BASE = 28;"),
    ("export const SPAWN_MASS_BIG_FRAC = 0.14;", "export const SPAWN_MASS_BIG_FRAC = 0.11;"),
]


def sh(cmd: list[str]) -> None:
    subprocess.run(cmd, cwd=str(ROOT), check=True, shell=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main() -> int:
    pairs = int(sys.argv[sys.argv.index("--pairs") + 1]) if "--pairs" in sys.argv else 3
    sec = int(sys.argv[sys.argv.index("--sec") + 1]) if "--sec" in sys.argv else 40
    n = int(sys.argv[sys.argv.index("--n") + 1]) if "--n" in sys.argv else 30

    # ★바이너리로 읽고 쓴다. Path.read_text/write_text 는 «줄바꿈을 번역»한다 —
    #   윈도우에서 LF 파일을 왕복시키면 CRLF 로 바뀌어 «내용은 같은데 바이트가 다른»
    #   파일이 된다. 실제로 그렇게 config.ts 를 오염시켜 check_protected 가 잡았다.
    orig = CFG.read_bytes()
    ctrl_dir = ROOT / "_bench_ctrl"
    try:
        ctrl = orig
        for a, b in CTRL_EDITS:
            ab, bb = a.encode("utf-8"), b.encode("utf-8")
            if ab not in ctrl:
                raise SystemExit("대조군 패치 실패 — 패턴 없음: " + a)
            ctrl = ctrl.replace(ab, bb)
        CFG.write_bytes(ctrl)
        sh(["npm", "run", "build:web"])
        if ctrl_dir.exists():
            subprocess.run(["rm", "-rf", str(ctrl_dir)], check=False)
        subprocess.run(["cp", "-r", str(ROOT / "dist"), str(ctrl_dir)], check=True)
    finally:
        CFG.write_bytes(orig)  # ★무슨 일이 있어도 «바이트 그대로» 원복
    sh(["npm", "run", "build:web"])
    print("config.ts 원복 완료 · 대조군 빌드 완료 — 벤치 시작")

    for i in range(1, pairs + 1):
        sh([sys.executable, "tools/gfx_harness.py", "bench", "_bench_ctrl",
            "CTRLM_p%d" % i, "--cpu", "4", "--n", str(n), "--sec", str(sec)])
        sh([sys.executable, "tools/gfx_harness.py", "bench", "dist",
            "NEWM_p%d" % i, "--cpu", "4", "--n", str(n), "--sec", str(sec)])
        print("pair %d done" % i, flush=True)

    def load(prefix: str):
        out = []
        for f in sorted(BENCH.glob(prefix + "_p*_cpu4_n%d_*.json" % n)):
            d = json.loads(f.read_text(encoding="utf-8"))
            out.append((d["fps"], d["p95"], d["p99"]))
        return out

    c, w = load("CTRLM"), load("NEWM")
    print("CTRL(맵2.0/봇28) fps", [round(x[0], 2) for x in c], "p99", [x[2] for x in c])
    print("NEW (맵3.0/봇30) fps", [round(x[0], 2) for x in w], "p99", [x[2] for x in w])
    if c and w:
        cf, wf = st.median([x[0] for x in c]), st.median([x[0] for x in w])
        print("median fps %.2f -> %.2f (%+.2f, %+.1f%%)" % (cf, wf, wf - cf, (wf - cf) / cf * 100))
        print("median p95 %.1f -> %.1f | median p99 %.1f -> %.1f"
              % (st.median([x[1] for x in c]), st.median([x[1] for x in w]),
                 st.median([x[2] for x in c]), st.median([x[2] for x in w])))
    print("BENCH_DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
