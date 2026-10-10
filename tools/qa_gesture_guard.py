"""qa_gesture_guard.py - 「캔버스 touchmove 는 «언제나» 기본동작을 막는가」만 잰다. headless 전용.

★ 왜 «따로» 필요한가 (2026-08-28)
  qa_touch_input.py 는 조이스틱이 «논리적으로» 도는지를 잰다. 그 검사 31~32항목은
  아이폰에서 조작이 죽은 빌드(kingsnake.ait b712906a)에서도 «전부 통과했다».
  즉 그 검사는 이 고장을 잡지 못한다. 못 잡는 검사로 「검증했다」고 말하면 안 된다.

  실기기 실측(President 아이폰·토스 앱, 2회 재현)에서 갈린 것은 단 하나였다:
    진단판 빌드에는 document 층 «비수동» touchmove 리스너가 있어 캔버스로 간
    제스처의 기본동작을 «조건 없이» 막았고(pd ok145), 정본에는 그게 없었다.
    iOS WebKit 은 제스처 초반에 기본동작을 확정하므로, 그때 안 막으면 그 제스처는
    통째로 웹뷰 것이 된다.

  그래서 이 검사가 재는 성질은 하나다:
    「캔버스 위 touchmove 는 cancelable 인 한 «반드시» defaultPrevented 여야 한다」
  ★ 이건 조종이 '되는가'와 «다른» 성질이다. used=false 로 빠지는 move 에서도
    막아야 한다는 뜻이고, 예전 코드는 바로 거기서 안 막았다.

★ 양성대조가 이 파일의 «본체»다.
  --positive-control 은 수정 «직전» 원본(src/input.ts.bak_pre_gestureguard)을
  그대로 번들해서 같은 검사를 돌린다. 거기서 지정 항목이 «반드시 실패»해야 한다.
  안 실패하면 이 검사는 무효이므로 rig invalid 로 떨어뜨린다.

⚠ 한계(숨기지 않는다): Playwright WebKit 은 진짜 드래그를 못 만들어 페이로드가
  합성이다. 그래서 이 검사는 「우리 코드가 preventDefault 를 부르는가」를 재는 것이지
  「iOS 가 그 제스처를 우리에게 주는가」를 재지 «못한다». 후자는 실기기만이 답한다.

실행:
  python tools/qa_gesture_guard.py                    # 현재 코드(음성대조 = 오탐 0 이어야)
  python tools/qa_gesture_guard.py --positive-control # 수정 전 원본에서 «실패»하는지
  python tools/qa_gesture_guard.py --all
"""

from __future__ import annotations

import argparse
import http.server
import os
import socketserver
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("playwright 가 없다: pip install playwright && playwright install chromium webkit")
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
ESBUILD = ROOT / "node_modules" / "esbuild" / "bin" / "esbuild"

W, H = 390, 652

PAGE = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#06070c;
 overscroll-behavior:none;-webkit-user-select:none;user-select:none}
#stage{position:fixed;inset:0;display:block;width:100%;height:100%;touch-action:none;z-index:1}
/* ★ 실제 styles.css 에 있는 «스크롤되는 DOM» 재현(overflow-y:auto L233 / overflow-x:auto L468).
   가드가 여기까지 막으면 메뉴·스킨 레일 스크롤이 통째로 죽는다. */
#rail{position:fixed;left:0;right:0;bottom:0;height:120px;z-index:9;overflow-x:auto;white-space:nowrap;background:#123}
#rail i{display:inline-block;width:200px;height:100px}
</style></head><body>
<canvas id="stage"></canvas><div id="rail"><i></i><i></i><i></i><i></i><i></i></div>
<script>
// ★ 반환값이 이 검사의 «전부»다: 디스패치한 이벤트가 defaultPrevented 였는가.
window.__TD = function (type, all, changed, tid) {
  var el = document.getElementById(tid || 'stage');
  function pt(p){ return {identifier:p[0],clientX:p[1],clientY:p[2],pageX:p[1],pageY:p[2],target:el}; }
  var A = all.map(pt), C = changed.map(pt);
  if (typeof Touch === 'function' && typeof TouchEvent === 'function') {
    try {
      var rt = function(p){ return new Touch({identifier:p[0],target:el,clientX:p[1],clientY:p[2],pageX:p[1],pageY:p[2]}); };
      var RA = all.map(rt), RC = changed.map(rt);
      var ev = new TouchEvent(type,{bubbles:true,cancelable:true,touches:RA,targetTouches:RA,changedTouches:RC});
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    } catch (e) { /* WebKit → 아래 */ }
  }
  var e2 = new Event(type,{bubbles:true,cancelable:true});
  Object.defineProperty(e2,'touches',{value:A});
  Object.defineProperty(e2,'targetTouches',{value:A});
  Object.defineProperty(e2,'changedTouches',{value:C});
  el.dispatchEvent(e2);
  return e2.defaultPrevented;
};
</script>
<script type="module" src="./bundle.js"></script></body></html>
"""

ENTRY = """import {{ Input }} from '{input_path}';
const canvas = document.getElementById('stage');
const input = new Input(canvas);
function resize() {{
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = w; canvas.height = h;
  const r = Math.min(w, h) * 0.13;
  input.resize(w, h, 0, 0, h - 16 - r * 2);
}}
resize();
(function loop() {{ input.update(); requestAnimationFrame(loop); }})();
window.__H = {{
  snap: () => ({{
    steerId: input.steerId, boostId: input.boostId,
    extra: Array.from(input.extraTouches), activeCount: input.active.size,
    boostBtn: {{ x: input.visual.boostX, y: input.visual.boostY, r: input.visual.boostR }},
  }}),
}};
"""


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
    workdir.mkdir(parents=True, exist_ok=True)
    rel = os.path.relpath(input_ts.with_suffix(""), workdir).replace("\\", "/")
    if not rel.startswith("."):
        rel = "./" + rel
    (workdir / "entry.js").write_text(ENTRY.format(input_path=rel), encoding="utf-8")
    (workdir / "index.html").write_text(PAGE, encoding="utf-8")
    r = subprocess.run(
        ["node", str(ESBUILD), str(workdir / "entry.js"), "--bundle", "--format=esm",
         "--target=es2019", f"--outfile={workdir / 'bundle.js'}"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        print("esbuild 실패:\n" + r.stderr)
        sys.exit(2)


# ── 시나리오 ────────────────────────────────────────────────────────────────
# 각 항목: (이름, 함수) — 함수는 (page) -> (ok: bool, detail: str)
# ★ 전부 「캔버스 touchmove 가 defaultPrevented 인가」만 본다.

def sc_plain_steer_move(page):
    """정상 조종 move. 수정 전에도 막혔다 — rig 가 살아있는지 보는 기준선."""
    page.evaluate("window.__TD('touchstart',[[1,200,300]],[[1,200,300]])")
    pv = page.evaluate("window.__TD('touchmove',[[1,200,340]],[[1,200,340]])")
    page.evaluate("window.__TD('touchend',[],[[1,200,340]])")
    return bool(pv), f"defaultPrevented={pv}"


def sc_boost_finger_small_move(page):
    """★ 핵심. 질주 버튼을 «두 번째» 손가락으로 잡고 «조금» 움직인다.

    handleMove 는 id!==steerId 이고 슬라이드오프 문턱도 안 넘으므로 false 를 돌린다
    → 예전 코드의 `if (used)` 가 여기서 preventDefault 를 «건너뛴다».
    """
    b = page.evaluate("window.__H.snap().boostBtn")
    bx, by = int(b["x"]), int(b["y"])
    page.evaluate("window.__TD('touchstart',[[1,120,300]],[[1,120,300]])")  # 조종 손가락
    page.evaluate(
        f"window.__TD('touchstart',[[1,120,300],[2,{bx},{by}]],[[2,{bx},{by}]])")  # 질주 손가락
    snap = page.evaluate("window.__H.snap()")
    pv = page.evaluate(
        f"window.__TD('touchmove',[[1,120,300],[2,{bx + 3},{by + 3}]],[[2,{bx + 3},{by + 3}]])")
    page.evaluate("window.__TD('touchend',[],[[1,120,300],[2,%d,%d]])" % (bx + 3, by + 3))
    return bool(pv), f"steerId={snap['steerId']} boostId={snap['boostId']} defaultPrevented={pv}"


def sc_extra_finger_move(page):
    """세 번째 손가락(extraTouches)의 move. handleMove 가 false 를 돌리는 또 다른 경로."""
    b = page.evaluate("window.__H.snap().boostBtn")
    bx, by = int(b["x"]), int(b["y"])
    page.evaluate("window.__TD('touchstart',[[1,120,300]],[[1,120,300]])")
    page.evaluate(f"window.__TD('touchstart',[[1,120,300],[2,{bx},{by}]],[[2,{bx},{by}]])")
    page.evaluate(
        f"window.__TD('touchstart',[[1,120,300],[2,{bx},{by}],[3,60,560]],[[3,60,560]])")
    snap = page.evaluate("window.__H.snap()")
    pv = page.evaluate(
        f"window.__TD('touchmove',[[1,120,300],[2,{bx},{by}],[3,64,564]],[[3,64,564]])")
    page.evaluate("window.__TD('touchend',[],[[1,120,300],[2,%d,%d],[3,64,564]])" % (bx, by))
    return bool(pv), f"extra={snap['extra']} defaultPrevented={pv}"


def sc_dom_scroll_not_prevented(page):
    """★ 과잉방어 검사. 캔버스가 «아닌» DOM 요소(스크롤 레일)의 touchmove 는
    막히면 «안 된다». 막으면 메뉴·스킨 레일 스크롤이 통째로 죽는다.
    (실제 styles.css 233행 overflow-y:auto, 468행 overflow-x:auto 가 그 대상이다.)
    ★ 이 항목은 수정 전/후 «둘 다» 통과해야 정상이다 - 양성대조 대상이 아니다.
    """
    page.evaluate("window.__TD('touchstart',[[9,200,600]],[[9,200,600]],'rail')")
    pv = page.evaluate("window.__TD('touchmove',[[9,140,600]],[[9,140,600]],'rail')")
    page.evaluate("window.__TD('touchend',[],[[9,140,600]],'rail')")
    return (not pv), f"defaultPrevented={pv} (False 여야 정상)"


def sc_dom_scroll_with_active_steer(page):
    """계측 전용(합격/불합격 아님). 조종 손가락이 «이미 잡혀 있는» 상태에서
    다른 손가락이 DOM 레일을 쓸면 막히는가.

    ★ 여기가 rescueMove 의 `used` 조건을 없앤 «대가»다. 값을 숨기지 말고 찍는다.
      - 수정 전 / DIAG 판 : 안 막힘(used=false 라서)
      - 지금             : 막힘
      실사용에서 스크롤되는 DOM(메뉴·스킨 레일)은 조종 손가락이 없는 화면에만
      뜨므로 실害는 없다고 «보이지만», 그건 판단이지 측정이 아니다. 값만 남긴다.
    """
    page.evaluate("window.__TD('touchstart',[[1,120,300]],[[1,120,300]])")
    page.evaluate("window.__TD('touchstart',[[1,120,300],[9,200,600]],[[9,200,600]],'rail')")
    pv = page.evaluate(
        "window.__TD('touchmove',[[1,120,300],[9,140,600]],[[9,140,600]],'rail')")
    page.evaluate("window.__TD('touchend',[],[[1,120,300],[9,140,600]],'rail')")
    return True, f"[계측] defaultPrevented={pv}"


SCENARIOS = [
    ("plain_steer_move_prevented", sc_plain_steer_move),
    ("boost_finger_small_move_prevented", sc_boost_finger_small_move),
    ("extra_finger_move_prevented", sc_extra_finger_move),
    ("dom_scroll_NOT_prevented", sc_dom_scroll_not_prevented),
    ("dom_scroll_with_active_steer_INFO", sc_dom_scroll_with_active_steer),
]

# 양성대조에서 «반드시 실패해야» 하는 항목(수정 전 코드가 실제로 안 막던 경로).
MUST_FAIL_IN_OLD = {"boost_finger_small_move_prevented", "extra_finger_move_prevented"}


def run(url: str, engine: str, label: str):
    results = {}
    with sync_playwright() as p:
        launcher = getattr(p, engine)
        br = launcher.launch()  # ⛔ headless 고정. headless=False 로 바꾸지 마라.
        ctx = br.new_context(viewport={"width": W, "height": H}, has_touch=True,
                             is_mobile=True, device_scale_factor=3)
        page = ctx.new_page()
        page.goto(url)
        page.wait_for_function("window.__H !== undefined")
        for name, fn in SCENARIOS:
            page.reload()
            page.wait_for_function("window.__H !== undefined")
            try:
                ok, detail = fn(page)
            except Exception as exc:  # noqa: BLE001
                ok, detail = False, f"EXC {exc}"
            results[name] = (ok, detail)
        br.close()
    print(f"\n──── {label} [{engine}] ────")
    for name, (ok, detail) in results.items():
        print(f"  {'PASS' if ok else 'FAIL'}  {name}  ({detail})")
    return results


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--positive-control", action="store_true")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--engine", default=None)
    a = ap.parse_args()

    engines = [a.engine] if a.engine else ["chromium", "webkit"]
    do_pc = a.positive_control or a.all
    do_main = (not a.positive_control) or a.all

    rc = 0

    if do_main:
        tmp = Path(tempfile.mkdtemp(prefix="gguard_"))
        build(tmp, SRC / "input.ts")
        port, httpd = serve(tmp)
        for eng in engines:
            res = run(f"http://127.0.0.1:{port}", eng, "현재 코드(음성대조)")
            bad = [n for n, (ok, _) in res.items() if not ok]
            if bad:
                print(f"[FAIL/{eng}] 막히지 않은 경로: {bad}")
                rc = 1
        httpd.shutdown()
        if rc == 0:
            print("\n[음성대조 통과] 현재 코드에서 캔버스 touchmove 는 전부 막힌다. 오탐 0.")

    if do_pc:
        old = SRC / "input.ts.bak_pre_gestureguard"
        if not old.exists():
            print(f"\n[RIG INVALID] 수정 전 원본이 없다: {old}")
            return 3
        tmp = Path(tempfile.mkdtemp(prefix="gguard_pc_"))
        # esbuild 가 .ts 로 인식하도록 확장자를 되살려 복사한다.
        old_ts = tmp / "old_input.ts"
        old_ts.write_text(old.read_text(encoding="utf-8"), encoding="utf-8")
        work = tmp / "w"
        build(work, old_ts)
        port, httpd = serve(work)
        for eng in engines:
            res = run(f"http://127.0.0.1:{port}", eng, "양성대조: 수정 «전» 원본")
            not_caught = [n for n in MUST_FAIL_IN_OLD if res.get(n, (False, ""))[0]]
            if not_caught:
                print(f"[RIG INVALID/{eng}] 수정 전 코드인데 통과했다 = 검사가 결함을 «못 잡는다»: {not_caught}")
                rc = 1
            else:
                print(f"[양성대조 통과/{eng}] 수정 전 코드에서 대상 항목이 제대로 «실패»한다.")
        httpd.shutdown()

    return rc


if __name__ == "__main__":
    raise SystemExit(main())
