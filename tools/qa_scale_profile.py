# -*- coding: utf-8 -*-
"""qa_scale_profile.py — 거대 비늘 뱀 상황의 «전체» 렌더/시뮬 프로파일 덤프.

  python tools/qa_scale_profile.py <distDir> <tag> [--cpu 4] [--mass 5200] [--n 3]

★ 「비늘이 느리다」를 «가정하지 않는다». 층별 ms 를 전부 찍고 어디가 먹는지 본다.
  bg / orbs / bodies / heads / labels / vignette / mini / post / total / sim
  + 드로우콜 내역(draws) + 블룸 상태 + renderScale + 화면에 그린 뱀 수.
★ 헤드리스 전용.
"""
from __future__ import annotations

import argparse
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_render_260908"
VW, VH = 390, 844
SAVE = {"v": 1, "savedAt": 0, "bestScore": 6000, "bestRank": 1, "games": 40,
        "totalKills": 30, "playSeconds": 5000, "nick": "", "skin": "corn",
        "control": "joystick", "sound": False, "locale": None}


def serve(d: Path):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(d), **k)

        def log_message(self, *a):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s.server_address[1], s


def med(v):
    v = sorted(v)
    return v[len(v) // 2] if v else -1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dist")
    ap.add_argument("tag")
    ap.add_argument("--cpu", type=int, default=4)
    ap.add_argument("--mass", type=int, default=5200)
    ap.add_argument("--n", type=int, default=3)
    ap.add_argument("--layers", default="")
    ap.add_argument("--samples", type=int, default=40)
    # ★ 모바일 근사: dsf 를 올리면 «채울 픽셀»이 제곱으로 는다(2→3 이면 2.25배).
    #   완벽한 모사는 아니지만 「fill-rate 에 민감한가」는 이 축으로 갈린다.
    ap.add_argument("--dsf", type=float, default=2)
    a = ap.parse_args()

    dist = Path(a.dist).resolve()
    port, srv = serve(dist)
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(headless=True)
            ctx = b.new_context(viewport={"width": VW, "height": VH},
                                device_scale_factor=a.dsf, is_mobile=True,
                                has_touch=True, locale="ko-KR")
            ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                                % json.dumps(json.dumps(SAVE, ensure_ascii=False)))
            page = ctx.new_page()
            page.goto("http://127.0.0.1:%d/?debug=1&quiet=1&seed=7%s"
                      % (port, ("&layers=" + a.layers) if a.layers else ""),
                      wait_until="load")
            page.wait_for_timeout(900)
            cdp = ctx.new_cdp_session(page)
            page.evaluate("() => window.__coil.startRun()")
            page.wait_for_timeout(700)
            page.evaluate("() => window.__coil.ghost(9000)")
            page.evaluate("([n,m]) => window.__coil.stress(n, m, false, m, 'grid')",
                          [a.n, a.mass])
            page.wait_for_timeout(900)
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": a.cpu})
            page.wait_for_timeout(500)
            cdp.send("Input.dispatchTouchEvent", {"type": "touchStart",
                     "touchPoints": [{"x": 195.0, "y": 520.0, "id": 0}]})
            keys = ["bg", "orbs", "bodies", "heads", "labels", "vignette",
                    "mini", "post", "total", "sim"]
            acc = {k: [] for k in keys}
            last = None
            for i in range(a.samples):
                cdp.send("Input.dispatchTouchEvent", {"type": "touchMove",
                         "touchPoints": [{"x": 195.0 + (i % 7) * 10,
                                          "y": 520.0 - (i % 5) * 9, "id": 0}]})
                page.wait_for_timeout(70)
                t = page.evaluate("() => window.__coilTimes()")
                for k in keys:
                    if isinstance(t.get(k), (int, float)):
                        acc[k].append(t[k])
                last = t
            cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
            frame = page.evaluate("() => window.__coil.frame()")
            ctx.close()
            b.close()
    finally:
        srv.shutdown()

    prof = {k: round(med(v), 3) for k, v in acc.items() if v}
    big = [s for s in frame["snakes"] if s["mass"] >= 1000]
    out = {
        "tag": a.tag, "cpu": a.cpu, "mass": a.mass, "n": a.n,
        "profile_median_ms": prof,
        "draws": last.get("draws"),
        "bloom": last.get("bloom"), "bloomQuality": last.get("bloomQuality"),
        "tier": last.get("tier"), "renderScale": last.get("scale"),
        "snakesDrawn": last.get("snakesN"), "orbsDrawn": last.get("orbsN"),
        "canvas": [last.get("canvasW"), last.get("canvasH")],
        "stage": [last.get("stageW"), last.get("stageH")],
        "worldDpr": last.get("worldDpr"), "stageDpr": last.get("stageDpr"),
        "zoom": frame.get("zoom"), "fps": frame.get("fps"),
        "drawnIds": len(frame.get("drawn", [])), "culledIds": len(frame.get("culled", [])),
        "bigSnakesOnScreen": len(big),
        "bigMasses": sorted([round(s["mass"]) for s in big], reverse=True)[:6],
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / ("profile_%s.json" % a.tag)).write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    print("== 전체 프로파일 [%s] cpu=%dx mass=%d n=%d layers=%s"
          % (a.tag, a.cpu, a.mass, a.n, a.layers or "all"))
    tot = prof.get("total", 0)
    for k in ["sim", "bg", "orbs", "bodies", "heads", "labels", "vignette",
              "mini", "post", "total"]:
        if k in prof:
            share = (prof[k] / tot * 100) if (tot and k != "total") else 0
            print("   %-9s %7.3f ms %s" % (k, prof[k], ("(%4.1f%%)" % share) if share else ""))
    print("   ─ 그린 뱀 %s / 컬링 %s / 거대뱀(≥1000) %s %s"
          % (out["drawnIds"], out["culledIds"], out["bigSnakesOnScreen"], out["bigMasses"]))
    print("   ─ zoom %.3f  renderScale %s  tier %s  bloom %s(%s)  world %s stage %s"
          % (out["zoom"], out["renderScale"], out["tier"], out["bloom"],
             out["bloomQuality"], out["canvas"], out["stage"]))
    d = out["draws"] or {}
    print("   ─ draws:", json.dumps({k: v for k, v in d.items() if v}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
