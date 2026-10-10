# -*- coding: utf-8 -*-
"""hud_locale_sweep.py - 기록 돌파 배너를 «9로케일 전부» 실렌더해 크기를 잰다.

  python tools/hud_locale_sweep.py <distDir> [<vw> <vh>]

★ 「로케일마다 문자열 길이가 다르다. 고정폭 가정 금지」(CLAUDE.md).
  그 말의 «검증»은 9개를 다 띄워 재는 것이다. 하나만 보고 「작아졌다」고
  말하면 독일어에서 두 배가 되는 것을 못 본다.
★ 재는 것: 배너 사각형 · 줄 수(제목/부제 각각) · 순위표 왼쪽 끝까지 여유 ·
  화면 세로에서 차지하는 위치. headless 고정.
"""
from __future__ import annotations

import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LOCALES = [
    ("ko-KR", None), ("en-US", "en"), ("ja-JP", "ja"), ("zh-CN", "zh-Hans"),
    ("es-ES", "es"), ("pt-BR", "pt-BR"), ("de-DE", "de"), ("fr-FR", "fr"), ("ru-RU", "ru"),
]
SAVE_BASE = {
    "v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
    "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
    "control": "joystick", "sound": True, "locale": None,
}
STUB_OK = {"load": "ok", "show": "reward", "supported": True}

MEASURE = """() => {
  const b = document.querySelector('.rw-offer');
  const r = b.getBoundingClientRect();
  const t = document.querySelector('.rw-offer-title');
  const s = document.querySelector('.rw-offer-sub');
  const board = document.querySelector('.hud-board').getBoundingClientRect();
  const lines = (el) => {
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    return Math.round(el.getBoundingClientRect().height / lh);
  };
  return {
    x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
    bottom: +r.bottom.toFixed(1), right: +r.right.toFixed(1),
    title: t.textContent, sub: s.textContent,
    titleLines: lines(t), subLines: lines(s),
    gapToBoard: +(board.x - r.right).toFixed(1),
    vh: innerHeight, vw: innerWidth,
    fs: { title: getComputedStyle(t).fontSize, sub: getComputedStyle(s).fontSize },
  };
}"""


def serve(d: Path):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(d), **k)

        def log_message(self, *a):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s.server_address[1], s


def main() -> int:
    dist = Path(sys.argv[1]).resolve()
    vw = int(sys.argv[2]) if len(sys.argv) > 3 else 390
    vh = int(sys.argv[3]) if len(sys.argv) > 3 else 844
    port, srv = serve(dist)
    rows = []
    errs: list[str] = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        for locale, lang in LOCALES:
            save = dict(SAVE_BASE)
            save["locale"] = lang
            ctx = b.new_context(viewport={"width": vw, "height": vh}, device_scale_factor=2,
                                is_mobile=True, has_touch=True, locale=locale)
            ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                                % json.dumps(json.dumps(save, ensure_ascii=False)))
            page = ctx.new_page()
            page.on("pageerror", lambda e: errs.append(str(e)))
            page.goto(f"http://127.0.0.1:{port}/?debug=1&quiet=1&seed=7", wait_until="load")
            page.wait_for_timeout(700)
            page.evaluate("(b) => window.__coilAds.installStub(b)", STUB_OK)
            page.evaluate("() => window.__coilReward.refresh()")
            page.evaluate("() => window.__coilReward.setBest(1200)")
            page.evaluate("() => window.__coil.startRun()")
            page.wait_for_timeout(700)
            page.evaluate("() => window.__coil.grow(2100)")   # 2,000 돌파 = 문구가 «가장 긴» 문턱
            page.wait_for_function("() => window.__coilReward.state().offer !== null", timeout=6000)
            page.wait_for_timeout(240)
            m = page.evaluate(MEASURE)
            m["locale"] = lang or "ko"
            rows.append(m)
            ctx.close()
        b.close()
    srv.shutdown()

    print(f"뷰포트 {vw}x{vh} · 문턱 2,000 (문구가 가장 긴 경우)")
    print("=" * 104)
    print(f"{'loc':7s} {'w':>6s} {'h':>6s} {'area':>7s} {'bottom':>7s} {'bot/vh':>7s} "
          f"{'board여유':>8s} {'줄':>4s}  텍스트")
    print("-" * 104)
    worst = 0.0
    for m in rows:
        worst = max(worst, m["h"])
        print(f"{m['locale']:7s} {m['w']:6.1f} {m['h']:6.1f} {m['w']*m['h']:7.0f} "
              f"{m['bottom']:7.1f} {m['bottom']/m['vh']*100:6.1f}% {m['gapToBoard']:8.1f} "
              f"{m['titleLines']}+{m['subLines']:<2d} {m['title']} / {m['sub']}")
    print("-" * 104)
    print(f"최대 높이 {worst:.1f}px · 최소 탭 하한(WCAG 2.2 AA Web) 24px · "
          f"최소 높이 {min(m['h'] for m in rows):.1f}px")
    print("겹침(board 여유 < 0) =", sum(1 for m in rows if m["gapToBoard"] < 0))
    print("화면 아래 절반 침범(bottom > vh/2) =", sum(1 for m in rows if m["bottom"] > m["vh"] / 2))
    print("pageerror:", len(errs), errs[:3])
    return 0


if __name__ == "__main__":
    sys.exit(main())
