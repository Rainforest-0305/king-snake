# -*- coding: utf-8 -*-
"""qa_livediag_toggle.py — 「길이」 5연타로 실기기 진단 줄이 켜지는가.

  python tools/qa_livediag_toggle.py <distDir> <tag>

★ 왜 이 검사가 필요한가: 이 토글은 «President 가 폰에서 직접» 쓸 장치다.
  안 켜지면 실기기 원인 규명 수단이 통째로 없어진다. 그러니 「구현했다」가
  아니라 「탭 5번에 켜진다」를 숫자로 남긴다.
  - 4번만 탭하면 «안 켜져야» 한다(오작동으로 유저 화면에 뜨면 안 된다)
  - 1.5초를 넘겨 탭하면 카운터가 리셋돼야 한다
★ 헤드리스 전용.
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
OUT = ROOT / "_joyfix_260907"
VW, VH = 390, 844
SAVE = {"v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
        "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
        "control": "joystick", "sound": False, "locale": None}


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
    tag = sys.argv[2] if len(sys.argv) > 2 else "diag"
    port, srv = serve(dist)
    out = {}
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(headless=True)
            ctx = b.new_context(viewport={"width": VW, "height": VH},
                                device_scale_factor=2, is_mobile=True,
                                has_touch=True, locale="ko-KR")
            ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                                % json.dumps(json.dumps(SAVE, ensure_ascii=False)))
            page = ctx.new_page()
            page.goto("http://127.0.0.1:%d/?quiet=1&seed=7" % port, wait_until="load")
            page.wait_for_timeout(900)
            cdp = ctx.new_cdp_session(page)
            down = {"v": False}

            def touch(kind, pts):
                if kind == "touchStart":
                    down["v"] = True
                elif kind in ("touchEnd", "touchCancel"):
                    if not down["v"]:
                        return
                    down["v"] = False
                elif kind == "touchMove" and not down["v"]:
                    return
                cdp.send("Input.dispatchTouchEvent", {
                    "type": kind,
                    "touchPoints": [{"x": float(x), "y": float(y), "id": i}
                                    for i, (x, y) in pts]})

            # 판을 «진짜 버튼»으로 시작(진단 줄은 인게임 HUD 에 붙는다)
            btn = page.query_selector("button.p-play")
            r = btn.bounding_box()
            touch("touchStart", [(0, (r["x"] + r["width"] / 2, r["y"] + r["height"] / 2))])
            page.wait_for_timeout(60)
            touch("touchEnd", [])
            page.wait_for_timeout(1000)
            out["mode"] = page.evaluate(
                "() => window.__coil ? window.__coil.state().mode : 'no-hook'")

            box = page.evaluate("""() => {
              const s = document.querySelector('.hud-score');
              if (!s) return null;
              const d = s.firstElementChild;      // 길이 박스
              const r = d.getBoundingClientRect();
              return [r.x + r.width / 2, r.y + r.height / 2, r.width, r.height];
            }""")
            out["len_box"] = box

            def tap(n, gap=120):
                for _ in range(n):
                    touch("touchStart", [(0, (box[0], box[1]))])
                    page.wait_for_timeout(40)
                    touch("touchEnd", [])
                    page.wait_for_timeout(gap)

            has = "() => !!document.querySelector('.live-diag')"

            tap(4)                     # 4번 — 안 켜져야 한다
            page.wait_for_timeout(200)
            out["after_4_taps"] = page.evaluate(has)

            page.wait_for_timeout(1800)  # 1.5초 초과 → 카운터 리셋
            tap(5)
            page.wait_for_timeout(300)
            out["after_5_taps"] = page.evaluate(has)
            out["text"] = page.evaluate(
                "() => { const e = document.querySelector('.live-diag');"
                " return e ? e.textContent : null; }")
            # ★ OFF 일 때 «층별 계측이 돌지 않는가» — renderer.profile 이 꺼져
            #   있으면 times 가 전부 0 으로 굳는다. 이게 「OFF 비용 0」의 증거다.
            #   (?debug=1 이면 profile 이 원래 켜져 있으므로 여기서는 안 쓴다.)
            out["times_when_off"] = page.evaluate(
                "() => window.__coilTimes ? window.__coilTimes().total : 'no-hook'")

            if out["after_5_taps"]:
                # 조종 중 모습으로 한 장 — 진단 줄이 실제로 값을 보이는지
                touch("touchStart", [(0, (150.0, 600.0))])
                page.wait_for_timeout(80)
                touch("touchMove", [(0, (110.0, 560.0))])
                page.wait_for_timeout(400)
                out["text_steering"] = page.evaluate(
                    "() => document.querySelector('.live-diag').textContent")
                OUT.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(OUT / ("livediag_%s.png" % tag)))
                touch("touchEnd", [])
            tap(5)                     # 다시 5번 — 꺼져야 한다
            page.wait_for_timeout(300)
            out["after_toggle_off"] = page.evaluate(has)
            ctx.close()
            b.close()
    finally:
        srv.shutdown()

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / ("livediag_%s.json" % tag)).write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    # ── 2행(성능) 필드 파싱 검사 ──
    txt = out.get("text_steering") or ""
    lines = [l for l in txt.split("\n") if l.strip()]
    fields = {}
    for key in ("fps", "f p95", "sim", "rend", "post", "body",
                "tier", "giants", "dpr", "webgl"):
        for seg in txt.replace("\n", " | ").split("|"):
            seg = seg.strip()
            if seg.startswith(key + " "):
                fields[key] = seg[len(key) + 1:].strip()
                break
    out["parsed"] = fields
    ok = (out["after_4_taps"] is False and out["after_5_taps"] is True
          and out["after_toggle_off"] is False
          and len(lines) >= 4 and len(fields) == 10)

    print("== 실기기 진단 줄 토글 [%s]  (판=%s)" % (tag, out["mode"]))
    print("  탭 4번 → 켜짐? %s  (False 여야 정상)" % out["after_4_taps"])
    print("  탭 5번 → 켜짐? %s  (True 여야 정상)" % out["after_5_taps"])
    print("  다시 5번 → 켜짐? %s (False 여야 정상)" % out["after_toggle_off"])
    print("  OFF 상태 renderer.times.total = %s  (0 이면 계측 자체가 안 돈다)"
          % out.get("times_when_off"))
    print("  줄 수 %d (4줄 이상이어야 정상) · 성능 필드 %d/10 파싱"
          % (len(lines), len(fields)))
    if fields:
        print("  파싱값:", ", ".join("%s=%s" % (k, v) for k, v in fields.items()))
    for line in lines:
        print("    | " + line)
    print("  판정: %s" % ("합격" if ok else "불합격"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
