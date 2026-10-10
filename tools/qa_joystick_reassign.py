# -*- coding: utf-8 -*-
"""qa_joystick_reassign.py — 「한 번의 «연속» 제스처 동안 조종 손가락이 몇 번
재배정되는가」를 프레임 단위로 잰다.

  python tools/qa_joystick_reassign.py <distDir> <tag> [reps]

★ 무엇을 가르나
  가설: 제스처 도중 beginSteer() 가 반복 호출되면 스틱 «원점»이 손가락을 따라
  움직여, d = |C-O| 가 0 근처에 머물고 DEADZONE 을 못 넘어 aim=null 이 된다.
  = 「스틱이 손가락을 따라다닌다」와 「조종이 안 먹는다」가 같은 원인이 된다.

  그래서 재는 것은 «카운터의 증가»만이 아니다. 두 가지를 같이 본다:
    (1) push 구간 동안 steerAssigns 가 몇 번 증가했나  (>0 이면 반복 배정)
    (2) push 구간 동안 steerOX/OY(원점) 가 몇 px 움직였나 (>0 이면 원점 이동)
  ★ (2)가 진짜 판정이다. 카운터만 보면 「원점을 보존한 채 재배정」을 오판한다.

★ 헤드리스 전용. 창을 절대 띄우지 않는다.
"""
from __future__ import annotations

import http.server
import json
import math
import socketserver
import sys
import threading
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_joyfix_260905"
VW, VH = 390, 844

SAVE = {"v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
        "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
        "control": "joystick", "sound": False, "locale": None}

# 프레임마다 진단 스냅샷을 쌓는 «바깥» 관찰자. 빌드에는 손대지 않는다.
RECORDER = r"""
(function () {
  if (window.__rec) return;
  var R = { on: 0, rows: [] };
  window.__rec = R;
  R.begin = function () { R.rows = []; R.on = 1; };
  R.end = function () { R.on = 0; return R.rows; };
  function n1(v) { return Math.round(v * 10) / 10; }
  function loop() {
    requestAnimationFrame(loop);
    if (!R.on || !window.__coil || !window.__coil.diag) return;
    try {
      var d = window.__coil.diag();
      R.rows.push([Math.round(performance.now()),
        d.steerAssigns, d.adopts, d.steerUpdates, d.steerId,
        n1(d.steerOX), n1(d.steerOY), n1(d.steerCX), n1(d.steerCY),
        n1(d.dist), d.aim === null ? null : Math.round(d.aim * 1000) / 1000,
        d.activeN, d.extraN, d.boostId, d.stickActive, d.steerLive]);
    } catch (e) {}
  }
  requestAnimationFrame(loop);
})();
"""
COL = ["t", "asg", "adp", "upd", "sid", "ox", "oy", "cx", "cy",
       "dist", "aim", "actN", "exN", "bid", "stick", "live"]
I = {k: i for i, k in enumerate(COL)}


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
    """CDP 터치.

    ★★ CDP 의 «id 의미»는 실측으로 확정했다(tools/_probe_touchids.py):
         touchStart / touchMove : touchPoints = «지금 닿아 있는 전부»
         touchEnd               : touchPoints = «떼는 점»  (빈 배열 = 전부 뗌)
       ⚠ 「touchEnd 에 남는 점을 넣는다」는 «틀렸다». 기존 tools/qa_menu_finger.py
         가 그렇게 짜여 있어서, 「메뉴에 얹은 손가락을 남기고 버튼 손가락만 뗀다」가
         실제로는 «정반대»(얹은 손가락을 떼고 버튼 손가락을 남김)로 실행됐다.
         실측 로그:
           touchStart changed=[[0,...]]         touches=[[0,...]]
           touchStart changed=[[1,...]]         touches=[[0,..],[1,..]]
           touchEnd   [(0,..)] -> changed=[[0]] touches=[[1,...]]   ← 0 이 떨어진다
    """

    def __init__(self, page, cdp):
        self.page, self.cdp = page, cdp
        self.pts = {}          # id -> (x, y)

    def _send(self, kind, pts):
        self.cdp.send("Input.dispatchTouchEvent", {
            "type": kind,
            "touchPoints": [{"x": float(x), "y": float(y), "id": i}
                            for i, (x, y) in pts]})

    def down(self, i, x, y):
        self.pts[i] = (x, y)
        self._send("touchStart", sorted(self.pts.items()))

    def move(self, i, x, y):
        if i not in self.pts:
            return
        self.pts[i] = (x, y)
        self._send("touchMove", sorted(self.pts.items()))

    def up(self, i):
        if i not in self.pts:
            return
        p = self.pts.pop(i)
        self._send("touchEnd", [(i, p)])

    def clear(self):
        if self.pts:
            self.pts = {}
            self._send("touchEnd", [])

    def tap(self, x, y):
        self.down(9, x, y)
        self.page.wait_for_timeout(60)
        self.up(9)


def play_btn(page):
    b = page.query_selector("button.p-play") or page.query_selector(".btn-primary")
    r = b.bounding_box()
    return r["x"] + r["width"] / 2, r["y"] + r["height"] / 2


def to_menu(page, rig):
    rig.clear()
    page.evaluate("() => window.__coil.toMenu()")
    page.wait_for_timeout(500)


def start_run_by_button(page, rig):
    to_menu(page, rig)
    bx, by = play_btn(page)
    rig.tap(bx, by)
    page.wait_for_timeout(800)
    page.evaluate("() => window.__coil.ghost(300)")


def push(rig, page, fid, x0, y0, steps=8, dist=110.0, theta=-2.2):
    """엄지를 한 방향으로 «연속» 밀고, 끝에서 살짝 떨며 버틴다."""
    for i in range(1, steps + 1):
        d = dist * i / steps
        rig.move(fid, x0 + math.cos(theta) * d, y0 + math.sin(theta) * d)
        page.wait_for_timeout(22)
    for i in range(5):
        rig.move(fid, x0 + math.cos(theta) * dist + (1 if i % 2 else -1),
                 y0 + math.sin(theta) * dist)
        page.wait_for_timeout(90)


def _adopt_frame(seg):
    """조종 손가락이 «바뀐» 첫 프레임의 인덱스(없으면 None)."""
    prev = seg[0][I["sid"]]
    for k in range(1, len(seg)):
        cur = seg[k][I["sid"]]
        if cur >= 0 and cur != prev:
            return k
        prev = cur
    return None


def d_at_adopt(seg):
    k = _adopt_frame(seg)
    return -1 if k is None else seg[k][I["dist"]]


def aim_at_adopt(seg):
    k = _adopt_frame(seg)
    return None if k is None else seg[k][I["aim"]]


def summarize(rows, mark_i):
    """push 구간(mark_i 이후)의 판정값."""
    seg = rows[mark_i:]
    if not seg:
        return {"n": 0}
    asg = [r[I["asg"]] for r in seg]
    adp = [r[I["adp"]] for r in seg]
    ox = [r[I["ox"]] for r in seg if r[I["sid"]] >= 0]
    oy = [r[I["oy"]] for r in seg if r[I["sid"]] >= 0]
    dist = [r[I["dist"]] for r in seg]
    aims = [r[I["aim"]] for r in seg]
    drift = 0.0
    if len(ox) >= 2:
        for k in range(1, len(ox)):
            drift += math.hypot(ox[k] - ox[k - 1], oy[k] - oy[k - 1])
    return {
        "n": len(seg),
        "asg_delta": asg[-1] - asg[0],
        "adp_delta": adp[-1] - adp[0],
        "origin_drift_px": round(drift, 1),
        "origin_span_px": round(math.hypot(max(ox) - min(ox), max(oy) - min(oy)), 1)
        if ox else -1.0,
        "dist_max": round(max(dist), 1) if dist else -1,
        "dist_end": dist[-1] if dist else -1,
        "dist_first": dist[0] if dist else -1,
        # ★ 「조종이 «새로 배정되는» 그 프레임의 d」. 채택 순간 d 가 데드존을
        #   크게 넘어 있으면 «밀지도 않았는데» 그 각도로 뱀이 꺾인다.
        "d_at_adopt": d_at_adopt(seg),
        "aim_at_adopt": aim_at_adopt(seg),
        # 질주는 boostId 또는 extraTouches 에서만 켜진다(키·마우스는 이 검사에 없다).
        "boost_frames": sum(1 for r in seg if r[I["bid"]] >= 0 or r[I["exN"]] > 0),
        "aim_end": aims[-1],
        "aim_live_frames": sum(1 for a in aims if a is not None),
        "sid_end": seg[-1][I["sid"]],
        "actN_end": seg[-1][I["actN"]],
        "exN_end": seg[-1][I["exN"]],
        "stick_end": seg[-1][I["stick"]],
    }


# ── 시나리오 ────────────────────────────────────────────────────────────────
def sc_menu_rest(page, rig):
    """① 메뉴에 손가락을 얹은 «채로» 시작 버튼을 누르고, 그 손가락으로 민다.

    ⚠ 왜 «진짜 탭»이 아니라 .click() 인가 (실측으로 확정한 한계):
      두 번째 손가락이 닿아 있는 «멀티터치» 상태에서는 브라우저가 click 을
      합성하지 않는다. 그래서 CDP 로 버튼을 탭해도 판이 «시작되지 않는다».
      실측(tools/_probe_menufinger.py): 탭 뒤에도 mode='menu'.
      ⇒ 그렇게 짠 검사는 「메뉴에서 조종되는가」를 재고 있었을 뿐이다
        (기존 tools/qa_menu_finger.py 가 그 상태다).
      이 검사가 재려는 것은 「판이 시작될 때 손가락이 이미 닿아 있었다」이므로
      시작 «수단»은 .click() 이어도 무방하다 - beginRun 은 같은 경로로 돈다.
    """
    to_menu(page, rig)
    f = (150.0, 600.0)
    rig.down(0, *f)
    page.wait_for_timeout(150)
    page.evaluate("() => document.querySelector('button.p-play').click()")
    page.wait_for_timeout(900)
    if page.evaluate("() => window.__coil.state().mode") != "play":
        raise RuntimeError("run did not start (mode=%s)"
                           % page.evaluate("() => window.__coil.state().mode"))
    page.evaluate("() => window.__coil.ghost(300)")
    page.evaluate("() => window.__rec.begin()")
    page.wait_for_timeout(200)
    mark = page.evaluate("() => window.__rec.rows.length")
    push(rig, page, 0, *f)
    rows = page.evaluate("() => window.__rec.end()")
    rig.clear()
    return rows, mark


def sc_fresh(page, rig):
    """② 판을 시작한 «뒤» 새로 터치해서 민다(정상 경로 = 음성 대조)."""
    start_run_by_button(page, rig)
    page.evaluate("() => window.__rec.begin()")
    f = (170.0, 560.0)
    rig.down(0, *f)
    page.wait_for_timeout(120)
    mark = 0
    push(rig, page, 0, *f)
    rows = page.evaluate("() => window.__rec.end()")
    rig.clear()
    return rows, mark


def sc_boost(page, rig):
    """③ 질주 버튼 위에서 시작한 손가락(질주·조종 겸용)으로 민다."""
    start_run_by_button(page, rig)
    bb = page.evaluate("() => window.__coil.state().boostBtn")
    page.evaluate("() => window.__rec.begin()")
    rig.down(0, bb["x"], bb["y"])
    page.wait_for_timeout(120)
    mark = 0
    push(rig, page, 0, bb["x"], bb["y"], dist=95.0, theta=-2.6)
    rows = page.evaluate("() => window.__rec.end()")
    rig.clear()
    return rows, mark


def sc_second_finger(page, rig):
    """④ 제스처 «도중» 두 번째 손가락이 잠깐 닿았다 떨어진다(손바닥·반대 엄지)."""
    start_run_by_button(page, rig)
    page.evaluate("() => window.__rec.begin()")
    f = (170.0, 560.0)
    rig.down(0, *f)
    page.wait_for_timeout(120)
    mark = 0
    # 절반쯤 밀고 나서 두 번째 손가락이 톡 닿았다 떨어진다
    for i in range(1, 5):
        rig.move(0, f[0] + math.cos(-2.2) * (110.0 * i / 8),
                 f[1] + math.sin(-2.2) * (110.0 * i / 8))
        page.wait_for_timeout(22)
    rig.down(1, 300.0, 300.0)
    page.wait_for_timeout(90)
    rig.up(1)
    page.wait_for_timeout(90)
    for i in range(5, 9):
        rig.move(0, f[0] + math.cos(-2.2) * (110.0 * i / 8),
                 f[1] + math.sin(-2.2) * (110.0 * i / 8))
        page.wait_for_timeout(22)
    for i in range(5):
        rig.move(0, f[0] + math.cos(-2.2) * 110.0 + (1 if i % 2 else -1),
                 f[1] + math.sin(-2.2) * 110.0)
        page.wait_for_timeout(90)
    rows = page.evaluate("() => window.__rec.end()")
    rig.clear()
    return rows, mark


def sc_finger_swap(page, rig):
    """⑤ A 로 조종 중 B 가 닿고, A 를 «떼고», 남은 B 로 민다.

    ★ 노리는 것: B 는 assignDown 에서 extraTouches(질주)로 빠진다. A 가 떨어져
      steerId 가 비어도 adoptRestingFinger 는 extraTouches 를 «건너뛴다».
      그러면 화면에 손가락이 하나 남아 있는데 조종이 «영영» 안 된다.
    """
    start_run_by_button(page, rig)
    page.evaluate("() => window.__rec.begin()")
    a = (170.0, 560.0)
    b = (250.0, 500.0)
    rig.down(0, *a)
    page.wait_for_timeout(100)
    for i in range(1, 5):
        rig.move(0, a[0] - 10 * i, a[1] - 8 * i)
        page.wait_for_timeout(25)
    rig.down(1, *b)
    page.wait_for_timeout(100)
    rig.up(0)                     # 조종하던 손가락만 뗀다
    page.wait_for_timeout(120)
    mark = page.evaluate("() => window.__rec.rows.length")
    push(rig, page, 1, *b)        # 남은 손가락으로 민다
    rows = page.evaluate("() => window.__rec.end()")
    rig.clear()
    return rows, mark


def sc_blur_mid(page, rig):
    """⑥ 제스처 «도중» 창 blur(웹뷰 포커스 이동·배너·알림)."""
    start_run_by_button(page, rig)
    page.evaluate("() => window.__rec.begin()")
    f = (170.0, 560.0)
    rig.down(0, *f)
    page.wait_for_timeout(100)
    for i in range(1, 5):
        rig.move(0, f[0] + math.cos(-2.2) * (110.0 * i / 8),
                 f[1] + math.sin(-2.2) * (110.0 * i / 8))
        page.wait_for_timeout(25)
    mark = page.evaluate("() => window.__rec.rows.length")
    page.evaluate("() => window.dispatchEvent(new Event('blur'))")
    page.wait_for_timeout(80)
    for i in range(5, 9):
        rig.move(0, f[0] + math.cos(-2.2) * (110.0 * i / 8),
                 f[1] + math.sin(-2.2) * (110.0 * i / 8))
        page.wait_for_timeout(25)
    for i in range(5):
        rig.move(0, f[0] + math.cos(-2.2) * 110.0 + (1 if i % 2 else -1),
                 f[1] + math.sin(-2.2) * 110.0)
        page.wait_for_timeout(90)
    rows = page.evaluate("() => window.__rec.end()")
    rig.clear()
    return rows, mark


def sc_blur_storm(page, rig):
    """⑦ 제스처 내내 blur 가 «반복»된다 — 원점이 손가락을 따라오는가."""
    start_run_by_button(page, rig)
    page.evaluate("() => window.__rec.begin()")
    f = (170.0, 560.0)
    rig.down(0, *f)
    page.wait_for_timeout(100)
    mark = page.evaluate("() => window.__rec.rows.length")
    for i in range(1, 13):
        rig.move(0, f[0] + math.cos(-2.2) * (140.0 * i / 12),
                 f[1] + math.sin(-2.2) * (140.0 * i / 12))
        page.evaluate("() => window.dispatchEvent(new Event('blur'))")
        page.wait_for_timeout(40)
    for i in range(4):
        rig.move(0, f[0] + math.cos(-2.2) * 140.0 + (1 if i % 2 else -1),
                 f[1] + math.sin(-2.2) * 140.0)
        page.wait_for_timeout(90)
    rows = page.evaluate("() => window.__rec.end()")
    rig.clear()
    return rows, mark


def sc_pause_mid(page, rig):
    """⑧ 손가락을 댄 채 «진짜 UI»로 일시정지→재개하고 그대로 민다."""
    start_run_by_button(page, rig)
    f = (170.0, 560.0)
    rig.down(0, *f)
    page.wait_for_timeout(120)
    for i in range(1, 4):
        rig.move(0, f[0] - 8 * i, f[1] - 6 * i)
        page.wait_for_timeout(25)
    cur = (f[0] - 24, f[1] - 18)
    xy = page.evaluate("""() => { const p = document.querySelector('button.hud-pause');
      if (!p || p.getClientRects().length === 0) return null;
      const q = p.getBoundingClientRect(); return [q.x+q.width/2, q.y+q.height/2]; }""")
    if xy:
        rig.down(1, xy[0], xy[1])
        page.wait_for_timeout(60)
        rig.up(1)
        page.wait_for_timeout(400)
        r2 = page.evaluate("""() => { const vis=(e)=>!!e&&e.getClientRects().length>0;
          for (const o of [...document.querySelectorAll('.overlay')].filter(vis)) {
            const b = o.querySelector('button.btn-primary');
            if (vis(b)) { const q=b.getBoundingClientRect();
              return [q.x+q.width/2, q.y+q.height/2]; } } return null; }""")
        if r2:
            rig.down(1, r2[0], r2[1])
            page.wait_for_timeout(60)
            rig.up(1)
        page.wait_for_timeout(3600)      # 재개 카운트다운
    page.evaluate("() => window.__coil.ghost(300)")
    page.evaluate("() => window.__rec.begin()")
    page.wait_for_timeout(150)
    mark = 0
    push(rig, page, 0, *cur)
    rows = page.evaluate("() => window.__rec.end()")
    rig.clear()
    return rows, mark


def sc_menu_rest_relift(page, rig):
    """①' 위와 같되, 손가락을 «한 번 뗐다 다시» 대고 민다.
    「뗄 때까지 제외」의 «뗐다»가 실제로 풀리는지 — 여기가 0/N 이어야 한다."""
    to_menu(page, rig)
    f = (150.0, 600.0)
    rig.down(0, *f)
    page.wait_for_timeout(150)
    page.evaluate("() => document.querySelector('button.p-play').click()")
    page.wait_for_timeout(900)
    page.evaluate("() => window.__coil.ghost(300)")
    rig.up(0)                       # 뗀다
    page.wait_for_timeout(200)
    page.evaluate("() => window.__rec.begin()")
    g = (170.0, 560.0)
    rig.down(0, *g)                 # 다시 댄다
    page.wait_for_timeout(120)
    mark = 0
    push(rig, page, 0, *g)
    rows = page.evaluate("() => window.__rec.end()")
    rig.clear()
    return rows, mark


def sc_start_immediate(page, rig):
    """⑩ 판이 시작되자마자(<100ms) 손가락을 대고 민다.
    ADOPT_GRACE_MS 가 «진짜 새 접촉»까지 먹으면 여기가 죽는다 = 음성 대조."""
    to_menu(page, rig)
    bx, by = play_btn(page)
    rig.tap(bx, by)
    page.evaluate("() => window.__rec.begin()")
    f = (170.0, 560.0)
    rig.down(0, *f)                 # 시작과 «동시에» 손가락을 댄다
    page.wait_for_timeout(60)
    mark = 0
    push(rig, page, 0, *f)
    page.evaluate("() => window.__coil.ghost(300)")
    rows = page.evaluate("() => window.__rec.end()")
    rig.clear()
    return rows, mark


def sc_btn_hold_still(page, rig):
    """⑪ 시작 버튼 «위»에 손가락을 얹고 판이 시작된 뒤 «가만히» 있는다.
    의도치 않은 조종·자동 질주가 «없어야» 한다 (aim=null, boost 프레임 0)."""
    to_menu(page, rig)
    bx, by = play_btn(page)
    rig.down(0, bx, by)             # 시작 버튼 위에 얹는다
    page.wait_for_timeout(150)
    page.evaluate("() => document.querySelector('button.p-play').click()")
    page.wait_for_timeout(900)
    if page.evaluate("() => window.__coil.state().mode") != "play":
        raise RuntimeError("run did not start")
    page.evaluate("() => window.__coil.ghost(300)")
    page.evaluate("() => window.__rec.begin()")
    for _ in range(12):             # 가만히(1px 미만 떨림도 없이)
        page.wait_for_timeout(80)
    rows = page.evaluate("() => window.__rec.end()")
    rig.clear()
    return rows, 0


def sc_menu_rest_moved(page, rig):
    """⑫ 메뉴에서 손가락을 «움직이다가» 그대로 판을 시작하고 민다.

    ★ 원점이 「메뉴에서 처음 닿은 곳」에 남아 있으면 판이 시작되는 순간 이미
      d 가 커서 «밀지도 않았는데» 뱀이 꺾인다. 원점을 판 시작 시점 좌표로
      못박았는지를 dist_first 로 가른다(0 이어야 한다)."""
    to_menu(page, rig)
    f = (150.0, 600.0)
    rig.down(0, *f)
    page.wait_for_timeout(120)
    for i in range(1, 7):           # 메뉴를 보는 동안 엄지가 움직인다
        rig.move(0, f[0] + 12 * i, f[1] - 9 * i)
        page.wait_for_timeout(40)
    g = (f[0] + 72, f[1] - 54)
    page.evaluate("() => document.querySelector('button.p-play').click()")
    page.wait_for_timeout(900)
    if page.evaluate("() => window.__coil.state().mode") != "play":
        raise RuntimeError("run did not start")
    page.evaluate("() => window.__coil.ghost(300)")
    page.evaluate("() => window.__rec.begin()")
    page.wait_for_timeout(200)
    mark = 0
    push(rig, page, 0, *g)
    rows = page.evaluate("() => window.__rec.end()")
    rig.clear()
    return rows, mark


def sc_boost_held_swap(page, rig):
    """⑨ 질주 «버튼»을 B 로 누른 채 조종하던 A 를 떼고, B 로 민다."""
    start_run_by_button(page, rig)
    bb = page.evaluate("() => window.__coil.state().boostBtn")
    page.evaluate("() => window.__rec.begin()")
    a = (150.0, 500.0)
    rig.down(0, *a)
    page.wait_for_timeout(100)
    for i in range(1, 4):
        rig.move(0, a[0] - 8 * i, a[1] - 6 * i)
        page.wait_for_timeout(25)
    rig.down(1, bb["x"], bb["y"])
    page.wait_for_timeout(100)
    rig.up(0)
    page.wait_for_timeout(120)
    mark = page.evaluate("() => window.__rec.rows.length")
    push(rig, page, 1, bb["x"], bb["y"], dist=95.0, theta=-2.6)
    rows = page.evaluate("() => window.__rec.end()")
    rig.clear()
    return rows, mark


def _two_rest_swap(page, rig, bmove, on_boost):
    """⑬ 메뉴에 손가락 «둘»(A·B)을 얹고 시작 → B 를 옮김 → A 를 «뗀다».

    ★ 노리는 것: B 는 판 시작 시점에 «역할이 없는» 손가락이다. 그 손가락의
      스틱 원점을 「판 시작 시점 좌표」에 못박아 두면, A 를 떼고 B 가 채택되는
      순간 d = |지금 B 위치 - 판 시작 시점 B 위치| 가 «통째로» 들어간다.
      = 밀지도 않았는데 그 각도로 급회전한다.
      판정값은 d_at_adopt(채택되는 그 프레임의 d). 데드존은 4 다.
    """
    to_menu(page, rig)
    a = (150.0, 620.0)
    if on_boost:
        bb = page.evaluate("() => window.__coil.state().boostBtn")
        b = (bb["x"], bb["y"])
    else:
        b = (250.0, 520.0)
    rig.down(0, *a)                       # A
    page.wait_for_timeout(120)
    rig.down(1, *b)                       # B
    page.wait_for_timeout(150)
    page.evaluate("() => document.querySelector('button.p-play').click()")
    page.wait_for_timeout(900)
    if page.evaluate("() => window.__coil.state().mode") != "play":
        raise RuntimeError("run did not start")
    page.evaluate("() => window.__coil.ghost(300)")
    page.evaluate("() => window.__rec.begin()")
    page.wait_for_timeout(150)
    # B 를 옮긴다(A 가 조종을 들고 있으므로 이 이동은 «아무 역할도 없다»)
    steps = 8
    for i in range(1, steps + 1):
        rig.move(1, b[0] - bmove * i / steps, b[1] - bmove * i / steps * 0.6)
        page.wait_for_timeout(25)
    mark = page.evaluate("() => window.__rec.rows.length")
    rig.up(0)                             # ★ A 를 뗀다 = 그 순간 B 가 채택된다
    for _ in range(14):
        page.wait_for_timeout(60)
    rows = page.evaluate("() => window.__rec.end()")
    rig.clear()
    return rows, mark


def sc_two_rest_swap_far(page, rig):
    """⑬a B 를 «크게»(≥90px) 옮긴 뒤 A 를 뗀다."""
    return _two_rest_swap(page, rig, 105.0, False)


def sc_two_rest_swap_near(page, rig):
    """⑬b B 를 «데드존 미만»만 옮긴 뒤 A 를 뗀다(대조군)."""
    return _two_rest_swap(page, rig, 2.0, False)


def sc_two_rest_swap_boost(page, rig):
    """⑬c B 가 «질주 버튼 위»일 때."""
    return _two_rest_swap(page, rig, 105.0, True)


SCEN = [("1_menu_rest", sc_menu_rest),
        ("1b_menu_relift", sc_menu_rest_relift),
        ("10_start_now", sc_start_immediate), ("2_fresh", sc_fresh),
        ("3_boost", sc_boost), ("4_second_finger", sc_second_finger),
        ("5_finger_swap", sc_finger_swap), ("6_blur_mid", sc_blur_mid),
        ("7_blur_storm", sc_blur_storm), ("8_pause_mid", sc_pause_mid),
        ("9_boost_held_swap", sc_boost_held_swap),
        ("11_btn_hold_still", sc_btn_hold_still),
        ("12_menu_rest_moved", sc_menu_rest_moved),
        ("13a_two_rest_far", sc_two_rest_swap_far),
        ("13b_two_rest_near", sc_two_rest_swap_near),
        ("13c_two_rest_boost", sc_two_rest_swap_boost)]


def main() -> int:
    dist_dir = Path(sys.argv[1]).resolve()
    tag = sys.argv[2]
    reps = int(sys.argv[3]) if len(sys.argv) > 3 else 6
    # 4번째 인자: 돌릴 시나리오 이름 조각(쉼표 구분). 없으면 전부.
    only = [s for s in sys.argv[4].split(",") if s] if len(sys.argv) > 4 else []
    port, srv = serve(dist_dir)
    res = {}
    raw = {}
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": VW, "height": VH},
                            device_scale_factor=2, is_mobile=True,
                            has_touch=True, locale="ko-KR")
        ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                            % json.dumps(json.dumps(SAVE, ensure_ascii=False)))
        ctx.add_init_script(RECORDER)
        page = ctx.new_page()
        page.goto("http://127.0.0.1:%d/?debug=1&quiet=1&seed=7" % port,
                  wait_until="load")
        page.wait_for_timeout(900)
        cdp = ctx.new_cdp_session(page)
        rig = Rig(page, cdp)
        page.evaluate("() => window.__coil.startRun()")
        page.wait_for_timeout(400)

        for name, fn in SCEN:
            if only and not any(k in name for k in only):
                continue
            out = []
            for _ in range(reps):
                try:
                    rows, mark = fn(page, rig)
                    out.append(summarize(rows, mark))
                    if name not in raw:
                        raw[name] = rows
                except Exception as ex:
                    out.append({"error": str(ex)[:200]})
                page.wait_for_timeout(150)
            res[name] = out
        ctx.close()
        b.close()
    srv.shutdown()

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / ("reassign_%s.json" % tag)).write_text(
        json.dumps({"res": res, "raw_first": raw, "cols": COL},
                   ensure_ascii=False, indent=1), encoding="utf-8")

    print("== qa_joystick_reassign  [%s]  reps=%d" % (tag, reps))
    print("%-19s %6s %6s %8s %7s %8s %7s %7s %6s %7s" %
          ("scenario", "asg", "adp", "drift", "d0", "dAdopt", "dMax",
           "aimF", "bstF", "dead"))
    for name, rows in res.items():
        ok = [r for r in rows if "error" not in r and r.get("n")]
        if not ok:
            print("%-16s  ERROR %s" % (name, rows[0].get("error", "no data")))
            continue

        def f(k, ok=ok):
            return sum(r[k] for r in ok) / len(ok)

        dead = sum(1 for r in ok if r["aim_end"] is None)
        print("%-19s %6.2f %6.2f %8.1f %7.1f %8.1f %7.1f %7.1f %6.1f  %d/%d" % (
            name, f("asg_delta"), f("adp_delta"), f("origin_drift_px"),
            f("dist_first"), f("d_at_adopt"), f("dist_max"),
            f("aim_live_frames"), f("boost_frames"), dead, len(ok)))
    print("  asg=push 구간 steerAssigns 증가 / drift=원점 이동 누적 px / "
          "d0=구간 첫 프레임 |C-O| / dAdopt=조종이 «새로 배정된» 프레임의 |C-O| "
          "(-1=배정 없음) / dMax=|C-O| 최대 / bstF=질주 프레임 / "
          "dead=aim null 판수")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
