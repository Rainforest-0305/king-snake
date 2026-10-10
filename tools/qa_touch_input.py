"""qa_touch_input.py - src/input.ts 터치 조작 «회귀» 검증. headless 전용.

★ 왜 qa_touch.py 와 «따로» 있나
  qa_touch.py 는 dist/ 를 띄워 게임 전체를 본다. 그래서 (1) dist 빌드에 의존하고
  (2) 실패해도 원인이 입력인지 월드인지 렌더인지 가려지지 않는다.
  이 스크립트는 input.ts 만 esbuild 로 «따로» 번들해서 최소 페이지에 붙인다.
  dist/ 를 읽지도 쓰지도 않는다(다른 레인의 .ait 산출물을 건드리면 안 된다).

★★ 엔진을 «둘 다» 돈다 (2026-08-25, 아이폰 실기기 회귀로 배운 것)
  Chromium 에서 전 항목 통과한 코드가 아이폰(WKWebView)에서 조이스틱이 안 움직였다.
  「Chromium 통과」는 「아이폰 통과」를 뜻하지 «않는다». Playwright 는 실제 WebKit 을
  번들하므로 여기서 같이 돌린다.

  ⚠ 두 엔진의 «터치 주입 방식이 다르다». 이건 한계이므로 숨기지 않고 적는다:
    chromium : CDP Input.dispatchTouchEvent → 브라우저가 만든 «진짜(trusted)» 터치.
               터치 이벤트와 포인터 이벤트가 모두 네이티브 경로로 발생한다.
    webkit   : Playwright 의 WebKit 은 tap 하나뿐이라 «드래그»를 못 만든다.
               그래서 진짜 Event 를 만들고 touches/changedTouches 만 주입한다.
               → 이벤트 «전달»은 진짜 WebKit 경로, «페이로드»는 합성이다.
               즉 WebKit 항목은 「내 로직이 WebKit 엔진에서 옳게 도는가」를 재는 것이지
               「WebKit 이 터치를 네이티브로 잘 전달하는가」를 재지 «못한다».
               후자는 실기기 말고는 잴 방법이 없다. 그 한계를 알고 읽어라.
  각 엔진에서 «신뢰 탭»(page.touchscreen.tap) 도 한 번 쳐서 네이티브 경로가
  실제로 우리 핸들러에 닿는지는 별도로 확인한다(trusted_tap_reaches_handler).

★ 「0건은 부재의 증거가 아니다」 - 2층 양성대조를 붙였다.
  1층: 항목마다 «반대 방향» 단언을 같이 둔다(6px 는 발화 / 1px 는 발화 안 함).
  2층: --positive-control 로 input.ts 의 결함을 «되살린» 번들을 만들어 같은
       검사를 돌리고, 지정한 항목이 «반드시 실패»하는지 확인한다.

실행:
  python tools/qa_touch_input.py                    # 회귀 검사(두 엔진)
  python tools/qa_touch_input.py --positive-control # 검사기가 살아있는지 확인
  python tools/qa_touch_input.py --all              # 둘 다
  python tools/qa_touch_input.py --engine webkit    # 한 엔진만
"""

from __future__ import annotations

import http.server
import json
import os
import re
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

# ★ 한글 출력이 cp949 콘솔에서 UnicodeEncodeError 로 죽던 결함. 환경변수로
#   우회하지 말고 여기서 못 박는다(PYTHONUTF8 을 잊은 사람이 또 당한다).
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("playwright 가 없다: pip install playwright && playwright install chromium webkit")
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
ESBUILD = ROOT / "node_modules" / "esbuild" / "bin" / "esbuild"

# 토스 웹뷰 실측 크기.
W, H = 390, 652

PAGE = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#06070c;
 overscroll-behavior:none;-webkit-user-select:none;user-select:none}
/* 실제 styles.css 와 같은 조건: 캔버스는 전면, HUD 는 그 위 */
#stage{position:fixed;inset:0;display:block;width:100%;height:100%;touch-action:none;z-index:1}
#hud{position:fixed;inset:0;z-index:5;pointer-events:none}
/* .hud-pause 는 HUD 에서 «유일하게» pointer-events:auto 인 요소다.
   조이스틱을 위로 끌면 손가락이 반드시 이 위를 지난다 - 그래서 재현 대상이다. */
.hud-pause{position:absolute;top:8px;left:50%;transform:translateX(-50%);pointer-events:auto;
 width:44px;height:44px;border-radius:99px;background:rgba(255,255,255,.12);border:1px solid #445}
</style></head><body>
<canvas id="stage"></canvas><div id="hud"><button class="hud-pause" id="pausebtn"></button></div>
<script>
// 합성 터치 디스패처(WebKit 용). 엔진마다 만들 수 있는 것이 다르다:
//   Chromium : new Touch() + new TouchEvent() → 진짜 객체
//   WebKit   : new Touch() 가 «Illegal constructor» 다(실측). 진짜 Event 를 만들고
//              touches/changedTouches 만 주입한다. 전달은 진짜, 페이로드는 합성.
window.__TDMODE = 'unused';
window.__TD = function (type, all, changed) {
  var el = document.getElementById('stage');
  function pt(p){ return {identifier:p[0],clientX:p[1],clientY:p[2],pageX:p[1],pageY:p[2],target:el}; }
  var A = all.map(pt), C = changed.map(pt);
  if (typeof Touch === 'function' && typeof TouchEvent === 'function') {
    try {
      var rt = function(p){ return new Touch({identifier:p[0],target:el,clientX:p[1],clientY:p[2],pageX:p[1],pageY:p[2]}); };
      var RA = all.map(rt), RC = changed.map(rt);
      window.__TDMODE = 'native';
      el.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:RA,targetTouches:RA,changedTouches:RC}));
      return;
    } catch (e) { /* WebKit → 아래 주입 방식 */ }
  }
  var e2 = new Event(type,{bubbles:true,cancelable:true});
  Object.defineProperty(e2,'touches',{value:A});
  Object.defineProperty(e2,'targetTouches',{value:A});
  Object.defineProperty(e2,'changedTouches',{value:C});
  window.__TDMODE = 'injected';
  el.dispatchEvent(e2);
};
</script>
<script type="module" src="./bundle.js"></script></body></html>
"""

ENTRY = """import {{ Input }} from '{input_path}';
const canvas = document.getElementById('stage');
const input = new Input(canvas);
window.__TOUCHLOG = [];
for (const t of ['touchstart','touchmove','touchend','touchcancel']) {{
  canvas.addEventListener(t, (e) => {{
    window.__TOUCHLOG.push(t + ' n=' + e.touches.length + ' ch=' + e.changedTouches.length);
  }}, true);
}}
function resize() {{
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = w; canvas.height = h;
  const r = Math.min(w, h) * 0.13;
  input.resize(w, h, 0, 0, h - 16 - r * 2);
}}
resize();
window.addEventListener('resize', resize);
// 게임 루프와 «같은 주기»로 update 를 돈다. update 안의 자가치유도 여기서 돈다.
(function loop() {{ input.update(); requestAnimationFrame(loop); }})();
window.__H = {{
  input,
  snap: () => ({{
    aim: input.aimAngle, boosting: input.boosting, usedTouch: input.usedTouch,
    visible: input.visual.visible, stick: input.visual.stickActive,
    steerId: input.steerId, boostId: input.boostId,
    touchDriven: input.touchDriven,
    extra: Array.from(input.extraTouches), activeCount: input.active.size,
    boostBtn: {{ x: input.visual.boostX, y: input.visual.boostY, r: input.visual.boostR }},
  }}),
}};
"""


# ── 서버 ────────────────────────────────────────────────────────────────────
def serve(directory: Path):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(directory), **kw)

        def log_message(self, *a):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1], httpd


def build(workdir: Path, input_ts: Path) -> None:
    """input.ts 를 최소 페이지용으로 번들한다. dist/ 는 건드리지 않는다."""
    workdir.mkdir(parents=True, exist_ok=True)
    rel = os.path.relpath(input_ts.with_suffix(""), workdir).replace("\\", "/")
    if not rel.startswith("."):
        rel = "./" + rel
    (workdir / "entry.js").write_text(ENTRY.format(input_path=rel), encoding="utf-8")
    (workdir / "index.html").write_text(PAGE, encoding="utf-8")
    r = subprocess.run(
        ["node", str(ESBUILD), str(workdir / "entry.js"), "--bundle", "--format=esm",
         "--target=es2019", f"--outfile={workdir / 'bundle.js'}"],
        capture_output=True, text=True, cwd=str(ROOT),
    )
    if r.returncode != 0:
        raise SystemExit("esbuild 실패:\n" + r.stdout + r.stderr)


# ── 터치 주입 드라이버 ──────────────────────────────────────────────────────
class TouchDriver:
    """id 를 키로 손가락을 관리한다. 엔진별 주입 방식 차이를 여기서 흡수한다."""

    def __init__(self, page, cdp=None):
        self.page = page
        self.cdp = cdp
        self.pts: dict[int, tuple[float, float]] = {}

    def _all(self):
        return [[i, x, y] for i, (x, y) in self.pts.items()]

    def _cdp(self, kind, points):
        self.cdp.send("Input.dispatchTouchEvent", {
            "type": kind, "touchPoints": [{"x": p[1], "y": p[2], "id": p[0]} for p in points]})

    def down(self, i, x, y):
        self.pts[i] = (x, y)
        if self.cdp:
            self._cdp("touchStart", self._all())
        else:
            self.page.evaluate("([t,a,c])=>window.__TD(t,a,c)",
                               ["touchstart", self._all(), [[i, x, y]]])

    def move(self, i, x, y):
        self.pts[i] = (x, y)
        if self.cdp:
            self._cdp("touchMove", self._all())
        else:
            self.page.evaluate("([t,a,c])=>window.__TD(t,a,c)",
                               ["touchmove", self._all(), [[i, x, y]]])

    def up(self, i):
        if i not in self.pts:
            return
        x, y = self.pts.pop(i)
        if self.cdp:
            self._cdp("touchEnd", [[i, x, y]])
        else:
            self.page.evaluate("([t,a,c])=>window.__TD(t,a,c)",
                               ["touchend", self._all(), [[i, x, y]]])

    def synth_move(self, i, x, y):
        """엔진과 무관하게 «합성» touchmove 를 쏜다.

        ★ 왜 필요한가: 「브라우저가 취소를 쐈는데 손가락은 아직 화면에 있다」는
          상황은 CDP 로 만들 수 없다(취소 뒤 move 를 보내면 프로토콜 오류다).
          그런데 그게 바로 아이폰에서 방어해야 하는 상황이다. 그래서 이 항목만은
          두 엔진 모두 합성으로 넣는다 - 재는 대상이 «브라우저»가 아니라
          «그 입력이 왔을 때 우리 로직이 회복하는가» 이기 때문이다.
        """
        self.pts[i] = (x, y)
        self.page.evaluate("([t,a,c])=>window.__TD(t,a,c)",
                           ["touchmove", self._all(), [[i, x, y]]])

    def cancel_all(self):
        changed = self._all()
        self.pts.clear()
        if not changed:
            return
        if self.cdp:
            self._cdp("touchCancel", [])
        else:
            self.page.evaluate("([t,a,c])=>window.__TD(t,a,c)", ["touchcancel", [], changed])

    def allup(self):
        for i in list(self.pts.keys()):
            self.up(i)


# ── 검사 본체 ───────────────────────────────────────────────────────────────
def run_checks(workdir: Path, engine: str, verbose: bool = True) -> dict[str, bool]:
    port, httpd = serve(workdir)
    url = f"http://127.0.0.1:{port}/index.html"
    ok: dict[str, bool] = {}
    detail: dict[str, object] = {}

    with sync_playwright() as pw:
        launcher = {"chromium": pw.chromium, "webkit": pw.webkit}[engine]
        br = launcher.launch()  # ⛔ headless 고정. headless=False 로 바꾸지 마라.

        # ── 데스크톱(마우스) ─────────────────────────────────────────────
        dctx = br.new_context(viewport={"width": 1280, "height": 800},
                              has_touch=False, is_mobile=False)
        dp = dctx.new_page()
        dp.goto(url, wait_until="load")
        dp.wait_for_timeout(350)

        s = dp.evaluate("()=>window.__H.snap()")
        # 1층 반대방향 대조: 모바일에서 «켜진다»면 데스크톱에서는 «꺼져» 있어야 한다.
        ok["desktop_controls_hidden"] = (s["usedTouch"] is False and s["visible"] is False)

        dp.mouse.move(900, 300)
        dp.wait_for_timeout(90)
        ok["desktop_mouse_aim"] = dp.evaluate("()=>window.__H.snap()")["aim"] is not None
        dp.mouse.down()
        dp.wait_for_timeout(90)
        ok["desktop_mouse_boost"] = dp.evaluate("()=>window.__H.snap()")["boosting"] is True
        # 커서가 HUD 일시정지 버튼(pointer-events:auto) «위»를 지나도 조준이 살아있는가.
        dp.mouse.move(640, 20)
        dp.wait_for_timeout(90)
        ok["desktop_aim_over_hud"] = dp.evaluate("()=>window.__H.snap()")["aim"] is not None
        dp.mouse.up()
        dp.wait_for_timeout(90)
        ok["desktop_mouse_release"] = dp.evaluate("()=>window.__H.snap()")["boosting"] is False
        dctx.close()

        # ── 모바일(토스 웹뷰 390x652) ────────────────────────────────────
        opts = dict(pw.devices["iPhone 14"])
        opts["viewport"] = {"width": W, "height": H}
        opts.pop("device_scale_factor", None)
        opts["locale"] = "ko-KR"
        ctx = br.new_context(**opts)
        page = ctx.new_page()
        errs: list[str] = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(url, wait_until="load")
        page.wait_for_timeout(400)

        cdp = ctx.new_cdp_session(page) if engine == "chromium" else None
        T = TouchDriver(page, cdp)

        def snap():
            return page.evaluate("()=>window.__H.snap()")

        def reset():
            T.allup()
            page.wait_for_timeout(50)
            page.evaluate("()=>{const i=window.__H.input;i.steerId=-1;i.boostId=-1;"
                          "i.extraTouches.clear();i.active.clear();i.capLost.clear();"
                          "i.visual.stickActive=false;i.visual.boostHeld=false;i.paused=false;}")
            page.wait_for_timeout(40)

        # 0) ★ 터치 이벤트 경로가 «활성»인가. 아이폰 회귀의 핵심 방어선이다.
        s = snap()
        ok["touch_path_active"] = s["touchDriven"] is True
        detail["firstFrame"] = s

        # 0b) ★ «진짜» 터치가 우리 핸들러에 닿는가(합성이 아닌 네이티브 경로 확인).
        page.evaluate("()=>{window.__TOUCHLOG.length=0;}")
        page.touchscreen.tap(150, 450)
        page.wait_for_timeout(250)
        tl = page.evaluate("()=>window.__TOUCHLOG.slice()")
        detail["trustedTapLog"] = tl
        ok["trusted_tap_reaches_handler"] = any(x.startswith("touchstart") for x in tl)
        reset()

        # 1) 첫 프레임부터 터치 컨트롤이 보이는가 (President 지시)
        ok["mobile_controls_visible_first_frame"] = (s["usedTouch"] is True and s["visible"] is True)

        # 2) ★ 조이스틱이 «실제로 움직이는가». 아이폰 증상(스틱은 보이는데 안 따라옴)
        #    을 그대로 잡는 항목이다. steerCX/CY 갱신 → aim 생성까지 본다.
        reset()
        T.down(0, 150, 450)
        page.wait_for_timeout(60)
        a = snap()
        T.move(0, 150, 380)
        page.wait_for_timeout(110)
        b = snap()
        ok["joystick_knob_follows_finger"] = (
            a["stick"] is True and a["steerId"] >= 0
            and b["steerId"] >= 0 and b["aim"] is not None)
        detail["joystickDrag"] = {"afterDown": a, "afterMove": b}
        reset()

        # 3) 데드존. [before] 10px 까지 무시, 11px 부터 발화.
        def moved(d: int) -> bool:
            reset()
            T.down(0, 150, 450)
            page.wait_for_timeout(50)
            T.move(0, 150, 450 - d)
            page.wait_for_timeout(90)
            v = snap()["aim"] is not None
            reset()
            return v

        ok["deadzone_small_nudge_steers"] = moved(6)
        ok["deadzone_control_1px_ignored"] = (moved(1) is False)

        # 4) 히스테리시스: 멀리 밀었다가 원점으로 돌아와도 방향을 유지하는가.
        reset()
        T.down(0, 150, 450)
        page.wait_for_timeout(50)
        T.move(0, 150, 380)
        page.wait_for_timeout(90)
        T.move(0, 151, 450)
        page.wait_for_timeout(90)
        ok["hysteresis_keeps_direction"] = snap()["aim"] is not None
        reset()

        # 5) 일시정지 → 재개. 손가락을 «든 채로» 재개해도 조종이 되는가.
        reset()
        T.down(0, 150, 450)
        page.wait_for_timeout(50)
        T.move(0, 150, 400)
        page.wait_for_timeout(70)
        page.evaluate("()=>window.__H.input.setPaused(true)")
        page.wait_for_timeout(50)
        page.evaluate("()=>window.__H.input.setPaused(false)")
        page.wait_for_timeout(50)
        T.move(0, 230, 380)
        page.wait_for_timeout(110)
        s = snap()
        ok["pause_resume_finger_still_down"] = (s["steerId"] >= 0 and s["aim"] is not None)
        reset()

        # 6) blur 로 상태가 비워져도, 그 손가락을 움직이면 되살아나는가.
        reset()
        T.down(0, 150, 450)
        page.wait_for_timeout(50)
        page.evaluate("()=>window.dispatchEvent(new Event('blur'))")
        page.wait_for_timeout(50)
        T.move(0, 200, 420)
        page.wait_for_timeout(70)
        T.move(0, 260, 360)
        page.wait_for_timeout(110)
        s = snap()
        ok["blur_ghost_finger_recovers"] = (s["steerId"] >= 0 and s["aim"] is not None)
        reset()

        # 7) ★ 취소(touchcancel) 됐는데 손가락이 «아직 화면에 있으면» 재획득하는가.
        #    WebKit 이 제스처를 가로채 cancel 을 쏘는 경우의 방어선이다.
        reset()
        T.down(0, 150, 450)
        page.wait_for_timeout(50)
        T.move(0, 150, 400)
        page.wait_for_timeout(70)
        T.cancel_all()
        page.wait_for_timeout(80)
        c0 = snap()
        # 손가락은 실제로는 아직 붙어 있다 - 계속 움직인다(합성. 위 주석 참고).
        T.synth_move(0, 220, 330)
        page.wait_for_timeout(70)
        T.synth_move(0, 260, 280)
        page.wait_for_timeout(110)
        c1 = snap()
        ok["cancel_then_reacquire"] = (c1["steerId"] >= 0 and c1["aim"] is not None)
        detail["cancelReacquire"] = {"afterCancel": c0["steerId"], "after": c1}
        T.pts.clear()   # CDP 는 이 손가락을 «없는» 것으로 안다 - up 을 보내면 오류다.
        reset()

        # 8) steerId 가 «없는 포인터»로 굳었을 때 자가치유하는가.
        reset()
        page.evaluate("()=>{window.__H.input.steerId=999;window.__H.input.visual.stickActive=true;}")
        page.wait_for_timeout(60)
        T.down(0, 140, 430)
        page.wait_for_timeout(60)
        T.move(0, 210, 360)
        page.wait_for_timeout(110)
        s = snap()
        ok["stale_steerid_self_heals"] = (s["steerId"] != 999 and s["aim"] is not None
                                          and s["boosting"] is False)
        reset()

        # 9) 부스트 버튼: 히트 영역과 «끌어내면 조종» 전환.
        bb = snap()["boostBtn"]

        def tap_at(x, y):
            reset()
            T.down(0, x, y)
            page.wait_for_timeout(90)
            v = snap()
            reset()
            return v

        ok["boost_center_hits"] = tap_at(bb["x"], bb["y"])["boosting"] is True
        ok["boost_edge_hits"] = tap_at(bb["x"] - bb["r"] * 1.15, bb["y"])["boosting"] is True
        far = tap_at(bb["x"] - bb["r"] * 1.44, bb["y"])
        ok["boost_control_far_point_steers"] = (far["boosting"] is False and far["steerId"] >= 0)

        reset()
        T.down(0, bb["x"], bb["y"])
        page.wait_for_timeout(60)
        T.move(0, bb["x"] - 150, bb["y"] - 90)
        page.wait_for_timeout(110)
        s = snap()
        ok["boost_slide_off_becomes_steer"] = (s["steerId"] >= 0 and s["aim"] is not None)
        reset()
        T.down(0, bb["x"], bb["y"])
        page.wait_for_timeout(60)
        T.move(0, bb["x"] - 28, bb["y"] - 10)
        page.wait_for_timeout(110)
        ok["boost_control_small_slip_keeps_boost"] = snap()["boosting"] is True
        reset()
        # 2026-08-28: the boost button used to be a steering dead zone.
        # Pressing it and pushing must now steer AND keep boosting.
        T.down(0, bb["x"], bb["y"])
        page.wait_for_timeout(60)
        T.move(0, bb["x"] - 30, bb["y"] - 30)
        page.wait_for_timeout(120)
        s = snap()
        ok["boost_press_can_also_steer"] = (s["aim"] is not None and s["boosting"] is True)
        reset()
        # negative control for the same mechanism: a bare press with no push
        # must NOT invent a direction (BOOST_STEER_DEADZONE guards the tremor).
        T.down(0, bb["x"], bb["y"])
        page.wait_for_timeout(60)
        T.move(0, bb["x"] + 5, bb["y"] + 4)
        page.wait_for_timeout(120)
        s = snap()
        ok["boost_press_still_no_phantom_steer"] = (s["aim"] is None and s["boosting"] is True)
        reset()
        # The boost finger only holds the steering role on loan. If a dedicated
        # finger arrives it must take over, or two-thumb players lose steering.
        T.down(0, bb["x"], bb["y"])
        page.wait_for_timeout(60)
        T.down(1, 110, 470)
        page.wait_for_timeout(60)
        T.move(1, 110, 380)
        page.wait_for_timeout(120)
        s = snap()
        ok["boost_first_then_second_finger_steers"] = (
            s["aim"] is not None and s["boosting"] is True and s["steerId"] == 1)
        reset()

        # 10) 손가락이 HUD 버튼 위·뷰포트 밖으로 나가도 끊기지 않는가.
        reset()
        T.down(0, 100, 450)
        page.wait_for_timeout(60)
        T.move(0, 195, 25)      # 일시정지 버튼 위
        page.wait_for_timeout(90)
        over = snap()
        T.move(0, -120, 450)    # 뷰포트 밖
        page.wait_for_timeout(90)
        out = snap()
        T.allup()
        page.wait_for_timeout(110)
        rel = snap()
        ok["drag_over_hud_keeps_steering"] = over["aim"] is not None
        ok["drag_outside_viewport_keeps_steering"] = out["aim"] is not None
        ok["release_outside_clears_state"] = (rel["steerId"] == -1 and rel["stick"] is False
                                              and rel["boosting"] is False)

        # 11) 두 번째 손가락 질주 + 첫 손가락을 떼도 조종이 이어지는가.
        reset()
        T.down(0, 120, 450)
        page.wait_for_timeout(50)
        T.move(0, 120, 390)
        page.wait_for_timeout(60)
        T.down(1, 300, 250)
        page.wait_for_timeout(90)
        ok["second_finger_boosts"] = snap()["boosting"] is True
        T.up(1)
        page.wait_for_timeout(90)
        s = snap()
        ok["lift_boost_finger_keeps_steering"] = (s["steerId"] >= 0 and s["boosting"] is False)
        T.allup()
        page.wait_for_timeout(120)
        s = snap()
        ok["release_all_stops"] = (s["boosting"] is False and s["stick"] is False
                                   and s["activeCount"] == 0)

        # 12) 포인터 경로가 잠겼는가 - 같은 손가락이 두 번 처리되면 조종이 튄다.
        reset()
        page.evaluate("""()=>{const c=document.getElementById('stage');
          c.dispatchEvent(new PointerEvent('pointerdown',{pointerId:77,pointerType:'touch',
            clientX:200,clientY:300,bubbles:true,cancelable:true}));}""")
        page.wait_for_timeout(80)
        s = snap()
        ok["pointer_touch_path_locked_out"] = (s["steerId"] == -1 and s["activeCount"] == 0)
        reset()

        detail["injectMode"] = page.evaluate("()=>window.__TDMODE")
        ok["no_console_errors"] = (len(errs) == 0)
        detail["consoleErrors"] = errs
        ctx.close()
        br.close()
    httpd.shutdown()
    if verbose:
        print(json.dumps({engine: detail}, ensure_ascii=False, indent=2, default=str))
    return ok


# ★ 구버전(결함 복원) 번들에서 «반드시 실패해야» 하는 항목.
MUST_FAIL_ON_LEGACY = [
    "touch_path_active",
    "mobile_controls_visible_first_frame",
    "deadzone_small_nudge_steers",
    "pause_resume_finger_still_down",
    "blur_ghost_finger_recovers",
    "stale_steerid_self_heals",
    "boost_control_far_point_steers",
    "boost_slide_off_becomes_steer",
    "boost_press_can_also_steer",
    "boost_first_then_second_finger_steers",
]

# ★ «엔진마다 판별력이 다른» 항목. 이게 이번 사고의 교훈 그 자체다.
#   joystick_knob_follows_finger 는 구버전(포인터 경로)에서도 Chromium 에서는
#   «통과»한다 - Chromium 은 포인터 경로가 멀쩡하기 때문이다. 아이폰에서만 깨졌다.
#   그래서 이 항목의 «판별»은 WebKit 에서만 성립한다. Chromium 에서 통과했다고
#   안심하지 말라는 것을 테스트 구조로 못 박아 둔다.
MUST_FAIL_BY_ENGINE = {
    "webkit": ["joystick_knob_follows_finger"],
    "chromium": [],
}


def make_legacy_copy(dst: Path) -> Path:
    """★ 2층 양성대조용. 고친 결함을 «되살린» input.ts 를 만든다.

    되살리는 결함(전부 실측으로 확인됐던 것):
      - 터치 이벤트 경로 끔 : 아이폰에서 조이스틱이 «보이는데 안 움직인» 그 상태
      - 데드존 10px / 부스트 히트 1.45배 / usedTouch=false 시작
      - 재개 시 손가락 재흡수 없음 / 유령 손가락 흡수 없음 / 불변식 자가치유 없음
      - 부스트→조종 전환(slide off) 없음
      - 질주 버튼 위에서 조종 불가(= 2026-08-28 실측된 조작 불능 구역)

    ★ 패턴이 하나라도 안 맞으면 «즉시 죽는다». 조용히 넘어가면 양성대조가
      「결함 없는 코드」를 검사하게 되어 통과가 의미를 잃는다(실제로 한 번 그랬다).
    """
    shutil.copytree(SRC, dst, dirs_exist_ok=True)
    p = dst / "input.ts"
    s = p.read_text(encoding="utf-8")
    subs = [
        # ★ 플래그만 끄면 리스너는 그대로 붙어 «두 경로가 동시에» 도는 하이브리드가
        #   된다(실측: 그 상태로 돌렸더니 양성대조가 엉뚱한 결과를 냈다).
        #   조건문을 꺼서 터치 경로를 통째로 없앤다 = 진짜 구버전.
        (r"if \(typeof window !== 'undefined' && 'ontouchstart' in window\) \{",
         "if (false) {"),
        (r"^const DEADZONE = 4;", "const DEADZONE = 10;"),
        (r"^const BOOST_HIT_SCALE = 1\.25;", "const BOOST_HIT_SCALE = 1.45;"),
        (r"^  usedTouch = isCoarsePointerDevice\(\);", "  usedTouch = false;"),
        (r"^    else this\.adoptRestingFinger\(\);", "    else { /* legacy */ }"),
        (r"Math\.hypot\(dx, dy\) > off", "false /* legacy */"),
        # 2026-08-28 fix: the boost finger also steers. Revive the dead zone.
        (r"^      if \(this\.steerId < 0\) this\.beginSteer\(id, x, y\);$",
         "      /* legacy: boost finger cannot steer */"),
    ]
    for pat, rep in subs:
        s2 = re.sub(pat, rep, s, count=1, flags=re.M)
        if s2 == s:
            raise SystemExit(f"양성대조 패치 실패(패턴 없음): {pat}\n"
                             "input.ts 가 바뀌었으면 이 패턴도 같이 고쳐라.")
        s = s2
    # 유령 손가락 흡수 제거(handleMove 안)
    ghost = """    if (this.steerId < 0 && !this.paused) {
      this.usedTouch = true;
      this.beginSteer(id, x, y);
      return true;
    }
    return false;"""
    if ghost not in s:
        raise SystemExit("양성대조 패치 실패: 유령 손가락 흡수 블록을 못 찾았다.")
    s = s.replace(ghost, "    return false;", 1)
    # 불변식 자가치유 제거
    s2 = re.sub(r"    if \(this\.steerId >= 0 && !this\.active\.has\(this\.steerId\)\) \{.*?\n    \}\n",
                "", s, count=1, flags=re.S)
    if s2 == s:
        raise SystemExit("양성대조 패치 실패: 자가치유 블록을 못 찾았다.")
    p.write_text(s2, encoding="utf-8")
    return p


def report(title: str, ok: dict[str, bool]) -> int:
    print(f"\n──── {title} ────")
    for k, v in ok.items():
        print(f"  {'PASS' if v else 'FAIL'}  {k}")
    return 1 if any(not v for v in ok.values()) else 0


def main() -> int:
    args = sys.argv[1:]
    engines = ["chromium", "webkit"]
    if "--engine" in args:
        engines = [args[args.index("--engine") + 1]]
    flags = set(a for a in args if a.startswith("--"))
    do_pc = "--positive-control" in flags or "--all" in flags
    do_main = not do_pc or "--all" in flags

    tmp = Path(tempfile.mkdtemp(prefix="qa_touch_input_"))
    rc = 0
    try:
        if do_main:
            wd = tmp / "cur"
            build(wd, SRC / "input.ts")
            for eng in engines:
                rc |= report(f"현재 코드 회귀 검사 [{eng}]", run_checks(wd, eng))

        if do_pc:
            legacy_input = make_legacy_copy(tmp / "legacy_src")
            wd2 = tmp / "legacy"
            build(wd2, legacy_input)
            for eng in engines:
                lok = run_checks(wd2, eng, verbose=False)
                print(f"\n──── 2층 양성대조: 결함을 되살린 코드 [{eng}] ────")
                dead = []
                for k in MUST_FAIL_ON_LEGACY + MUST_FAIL_BY_ENGINE.get(eng, []):
                    if k not in lok:
                        dead.append(f"{k} (항목 자체가 없다)")
                    elif lok[k]:
                        dead.append(f"{k} (구버전에서도 통과 = 죽은 검사)")
                    else:
                        print(f"  OK   {k}: 구버전에서 제대로 «실패»한다")
                if dead:
                    print(f"\n[양성대조 실패/{eng}] 아래 검사는 결함을 못 잡는다:")
                    for d in dead:
                        print("  -", d)
                    rc |= 1
                else:
                    print(f"\n[양성대조 통과/{eng}] 모든 대상 검사가 결함을 실제로 잡는다.")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n[FAIL]" if rc else "\n[PASS] 전 항목 통과.")
    return rc


if __name__ == "__main__":
    sys.exit(main())
