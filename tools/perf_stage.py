"""perf_stage.py - «어디가» 느린지 단계별로 잰다(renderer.times).

perf.py 는 fps 만 준다. fps 가 떨어졌을 때 「어느 층이 비싸졌나」를 모르면
되돌리기가 추측이 된다. renderer.profile 계측값(지수이동평균, ms)을 읽는다.

실행: python tools/perf_stage.py --at 110
"""

from __future__ import annotations

import argparse
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(DIST), **kw)

    def log_message(self, *a):
        pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--at", type=int, default=110)
    ap.add_argument("--seed", type=int, default=20260818)
    args = ap.parse_args()

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}"

    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--enable-gpu", "--use-gl=angle",
                                     "--use-angle=default", "--ignore-gpu-blocklist"])
        c = b.new_context(viewport={"width": 1600, "height": 900}, locale="en-US")
        p = c.new_page()
        p.goto(f"{base}/?demo=1&debug=1&seed={args.seed}", wait_until="load")
        p.wait_for_timeout(args.at * 1000)
        fps = p.evaluate("""(ms) => new Promise((res) => {
          let n = 0; const t0 = performance.now();
          function tick(now){ n++; if (now - t0 < ms) requestAnimationFrame(tick);
            else res(n / ((now - t0) / 1000)); }
          requestAnimationFrame(tick);
        })""", 3000)
        # renderer 는 모듈 스코프라 직접 못 잡는다 - __coil.state() 로 fps/scale 만,
        # 단계별 시간은 debug 오버레이 텍스트가 아니라 window.__coilTimes 로 노출한다.
        times = p.evaluate("() => (window.__coilTimes ? window.__coilTimes() : null)")
        print(f"fps={fps:.1f}")
        print(json.dumps(times, indent=2))
        c.close()
        b.close()
    httpd.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
