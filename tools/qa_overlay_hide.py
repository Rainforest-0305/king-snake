# -*- coding: utf-8 -*-
"""qa_overlay_hide.py - 오버레이 숨김 방식을 바꾼 뒤 «화면이 안 깨졌는가».

  python tools/qa_overlay_hide.py <distDir> <tag>

★ 무엇을 확인하나
  .overlay/#hud 의 .hidden 을 display:none → visibility:hidden 으로 바꿨다.
  그 변경이 만들 수 있는 사고는 셋이고, 셋 다 «계산된 스타일»로 잰다:
   ① 숨겨야 할 것이 안 숨는다        → visibility 가 hidden 인가
   ② 숨긴 것이 터치를 먹는다          → pointer-events 가 none 인가
                                      + elementFromPoint 가 캔버스를 주는가
   ③ 흐름 안 요소까지 바뀌었다        → 리더보드 줄·배지 등은 여전히 display:none
                                        이어야 한다(전역 .hidden 무변경 확인)
  + 메뉴/게임 두 화면 실렌더 스크린샷.
★ headless 고정.
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
OUT = ROOT / "_joy_260903" / "overlay"
SAVE = {"v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
        "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
        "control": "joystick", "sound": False, "locale": None}

PROBE = """() => {
  const out = { nodes: [], hit: {}, flow: [] };
  const cs = (n) => { const s = getComputedStyle(n);
    return { display: s.display, visibility: s.visibility, pe: s.pointerEvents }; };
  for (const n of document.querySelectorAll('.overlay, #hud')) {
    const r = n.getBoundingClientRect();
    out.nodes.push({ cls: String(n.className) || n.id, hidden: n.classList.contains('hidden'),
                     ...cs(n), w: Math.round(r.width), h: Math.round(r.height) });
  }
  /* ③ 흐름 안 요소는 여전히 display:none 이어야 한다(전역 .hidden 무변경 증명) */
  for (const sel of ['.hud-board li.hidden', '.badges.hidden', '.stat-block.hidden',
                     '.ctrl-row.hidden', '.rw-offer.hidden', '.btn-reward.hidden']) {
    for (const n of document.querySelectorAll(sel)) {
      out.flow.push({ sel, display: getComputedStyle(n).display });
    }
  }
  const at = (x, y) => { const e = document.elementFromPoint(x, y);
    return e ? (e.id || String(e.className) || e.tagName) : 'none'; };
  out.hit = { center: at(195, 422), lowerLeft: at(90, 660), lowerRight: at(320, 660) };
  return out;
}"""


def serve(d):
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
    out = {}
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": 390, "height": 844},
                            device_scale_factor=2, is_mobile=True,
                            has_touch=True, locale="ko-KR")
        ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                            % json.dumps(json.dumps(SAVE, ensure_ascii=False)))
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)[:160]))
        page.goto("http://127.0.0.1:%d/?debug=1&quiet=1&seed=7" % port, wait_until="load")
        page.wait_for_timeout(900)

        out["menu"] = page.evaluate(PROBE)
        page.screenshot(path=str(OUT / ("%s_1menu.png" % tag)))

        page.evaluate("() => window.__coil.startRun()")
        page.wait_for_timeout(1200)
        out["play"] = page.evaluate(PROBE)
        page.screenshot(path=str(OUT / ("%s_2play.png" % tag)))

        page.evaluate("() => window.__coil.toMenu()")
        page.wait_for_timeout(800)
        out["backToMenu"] = page.evaluate(PROBE)
        page.screenshot(path=str(OUT / ("%s_3menu_again.png" % tag)))
        out["errors"] = errs
        ctx.close()
        b.close()
    srv.shutdown()
    (ROOT / "_joy_260903" / ("overlay_%s.json" % tag)).write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    bad = []
    for phase in ("menu", "play", "backToMenu"):
        d = out[phase]
        print("== %s" % phase)
        for n in d["nodes"]:
            mark = ""
            if n["hidden"]:
                # «제대로 숨었는가»의 기준은 둘 중 하나면 된다:
                #   display:none                            (현재 채택 - 상자가 없다)
                #   visibility:hidden + pointer-events:none (상자는 남기고 무력화)
                okhide = (n["display"] == "none"
                          or (n["visibility"] == "hidden" and n["pe"] == "none"))
                if not okhide:
                    mark = "  !! 숨김이 불완전하다(터치를 먹을 수 있다)"
                    bad.append((phase, n["cls"]))
            print("   %-28s hidden=%-5s display=%-6s vis=%-8s pe=%s%s"
                  % (n["cls"][:28], n["hidden"], n["display"], n["visibility"], n["pe"], mark))
        print("   hit: %s" % d["hit"])
        for f in d["flow"]:
            if f["display"] != "none":
                print("   !! 흐름 요소가 display:none 이 아니다: %s -> %s" % (f["sel"], f["display"]))
                bad.append((phase, f["sel"]))
    print()
    # ★ 진짜로 중요한 것은 속성이 아니라 «결과»다: 플레이 중에 화면 아무 데나
    #   눌렀을 때 캔버스가 받는가. 숨긴 오버레이가 하나라도 가로채면 조작이 죽는다.
    h = out["play"]["hit"]
    for k, v in h.items():
        if v != "stage":
            print("   !! play 에서 %s 지점을 %s 가 가로챈다" % (k, v))
            bad.append(("play", "hit:" + k))
    print("판정:", "FAIL %s" % bad if bad else
          "PASS (숨김 정상 · 흐름 요소 무변경 · play 에서 캔버스가 터치를 받는다)")
    if errs:
        print("errors:", errs[:3])
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
