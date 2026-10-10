# -*- coding: utf-8 -*-
"""shot_ab.py - 두 빌드의 «같은 시드·같은 시각» 실렌더 화면을 나란히 찍는다.

「적용했다」가 아니라 «화면»이 산출물이다. 굵기·시야는 숫자만으로는 못 믿는다.
데모 모드로 띄워 같은 월드가 같은 시각에 어떻게 보이는지 그대로 남긴다.

  python tools/shot_ab.py <dirA> <dirB> [초...]        (기본 3,20,60)

★ headless 고정 - President 가 같은 컴퓨터에서 업무 중이라 창을 띄우지 않는다.
"""
from __future__ import annotations

import http.server
import socketserver
import sys
import threading
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "qa" / "shot_ab"
SEED = 20260818


def serve(d: Path) -> int:
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(d), **k)

        def log_message(self, *a):
            pass

    s = socketserver.TCPServer(("127.0.0.1", 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s.server_address[1]


def shoot(tag: str, d: Path, marks: list[int], pw) -> None:
    port = serve(d)
    b = pw.chromium.launch(headless=True)
    try:
        ctx = b.new_context(viewport={"width": 390, "height": 652},
                            locale="ko-KR", has_touch=True, is_mobile=True,
                            device_scale_factor=2)
        pg = ctx.new_page()
        pg.goto("http://127.0.0.1:%d/?demo=1&debug=1&seed=%d" % (port, SEED),
                wait_until="networkidle")
        prev = 0.0
        for m in marks:
            pg.wait_for_timeout(int(max(0.2, m - prev) * 1000))
            prev = m
            st = pg.evaluate("() => { const s = window.__coil && window.__coil.state();"
                             " const t = window.__coilTimes && window.__coilTimes();"
                             " return s && t ? {mass: Math.round(s.mass), orbs: t.orbs,"
                             " snakes: t.snakes} : null; }")
            pg.screenshot(path=str(OUT / ("t%03d_%s.png" % (m, tag))))
            print("  %-10s t=%3ds  질량 %-5s 화면오브 %-4s 화면뱀 %s"
                  % (tag, m, st and st["mass"], st and st["orbs"], st and st["snakes"]))
        ctx.close()
    finally:
        b.close()


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    a, b = Path(sys.argv[1]), Path(sys.argv[2])
    marks = [int(x) for x in sys.argv[3:]] or [3, 20, 60]
    OUT.mkdir(parents=True, exist_ok=True)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        shoot("before", a, marks, pw)
        shoot("after", b, marks, pw)
    print("스크린샷: %s" % OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
