# -*- coding: utf-8 -*-
"""qa_scale_render.py — 거대 뱀 «비늘»이 어떻게 깨지는지 «찍는다».

  python tools/qa_scale_render.py <distDir> <tag>

★ 추측으로 고치지 않기 위한 도구다. 깨진 픽셀을 먼저 남긴다.
  ① 정지 ② 이동 중 ③ 카메라 스크롤 중 — 같은 좌표에서 찍는다.
  ④ 몸통 «확대 크롭» — device_scale_factor 를 올려 실제 확대 픽셀을 뜬다.
     (이미지 후처리 업스케일이 아니라 «그 배율로 렌더된» 픽셀이다.)

★ 함께 남기는 수치
  - 플레이어 반지름 r, 화면 배율 zoom, 화면 반지름 r*zoom
  - 비늘 패턴 배율 k = max(0.35, r/9)  ← 24px 타일이 몇 배로 늘어나는가
  - 프레임 시간 표본(이동 중)
★ 헤드리스 전용.
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
OUT = ROOT / "_render_260908"
VW, VH = 390, 844
SAVE = {"v": 1, "savedAt": 0, "bestScore": 6000, "bestRank": 1, "games": 40,
        "totalKills": 30, "playSeconds": 5000, "nick": "", "skin": "corn",
        "control": "joystick", "sound": False, "locale": None}

# 프레임 시간 수집기 — 빌드에 손대지 않는다.
FT = """
(function () {
  if (window.__ft) return;
  var S = { on: 0, t: [], last: 0 };
  window.__ft = S;
  var raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return raf(function (t) {
      if (S.on && S.last) S.t.push(t - S.last);
      S.last = t;
      return cb(t);
    });
  };
  S.begin = function () { S.t = []; S.last = 0; S.on = 1; };
  S.end = function () { S.on = 0; return S.t; };
})();
"""


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


def pct(v, q):
    if not v:
        return -1.0
    v = sorted(v)
    i = min(len(v) - 1, max(0, int(round((len(v) - 1) * q))))
    return v[i]


def main() -> int:
    dist = Path(sys.argv[1]).resolve()
    tag = sys.argv[2] if len(sys.argv) > 2 else "scale"
    # 비늘이 «가장 잘 보이는» 스킨: rings/saddle 대비가 큰 것 + 거대 질량
    skin = sys.argv[3] if len(sys.argv) > 3 else "corn"
    # 4번째 인자: ?layers=N (비늘 비트 128 을 빼면 «비늘만» 끈 A/B 가 된다)
    layers = sys.argv[4] if len(sys.argv) > 4 else ""
    port, srv = serve(dist)
    OUT.mkdir(parents=True, exist_ok=True)
    res = {"tag": tag, "skin": skin}
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(headless=True, args=["--force-device-scale-factor=1"])
            save = dict(SAVE)
            save["skin"] = skin
            ctx = b.new_context(viewport={"width": VW, "height": VH},
                                device_scale_factor=3, is_mobile=True,
                                has_touch=True, locale="ko-KR")
            ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                                % json.dumps(json.dumps(save, ensure_ascii=False)))
            ctx.add_init_script(FT)
            page = ctx.new_page()
            page.goto("http://127.0.0.1:%d/?debug=1&quiet=1&seed=7%s"
                      % (port, ("&layers=" + layers) if layers else ""),
                      wait_until="load")
            page.wait_for_timeout(900)
            page.evaluate("() => window.__coil.startRun()")
            page.wait_for_timeout(700)
            page.evaluate("() => window.__coil.ghost(9000)")
            # 거대 뱀: 플레이어를 최대급으로 + 주변에 거대 봇 3마리
            page.evaluate("() => window.__coil.stress(3, 5200, false, 5200, 'grid')")
            page.wait_for_timeout(900)

            st = page.evaluate("""() => {
              const s = window.__coil.state();
              const f = window.__coil.frame();
              const me = f.snakes.find(x => x.mine) || f.snakes[0];
              return { mass: me.mass, zoom: f.zoom, fps: f.fps,
                       drawn: f.drawn.length, culled: f.culled.length,
                       tier: f.tier, scale: f.scale };
            }""")
            # r = R_MIN + (R_MAX-R_MIN) * t,  t 는 질량곡선 — 화면에서 직접 잰다
            res["state"] = st

            def shot(name, clip=None):
                p = OUT / ("scale_%s_%s.png" % (tag, name))
                page.screenshot(path=str(p), clip=clip)
                return p.name

            # ── ① 정지 ──
            page.evaluate("() => window.__coil.freeze && window.__coil.freeze(true)")
            page.wait_for_timeout(200)
            res["shot_still"] = shot("1_still")
            # 몸통 확대 크롭(화면 중앙 부근 120x120 css px)
            res["shot_zoom"] = shot("2_zoom", {"x": VW / 2 - 60, "y": VH / 2 - 20,
                                               "width": 120, "height": 120})
            page.evaluate("() => window.__coil.freeze && window.__coil.freeze(false)")

            # ── ② 이동 중 + 프레임 시간 ──
            cdp = ctx.new_cdp_session(page)
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
            page.wait_for_timeout(400)
            page.evaluate("() => window.__ft.begin()")
            # 조종해서 «카메라가 스크롤»되게 한다
            for i in range(14):
                cdp.send("Input.dispatchTouchEvent", {
                    "type": "touchStart" if i == 0 else "touchMove",
                    "touchPoints": [{"x": 195.0 + (i % 5) * 12, "y": 500.0 - i * 6, "id": 0}]})
                page.wait_for_timeout(120)
            ft = page.evaluate("() => window.__ft.end()")
            cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
            res["shot_moving"] = shot("3_moving")
            res["shot_moving_zoom"] = shot("4_moving_zoom",
                                           {"x": VW / 2 - 60, "y": VH / 2 - 20,
                                            "width": 120, "height": 120})
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})

            ft = [x for x in ft if x > 0.1]
            res["frametime_cpu4"] = {
                "n": len(ft),
                "p50": round(pct(ft, 0.50), 2),
                "p95": round(pct(ft, 0.95), 2),
                "p99": round(pct(ft, 0.99), 2),
                "mean": round(statistics.mean(ft), 2) if ft else -1,
                "max": round(max(ft), 2) if ft else -1,
            }
            res["stats_after"] = page.evaluate("""() => {
              const f = window.__coil.frame();
              return { fps: f.fps, drawn: f.drawn.length, culled: f.culled.length,
                       zoom: f.zoom, scale: f.scale, tier: f.tier };
            }""")
            ctx.close()
            b.close()
    finally:
        srv.shutdown()

    (OUT / ("scale_%s.json" % tag)).write_text(
        json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    s = res["state"]
    f = res["frametime_cpu4"]
    print("== 거대 비늘 뱀 렌더/성능 [%s] skin=%s" % (tag, skin))
    print("  질량 %s  zoom %.3f  그린 뱀 %s  컬링 %s  tier %s  renderScale %s"
          % (s["mass"], s["zoom"], s["drawn"], s["culled"], s["tier"], s["scale"]))
    print("  프레임시간(4배 스로틀, 이동 중)  n=%d  p50 %.2f  p95 %.2f  p99 %.2f  max %.2f ms"
          % (f["n"], f["p50"], f["p95"], f["p99"], f["max"]))
    print("  샷:", res["shot_still"], res["shot_zoom"], res["shot_moving"], res["shot_moving_zoom"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
