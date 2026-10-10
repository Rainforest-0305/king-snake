"""perf_ab.py - «두 빌드를 번갈아» 재는 A/B 벤치.

★ 왜 필요한가: perf.py 는 한 빌드만 잰다. 그런데 이 노트북의 fps 는 실행마다
  1~2 씩 흔들린다(다른 프로세스·발열). 「고치기 전 59.6 / 고친 뒤 58.0」 같은
  비교는 그 흔들림 안에 있어 «회귀인지 잡음인지» 구분할 수 없다.
  같은 조건에서 A B A B 로 번갈아 재면 드리프트가 양쪽에 «똑같이» 실린다.

두 루트를 각각 로컬 서버로 띄우고 같은 시드/같은 시각에 측정한다.

실행:
  python tools/perf_ab.py --a <before 폴더> --b dist --at 110 --rounds 3
"""

from __future__ import annotations

import argparse
import functools
import http.server
import socketserver
import statistics
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

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

GPU_ARGS = ["--enable-gpu", "--use-gl=angle", "--use-angle=default", "--ignore-gpu-blocklist"]


def serve(directory: str) -> int:
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=directory)
    handler.log_message = lambda *a, **kw: None  # type: ignore[assignment]
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1]


def measure(pw, port: int, at: int, seed: int, w: int, h: int, mobile: bool, backend: str) -> float:
    br = pw.chromium.launch(args=GPU_ARGS if backend == "gpu" else [])
    ctx = br.new_context(viewport={"width": w, "height": h},
                         device_scale_factor=2 if mobile else 1,
                         is_mobile=mobile, has_touch=mobile, locale="en-US")
    page = ctx.new_page()
    page.goto(f"http://127.0.0.1:{port}/?demo=1&debug=1&seed={seed}", wait_until="load")
    page.wait_for_timeout(at * 1000)
    r = page.evaluate(FPS_PROBE, 3000)
    ctx.close()
    br.close()
    return round(r["fps"], 1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", required=True, help="before 빌드 폴더")
    ap.add_argument("--b", default="dist", help="after 빌드 폴더")
    ap.add_argument("--at", type=int, default=110)
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--seed", type=int, default=20260818)
    ap.add_argument("--view", default="1600x900")
    ap.add_argument("--backend", default="gpu")
    args = ap.parse_args()

    w, h = (int(x) for x in args.view.split("x"))
    mobile = w < 500
    pa = serve(str(Path(args.a).resolve()))
    pb = serve(str(Path(args.b).resolve()))

    A: list[float] = []
    B: list[float] = []
    with sync_playwright() as pw:
        for i in range(args.rounds):
            a = measure(pw, pa, args.at, args.seed, w, h, mobile, args.backend)
            b = measure(pw, pb, args.at, args.seed, w, h, mobile, args.backend)
            A.append(a)
            B.append(b)
            print(f"  round {i + 1}:  before {a:5.1f}   after {b:5.1f}", flush=True)

    ma, mb = statistics.median(A), statistics.median(B)
    print(f"\n{args.backend}/{args.view} t={args.at}s  (rounds={args.rounds})")
    print(f"  before  median {ma:5.1f}   {A}")
    print(f"  after   median {mb:5.1f}   {B}")
    print(f"  delta   {mb - ma:+.1f} fps")
    return 0


if __name__ == "__main__":
    sys.exit(main())
