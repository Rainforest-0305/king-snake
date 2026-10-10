# -*- coding: utf-8 -*-
"""qa_scale_perf.py — 「비늘이 프레임을 얼마나 먹나」를 «렌더 층 ms» 로 잰다.

  python tools/qa_scale_perf.py <distDir> <tag> [--cpu 4]

★ 왜 rAF 델타를 안 쓰나 (2026-09-08 실측으로 버린 방법):
  4배 스로틀에서 rAF 간격은 116.7 / 133.3 / 150.0 처럼 «16.67ms 의 배수»로만
  나온다 — vsync 에 양자화돼서 «실제 일한 시간»이 아니라 «빠뜨린 vsync 수»를
  세게 된다. 그 숫자로는 17ms 짜리 개선도 안 보이고 노이즈도 못 가른다.
  ⇒ 게임이 이미 노출하는 renderer.times(?debug=1 에서 켜짐)를 읽는다.
    bodies = 몸통 스트로크 전부(비늘 포함)의 ms 다.

★ 조건 3종을 «같은 씨앗·같은 시각»에 잰다:
    small  작은 뱀만
    giant1 거대 비늘 뱀 1마리 화면 안
    giant3 거대 비늘 뱀 3마리 화면 안
★ 헤드리스 전용.
"""
from __future__ import annotations

import argparse
import http.server
import json
import socketserver
import statistics
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

CONDS = [
    ("small", 0, 0, 40),
    ("giant1", 1, 5200, 5200),
    ("giant3", 3, 5200, 5200),
]


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


def pct(v, q):
    if not v:
        return -1.0
    v = sorted(v)
    return v[min(len(v) - 1, max(0, int(round((len(v) - 1) * q))))]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dist")
    ap.add_argument("tag")
    ap.add_argument("--cpu", type=int, default=4)
    ap.add_argument("--layers", default="")
    ap.add_argument("--samples", type=int, default=40)
    a = ap.parse_args()

    dist = Path(a.dist).resolve()
    port, srv = serve(dist)
    res = {"tag": a.tag, "cpu": a.cpu, "layers": a.layers, "conds": {}}
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(headless=True)
            ctx = b.new_context(viewport={"width": VW, "height": VH},
                                device_scale_factor=2, is_mobile=True,
                                has_touch=True, locale="ko-KR")
            ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                                % json.dumps(json.dumps(SAVE, ensure_ascii=False)))
            page = ctx.new_page()
            page.goto("http://127.0.0.1:%d/?debug=1&quiet=1&seed=7%s"
                      % (port, ("&layers=" + a.layers) if a.layers else ""),
                      wait_until="load")
            page.wait_for_timeout(900)
            cdp = ctx.new_cdp_session(page)

            for name, n, mass, pmass in CONDS:
                page.evaluate("() => window.__coil.toMenu()")
                page.wait_for_timeout(300)
                page.evaluate("() => window.__coil.startRun()")
                page.wait_for_timeout(700)
                page.evaluate("() => window.__coil.ghost(9000)")
                if n > 0:
                    page.evaluate("([n,m,p]) => window.__coil.stress(n, m, false, p, 'grid')",
                                  [n, mass, pmass])
                else:
                    page.evaluate("(p) => window.__coil.grow(p)", pmass)
                page.wait_for_timeout(700)
                cdp.send("Emulation.setCPUThrottlingRate", {"rate": a.cpu})
                page.wait_for_timeout(500)
                # 조종해서 «카메라가 스크롤»되는 상태로 잰다(정지 화면은 비용이 다르다)
                cdp.send("Input.dispatchTouchEvent", {"type": "touchStart",
                         "touchPoints": [{"x": 195.0, "y": 520.0, "id": 0}]})
                bodies, total, heads = [], [], []
                for i in range(a.samples):
                    cdp.send("Input.dispatchTouchEvent", {"type": "touchMove",
                             "touchPoints": [{"x": 195.0 + (i % 7) * 10,
                                              "y": 520.0 - (i % 5) * 9, "id": 0}]})
                    page.wait_for_timeout(70)
                    t = page.evaluate("() => window.__coilTimes()")
                    bodies.append(t["bodies"])
                    heads.append(t["heads"])
                    total.append(t["total"])
                cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
                info = page.evaluate("""() => {
                  const t = window.__coilTimes();
                  const f = window.__coil.frame();
                  const me = f.snakes.find(x => x.mine) || f.snakes[0];
                  return { snakesN: t.snakesN, zoom: f.zoom, mass: me ? me.mass : 0,
                           bodyStrokes: t.draws.bodyStrokes, scale: t.scale };
                }""")
                cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
                res["conds"][name] = {
                    "bodies_p50": round(pct(bodies, .5), 2),
                    "bodies_p95": round(pct(bodies, .95), 2),
                    "bodies_p99": round(pct(bodies, .99), 2),
                    "heads_p50": round(pct(heads, .5), 2),
                    "total_p50": round(pct(total, .5), 2),
                    "total_p95": round(pct(total, .95), 2),
                    "total_p99": round(pct(total, .99), 2),
                    "mean_bodies": round(statistics.mean(bodies), 2),
                    "info": info,
                }
            ctx.close()
            b.close()
    finally:
        srv.shutdown()

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / ("perf_%s.json" % a.tag)).write_text(
        json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")

    print("== 렌더 층 ms [%s]  cpu=%dx  layers=%s  (dpr2 / 390x844)"
          % (a.tag, a.cpu, a.layers or "all"))
    print("  %-8s %9s %9s %9s | %9s %9s %9s | %6s %7s"
          % ("cond", "bodies50", "bodies95", "bodies99",
             "total50", "total95", "total99", "뱀수", "strokes"))
    for name, _, _, _ in CONDS:
        c = res["conds"][name]
        print("  %-8s %9.2f %9.2f %9.2f | %9.2f %9.2f %9.2f | %6s %7s"
              % (name, c["bodies_p50"], c["bodies_p95"], c["bodies_p99"],
                 c["total_p50"], c["total_p95"], c["total_p99"],
                 c["info"]["snakesN"], c["info"]["bodyStrokes"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
