# -*- coding: utf-8 -*-
"""gfx_stage_times.py - 렌더 단계별 JS 시간(ms, EMA)을 몇 초 동안 표본해 평균을 낸다. headless.
  python tools/gfx_stage_times.py <distdir> [--sec 8] [--stress N,MASS] [--query "&bloom=off"]
"""
import argparse
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

GPU_ARGS = ["--use-gl=angle", "--use-angle=d3d11", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"]


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dist")
    ap.add_argument("--sec", type=int, default=8)
    ap.add_argument("--stress", default="")
    ap.add_argument("--query", default="")
    ap.add_argument("--cpu", type=int, default=1)
    a = ap.parse_args()
    port, srv = serve(Path(a.dist).resolve())
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True, args=GPU_ARGS)
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        cdp = ctx.new_cdp_session(page)
        page.goto(f"http://127.0.0.1:{port}/?demo=1&debug=1&quiet=1&ads=off&seed=4242&fixscale=0{a.query}", wait_until="load")
        page.wait_for_timeout(2000)
        if a.cpu > 1:
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": a.cpu})
        if a.stress:
            n, m = [int(x) for x in a.stress.split(",")]
            page.evaluate("(x) => { window.__coil.stress(x[0], x[1], true, 600); window.__st = setInterval(() => window.__coil.stress(x[0], x[1], true, 600), 2500); }", [n, m])
        page.wait_for_timeout(1500)
        acc = {}
        k = 0
        for _ in range(a.sec * 2):
            page.wait_for_timeout(500)
            t = page.evaluate("() => window.__coilTimes()")
            for key in ("bg", "orbs", "bodies", "heads", "labels", "vignette", "mini", "post", "total", "sim"):
                if isinstance(t.get(key), (int, float)):
                    acc[key] = acc.get(key, 0) + t[key]
            k += 1
        fps = page.evaluate("() => window.__coil.state().fps")
        print(json.dumps({key: round(v / k, 3) for key, v in acc.items()}), "fps", round(fps, 1), "bloom", t.get("bloom"),
              "orbsN", t.get("orbsN", t.get("orbs")), "snakesN", t.get("snakesN", t.get("snakes")))
        ctx.close()
        b.close()
    srv.shutdown()


if __name__ == "__main__":
    sys.exit(main())
