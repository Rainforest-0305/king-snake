"""perf_layers.py - 뱀 렌더 «층별» 비용 측정.

?layers=N 으로 층을 끄고 ?fixscale=0 으로 해상도를 고정해 fps 를 잰다.
해상도를 고정하지 «않으면» 적응형 스케일러가 화질을 낮춰 fps 를 60 으로
되돌려 놓기 때문에 비용 차이가 화면에서 사라진다(측정이 무의미해진다).

실행: python tools/perf_layers.py --at 60
"""

from __future__ import annotations

import argparse
import functools
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

FPS_PROBE = """
(ms) => new Promise((resolve) => {
  let n = 0; const t0 = performance.now();
  function tick(now){ n++; if (now - t0 < ms) requestAnimationFrame(tick);
    else resolve(n / ((now - t0) / 1000)); }
  requestAnimationFrame(tick);
});
"""

CASES = [
    ("전 층 ON", 63),
    ("글로우 OFF", 62),
    ("어깨 OFF", 61),
    ("정반사 OFF", 59),
    ("테이퍼 2단", 55),
    ("별밭 OFF", 47),
    ("아레나텍스 OFF", 31),
    ("뱀층 전부 OFF", 48),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--at", type=int, default=60)
    ap.add_argument("--probe", type=int, default=6000)
    ap.add_argument("--seed", type=int, default=20260818)
    ap.add_argument("--backend", default="gpu")
    args = ap.parse_args()

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(DIST))
    handler.log_message = lambda *a, **kw: None  # type: ignore[assignment]
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}"

    out = []
    with sync_playwright() as pw:
        gpu_args = ["--enable-gpu", "--use-gl=angle", "--use-angle=default",
                    "--ignore-gpu-blocklist"]
        br = pw.chromium.launch(args=gpu_args if args.backend == "gpu" else [])
        for label, mask in CASES:
            ctx = br.new_context(viewport={"width": 1600, "height": 900}, locale="en-US")
            page = ctx.new_page()
            page.goto(f"{base}/?demo=1&debug=1&fixscale=0&layers={mask}&seed={args.seed}",
                      wait_until="load")
            page.wait_for_timeout(args.at * 1000)
            fps = page.evaluate(FPS_PROBE, args.probe)
            ctx.close()
            out.append((label, mask, fps))
            print(f"  {label:<12} mask={mask:>2}  fps={fps:5.1f}", flush=True)
        br.close()
    httpd.shutdown()

    full = out[0][2]
    print("\n== 층별 비용(전 층 대비 fps 증가) ==")
    for label, mask, fps in out[1:]:
        print(f"  {label:<12} {fps - full:+5.1f} fps")
    return 0


if __name__ == "__main__":
    sys.exit(main())
