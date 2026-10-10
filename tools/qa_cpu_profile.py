# -*- coding: utf-8 -*-
"""qa_cpu_profile.py — 거대 뱀 상황의 «상위 함수»를 CDP CPU 프로파일러로 뜬다.

  python tools/qa_cpu_profile.py <distDir> <tag> [--cpu 4] [--mass 5200] [--n 4] [--sec 6]

★ 왜 필요한가: 층별 ms(renderer.times)는 «어디»까지만 알려 준다. sim 10.9ms 가
  무엇 때문인지는 함수 단위로 봐야 한다. 추측으로 최적화하지 않기 위한 도구다.
★ self time 상위 25개 + 파일별 합계를 낸다. 번들이 minify 돼 있으면 이름이
  뭉개지므로 «소스맵 없는 이름»도 그대로 적는다(정직하게).
★ 헤드리스 전용.
"""
from __future__ import annotations

import argparse
import collections
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_perf_260908"
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dist")
    ap.add_argument("tag")
    ap.add_argument("--cpu", type=int, default=4)
    ap.add_argument("--mass", type=int, default=5200)
    ap.add_argument("--n", type=int, default=4)
    ap.add_argument("--sec", type=float, default=6)
    a = ap.parse_args()

    port, srv = serve(Path(a.dist).resolve())
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(headless=True)
            ctx = b.new_context(viewport={"width": VW, "height": VH},
                                device_scale_factor=2, is_mobile=True,
                                has_touch=True, locale="ko-KR")
            ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                                % json.dumps(json.dumps(SAVE, ensure_ascii=False)))
            page = ctx.new_page()
            page.goto("http://127.0.0.1:%d/?debug=1&quiet=1&seed=7" % port,
                      wait_until="load")
            page.wait_for_timeout(900)
            cdp = ctx.new_cdp_session(page)
            page.evaluate("() => window.__coil.startRun()")
            page.wait_for_timeout(700)
            page.evaluate("() => window.__coil.ghost(9000)")
            page.evaluate("([n,m]) => window.__coil.stress(n, m, false, m, 'grid')",
                          [a.n, a.mass])
            page.wait_for_timeout(800)
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": a.cpu})
            cdp.send("Profiler.enable")
            cdp.send("Profiler.setSamplingInterval", {"interval": 200})
            cdp.send("Profiler.start")
            cdp.send("Input.dispatchTouchEvent", {"type": "touchStart",
                     "touchPoints": [{"x": 195.0, "y": 520.0, "id": 0}]})
            steps = int(a.sec * 1000 / 80)
            for i in range(steps):
                cdp.send("Input.dispatchTouchEvent", {"type": "touchMove",
                         "touchPoints": [{"x": 195.0 + (i % 7) * 10,
                                          "y": 520.0 - (i % 5) * 9, "id": 0}]})
                page.wait_for_timeout(80)
            cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
            prof = cdp.send("Profiler.stop")["profile"]
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
            ctx.close()
            b.close()
    finally:
        srv.shutdown()

    nodes = {n["id"]: n for n in prof["nodes"]}
    # self time = 샘플 수 x 평균 간격
    cnt = collections.Counter(prof.get("samples", []))
    total_us = prof["endTime"] - prof["startTime"]
    total_samples = sum(cnt.values()) or 1
    per = total_us / total_samples / 1000.0  # ms per sample

    rows = []
    byfile = collections.Counter()
    for nid, c in cnt.items():
        n = nodes.get(nid)
        if not n:
            continue
        cf = n["callFrame"]
        name = cf.get("functionName") or "(anonymous)"
        url = (cf.get("url") or "").rsplit("/", 1)[-1] or "(native)"
        ms = c * per
        rows.append((ms, name, url, cf.get("lineNumber", -1)))
        byfile[url] += ms
    rows.sort(reverse=True)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / ("cpuprof_%s.json" % a.tag)).write_text(
        json.dumps({"top": [{"ms": round(m, 1), "fn": f, "file": u, "line": l}
                            for m, f, u, l in rows[:40]],
                    "byfile": {k: round(v, 1) for k, v in byfile.most_common()},
                    "total_ms": round(total_us / 1000, 1)},
                   ensure_ascii=False, indent=1), encoding="utf-8")

    print("== CPU 프로파일 [%s] cpu=%dx mass=%d n=%d  창 %.1fs (샘플 %d)"
          % (a.tag, a.cpu, a.mass, a.n, total_us / 1e6, total_samples))
    print("  파일별 self ms:", ", ".join("%s %.0f" % (k, v)
                                          for k, v in byfile.most_common(6)))
    print("  %-8s %-34s %s" % ("self ms", "함수", "파일:줄"))
    for m, f, u, l in rows[:20]:
        print("  %8.1f %-34s %s:%s" % (m, f[:34], u, l))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
