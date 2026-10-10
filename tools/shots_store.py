"""shots_store.py - King Snake 스토어 자산 캡처 (MS Store / AIT).

tools/shots.py 의 서버 기동·데모모드 방식(정적 서버 + ?demo=1&seed= 로 AI가
플레이하는 판을 띄우고 기다렸다 찍는 방식)을 그대로 따르되, tools/shots.py
자체는 건드리지 않는다 - 이 파일은 별도 스크립트다.

★ shots.py 와의 차이:
  - ?debug=1 을 절대 쓰지 않는다(좌하단 디버그 오버레이가 스크린샷에 찍힌다).
  - 스토어가 요구하는 «정확한» 픽셀 규격 3종을 고정 크기로 찍는다
    (1920x1080 데스크톱 4장 / 636x1048 모바일 4장 / 1932x828 AIT 와이드 1장).
  - 게임 화면 4종(play/grow/leaderboard) 은 데모 모드, «menu» 는 쿼리 없이
    루트(`/`)로 열어 1.5초 대기 후 찍는다(타이틀/메뉴 화면).

실행:
  python tools/shots_store.py

산출물: store/screenshots/*.png
캡처 후 PIL 로 전량 실해상도를 읽어 규격과 대조하고, 불일치가 있으면
0이 아닌 종료코드로 실패 처리한다("찍었다"가 아니라 "쟀다"가 기준).
"""

from __future__ import annotations

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

try:
    from PIL import Image
except ImportError:
    print("Pillow 가 없다: pip install pillow")
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
OUTDIR = ROOT / "store" / "screenshots"

SEED = 20260818
LOCALE = "ko-KR"

# (state_tag, query, wait_seconds) - play/grow/leaderboard 는 데모 모드로
# 성장 단계별 시점에서 찍는다. menu 는 쿼리 없이 루트, 1.5초 대기.
STATES: list[tuple[str, str, float]] = [
    ("play", f"?demo=1&seed={SEED}", 12.0),
    ("grow", f"?demo=1&seed={SEED}", 55.0),
    ("leaderboard", f"?demo=1&seed={SEED}", 110.0),
    ("menu", "", 1.5),
]

# 최종 파일명에 쓰는 순번(1..4) - 표의 순서 그대로.
ORDER = ["play", "grow", "leaderboard", "menu"]


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


def capture_state(pw, base: str, w: int, h: int, mobile: bool, query: str, wait_s: float) -> tuple[bytes, list[str]]:
    """네비게이트하고 wait_s 초 대기한 뒤 스크린샷 바이트를 반환."""
    errs: list[str] = []
    browser = pw.chromium.launch()
    ctx = browser.new_context(
        viewport={"width": w, "height": h},
        device_scale_factor=1,   # ★ 2로 잡으면 2배 이미지가 나와 규격이 어긋난다
        is_mobile=mobile,
        has_touch=mobile,
        locale=LOCALE,
    )
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)

    page.goto(f"{base}/{query}", wait_until="load")
    page.wait_for_timeout(int(wait_s * 1000))
    png = page.screenshot()

    ctx.close()
    browser.close()
    return png, errs


def main() -> int:
    if not (DIST / "index.html").exists():
        print("dist 가 없다. 먼저: npm run build:web")
        return 2

    OUTDIR.mkdir(parents=True, exist_ok=True)
    port, httpd = serve()
    base = f"http://127.0.0.1:{port}"

    all_errs: list[str] = []
    saved: list[Path] = []

    with sync_playwright() as pw:
        # ── MS Store 가로: 1920x1080, 4장 ────────────────────────────────
        print("[shots_store] desktop 1920x1080 x4")
        state_by_tag = {tag: (q, w) for tag, q, w in STATES}
        for i, tag in enumerate(ORDER, start=1):
            q, wait_s = state_by_tag[tag]
            png, errs = capture_state(pw, base, 1920, 1080, False, q, wait_s)
            all_errs += errs
            p = OUTDIR / f"desktop-{i}-{tag}.png"
            p.write_bytes(png)
            saved.append(p)
            print(f"  desktop-{i}-{tag}.png  (waited {wait_s}s)")

        # ── MS Store / AIT 세로: 636x1048, 최소 4장 ─────────────────────
        print("[shots_store] mobile 636x1048 x4")
        for i, tag in enumerate(ORDER, start=1):
            q, wait_s = state_by_tag[tag]
            png, errs = capture_state(pw, base, 636, 1048, True, q, wait_s)
            all_errs += errs
            p = OUTDIR / f"mobile-{i}_{tag}.png"
            p.write_bytes(png)
            saved.append(p)
            print(f"  mobile-{i}_{tag}.png  (waited {wait_s}s)")

        # ── AIT 가로 썸네일: 1932x828, 1장 (grow 상태 - 중간 크기로 자란
        #    뱀이 눈에 잘 띄고, 아직 순위표가 복잡해지기 전이라 썸네일에 적합) ──
        print("[shots_store] AIT wide 1932x828 x1")
        q, wait_s = state_by_tag["grow"]
        png, errs = capture_state(pw, base, 1932, 828, False, q, wait_s)
        all_errs += errs
        p = OUTDIR / "ait-wide-1932x828.png"
        p.write_bytes(png)
        saved.append(p)
        print(f"  ait-wide-1932x828.png  (waited {wait_s}s)")

    httpd.shutdown()

    # ── 실측 검증: 전량 PIL 로 열어 실제 해상도를 대조 ──────────────────
    expect = {}
    for i, tag in enumerate(ORDER, start=1):
        expect[f"desktop-{i}-{tag}.png"] = (1920, 1080)
        expect[f"mobile-{i}_{tag}.png"] = (636, 1048)
    expect["ait-wide-1932x828.png"] = (1932, 828)

    print("\n[shots_store] 실측 해상도 (PIL) ──────────────────────────────")
    mismatches = []
    for p in saved:
        with Image.open(p) as im:
            size = im.size
        want = expect[p.name]
        ok = "OK" if size == want else "MISMATCH"
        if size != want:
            mismatches.append((p.name, size, want))
        print(f"  {p.name:36s} {size[0]}x{size[1]}  (want {want[0]}x{want[1]})  {ok}")

    if all_errs:
        print("\n★ 콘솔/페이지 에러:", all_errs)

    if mismatches:
        print(f"\n★ 규격 불일치 {len(mismatches)}건:")
        for name, got, want in mismatches:
            print(f"  {name}: got {got}, want {want}")
        return 1

    print(f"\n총 {len(saved)}장, 전량 규격 일치. 콘솔 에러 {len(all_errs)}건.")
    return 0 if not all_errs else 1


if __name__ == "__main__":
    sys.exit(main())
