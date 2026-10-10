"""shots_ui.py - 메뉴 화면 / 결과(사망) 화면 스토어 스크린샷 촬영.

tools/shots.py 는 ?demo=1 로 «게임 플레이 중» 화면만 찍는다(수정 금지 대상이라
이 스크립트를 별도로 새로 만들었다). 메뉴와 결과 화면은 데모 모드가 아니라
정상 모드에서 실제 UI 상태 전환을 거쳐야 나온다:
  - 메뉴: 그냥 로드하면 이미 떠 있다(Shell 생성자가 showMenu() 를 호출한다).
  - 결과: 정상 모드로 로드 -> 플레이 시작 버튼(.p-play) 클릭 -> 캐릭터가
    죽어 결과 오버레이(.result-cause 를 담은 .overlay)가 나타날 때까지 폴링.

★ ?debug=1 은 진단 오버레이를 그리므로 스토어 스크린샷에 쓰면 안 된다
  (src/main.ts: `if (debug) drawDebug(...)`). 이 스크립트는 debug 파라미터를
  아예 붙이지 않는다.

뷰포트는 shots.py --store 와 동일:
  데스크톱 1920x1080 (wide) / 모바일 636x1048 (narrow)

실행 (먼저 npm run build:web 로 dist/ 가 있어야 한다):
  python tools/shots_ui.py

산출물: store/screenshots/desktop-{title,result}.png, mobile-{title,result}.png
  (최종 파일명 정리는 이 스크립트 밖에서 수행 — README/작업지시 참고)
"""

from __future__ import annotations

import http.server
import socketserver
import sys
import threading
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright, Page
except ImportError:
    print("playwright 가 없다: pip install playwright && playwright install chromium")
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
OUT = ROOT / "store" / "screenshots"

# shots.py --store 와 동일한 고정 규격(기존 5종 실측 근거는 shots.py 주석 참고).
CASES = [
    ("desktop", 1920, 1080, False),
    ("mobile", 636, 1048, True),
]

RESULT_POLL_MS = 90_000
RESULT_POLL_STEP_MS = 500

# 결과 화면 판정: buildDeath() 가 만드는 .result-cause 는 죽음 오버레이에만
# 있다(일시정지 오버레이는 .result-title 만 공유하고 .result-cause 는 없다
# - src/ui/shell.ts buildPause/buildDeath 실측). 그 조상 .overlay 가
# 'hidden' 클래스를 잃으면(showDeath() 가 remove('hidden') 함) 화면에 뜬 것이다.
RESULT_VISIBLE_JS = """
() => {
  const el = document.querySelector('.result-cause');
  if (!el) return false;
  const ov = el.closest('.overlay');
  return !!ov && !ov.classList.contains('hidden');
}
"""


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


def shoot_menu(page: Page, base: str, path: Path) -> None:
    # ★ ?debug 파라미터 자체를 붙이지 않는다(작업지시: "?debug=1을 쓰지 말 것").
    page.goto(base + "/", wait_until="load")
    # 브랜드 마크(canvas)·메뉴 배경 월드가 첫 몇 프레임 안에 자리잡도록 소폭 대기.
    page.wait_for_timeout(1500)
    page.screenshot(path=str(path))


def shoot_result(page: Page, base: str, path: Path) -> str:
    page.goto(base + "/", wait_until="load")
    page.wait_for_timeout(500)
    play_btn = page.locator(".p-play")
    play_btn.wait_for(state="visible", timeout=10_000)
    play_btn.click()

    try:
        page.wait_for_function(RESULT_VISIBLE_JS, timeout=RESULT_POLL_MS, polling=RESULT_POLL_STEP_MS)
    except Exception as exc:  # noqa: BLE001 - playwright TimeoutError 등
        page.screenshot(path=str(path.with_name(path.stem + "_TIMEOUT_DEBUG.png")))
        return f"TIMEOUT: {path.name} 결과 화면이 {RESULT_POLL_MS/1000:.0f}초 안에 뜨지 않음 ({exc})"

    # showDeath() 는 사망 연출(0.7s) 뒤 호출되고, 내부에서 텍스트/배지 애니메이션이
    # 추가로 뜬다. 오버레이가 막 보이기 시작한 프레임을 찍지 않도록 소폭 대기.
    page.wait_for_timeout(500)
    page.screenshot(path=str(path))
    return ""


def main() -> int:
    if not (DIST / "index.html").exists():
        print("dist 가 없다. 먼저: npm run build:web")
        return 2

    OUT.mkdir(parents=True, exist_ok=True)
    port, httpd = serve()
    base = f"http://127.0.0.1:{port}"

    errors: list[str] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for tag, w, h, mobile in CASES:
            ctx = browser.new_context(
                viewport={"width": w, "height": h},
                device_scale_factor=1,
                is_mobile=mobile,
                has_touch=mobile,
                locale="en-US",
            )

            page = ctx.new_page()
            menu_path = OUT / f"{tag}-title.png"
            print(f"[shots_ui] {tag} title  {w}x{h}")
            shoot_menu(page, base, menu_path)
            page.close()

            page = ctx.new_page()
            result_path = OUT / f"{tag}-result.png"
            print(f"[shots_ui] {tag} result {w}x{h} (up to {RESULT_POLL_MS/1000:.0f}s poll)")
            err = shoot_result(page, base, result_path)
            if err:
                errors.append(err)
            else:
                print(f"  -> {result_path.name} 저장")
            page.close()

            ctx.close()
        browser.close()
    httpd.shutdown()

    if errors:
        print("\n★ 실패:")
        for e in errors:
            print("  -", e)
        return 1

    print("\ntitle/result 스크린샷 완료.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
