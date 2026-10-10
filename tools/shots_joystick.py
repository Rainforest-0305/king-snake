# -*- coding: utf-8 -*-
"""shots_joystick.py — 조이스틱 «시각 상태 4종» 실렌더 + «각도 원장» 실측.

  python tools/shots_joystick.py <distDir> <outTag>

★ 무엇을 재는가 (두 가지, 분리해서 낸다)
  1) SHOTS  — 쉴 때 / 잡았을 때 / 최대치 / 놓은 직후. 390x844 세로, HUD 전부 뜬 상태.
     President 불만(「조이스틱이 안 보여서 불편해」)의 판정 대상이 «쉴 때» 컷이다.
  2) ANGLES — 같은 드래그에서 나오는 aimAngle 을 «전 자릿수» 그대로 덤프한다.
     시각을 바꾸면서 조작감이 바뀌지 않았음을 증명하는 유일한 방법이다.
     ⛔ 반올림해서 비교하지 않는다 — repr() 로 박아 바이트 비교한다.

★ headless 고정. 창을 하나도 띄우지 않는다(President 가 같은 컴퓨터에서 업무 중).
★ CDP Input.dispatchTouchEvent = «신뢰된» 터치. page.touchscreen 보다 실기기에 가깝고,
  하네스(joystick_start_harness.py)와 같은 경로라 결과를 나란히 놓을 수 있다.
"""
from __future__ import annotations

import http.server
import json
import socketserver
import sys
import threading
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUTBASE = ROOT / "_joy_260903"
VW, VH = 390, 844
DPR = 2

# 저장값: 「이미 몇 판 해 본 사람」. ★유령 스틱(hintAlpha)은 판마다 리셋되므로
# 저장값으로는 못 끈다 — 아래에서 «실제로 한 번 조종해» 끈 뒤 쉴 때 컷을 찍는다.
SAVE = {
    "v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
    "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
    "control": "joystick", "sound": False, "locale": None,
}

GEOM_JS = r"""() => {
  const s = (window.__coil && window.__coil.state) ? window.__coil.state() : null;
  const q = (sel) => { const n = document.querySelector(sel); if (!n) return null;
    const r = n.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return null;
    return { x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1),
             right:+r.right.toFixed(1), bottom:+r.bottom.toFixed(1) }; };
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;'
    + 'padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);'
    + 'padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);';
  document.body.appendChild(probe);
  const ps = getComputedStyle(probe);
  const safe = { t: ps.paddingTop, r: ps.paddingRight, b: ps.paddingBottom, l: ps.paddingLeft };
  probe.remove();
  const play = document.querySelector('.btn-primary');
  return {
    state: s, safe,
    playVisible: !!(play && play.getBoundingClientRect().width > 0),
    rects: { score:q('.hud-score'), board:q('.hud-board'), pause:q('.hud-pause'),
             feed:q('.hud-feed'), left:q('.hud-left'), mini:q('.hud-mini'),
             minimap:q('#minimap'), stage:q('#stage') },
    vw: innerWidth, vh: innerHeight,
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


class Rig:
    def __init__(self, page, cdp):
        self.page, self.cdp = page, cdp

    def touch(self, kind, pts):
        self.cdp.send("Input.dispatchTouchEvent", {
            "type": kind,
            "touchPoints": [{"x": float(x), "y": float(y), "id": i}
                            for i, (x, y) in enumerate(pts)],
        })

    def tap(self, x, y):
        self.touch("touchStart", [(x, y)])
        self.page.wait_for_timeout(50)
        self.touch("touchEnd", [])

    def geom(self):
        return self.page.evaluate(GEOM_JS)

    def wait_started(self, ms=8000):
        t0 = time.time()
        while (time.time() - t0) * 1000 < ms:
            g = self.geom()
            if g["state"] and g["state"]["mode"] == "play":
                return g
            self.page.wait_for_timeout(50)
        return None

    def start_run(self):
        """메뉴의 «시작» 버튼을 실제로 탭한다(DOM 경로를 우회하지 않는다)."""
        for sel in (".btn-primary", ".btn-play"):
            n = self.page.query_selector(sel)
            if n:
                r = n.bounding_box()
                if r and r["width"] > 0:
                    self.tap(r["x"] + r["width"] / 2, r["y"] + r["height"] / 2)
                    g = self.wait_started()
                    if g:
                        return g
        # 폴백: 하네스 훅
        self.page.evaluate("() => window.__coil.startRun()")
        return self.wait_started()


def shot(page, out: Path, name: str):
    out.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(out / (name + ".png")))
    print("   shot " + name + ".png")


# ── 각도 원장 ───────────────────────────────────────────────────────────────
# 원점 하나에서 뻗어 나가는 «고정» 델타 표. 데드존 안(1,3,4) · 경계(5) ·
# 보통(20,40) · 최대치 밖(90,140) 을 전부 지난다. 각도는 STICK_MAX 클램프와
# 무관해야 하므로(클램프는 «노브 그림»만 건드린다) 90/140 도 20 과 같은 각을 낸다.
PROBE_ORIGIN = (150.0, 560.0)
PROBE_DELTAS = []
for _d in (1, 3, 4, 5, 8, 12, 20, 40, 58, 59, 90, 140):
    for _k in range(8):                      # 8방위
        import math as _m
        _a = _m.pi * 2 * _k / 8
        PROBE_DELTAS.append((round(_m.cos(_a) * _d, 4), round(_m.sin(_a) * _d, 4), _d, _k))


def probe_angles(rig: Rig) -> list:
    """같은 제스처에서 나오는 aim 을 «전 자릿수» 그대로 모은다."""
    page = rig.page
    rows = []
    ox, oy = PROBE_ORIGIN
    page.evaluate("() => window.__coil.ghost(600)")
    for dx, dy, d, k in PROBE_DELTAS:
        rig.touch("touchStart", [(ox, oy)])
        page.wait_for_timeout(30)
        rig.touch("touchMove", [(ox + dx, oy + dy)])
        page.wait_for_timeout(60)
        st = page.evaluate("() => { const s = window.__coil.state(); return { aim: s.aim, stick: s.stick }; }")
        rig.touch("touchEnd", [])
        page.wait_for_timeout(40)
        rows.append({"d": d, "k": k, "dx": dx, "dy": dy,
                     "aim": repr(st["aim"]), "stick": st["stick"]})
    return rows


def main() -> int:
    dist = Path(sys.argv[1]).resolve()
    tag = sys.argv[2]
    out = OUTBASE / "shots" / tag
    port, srv = serve(dist)
    errs: list[str] = []
    data: dict = {}

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)          # ★headless 고정 — 창 0
        ctx = b.new_context(viewport={"width": VW, "height": VH},
                            device_scale_factor=DPR, is_mobile=True,
                            has_touch=True, locale="ko-KR")
        ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                            % json.dumps(json.dumps(SAVE, ensure_ascii=False)))
        page = ctx.new_page()
        page.on("pageerror", lambda e: errs.append(str(e)[:300]))
        page.on("console", lambda m: errs.append("console:" + m.text[:200])
                if m.type == "error" else None)
        page.goto(f"http://127.0.0.1:{port}/?debug=1&quiet=1&seed=7", wait_until="load")
        page.wait_for_timeout(900)

        cdp = ctx.new_cdp_session(page)
        rig = Rig(page, cdp)

        g = rig.start_run()
        if not g:
            print("!! 판 시작 실패")
            return 2
        page.wait_for_timeout(700)
        # ★ 촬영 동안 죽지 않게 «기존 무적 시간»을 늘린다. 안 하면 손가락을
        #   얹고 버티는 사이 봇에 부딪혀 mode='dead' 가 되고, 그 프레임에는
        #   drawTouchControls 가 아예 안 돌아 «빈 컷»이 찍힌다(1차 실측에서 그랬다).
        page.evaluate("() => window.__coil.ghost(600)")
        data["geom_at_start"] = g

        # ── ① 「쉴 때」 — ★한 번 조종해서 유령 스틱을 «끈 뒤에» 찍는다.
        #    안 끄면 옛 빌드도 무언가 보이는 컷이 나와 비교가 통째로 거짓이 된다.
        rig.touch("touchStart", [(150.0, 560.0)])
        page.wait_for_timeout(50)
        rig.touch("touchMove", [(190.0, 560.0)])
        page.wait_for_timeout(120)
        rig.touch("touchEnd", [])
        page.wait_for_timeout(900)                     # 복귀 애니메이션이 끝나도록
        data["rest"] = rig.geom()
        shot(page, out, "1_rest")

        # ── ② 「잡았을 때」 — 손가락만 얹은 상태(노브 중앙).
        rig.touch("touchStart", [(150.0, 560.0)])
        page.wait_for_timeout(220)
        data["grab"] = rig.geom()
        shot(page, out, "2_grab")

        # ── ③ 「최대치」 — STICK_MAX(58) «밖»으로 끌어 클램프를 보이게.
        rig.touch("touchMove", [(150.0 + 96.0, 560.0 - 96.0)])
        page.wait_for_timeout(220)
        data["max"] = rig.geom()
        shot(page, out, "3_max")

        # ── ④ 「놓은 직후」 — 복귀 애니메이션 «중간».
        #    ★ease-out 은 앞이 빠르다: 160ms 짜리인데 90ms 면 이미 92% 가 끝나
        #      「이미 제자리」로 찍힌다(1차 실측에서 그랬다). 40ms(=63%) 로 잡는다.
        rig.touch("touchEnd", [])
        page.wait_for_timeout(40)
        data["release"] = rig.geom()
        shot(page, out, "4_release")
        page.wait_for_timeout(700)
        data["settled"] = rig.geom()
        shot(page, out, "5_settled")

        # ── 각도 원장 ──
        data["angles"] = probe_angles(rig)

        ctx.close()
        b.close()
    srv.shutdown()

    data["errors"] = errs
    (OUTBASE / "shots").mkdir(parents=True, exist_ok=True)
    (OUTBASE / "shots" / f"data_{tag}.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"== {tag}: shots -> {out}")
    print(f"   errors: {len(errs)}")
    for e in errs[:5]:
        print("   ! " + e)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
