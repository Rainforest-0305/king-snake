# -*- coding: utf-8 -*-
"""hud_frame_ab.py - 「배너가 «떠 있는 동안»」의 프레임 시간을 전/후로 짝지어 잰다.

  python tools/hud_frame_ab.py <beforeDir> <afterDir> [pairs] [seconds] [cpuThrottle]

★ 왜 따로 재는가: perf_ab.py 는 데모(배너 없음)를 잰다. 이번 변경은 배너를
  position:fixed -> «HUD 흐름 안»으로 옮긴 것이라, 비용이 생긴다면 «배너가 떠
  있는 프레임»에서 생긴다. 안 떠 있는 화면만 재면 그 비용을 통째로 놓친다.
★ 배너는 5초 뒤 스스로 사라지므로 측정 동안 «계속 보이게» 되살리고, 운영과
  같은 방식으로 남은시간 막대(transform: scaleX)도 계속 갱신한다.
★ A B A B 로 번갈아 잰다(노트북 발열·다른 프로세스 드리프트를 양쪽에 똑같이 싣는다).
★ headless 고정 · 창 0 · 광고 스텁만(운영 광고 ID 렌더 0).
"""
from __future__ import annotations

import http.server
import json
import socketserver
import statistics
import sys
import threading
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SAVE = {"v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
        "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
        "control": "joystick", "sound": True, "locale": None}
STUB = {"load": "ok", "show": "reward", "supported": True}

# 배너를 계속 보이게 하고(운영에선 5초) 막대도 계속 움직인다 - 운영과 같은 스타일 쓰기.
KEEP = """() => {
  const b = document.querySelector('.rw-offer');
  const bar = document.querySelector('.rw-offer-bar');
  if (!b) return false;
  window.__keep = setInterval(() => {
    b.classList.remove('hidden');
    const f = (Math.sin(performance.now() / 900) + 1) / 2;
    bar.style.transform = 'scaleX(' + f.toFixed(3) + ')';
  }, 100);
  return true;
}"""

FRAMES = """(sec) => new Promise((res) => {
  const d = [];
  let last = performance.now();
  const t0 = last;
  const step = () => {
    const now = performance.now();
    d.push(now - last); last = now;
    if (now - t0 < sec * 1000) requestAnimationFrame(step);
    else res({ d, shown: !document.querySelector('.rw-offer').classList.contains('hidden') });
  };
  requestAnimationFrame(step);
})"""


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


def pct(v, p):
    v = sorted(v)
    return v[min(len(v) - 1, int(len(v) * p))]


def once(pw, port, sec, cpu):
    b = pw.chromium.launch(headless=True,
                           args=["--enable-gpu", "--use-gl=angle", "--ignore-gpu-blocklist"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3,
                        is_mobile=True, has_touch=True, locale="ko-KR")
    ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                        % json.dumps(json.dumps(SAVE, ensure_ascii=False)))
    page = ctx.new_page()
    cdp = ctx.new_cdp_session(page)
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": cpu})
    page.goto(f"http://127.0.0.1:{port}/?debug=1&quiet=1&seed=7", wait_until="load")
    page.wait_for_timeout(900)
    page.evaluate("(b) => window.__coilAds.installStub(b)", STUB)
    page.evaluate("() => window.__coilReward.refresh()")
    page.evaluate("() => window.__coilReward.setBest(1200)")
    page.evaluate("() => window.__coil.startRun()")
    page.wait_for_timeout(700)
    page.evaluate("() => window.__coil.grow(1300)")
    page.wait_for_function("() => window.__coilReward.state().offer !== null", timeout=8000)
    ok = page.evaluate(KEEP)
    page.wait_for_timeout(400)
    got = page.evaluate(FRAMES, sec)
    d = [x for x in got["d"] if x > 0]
    b.close()
    if not ok or not got["shown"]:
        raise SystemExit("배너가 안 떠 있다 - 측정 무효")
    return {"fps": round(1000 * len(d) / sum(d), 2), "p50": round(pct(d, 0.50), 2),
            "p95": round(pct(d, 0.95), 2), "p99": round(pct(d, 0.99), 2),
            "n": len(d), "over16": round(100 * sum(1 for x in d if x > 16.7) / len(d), 1)}


def main() -> int:
    a_dir, b_dir = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    pairs = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    sec = float(sys.argv[4]) if len(sys.argv) > 4 else 30
    cpu = int(sys.argv[5]) if len(sys.argv) > 5 else 4
    pa, sa = serve(a_dir)
    pb, sb = serve(b_dir)
    A, B = [], []
    with sync_playwright() as pw:
        for i in range(pairs):
            ra = once(pw, pa, sec, cpu)
            rb = once(pw, pb, sec, cpu)
            A.append(ra); B.append(rb)
            print(f"  쌍 {i+1}: before {ra['fps']:6.2f} fps p95 {ra['p95']:5.1f} p99 {ra['p99']:5.1f}"
                  f"   |   after {rb['fps']:6.2f} fps p95 {rb['p95']:5.1f} p99 {rb['p99']:5.1f}")
    sa.shutdown(); sb.shutdown()
    print(f"\n390x844@3 · cpu {cpu}x · 배너 «떠 있는 채로» {sec:.0f}초 x {pairs}쌍")
    for name, R in (("before", A), ("after", B)):
        print(f"  {name:6s} fps median {statistics.median(x['fps'] for x in R):6.2f} "
              f"| p95 median {statistics.median(x['p95'] for x in R):5.2f} "
              f"| p99 median {statistics.median(x['p99'] for x in R):5.2f} "
              f"| >16.7ms {statistics.median(x['over16'] for x in R):5.1f}%")
    d = statistics.median(x['fps'] for x in B) - statistics.median(x['fps'] for x in A)
    print(f"  delta {d:+.2f} fps")
    return 0


if __name__ == "__main__":
    sys.exit(main())
