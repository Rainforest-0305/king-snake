# -*- coding: utf-8 -*-
"""qa_joystick_buffer.py — 「노브가 멈춘 뒤에도 스틱은 «가만히» 있는가」.

  python tools/qa_joystick_buffer.py <distDir> <tag>

★ 무엇을 가르나
  2026-09-06 판은 「완충 구간」 검사였다(노브 46 에서 멈추고 64 부터 원점이
  끌린다). 2026-09-07 President 지시로 drag-along 을 «통째로» 없애면서
  기대값이 하나로 단순해졌다:

      «어느 거리에서도» 원점 이동 0.0        (고정 원점)
      노브는 데드존(6)에서 0 → KNOB_MAX(46) 로 선형, 46 을 넘지 않는다

  손가락을 원점에서 «정확히» 여러 거리에 놓고 매번 그 둘을 잰다.
  ⇒ 어느 한 줄이라도 원점이 움직이면 drag-along 이 되살아난 것이다.

★ 매번 «새 제스처»로 잰다(누적 끌림이 섞이면 아무것도 못 가른다).
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
OUT = ROOT / "_joyfix_260906"
VW, VH = 390, 844
P0 = (170.0, 560.0)
THETA = -2.2
# 데드존(6) 위 ~ 끌림 문턱(64) 아래 ~ 그 위
DISTANCES = [20.0, 40.0, 46.0, 52.0, 58.0, 63.0, 64.0, 70.0, 90.0, 140.0]

SAVE = {"v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
        "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
        "control": "joystick", "sound": False, "locale": None}

READ = """() => {
  const s = window.__coil.stick();
  if (!s || !s.active) return null;
  return { ox: s.origin.x, oy: s.origin.y, kx: s.knob.x, ky: s.knob.y, aim: s.aim };
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
    tag = sys.argv[2] if len(sys.argv) > 2 else "buf"
    port, srv = serve(dist)
    rows = []
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
            cdp = ctx.new_cdp_session(page)

            # ★ CDP 는 «닿아 있지 않은데» touchEnd/Move 를 보내면 프로토콜
            #   오류를 낸다("Must send a TouchStart first"). 상태를 들고 간다.
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

            page.evaluate("() => window.__coil.startRun()")
            page.wait_for_timeout(700)
            page.evaluate("() => window.__coil.ghost(600)")

            for d in DISTANCES:
                # ★ 매번 손을 떼고 새로 잡는다 — 원점이 «닿은 그 자리»여야 한다.
                touch("touchEnd", [])
                page.wait_for_timeout(120)
                touch("touchStart", [(0, P0)])
                page.wait_for_timeout(120)
                base = page.evaluate(READ)
                tgt = (P0[0] + math.cos(THETA) * d, P0[1] + math.sin(THETA) * d)
                touch("touchMove", [(0, tgt)])
                page.wait_for_timeout(150)
                cur = page.evaluate(READ)
                if not base or not cur:
                    rows.append({"d": d, "err": "stick off"})
                    continue
                rows.append({
                    "d": d,
                    "origin_move": round(math.hypot(cur["ox"] - base["ox"],
                                                    cur["oy"] - base["oy"]), 2),
                    "knob_len": round(math.hypot(cur["kx"] - cur["ox"],
                                                 cur["ky"] - cur["oy"]), 2),
                    "aim": cur["aim"],
                })
            touch("touchEnd", [])
            ctx.close()
            b.close()
    finally:
        srv.shutdown()

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / ("buffer_%s.json" % tag)).write_text(
        json.dumps({"rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")

    print("== 완충 구간 실측 [%s]   (노브정지 46 / 링 52 / 원점 «고정»)" % tag)
    print("  %6s %12s %10s %10s %s" % ("민거리", "원점이동", "기대", "노브길이", "aim"))
    bad = 0
    for r in rows:
        if "err" in r:
            print("  %6.0f  ERR %s" % (r["d"], r["err"]))
            bad += 1
            continue
        # ★ 2026-09-07 고정 원점 전환으로 기대값이 «전 거리 0» 이 됐다.
        #   예전(dynamic origin)에는 max(0, d-64) 였다 — 그 식이 남아 있으면
        #   원점이 안 움직이는 «정상» 상태를 불합격으로 찍는다.
        exp = 0.0
        ok = abs(r["origin_move"] - exp) < 1.0 and r["knob_len"] <= 46.5
        if not ok:
            bad += 1
        print("  %6.0f %12.2f %10.1f %10.2f %s  %s"
              % (r["d"], r["origin_move"], exp, r["knob_len"],
                 "null" if r["aim"] is None else "%.2f" % r["aim"],
                 "OK" if ok else "<-- 어긋남"))
    print("  판정: %s (어긋남 %d/%d)" % ("합격" if bad == 0 else "불합격", bad, len(rows)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
