# -*- coding: utf-8 -*-
"""qa_resting_finger.py — 「손가락이 이미 닿은 채로 판이 시작되면 조종이 죽는가」.

  python tools/qa_resting_finger.py <distDir> <tag>

★ 무엇을 가르나 (수정 «전»에 재현부터 — 재현이 안 되면 진단이 틀린 것이다)
  판 시작 시 `input.paused` 가 true 인 동안 손가락이 닿으면
  `onTouchStart` 가 `if (this.paused) return` 으로 `assignDown` 을 건너뛴다.
  → `active` 에는 있는데 `steerId = -1`.
  `beginRun()` 은 `paused=false` 를 «직접» 대입하므로 `adoptRestingFinger()` 가
  안 불린다. 그러면 그 손가락은 언제 되살아나는가?

  ⇒ 두 시나리오로 «갈라서» 잰다. 코디네이터 브리프는 A 가 100% 실패한다고 했지만
    handleMove 836행에 «유령 손가락 흡수»가 있어 그렇지 않을 수 있다. 확인한다.

    A) down → beginRun → «움직인다»      : handleMove 흡수가 살릴 수 있다
    B) down → beginRun → «기다렸다가» 움직인다 : President 상황 그대로
       (엄지를 얹어 두고 한참 뒤 밀어 본다. 정지 상태에서 aim=null 은
        «정상»이므로 반드시 «민 뒤»에 판정해야 한다)
    C) 대조군 — beginRun «뒤에» 손가락을 댄다 : 정상 경로. 반드시 성공해야 한다
       (C 가 실패하면 이 검사기 자체가 고장난 것이다 = 음성 대조)

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

ST = """() => { const s = window.__coil.state(); const d = window.__coil.diag ? window.__coil.diag() : null;
  return { aim: s.aim, mode: s.mode, stick: s.stick, diag: d }; }"""


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
    def __init__(self, page, cdp):
        self.page, self.cdp = page, cdp
        # CDP 는 활성 터치 없이 touchEnd/Move 를 보내면 프로토콜 오류를 낸다.
        self.down = False

    def touch(self, kind, pts):
        if kind == "touchStart":
            self.down = True
        elif kind in ("touchEnd", "touchCancel"):
            if not self.down:
                return
            self.down = False
        elif kind == "touchMove" and not self.down:
            return
        self.cdp.send("Input.dispatchTouchEvent", {
            "type": kind,
            "touchPoints": [{"x": float(x), "y": float(y), "id": i}
                            for i, (x, y) in enumerate(pts)],
        })

    def tap(self, x, y):
        self.touch("touchStart", [(x, y)])
        self.page.wait_for_timeout(50)
        self.touch("touchEnd", [])


OX, OY = 150.0, 600.0


def trial(rig, kind: str) -> dict:
    """한 판을 «메뉴에서» 시작하되 손가락을 얹는 시점을 바꿔 가며 잰다."""
    page = rig.page
    # 메뉴로 되돌린다(판 사이 상태를 깨끗이).
    page.evaluate("() => window.__coil.toMenu()")
    page.wait_for_timeout(500)
    rig.touch("touchEnd", [])          # 남은 손가락 정리
    page.wait_for_timeout(200)

    if kind in ("A", "B"):
        # ★ 판이 시작되기 «전»에 손가락을 얹는다 = paused 인 동안 닿는다.
        rig.touch("touchStart", [(OX, OY)])
        page.wait_for_timeout(120)
        page.evaluate("() => window.__coil.startRun()")
        page.wait_for_timeout(700)
        page.evaluate("() => window.__coil.ghost(300)")
        if kind == "A":
            # 곧바로 움직인다
            for i in range(6):
                rig.touch("touchMove", [(OX + 30 + i * 6, OY - 30 - i * 6)])
                page.wait_for_timeout(60)
        else:
            # ★ B) «얹어 놓고 한참 기다렸다가» 움직인다 — President 상황 그대로다
            #   (엄지를 올려 두고 「왜 안 움직이지」 하다가 밀어 본다).
            #   ⚠1차 설계는 「끝까지 안 움직인다」였는데 그건 «틀린 검사»다 —
            #     한 번도 안 밀면 데드존을 못 넘어 aim=null 이 «정상»이다.
            #     수정 전에도 후에도 100% 가 나와 아무것도 못 가른다.
            page.wait_for_timeout(600)
            for i in range(6):
                rig.touch("touchMove", [(OX + 30 + i * 6, OY - 30 - i * 6)])
                page.wait_for_timeout(60)
    else:
        # C) 정상 경로: 판을 먼저 시작하고 «그 뒤» 손가락을 댄다
        page.evaluate("() => window.__coil.startRun()")
        page.wait_for_timeout(700)
        page.evaluate("() => window.__coil.ghost(300)")
        rig.touch("touchStart", [(OX, OY)])
        page.wait_for_timeout(120)
        for i in range(6):
            rig.touch("touchMove", [(OX + 30 + i * 6, OY - 30 - i * 6)])
            page.wait_for_timeout(60)

    st = page.evaluate(ST)
    rig.touch("touchEnd", [])
    page.wait_for_timeout(150)
    return st


def main() -> int:
    dist = Path(sys.argv[1]).resolve()
    tag = sys.argv[2]
    reps = int(sys.argv[3]) if len(sys.argv) > 3 else 12
    port, srv = serve(dist)
    res = {}

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)          # ★headless 고정
        ctx = b.new_context(viewport={"width": 390, "height": 844},
                            device_scale_factor=2, is_mobile=True,
                            has_touch=True, locale="ko-KR")
        ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                            % json.dumps(json.dumps(SAVE, ensure_ascii=False)))
        page = ctx.new_page()
        page.goto(f"http://127.0.0.1:{port}/?debug=1&quiet=1&seed=7", wait_until="load")
        page.wait_for_timeout(900)
        cdp = ctx.new_cdp_session(page)
        rig = Rig(page, cdp)
        page.evaluate("() => window.__coil.startRun()")
        page.wait_for_timeout(600)

        for kind in ("A", "B", "C"):
            rows = []
            for _ in range(reps):
                rows.append(trial(rig, kind))
            dead = sum(1 for r in rows if r["aim"] is None)
            res[kind] = {"n": len(rows), "aimNull": dead,
                         "pct": round(dead / len(rows) * 100, 1),
                         "sample": rows[0]}
        ctx.close()
        b.close()
    srv.shutdown()

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"resting_{tag}.json").write_text(
        json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")

    lab = {"A": "A) 미리 대고 → 시작 → «움직임»",
           "B": "B) 미리 대고 → 시작 → 기다렸다 밈",
           "C": "C) 시작 후 대기(정상·음성대조)"}
    print(f"== {tag}")
    for k in ("A", "B", "C"):
        r = res[k]
        print(f"  {lab[k]:34s}  조종불능 {r['aimNull']:2d}/{r['n']}  ({r['pct']:5.1f}%)")
    print()
    if res["C"]["pct"] > 0:
        print("  !! 음성대조 C 가 실패했다 — 검사기 자체가 고장이다. 결과 무효.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
