"""qa_steer_map.py - "where on screen can I actually steer?" map. headless only.

Sweeps a grid of touch-down points over the whole screen, drags each one by a
realistic thumb distance, and records whether input.aimAngle became non-null.
Any cell that stays null is a place where the player pushes and nothing happens.

Two-layer control (a zero-hit result is not evidence of absence):
  negative control : cells far from any button MUST steer (proves the rig works)
  positive control : --positive-control patches the built bundle so that the
                     steer assignment can never happen; every cell MUST go dead.
                     If the map still shows live cells, the rig is lying.

Usage:
  python tools/qa_steer_map.py                     # map current build
  python tools/qa_steer_map.py --drag 60           # thumb travel in css px
  python tools/qa_steer_map.py --positive-control  # prove the rig can fail
"""

from __future__ import annotations

import argparse
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
COLS, ROWS = 12, 22


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


def break_bundle(src: Path, dst: Path) -> bool:
    """Positive control: neutralise every steer assignment in the built JS.

    beginSteer() sets `this.steerId = id`. Rewriting it to -1 kills steering
    everywhere while leaving the rest of the game running, so the map must
    come back all-dead. If it does not, the harness is not measuring steering.
    """
    shutil.copytree(src, dst, dirs_exist_ok=True)
    hit = 0
    for js in (dst / "assets").glob("*.js"):
        text = js.read_text(encoding="utf-8")
        # minified form of `this.steerId = id` inside beginSteer(id, x, y, ox, oy)
        new, n = re.subn(r"(\w+)\.steerId\s*=\s*([a-zA-Z_$][\w$]*)\s*,", r"\1.steerId=-1,", text, count=1)
        if n:
            js.write_text(new, encoding="utf-8")
            hit += n
    return hit > 0


def run(base: str, drag: float, label: str):
    dead, live, errors = [], [], []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(
            viewport={"width": W, "height": H}, device_scale_factor=2,
            is_mobile=True, has_touch=True, locale="ko-KR",
        )
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{base}/?debug=1&ads=off", wait_until="load")
        page.wait_for_timeout(1300)
        page.tap("button.btn-primary")
        page.wait_for_timeout(800)
        cdp = ctx.new_cdp_session(page)

        def send(kind, pts):
            cdp.send("Input.dispatchTouchEvent", {
                "type": kind,
                "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)],
            })

        def state():
            return page.evaluate("() => window.__coil.state()")

        def ensure_alive():
            st = state()
            if st["mode"] != "play" or not st["alive"]:
                page.evaluate("() => window.__coil.startRun()")
                page.wait_for_timeout(650)
                st = state()
            return st

        st = ensure_alive()
        geom = {"boostBtn": st["boostBtn"], "w": W, "h": H, "drag": drag}

        for r in range(ROWS):
            for c in range(COLS):
                x = (c + 0.5) * W / COLS
                y = (r + 0.5) * H / ROWS
                ensure_alive()
                send("touchStart", [(x, y)])
                page.wait_for_timeout(45)
                # realistic thumb pivot: up-and-left arc, in 3 steps
                for f in (0.35, 0.7, 1.0):
                    send("touchMove", [(x - drag * 0.35 * f, y - drag * f)])
                    page.wait_for_timeout(25)
                s = state()
                cell = {"x": round(x), "y": round(y), "aim": s["aim"],
                        "stick": s["stick"], "boost": s["inputBoost"]}
                (live if s["aim"] is not None else dead).append(cell)
                send("touchEnd", [])
                page.wait_for_timeout(35)

        ctx.close()
        browser.close()

    total = len(live) + len(dead)
    print(f"--- {label} : drag={drag}px grid={COLS}x{ROWS} ---")
    print(f"live={len(live)} dead={len(dead)} total={total} deadPct={100*len(dead)/total:.1f}%")
    print("boostBtn", json.dumps(geom["boostBtn"]))
    # ascii map, top row = top of screen
    grid = {}
    for cell in live:
        grid[(cell["x"], cell["y"])] = "+"
    for cell in dead:
        grid[(cell["x"], cell["y"])] = "B" if cell["boost"] else "."
    for r in range(ROWS):
        row = ""
        for c in range(COLS):
            x = round((c + 0.5) * W / COLS)
            y = round((r + 0.5) * H / ROWS)
            row += grid.get((x, y), "?")
        print(f"  y={y:4d} |{row}|")
    print("  legend: + steers   B dead-but-boosting   . dead and no boost")
    if dead:
        print("  dead cells:", json.dumps(dead[:40], ensure_ascii=False))
    if errors:
        print("  pageerrors:", errors[:5])
    return len(live), len(dead)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--drag", type=float, default=60.0)
    ap.add_argument("--positive-control", action="store_true")
    a = ap.parse_args()
    if not (DIST / "index.html").exists():
        print("dist missing. run: npm run build:web")
        return 2

    if a.positive_control:
        tmp = Path(tempfile.mkdtemp(prefix="steermap_pc_"))
        broken = tmp / "web"
        if not break_bundle(DIST, broken):
            print("POSITIVE CONTROL SETUP FAILED: no steerId assignment found to break")
            return 3
        port, httpd = make_server(broken)
        live, dead = run(f"http://127.0.0.1:{port}", a.drag, "POSITIVE CONTROL (steering disabled)")
        httpd.shutdown()
        shutil.rmtree(tmp, ignore_errors=True)
        if live > 0:
            print(f"[RIG INVALID] {live} cells still steered with steering disabled.")
            return 1
        print("[RIG OK] every cell went dead when steering was disabled.")
        return 0

    port, httpd = make_server(DIST)
    live, dead = run(f"http://127.0.0.1:{port}", a.drag, "CURRENT BUILD")
    httpd.shutdown()
    if live == 0:
        print("[SUSPECT] nothing steered anywhere - check the rig before believing this.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
