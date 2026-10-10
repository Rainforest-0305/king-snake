"""shots_demo_lane.py - fixed-seed demo captures for before/after comparison. headless only.

Captures the AI-driven arena (?demo=1) at fixed times so orb glow, HUD and
bot size mix can be compared between builds under identical conditions.

Usage:
  python tools/shots_demo_lane.py <tag> [--dist DIR] [--waits 3,30,60]
Output: qa/lane2/<tag>/demo_tNNN.png
"""

from __future__ import annotations

import argparse
import http.server
import socketserver
import sys
import threading
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SEED = "4242"
W, H = 393, 852


def serve(d: Path):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(d), **kw)

        def log_message(self, *a):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1], httpd


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("tag")
    ap.add_argument("--dist", default=str(ROOT / "dist"))
    ap.add_argument("--waits", default="3,30,60")
    args = ap.parse_args()
    dist = Path(args.dist)
    if not (dist / "index.html").exists():
        print("dist missing: " + str(dist))
        return 2
    waits = [int(x) for x in args.waits.split(",") if x.strip()]
    out = ROOT / "qa" / "lane2" / args.tag
    out.mkdir(parents=True, exist_ok=True)

    port, httpd = serve(dist)
    base = f"http://127.0.0.1:{port}"
    errs: list[str] = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True, args=["--enable-gpu", "--use-gl=angle"])
        ctx = b.new_context(viewport={"width": W, "height": H}, device_scale_factor=2,
                            is_mobile=True, has_touch=True, locale="ko-KR")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)
        page.goto(f"{base}/?demo=1&ads=off&seed={SEED}", wait_until="load")
        prev = 0
        for sec in waits:
            page.wait_for_timeout(max(200, (sec - prev) * 1000))
            prev = sec
            page.screenshot(path=str(out / f"demo_t{sec:03d}.png"))
            info = page.evaluate("""() => {
              const b = document.querySelectorAll('.hud-score b');
              const rows = [...document.querySelectorAll('.hud-board li:not(.hidden) s')].map(s => s.textContent);
              return { len: b[0] && b[0].textContent, rank: b[1] && b[1].textContent, board: rows };
            }""")
            print(f"  t={sec}s len={info['len']} rank={info['rank']} board={info['board']}")
        ctx.close()
        b.close()
    httpd.shutdown()
    print(f"wrote -> {out}")
    if errs:
        print("errors:", errs[:6])
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
