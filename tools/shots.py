"""shots.py - 시연/스토어 스크린샷 촬영.

?demo=1 로 AI 가 플레이하는 판을 띄우고, 성장 단계별로 여러 장 찍는다.
사람이 잘 플레이하는 순간을 «기다릴» 필요가 없다는 게 요점이다.

실행:
  python tools/shots.py                       # 기본
  python tools/shots.py --waits 6,20,45,90    # 촬영 시점(초)
  python tools/shots.py --store               # 스토어 규격(1920x1080 / 636x1048)

산출물: qa/shots/*.png  ·  store/screenshots/*.png (--store)
"""

from __future__ import annotations

import argparse
import http.server
import socketserver
import sys
import threading
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("playwright 가 없다: pip install playwright && playwright install chromium")
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"


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


def shoot(pw, base, outdir: Path, tag: str, w: int, h: int, mobile: bool,
          waits: list[int], seed: int, debug: bool, locale: str):
    outdir.mkdir(parents=True, exist_ok=True)
    browser = pw.chromium.launch()
    ctx = browser.new_context(
        viewport={"width": w, "height": h},
        device_scale_factor=1,
        is_mobile=mobile,
        has_touch=mobile,
        locale=locale,
    )
    page = ctx.new_page()
    errs: list[str] = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)

    q = f"?demo=1&seed={seed}" + ("&debug=1" if debug else "")
    page.goto(f"{base}/{q}", wait_until="load")

    prev = 0
    for sec in waits:
        page.wait_for_timeout(max(200, (sec - prev) * 1000))
        prev = sec
        page.screenshot(path=str(outdir / f"{tag}_t{sec:03d}.png"))
        info = page.evaluate("""() => {
          const b = document.querySelector('.hud-score b');
          const r = document.querySelectorAll('.hud-score b')[1];
          return { len: b && b.textContent, rank: r && r.textContent };
        }""")
        print(f"  {tag} t={sec}s  length={info['len']} rank={info['rank']}", flush=True)

    ctx.close()
    browser.close()
    return errs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--waits", default="6,25,60,110")
    ap.add_argument("--seed", type=int, default=20260818)
    ap.add_argument("--store", action="store_true")
    ap.add_argument("--debug", action="store_true")
    ap.add_argument("--locale", default="ko-KR")
    args = ap.parse_args()

    if not (DIST / "index.html").exists():
        print("dist 가 없다. 먼저: npm run build:web")
        return 2

    waits = [int(x) for x in args.waits.split(",") if x.strip()]
    port, httpd = serve()
    base = f"http://127.0.0.1:{port}"

    if args.store:
        # ★ 스토어 규격은 «고정»이다(기존 5종 실측): 데스크톱 1920x1080,
        #   모바일 636x1048. PWABuilder/MS Store 가 이 비율을 요구한다.
        cases = [
            ("store/screenshots", "desktop", 1920, 1080, False),
            ("store/screenshots", "mobile", 636, 1048, True),
        ]
    else:
        cases = [
            ("qa/shots", "desktop", 1600, 900, False),
            ("qa/shots", "mobile", 390, 844, True),
        ]

    all_errs = []
    with sync_playwright() as pw:
        for sub, tag, w, h, mob in cases:
            print(f"[shots] {tag} {w}x{h}")
            all_errs += shoot(pw, base, ROOT / sub, tag, w, h, mob, waits,
                              args.seed, args.debug, args.locale)
    httpd.shutdown()

    if all_errs:
        print("\n★ 콘솔/페이지 에러:", all_errs)
        return 1
    print("\n콘솔 에러 0건.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
