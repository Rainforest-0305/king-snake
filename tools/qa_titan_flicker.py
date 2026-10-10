# -*- coding: utf-8 -*-
"""qa_titan_flicker.py — 「초거대 뱀이 사라졌다 나타났다」를 «프레임 단위 수치»로.

  python tools/qa_titan_flicker.py <distDir> <tag> [초]

★ 왜 이렇게 재나
  깜빡임은 «시간축» 현상이라 정지 스크린샷으로는 원리적으로 못 잡는다.
  그리고 검사기가 컬링 조건을 «다시 계산»해 맞춰 보는 것도 안 된다 — 그건
  「코드가 이렇게 판단했을 것이다」라는 추정이지 사실이 아니다.
  ⇒ 그리기 경로 «안»에서 남긴 사실(drawnIds / culledIds)을 rAF 마다 모은다.

★ 무엇을 «세는가»
  큰 뱀(mass ≥ 2500) 하나하나에 대해
    · flip      : 프레임 N 에 그려졌는데 N+1 에 안 그려짐(또는 반대) = 깜빡임 1회
    · byCull    : 그중 «컬링 때문»인 것 (culledIds 에 들어간 경우)
    · byNothing : 그려지지도 컬링되지도 않은 것 (= 루프에 아예 안 들어옴)
  ⇒ byCull 이 크면 컬링이 범인, byNothing 이 크면 컬링이 «아니다».

★ 양성 대조 — 이 대조가 «무엇을 배제하는지» 먼저 적는다
  `setCull(false)` 로 컬링을 끈 채 같은 구간을 다시 잰다.
  · 끄면 flip 이 사라진다      ⇒ 원인은 컬링이다
  · 끄고도 flip 이 남는다      ⇒ 원인은 컬링이 «아니다»(다른 데를 봐야 한다)
  이 대조는 「측정이 맞는가」를 증명하지 않는다. «컬링이 원인인지»만 가른다.
  측정 자체가 사는지는 별도로 확인한다(아래 sanity: drawn 이 매 프레임 0이면 무효).

★ headless 고정. 창 0.
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

# rAF 마다 프레임 사실을 «페이지 안에서» 모은다 — 왕복 지연이 표본을 왜곡하지 않게.
COLLECT = """(ms) => new Promise((res) => {
  const out = [];
  const t0 = performance.now();
  const tick = () => {
    out.push(window.__coil.frame());
    if (performance.now() - t0 < ms) requestAnimationFrame(tick);
    else res(out);
  };
  requestAnimationFrame(tick);
})"""


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


def analyse(frames):
    """큰 뱀별로 프레임 간 «상태 뒤집힘»을 센다."""
    prev = {}
    flips, by_cull, by_none = 0, 0, 0
    per = {}
    seen_drawn = 0
    for f in frames:
        drawn = set(f["drawn"])
        culled = set(f["culled"])
        seen_drawn += len(drawn)
        for b in f["big"]:
            i = b["id"]
            st = "D" if i in drawn else ("C" if i in culled else "N")
            if i in prev and prev[i] != st:
                flips += 1
                per[i] = per.get(i, 0) + 1
                if st == "C":
                    by_cull += 1
                elif st == "N":
                    by_none += 1
            prev[i] = st
    return {"frames": len(frames), "flips": flips, "byCull": by_cull,
            "byNothing": by_none, "perSnake": per, "drawnTotal": seen_drawn}


def main() -> int:
    dist = Path(sys.argv[1]).resolve()
    tag = sys.argv[2]
    secs = float(sys.argv[3]) if len(sys.argv) > 3 else 6.0
    port, srv = serve(dist)
    res = {}

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": 390, "height": 844},
                            device_scale_factor=2, is_mobile=True,
                            has_touch=True, locale="ko-KR")
        ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                            % json.dumps(json.dumps(SAVE, ensure_ascii=False)))
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)[:200]))
        page.goto(f"http://127.0.0.1:{port}/?debug=1&quiet=1&seed=7", wait_until="load")
        page.wait_for_timeout(900)
        page.evaluate("() => window.__coil.startRun()")
        page.wait_for_timeout(1200)
        page.evaluate("() => window.__coil.ghost(900)")
        page.evaluate("() => window.__coil.trackDrawn(true)")
        page.wait_for_timeout(300)

        # ── ① 평소 상태 ──
        f1 = page.evaluate(COLLECT, secs * 1000)
        res["normal"] = analyse(f1)

        # ── ② 양성 대조: 컬링을 끈다 ──
        page.evaluate("() => window.__coil.setCull(false)")
        page.wait_for_timeout(300)
        f2 = page.evaluate(COLLECT, secs * 1000)
        res["cullOff"] = analyse(f2)
        page.evaluate("() => window.__coil.setCull(true)")

        res["errors"] = errs
        ctx.close()
        b.close()
    srv.shutdown()

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"flicker_{tag}.json").write_text(
        json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")

    n, c = res["normal"], res["cullOff"]
    print(f"== {tag}  ({secs}s x 2)")
    for lab, r in (("평소       ", n), ("컬링 끔(대조)", c)):
        print(f"  {lab}  프레임 {r['frames']:4d}  뒤집힘 {r['flips']:4d}"
              f"  (컬링탓 {r['byCull']} / 아예없음 {r['byNothing']})"
              f"  누적그림 {r['drawnTotal']}")
    print()
    if n["drawnTotal"] == 0:
        print("  !! 측정 무효 — 그린 뱀이 0건. 훅이 안 붙었거나 track 이 꺼져 있다.")
    elif n["flips"] == 0:
        print("  ⇒ 큰 뱀 깜빡임 «0건». 이 구간에서는 컬링이 원인이 아니다.")
    elif c["flips"] < n["flips"] * 0.3:
        print("  ⇒ 컬링을 끄니 뒤집힘이 사라졌다 = ★원인은 컬링이다.")
    else:
        print("  ⇒ 컬링을 꺼도 뒤집힘이 남는다 = 원인은 컬링이 «아니다».")
    if errs:
        print("  errors:", errs[:3])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
