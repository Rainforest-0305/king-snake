# -*- coding: utf-8 -*-
"""qa_joystick_accuracy.py — 「정확한 조이스틱」을 «숫자»로 만든다.

  python tools/qa_joystick_accuracy.py <distDir> <tag>

★ 「부드럽다」 같은 말은 증거가 아니다. 네 가지를 잰다:

  A. 각도 정확도   입력 각도(우리가 만든 제스처의 기하학적 각) vs 게임이 낸 aim.
                   ⇒ 오차 deg. 0 이어야 한다(순수 atan2 이므로).
  B. 조향 반영     aim vs 뱀이 «실제로» 향한 각(player.angle) 의 수렴 오차.
                   ⇒ 뱀은 즉시 안 돈다(선회 속도 제한). 「몇 ms 뒤 몇 deg 남는가」.
  C. 노브 추종     손가락 좌표 vs «화면에 그려진» 노브 좌표의 어긋남(px).
                   ⇒ 클램프 반경 안에서는 0 이어야 한다. 밖이면 딱 클램프만큼.
  D. 연속성        원을 그리며 도는 드래그에서 각도가 «튀는» 구간이 있는가.
                   ⇒ 프레임 간 각도 변화의 최대치. 제스처 자체의 변화량보다
                     크게 튀면 끊긴 것이다.

★ headless 고정. 창을 띄우지 않는다.
★ CDP Input.dispatchTouchEvent = 신뢰된 터치.
"""
from __future__ import annotations

import http.server
import json
import math
import socketserver
import sys
import threading
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_joy_260903"
VW, VH = 390, 844

SAVE = {"v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
        "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
        "control": "joystick", "sound": False, "locale": None}

# 「그린 값」까지 주는 훅이 있는 빌드에서만 C/복귀를 잴 수 있다.
STICK_JS = "() => (window.__coil.stick ? window.__coil.stick() : null)"
STATE_JS = "() => { const s = window.__coil.state(); return { aim: s.aim, angle: s.angle, target: s.targetAngle }; }"


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


def dwrap(a: float) -> float:
    """각도 차를 -180..180 으로 접는다. 359 와 1 의 차이는 2 이지 358 이 아니다."""
    while a > 180:
        a -= 360
    while a < -180:
        a += 360
    return a


class Rig:
    def __init__(self, page, cdp):
        self.page, self.cdp = page, cdp

    def touch(self, kind, pts):
        self.cdp.send("Input.dispatchTouchEvent", {
            "type": kind,
            "touchPoints": [{"x": float(x), "y": float(y), "id": i}
                            for i, (x, y) in enumerate(pts)],
        })

    def tap(self, x, y):
        self.touch("touchStart", [(x, y)])
        self.page.wait_for_timeout(50)
        self.touch("touchEnd", [])


def main() -> int:
    dist = Path(sys.argv[1]).resolve()
    tag = sys.argv[2]
    port, srv = serve(dist)
    out: dict = {"tag": tag}

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)       # ★headless 고정
        ctx = b.new_context(viewport={"width": VW, "height": VH},
                            device_scale_factor=2, is_mobile=True,
                            has_touch=True, locale="ko-KR")
        ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                            % json.dumps(json.dumps(SAVE, ensure_ascii=False)))
        page = ctx.new_page()
        page.goto(f"http://127.0.0.1:{port}/?debug=1&quiet=1&seed=7", wait_until="load")
        page.wait_for_timeout(900)
        cdp = ctx.new_cdp_session(page)
        rig = Rig(page, cdp)

        n = page.query_selector(".btn-primary")
        r = n.bounding_box()
        rig.tap(r["x"] + r["width"] / 2, r["y"] + r["height"] / 2)
        page.wait_for_timeout(900)
        page.evaluate("() => window.__coil.ghost(900)")
        has_stick = page.evaluate("() => !!(window.__coil && window.__coil.stick)")
        out["hasStickHook"] = has_stick

        OX, OY = 150.0, 560.0

        # ── A. 각도 정확도 + C. 노브 추종 ──────────────────────────────────
        # 36방위 × 반경 3종(클램프 안 30 / 경계 58 / 밖 120).
        rowsA = []
        for R in (30.0, 58.0, 120.0):
            for k in range(36):
                th = math.radians(k * 10)
                dx, dy = R * math.cos(th), R * math.sin(th)
                rig.touch("touchStart", [(OX, OY)])
                page.wait_for_timeout(28)
                rig.touch("touchMove", [(OX + dx, OY + dy)])
                page.wait_for_timeout(70)
                st = page.evaluate(STATE_JS)
                sk = page.evaluate(STICK_JS) if has_stick else None
                rig.touch("touchEnd", [])
                page.wait_for_timeout(30)
                want = math.degrees(math.atan2(dy, dx))
                got = None if st["aim"] is None else math.degrees(st["aim"])
                row = {"R": R, "deg": k * 10, "want": want, "aim": got,
                       "err": None if got is None else dwrap(got - want)}
                if sk:
                    # 노브 추종: 손가락과 «그려진» 노브의 어긋남.
                    # 클램프 안이면 0, 밖이면 «딱 클램프 초과분»이어야 한다.
                    fx, fy = OX + dx, OY + dy
                    row["knobGap"] = math.hypot(sk["kx"] - fx, sk["ky"] - fy)
                    row["knobR"] = math.hypot(sk["kx"] - sk["bx"], sk["ky"] - sk["by"])
                    row["expectGap"] = max(0.0, R - 58.0)
                rowsA.append(row)
        out["A_angle"] = rowsA

        # ── B. 조향 반영 지연 ──────────────────────────────────────────────
        # 「정반대로 꺾어라」를 주고 뱀이 그 각에 몇 ms 만에 얼마나 붙는가.
        rowsB = []
        for trial in range(6):
            cur = page.evaluate(STATE_JS)["angle"]
            tgt = cur + math.pi                      # 180도 반전 = 최악
            dx, dy = 90 * math.cos(tgt), 90 * math.sin(tgt)
            rig.touch("touchStart", [(OX, OY)])
            page.wait_for_timeout(24)
            rig.touch("touchMove", [(OX + dx, OY + dy)])
            t0 = time.time()
            samples = []
            for _ in range(14):
                page.wait_for_timeout(40)
                st = page.evaluate(STATE_JS)
                if st["aim"] is None:
                    continue
                samples.append({
                    "ms": round((time.time() - t0) * 1000),
                    "rem": abs(dwrap(math.degrees(st["angle"]) - math.degrees(st["aim"]))),
                })
            rig.touch("touchEnd", [])
            page.wait_for_timeout(60)
            rowsB.append({"trial": trial, "samples": samples})
        out["B_steer"] = rowsB

        # ── D. 연속성 — 원을 그리며 도는 드래그 ────────────────────────────
        # 한 번 잡은 채로 72스텝(5도씩) 돌린다. 각도가 «끊기거나 튀는» 구간 탐지.
        rig.touch("touchStart", [(OX, OY)])
        page.wait_for_timeout(30)
        seq = []
        for k in range(73):
            th = math.radians(k * 5)
            dx, dy = 44 * math.cos(th), 44 * math.sin(th)
            rig.touch("touchMove", [(OX + dx, OY + dy)])
            page.wait_for_timeout(26)
            st = page.evaluate(STATE_JS)
            sk = page.evaluate(STICK_JS) if has_stick else None
            seq.append({
                "step": k, "want": k * 5.0,
                "aim": None if st["aim"] is None else math.degrees(st["aim"]),
                "knobGap": (math.hypot(sk["kx"] - (OX + dx), sk["ky"] - (OY + dy))
                            if sk else None),
            })
        rig.touch("touchEnd", [])
        out["D_sweep"] = seq

        # ── E. 복귀 애니메이션 궤적(그린 값) ───────────────────────────────
        # ★스크린샷으로는 못 잡는다(캡처 지연 > 애니메이션 길이). rAF 마다
        #   «그린 기하»를 페이지 «안에서» 모아 한 번에 가져온다 — 왕복 지연 0.
        if has_stick:
            rig.touch("touchStart", [(OX, OY)])
            page.wait_for_timeout(40)
            rig.touch("touchMove", [(OX + 96, OY - 96)])
            page.wait_for_timeout(120)
            # ★ 샘플러를 «먼저» 띄우고 «즉시 반환»시킨다. promise 를 await 하면
            #   그 사이 touchEnd 를 못 던져 복귀가 궤적에 안 잡힌다(1차 설계 오류).
            page.evaluate("""() => {
              window.__joyTraj = [];
              const t0 = performance.now();
              const tick = () => {
                const s = window.__coil.stick();
                window.__joyTraj.push({
                  t: +(performance.now() - t0).toFixed(1),
                  bx: +s.bx.toFixed(2), by: +s.by.toFixed(2),
                  kx: +s.kx.toFixed(2), ky: +s.ky.toFixed(2),
                  act: +s.act.toFixed(3), on: s.active ? 1 : 0 });
                if (performance.now() - t0 < 500) requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            }""")
            page.wait_for_timeout(60)          # 놓기 «전» 프레임도 몇 장 담는다
            rig.touch("touchEnd", [])
            page.wait_for_timeout(560)
            traj = page.evaluate("() => window.__joyTraj")
            out["E_return"] = traj
            # 복귀가 «실제로» 몇 ms 걸렸는가 — act 가 처음 0 이 된 시각.
            rel = next((s for s in traj if s["on"] == 0), None)
            done = next((s for s in traj if s["on"] == 0 and s["act"] == 0), None)
            if rel and done:
                out["E_return_ms"] = round(done["t"] - rel["t"], 1)
                print(f"E 복귀 애니메이션 실측 {out['E_return_ms']}ms"
                      f" (설계 160ms) · 샘플 {len(traj)}프레임")
        ctx.close()
        b.close()
    srv.shutdown()

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"accuracy_{tag}.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    # ── 요약 출력 ──────────────────────────────────────────────────────────
    errs = [abs(r["err"]) for r in rowsA if r["err"] is not None]
    print(f"== {tag}")
    print(f"A 각도오차 n={len(errs)} max={max(errs):.6g} mean={sum(errs)/len(errs):.6g} deg")
    if has_stick:
        gaps = [abs(r["knobGap"] - r["expectGap"]) for r in rowsA if "knobGap" in r]
        print(f"C 노브추종 편차 max={max(gaps):.6g} px (기대치 대비)")
    sw = [r for r in seq if r["aim"] is not None]
    jumps = [abs(dwrap(sw[i]["aim"] - sw[i - 1]["aim"])) for i in range(1, len(sw))]
    print(f"D 스윕 n={len(sw)}/73 프레임간 각도변화 max={max(jumps):.4g} deg (기대 5)")
    for row in rowsB[:2]:
        s2 = row["samples"]
        if s2:
            print(f"B 조향 180도 반전: {s2[0]['ms']}ms rem={s2[0]['rem']:.1f}deg"
                  f" -> {s2[-1]['ms']}ms rem={s2[-1]['rem']:.1f}deg")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
