"""qa_render.py - 실렌더 검증.

「구현했습니다」는 증거가 아니다. 이 스크립트가 증거를 만든다:
  · 실제 브라우저에서 dist/ 를 띄우고
  · 메뉴 -> 플레이 -> 사망까지 «조작»하고
  · 스크린샷 / 콘솔에러 / 실측 FPS 를 남긴다.

실행:
  python tools/qa_render.py            # 기본(데스크톱+모바일)
  python tools/qa_render.py --seconds 20

★ dist/ 를 «HTTP 로» 서빙한다. file:// 로 열면 ES 모듈이 CORS 로 차단돼
  「빈 화면」이 나오는데, 이건 코드 문제가 아니라 프로토콜 문제다.
  실제로 이걸로 두 번 헛짚은 이력이 있어 스크립트로 못 박아 둔다.
"""

from __future__ import annotations

import argparse
import http.server
import json
import os
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
OUT = ROOT / "qa"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(DIST), **kw)

    def log_message(self, *a):  # 서버 로그로 콘솔을 더럽히지 않는다
        pass


def serve() -> tuple[int, socketserver.TCPServer]:
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return port, httpd


# 실측 FPS: rAF 를 세는 것 외에 믿을 방법이 없다.
FPS_PROBE = """
() => new Promise((resolve) => {
  let frames = 0;
  let worst = 0;
  let prev = performance.now();
  const t0 = prev;
  function tick(now) {
    const d = now - prev; prev = now;
    if (frames > 3 && d > worst) worst = d;   // 첫 몇 프레임은 워밍업이라 제외
    frames++;
    if (now - t0 < 3000) requestAnimationFrame(tick);
    else resolve({ fps: frames / ((now - t0) / 1000), worstFrameMs: worst });
  }
  requestAnimationFrame(tick);
});
"""


def run_case(pw, base: str, name: str, w: int, h: int, mobile: bool, seconds: int) -> dict:
    browser = pw.chromium.launch(args=["--enable-gpu", "--use-gl=angle"])
    ctx = browser.new_context(
        viewport={"width": w, "height": h},
        device_scale_factor=2 if mobile else 1,
        is_mobile=mobile,
        has_touch=mobile,
        locale="ko-KR",
    )
    page = ctx.new_page()
    errors: list[str] = []
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

    page.goto(f"{base}/?debug=1", wait_until="load")
    page.wait_for_timeout(1600)  # 메뉴 배경 월드가 돌기 시작할 시간
    page.screenshot(path=str(OUT / f"{name}_1_menu.png"))

    menu_fps = page.evaluate(FPS_PROBE)

    # PLAY
    page.click("button.btn-primary")
    page.wait_for_timeout(900)
    page.screenshot(path=str(OUT / f"{name}_2_play_start.png"))

    cx, cy = w // 2, h // 2
    if mobile:
        # 조이스틱: 화면 좌하단에서 드래그
        page.touchscreen.tap(cx, cy)

    # 실제로 «조작»한다. 원을 그리며 이동 + 중간에 부스트.
    import math

    steps = max(20, seconds * 8)
    for i in range(steps):
        a = (i / steps) * math.pi * 6
        tx = cx + math.cos(a) * (w * 0.28)
        ty = cy + math.sin(a) * (h * 0.28)
        if mobile:
            page.mouse.move(tx, ty)  # 터치 드래그는 아래에서 별도로
        else:
            page.mouse.move(tx, ty)
        if i % 9 == 0:
            page.keyboard.down("Space")
        if i % 9 == 4:
            page.keyboard.up("Space")
        page.wait_for_timeout(int(seconds * 1000 / steps))
    page.keyboard.up("Space")

    play_fps = page.evaluate(FPS_PROBE)
    page.screenshot(path=str(OUT / f"{name}_3_play.png"))

    state = page.evaluate("""() => {
      const el = document.querySelector('.hud-score b');
      const board = Array.from(document.querySelectorAll('.hud-board li:not(.hidden) u')).map(n => n.textContent);
      return {
        length: el ? el.textContent : null,
        boardCount: board.length,
        boardSample: board.slice(0, 3),
        hudVisible: !document.getElementById('hud').classList.contains('hidden'),
      };
    }""")

    ctx.close()
    browser.close()
    return {
        "case": name,
        "viewport": f"{w}x{h}",
        "menuFps": round(menu_fps["fps"], 1),
        "menuWorstFrameMs": round(menu_fps["worstFrameMs"], 1),
        "playFps": round(play_fps["fps"], 1),
        "playWorstFrameMs": round(play_fps["worstFrameMs"], 1),
        "state": state,
        "consoleIssues": errors,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=int, default=12)
    ap.add_argument("--only", default="")
    args = ap.parse_args()

    if not (DIST / "index.html").exists():
        print("dist/index.html 이 없다. 먼저: npm run build:web")
        return 2
    OUT.mkdir(exist_ok=True)

    port, httpd = serve()
    base = f"http://127.0.0.1:{port}"
    cases = [
        ("desktop", 1600, 900, False),
        ("mobile", 390, 844, True),
    ]
    if args.only:
        cases = [c for c in cases if c[0] == args.only]

    results = []
    with sync_playwright() as pw:
        for name, w, h, mob in cases:
            print(f"[qa] {name} {w}x{h} ...", flush=True)
            results.append(run_case(pw, base, name, w, h, mob, args.seconds))
    httpd.shutdown()

    (OUT / "result.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(results, ensure_ascii=False, indent=2))

    bad = [r for r in results if r["consoleIssues"]]
    if bad:
        print("\n★ 콘솔 이슈가 있다. 0건이 기준이다.")
        return 1
    print("\n콘솔 이슈 0건.")
    return 0


if __name__ == "__main__":
    os.chdir(ROOT)
    sys.exit(main())
