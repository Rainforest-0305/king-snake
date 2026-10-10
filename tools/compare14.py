# -*- coding: utf-8 -*-
"""compare14.py - 프레임타임 -12(F_live) / -13(J_new, H_new) / -14(L14) 4x 표 + 드로우 콜(30마리 화면) 표.
   python tools/compare14.py [L14] [shots_label_13] [shots_label_14]
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
S = ROOT / "_gfx_evidence_260830" / "shots"
lab14 = sys.argv[1] if len(sys.argv) > 1 else "L14"
sh13 = sys.argv[2] if len(sys.argv) > 2 else "final_ios"
sh14 = sys.argv[3] if len(sys.argv) > 3 else "final14"


def load(pat):
    out = {}
    for f in sorted(glob.glob(str(B / pat))):
        d = json.loads(Path(f).read_text(encoding="utf-8"))
        out[(d["cpu"], d["n"])] = d
    return out


live = load("F_live_cpu*_n*_m*_bloomwatch.json")
h13 = load("H_new_cpu*_n*_m*_bloomwatch.json")
j13 = load("J_new_cpu*_n*_m*_bloomwatch.json")
new = load(lab14 + "_cpu*_n*_m*_bloomwatch.json")

BUDGET = {(4, 10): 33.4, (4, 30): 50.1, (4, 56): 66.7}


def fmt(d):
    return "%.1f / %.1f / %.1f / %.1f / %.1f%%" % (d["fps"], d["p50"], d["p95"], d["p99"], d["over17_5_pct"]) if d else "-"


print("## 프레임타임 -12 / -13 / -14 (390x844 @DPR3 헤드리스 Chromium, CPU 4x, 해상도 고정, 60초 rAF 전수, ms)")
print("| CPU | 뱀 | -12 라이브 fps / p50 / p95 / p99 / miss%% | -13 (H_new 야간 / J_new 최종빌드) p99 | **-14 (%s) fps / p50 / p95 / p99 / miss%%** | p99 합격선 | 판정 |" % lab14)
print("|---|---|---|---|---|---|---|")
for key in sorted(new):
    a = live.get(key)
    b = new[key]
    bud = BUDGET.get(key)
    ok = "PASS" if bud is not None and b["p99"] <= bud + 0.05 else ("FAIL" if bud is not None else "-")
    print("| %dx | %d | %s | %s / %s | **%s** | %s | **%s** |" % (
        key[0], key[1], fmt(a),
        ("%.1f" % h13[key]["p99"]) if key in h13 else "-",
        ("%.1f" % j13[key]["p99"]) if key in j13 else "-",
        fmt(b), ("≤ %.1f" % bud) if bud else "-", ok))

print()
print("## 드로우 콜 (뱀 30마리 화면, 390x844, `__coilTimes().draws`)")
print("| 빌드 | 몸통 스트로크 | 꼬리 fill | 머리 풀 / LOD | 먹이 drawImage | 블룸 소스 fill | 이름표 text | 폰트 set | 합계 |")
print("|---|---|---|---|---|---|---|---|---|")
for name, lab in (("-13", sh13), ("-14", sh14)):
    f = S / lab / "390x844_state.json"
    if not f.exists():
        print("| %s | (없음: %s) | | | | | | | |" % (name, f))
        continue
    d = json.loads(f.read_text(encoding="utf-8")).get("play30") or {}
    dr = d.get("draws") or {}
    print("| %s (%s) | %s | %s | %s / %s | %s | %s | %s | %s | **%s** |" % (
        name, lab, dr.get("bodyStrokes"), dr.get("taperFills"), dr.get("heads"), dr.get("headsLod"),
        dr.get("orbImages"), dr.get("srcFills"), dr.get("labelTexts"), dr.get("fontSets"), dr.get("total")))
