"""perf.py - 실측 FPS 벤치(성장 단계별 x 렌더 백엔드별).

★ 왜 이 스크립트가 따로 필요한가:
  qa_render.py 는 「부팅 직후 작은 뱀」의 FPS만 봤다. 이 게임의 부하는 «후반»에
  온다 - 뱀이 굵고 길어지면 가산합성 글로우의 채움률이 폭증한다.
  실제로 초반 60fps / 2분 뒤 32fps 라는 차이를 이 스크립트가 잡아냈다.

★ 두 백엔드를 «둘 다» 잰다:
    gpu      : --enable-gpu (하드웨어 래스터) - 실제 PC/폰에 가까운 조건
    software : 플래그 없음  (SwiftShader)    - 저사양 기기의 «하한» 대리 지표
  둘을 섞어 보면 「내 노트북에선 되는데」류의 오판을 막을 수 있다.

실행:
  python tools/perf.py
  python tools/perf.py --at 10,60,150
"""

from __future__ import annotations

import argparse
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("playwright 가 없다: pip install playwright && playwright install chromium")
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(DIST), **kw)

    def log_message(self, *a):
        pass


def serve():
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1], httpd


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

STATE = """() => {
  const b = document.querySelectorAll('.hud-score b');
  return { len: b[0] && b[0].textContent, rank: b[1] && b[1].textContent };
}"""

GPU_ARGS = ["--enable-gpu", "--use-gl=angle", "--use-angle=default", "--ignore-gpu-blocklist"]


def run(pw, base, backend, w, h, mobile, ats, seed):
    args = GPU_ARGS if backend == "gpu" else []
    browser = pw.chromium.launch(args=args)
    ctx = browser.new_context(
        viewport={"width": w, "height": h},
        device_scale_factor=2 if mobile else 1,
        is_mobile=mobile,
        has_touch=mobile,
        locale="en-US",
    )
    page = ctx.new_page()
    page.goto(f"{base}/?demo=1&debug=1&seed={seed}", wait_until="load")

    rows = []
    prev = 0
    for at in ats:
        page.wait_for_timeout(max(200, (at - prev) * 1000))
        prev = at
        r = page.evaluate(FPS_PROBE, 3000)
        prev += 3
        st = page.evaluate(STATE)
        rows.append({
            "at": at, "fps": round(r["fps"], 1), "worstMs": round(r["worst"], 1),
            "len": st["len"], "rank": st["rank"],
        })
        print(f"    t={at:>3}s  fps={r['fps']:5.1f}  worst={r['worst']:5.1f}ms  len={st['len']}")
    ctx.close()
    browser.close()
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--at", default="8,45,120")
    ap.add_argument("--seed", type=int, default=20260818)
    # ★ 조정 반복용. 전체 4조합은 9분이 걸려 「고치고 재는」 사이클이 죽는다.
    ap.add_argument("--only", default="", help="예: gpu/desktop,software/desktop")
    ap.add_argument("--dist", default="", help="serve this directory instead of dist/ (A/B)")
    ap.add_argument("--out", default="", help="write json here instead of qa/perf.json")
    args = ap.parse_args()
    ats = [int(x) for x in args.at.split(",")]
    global DIST
    if args.dist:
        DIST = Path(args.dist).resolve()

    if not (DIST / "index.html").exists():
        print("dist 가 없다. 먼저: npm run build:web")
        return 2

    port, httpd = serve()
    base = f"http://127.0.0.1:{port}"
    out = {}
    with sync_playwright() as pw:
        only = [x.strip() for x in args.only.split(",") if x.strip()]
        for backend in ("gpu", "software"):
            for name, w, h, mob in (("desktop", 1600, 900, False), ("mobile", 390, 844, True)):
                key = f"{backend}/{name}"
                if only and key not in only:
                    continue
                print(f"[perf] {key}")
                out[key] = run(pw, base, backend, w, h, mob, ats, args.seed)
    httpd.shutdown()

    (ROOT / "qa").mkdir(exist_ok=True)
    outp = Path(args.out) if args.out else (ROOT / "qa" / "perf.json")
    outp.write_text(json.dumps(out, indent=2), encoding="utf-8")

    print("\n== 요약(최저 fps) ==")
    ok = True
    for k, rows in out.items():
        lo = min(r["fps"] for r in rows)
        flag = "OK " if lo >= 55 else ("WARN" if lo >= 45 else "FAIL")
        if lo < 45 and k.startswith("gpu"):
            ok = False
        print(f"  {flag}  {k:<18} min {lo:5.1f} fps")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
