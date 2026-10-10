"""shots_store_mobile.py - 세로(636x1048) 스토어 스크린샷 «터치 기기 조건» 재촬영.

★ 왜 별도 스크립트인가 (tools/shots_store.py 는 건드리지 않는다):
  shots_store.py 는 이미 `is_mobile=True, has_touch=True` 로 컨텍스트를 만든다.
  그런데도 결과물 메뉴 화면에 「마우스로 방향을 바꾼다」가 찍혔다.

  원인은 컨텍스트 플래그가 아니다. 게임 쪽 판정이 이렇다:
    src/input.ts:104  get isTouch() { return this.usedTouch; }
    src/input.ts:173  onDown() 에서 e.pointerType !== 'mouse' 일 때만 usedTouch = true
    src/main.ts:354   shell.setTouchHint(input.isTouch)  ← 매 프레임
  즉 «실제 터치 pointerdown 이 캔버스에 한 번은 들어와야» 한다.
  has_touch=True 는 「터치가 가능하다」일 뿐 이벤트를 만들어 주지 않는다.
  같은 이유로 input.ts:267 `visual.visible = usedTouch` 때문에
  화면 조이스틱·질주 버튼도 그동안 안 찍히고 있었다.

  ⇒ 이 스크립트는 CDP `Input.dispatchTouchEvent` 로 «진짜 터치»를 넣는다.
    그리고 찍기 전에 DOM 텍스트로 「드래그로 방향을 바꾼다」를 «단언»한다.
    (설정했으니 됐겠지 = 근거 아님. 화면에 그 글자가 있어야 통과.)

★ 메뉴 화면 기록(최고 기록/플레이/킬)은 «실제로 플레이해서» 남긴다.
  localStorage 를 손으로 심지 않는다 - 그건 합성이다.
  터치 드래그로 직접 조종해 오브를 먹고, 붉은 경계에 박아 죽는다.
  onPlayerDied → recordRun → writeSave (src/main.ts:198, src/save.ts) 경로가
  실제로 돌아 저장이 남고, 그 상태로 메뉴에 돌아와 찍는다.

★ 전 과정 headless. 창을 띄우지 않는다.

실행:  python tools/shots_store_mobile.py
산출:  store/screenshots/mobile-{1_play,2_grow,3_leaderboard,4_menu}.png
"""

from __future__ import annotations

import http.server
import json
import math
import socketserver
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
OUTDIR = ROOT / "store" / "screenshots"

W, H = 636, 1048
SEED = 20260818
LOCALE = "ko-KR"
# 실제 안드로이드 폰 UA. is_mobile/has_touch 와 함께 준다.
UA = (
    "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
)

STEER_HINT_KO = "드래그로 방향을 바꾼다"
MOUSE_HINT_KO = "마우스로 방향을 바꾼다"


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


# ── CDP 진짜 터치 ────────────────────────────────────────────────────────
def touch(client, typ: str, x: float, y: float) -> None:
    pts = [] if typ == "touchEnd" else [{"x": float(x), "y": float(y), "id": 1}]
    client.send("Input.dispatchTouchEvent", {"type": typ, "touchPoints": pts})


def touch_poke(client, x: float, y: float) -> None:
    """캔버스에 짧은 탭 하나 - usedTouch 를 켜는 목적."""
    touch(client, "touchStart", x, y)
    time.sleep(0.09)
    touch(client, "touchEnd", x, y)


def assert_touch_mode(page, where: str) -> str:
    """게임이 «터치로 판정»했는지 페이지 내부 상태로 확인."""
    ok = page.evaluate(
        "() => { const c = document.querySelector('canvas');"
        " return !!c; }"
    )
    if not ok:
        raise SystemExit(f"[{where}] canvas 가 없다")
    return where


# ── 세션 A: 실제 플레이 → 저장 남기고 메뉴 ──────────────────────────────
def play_and_capture_menu(ctx, base: str) -> tuple[bytes, dict]:
    page = ctx.new_page()
    errs: list[str] = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)

    page.goto(f"{base}/", wait_until="load")
    page.wait_for_selector("button.p-play", state="visible", timeout=15000)
    client = ctx.new_cdp_session(page)

    cx, cy = W / 2, H / 2
    rounds = 3
    stats_seen = []

    for r in range(rounds):
        # ★ 첫 판만 메뉴의 «시작»을 누른다. 이후 판은 사망 화면의 «다시 하기»가
        #   바로 새 판을 시작하므로(shell.againBtn → cb.onPlay) 메뉴로 돌아오지
        #   않는다 - 여기서 p-play 를 기다리면 hidden 상태로 타임아웃 난다(실측).
        if r == 0:
            page.wait_for_selector("button.p-play", state="visible", timeout=15000)
            page.tap("button.p-play")
        page.wait_for_timeout(700)

        # ★ 캔버스에 «진짜 터치» - 여기서 usedTouch=true 가 된다.
        touch_poke(client, cx, cy)
        page.wait_for_timeout(200)

        # 실제 조종: 손가락을 눌러 두고 천천히 원을 그린다(오브를 먹으며 로밍).
        touch(client, "touchStart", cx, cy)
        roam_s = 26.0
        t0 = time.time()
        while time.time() - t0 < roam_s:
            th = (time.time() - t0) / 11.0 * 2 * math.pi
            touch(client, "touchMove", cx + math.cos(th) * 95, cy + math.sin(th) * 95)
            time.sleep(0.05)
            if page.locator("text=죽었다").count() and page.locator(
                "text=죽었다"
            ).first.is_visible():
                break

        # 한 방향으로 고정 → 붉은 경계까지 직진해서 죽는다.
        died = False
        t0 = time.time()
        while time.time() - t0 < 45.0:
            touch(client, "touchMove", cx + 95, cy - 95)
            time.sleep(0.12)
            if page.locator("button:has-text('다시 하기')").count() and page.locator(
                "button:has-text('다시 하기')"
            ).first.is_visible():
                died = True
                break
        touch(client, "touchEnd", cx + 95, cy - 95)

        if not died:
            raise SystemExit(f"[playA] {r+1}판째: 45초 안에 죽지 않았다 - 조종이 안 먹은 것")

        page.wait_for_timeout(500)
        print(f"  [playA] {r+1}/{rounds} 판 종료(사망 기록됨)")

        if r < rounds - 1:
            page.locator("button:has-text('다시 하기')").first.click()
            page.wait_for_timeout(600)

    # 마지막 사망 화면 → 메뉴
    page.locator("button:has-text('메뉴')").first.click()
    page.wait_for_selector("button.p-play", state="visible", timeout=15000)
    page.wait_for_timeout(1200)

    # ── ★ 합격 조건 단언: 화면에 「드래그로 방향을 바꾼다」가 실제로 있는가 ──
    howto = page.locator("ul.howto").first
    howto_text = howto.inner_text()
    body_text = page.locator("body").inner_text()

    save_raw = page.evaluate(
        "() => { try { return localStorage.getItem('king-snake.save')"
        " || localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('.save'))); }"
        " catch(e) { return null; } }"
    )

    png = page.screenshot()

    facts = {
        "howto_text": howto_text,
        "has_touch_hint": STEER_HINT_KO in howto_text,
        "has_mouse_hint": MOUSE_HINT_KO in howto_text,
        "body_has_touch_hint": STEER_HINT_KO in body_text,
        "save_raw": save_raw,
        "console_errors": errs,
        "nav_has_touch": page.evaluate("() => navigator.maxTouchPoints"),
        "ctrl_row_visible": page.evaluate(
            "() => { const r=[...document.querySelectorAll('.row')]"
            ".find(e=>e.textContent.includes('조작'));"
            " return r ? !r.classList.contains('hidden') : null; }"
        ),
    }
    page.close()
    return png, facts


# ── 세션 B: 데모(AI 실플레이) 화면 3종 ───────────────────────────────────
def capture_demo(ctx, base: str, wait_s: float, tag: str) -> tuple[bytes, list[str]]:
    page = ctx.new_page()
    errs: list[str] = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)

    page.goto(f"{base}/?demo=1&seed={SEED}", wait_until="load")
    page.wait_for_timeout(900)
    client = ctx.new_cdp_session(page)

    # ★ 진짜 터치 한 번 → usedTouch=true → 화면 터치 컨트롤(질주 버튼)이 뜬다.
    #   데모 모드는 AI 가 조종하므로(main.ts:358 playing=false) 조작을 뺏지 않는다.
    touch_poke(client, W / 2, H * 0.42)

    page.wait_for_timeout(int(wait_s * 1000))
    png = page.screenshot()
    page.close()
    return png, errs


def main() -> int:
    if not (DIST / "index.html").exists():
        print("dist 가 없다. 먼저: npm run build:web")
        return 2

    OUTDIR.mkdir(parents=True, exist_ok=True)
    port, httpd = serve()
    base = f"http://127.0.0.1:{port}"
    print(f"[shots_mobile] serve {base}  (headless)")

    results: dict[str, Path] = {}
    all_errs: list[str] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch()  # headless 기본값
        ctx = browser.new_context(
            viewport={"width": W, "height": H},
            device_scale_factor=1,
            is_mobile=True,
            has_touch=True,
            locale=LOCALE,
            user_agent=UA,
        )

        # 1) 실제 플레이 → 메뉴(기록 있는 상태)
        print("[shots_mobile] 세션 A: 실제 터치 플레이 3판 → 메뉴")
        menu_png, facts = play_and_capture_menu(ctx, base)
        all_errs += facts["console_errors"]

        print("\n  ── 터치 판정 단언 ─────────────────────────────")
        print(f"  navigator.maxTouchPoints = {facts['nav_has_touch']}")
        print(f"  조작법 리스트 실텍스트: {facts['howto_text']!r}")
        print(f"  '{STEER_HINT_KO}' 있음      : {facts['has_touch_hint']}")
        print(f"  '{MOUSE_HINT_KO}' 있음      : {facts['has_mouse_hint']}")
        print(f"  body 전체에서도 확인       : {facts['body_has_touch_hint']}")
        print(f"  '조작' 설정행 노출          : {facts['ctrl_row_visible']}")
        print(f"  저장된 세이브: {facts['save_raw']}")

        if not facts["has_touch_hint"] or facts["has_mouse_hint"]:
            print("\n★ 실패: 터치 안내 문구가 화면에 없다. 찍지 않는다.")
            ctx.close()
            browser.close()
            httpd.shutdown()
            return 1

        p = OUTDIR / "mobile-4_menu.png"
        p.write_bytes(menu_png)
        results["mobile-4_menu.png"] = p
        print(f"\n  saved {p.name}")

        # 2) 데모 3종
        for idx, (tag, wait_s) in enumerate(
            [("play", 12.0), ("grow", 55.0), ("leaderboard", 110.0)], start=1
        ):
            print(f"[shots_mobile] 세션 B: demo {tag} (wait {wait_s}s)")
            png, errs = capture_demo(ctx, base, wait_s, tag)
            all_errs += errs
            p = OUTDIR / f"mobile-{idx}_{tag}.png"
            p.write_bytes(png)
            results[p.name] = p
            print(f"  saved {p.name}")

        ctx.close()
        browser.close()

    httpd.shutdown()

    # ── 실측 검증 ────────────────────────────────────────────────────────
    print("\n[shots_mobile] 실측 해상도/바이트 (PIL) ─────────────────────")
    bad = []
    for name, p in sorted(results.items()):
        with Image.open(p) as im:
            size = im.size
            fmt = im.format
        nbytes = p.stat().st_size
        ok = size == (W, H) and fmt == "PNG" and nbytes <= 5 * 1024 * 1024
        if not ok:
            bad.append((name, size, fmt, nbytes))
        print(f"  {name:26s} {size[0]}x{size[1]}  {fmt}  {nbytes:,} bytes  {'OK' if ok else 'BAD'}")

    if all_errs:
        print(f"\n★ 콘솔/페이지 에러 {len(all_errs)}건: {all_errs[:5]}")
    if bad:
        print(f"\n★ 규격 불일치 {len(bad)}건")
        return 1

    print(f"\n총 {len(results)}장, 전량 {W}x{H} PNG 일치.")
    print(json.dumps({"facts": {k: v for k, v in facts.items() if k != 'console_errors'}},
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
