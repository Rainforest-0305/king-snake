# -*- coding: utf-8 -*-
"""hud_feed_churn.py - 킬 피드 높이가 «실제로» 얼마나 자주·얼마나 크게 변하는가.

  python tools/hud_feed_churn.py <distDir> [seconds] [locale]

왜 재는가: 기록 돌파 배너를 킬 피드 «아래»에 흐름으로 붙였다. 그러면 피드가
높아질 때 배너가 내려간다 - 즉 «탭 타깃이 움직인다». 그게 얼마나 잦고 얼마나
큰지를 «추측하지 않고» 잰다. 킬은 세계 전체에서 난다(world.ts onKill = 봇 90마리
전부) 이므로 「가끔이겠지」는 근거가 아니다.

측정: MutationObserver 없이 rAF 마다 .hud-feed 높이를 표본화(부하 최소).
      배너가 떠 있는 5초(GROWTH_OFFER_S) 창 안에서의 «변화 횟수·최대 이동»도 낸다.
headless 고정.
"""
from __future__ import annotations

import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

# ★첫 판은 5초 만에 죽었다(실측). 「죽어서 HUD 가 감춰진 것」을 「피드가 0 이 된 것」
#   으로 세면 통째로 거짓말이 된다. 그래서 «살아 있는 프레임만» 표본에 넣고,
#   죽으면 스스로 다시 시작해 목표 시간을 채운다.
WATCH = """(sec) => new Promise((res) => {
  const feed = document.querySelector('.hud-feed');
  const samples = [];
  let alive = 0;         // 살아 있는 채로 흐른 시간(초)
  let last = performance.now();
  let prevH = -1;
  const step = () => {
    const now = performance.now();
    const dt = (now - last) / 1000; last = now;
    const st = window.__coilReward.state();
    if (st.mode !== 'play' || !st.player.alive) {
      window.__coil.startRun();            // 죽었으면 다시 시작 - 시간은 안 센다
      requestAnimationFrame(step); return;
    }
    alive += Math.min(dt, 0.25);
    const h = feed.getBoundingClientRect().height;
    const n = feed.children.length;
    if (prevH < 0 || Math.abs(prevH - h) > 0.5) {
      samples.push({ t: +alive.toFixed(3), h: +h.toFixed(1), n });
      prevH = h;
    }
    if (alive < sec) requestAnimationFrame(step); else res({ samples, alive });
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


def main() -> int:
    dist = Path(sys.argv[1]).resolve()
    sec = float(sys.argv[2]) if len(sys.argv) > 2 else 60.0
    lang = sys.argv[3] if len(sys.argv) > 3 else None
    port, srv = serve(dist)
    save = {"v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
            "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
            "control": "joystick", "sound": True, "locale": lang}
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                            is_mobile=True, has_touch=True,
                            locale="de-DE" if lang == "de" else "ko-KR")
        ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                            % json.dumps(json.dumps(save, ensure_ascii=False)))
        page = ctx.new_page()
        page.goto(f"http://127.0.0.1:{port}/?debug=1&quiet=1&seed=11", wait_until="load")
        page.wait_for_timeout(800)
        page.evaluate("() => window.__coil.startRun()")
        page.wait_for_timeout(400)
        got = page.evaluate(WATCH, sec)
        samples, alive = got["samples"], got["alive"]
        b.close()
    srv.shutdown()

    sec = alive
    print(f"관측(살아 있던 시간만) {sec:.1f}초 · locale={lang or 'ko'} · "
          f"표본(높이가 바뀐 순간만) {len(samples)}건")
    hs = [s["h"] for s in samples]
    print(f"  높이 범위 {min(hs):.1f} ~ {max(hs):.1f}px · 변화 {len(samples) - 1}회 "
          f"= 초당 {(len(samples) - 1) / sec:.2f}회")
    # 5초(배너 수명) 창 안에서 몇 번 움직이나 / 얼마나 움직이나
    worst_n, worst_d = 0, 0.0
    for i, s in enumerate(samples):
        win = [q for q in samples[i:] if q["t"] <= s["t"] + 5.0]
        if len(win) - 1 > worst_n:
            worst_n = len(win) - 1
        d = max(q["h"] for q in win) - min(q["h"] for q in win)
        if d > worst_d:
            worst_d = d
    print(f"  ★배너 수명 5초 창 최악: 이동 {worst_n}회 · 최대 진폭 {worst_d:.1f}px")
    seen = {}
    for s in samples:
        seen[s["n"]] = seen.get(s["n"], 0) + 1
    print("  줄 수 분포(변화 시점 기준):", json.dumps(seen))
    print("  처음 12건:", json.dumps(samples[:12]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
