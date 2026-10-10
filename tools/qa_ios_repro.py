# -*- coding: utf-8 -*-
"""qa_ios_repro.py — 「iPhone 에서 조종스틱이 안 먹는다」를 WebKit 으로 재현 시도 +
캔버스 위에 무엇이 얹혀 있는지 실측.

  python tools/qa_ios_repro.py <distDir> <tag> [--engine webkit|chromium]

★ 왜 WebKit 인가: 크로미움 결과는 이 문제의 «증거가 아니다». iOS 는 WebKit 이고,
  터치→포인터 «합성»과 암묵 캡처 규칙이 엔진마다 다르다.
★ el.dispatchEvent 를 쓰지 않는다 — page.touchscreen / mouse 는 실제 hit-test 를
  타므로 「캔버스가 이벤트를 못 받는다」가 재현될 수 있다. 합성 dispatch 는
  그 층을 건너뛰어 «항상 성공»한다(그래서 지금까지 못 잡았다).
★ 헤드리스 전용.

측정 항목
  ① el(#stage) 가 pointerdown 을 받았는가 / window 는 받았는가
  ② pointercancel 이 오는가 (네이티브가 제스처를 가져가는 신호)
  ③ 밀었을 때 aim 이 나오는가
  ④ 캔버스 위에 있는 요소 목록과 각각의 pointer-events / elementFromPoint 결과
"""
from __future__ import annotations

import argparse
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
OUT = ROOT / "_joyfix_260907"
SAVE = {"v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
        "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
        "control": "joystick", "sound": False, "locale": None}

# 바깥 관찰자 — 빌드에 손대지 않고 «어디로» 이벤트가 갔는지 센다.
OBS = r"""
(function () {
  if (window.__io) return;
  var S = { el: {}, win: {}, lastTarget: '-', lastDownTarget: '-', errs: [] };
  window.__io = S;
  var K = ['pointerdown','pointermove','pointerup','pointercancel',
           'touchstart','touchmove','touchend','touchcancel','lostpointercapture'];
  K.forEach(function (k) { S.el[k] = 0; S.win[k] = 0; });
  function name(t) {
    if (!t) return 'null';
    if (t === window) return 'window';
    if (t === document) return 'document';
    if (t.nodeType !== 1) return String(t);
    var c = (typeof t.className === 'string' && t.className)
      ? '.' + t.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    return t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') + c;
  }
  K.forEach(function (k) {
    window.addEventListener(k, function (e) {
      S.win[k]++;
      S.lastTarget = name(e.target);
      if (k === 'pointerdown' || k === 'touchstart') S.lastDownTarget = name(e.target);
    }, { passive: true, capture: true });
  });
  function attach() {
    var cv = document.getElementById('stage');
    if (!cv) return false;
    K.forEach(function (k) {
      cv.addEventListener(k, function () { S.el[k]++; }, { passive: true, capture: true });
    });
    return true;
  }
  if (!attach()) {
    var iv = setInterval(function () { if (attach()) clearInterval(iv); }, 25);
  }
  window.addEventListener('error', function (e) {
    if (S.errs.length < 10) S.errs.push(String(e.message).slice(0, 160));
  });
})();
"""

# 캔버스 위에 얹힌 것 전수 조사
LAYERS = r"""() => {
  const cv = document.getElementById('stage');
  const cz = cv ? (parseInt(getComputedStyle(cv).zIndex, 10) || 0) : 0;
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' && s.position !== 'absolute') continue;
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) continue;
    const z = parseInt(s.zIndex, 10) || 0;
    if (z < cz) continue;
    out.push({
      tag: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
        + (typeof el.className === 'string' && el.className
           ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''),
      z: z, pos: s.position, pe: s.pointerEvents,
      ta: s.touchAction, op: s.opacity,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    });
  }
  const probes = {};
  for (const [k, p] of Object.entries({
    mid: [195, 420], lowleft: [150, innerHeight - 150],
    lowmid: [195, innerHeight - 120], boost: [326, innerHeight - 174],
  })) {
    const e = document.elementFromPoint(p[0], p[1]);
    probes[k] = e ? (e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')
      + (typeof e.className === 'string' && e.className
         ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')) : 'none';
  }
  const css = {};
  for (const sel of ['html', 'body', '#app', '#stage']) {
    const el = document.querySelector(sel);
    css[sel] = el ? {
      touchAction: getComputedStyle(el).touchAction,
      overscroll: getComputedStyle(el).overscrollBehavior,
      overflow: getComputedStyle(el).overflow,
    } : null;
  }
  // .overlay 가 «어떻게» 숨는가
  const ovs = [];
  for (const o of document.querySelectorAll('.overlay')) {
    const s = getComputedStyle(o);
    ovs.push({ cls: o.className, display: s.display, visibility: s.visibility,
               opacity: s.opacity, pe: s.pointerEvents, z: s.zIndex,
               rects: o.getClientRects().length });
  }
  return { canvasZ: cz, layers: out, probes, css, overlays: ovs };
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
    ap = argparse.ArgumentParser()
    ap.add_argument("dist")
    ap.add_argument("tag")
    ap.add_argument("--engine", default="webkit", choices=["webkit", "chromium"])
    a = ap.parse_args()

    dist = Path(a.dist).resolve()
    port, srv = serve(dist)
    res = {"engine": a.engine}
    try:
        with sync_playwright() as pw:
            eng = pw.webkit if a.engine == "webkit" else pw.chromium
            dev = dict(pw.devices["iPhone 14"])
            dev.pop("default_browser_type", None)
            b = eng.launch(headless=True)
            ctx = b.new_context(locale="ko-KR", **dev)
            ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                                % json.dumps(json.dumps(SAVE, ensure_ascii=False)))
            ctx.add_init_script(OBS)
            page = ctx.new_page()
            page.goto("http://127.0.0.1:%d/?debug=1&quiet=1&seed=7" % port,
                      wait_until="load")
            page.wait_for_timeout(1200)
            vw = page.evaluate("() => innerWidth")
            vh = page.evaluate("() => innerHeight")
            res["viewport"] = [vw, vh]

            # ── 메뉴 상태의 층 구조 ──
            res["layers_menu"] = page.evaluate(LAYERS)

            # ── 판을 «실제 버튼 탭»으로 시작 ──
            btn = page.query_selector("button.p-play")
            if btn:
                bb = btn.bounding_box()
                page.touchscreen.tap(bb["x"] + bb["width"] / 2,
                                     bb["y"] + bb["height"] / 2)
            page.wait_for_timeout(1200)
            res["mode_after_tap"] = page.evaluate(
                "() => window.__coil ? window.__coil.state().mode : 'no-hook'")
            if res["mode_after_tap"] != "play":
                page.evaluate("() => window.__coil && window.__coil.startRun()")
                page.wait_for_timeout(800)
                res["mode_after_tap"] = page.evaluate(
                    "() => window.__coil.state().mode") + "(forced)"
            page.evaluate("() => window.__coil.ghost(900)")

            # ── 인게임 층 구조 ──
            res["layers_play"] = page.evaluate(LAYERS)

            # ── ★ 실제 hit-test 를 타는 터치로 조종 시도 ──
            page.evaluate("() => { const s = window.__io;"
                          " for (const k in s.el) s.el[k] = 0;"
                          " for (const k in s.win) s.win[k] = 0; }")
            ox, oy = vw * 0.38, vh * 0.62
            page.touchscreen.tap(1, 1) if False else None
            # touchscreen 은 tap 만 있어 드래그가 안 된다 → CDP 가 없는 WebKit 에서는
            # mouse(=포인터) 로 «hit-test 를 타는» 드래그를 만든다. isMobile 컨텍스트라
            # pointerType 은 mouse 지만, 「캔버스가 pointerdown 을 받는가」는 그대로 잰다.
            page.mouse.move(ox, oy)
            page.mouse.down()
            page.wait_for_timeout(120)
            for i in range(1, 9):
                d = 110.0 * i / 8
                page.mouse.move(ox + math.cos(-2.2) * d, oy + math.sin(-2.2) * d)
                page.wait_for_timeout(35)
            page.wait_for_timeout(200)
            st = page.evaluate("() => ({ s: window.__coil.stick(),"
                               " d: window.__coil.diag(),"
                               " io: window.__io }) ")
            page.mouse.up()
            res["drag_mouse"] = {
                "aim": st["s"]["aim"], "stick": st["s"]["active"],
                "steerId": st["d"]["steerId"],
                "el": st["io"]["el"], "win": st["io"]["win"],
                "lastDownTarget": st["io"]["lastDownTarget"],
            }

            # ── 터치 탭이 캔버스에 닿는가(hit-test 만 확인) ──
            page.evaluate("() => { const s = window.__io;"
                          " for (const k in s.el) s.el[k] = 0;"
                          " for (const k in s.win) s.win[k] = 0; }")
            page.touchscreen.tap(ox, oy)
            page.wait_for_timeout(200)
            io2 = page.evaluate("() => window.__io")
            res["tap_touch"] = {"el": io2["el"], "win": io2["win"],
                                "lastDownTarget": io2["lastDownTarget"]}
            res["errs"] = io2["errs"]
            page.screenshot(path=str(OUT / ("ios_repro_%s_%s.png" % (a.tag, a.engine))))
            ctx.close()
            b.close()
    finally:
        srv.shutdown()

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / ("ios_repro_%s_%s.json" % (a.tag, a.engine))).write_text(
        json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")

    print("== iOS 재현 시도 [%s / %s]  viewport=%s" % (a.tag, a.engine, res["viewport"]))
    print("  판 시작:", res["mode_after_tap"])
    d = res["drag_mouse"]
    print("  드래그 결과  aim=%s  stick=%s  steerId=%s" % (d["aim"], d["stick"], d["steerId"]))
    print("    EL  pd=%d pm=%d pu=%d pc=%d | ts=%d tm=%d"
          % (d["el"]["pointerdown"], d["el"]["pointermove"], d["el"]["pointerup"],
             d["el"]["pointercancel"], d["el"]["touchstart"], d["el"]["touchmove"]))
    print("    WIN pd=%d pm=%d pu=%d pc=%d | ts=%d tm=%d   lastDownTarget=%s"
          % (d["win"]["pointerdown"], d["win"]["pointermove"], d["win"]["pointerup"],
             d["win"]["pointercancel"], d["win"]["touchstart"], d["win"]["touchmove"],
             d["lastDownTarget"]))
    t = res["tap_touch"]
    print("  터치 탭     EL ts=%d pd=%d | WIN ts=%d pd=%d  target=%s"
          % (t["el"]["touchstart"], t["el"]["pointerdown"],
             t["win"]["touchstart"], t["win"]["pointerdown"], t["lastDownTarget"]))
    print("  css:", json.dumps(res["layers_play"]["css"], ensure_ascii=False))
    print("  elementFromPoint:", json.dumps(res["layers_play"]["probes"], ensure_ascii=False))
    print("  캔버스 위 레이어(z >= canvas):")
    for l in res["layers_play"]["layers"]:
        print("    z=%-4s pe=%-10s ta=%-12s op=%-4s %s %s"
              % (l["z"], l["pe"], l["ta"], l["op"], l["rect"], l["tag"]))
    print("  overlays:")
    for o in res["layers_play"]["overlays"]:
        print("    %s display=%s vis=%s op=%s pe=%s rects=%d"
              % (o["cls"], o["display"], o["visibility"], o["opacity"], o["pe"], o["rects"]))
    if res["errs"]:
        print("  page errors:", res["errs"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
