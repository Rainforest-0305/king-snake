# -*- coding: utf-8 -*-
"""compare_table.py - 라이브(F_live) vs 신규(H_new) 프레임타임 전/후 표 + 거버너 전환 로그 표.
   python tools/compare_table.py            → 마크다운 표 2개 출력
"""
import glob
import json
import sys
from pathlib import Path

for _s in (sys.stdout,):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent.parent
B = ROOT / "_gfx_evidence_260830" / "bench"


def load(pat):
    out = {}
    for f in sorted(glob.glob(str(B / pat))):
        d = json.loads(Path(f).read_text(encoding="utf-8"))
        out[(d["cpu"], d["n"])] = d
    return out


live = load("F_live_cpu*_n*_m*_bloomwatch.json")
new = load("J_new_cpu*_n*_m*_bloomwatch.json")
old = load("F_new_cpu*_n*_m*_bloomwatch.json")  # 1판(거버너·iOS 전)

print("## 프레임타임 전/후 (390x844 @DPR3 헤드리스 Chromium, 해상도 고정, 60초 rAF 전수, ms)")
print("| CPU | 뱀 | 라이브 -12 fps / p50 / p95 / p99 / miss% | 1판(F_new) p99 | **신규(H_new) fps / p50 / p95 / p99 / miss%** | p99 Δ | 그린 뱀·먹이(신규) |")
print("|---|---|---|---|---|---|---|")
for key in sorted(set(live) | set(new)):
    a = live.get(key)
    b = new.get(key)
    o = old.get(key)
    if not a or not b:
        continue
    d = (b["p99"] - a["p99"]) / a["p99"] * 100 if a["p99"] else 0
    print("| %dx | %d | %.1f / %.1f / %.1f / %.1f / %.1f%% | %s | **%.1f / %.1f / %.1f / %.1f / %.1f%%** | **%+.0f%%** | %s·%s |" % (
        key[0], key[1], a["fps"], a["p50"], a["p95"], a["p99"], a["over17_5_pct"],
        ("%.1f" % o["p99"]) if o else "-",
        b["fps"], b["p50"], b["p95"], b["p99"], b["over17_5_pct"], d,
        b.get("snakesDrawnMean"), b.get("orbsDrawnMean")))

print()
print("## 거버너 전환 로그 (adaptive = 해상도 컨트롤러 «켠» 상태, 60초)")
print("| 런 | CPU | 뱀 | fps | p99 | 단계 전환 | 5초 안 전환 쌍 | 플레이 중 캔버스 크기 변경 | 본 캔버스 크기 | 최종 T | 승격 |")
print("|---|---|---|---|---|---|---|---|---|---|---|")
for f in sorted(glob.glob(str(B / "G2_new_*.json"))):
    d = json.loads(Path(f).read_text(encoding="utf-8"))
    print("| %s | %dx | %d | %.1f | %.1f | %d | **%d** | **%d** | %s | T%s | %s |" % (
        Path(f).stem, d["cpu"], d["n"], d["fps"], d["p99"], d.get("tierTransitions", -1), d.get("pairsWithin5s", -1),
        d.get("scaleChangesInPlay", -1), d.get("canvasSizesSeen"), d.get("tier"), d.get("promotions")))
    for e in d.get("qlog") or []:
        print("|  | | | | | t=%.1fs T%s→T%s %s | | | | | |" % (e["t"], e["from"], e["to"], e["why"]))
