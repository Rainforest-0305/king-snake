# -*- coding: utf-8 -*-
"""qa_joystick_vs_territory.py — 뱀 키우기와 땅따먹기에 «같은 제스처»를 넣고
조이스틱 원점·노브의 시계열을 나란히 찍는다.

  python tools/qa_joystick_vs_territory.py <snakeDist> <territoryDist> <tag>

★ 무엇을 가르나
  2026-09-06 에 뱀의 input.ts 를 땅따먹기 모델로 교체했다. 「같은 모델이 됐다」는
  주장을 코드 대조가 아니라 «동작»으로 확인한다. 판정값은 두 가지다:
    ① 원점 drag-along 이 도는가 — 손가락이 목줄보다 멀어지면 원점이 따라오는가
    ② |노브 − 원점| 이 목줄 값에서 «포화»하는가 (뱀 58 / 땅따먹기 64)
  두 게임은 목줄 상수가 다르므로 절대값이 아니라 «모양»을 본다.

★ 읽는 방법이 게임마다 다르다(둘 다 «게임 코드를 고치지 않고» 밖에서 읽는다):
    뱀        : window.__coil.stick()  → origin/knob        (?debug=1)
    땅따먹기  : DOM `.tc-joy` 의 style.left/top = 원점,
                `.tc-joy i` 의 transform = 클램프된 노브 변위
★ 헤드리스 전용. 창을 절대 띄우지 않는다.
"""
from __future__ import annotations

import http.server
import json
import math
import socketserver
import sys
import threading
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_joyfix_260906"
VW, VH = 390, 844

SNAKE_SAVE = {"v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
              "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
              "control": "joystick", "sound": False, "locale": None}

# 같은 제스처: (150,600) 에서 시작해 한 방향으로 240px 를 12스텝에 민다.
P0 = (150.0, 600.0)
THETA = -2.2
TOTAL = 240.0
STEPS = 12


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


def touch(cdp, kind, pts):
    cdp.send("Input.dispatchTouchEvent", {
        "type": kind,
        "touchPoints": [{"x": float(x), "y": float(y), "id": i} for i, (x, y) in pts]})


def drag(page, cdp, read):
    """같은 제스처를 넣고 매 스텝의 (원점, |노브-원점|) 을 모은다."""
    out = []
    touch(cdp, "touchStart", [(0, P0)])
    page.wait_for_timeout(120)
    out.append(read())
    for i in range(1, STEPS + 1):
        d = TOTAL * i / STEPS
        touch(cdp, "touchMove", [(0, (P0[0] + math.cos(THETA) * d,
                                      P0[1] + math.sin(THETA) * d))])
        page.wait_for_timeout(50)
        out.append(read())
    touch(cdp, "touchEnd", [(0, P0)])
    return [r for r in out if r]


SNAKE_READ = """() => {
  const s = window.__coil.stick();
  if (!s || !s.active) return null;
  return { ox: s.origin.x, oy: s.origin.y, kx: s.knob.x, ky: s.knob.y, aim: s.aim };
}"""

TC_READ = """() => {
  const j = document.querySelector('.tc-joy');
  if (!j || !j.classList.contains('on')) return null;
  const k = j.querySelector('i');
  const m = /translate\\(([-0-9.]+)px,\\s*([-0-9.]+)px\\)/.exec(k ? k.style.transform : '');
  const ox = parseFloat(j.style.left) || 0, oy = parseFloat(j.style.top) || 0;
  const dx = m ? parseFloat(m[1]) : 0, dy = m ? parseFloat(m[2]) : 0;
  return { ox: ox, oy: oy, kx: ox + dx, ky: oy + dy, aim: null };
}"""


def run_snake(dist: Path):
    port, srv = serve(dist)
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(headless=True)
            ctx = b.new_context(viewport={"width": VW, "height": VH},
                                device_scale_factor=2, is_mobile=True,
                                has_touch=True, locale="ko-KR")
            ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                                % json.dumps(json.dumps(SNAKE_SAVE, ensure_ascii=False)))
            page = ctx.new_page()
            page.goto("http://127.0.0.1:%d/?debug=1&quiet=1&seed=7" % port, wait_until="load")
            page.wait_for_timeout(900)
            cdp = ctx.new_cdp_session(page)
            page.evaluate("() => window.__coil.startRun()")
            page.wait_for_timeout(700)
            page.evaluate("() => window.__coil.ghost(300)")
            rows = drag(page, cdp, lambda: page.evaluate(SNAKE_READ))
            ctx.close()
            b.close()
    finally:
        srv.shutdown()
    return rows


def run_territory(dist: Path):
    port, srv = serve(dist)
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(headless=True)
            ctx = b.new_context(viewport={"width": VW, "height": VH},
                                device_scale_factor=2, is_mobile=True,
                                has_touch=True, locale="ko-KR")
            page = ctx.new_page()
            page.goto("http://127.0.0.1:%d/?diag=1" % port, wait_until="load")
            page.wait_for_timeout(1200)
            cdp = ctx.new_cdp_session(page)
            # 메뉴를 «실제 버튼»으로 통과한다. 판이 시작되면 .tc-joy 가 생긴다.
            t0 = time.time()
            while time.time() - t0 < 12:
                ph = page.evaluate(
                    "() => window.__tcDiag ? window.__tcDiag.phase() : 'none'")
                if ph not in ("none", "menu"):
                    break
                xy = page.evaluate("""() => {
                  const vis = (e) => !!e && e.getClientRects().length > 0;
                  const cands = [...document.querySelectorAll('button')].filter(vis);
                  if (!cands.length) return null;
                  const b = cands[0].getBoundingClientRect();
                  return [b.x + b.width / 2, b.y + b.height / 2];
                }""")
                if not xy:
                    page.wait_for_timeout(200)
                    continue
                touch(cdp, "touchStart", [(9, (xy[0], xy[1]))])
                page.wait_for_timeout(60)
                touch(cdp, "touchEnd", [(9, (xy[0], xy[1]))])
                page.wait_for_timeout(500)
            phase = page.evaluate(
                "() => window.__tcDiag ? window.__tcDiag.phase() : 'none'")
            rows = drag(page, cdp, lambda: page.evaluate(TC_READ))
            ctx.close()
            b.close()
    finally:
        srv.shutdown()
    return rows, phase


def shape(rows):
    """원점 이동 누적 / |노브-원점| 시계열."""
    if not rows:
        return None
    lens = [round(math.hypot(r["kx"] - r["ox"], r["ky"] - r["oy"]), 1) for r in rows]
    drift = 0.0
    for i in range(1, len(rows)):
        drift += math.hypot(rows[i]["ox"] - rows[i - 1]["ox"],
                            rows[i]["oy"] - rows[i - 1]["oy"])
    return {"n": len(rows), "len_series": lens, "len_max": max(lens),
            "origin_drift": round(drift, 1)}


def main() -> int:
    snake_d = Path(sys.argv[1]).resolve()
    terr_d = Path(sys.argv[2]).resolve()
    tag = sys.argv[3] if len(sys.argv) > 3 else "cmp"

    s = shape(run_snake(snake_d))
    trows, phase = run_territory(terr_d)
    t = shape(trows)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / ("vs_territory_%s.json" % tag)).write_text(
        json.dumps({"snake": s, "territory": t, "tc_phase": phase,
                    "gesture": {"p0": P0, "theta": THETA, "total": TOTAL,
                                "steps": STEPS}},
                   ensure_ascii=False, indent=1), encoding="utf-8")

    print("== 같은 제스처(%.0fpx 직선 드래그)에 대한 조이스틱 반응 [%s]" % (TOTAL, tag))
    # 목줄 = 원점 끌림이 «시작되는» 거리(DRAG_START). 두 게임 모두 64 다.
    for name, r, leash in (("뱀 키우기(교체후)", s, 64), ("땅따먹기(원본)", t, 64)):
        if not r:
            print("  %-16s 읽기 실패(조이스틱이 안 떴다)" % name)
            continue
        print("  %-16s 목줄=%d  |노브-원점| 최대=%.1f  원점이동 누적=%.1f  n=%d"
              % (name, leash, r["len_max"], r["origin_drift"], r["n"]))
        print("      %s" % r["len_series"])
    if not t:
        print("  ⚠ 땅따먹기 쪽 phase=%s — 판이 시작되지 않아 대조 실패." % phase)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
