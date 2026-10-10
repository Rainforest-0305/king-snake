# -*- coding: utf-8 -*-
"""qa_orbview.py - «화면 안에 실제로 그려진» 오브/뱀 개수를 전/후로 잰다.

President 불만 ②(「좀더 많이 남기면 안 돼?」)의 합격선은 「화면 안 오브 개수」다.
renderer.lastOrbsDrawn 이 그 숫자다(?debug=1 에서 __coilTimes() 로 노출).

  python tools/qa_orbview.py <dirA> <dirB> [초]

headless 고정 - 창을 띄우지 않는다.
"""
from __future__ import annotations
import http.server, socketserver, statistics, sys, threading
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
SEED = 20260818
DUR = int(sys.argv[3]) if len(sys.argv) > 3 else 60


def serve(d: Path) -> int:
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(d), **k)

        def log_message(self, *a):
            pass
    s = socketserver.TCPServer(("127.0.0.1", 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s.server_address[1]


def measure(label: str, d: Path, pw) -> dict:
    port = serve(d)
    b = pw.chromium.launch(headless=True)
    try:
        ctx = b.new_context(viewport={"width": 390, "height": 652},
                            locale="ko-KR", has_touch=True, is_mobile=True)
        pg = ctx.new_page()
        pg.goto("http://127.0.0.1:%d/?demo=1&debug=1&seed=%d" % (port, SEED),
                wait_until="networkidle")
        pg.wait_for_timeout(1500)
        orbs, snakes, masses = [], [], []
        for _ in range(DUR * 4):
            pg.wait_for_timeout(250)
            v = pg.evaluate("() => { const t = window.__coilTimes && window.__coilTimes();"
                            " const s = window.__coil && window.__coil.state();"
                            " return t && s ? {o: t.orbs, s: t.snakes, m: s.mass} : null; }")
            if v:
                orbs.append(v["o"]); snakes.append(v["s"]); masses.append(v["m"])
        ctx.close()
    finally:
        b.close()
    if not orbs:
        return {"label": label, "err": "__coilTimes 를 못 읽었다"}
    return {"label": label, "orbMed": statistics.median(orbs), "orbMax": max(orbs),
            "orbP90": sorted(orbs)[int(len(orbs) * 0.9)],
            "snakeMed": statistics.median(snakes), "massEnd": round(masses[-1]),
            "n": len(orbs)}


def main() -> int:
    a, b = Path(sys.argv[1]), Path(sys.argv[2])
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        ra = measure(sys.argv[1], a, pw)
        rb = measure(sys.argv[2], b, pw)
    for r in (ra, rb):
        if "err" in r:
            print("  %-16s %s" % (r["label"], r["err"])); return 1
        print("  %-16s 화면오브 중앙 %3d / p90 %3d / 최대 %3d   화면뱀 %2d   끝질량 %d"
              % (r["label"], r["orbMed"], r["orbP90"], r["orbMax"], r["snakeMed"], r["massEnd"]))
    print("  화면오브 중앙 변화: %+.1f%%" % ((rb["orbMed"] - ra["orbMed"]) / ra["orbMed"] * 100))
    return 0


if __name__ == "__main__":
    sys.exit(main())
