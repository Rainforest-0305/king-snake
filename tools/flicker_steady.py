# -*- coding: utf-8 -*-
"""flicker_steady.py - flicker/<label>.json 의 에너지열에서 «장면 컷»(데모 사망→카메라 점프: 1프레임 사이 변화 > 60% of 중앙값)
   ±8프레임을 뺀 «정상 구간» 8프레임 max/min 을 다시 센다. python tools/flicker_steady.py <label> [<label> ...]
   결과: 표준출력 + flicker/_summary_steady14.json"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
F = ROOT / "_gfx_evidence_260830" / "flicker"
summary = {}
for lab in sys.argv[1:]:
    d = json.loads((F / f"{lab}.json").read_text(encoding="utf-8"))
    en = [float(x) for x in d["energy"]]
    n = len(en)
    med = sorted(en)[n // 2]
    cuts = [i for i in range(1, n) if abs(en[i] - en[i - 1]) > 0.6 * med]
    bad = set()
    for c in cuts:
        for k in range(c - 8, c + 9):
            bad.add(k)
    ratios = []
    for i in range(0, n - 7):
        if any((i + k) in bad for k in range(8)):
            continue
        w = en[i:i + 8]
        lo, hi = min(w), max(w)
        ratios.append(hi / lo if lo > 0 else float("inf"))
    rs = sorted(ratios)
    r = {
        "sceneCuts": cuts, "windows": len(ratios),
        "ratio8_max": round(rs[-1], 3) if rs else None,
        "ratio8_p95": round(rs[int(len(rs) * 0.95)], 3) if rs else None,
        "over1.5": sum(1 for x in ratios if x > 1.5),
        "blackouts": d.get("blackouts"), "states_seen": d.get("states_seen"), "cpu": d.get("cpu"),
        "raw_ratio8_max": d.get("ratio8_max"),
    }
    summary[lab] = r
    print(lab, json.dumps(r, ensure_ascii=False))
(F / "_summary_steady14.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False), encoding="utf-8")
