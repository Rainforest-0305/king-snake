"""shots_lane.py - fixed-condition before/after surface capture. headless only.

Same seed, same viewport, same wait budget every run, so the only thing that
can differ between BEFORE and AFTER is the code under test.

Usage:
  python tools/shots_lane.py before
  python tools/shots_lane.py after
Output: qa/lane/<tag>/<surface>.png
"""

from __future__ import annotations

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
DIST = ROOT / "dist"
SEED = "4242"
W, H = 393, 852


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(DIST), **kw)

    def log_message(self, *a):
        pass


def serve():
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1], httpd


def main() -> int:
    tag = sys.argv[1] if len(sys.argv) > 1 else "shot"
    out = ROOT / "qa" / "lane" / tag
    out.mkdir(parents=True, exist_ok=True)
    if not (DIST / "index.html").exists():
        print("dist missing: npm run build:web")
        return 2

    port, httpd = serve()
    base = f"http://127.0.0.1:{port}"
    errs: list[str] = []

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": W, "height": H}, device_scale_factor=2,
                            is_mobile=True, has_touch=True, locale="ko-KR")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)

        # ★ 시각 증거는 «?debug 없이» 찍는다. debug 판은 화면 하단에 계측
        #   오버레이를 그려서 좌하단 유령 조이스틱을 그대로 덮는다 - 증거가
        #   증거를 가리는 상태로는 전후 비교가 성립하지 않는다.
        clean = f"{base}/?ads=off&seed={SEED}"
        page.goto(clean, wait_until="load")
        page.wait_for_timeout(1400)
        page.tap("button.p-play")
        page.wait_for_timeout(1200)
        page.screenshot(path=str(out / "03c_play_clean.png"))
        cdp0 = ctx.new_cdp_session(page)

        def send0(kind, pts):
            cdp0.send("Input.dispatchTouchEvent", {
                "type": kind,
                "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)],
            })

        # 393x852 에서 질주 버튼은 (329,678) r38 이다(qa_steer_map.py 실측).
        BX, BY = 329, 678
        ox0, oy0 = int(W * 0.72), int(H * 0.70)
        send0("touchStart", [(ox0, oy0)])
        page.wait_for_timeout(70)
        for f in (0.4, 0.8, 1.0):
            send0("touchMove", [(ox0 - 26 * f, oy0 - 62 * f)])
            page.wait_for_timeout(45)
        page.wait_for_timeout(150)
        page.screenshot(path=str(out / "04c_play_joystick_clean.png"))
        send0("touchEnd", [])
        page.wait_for_timeout(150)
        # 질주 버튼을 누른 채 «밀어서» 조종까지 되는 상태(2026-08-28 신규 동작)
        send0("touchStart", [(BX, BY)])
        page.wait_for_timeout(70)
        send0("touchMove", [(BX - 30, BY - 30)])
        page.wait_for_timeout(200)
        page.screenshot(path=str(out / "05c_boost_steer_clean.png"))
        send0("touchEnd", [])
        page.wait_for_timeout(200)

        url = f"{base}/?debug=1&ads=off&seed={SEED}"
        page.goto(url, wait_until="load")
        page.wait_for_timeout(1500)
        page.screenshot(path=str(out / "01_menu.png"))

        # scroll the menu panel to reach the lower blocks
        page.evaluate("""() => {
          const ov = document.querySelector('.overlay:not(.hidden)');
          if (ov) ov.scrollTop = ov.scrollHeight;
        }""")
        page.wait_for_timeout(350)
        page.screenshot(path=str(out / "02_menu_bottom.png"))
        page.evaluate("""() => {
          const ov = document.querySelector('.overlay:not(.hidden)');
          if (ov) ov.scrollTop = 0;
        }""")
        page.wait_for_timeout(250)

        page.tap("button.p-play")
        page.wait_for_timeout(1200)
        page.screenshot(path=str(out / "03_play.png"))

        # steering touch held down so the joystick is on screen
        cdp = ctx.new_cdp_session(page)

        def send(kind, pts):
            cdp.send("Input.dispatchTouchEvent", {
                "type": kind,
                "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)],
            })

        ox, oy = int(W * 0.72), int(H * 0.70)
        send("touchStart", [(ox, oy)])
        page.wait_for_timeout(70)
        for f in (0.4, 0.8, 1.0):
            send("touchMove", [(ox - 26 * f, oy - 62 * f)])
            page.wait_for_timeout(45)
        page.wait_for_timeout(120)
        page.screenshot(path=str(out / "04_play_joystick.png"))
        send("touchEnd", [])
        page.wait_for_timeout(150)

        # boost held
        st = page.evaluate("() => window.__coil.state()")
        bb = st["boostBtn"]
        send("touchStart", [(bb["x"], bb["y"])])
        page.wait_for_timeout(260)
        page.screenshot(path=str(out / "05_play_boost.png"))
        send("touchEnd", [])
        page.wait_for_timeout(150)

        # pause
        page.tap("button.hud-pause")
        page.wait_for_timeout(500)
        page.screenshot(path=str(out / "06_pause.png"))
        page.evaluate("""() => {
          const bs = [...document.querySelectorAll('.overlay:not(.hidden) button.btn-primary')];
          if (bs[0]) bs[0].click();
        }""")
        page.wait_for_timeout(400)

        # death
        page.evaluate("() => window.__coil.kill()")
        for _ in range(60):
            page.wait_for_timeout(300)
            vis = page.evaluate("""() => {
              const el = document.querySelector('.result-cause');
              if (!el) return false;
              const ov = el.closest('.overlay');
              return !!ov && !ov.classList.contains('hidden');
            }""")
            if vis:
                break
        page.wait_for_timeout(700)
        page.screenshot(path=str(out / "07_death.png"))

        ctx.close()
        b.close()
    httpd.shutdown()
    print(f"wrote -> {out}")
    if errs:
        print("errors:", errs[:6])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
