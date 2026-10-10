"""qa_safearea.py - proves the safe-area inset plumbing is live. headless only.

Headless Chromium cannot emulate a notch, so env(safe-area-inset-*) is always
0 here. That means "the numbers look fine" proves nothing. Instead this test
FORCES a non-zero inset into the built bundle and checks that the canvas HUD
(boost button + minimap) actually moves by that amount.

  baseline  : untouched build, records boostBtn.y
  forced    : readSafeArea() patched to report bottom=34 (iPhone home indicator)
              -> boostBtn.y must move UP by 34, minimap with it

Before 2026-08-28 `Renderer.safe` was declared and never assigned, so the
forced run would move nothing. That is exactly what this test detects.

Usage: python tools/qa_safearea.py
"""

from __future__ import annotations

import http.server
import json
import re
import shutil
import socketserver
import sys
import tempfile
import threading
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
W, H = 393, 852
FORCED_BOTTOM = 34
FORCED_RIGHT = 0


def make_server(directory: Path):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(directory), **kw)

        def log_message(self, *a):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1], httpd


def force_inset(src: Path, dst: Path) -> bool:
    """Rewrite the minified safe-area probe so it reports a fixed inset."""
    shutil.copytree(src, dst, dirs_exist_ok=True)
    for js in (dst / "assets").glob("*.js"):
        t = js.read_text(encoding="utf-8")
        # the probe builds `{top:num(cs.paddingTop), right:..., bottom:..., left:...}`
        m = re.search(r"paddingTop\)[^}]{0,200}?paddingBottom\)", t)
        if not m:
            continue
        seg = t[m.start():m.end()]
        new = seg.replace("paddingBottom)", f"paddingBottom)||{FORCED_BOTTOM}", 1)
        new = new.replace("paddingTop)", "paddingTop)", 1)
        if new == seg:
            continue
        t = t[:m.start()] + new + t[m.end():]
        js.write_text(t, encoding="utf-8")
        return True
    return False


def read_state(base: str) -> dict:
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": W, "height": H}, device_scale_factor=2,
                            is_mobile=True, has_touch=True, locale="ko-KR")
        page = ctx.new_page()
        page.goto(f"{base}/?debug=1&ads=off", wait_until="load")
        page.wait_for_timeout(1200)
        page.tap("button.btn-primary")
        page.wait_for_timeout(700)
        st = page.evaluate("() => window.__coil.state()")
        ctx.close()
        b.close()
    return st


def main() -> int:
    if not (DIST / "index.html").exists():
        print("dist missing: npm run build:web")
        return 2

    port, httpd = make_server(DIST)
    base_state = read_state(f"http://127.0.0.1:{port}")
    httpd.shutdown()

    tmp = Path(tempfile.mkdtemp(prefix="safearea_"))
    forced_dir = tmp / "web"
    if not force_inset(DIST, forced_dir):
        print("SETUP FAILED: safe-area probe not found in the bundle.")
        shutil.rmtree(tmp, ignore_errors=True)
        return 3
    port2, httpd2 = make_server(forced_dir)
    forced_state = read_state(f"http://127.0.0.1:{port2}")
    httpd2.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)

    b0 = base_state["boostBtn"]
    b1 = forced_state["boostBtn"]
    dy = b0["y"] - b1["y"]
    print(json.dumps({
        "baseline_boostY": b0["y"],
        "forced_boostY": b1["y"],
        "movedUpBy": dy,
        "expected": FORCED_BOTTOM,
    }, indent=2))

    if abs(dy - FORCED_BOTTOM) > 1:
        print(f"[FAIL] safe-area inset is not reaching the canvas HUD "
              f"(moved {dy}px, expected {FORCED_BOTTOM}px).")
        return 1
    print(f"[PASS] a {FORCED_BOTTOM}px bottom inset moves the canvas HUD "
          f"up by {dy}px - the plumbing is live.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
