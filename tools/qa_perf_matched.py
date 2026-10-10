# -*- coding: utf-8 -*-
"""qa_perf_matched.py - «같은 크기»로 맞춰 놓고 재는 fps A/B.

★ 왜 필요한가 (2026-08-25 회귀 보정에서 실제로 겪은 함정):
  perf.py 는 「t=120초의 fps」를 잰다. 그런데 데모 뱀의 길이는 판마다 다르다 -
  실측에서 병합 전은 길이 1,324, 병합 후는 376 에서 잰 값이 비교됐다.
  이 게임의 부하는 «길이»가 만든다. 길이가 3.5배 다른 두 숫자를 나란히 놓으면
  「더 짧은데 더 느리다」 같은 «없는 회귀»가 만들어진다.

  여기서는 __coil.grow(mass) 로 두 빌드의 뱀을 «같은 질량»에 고정한 뒤 잰다.
  몸통은 머리가 지나간 경로로 채워지므로 grow 직후가 아니라 «몸이 다 펴진 뒤»에
  측정한다(질량 1300 이면 몸 길이 2,542 유닛 / 속도 205 = 약 13초).

  python tools/qa_perf_matched.py <dirA> <dirB> [질량] [반복] [gpu|software]

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
GPU_ARGS = ["--enable-gpu", "--use-gl=angle", "--use-angle=default", "--ignore-gpu-blocklist"]

FPS_PROBE = """
(ms) => new Promise((resolve) => {
  let frames = 0, worst = 0, prev = performance.now();
  const t0 = prev;
  function tick(now) {
    const d = now - prev; prev = now;
    if (frames > 4 && d > worst) worst = d;
    frames++;
    if (now - t0 < ms) requestAnimationFrame(tick);
    else resolve({ fps: frames / ((now - t0) / 1000), worst: worst });
  }
  requestAnimationFrame(tick);
});
"""


def serve(d: Path) -> int:
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(d), **k)

        def log_message(self, *a):
            pass

    s = socketserver.TCPServer(("127.0.0.1", 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s.server_address[1]


def once(port: int, mass: int, backend: str, pw) -> dict:
    b = pw.chromium.launch(headless=True, args=GPU_ARGS if backend == "gpu" else [])
    try:
        ctx = b.new_context(viewport={"width": 1600, "height": 900}, locale="en-US")
        pg = ctx.new_page()
        pg.goto("http://127.0.0.1:%d/?demo=1&debug=1&seed=%d" % (port, SEED),
                wait_until="load")
        pg.wait_for_timeout(12000)
        # 몸이 펴지는 동안에도 계속 밀어 넣는다(먹거나 죽어서 값이 바뀌는 것을 막는다).
        for _ in range(16):
            pg.evaluate("(m) => window.__coil.grow(m)", mass)
            pg.wait_for_timeout(1000)
        r = pg.evaluate(FPS_PROBE, 3000)
        st = pg.evaluate("() => ({ t: window.__coilTimes(), s: window.__coil.state() })")
        ctx.close()
    finally:
        b.close()
    return {"fps": round(r["fps"], 1), "worst": round(r["worst"], 1),
            "mass": round(st["s"]["mass"]), "orbs": st["t"]["orbs"],
            "snakes": st["t"]["snakes"], "total": round(st["t"].get("total", 0), 3)}


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    a, b = Path(sys.argv[1]), Path(sys.argv[2])
    mass = int(sys.argv[3]) if len(sys.argv) > 3 else 1300
    rounds = int(sys.argv[4]) if len(sys.argv) > 4 else 3
    backend = sys.argv[5] if len(sys.argv) > 5 else "software"
    pa, pb = serve(a), serve(b)
    from playwright.sync_api import sync_playwright
    A, B = [], []
    with sync_playwright() as pw:
        for i in range(rounds):
            A.append(once(pa, mass, backend, pw))
            B.append(once(pb, mass, backend, pw))
            print("  round %d  A fps %5.1f (질량 %s, 오브 %s, %sms) | B fps %5.1f (질량 %s, 오브 %s, %sms)"
                  % (i + 1, A[-1]["fps"], A[-1]["mass"], A[-1]["orbs"], A[-1]["total"],
                     B[-1]["fps"], B[-1]["mass"], B[-1]["orbs"], B[-1]["total"]), flush=True)
    fa = statistics.median([r["fps"] for r in A])
    fb = statistics.median([r["fps"] for r in B])
    print("\n  %s / 질량 %d 고정 / %d회" % (backend, mass, rounds))
    print("  %-16s fps 중앙 %5.1f   최악프레임 중앙 %5.1fms   그린오브 중앙 %.0f"
          % (str(a), fa, statistics.median([r["worst"] for r in A]),
             statistics.median([r["orbs"] for r in A])))
    print("  %-16s fps 중앙 %5.1f   최악프레임 중앙 %5.1fms   그린오브 중앙 %.0f"
          % (str(b), fb, statistics.median([r["worst"] for r in B]),
             statistics.median([r["orbs"] for r in B])))
    print("  차이 %+.1f fps" % (fb - fa))
    return 0


if __name__ == "__main__":
    sys.exit(main())
