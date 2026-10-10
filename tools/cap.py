"""cap.py - 그래픽 품질 «전후» 증거 촬영.

President 가 본 것과 «같은 각도»로 찍는다:
  1) 타이틀 데스크톱 1920x1080
  2) 타이틀 모바일  390x844
  3) 플레이 중(demo) 1600x900 - 뱀이 커진 시점
  4) 스킨 6종 나란히 (레일 요소 크롭)

실행: python tools/cap.py --tag before
산출물: qa/gfx/<tag>_*.png
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

# 스킨 전량 해금 상태로 찍어야 6종 비교가 된다.
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


def serve():
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1], httpd


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True)
    ap.add_argument("--seed", type=int, default=20260818)
    ap.add_argument("--play-at", type=int, default=55)
    args = ap.parse_args()

    if not (DIST / "index.html").exists():
        print("dist 가 없다. 먼저: npm run build:web")
        return 2
    OUT.mkdir(parents=True, exist_ok=True)
    port, httpd = serve()
    base = f"http://127.0.0.1:{port}"
    errs: list[str] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--enable-gpu", "--use-gl=angle",
                                           "--use-angle=default", "--ignore-gpu-blocklist"])

        def ctx_for(w, h, mobile, dsf=1):
            c = browser.new_context(viewport={"width": w, "height": h},
                                    device_scale_factor=dsf, is_mobile=mobile,
                                    has_touch=mobile, locale="ko-KR")
            c.add_init_script("localStorage.setItem('king-snake.save', %s)"
                              % json.dumps(json.dumps(SAVE)))
            return c

        # 1) 타이틀 데스크톱
        c = ctx_for(1920, 1080, False)
        p = c.new_page()
        p.on("pageerror", lambda e: errs.append(str(e)))
        p.goto(base + "/", wait_until="load")
        p.wait_for_timeout(2600)
        p.screenshot(path=str(OUT / f"{args.tag}_title_desktop.png"))
        # 4) 스킨 레일 크롭
        rail = p.query_selector(".skin-rail")
        if rail:
            rail.screenshot(path=str(OUT / f"{args.tag}_skins.png"))
        hero = p.query_selector(".skin-hero")
        if hero:
            hero.screenshot(path=str(OUT / f"{args.tag}_skinhero.png"))
        c.close()

        # 2) 타이틀 모바일
        c = ctx_for(390, 844, True, 2)
        p = c.new_page()
        p.on("pageerror", lambda e: errs.append(str(e)))
        p.goto(base + "/", wait_until="load")
        p.wait_for_timeout(2600)
        p.screenshot(path=str(OUT / f"{args.tag}_title_mobile.png"))
        c.close()

        # 3) 플레이
        for at in (12, args.play_at):
            c = ctx_for(1600, 900, False)
            p = c.new_page()
            p.on("pageerror", lambda e: errs.append(str(e)))
            p.goto(f"{base}/?demo=1&seed={args.seed}", wait_until="load")
            p.wait_for_timeout(at * 1000)
            p.screenshot(path=str(OUT / f"{args.tag}_play_t{at:03d}.png"))
            c.close()

        # 3b) 모바일 플레이
        c = ctx_for(390, 844, True, 2)
        p = c.new_page()
        p.on("pageerror", lambda e: errs.append(str(e)))
        p.goto(f"{base}/?demo=1&seed={args.seed}", wait_until="load")
        p.wait_for_timeout(args.play_at * 1000)
        p.screenshot(path=str(OUT / f"{args.tag}_play_mobile.png"))
        c.close()

        browser.close()
    httpd.shutdown()

    if errs:
        print("★ 페이지 에러:", errs)
        return 1
    print(f"완료: {OUT} ({args.tag}) · 에러 0건")
    return 0


if __name__ == "__main__":
    sys.exit(main())
