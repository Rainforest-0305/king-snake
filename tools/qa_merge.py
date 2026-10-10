# -*- coding: utf-8 -*-
"""qa_merge.py - 3개 레인 «병합 후» 합동 검증.

레인마다 자기 것만 봤다. 합쳐 놓으면 서로를 깨뜨릴 수 있어서 «합친 상태»를
한 번 더 본다. 특히 이 셋이 한 화면에서 만난다:
  밸런스(오브가 커지고 많아짐) x UI(킬 피드 재작성) x 이름(한글 봇)

★한국어 로케일로 찍는다 - 주 시장이 한국이고, 한글은 라틴보다 넓어서
  «잘림»은 한국어에서만 드러난다.
★headless 고정. President 가 같은 컴퓨터에서 업무 중이라 창을 띄우지 않는다.
"""
from __future__ import annotations

import http.server
import socketserver
import sys
import threading
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
OUT = ROOT / "qa" / "merge"
OUT.mkdir(parents=True, exist_ok=True)

if not DIST.exists():
    print("dist/ 없음 - npm run build:web 먼저 돌려라")
    sys.exit(1)

HANGUL_LO = "가"
HANGUL_HI = "힣"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(DIST), **k)

    def log_message(self, *a):
        pass


srv = socketserver.TCPServer(("127.0.0.1", 0), Handler)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

from playwright.sync_api import sync_playwright  # noqa: E402

W, H = 390, 652
BASE = "http://127.0.0.1:%d/" % PORT
fails = []
errs = []


def on_console(m):
    if m.type == "error":
        errs.append(m.text)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    try:
        ctx = browser.new_context(
            viewport={"width": W, "height": H},
            locale="ko-KR",
            has_touch=True,
            is_mobile=True,
        )

        pg = ctx.new_page()
        pg.on("console", on_console)
        pg.goto(BASE, wait_until="networkidle")
        pg.wait_for_timeout(800)
        pg.screenshot(path=str(OUT / "1_title_ko.png"))

        # 첫 프레임에 터치 컨트롤이 보이는가 (President 지시: 모바일 특화)
        hint = pg.evaluate(
            "() => (document.querySelector('.p-howto, [class*=howto]')||{}).textContent || ''"
        )
        print("메뉴 조작법 문구: %r" % hint)
        if "마우스" in hint:
            fails.append("모바일 컨텍스트인데 조작법이 마우스 문구다: %r" % hint)

        # 데모 모드 - 봇끼리 충돌해 킬 피드가 쌓이는 화면
        pg2 = ctx.new_page()
        pg2.on("console", on_console)
        pg2.goto(BASE + "?demo=1&seed=7", wait_until="networkidle")
        pg2.wait_for_timeout(10000)
        pg2.screenshot(path=str(OUT / "2_hud_killfeed_ko.png"))

        feed = pg2.eval_on_selector_all(
            ".feed-item", "ns => ns.map(n => n.textContent)"
        )
        print("킬 피드 실측: %r" % (feed,))
        if not feed:
            print("  (이번 시드에서 킬이 안 났다 - 문구 판정 보류)")
        elif any(">" in f for f in feed):
            fails.append("킬 피드에 부등호가 남아 있다: %r" % feed)

        # 봇 이름에 한글이 섞였는가
        board = pg2.evaluate(
            """() => {
              const out = [];
              document.querySelectorAll('[class*=lb], [class*=board]').forEach(n => {
                const t = (n.textContent || '').trim();
                if (t) out.push(t);
              });
              return out.slice(0, 40);
            }"""
        )
        joined = " ".join(board)
        ko_hits = sum(1 for c in joined if HANGUL_LO <= c <= HANGUL_HI)
        print("순위표 텍스트 한글 문자 %d개" % ko_hits)
        if board and ko_hits == 0:
            fails.append("한국어 로케일인데 순위표에 한글이 0자다 (봇 이름 미반영 의심)")

        # 가로 넘침
        ov = pg2.evaluate(
            """() => {
              const bad = [];
              document.querySelectorAll('.feed-item, [class*=lb-]').forEach(n => {
                const r = n.getBoundingClientRect();
                if (r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5)) {
                  bad.push(n.className + '|' + (n.textContent || '').slice(0, 30));
                }
              });
              return bad;
            }"""
        )
        if ov:
            fails.append("가로 넘침: %r" % ov)

        ctx.close()
    finally:
        browser.close()

srv.shutdown()

if errs:
    fails.append("콘솔 에러: %r" % errs[:5])

print()
if fails:
    print("[FAIL] %d건" % len(fails))
    for f in fails:
        print("  - " + f)
    sys.exit(1)
print("[PASS] 병합 검증 통과. 스크린샷: %s" % OUT)
