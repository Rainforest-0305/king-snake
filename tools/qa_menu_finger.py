# -*- coding: utf-8 -*-
"""qa_menu_finger.py - 메뉴에 손가락을 둔 채 «진짜 시작 버튼»을 탭하면.

  python tools/qa_menu_finger.py <distDir> <tag> [reps]

★ 앞선 qa_resting_finger.py 와 무엇이 다른가
  그건 __coil.startRun() 을 «프로그램으로» 불렀다. 실제 유저는 «버튼을 탭»한다.
  그 차이가 중요한 이유: 탭하는 순간 showGame() 이 메뉴 오버레이에
  display:none 을 걸고(styles.css .hidden), 그때 «다른 손가락»이 그 오버레이
  위에 올라가 있으면 그 손가락의 이벤트 대상이 통째로 사라진다.

  시나리오 D: 손가락0 을 메뉴 위에 얹은 «채로» 손가락1 로 시작 버튼을 탭하고,
              판이 시작된 뒤 손가락0 을 민다. 조종이 되는가?

⚠한계 (반드시 같이 읽어라)
  이 검사는 Chromium 이다. 「iOS WebKit 은 display:none 된 요소의 터치 스트림을
  끊는다」는 가설은 여기서 재현되지 않는다 - Playwright WebKit 은 tap() 만
  지원해 손가락을 «든 채 미는» 제스처를 만들 수 없고 CDP 도 Chromium 전용이다.
  ⇒ 이 검사가 통과해도 iOS 안전을 «증명하지 못한다». 통과는 「Chromium 에서는
    이 시나리오가 안 깨진다」까지만 뜻한다.
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
OUT = ROOT / "_joy_260903"
SAVE = {"v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
        "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
        "control": "joystick", "sound": False, "locale": None}

ST = """() => {
  const s = window.__coil.state();
  const m = document.querySelector('.menu');
  return { aim: s.aim, mode: s.mode, stick: s.stick, diag: window.__coil.diag(),
           menuCls: m ? m.className : null,
           menuDisp: m ? getComputedStyle(m).display : null };
}"""


def serve(d):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(d), **k)

        def log_message(self, *a):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s.server_address[1], s


class Rig:
    """★★ 2026-09-05 정정 — 이 검사기는 «아무것도 재고 있지 않았다».

    두 가지가 동시에 틀려 있었다(tools/_probe_touchids.py·_probe_menufinger.py 실측):

      ① touchEnd 의 touchPoints 의미를 거꾸로 알고 있었다.
         CDP 는 touchEnd 에 «떼는 점»을 받는다(빈 배열 = 전부 뗌).
         「남는 점」이 아니다. 실측:
             touchStart [(0,f0)]              -> changed=[0]  touches=[0]
             touchStart [(0,f0),(1,btn)]      -> changed=[1]  touches=[0,1]
             touchEnd   [(0,f0)]              -> changed=[0]  touches=[1]
         옛 코드의 `send("touchEnd", [f0])` 는 「버튼 손가락만 뗀다」가 아니라
         «얹어 둔 손가락을 떼고 버튼 손가락을 남긴다» = 시나리오가 정반대였다.

      ② 손가락이 «둘» 닿아 있는 동안에는 브라우저가 click 을 합성하지 않는다.
         그래서 시작 버튼을 아무리 탭해도 판이 시작되지 않았다(실측: 탭 뒤에도
         mode='menu'). 검사기는 «메뉴 화면에서 조종되는가»를 재고 「조종불능
         0/10」을 찍고 있었다.

    ⇒ ①은 release() 로, ②는 .click() + mode 확인으로 고쳤다. 시작 «수단»이
      .click() 이어도 재려는 것(판 시작 시점에 손가락이 이미 닿아 있었다)은
      그대로다 — beginRun 은 같은 경로로 돈다.
    """

    def __init__(self, page, cdp):
        self.page, self.cdp = page, cdp

    def send(self, kind, pts):
        """touchStart/touchMove: «지금 닿아 있는 전부». touchEnd: «떼는 점»."""
        self.cdp.send("Input.dispatchTouchEvent", {
            "type": kind,
            "touchPoints": [{"x": float(x), "y": float(y), "id": i}
                            for i, (x, y) in enumerate(pts)]})


def main() -> int:
    dist = Path(sys.argv[1]).resolve()
    tag = sys.argv[2]
    reps = int(sys.argv[3]) if len(sys.argv) > 3 else 10
    port, srv = serve(dist)
    rows = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": 390, "height": 844},
                            device_scale_factor=2, is_mobile=True,
                            has_touch=True, locale="ko-KR")
        ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                            % json.dumps(json.dumps(SAVE, ensure_ascii=False)))
        page = ctx.new_page()
        page.goto("http://127.0.0.1:%d/?debug=1&quiet=1&seed=7" % port,
                  wait_until="load")
        page.wait_for_timeout(900)
        cdp = ctx.new_cdp_session(page)
        rig = Rig(page, cdp)
        page.evaluate("() => window.__coil.startRun()")
        page.wait_for_timeout(500)

        for _ in range(reps):
            page.evaluate("() => window.__coil.toMenu()")
            page.wait_for_timeout(600)
            f0 = (150.0, 600.0)                     # 메뉴 위에 «얹어 둔» 손가락
            rig.send("touchStart", [f0])
            page.wait_for_timeout(150)
            # ★ 멀티터치 중에는 click 이 합성되지 않는다(위 Rig 주석 ②). 그래서
            #   버튼은 .click() 으로 누른다 — 재려는 것은 «시작 수단»이 아니라
            #   「판이 시작될 때 손가락이 이미 닿아 있었는가」다.
            page.evaluate("() => (document.querySelector('button.p-play')"
                          " || document.querySelector('.btn-primary')).click()")
            page.wait_for_timeout(800)
            m = page.evaluate("() => window.__coil.state().mode")
            if m != "play":
                raise SystemExit("판이 시작되지 않았다(mode=%s) — 검사기가 "
                                 "메뉴를 재고 있다. 고치기 전에는 결과를 믿지 마라." % m)
            page.evaluate("() => window.__coil.ghost(300)")
            for i in range(6):                      # 남은 0번 손가락으로 민다
                rig.send("touchMove", [(f0[0] + 30 + i * 6, f0[1] - 30 - i * 6)])
                page.wait_for_timeout(60)
            rows.append(page.evaluate(ST))
            rig.send("touchEnd", [])
            page.wait_for_timeout(200)
        ctx.close()
        b.close()
    srv.shutdown()

    dead = sum(1 for r in rows if r["aim"] is None)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / ("menufinger_%s.json" % tag)).write_text(
        json.dumps({"rows": rows, "dead": dead}, ensure_ascii=False, indent=1),
        encoding="utf-8")
    print("== %s   D) 메뉴에 손가락 얹은 채 «진짜 버튼» 탭 -> 밀기" % tag)
    print("   조종불능 %d/%d (%.1f%%)" % (dead, len(rows), dead / len(rows) * 100))
    s0 = rows[0]
    g = s0["diag"]
    print("   표본: aim=%s stick=%s menuDisplay=%s" % (s0["aim"], s0["stick"], s0["menuDisp"]))
    print("        activeN=%s steerId=%s adopts=%s  EL ts=%s tm=%s | WIN ts=%s tm=%s" % (
        g["activeN"], g["steerId"], g["adopts"],
        g["el"]["touchstart"], g["el"]["touchmove"],
        g["win"]["touchstart"], g["win"]["touchmove"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
