# -*- coding: utf-8 -*-
"""qa_ios_guard.py — 2026-09-07 실사고 대응 «방어 셋»이 실제로 도는지 잰다.

  python tools/qa_ios_guard.py <distDir> <tag>

세 가지를 «실제 hit-test 를 타는» CDP 터치로 잰다(합성 dispatch 아님):

  ① 팬 차단   조종 중 window touchmove 가 preventDefault 되는가
              → iOS 네이티브가 제스처를 가져가는 것을 막는 유일한 수단
  ② 스크롤 살아있음  메뉴 스크롤 영역의 touchmove 는 «막히지 않는가»
              → ①을 과하게 걸면 메뉴가 통째로 안 스크롤된다
  ③ pointercancel 폴백  포인터가 끊겨도 조향이 «이어지는가»
              ⚠ 진짜 iOS 취소를 만들 수 없어 pointercancel 을 «합성»으로
                넣는다. 이건 실기기 재현이 아니라 «폴백 코드 경로 검증»이다.
                (합성이라는 사실을 숨기지 않는다.)

★ 헤드리스 전용. 창을 절대 띄우지 않는다.
"""
from __future__ import annotations

import http.server
import json
import math
import socketserver
import sys
import threading
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_joyfix_260907"
VW, VH = 390, 844
SAVE = {"v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
        "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
        "control": "joystick", "sound": False, "locale": None}

# 우리 캡처 리스너보다 «뒤»(버블)에서 defaultPrevented 를 읽는다.
WATCH = """() => {
  window.__pv = { n: 0, prevented: 0, last: '-' };
  addEventListener('touchmove', (e) => {
    window.__pv.n++;
    if (e.defaultPrevented) window.__pv.prevented++;
    const t = e.target;
    window.__pv.last = t && t.tagName
      ? t.tagName.toLowerCase() + (t.id ? '#' + t.id : '')
        + (typeof t.className === 'string' && t.className
           ? '.' + t.className.trim().split(/\\s+/)[0] : '')
      : String(t);
  }, { passive: true, capture: false });
}"""
RESET = "() => { window.__pv.n = 0; window.__pv.prevented = 0; }"


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
    tag = sys.argv[2] if len(sys.argv) > 2 else "guard"
    port, srv = serve(dist)
    res = {}
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(headless=True)
            ctx = b.new_context(viewport={"width": VW, "height": VH},
                                device_scale_factor=2, is_mobile=True,
                                has_touch=True, locale="ko-KR")
            ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                                % json.dumps(json.dumps(SAVE, ensure_ascii=False)))
            page = ctx.new_page()
            page.goto("http://127.0.0.1:%d/?debug=1&quiet=1&seed=7" % port,
                      wait_until="load")
            page.wait_for_timeout(900)
            page.evaluate(WATCH)
            cdp = ctx.new_cdp_session(page)
            down = {"v": False}

            def touch(kind, pts):
                if kind == "touchStart":
                    down["v"] = True
                elif kind in ("touchEnd", "touchCancel"):
                    if not down["v"]:
                        return
                    down["v"] = False
                elif kind == "touchMove" and not down["v"]:
                    return
                cdp.send("Input.dispatchTouchEvent", {
                    "type": kind,
                    "touchPoints": [{"x": float(x), "y": float(y), "id": i}
                                    for i, (x, y) in pts]})

            # ── ② 먼저: 메뉴 스크롤이 «살아 있는가» (게임 시작 전) ──
            page.evaluate(RESET)
            ov = page.evaluate("""() => {
              const vis = (e) => !!e && e.getClientRects().length > 0;
              const o = [...document.querySelectorAll('.overlay')].find(vis);
              if (!o) return null;
              const r = o.getBoundingClientRect();
              return [r.x + r.width / 2, r.y + r.height * 0.6];
            }""")
            if ov:
                touch("touchStart", [(0, (ov[0], ov[1]))])
                page.wait_for_timeout(60)
                for i in range(1, 7):
                    touch("touchMove", [(0, (ov[0], ov[1] - 12 * i))])
                    page.wait_for_timeout(30)
                touch("touchEnd", [])
            pv = page.evaluate("() => window.__pv")
            res["menu_scroll"] = dict(pv)

            # ── 판 시작 ──
            btn = page.query_selector("button.p-play")
            if btn:
                r = btn.bounding_box()
                touch("touchStart", [(0, (r["x"] + r["width"] / 2,
                                          r["y"] + r["height"] / 2))])
                page.wait_for_timeout(60)
                touch("touchEnd", [])
            page.wait_for_timeout(900)
            res["mode"] = page.evaluate("() => window.__coil.state().mode")
            page.evaluate("() => window.__coil.ghost(900)")

            # ── ① 조종 중 window touchmove 가 막히는가 ──
            page.evaluate(RESET)
            o = (170.0, 560.0)
            touch("touchStart", [(0, o)])
            page.wait_for_timeout(100)
            for i in range(1, 9):
                d = 110.0 * i / 8
                touch("touchMove", [(0, (o[0] + math.cos(-2.2) * d,
                                         o[1] + math.sin(-2.2) * d))])
                page.wait_for_timeout(30)
            pv = page.evaluate("() => window.__pv")
            st = page.evaluate("() => ({s: window.__coil.stick(), d: window.__coil.diag()})")
            res["steer_block"] = dict(pv)
            res["steer_block"]["aim"] = st["s"]["aim"]

            # ── ③ pointercancel 폴백 (합성 취소 뒤에도 조향이 이어지는가) ──
            before = st["d"]["steerUpdates"]
            page.evaluate("""() => {
              const cv = document.getElementById('stage');
              const id = window.__coil.diag().steerId;
              cv.dispatchEvent(new PointerEvent('pointercancel', {
                pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true }));
            }""")
            page.wait_for_timeout(120)
            mid = page.evaluate("() => window.__coil.diag()")
            # 취소 «후에도» 손가락은 붙어 있다 — 계속 민다.
            for i in range(1, 7):
                touch("touchMove", [(0, (o[0] + math.cos(-0.6) * (60 + 12 * i),
                                         o[1] + math.sin(-0.6) * (60 + 12 * i)))])
                page.wait_for_timeout(35)
            after = page.evaluate("() => ({s: window.__coil.stick(), d: window.__coil.diag()})")
            res["cancel_fallback"] = {
                "shadow_after_cancel": mid["shadow"],
                "steerId_after_cancel": mid["steerId"],
                "pCancel": after["d"]["pCancel"],
                "steerUpdates_before": before,
                "steerUpdates_after": after["d"]["steerUpdates"],
                "aim_after": after["s"]["aim"],
                "stick_after": after["s"]["active"],
            }
            touch("touchEnd", [])
            page.wait_for_timeout(150)
            res["after_release"] = page.evaluate(
                "() => { const d = window.__coil.diag();"
                " return { steerId: d.steerId, shadow: d.shadow, aim: d.aim }; }")
            ctx.close()
            b.close()
    finally:
        srv.shutdown()

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / ("ios_guard_%s.json" % tag)).write_text(
        json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")

    m, s, c, a = (res["menu_scroll"], res["steer_block"],
                  res["cancel_fallback"], res["after_release"])
    ok1 = s["n"] > 0 and s["prevented"] == s["n"] and s["aim"] is not None
    ok2 = m["n"] == 0 or m["prevented"] == 0
    ok3 = (c["shadow_after_cancel"] == 1 and c["steerId_after_cancel"] >= 0
           and c["steerUpdates_after"] > c["steerUpdates_before"]
           and c["aim_after"] is not None)
    ok4 = a["steerId"] == -1 and a["shadow"] == 0

    print("== iOS 방어 셋 검사 [%s]  (판=%s)" % (tag, res["mode"]))
    print("  ① 조종 중 팬 차단     touchmove %d건 중 %d건 막힘  aim=%s   %s"
          % (s["n"], s["prevented"],
             "null" if s["aim"] is None else "%.2f" % s["aim"],
             "OK" if ok1 else "<-- 실패"))
    print("  ② 메뉴 스크롤 살아있음 touchmove %d건 중 %d건 막힘 (0이어야 정상) %s  target=%s"
          % (m["n"], m["prevented"], "OK" if ok2 else "<-- 실패", m["last"]))
    print("  ③ pointercancel 폴백  shadow=%s steerId=%s pc=%s  move %d→%d  aim=%s  %s"
          % (c["shadow_after_cancel"], c["steerId_after_cancel"], c["pCancel"],
             c["steerUpdates_before"], c["steerUpdates_after"],
             "null" if c["aim_after"] is None else "%.2f" % c["aim_after"],
             "OK" if ok3 else "<-- 실패"))
    print("  ④ 손 떼면 정리        steerId=%s shadow=%s   %s"
          % (a["steerId"], a["shadow"], "OK" if ok4 else "<-- 실패"))
    print("  판정: %s" % ("합격" if (ok1 and ok2 and ok3 and ok4) else "불합격"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
