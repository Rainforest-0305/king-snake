# -*- coding: utf-8 -*-
"""qa_rendercost.py - 두 빌드의 «층별 렌더 비용(ms)»을 번갈아 잰다.

★ 왜 fps 가 아니라 ms 인가:
  이 게임은 대부분의 조건에서 vsync 상한(60fps)에 붙어 있다. 상한에 붙어 있는
  동안 fps 는 «부하가 두 배가 되어도 60.0» 이다 - 회귀를 못 본다. 반대로 다른
  프로세스가 끼어들면 55 로 떨어져 «없는 회귀»를 만들어낸다.
  renderer.times 는 실제로 그 층에 쓴 밀리초라서 양쪽 함정을 다 피한다.

★ 길이 교란 주의: 같은 시각에 두 빌드의 뱀 길이가 다르면 부하도 다르다.
  그래서 질량과 «그린 오브 수»를 같이 찍는다. 숫자를 볼 때 반드시 같이 봐라.

  python tools/qa_rendercost.py <dirA> <dirB> [초] [반복]

headless 고정 - 창을 띄우지 않는다.
"""
from __future__ import annotations

import http.server
import socketserver
import statistics
import sys
import threading
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
SEED = 20260818


def serve(d: Path) -> int:
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(d), **k)

        def log_message(self, *a):
            pass

    s = socketserver.TCPServer(("127.0.0.1", 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s.server_address[1]


def once(port: int, at: int, pw) -> dict:
    b = pw.chromium.launch(headless=True)  # 플래그 없음 = SwiftShader(소프트웨어)
    try:
        ctx = b.new_context(viewport={"width": 1600, "height": 900}, locale="en-US")
        pg = ctx.new_page()
        pg.goto("http://127.0.0.1:%d/?demo=1&debug=1&seed=%d" % (port, SEED),
                wait_until="load")
        pg.wait_for_timeout(at * 1000)
        v = pg.evaluate("() => ({ t: window.__coilTimes(), s: window.__coil.state() })")
        ctx.close()
    finally:
        b.close()
    t = v["t"]
    return {"total": t.get("total", 0), "orbs_ms": t.get("orbs", None),
            "layers": t, "drawnOrbs": t.get("orbs"), "snakes": t.get("snakes"),
            "mass": round(v["s"]["mass"]), "fps": v["s"]["fps"]}


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    a, b = Path(sys.argv[1]), Path(sys.argv[2])
    at = int(sys.argv[3]) if len(sys.argv) > 3 else 110
    rounds = int(sys.argv[4]) if len(sys.argv) > 4 else 2
    pa, pb = serve(a), serve(b)
    from playwright.sync_api import sync_playwright
    A, B = [], []
    with sync_playwright() as pw:
        for i in range(rounds):
            A.append(once(pa, at, pw))
            B.append(once(pb, at, pw))
            print("  round %d: A total %.2fms (오브 %s, 질량 %s) | B total %.2fms (오브 %s, 질량 %s)"
                  % (i + 1, A[-1]["total"], A[-1]["drawnOrbs"], A[-1]["mass"],
                     B[-1]["total"], B[-1]["drawnOrbs"], B[-1]["mass"]), flush=True)
    # ★ 키 이름은 render/index.ts 의 times 객체가 «정본»이다
    #   (bg/orbs/bodies/heads/labels/vignette/mini/total).
    #   ?debug=1 오버레이가 쓰는 짧은 이름(body/head/lbl/vig)으로 읽으면 아무것도
    #   안 나오고 «표가 조용히 비어 버린다» - 실제로 한 번 당했다.
    # ★ "orbs" 는 ms 가 아니다 - main.ts 의 __coilTimes 가 lastOrbsDrawn(개수)으로
    #   덮어쓴다(스프레드 뒤에 명시 대입). 그래서 ms 표에서 뺀다.
    keys = ["bg", "bodies", "heads", "labels", "vignette", "mini", "total"]
    print("\n  층별 ms 중앙값 (t=%ds, %d회, 소프트웨어 래스터 1600x900)" % (at, rounds))
    print("  %-8s %10s %10s" % ("layer", str(a), str(b)))
    for k in keys:
        va = [r["layers"].get(k) for r in A if isinstance(r["layers"].get(k), (int, float))]
        vb = [r["layers"].get(k) for r in B if isinstance(r["layers"].get(k), (int, float))]
        if not va or not vb:
            continue
        print("  %-8s %10.3f %10.3f" % (k, statistics.median(va), statistics.median(vb)))
    print("  %-8s %10.0f %10.0f" % ("그린오브", statistics.median([r["drawnOrbs"] for r in A]),
                                    statistics.median([r["drawnOrbs"] for r in B])))
    print("  %-8s %10.0f %10.0f" % ("질량", statistics.median([r["mass"] for r in A]),
                                    statistics.median([r["mass"] for r in B])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
