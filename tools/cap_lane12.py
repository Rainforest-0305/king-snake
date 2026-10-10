# -*- coding: utf-8 -*-
"""cap_lane12.py - 레인 -12(맵 확장 + 뱀 리디자인) «전/후» 실렌더 증거. headless 전용.

같은 시드·같은 뷰포트(393x852 dpr2)·같은 대기 시간. 전후에서 다를 수 있는 것은 코드뿐이다.

  python tools/cap_lane12.py <distdir> <tag>
산출물: qa/lane12/<tag>/
  play_t3.png        사람 조작 판(입력 없음) 시작 3초 - HUD 포함 전체 화면
  demo_t3.png        데모(AI 조종) 시작 3초 - 전체 화면
  demo_t30.png       데모 30초
  minimap_x3.png     play_t3 의 미니맵만 3배 확대
  zoom_x3.png        play_t3 의 «내 뱀 머리 + 몸» 확대 컷(3배)
  zoom_bot_x3.png    demo_t30 화면 중앙 확대(남의 뱀이 걸리는 컷)
  skins_sheet.png    스킨 전체 시트(플레이어 12 + 봇 배색 12) - 게임과 같은 렌더 코드
  desktop_t30.png    1600x900 데모 30초
"""
from __future__ import annotations

import base64
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

from PIL import Image
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


def crop_scale(src: Path, box, k: int, dst: Path) -> None:
    im = Image.open(src)
    c = im.crop(box)
    c = c.resize((c.width * k, c.height * k), Image.LANCZOS)
    c.save(dst)


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    dist = Path(sys.argv[1]).resolve()
    tag = sys.argv[2]
    out = ROOT / "qa" / "lane12" / tag
    out.mkdir(parents=True, exist_ok=True)
    if not (dist / "index.html").exists():
        print("dist missing:", dist)
        return 2

    port, httpd = serve(dist)
    base = f"http://127.0.0.1:{port}"
    errs: list[str] = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": W, "height": H}, device_scale_factor=2,
                            is_mobile=True, has_touch=True, locale="ko-KR")
        # 조작 안내(첫 3판)가 확대 컷을 덮지 않도록 «판 수 9»인 저장본을 심는다. 스킨은 기본(corn).
        ctx.add_init_script(
            "localStorage.setItem('king-snake.save', JSON.stringify({v:1,nick:'',skin:'corn',sound:false,"
            "control:'joystick',locale:'ko',bestScore:0,bestRank:0,games:9,totalKills:0,playSeconds:0}))")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)

        # 1) 사람 판: 입력 없이 3초. 카메라는 머리에 고정이므로 머리 = 화면 중앙.
        page.goto(f"{base}/?ads=off&seed={SEED}", wait_until="load")
        page.wait_for_timeout(1400)
        page.tap("button.p-play")
        page.wait_for_timeout(3000)
        page.screenshot(path=str(out / "play_t3.png"))

        # 2) 데모 판 3초 / 30초
        page.goto(f"{base}/?demo=1&ads=off&seed={SEED}", wait_until="load")
        page.wait_for_timeout(3000)
        page.screenshot(path=str(out / "demo_t3.png"))
        page.wait_for_timeout(27000)
        page.screenshot(path=str(out / "demo_t30.png"))

        # 3) 스킨 시트(debug 훅)
        page.goto(f"{base}/?debug=1&ads=off&seed={SEED}", wait_until="load")
        page.wait_for_timeout(800)
        data = page.evaluate("() => window.__coilSkinSheet ? window.__coilSkinSheet(6) : ''")
        if data:
            (out / "skins_sheet.png").write_bytes(base64.b64decode(data.split(",", 1)[1]))
        else:
            errs.append("no __coilSkinSheet hook")
        ctx.close()

        ctx2 = b.new_context(viewport={"width": 1600, "height": 900}, locale="ko-KR")
        p2 = ctx2.new_page()
        p2.goto(f"{base}/?demo=1&ads=off&seed={SEED}", wait_until="load")
        p2.wait_for_timeout(30000)
        p2.screenshot(path=str(out / "desktop_t30.png"))
        ctx2.close()
        b.close()
    httpd.shutdown()

    # 확대 컷(dpr2 이므로 css 좌표 x2)
    cx, cy = W, H  # 화면 중앙(px)
    crop_scale(out / "play_t3.png", (cx - 300, cy - 200, cx + 300, cy + 200), 3, out / "zoom_x3.png")
    crop_scale(out / "demo_t30.png", (cx - 300, cy - 200, cx + 300, cy + 200), 3, out / "zoom_bot_x3.png")
    # 미니맵: 우하단. minimapRect 는 r=max(46,min(78, min(W,H)*0.105)) = 46, pad 14 → 폭 120css.
    crop_scale(out / "play_t3.png", (W * 2 - 260, H * 2 - 260, W * 2, H * 2), 3, out / "minimap_x3.png")

    print("saved:", out)
    if errs:
        print("ERRORS:", errs)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
