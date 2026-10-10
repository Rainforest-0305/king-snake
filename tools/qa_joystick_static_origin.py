# -*- coding: utf-8 -*-
"""qa_joystick_static_origin.py — 「원점은 «절대» 안 움직이고, 거리와 무관하게
방향이 살아 있는가」.

  python tools/qa_joystick_static_origin.py <distDir> <tag>

★ 2026-09-07 President 지시(「조이스틱이 통째로 따라오는 게 너무 불편하다」)로
  drag-along 을 없애고 고정 원점(static origin)으로 바꿨다. 그 전환이 실제로
  됐는지를 «세 가지 성질»로 가른다. 셋 다 통과해야 고정 원점이다.

  A) 직선 240px 드래그 → 원점 이동 «정확히 0.0»
     (dynamic origin 이면 240-64 = 176 이 나온다)
  B) 반대편으로 되돌리기(+200 → -200) → aim 이 π 만큼 뒤집힌다
     (원점이 따라왔다면 뒤집히기 전에 원점이 끌려가 각이 흐려진다)
  C) 링 «밖» 150px 에서 원 궤도 → aim 이 연속 회전하고 null 이 «0회»
     (고정 원점의 유일한 약점이 「멀면 안 먹는다」인데, 그게 없음을 증명한다)
  D) 화면 «모서리» 터치 → 링 전체가 화면 안에 들어오게 원점이 밀렸고,
     그 밀린 원점 기준으로 «즉시» 조향된다

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
RING = 52

SAVE = {"v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
        "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
        "control": "joystick", "sound": False, "locale": None}

READ = """() => {
  const s = window.__coil.stick();
  if (!s) return null;
  return { ox: s.origin.x, oy: s.origin.y, kx: s.knob.x, ky: s.knob.y,
           aim: s.aim, act: !!s.active };
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


class Rig:
    def __init__(self, page, cdp):
        self.page, self.cdp = page, cdp
        self.down = False

    def send(self, kind, pts):
        if kind == "touchStart":
            self.down = True
        elif kind in ("touchEnd", "touchCancel"):
            if not self.down:
                return
            self.down = False
        elif kind == "touchMove" and not self.down:
            return
        self.cdp.send("Input.dispatchTouchEvent", {
            "type": kind,
            "touchPoints": [{"x": float(x), "y": float(y), "id": i}
                            for i, (x, y) in pts]})

    def start(self, xy):
        self.send("touchEnd", [])
        self.page.wait_for_timeout(120)
        self.send("touchStart", [(0, xy)])
        self.page.wait_for_timeout(140)

    def move(self, xy, ms=45):
        self.send("touchMove", [(0, xy)])
        self.page.wait_for_timeout(ms)


def angdiff(a, b):
    return (a - b + math.pi) % (2 * math.pi) - math.pi


def main() -> int:
    dist = Path(sys.argv[1]).resolve()
    tag = sys.argv[2] if len(sys.argv) > 2 else "static"
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
            cdp = ctx.new_cdp_session(page)
            rig = Rig(page, cdp)
            page.evaluate("() => window.__coil.startRun()")
            page.wait_for_timeout(700)
            page.evaluate("() => window.__coil.ghost(900)")

            # ── A) 직선 240px — 원점이 «한 픽셀도» 안 움직여야 한다 ──────────
            p0 = (170.0, 560.0)
            th = -2.2
            rig.start(p0)
            base = page.evaluate(READ)
            drift = 0.0
            prev = base
            knobs = []
            for i in range(1, 13):
                d = 240.0 * i / 12
                rig.move((p0[0] + math.cos(th) * d, p0[1] + math.sin(th) * d))
                cur = page.evaluate(READ)
                drift += math.hypot(cur["ox"] - prev["ox"], cur["oy"] - prev["oy"])
                knobs.append(round(math.hypot(cur["kx"] - cur["ox"],
                                              cur["ky"] - cur["oy"]), 1))
                prev = cur
            res["A_line"] = {"origin_drift": round(drift, 3),
                             "knob_series": knobs,
                             "aim_end": prev["aim"]}

            # ── B) 반대편으로 되돌리기 — aim 이 π 만큼 뒤집혀야 한다 ─────────
            rig.start(p0)
            rig.move((p0[0] + 200.0, p0[1]))
            a1 = page.evaluate(READ)
            for x in (150.0, 100.0, 40.0, -40.0, -120.0, -200.0):
                rig.move((p0[0] + x, p0[1]))
            a2 = page.evaluate(READ)
            res["B_reverse"] = {
                "aim_before": a1["aim"], "aim_after": a2["aim"],
                "flip_deg": None if a1["aim"] is None or a2["aim"] is None
                else round(abs(math.degrees(angdiff(a2["aim"], a1["aim"]))), 2),
                "origin_move": round(math.hypot(a2["ox"] - a1["ox"],
                                                a2["oy"] - a1["oy"]), 3)}

            # ── C) 링 «밖» 150px 원 궤도 — aim 이 끊기지 않아야 한다 ─────────
            rig.start(p0)
            nulls = 0
            steps = 24
            seen = []
            o0 = page.evaluate(READ)
            for i in range(steps + 1):
                a = -math.pi + (2 * math.pi) * i / steps
                rig.move((p0[0] + math.cos(a) * 150.0,
                          p0[1] + math.sin(a) * 150.0), ms=40)
                cur = page.evaluate(READ)
                if cur["aim"] is None:
                    nulls += 1
                else:
                    seen.append(cur["aim"])
            o1 = page.evaluate(READ)
            # 궤도를 한 바퀴 돌면 각도 변화의 «합»이 2π 에 가까워야 한다.
            total = 0.0
            for i in range(1, len(seen)):
                total += abs(angdiff(seen[i], seen[i - 1]))
            res["C_orbit"] = {"nulls": nulls, "samples": len(seen),
                              "turn_deg": round(math.degrees(total), 1),
                              "origin_move": round(math.hypot(o1["ox"] - o0["ox"],
                                                              o1["oy"] - o0["oy"]), 3)}

            # ── D) 모서리 — 링이 화면 안에 들어오고 즉시 조향되는가 ──────────
            corners = {"bottom_left": (10.0, VH - 10.0),
                       "top_left": (8.0, 8.0),
                       "bottom_right": (VW - 8.0, VH - 8.0)}
            dres = {}
            for name, xy in corners.items():
                rig.start(xy)
                c = page.evaluate(READ)
                inside = (c["ox"] - RING >= -0.5 and c["ox"] + RING <= VW + 0.5
                          and c["oy"] - RING >= -0.5 and c["oy"] + RING <= VH + 0.5)
                dres[name] = {
                    "touch": [xy[0], xy[1]],
                    "origin": [round(c["ox"], 1), round(c["oy"], 1)],
                    "pushed_px": round(math.hypot(c["ox"] - xy[0], c["oy"] - xy[1]), 1),
                    "ring_inside_screen": inside,
                    "aim_immediate": c["aim"] is not None,
                }
            res["D_corners"] = dres
            rig.send("touchEnd", [])
            ctx.close()
            b.close()
    finally:
        srv.shutdown()

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / ("static_origin_%s.json" % tag)).write_text(
        json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")

    a, bb, c = res["A_line"], res["B_reverse"], res["C_orbit"]
    okA = a["origin_drift"] < 0.001 and a["aim_end"] is not None
    okB = bb["flip_deg"] is not None and abs(bb["flip_deg"] - 180) < 3 \
        and bb["origin_move"] < 0.001
    okC = c["nulls"] == 0 and abs(c["turn_deg"] - 360) < 25 \
        and c["origin_move"] < 0.001
    okD = all(v["ring_inside_screen"] and v["aim_immediate"]
              for v in res["D_corners"].values())

    print("== 고정 원점 검사 [%s]" % tag)
    print("  A 직선 240px    원점이동 %.3f px (기대 0.000)   노브 %s  aim=%s  %s"
          % (a["origin_drift"], a["knob_series"][-4:],
             "null" if a["aim_end"] is None else "%.2f" % a["aim_end"],
             "OK" if okA else "<-- 실패"))
    print("  B 반대로 되돌림  aim 변화 %s도 (기대 180)   원점이동 %.3f   %s"
          % (bb["flip_deg"], bb["origin_move"], "OK" if okB else "<-- 실패"))
    print("  C 링밖 150px 원  aim null %d회 (기대 0)   누적회전 %.1f도 (기대 360)"
          "   원점이동 %.3f   %s"
          % (c["nulls"], c["turn_deg"], c["origin_move"], "OK" if okC else "<-- 실패"))
    for name, v in res["D_corners"].items():
        print("  D %-13s 터치%s → 원점%s  %.1fpx 밀림  링화면안=%s  즉시조향=%s"
              % (name, v["touch"], v["origin"], v["pushed_px"],
                 v["ring_inside_screen"], v["aim_immediate"]))
    print("  판정: %s" % ("합격" if (okA and okB and okC and okD) else "불합격"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
