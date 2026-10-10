"""qa_ui.py - UI 화면 실렌더 캡처 + 구조 검사.

★ 「UI 를 고쳤다」의 증거는 스크린샷이다. 다만 스크린샷만으로는
  「금지 패턴을 실제로 안 쓰는가」를 보증하지 못한다. 그래서 두 가지를 같이 한다:
    1) 각 화면 캡처(메뉴 / 게임 / 일시정지 / 결과) x (데스크톱 / 모바일)
    2) 라이브 DOM 을 훑어 «금지 패턴 자동 검사»
       - backdrop-filter 사용 0
       - background-clip:text (그라디언트 텍스트) 0
       - text-transform:uppercase + letter-spacing (eyebrow) 0
       - 터치 타깃 44x44 미만인 상호작용 요소 0
       - 화면 밖으로 넘치는 텍스트 0
       - 겹치는 HUD 요소 0

실행:
  python tools/qa_ui.py
"""

from __future__ import annotations

import http.server
import json
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
OUT = ROOT / "qa" / "ui"


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


# 라이브 DOM 금지패턴 검사. 계산된 스타일을 보므로 CSS 를 grep 하는 것보다 정확하다.
AUDIT = """() => {
  const out = { blur: [], gradientText: [], eyebrow: [], smallTargets: [], overflow: [] };
  const nodes = Array.from(document.querySelectorAll('*'));
  for (const n of nodes) {
    const cs = getComputedStyle(n);
    const id = (n.tagName + '.' + (n.className || '')).slice(0, 60);

    const bf = cs.backdropFilter || cs.webkitBackdropFilter;
    if (bf && bf !== 'none') out.blur.push(id);

    const clip = cs.webkitBackgroundClip || cs.backgroundClip;
    if (clip === 'text' && cs.backgroundImage && cs.backgroundImage !== 'none') {
      out.gradientText.push(id);
    }

    // eyebrow = 작은 대문자 + 넓은 자간
    const fs = parseFloat(cs.fontSize);
    const ls = parseFloat(cs.letterSpacing);
    if (cs.textTransform === 'uppercase' && fs <= 13 && !isNaN(ls) && ls > 0.4) {
      out.eyebrow.push(id + ' ' + fs + 'px ls' + ls);
    }

    // 터치 타깃(보이는 상호작용 요소만)
    const tag = n.tagName;
    const interactive = tag === 'BUTTON' || tag === 'SELECT' || tag === 'INPUT' || tag === 'A';
    if (interactive) {
      const r = n.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44)) {
        out.smallTargets.push(id + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      }
    }

    // 가로 넘침
    if (n.scrollWidth > n.clientWidth + 2 && cs.overflowX === 'visible' && n.clientWidth > 0) {
      out.overflow.push(id + ' ' + n.scrollWidth + '>' + n.clientWidth);
    }
  }
  return out;
}"""

# HUD 요소끼리 겹치는지 - 좌표로 «실측»한다.
OVERLAP = """() => {
  const sel = ['.hud-score', '.hud-board', '.hud-feed', '.hud-pause'];
  const rects = sel.map(s => {
    const n = document.querySelector(s);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return r.width > 0 ? { s, x: r.x, y: r.y, w: r.width, h: r.height } : null;
  }).filter(Boolean);
  const hits = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 2 && oy > 2) hits.push(a.s + ' x ' + b.s + ' (' + Math.round(ox) + 'x' + Math.round(oy) + ')');
    }
  }
  return hits;
}"""


def run_case(pw, base, tag, w, h, mobile, locale):
    browser = pw.chromium.launch(args=["--enable-gpu", "--use-gl=angle"])
    ctx = browser.new_context(
        viewport={"width": w, "height": h},
        device_scale_factor=2 if mobile else 1,
        is_mobile=mobile, has_touch=mobile, locale=locale,
    )
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    page.goto(f"{base}/?debug=1", wait_until="load")
    page.wait_for_timeout(1500)
    page.screenshot(path=str(OUT / f"{tag}_1_menu.png"))
    audit_menu = page.evaluate(AUDIT)

    # 게임
    if mobile:
        page.tap("button.btn-primary")
    else:
        page.click("button.btn-primary")
    page.wait_for_timeout(1200)
    # 길게 키워서 HUD 숫자가 자릿점까지 나오게
    page.evaluate("() => window.__coil.grow(1483)")
    page.wait_for_timeout(900)
    page.screenshot(path=str(OUT / f"{tag}_2_game.png"))
    overlap = page.evaluate(OVERLAP)
    audit_game = page.evaluate(AUDIT)

    # 일시정지
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUT / f"{tag}_3_pause.png"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)

    # 결과
    page.evaluate("() => window.__coil.kill()")
    page.wait_for_timeout(1400)
    page.screenshot(path=str(OUT / f"{tag}_4_result.png"))
    audit_death = page.evaluate(AUDIT)

    ctx.close()
    browser.close()

    merged = {}
    for k in audit_menu:
        merged[k] = sorted(set(audit_menu[k] + audit_game[k] + audit_death[k]))
    merged["hudOverlap"] = overlap
    merged["consoleErrors"] = errors
    return merged


def main() -> int:
    if not (DIST / "index.html").exists():
        print("dist 가 없다. 먼저: npm run build:web")
        return 2
    OUT.mkdir(parents=True, exist_ok=True)
    port, httpd = serve()
    base = f"http://127.0.0.1:{port}"

    results = {}
    with sync_playwright() as pw:
        for tag, w, h, mob, loc in (
            ("desktop", 1600, 900, False, "ko-KR"),
            ("mobile", 390, 844, True, "ko-KR"),
            ("mobile_en", 390, 844, True, "en-US"),
        ):
            print(f"[ui] {tag} {w}x{h}")
            results[tag] = run_case(pw, base, tag, w, h, mob, loc)
    httpd.shutdown()

    print(json.dumps(results, ensure_ascii=False, indent=2))
    fails = []
    for tag, r in results.items():
        for k in ("blur", "gradientText", "eyebrow", "smallTargets", "overflow",
                  "hudOverlap", "consoleErrors"):
            if r.get(k):
                fails.append(f"{tag}/{k}: {r[k]}")
    if fails:
        print("\n[FAIL]")
        for f in fails:
            print("  -", f)
        return 1
    print("\n[PASS] 금지 패턴 0건, HUD 겹침 0건, 콘솔 에러 0건.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
