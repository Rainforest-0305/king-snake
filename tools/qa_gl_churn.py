# -*- coding: utf-8 -*-
"""qa_gl_churn.py — WebGL 컨텍스트 손실 «반복»이 깜빡임을 만드는지, 가드가 끊는지.

  python tools/qa_gl_churn.py <distDir> <tag>

★ 무엇을 재현하나
  President: 「초거대 뱀은 사라졌다 나타났다」.
  컬링은 코드로 무죄가 확인됐다(bodyLen 기반 + trail trimTo 동기화 + 봇 despawn 없음).
  남은 기전: 컨텍스트를 잃으면 글로우 캔버스가 visibility:hidden 이 되고
  `lean` 이 뒤집혀 snakeRender 의 할로·꼬리글로우·테이퍼 알파가 통째로 바뀐다.
  그 차이는 «몸이 가장 긴 뱀»에서 가장 크다.

★ 재현 방법: WEBGL_lose_context 확장으로 «실제로» 컨텍스트를 떨군다.
  브라우저가 진짜 webglcontextlost/restored 를 발행하므로 실기기와 같은 경로다.

★ 판정
  · 손실 직후 bloomUsed=false, 복구 후 true 로 «되돌아오면» = 깜빡임 재현
  · 가드가 있으면 CHURN_MAX 회 반복 뒤 autoOff=true 로 «고정»되고 더는 안 뒤집힌다
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
OUT = ROOT / "_joy_260903"

SAVE = {"v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
        "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
        "control": "joystick", "sound": False, "locale": None}

# 글로우 캔버스(#glow)의 WebGL 컨텍스트를 찾아 확장으로 떨군다.
# ★ 확장 객체를 «잃기 전에» 잡아 둔다. 컨텍스트를 잃은 뒤에 getExtension 을
#   부르면 새로 만들어진 lost 컨텍스트라 null 이 온다(1차 실행에서 'no ext' 로 걸렸다).
GRAB = """() => {
  const c = document.getElementById('glow');
  if (!c) return 'no #glow';
  const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
  if (!gl) return 'no gl';
  const ext = gl.getExtension('WEBGL_lose_context');
  if (!ext) return 'no ext';
  window.__loseExt = ext;
  return 'ok';
}"""
LOSE = """() => {
  if (!window.__loseExt) return 'no ext';
  window.__loseExt.loseContext();
  return 'lost';
}"""
RESTORE = """() => {
  if (!window.__loseExt) return 'no ext';
  window.__loseExt.restoreContext();
  return 'restored';
}"""
PROBE = """() => {
  const s = window.__coil.state();
  const g = document.getElementById('glow');
  return { bloom: s.bloom, fps: Math.round(s.fps),
           glowVis: g ? getComputedStyle(g).visibility : null };
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
    log = []

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": 390, "height": 844},
                            device_scale_factor=2, is_mobile=True,
                            has_touch=True, locale="ko-KR")
        ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                            % json.dumps(json.dumps(SAVE, ensure_ascii=False)))
        page = ctx.new_page()
        page.goto(f"http://127.0.0.1:{port}/?debug=1&quiet=1&seed=7", wait_until="load")
        page.wait_for_timeout(900)
        page.evaluate("() => window.__coil.startRun()")
        page.wait_for_timeout(1200)
        page.evaluate("() => window.__coil.ghost(900)")
        print("확장 확보:", page.evaluate(GRAB))

        base = page.evaluate(PROBE)
        print(f"기준 상태            bloom={base['bloom']} glow={base['glowVis']}")
        log.append({"phase": "base", **base})

        # ★ 「잃고 → 바로 복구」를 4회 반복. 실기기 메모리 압박이 하는 짓과 같다.
        for i in range(4):
            r1 = page.evaluate(LOSE)
            page.wait_for_timeout(260)
            a = page.evaluate(PROBE)
            r2 = page.evaluate(RESTORE)
            page.wait_for_timeout(420)
            c = page.evaluate(PROBE)
            print(f"  {i + 1}회차 손실({r1}) → bloom={a['bloom']} glow={a['glowVis']}"
                  f"   복구({r2}) → bloom={c['bloom']} glow={c['glowVis']}")
            log.append({"phase": f"cycle{i + 1}", "lost": a, "restored": c})

        page.wait_for_timeout(600)
        fin = page.evaluate(PROBE)
        print(f"최종 상태            bloom={fin['bloom']} glow={fin['glowVis']}")
        log.append({"phase": "final", **fin})
        ctx.close()
        b.close()
    srv.shutdown()

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"glchurn_{tag}.json").write_text(
        json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")

    # 판정: 복구 때마다 bloom 이 true 로 되돌아오면 = 깜빡임이 계속된다.
    backs = [x for x in log if x["phase"].startswith("cycle") and x["restored"]["bloom"]]
    print()
    print(f"복구 후 bloom 이 되살아난 횟수: {len(backs)}/4")
    if len(backs) >= 4:
        print("  ⇒ ★가드 없음 — 무한 깜빡임 가능(옛 동작)")
    else:
        print(f"  ⇒ 가드 동작: {len(backs)}회 뒤 고정됨(깜빡임 종료)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
