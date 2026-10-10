# -*- coding: utf-8 -*-
"""bench_table.py - _gfx_evidence_260830/bench/*.json 을 표로. python tools/bench_table.py [glob]"""
import glob
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
pat = sys.argv[1] if len(sys.argv) > 1 else "*.json"
rows = []
for f in sorted(glob.glob(str(ROOT / "_gfx_evidence_260830" / "bench" / pat))):
    d = json.loads(Path(f).read_text(encoding="utf-8"))
    rows.append(d)
print("%-34s %4s %3s %5s %5s %6s %6s %6s %6s %6s %5s %6s %6s %5s %6s" % (
    "label", "cpu", "n", "mass", "adapt", "bloom", "fps", "p50", "p95", "p99", "max", "miss%", "spk33", "snk", "orbs"))
for d in rows:
    print("%-34s %4s %3s %5s %5s %6s %6.2f %6.2f %6.2f %6.2f %6.1f %5.2f %6d %5s %6s" % (
        d["label"][:34], d["cpu"], d["n"], d["mass"], "Y" if d["adaptive"] else "-",
        (d["bloomArg"] + ("*" if d.get("bloomOnFrac") not in (None, 0, 1.0) else "")),
        d["fps"], d["p50"], d["p95"], d["p99"], d["max"], d["over17_5_pct"], d["spikes33"],
        d.get("snakesDrawnMean"), d.get("orbsDrawnMean")))
