"""cap_skins.py - 스킨 스와치/히어로/브랜드마크만 빠르게 찍는다(반복 조정용).

산출물: qa/gfx/<tag>_skins.png · <tag>_skinhero.png · <tag>_mark.png
        <tag>_skins12.png (12종 «전량» - 6종만 보고 판단하면 뒤쪽에서 겹친다)
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
OUT = ROOT / "qa" / "gfx"

SAVE = {
    "v": 1, "nick": "PRESIDENT", "skin": "corn", "sound": True,
    "control": "joystick", "locale": "ko",
    "bestScore": 99999, "bestRank": 1, "games": 9, "totalKills": 22,
    "playSeconds": 900,
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(DIST), **kw)

    def log_message(self, *a):
        pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}"

    with sync_playwright() as pw:
        b = pw.chromium.launch()
        c = b.new_context(viewport={"width": 1440, "height": 1000},
                          device_scale_factor=2, locale="ko-KR")
        c.add_init_script("localStorage.setItem('king-snake.save', %s)"
                          % json.dumps(json.dumps(SAVE)))
        p = c.new_page()
        p.goto(base + "/", wait_until="load")
        p.wait_for_timeout(1500)
        p.query_selector(".skin-rail").screenshot(path=str(OUT / f"{args.tag}_skins.png"))
        p.query_selector(".skin-hero").screenshot(path=str(OUT / f"{args.tag}_skinhero.png"))
        p.query_selector(".brand-mark").screenshot(path=str(OUT / f"{args.tag}_mark.png"))
        # ★ 12종 전량 - 레일은 스크롤이라 6종만 보인다. 임시로 감싸서 전부 펼친다.
        p.evaluate("""() => {
          const r = document.querySelector('.skin-rail');
          r.style.overflow = 'visible';
          r.style.flexWrap = 'wrap';
          r.style.width = '460px';
          r.style.maskImage = 'none';
          r.style.webkitMaskImage = 'none';
        }""")
        p.wait_for_timeout(200)
        p.query_selector(".skin-rail").screenshot(path=str(OUT / f"{args.tag}_skins12.png"))
        c.close()
        b.close()
    httpd.shutdown()
    print("ok", args.tag)
    return 0


if __name__ == "__main__":
    sys.exit(main())
