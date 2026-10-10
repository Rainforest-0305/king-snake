# -*- coding: utf-8 -*-
"""qa_joystick_device.py — 「헤드리스에선 보이는데 실기기엔 없다」를 좁힌다.

  python tools/qa_joystick_device.py <distDir> <tag>

★ 왜 필요한가 (2026-09-04 실사고)
  AFTER·AIT 헤드리스 컷에 조이스틱 베이스가 «분명히» 있었는데 President 실기기에는
  없었다. 즉 «헤드리스에서 보인다»는 근거가 되지 못한다. 헤드리스와 실기기가
  다른 조건을 «먼저 나열하고» 그 조건을 흉내 내서 다시 재는 것이 이 파일이다.

  다른 조건 4가지:
    ① DPR      헤드리스 2 / iPhone 실기기 3
    ② safe-area env(safe-area-inset-*) 가 헤드리스는 «전부 0», 실기기는 top 47~59·
                bottom 34 (노치·홈바). 이게 minimapRect → boostY → hintY 를 전부 민다.
    ③ 화면크기  390x844 / 393x852 / 430x932 …
    ④ 배경밝기  우리 대비 측정은 «빈 아레나» 위에서만 했다.

★ safe-area 를 헤드리스에서 «만드는» 법
  env() 는 브라우저가 정하는 값이라 CSS 로 못 넣는다. 대신 renderer.readSafeArea()
  가 «프로브 div 의 computed padding» 을 읽는다는 점을 이용한다 —
  getComputedStyle 을 감싸서 그 프로브에만 원하는 padding 을 돌려준다.
  ⇒ 앱 코드는 한 줄도 안 고치고 «실기기와 같은 입력»을 받게 된다.

★ 무엇을 답하나 (픽셀이 아니라 «좌표»로 답한다)
  - 베이스 중심·반지름이 화면 «안»인가
  - 진단 한 줄은 화면 안인가 (베이스는 밖인데 진단만 남는 경우를 가른다)
  - 질주 버튼·미니맵과 겹치는가
★ headless 고정. 창 0.
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
OUT = ROOT / "_joy_260903"
# ★ src/input.ts 의 STICK_MAX(링 반지름)와 «반드시» 같아야 한다. 2026-09-06 58→52.
STICK_MAX = 52

SAVE = {"v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
        "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
        "control": "joystick", "sound": False, "locale": None}

# ── 실기기 조건 ────────────────────────────────────────────────────────────
#  (라벨, 폭, 높이, DPR, safe top, right, bottom, left)
CASES = [
    ("headless-기존(대조군)", 390, 844, 2, 0, 0, 0, 0),
    ("iPhone14Pro",           393, 852, 3, 59, 0, 34, 0),
    ("iPhone15ProMax",        430, 932, 3, 62, 0, 34, 0),
    ("iPhoneSE3(노치없음)",    375, 667, 2, 20, 0, 0, 0),
    ("iPhone13mini",          375, 812, 3, 50, 0, 34, 0),
    ("Android-Pixel7",        412, 915, 2.6, 24, 0, 24, 0),
]

# ★ 프로브 div 에만 safe-area padding 을 돌려주도록 getComputedStyle 을 감싼다.
#   renderer.readSafeArea() 의 프로브는 cssText 에 'safe-area-inset' 문자열이 있다.
SAFE_SHIM = """(s) => {
  const orig = window.getComputedStyle.bind(window);
  window.getComputedStyle = function (el, pe) {
    const cs = orig(el, pe);
    try {
      const t = el && el.style && el.style.cssText;
      if (t && t.indexOf('safe-area-inset') >= 0) {
        return new Proxy(cs, {
          get(o, k) {
            if (k === 'paddingTop') return s.t + 'px';
            if (k === 'paddingRight') return s.r + 'px';
            if (k === 'paddingBottom') return s.b + 'px';
            if (k === 'paddingLeft') return s.l + 'px';
            const v = o[k];
            return typeof v === 'function' ? v.bind(o) : v;
          },
        });
      }
    } catch (e) { /* 원본 그대로 */ }
    return cs;
  };
}"""

GEOM = """([R]) => {
  const st = window.__coil.stick ? window.__coil.stick() : null;
  const s = window.__coil.state();
  const cv = document.getElementById('stage');
  const csw = parseFloat(cv.style.width), csh = parseFloat(cv.style.height);
  const mini = (function () {
    const m = window.__coilMini && window.__coilMini();
    return m || null;
  })();
  const home = st ? { x: st.homeX, y: st.homeY } : null;
  const diag = home ? { x: home.x - R, y: Math.min(csh - 6, home.y + R + 16) } : null;
  return {
    css: { w: csw, h: csh }, dpr: devicePixelRatio,
    inner: { w: innerWidth, h: innerHeight },
    canvasAttr: { w: cv.width, h: cv.height },
    home, diag, mini,
    boost: s.boostBtn, usedTouch: s.usedTouch, control: s.control, mode: s.mode,
    /* 베이스 원이 화면 «안»인가 — 링 상하좌우 끝점으로 판정 */
    baseBox: home ? { l: home.x - R, r: home.x + R, t: home.y - R, b: home.y + R } : null,
    onScreen: home ? (home.x - R >= 0 && home.x + R <= csw &&
                      home.y - R >= 0 && home.y + R <= csh) : null,
    diagOnScreen: diag ? (diag.x >= 0 && diag.y >= 0 && diag.y <= csh) : null,
  };
}"""


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
    tag = sys.argv[2]
    port, srv = serve(dist)
    rows = []
    outdir = OUT / "device" / tag
    outdir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)         # ★headless 고정
        for (name, w, h, dpr, st_, sr, sb, sl) in CASES:
            ctx = b.new_context(viewport={"width": w, "height": h},
                                device_scale_factor=dpr, is_mobile=True,
                                has_touch=True, locale="ko-KR")
            ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                                % json.dumps(json.dumps(SAVE, ensure_ascii=False)))
            ctx.add_init_script(
                "(%s)(%s)" % (SAFE_SHIM,
                              json.dumps({"t": st_, "r": sr, "b": sb, "l": sl})))
            page = ctx.new_page()
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)[:160]))
            page.goto(f"http://127.0.0.1:{port}/?debug=1&quiet=1&seed=7",
                      wait_until="load")
            page.wait_for_timeout(900)
            page.evaluate("() => window.__coil.startRun()")
            page.wait_for_timeout(1400)
            page.evaluate("() => window.__coil.ghost(600)")
            page.wait_for_timeout(300)
            g = page.evaluate(GEOM, [STICK_MAX])
            g["case"] = name
            g["want"] = {"w": w, "h": h, "dpr": dpr,
                         "safe": {"t": st_, "r": sr, "b": sb, "l": sl}}
            g["errors"] = errs
            page.screenshot(path=str(outdir / (name.replace("/", "_") + ".png")))
            rows.append(g)
            ctx.close()

            base = g.get("baseBox")
            print(f"{name:22s} dpr={g['dpr']} css={g['css']['w']}x{g['css']['h']}"
                  f" home={g['home']} onScreen={g['onScreen']}"
                  f" diagOnScreen={g['diagOnScreen']}")
            if base:
                print(f"{'':22s}   base l={base['l']:.0f} r={base['r']:.0f}"
                      f" t={base['t']:.0f} b={base['b']:.0f}"
                      f"  boost={g['boost']}  diag={g['diag']}")
            if errs:
                print(f"{'':22s}   !! {errs[:2]}")
        b.close()
    srv.shutdown()

    (OUT / f"device_{tag}.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    bad = [r["case"] for r in rows if r.get("onScreen") is False]
    print()
    print("화면 밖으로 나간 케이스:", bad or "없음")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
