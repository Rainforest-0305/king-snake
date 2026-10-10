# -*- coding: utf-8 -*-
"""shots_lane_a.py — 레인 A(2026-09-10) 전/후 실렌더 스크린샷. ⛔headless 전용.

  python tools/shots_lane_a.py <distDir> <outDir> [--toss] [--locales ko,en] [--widths 375,390,430]

★ 무엇을 찍나(있으면 찍고, 없으면 건너뛴다 — 전/후 빌드에 같은 스크립트를 쓴다):
  1_menu        시작 화면(기록 카드·설정 블록 — 배너 자리·푸시 행 유무가 여기서 보인다)
  2_menu_set    설정 블록으로 스크롤한 시작 화면
  3_death       결과(사망) 화면 — 리워드 스텁을 꽂아 부활·2배 버튼이 «실제로» 뜨는 상태
  4_death_after 2배 광고를 본 «뒤»(있을 때만)

★ --toss : 가짜 네이티브 브릿지(ReactNativeWebView.postMessage 감청 + __GRANITE_NATIVE_EMITTER)
  를 꽂아 isInToss() 를 참으로 만든다. 광고 SDK 청크는 로컬 dist 에서 뜨고, 모든 postMessage 는
  감청기에서 끝난다 — 외부 요청은 route guard 로 «전부 차단»한다(운영 지면 ID 로컬 렌더 금지).
"""
from __future__ import annotations

import argparse
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

for _st in (sys.stdout, sys.stderr):
    try:
        _st.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

sys.path.insert(0, r'C:/Users/USER/tools')
from safe_headless_browser import open_browser  # noqa: E402

SAVE = {
    "v": 1, "savedAt": 0, "bestScore": 20847, "bestRank": 1, "games": 5,
    "totalKills": 18, "playSeconds": 900, "nick": "리미", "skin": "corn",
    "control": "joystick", "sound": True, "locale": "ko",
}

FAKE_BRIDGE_JS = r"""(() => {
  window.__KS_SENT = [];
  window.__KS_STORE = {};
  const listeners = new Map();
  window.__GRANITE_NATIVE_EMITTER = {
    on: (ev, cb) => { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(cb);
      return () => { const s = listeners.get(ev); if (s) s.delete(cb); }; },
    emit: (ev, data) => { const s = listeners.get(ev); if (!s) return 0; for (const cb of [...s]) { try { cb(data); } catch (e) {} } return s.size; },
  };
  window.__CONSTANT_HANDLER_MAP = {};
  window.ReactNativeWebView = {
    postMessage: (raw) => {
      let m = null;
      try { m = JSON.parse(raw); } catch { m = { raw }; }
      window.__KS_SENT.push(m);
      if (!m || !m.eventId || !m.functionName) return;
      if (m.type === 'addEventListener' || m.type === 'removeEventListener') return;
      const a = Array.isArray(m.args) ? m.args : [];
      let reply = null;
      if (m.functionName === 'getStorageItem') reply = (a[0] in window.__KS_STORE) ? window.__KS_STORE[a[0]] : null;
      else if (m.functionName === 'setStorageItem') { window.__KS_STORE[a[0]] = String(a[1]); reply = null; }
      else if (m.functionName === 'removeStorageItem') { delete window.__KS_STORE[a[0]]; reply = null; }
      else if (m.functionName === 'openURL') reply = null;
      setTimeout(() => { window.__GRANITE_NATIVE_EMITTER.emit(m.functionName + '/resolve/' + m.eventId, reply); }, 0);
    },
  };
})()"""


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
    ap.add_argument('dist')
    ap.add_argument('out')
    ap.add_argument('--toss', action='store_true')
    ap.add_argument('--locales', default='ko,en')
    ap.add_argument('--widths', default='390')
    a = ap.parse_args()
    dist = Path(a.dist).resolve()
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    port, srv = serve(dist)
    external: list[str] = []
    errs: list[str] = []
    shots: list[str] = []
    try:
        with open_browser() as (_pw, br):
            for loc in a.locales.split(','):
                for w in [int(x) for x in a.widths.split(',')]:
                    ctx = br.new_context(viewport={"width": w, "height": 844}, device_scale_factor=2,
                                         locale='ko-KR' if loc == 'ko' else 'en-US', has_touch=True, is_mobile=True)

                    def guard(route):
                        u = route.request.url
                        if u.startswith("http://127.0.0.1:%d" % port) or u.startswith("data:") or u.startswith("blob:"):
                            return route.continue_()
                        external.append(u)
                        return route.abort()
                    ctx.route("**/*", guard)
                    if a.toss:
                        ctx.add_init_script(FAKE_BRIDGE_JS)
                    sv = dict(SAVE)
                    sv['locale'] = loc
                    ctx.add_init_script("localStorage.setItem('king-snake.save', %s)" % json.dumps(json.dumps(sv)))
                    page = ctx.new_page()
                    page.on("console", lambda m: errs.append(m.type + ": " + m.text) if m.type == "error" else None)
                    page.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
                    page.goto("http://127.0.0.1:%d/index.html?debug=1&quiet=1" % port, wait_until="load")
                    page.wait_for_timeout(1400)
                    tag = "%s_%d%s" % (loc, w, "_toss" if a.toss else "")
                    # 리워드 스텁 — 버튼이 «실제로» 뜬 상태를 찍는다(운영 ID 는 스텁이 받기만 한다).
                    page.evaluate("() => window.__coilAds && window.__coilAds.installStub({load:'ok', show:'reward'})")
                    page.evaluate("() => window.__coilReward && window.__coilReward.refresh()")
                    page.wait_for_timeout(300)
                    p1 = out / f"{tag}_1_menu.png"
                    page.screenshot(path=str(p1)); shots.append(p1.name)
                    page.evaluate("() => { const s=document.querySelector('.p-set'); if (s) s.scrollIntoView({block:'center'}); }")
                    page.wait_for_timeout(300)
                    p2 = out / f"{tag}_2_menu_set.png"
                    page.screenshot(path=str(p2)); shots.append(p2.name)
                    # 결과 화면
                    page.evaluate("() => window.__coil.startRun()")
                    page.wait_for_function("() => window.__coil.state().mode === 'play'", timeout=5000)
                    page.wait_for_timeout(300)
                    page.evaluate("() => window.__coil.grow(1483)")
                    page.wait_for_timeout(200)
                    page.evaluate("() => window.__coil.kill()")
                    page.wait_for_function("() => window.__coil.state().mode === 'dead'", timeout=6000)
                    page.wait_for_timeout(1300)
                    p3 = out / f"{tag}_3_death.png"
                    page.screenshot(path=str(p3)); shots.append(p3.name)
                    has_double = page.evaluate("() => !!(window.__coilReward && typeof window.__coilReward.doubleAd === 'function')")
                    if has_double:
                        page.evaluate("() => window.__coilReward.doubleAd()")
                        page.wait_for_timeout(900)
                        p4 = out / f"{tag}_4_death_after.png"
                        page.screenshot(path=str(p4)); shots.append(p4.name)
                    ctx.close()
    finally:
        srv.shutdown(); srv.server_close()
    rep = {"dist": str(dist), "toss": a.toss, "shots": shots, "external": external, "errors": errs}
    (out / "shots.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(rep, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
