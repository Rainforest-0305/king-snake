# -*- coding: utf-8 -*-
"""qa_cullproof.py - «몸통 O(1) 컬링이 화면을 바꾸지 않는다»를 같은 프레임 픽셀 대조로 증명. headless.

  같은 페이지에서 월드·렌더 시각을 «고정»(__coil.freeze)한 뒤 컬링 ON → OFF → ON 으로 세 장을 찍어
  A/B, A/C 를 픽셀 대조한다. 차이 0 이어야 한다. 데모 30초(봇 다수·화면 밖 뱀 다수) 시점에서 잰다.

  python tools/qa_cullproof.py <distdir>
산출물: qa/lane12/cullproof/{cull_on,cull_off,cull_on2}.png
"""
from __future__ import annotations
import http.server, socketserver, sys, threading
from pathlib import Path
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "qa" / "lane12" / "cullproof"


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


def diff(a: Path, b: Path) -> str:
    ia, ib = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
    d = ImageChops.difference(ia, ib)
    bbox = d.getbbox()
    mx = max(max(p) for p in d.getdata()) if bbox else 0
    return "identical" if bbox is None else "DIFF bbox=%s max=%d" % (bbox, mx)


def main() -> int:
    dist = Path(sys.argv[1]).resolve()
    OUT.mkdir(parents=True, exist_ok=True)
    port, httpd = serve(dist)
    ok = True
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2,
                            is_mobile=True, has_touch=True, locale="ko-KR")
        pg = ctx.new_page()
        for tag, url, wait in (("demo30", "?demo=1&debug=1&ads=off&seed=4242", 30000),
                               ("stress", "?demo=1&debug=1&ads=off&seed=4242", 20000)):
            pg.goto("http://127.0.0.1:%d/%s" % (port, url), wait_until="load")
            pg.wait_for_timeout(wait)
            if tag == "stress":
                pg.evaluate("() => window.__coil.stress(6, 1200, true, 1200)")
                pg.wait_for_timeout(1500)
            pg.evaluate("() => window.__coil.freeze(true)")
            # DOM HUD(킬 피드 페이드 등)는 대조 대상이 아니다 - 캔버스만 남긴다.
            pg.evaluate("() => { const a = document.getElementById('app'); if (a) a.style.visibility = 'hidden'; }")
            pg.wait_for_timeout(300)
            st = pg.evaluate("() => window.__coilTimes()")
            pg.screenshot(path=str(OUT / f"{tag}_cull_on.png"))
            pg.evaluate("() => window.__coil.setCull(false)")
            pg.wait_for_timeout(300)
            st2 = pg.evaluate("() => window.__coilTimes()")
            pg.screenshot(path=str(OUT / f"{tag}_cull_off.png"))
            pg.evaluate("() => window.__coil.setCull(true)")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(OUT / f"{tag}_cull_on2.png"))
            pg.evaluate("() => window.__coil.freeze(false)")
            pg.evaluate("() => { const a = document.getElementById('app'); if (a) a.style.visibility = ''; }")
            r1 = diff(OUT / f"{tag}_cull_on.png", OUT / f"{tag}_cull_off.png")
            r2 = diff(OUT / f"{tag}_cull_on.png", OUT / f"{tag}_cull_on2.png")
            print("%s: snakes alive %s, drawn(cull on) %s, drawn(cull off) %s | on vs off: %s | on vs on2: %s"
                  % (tag, st.get("snakesAlive"), st.get("snakes"), st2.get("snakes"), r1, r2))
            if r1 != "identical" or r2 != "identical":
                ok = False
        ctx.close()
        b.close()
    httpd.shutdown()
    print("CULLPROOF:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
