# -*- coding: utf-8 -*-
"""qa_governor_latency.py — 「거대 뱀이 화면에 들어오는 순간」 품질 거버너가
얼마나 «늦게» 반응하는가.

  python tools/qa_governor_latency.py <distDir> <tag> [--cpu 8]

★ 왜 재나: President 증상은 「움직일 때(그 순간) 프레임이 떨어진다」다.
  거버너(quality.ts)는 히스테리시스가 강하게 걸려 있다 —
    판정 창 90프레임 · MIN_DWELL 8초 · 승격은 15초 연속 좋은 창.
  그 설계는 «깜빡임»을 막으려고 일부러 그렇게 한 것이다(네온 스레드 -22 사고).
  ⇒ 그러면 «순간의 저하»에는 구조적으로 못 붙는다. 그 지연을 초 단위로 잰다.

★ 무엇을 하나: 판을 시작하고 안정된 뒤, 갑자기 (a) CPU 스로틀을 올리고
  (b) 거대 뱀을 화면에 채운다. 그 시각부터 qlog 에 첫 전환이 찍힐 때까지를 잰다.
★ 헤드리스 전용. 게임 코드 무수정(읽기 훅만 사용).
"""
from __future__ import annotations

import argparse
import http.server
import json
import socketserver
import sys
import threading
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_perf_260908"
VW, VH = 390, 844
SAVE = {"v": 1, "savedAt": 0, "bestScore": 6000, "bestRank": 1, "games": 40,
        "totalKills": 30, "playSeconds": 5000, "nick": "", "skin": "corn",
        "control": "joystick", "sound": False, "locale": None}


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
    ap = argparse.ArgumentParser()
    ap.add_argument("dist")
    ap.add_argument("tag")
    ap.add_argument("--cpu", type=int, default=8)
    ap.add_argument("--wait", type=float, default=20)
    a = ap.parse_args()

    port, srv = serve(Path(a.dist).resolve())
    out = {"tag": a.tag, "cpu": a.cpu}
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
            page.evaluate("() => window.__coil.startRun()")
            page.wait_for_timeout(2500)
            page.evaluate("() => window.__coil.ghost(9000)")
            out["tier_before"] = page.evaluate("() => window.__coilTimes().tier")
            out["qlog_before"] = page.evaluate("() => window.__coil.qlog()")

            # ★ «그 순간» — 부하를 한꺼번에 건다.
            #   ⚠ 지연은 «페이지 안에서» 잰다. 파이썬 쪽 wait/evaluate 왕복은
            #     8배 스로틀에서 그 자체가 수 초라 벽시계를 통째로 오염시킨다
            #     (2026-09-08 실측으로 확인 — 처음엔 이 오염을 지연으로 오독했다).
            t0 = time.time()
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": a.cpu})
            page.evaluate("() => { window.__loadAt = performance.now();"
                          " window.__loadClock = window.__coilTimes().tier * 0 +"
                          " (window.__coil.qlog().length);"
                          " window.__coil.stress(6, 6000, true, 6000, 'grid'); }")
            cdp.send("Input.dispatchTouchEvent", {"type": "touchStart",
                     "touchPoints": [{"x": 195.0, "y": 520.0, "id": 0}]})
            first = None
            samples = []
            i = 0
            while time.time() - t0 < a.wait:
                i += 1
                cdp.send("Input.dispatchTouchEvent", {"type": "touchMove",
                         "touchPoints": [{"x": 195.0 + (i % 7) * 10,
                                          "y": 520.0 - (i % 5) * 9, "id": 0}]})
                page.wait_for_timeout(120)
                st = page.evaluate("() => ({ tier: window.__coilTimes().tier,"
                                   " q: window.__coil.qlog(),"
                                   " t: window.__coilTimes().total })")
                samples.append({"dt": round(time.time() - t0, 2),
                                "tier": st["tier"], "total_ms": round(st["t"], 2)})
                if first is None and len(st["q"]) > len(out["qlog_before"]):
                    first = round(time.time() - t0, 2)
                    out["qlog_first"] = st["q"][len(out["qlog_before"]):]
            cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
            out["first_transition_s_wall_polluted"] = first
            # ★ 진짜 지연: 부하 시각(performance.now)과 qlog 의 now 차이. 전부 페이지 안 값이다.
            inpage = page.evaluate("""() => {
              const q = window.__coil.qlog();
              const after = q.slice(window.__loadClock);
              return { loadAt: window.__loadAt,
                       first: after.length ? after[0] : null,
                       all: after };
            }""")
            out["inpage"] = inpage
            out["latency_ms"] = (round(inpage["first"]["now"] - inpage["loadAt"], 1)
                                 if inpage["first"] else None)
            out["tier_after"] = page.evaluate("() => window.__coilTimes().tier")
            out["samples"] = samples
            ctx.close()
            b.close()
    finally:
        srv.shutdown()

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / ("govlat_%s.json" % a.tag)).write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    print("== 품질 거버너 반응 지연 [%s]  부하 cpu=%dx + 거대뱀 6마리 동시 투입"
          % (a.tag, a.cpu))
    print("  부하 «전» tier=%s" % out["tier_before"])
    if out["latency_ms"] is None:
        print("  ★ %.0f초 동안 «단계 전환 0회» — 거버너가 이 저하에 반응하지 않았다."
              % a.wait)
    else:
        print("  ★ 첫 강등까지 %.2f초 (페이지 내부 시계) — %s"
              % (out["latency_ms"] / 1000, out["inpage"]["first"]["why"]))
        print("  이후 전환 %d회: %s"
              % (len(out["inpage"]["all"]),
                 " → ".join("T%s(%s)" % (e["to"], e["why"].split()[0])
                            for e in out["inpage"]["all"])))
    print("  부하 «후» tier=%s" % out["tier_after"])
    hi = [s for s in samples if s["total_ms"] > 16.7]
    print("  렌더 total>16.7ms 표본 %d/%d, 최대 %.2fms"
          % (len(hi), len(samples),
             max((s["total_ms"] for s in samples), default=0)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
