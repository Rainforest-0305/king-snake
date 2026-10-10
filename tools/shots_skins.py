# -*- coding: utf-8 -*-
"""shots_skins.py - 고급 스킨 2종 + 요건 UI 실렌더. headless 고정, 창 0.

  python tools/shots_skins.py <distDir> <outTag> [--locale ko]

★ 운영 광고를 «렌더하지 않는다». 외부 네트워크는 route 로 전면 차단하고
  막힌 요청 목록을 증거로 남긴다.
★ 찍는 것: 레일 끝(최고급 2종) · 최고급 스킨 히어로(특수 기능 줄) ·
  진행도 버튼(광고 누적) · 큰 미리보기 확대.
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
VIEW = {"width": 390, "height": 844}

SAVE = {
    "v": 1, "savedAt": 0, "bestScore": 20847, "bestRank": 1, "games": 5,
    "totalKills": 18, "playSeconds": 900, "nick": "리미", "skin": "corn",
    "control": "joystick", "sound": True, "locale": "ko",
}


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
    tag = sys.argv[2]
    loc = sys.argv[sys.argv.index("--locale") + 1] if "--locale" in sys.argv else "ko"
    out = ROOT / "_skins_evidence_260902" / "shots" / tag
    out.mkdir(parents=True, exist_ok=True)
    port, srv = serve(dist)
    ext, errs = [], []
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(headless=True)
            ctx = br.new_context(viewport=VIEW, device_scale_factor=3,
                                 locale="ko-KR", has_touch=True, is_mobile=True)

            def guard(route):
                u = route.request.url
                if u.startswith("http://127.0.0.1:%d" % port) or u.startswith("data:"):
                    return route.continue_()
                ext.append(u)
                return route.abort()

            ctx.route("**/*", guard)
            page = ctx.new_page()
            page.on("console", lambda m: errs.append(m.type + ": " + m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
            sv = dict(SAVE)
            sv["locale"] = loc
            page.add_init_script("localStorage.setItem('king-snake.save', %s)"
                                 % json.dumps(json.dumps(sv)))
            page.goto("http://127.0.0.1:%d/index.html?debug=1&quiet=1" % port, wait_until="load")
            page.wait_for_timeout(1400)

            # 레일 끝으로 — 최고급 2종이 거기 있다.
            page.evaluate("() => { const r = document.querySelector('.skin-rail'); r.scrollLeft = r.scrollWidth; }")
            page.wait_for_timeout(500)
            rail = page.query_selector(".p-skin")
            if rail:
                rail.screenshot(path=str(out / "rail_end.png"))

            info = page.evaluate("""() => {
              const cells = Array.from(document.querySelectorAll('.skin-rail .skin-cell'));
              return cells.slice(-3).map((c) => ({
                name: c.querySelector('.skin-cap').textContent,
                lock: c.querySelector('.lock').textContent,
                disabled: c.querySelector('.skin').disabled,
                premium: c.querySelector('.skin').classList.contains('is-premium'),
                aria: c.querySelector('.skin').getAttribute('aria-label'),
              }));
            }""")
            (out / "cards.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps(info, ensure_ascii=False, indent=2))


            # 최고급 스킨을 «장착»한 상태의 히어로(특수 기능 줄).
            # ★ 새 페이지를 «새 init script»로 연다. 같은 페이지를 reload 하면
            #   위의 add_init_script 가 매번 save 를 덮어써서 장착이 사라진다
            #   (처음에 그렇게 만들었다가 equipped=corn 으로 실패했다).
            for sid in ("rhinoviper", "bluecoral"):
                sv2 = dict(SAVE)
                sv2["locale"] = loc
                sv2["skin"] = sid
                sv2["bestScore"] = 100000
                p2 = ctx.new_page()
                p2.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
                p2.on("console", lambda m: errs.append(m.type + ": " + m.text) if m.type == "error" else None)
                p2.add_init_script("localStorage.setItem('king-snake.save', %s);"
                                   "localStorage.setItem('king-snake.adwatch.v1', %s);"
                                   % (json.dumps(json.dumps(sv2)),
                                      json.dumps(json.dumps({"v": 1, "total": 100,
                                                             "bySurface": {"skinProgress": 100}}))))
                p2.goto("http://127.0.0.1:%d/index.html?debug=1&quiet=1" % port, wait_until="load")
                p2.wait_for_timeout(1400)
                blk = p2.query_selector(".p-skin")
                if blk:
                    blk.screenshot(path=str(out / ("hero_" + sid + ".png")))
                st = p2.evaluate("() => window.__coilSkins.state()")
                (out / ("state_" + sid + ".json")).write_text(
                    json.dumps(st, ensure_ascii=False, indent=2), encoding="utf-8")
                print(sid, "ability=", st["ability"], "equipped=", st["equipped"],
                      "adWatch=", st["adWatch"]["total"])
                p2.close()

            page.screenshot(path=str(out / "menu_full.png"))
            (out / "console.json").write_text(
                json.dumps({"errors": errs, "externalBlocked": ext}, ensure_ascii=False, indent=2),
                encoding="utf-8")
            print("console errors:", len(errs), errs[:4])
            print("external blocked:", len(ext))
            ctx.close()
            br.close()
    finally:
        srv.shutdown()
        srv.server_close()
    print("saved ->", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
