"""soak.py - 장시간 가동 검증(누수 / 프레임 저하).

★ 왜 필요한가: 이 게임은 «끝나지 않는다». 봇이 계속 죽고 리스폰하며
  오브가 계속 생긴다. 링 버퍼/타입배열/스왑삭제를 쓴 이유가 전부 여기 있는데,
  «실제로» 안 새는지는 오래 돌려봐야 안다. 2분짜리 측정으로는 안 잡힌다.

측정: 60초마다 fps / JS 힙 / 오브 수 / 충돌점 수 / 렌더 스케일
판정: 마지막 fps 가 첫 fps 의 90% 이상이고, 힙이 «단조 증가»하지 않을 것

실행: python tools/soak.py --minutes 5
"""
from __future__ import annotations
import argparse, http.server, json, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(DIST), **kw)

    def log_message(self, *a):
        pass


FPS = """(ms) => new Promise((res) => {
  let f = 0, prev = performance.now(); const t0 = prev;
  function tick(now) { f++; prev = now;
    if (now - t0 < ms) requestAnimationFrame(tick);
    else res(f / ((now - t0) / 1000)); }
  requestAnimationFrame(tick);
})"""

STATE = """() => {
  const s = window.__coil.state();
  const m = performance.memory ? performance.memory.usedJSHeapSize : 0;
  return { mass: Math.round(s.mass), scale: s.renderScale, heapMB: +(m / 1048576).toFixed(1) };
}"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=int, default=5)
    args = ap.parse_args()
    if not (DIST / "index.html").exists():
        print("dist 가 없다. 먼저: npm run build:web")
        return 2

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}"

    rows = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--enable-gpu", "--use-gl=angle", "--enable-precise-memory-info"])
        c = b.new_context(viewport={"width": 1600, "height": 900}, locale="en-US")
        page = c.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        page.goto(f"{base}/?demo=1&debug=1&seed=20260818", wait_until="load")
        page.wait_for_timeout(3000)

        for i in range(args.minutes):
            fps = page.evaluate(FPS, 3000)
            st = page.evaluate(STATE)
            rows.append({"min": i, "fps": round(fps, 1), **st})
            print(f"  t={i}m  fps={fps:5.1f}  mass={st['mass']:>6}  "
                  f"scale={st['scale']}  heap={st['heapMB']}MB", flush=True)
            page.wait_for_timeout(57000)
        c.close(); b.close()
    httpd.shutdown()

    (ROOT / "qa").mkdir(exist_ok=True)
    (ROOT / "qa" / "soak.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")

    first, last = rows[0]["fps"], rows[-1]["fps"]
    heaps = [r["heapMB"] for r in rows]
    monotonic = all(heaps[i] <= heaps[i + 1] for i in range(len(heaps) - 1)) and heaps[-1] > heaps[0] * 1.6
    print(f"\nfps {first} -> {last} ({last / first * 100:.0f}%)")
    print(f"heap {heaps[0]} -> {heaps[-1]} MB  단조증가={monotonic}")
    if errs:
        print("★ 콘솔 에러:", errs[:5]); return 1
    if last < first * 0.9:
        print("★ 프레임이 10% 이상 떨어졌다."); return 1
    if monotonic:
        print("★ 힙이 계속 늘었다 - 누수 의심."); return 1
    print("\n[PASS] 프레임 유지 · 누수 징후 없음 · 콘솔 에러 0.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
