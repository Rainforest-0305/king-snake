"""qa_net.py - «외부 네트워크 요청 0건» + 콘솔 에러 0건 실측.

★ 왜 «양성대조»가 붙어 있는가:
  「0건」은 그 자체로 부재의 증거가 아니다. 리스너를 잘못 걸었거나 페이지가
  일찍 닫혀도 0 이 나온다. 그래서 이 스크립트는 «반드시» 먼저 대조군을 돈다:
  같은 리스너로 외부 도메인 요청을 «일부러» 한 번 일으키고, 그게 잡히는지
  확인한다. 대조군이 0 이면 검사기가 고장난 것이므로 즉시 실패한다.

판정 기준
  외부  = 로컬 서버(127.0.0.1:<port>) 가 «아닌» http/https 요청.
          data: / blob: 는 네트워크가 아니므로 제외한다.
  콘솔  = error / warning 전량 기록.

실행: python tools/qa_net.py
"""

from __future__ import annotations

import functools
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

SAVE = {
    "v": 1, "nick": "PRESIDENT", "skin": "corn", "sound": True,
    "control": "joystick", "locale": "ko",
    "bestScore": 99999, "bestRank": 1, "games": 9, "totalKills": 22,
    "playSeconds": 900,
}

GPU_ARGS = ["--enable-gpu", "--use-gl=angle", "--use-angle=default", "--ignore-gpu-blocklist"]


def serve(directory: Path) -> int:
    handler = functools.partial(http.server.SimpleHTTPRequestHandler,
                                directory=str(directory))
    handler.log_message = lambda *a, **kw: None  # type: ignore[assignment]
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1]


def main() -> int:
    if not (DIST / "index.html").exists():
        print("dist 가 없다. 먼저: npm run build:web")
        return 2
    port = serve(DIST)
    base = f"http://127.0.0.1:{port}"

    def is_external(url: str) -> bool:
        if not url.startswith(("http://", "https://")):
            return False
        return not url.startswith(f"http://127.0.0.1:{port}")

    with sync_playwright() as pw:
        br = pw.chromium.launch(args=GPU_ARGS)

        # ── 0) 양성대조 ─────────────────────────────────────────────
        # 같은 리스너로 «잡혀야 하는» 요청을 일부러 만든다.
        ctrl: list[str] = []
        c = br.new_context(viewport={"width": 800, "height": 600}, locale="ko-KR")
        p = c.new_page()
        p.on("request", lambda r: ctrl.append(r.url) if is_external(r.url) else None)
        # 실제로 나가지는 않아도 «요청 이벤트»는 발생한다(라우트로 즉시 끊는다).
        p.route("https://example.invalid/**", lambda route: route.abort())
        p.goto(base + "/", wait_until="load")
        p.evaluate("() => { fetch('https://example.invalid/probe').catch(() => {}); }")
        p.wait_for_timeout(1200)
        c.close()
        if not ctrl:
            print("★ 검사기 고장: 양성대조가 0건이다. 판정 불가.")
            br.close()
            return 3
        print(f"양성대조 OK - 외부요청 {len(ctrl)}건 잡힘: {ctrl[0]}")

        # ── 1) 본 검사 ──────────────────────────────────────────────
        results = []
        for name, w, h, mob, url, wait in (
            ("menu", 1600, 900, False, "/", 6000),
            ("play", 1600, 900, False, "/?demo=1&seed=20260818", 25000),
            ("mobile", 390, 844, True, "/?demo=1&seed=20260818", 20000),
        ):
            ext: list[str] = []
            con: list[str] = []
            errs: list[str] = []
            c = br.new_context(viewport={"width": w, "height": h},
                               device_scale_factor=2 if mob else 1,
                               is_mobile=mob, has_touch=mob, locale="ko-KR")
            c.add_init_script("localStorage.setItem('king-snake.save', %s)"
                              % json.dumps(json.dumps(SAVE)))
            p = c.new_page()
            p.on("request", lambda r: ext.append(r.url) if is_external(r.url) else None)
            p.on("console", lambda m: con.append(f"{m.type}: {m.text}")
                 if m.type in ("error", "warning") else None)
            p.on("pageerror", lambda e: errs.append(str(e)))
            p.goto(base + url, wait_until="load")
            p.wait_for_timeout(wait)
            c.close()
            results.append({"case": name, "external": ext, "console": con, "pageerror": errs})
            print(f"  {name:<7} 외부요청 {len(ext)}건 · 콘솔 {len(con)}건 · 페이지에러 {len(errs)}건")
            for u in ext[:5]:
                print("      외부:", u)
            for m in con[:5]:
                print("      콘솔:", m)
            for m in errs[:5]:
                print("      에러:", m)
        br.close()

    bad = [r for r in results
           if r["external"] or r["console"] or r["pageerror"]]
    (ROOT / "qa").mkdir(exist_ok=True)
    (ROOT / "qa" / "net.json").write_text(
        json.dumps({"positiveControl": len(ctrl), "cases": results}, indent=2,
                   ensure_ascii=False), encoding="utf-8")
    print("\n판정:", "FAIL" if bad else "PASS")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
