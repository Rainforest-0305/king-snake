"""probe_joystick.py - joystick input path ground-truth probe (headless only).

Measures, on the REAL game build in dist/, for both Chromium and WebKit:
  * what element is hit-tested at natural right-thumb positions
  * canvas geometry vs window.innerWidth/Height vs visualViewport
  * whether a native touch drag produces touchmove and moves the knob
  * boost-button rect, minimap rect, safe-area insets read from CSS

Read-only. No screen windows, no dev server left behind.
Usage: python tools/probe_joystick.py [--engine chromium|webkit|both]
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

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
OUT = ROOT / "qa" / "probe"

W, H = 393, 852

PROBE_JS = r"""
window.__probe = { el: {}, win: {}, ids: [], moves: 0, lastTouches: [] };
function bump(bag, k) { bag[k] = (bag[k] || 0) + 1; }
var KINDS = ['touchstart','touchmove','touchend','touchcancel',
             'pointerdown','pointermove','pointerup','pointercancel'];
KINDS.forEach(function (k) {
  window.addEventListener(k, function (e) {
    bump(window.__probe.win, k);
    if (e.changedTouches) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (window.__probe.ids.length < 40) {
          window.__probe.ids.push(k + ':' + t.identifier + '@' +
            Math.round(t.clientX) + ',' + Math.round(t.clientY));
        }
      }
    }
  }, { passive: true, capture: true });
});
document.addEventListener('DOMContentLoaded', function () {
  var cv = document.getElementById('stage');
  if (!cv) return;
  KINDS.forEach(function (k) {
    cv.addEventListener(k, function () { bump(window.__probe.el, k); },
      { passive: true, capture: true });
  });
});
window.__geom = function () {
  var cv = document.getElementById('stage');
  var r = cv.getBoundingClientRect();
  var cs = getComputedStyle(document.documentElement);
  var probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;' +
    'padding-top:env(safe-area-inset-top,0px);' +
    'padding-right:env(safe-area-inset-right,0px);' +
    'padding-bottom:env(safe-area-inset-bottom,0px);' +
    'padding-left:env(safe-area-inset-left,0px);';
  document.body.appendChild(probe);
  var ps = getComputedStyle(probe);
  var safe = { top: ps.paddingTop, right: ps.paddingRight,
               bottom: ps.paddingBottom, left: ps.paddingLeft };
  probe.remove();
  return {
    canvasRect: { x: r.x, y: r.y, w: r.width, h: r.height },
    canvasAttr: { w: cv.width, h: cv.height },
    canvasStyle: { w: cv.style.width, h: cv.style.height },
    inner: { w: window.innerWidth, h: window.innerHeight },
    vv: window.visualViewport ? {
      w: window.visualViewport.width, h: window.visualViewport.height,
      ox: window.visualViewport.offsetLeft, oy: window.visualViewport.offsetTop,
      scale: window.visualViewport.scale } : null,
    dpr: window.devicePixelRatio,
    safeAreaCss: safe,
    touchAction: getComputedStyle(cv).touchAction,
    hasOnTouchStart: ('ontouchstart' in window),
    maxTouchPoints: navigator.maxTouchPoints,
    coarse: window.matchMedia('(pointer: coarse)').matches,
    hoverNone: window.matchMedia('(hover: none)').matches,
    rootFontOk: !!cs
  };
};
window.__hit = function (pts) {
  return pts.map(function (p) {
    var e = document.elementFromPoint(p[0], p[1]);
    if (!e) return p[0] + ',' + p[1] + ' -> null';
    var st = getComputedStyle(e);
    return p[0] + ',' + p[1] + ' -> ' + e.tagName +
      (e.id ? '#' + e.id : '') +
      (e.className ? '.' + String(e.className).slice(0, 24) : '') +
      ' pe=' + st.pointerEvents + ' z=' + st.zIndex;
  });
};
"""


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(DIST), **kw)

    def log_message(self, *a):
        pass


def serve():
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1], httpd


def ang_err(a, b):
    d = (a - b + math.pi) % (2 * math.pi) - math.pi
    return abs(math.degrees(d))


def synth_touch(page, kind, pts, ident=7):
    """Dispatch a TouchEvent built in-page. Used where the engine has no
    native drag primitive (WebKit). Delivery is real; payload is synthetic."""
    return page.evaluate(
        """([kind, pts, ident]) => {
      const cv = document.getElementById('stage');
      const mkTouch = (x, y) => {
        try {
          return new Touch({ identifier: ident, target: cv, clientX: x, clientY: y,
            pageX: x, pageY: y, screenX: x, screenY: y, radiusX: 12, radiusY: 12,
            rotationAngle: 0, force: 1 });
        } catch (err) { /* fall through */ }
        if (typeof document.createTouch === 'function') {
          return document.createTouch(window, cv, ident, x, y, x, y);
        }
        return { identifier: ident, target: cv, clientX: x, clientY: y,
          pageX: x, pageY: y, screenX: x, screenY: y };
      };
      const arr = pts.map(p => mkTouch(p[0], p[1]));
      const listOf = (a) => {
        if (typeof document.createTouchList === 'function') {
          return document.createTouchList.apply(document, a);
        }
        return a;
      };
      const cur = kind === 'touchend' ? [] : arr;
      // 1) modern constructor
      try {
        const ev = new TouchEvent(kind, { cancelable: true, bubbles: true,
          composed: true, touches: cur, targetTouches: cur, changedTouches: arr });
        cv.dispatchEvent(ev);
        return 'TouchEvent-ctor';
      } catch (err) { /* fall through */ }
      // 2) legacy WebKit initTouchEvent
      try {
        const ev = document.createEvent('TouchEvent');
        ev.initTouchEvent(listOf(arr), listOf(arr), listOf(arr), kind, window,
          0, 0, pts[0] ? pts[0][0] : 0, pts[0] ? pts[0][1] : 0,
          false, false, false, false);
        cv.dispatchEvent(ev);
        return 'initTouchEvent';
      } catch (err) { /* fall through */ }
      // 3) last resort: plain Event carrying touch lists
      const ev = new Event(kind, { cancelable: true, bubbles: true });
      Object.defineProperty(ev, 'touches', { value: cur });
      Object.defineProperty(ev, 'targetTouches', { value: cur });
      Object.defineProperty(ev, 'changedTouches', { value: arr });
      cv.dispatchEvent(ev);
      return 'plain-Event';
    }""",
        [kind, pts, ident],
    )


def run(engine, pw, base, results):
    launcher = getattr(pw, engine)
    browser = launcher.launch(headless=True)
    ctx = browser.new_context(
        viewport={"width": W, "height": H},
        device_scale_factor=3, is_mobile=True, has_touch=True, locale="ko-KR",
    )
    ctx.add_init_script(PROBE_JS)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)

    page.goto(f"{base}/?debug=1&ads=off", wait_until="load")
    page.wait_for_timeout(1400)

    r = {"engine": engine}
    r["geom"] = page.evaluate("() => window.__geom()")

    # start the run
    try:
        page.tap("button.btn-primary")
    except Exception:
        page.click("button.btn-primary")
    page.wait_for_timeout(900)

    st0 = page.evaluate("() => window.__coil.state()")
    r["state_after_start"] = {k: st0[k] for k in
                             ("mode", "alive", "usedTouch", "control", "stick", "boostBtn")}

    bb = st0["boostBtn"]
    thumb_pts = [
        [int(W * 0.82), int(H * 0.74)],
        [int(bb["x"]), int(bb["y"])],
        [int(W * 0.5), int(H * 0.6)],
        [int(W * 0.82), int(H * 0.90)],
    ]
    r["hits"] = page.evaluate("(p) => window.__hit(p)", thumb_pts)

    # ── native drag ──────────────────────────────────────────────────────
    ox, oy = int(W * 0.72), int(H * 0.70)
    want = math.atan2(-1, 0)  # up
    page.evaluate("() => window.__probe.el = {}")
    page.evaluate("() => window.__probe.win = {}")

    native_ok = False
    if engine == "chromium":
        cdp = ctx.new_cdp_session(page)

        def send(kind, pts):
            cdp.send("Input.dispatchTouchEvent", {
                "type": kind,
                "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)],
            })

        send("touchStart", [(ox, oy)])
        page.wait_for_timeout(80)
        for f in (0.34, 0.67, 1.0):
            send("touchMove", [(ox, oy - 90 * f)])
            page.wait_for_timeout(50)
        native_ok = True
    else:
        r["synth_kind"] = synth_touch(page, "touchstart", [[ox, oy]])
        page.wait_for_timeout(80)
        for f in (0.34, 0.67, 1.0):
            synth_touch(page, "touchmove", [[ox, oy - 90 * f]])
            page.wait_for_timeout(50)

    page.wait_for_timeout(120)
    st = page.evaluate("() => window.__coil.state()")
    r["drag"] = {
        "native": native_ok,
        "stick": st["stick"],
        "aim": st["aim"],
        "aimErrDeg": None if st["aim"] is None else round(ang_err(st["aim"], want), 1),
        "usedTouch": st["usedTouch"],
    }
    r["probe"] = page.evaluate("() => ({el: window.__probe.el, win: window.__probe.win, ids: window.__probe.ids})")
    OUT.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(OUT / f"{engine}_drag.png"))

    # trusted tap reach test (both engines support tap)
    page.evaluate("() => { window.__probe.el = {}; window.__probe.win = {}; }")
    page.touchscreen.tap(int(W * 0.3), int(H * 0.5))
    page.wait_for_timeout(150)
    r["trusted_tap"] = page.evaluate("() => ({el: window.__probe.el, win: window.__probe.win})")

    r["errors"] = errs[:8]
    results.append(r)
    ctx.close()
    browser.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", default="both")
    a = ap.parse_args()
    if not (DIST / "index.html").exists():
        print("dist missing. run: npm run build:web")
        return 2
    port, httpd = serve()
    base = f"http://127.0.0.1:{port}"
    engines = ["chromium", "webkit"] if a.engine == "both" else [a.engine]
    results = []
    with sync_playwright() as pw:
        for e in engines:
            try:
                run(e, pw, base, results)
            except Exception as ex:
                results.append({"engine": e, "fatal": str(ex)[:400]})
    httpd.shutdown()
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
