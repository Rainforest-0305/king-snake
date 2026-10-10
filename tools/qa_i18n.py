"""qa_i18n.py - 9개 로케일 UI 실렌더 검사.

★ 번역이 «있다»와 «화면에 들어간다»는 다른 문제다.
  독일어 statsBestRank 는 17자("Beste Platzierung")로 영어의 2배다.
  390px 폭 모바일에서 라벨과 값이 겹치거나 잘리는지는 «렌더해 봐야» 안다.

검사 항목
  1. 잘림(ellipsis) - 실제로 text-overflow 가 발동한 요소
  2. 넘침         - scrollWidth > clientWidth
  3. 줄바꿈 폭주   - 버튼 안 텍스트가 2줄을 넘김
  4. 빈 문자열     - 번역 누락으로 텍스트가 비어 있음
  5. 로케일 전환 후 콘솔 에러

실행: python tools/qa_i18n.py
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
OUT = ROOT / "qa" / "i18n"

LOCALES = ["en", "ko", "ja", "zh-Hans", "es", "pt-BR", "de", "fr", "ru"]


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


AUDIT = """() => {
  const bad = { clipped: [], overflow: [], tallButton: [], empty: [] };
  const sel = '.btn, .seg button, .row-label, .block-label, .kv-k, .kv-v, .brand h1, ' +
              '.brand p, .howto li, .skin-hero-name, .skin-hero-sub, .lang-select, ' +
              '.result-title, .result-cause, .badge, .badge-unlock, .hud-score span, ' +
              '.hud-score b, .standing-row u';
  for (const n of document.querySelectorAll(sel)) {
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = n.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const id = (n.tagName + '.' + (n.className || '')).slice(0, 46);
    const txt = (n.textContent || '').trim();

    if (!txt) { bad.empty.push(id); continue; }

    // 잘림: 실제 콘텐츠 폭이 보이는 폭보다 크면 잘린 것이다.
    if (n.scrollWidth > n.clientWidth + 1) {
      bad.clipped.push(id + ' "' + txt.slice(0, 22) + '" ' + n.scrollWidth + '>' + n.clientWidth);
    }
    // 버튼 안 텍스트가 3줄 이상이면 레이아웃이 무너진 것으로 본다.
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    if ((n.tagName === 'BUTTON') && r.height > lh * 2.4 + 24) {
      bad.tallButton.push(id + ' "' + txt.slice(0, 22) + '" h=' + Math.round(r.height));
    }
  }
  return bad;
}"""


def main() -> int:
    if not (DIST / "index.html").exists():
        print("dist 가 없다. 먼저: npm run build:web")
        return 2
    OUT.mkdir(parents=True, exist_ok=True)
    port, httpd = serve()
    base = f"http://127.0.0.1:{port}"
    results = {}
    failures = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--enable-gpu", "--use-gl=angle"])
        for label, w, h, mobile in (("mobile", 390, 844, True), ("desktop", 1600, 900, False)):
            ctx = browser.new_context(
                viewport={"width": w, "height": h},
                device_scale_factor=1, is_mobile=mobile, has_touch=mobile,
            )
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.goto(f"{base}/?debug=1", wait_until="load")
            page.wait_for_timeout(1200)

            for loc in LOCALES:
                page.select_option(".lang-select", loc)
                page.wait_for_timeout(320)
                menu = page.evaluate(AUDIT)
                if label == "mobile":
                    page.screenshot(path=str(OUT / f"menu_{loc}.png"))

                # 결과 화면도 본다 - 가장 긴 문장이 여기 있다.
                page.evaluate("() => window.__coil.startRun()")
                page.wait_for_timeout(500)
                page.evaluate("() => window.__coil.grow(2480)")
                page.evaluate("() => window.__coil.kill()")
                page.wait_for_timeout(1300)
                death = page.evaluate(AUDIT)
                if label == "mobile":
                    page.screenshot(path=str(OUT / f"result_{loc}.png"))
                page.evaluate("() => window.__coil.toMenu()")
                page.wait_for_timeout(350)

                merged = {}
                for k in menu:
                    merged[k] = sorted(set(menu[k] + death[k]))
                results[f"{label}/{loc}"] = merged
                for k, v in merged.items():
                    if v:
                        failures.append(f"{label}/{loc}/{k}: {v}")
            if errors:
                failures.append(f"{label}/console: {errors[:5]}")
            ctx.close()
        browser.close()
    httpd.shutdown()

    clean = {k: v for k, v in results.items() if any(v.values())}
    print(json.dumps(clean or {"all": "clean"}, ensure_ascii=False, indent=2))
    if failures:
        print("\n[FAIL]")
        for f in failures:
            print("  -", f)
        return 1
    print("\n[PASS] 9개 로케일 x 2개 뷰포트, 잘림/넘침/빈문자열 0건.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
