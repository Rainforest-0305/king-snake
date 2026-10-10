# -*- coding: utf-8 -*-
"""hud_table.py - shots_hud.py 가 남긴 좌표 json 을 전/후 «표»로 편다.

  python tools/hud_table.py            # before vs after

★ 판정 문장을 여기에 «박지 않는다» — 숫자를 내놓고, 겹침/순서/크기는 계산한다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / "_hud_evidence_260902"


def load(tag):
    return json.loads((BASE / f"rects_{tag}.json").read_text(encoding="utf-8"))


def fmt(r):
    if not r:
        return "        -        "
    return f"{r['x']:6.1f},{r['y']:6.1f} {r['w']:5.1f}x{r['h']:5.1f}"


def main():
    a, b = load("before"), load("after")
    keys = list(b.keys())
    print("=" * 118)
    print(f"{'case':26s} | {'BEFORE  x,y  wxh':^26s} | {'AFTER   x,y  wxh':^26s} | feedBottom -> offerTop")
    print("=" * 118)
    for k in keys:
        ra = a.get(k, {})
        rb = b.get(k, {})
        oa = (ra.get("rects") or {}).get(".rw-offer")
        ob = (rb.get("rects") or {}).get(".rw-offer")
        fa = (ra.get("rects") or {}).get(".hud-feed")
        fb = (rb.get("rects") or {}).get(".hud-feed")
        gap_a = f"{fa['bottom']:.0f}->{oa['y']:.0f}" if (fa and oa) else "-"
        gap_b = f"{fb['bottom']:.0f}->{ob['y']:.0f}" if (fb and ob) else "-"
        print(f"{k:26s} | {fmt(oa)} | {fmt(ob)} | before {gap_a:>12s}   after {gap_b:>12s}")
    print()

    print("── 겹침(배너 vs HUD) ─────────────────────────────────────────────")
    bad = 0
    for k in keys:
        for tag, src in (("before", a), ("after", b)):
            ov = (src.get(k) or {}).get("overlap") or {}
            hits = {s: v for s, v in ov.items() if v != 0}
            if hits:
                print(f"  {tag:6s} {k:26s} {json.dumps(hits, ensure_ascii=False)}")
                if tag == "after":
                    bad += 1
    print(f"  after 겹침 건수 = {bad}")
    print()

    print("── 배너 크기·탭영역·화면점유 ─────────────────────────────────────")
    print(f"{'case':26s} | {'before wxh':>12s} {'area':>7s} | {'after wxh':>12s} {'area':>7s} | 면적비  하단/화면")
    for k in keys:
        oa = ((a.get(k) or {}).get("rects") or {}).get(".rw-offer")
        ob = ((b.get(k) or {}).get("rects") or {}).get(".rw-offer")
        if not oa or not ob:
            continue
        aa, ab = oa["w"] * oa["h"], ob["w"] * ob["h"]
        vh = (b.get(k) or {}).get("vh", 1)
        print(f"{k:26s} | {oa['w']:5.1f}x{oa['h']:5.1f} {aa:7.0f} | "
              f"{ob['w']:5.1f}x{ob['h']:5.1f} {ab:7.0f} | {ab/aa*100:5.1f}%  "
              f"{ob['bottom']/vh*100:5.1f}%")
    print()

    print("── 킬로그가 «밀렸는가»(배너 있음 C vs 없음 D, after) ─────────────")
    for k in keys:
        if not k.endswith("|C_feed3"):
            continue
        d = k.replace("|C_feed3", "|D_feedonly")
        fc = ((b.get(k) or {}).get("rects") or {}).get(".hud-feed")
        fd = ((b.get(d) or {}).get("rects") or {}).get(".hud-feed")
        if not fc or not fd:
            continue
        same = (abs(fc["x"] - fd["x"]) < 0.5 and abs(fc["y"] - fd["y"]) < 0.5
                and abs(fc["w"] - fd["w"]) < 0.5 and abs(fc["h"] - fd["h"]) < 0.5)
        print(f"  {k.split('|')[0]:14s} 배너있음 {fmt(fc)} / 배너없음 {fmt(fd)}  -> "
              f"{'동일' if same else '★달라졌다'}")
    print()

    print("── 킬 피드 마크업 전/후 동일한가(대체 경로 검증) ─────────────────")
    for k in keys:
        if not k.endswith("|C_feed3"):
            continue
        ha = (a.get(k) or {}).get("feedHtml")
        hb = (b.get(k) or {}).get("feedHtml")
        print(f"  {k.split('|')[0]:14s} {'같다' if ha == hb else '★다르다'}"
              f"  (len {len(ha or '')} / {len(hb or '')})")
    print()

    print("── 터치 소유권(after) ─────────────────────────────────────────────")
    for k in keys:
        h = (b.get(k) or {}).get("hit")
        if not h:
            continue
        print(f"  {k:26s} onBanner={h['onBanner'][:22]:22s} center={h['center'][:14]:14s} "
              f"lower={h['lower'][:14]:14s} below={h['justBelow'][:14]:14s} "
              f"right={h['rightOfBanner'][:14]}")


if __name__ == "__main__":
    main()
