"""qa_touch.py - 모바일 조작 «기능» 검증.

★ 스크린샷은 「조이스틱이 그려졌다」까지만 증명한다.
  「드래그한 방향으로 실제로 간다」는 각도를 «재야» 증명된다.
  ?debug=1 이 노출하는 window.__coil.state() 로 입력 해석 결과(aim)와
  실제 진행각(angle)을 읽어 목표 방향과의 오차를 도(degree)로 출력한다.

★ 이 스크립트를 처음 짰을 때 4건이 «실패»로 나왔는데 전부 게임 버그가 아니었다.
  원인: 측정 도중 플레이어가 죽어 «사망 화면 오버레이»가 터치를 가로챈 상태에서
  값을 읽었다. 교훈 두 가지를 코드로 못 박았다:
    1) 매 측정 «직전»에 mode/alive 를 확인하고, 죽었으면 판을 다시 시작한다.
    2) 입력 해석은 aim(=input.aimAngle)으로 «즉시» 검증한다. 1.5초 뒤 angle 로
       재면 그 사이의 이동·충돌·사망이 전부 섞여 들어가 무엇을 재는지 모르게 된다.
       angle 수렴은 «별도 항목»으로 나눠서 본다.

실행:
  python tools/qa_touch.py
"""

from __future__ import annotations

import http.server
import json
import math
import socketserver
import sys
import threading
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("playwright 가 없다: pip install playwright && playwright install chromium")
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
OUT = ROOT / "qa" / "touch"


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


def ang_err(a: float, b: float) -> float:
    d = (a - b + math.pi) % (2 * math.pi) - math.pi
    return abs(math.degrees(d))


def main() -> int:
    if not (DIST / "index.html").exists():
        print("dist 가 없다. 먼저: npm run build:web")
        return 2
    OUT.mkdir(parents=True, exist_ok=True)

    port, httpd = serve()
    base = f"http://127.0.0.1:{port}"
    W, H = 390, 844
    failures: list[str] = []
    results: dict = {}

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--enable-gpu", "--use-gl=angle"])
        ctx = browser.new_context(
            viewport={"width": W, "height": H},
            device_scale_factor=2, is_mobile=True, has_touch=True, locale="ko-KR",
        )
        page = ctx.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        page.goto(f"{base}/?debug=1", wait_until="load")
        page.wait_for_timeout(1200)
        page.tap("button.btn-primary")
        page.wait_for_timeout(800)

        cdp = ctx.new_cdp_session(page)
        touching: list[tuple[float, float]] = []

        def send(kind: str, pts):
            cdp.send("Input.dispatchTouchEvent", {
                "type": kind,
                "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)],
            })

        def down(pts):
            nonlocal touching
            touching = list(pts)
            send("touchStart", touching)

        def move(pts):
            nonlocal touching
            touching = list(pts)
            send("touchMove", touching)

        def release():
            nonlocal touching
            if touching:
                send("touchEnd", [])
                touching = []
            page.wait_for_timeout(120)

        def state():
            return page.evaluate("() => window.__coil.state()")

        def ensure_alive(tag: str):
            """죽었으면 새 판을 시작한다. ★ 이걸 안 하면 사망 화면이 터치를 먹어
            멀쩡한 조작을 «고장»으로 오판한다(이 스크립트 첫 판본의 실패 원인)."""
            release()
            st = state()
            if st["mode"] != "play" or not st["alive"]:
                page.evaluate("() => window.__coil.startRun()")
                page.wait_for_timeout(700)
                st = state()
                results.setdefault("restarts", []).append(tag)
            return st

        # ── 1) joystick: 입력 해석(aim) ──────────────────────────────────
        page.evaluate("() => window.__coil.setControl('joystick')")
        ox, oy = W * 0.3, H * 0.72
        for label, (dx, dy) in {"up": (0, -1), "right": (1, 0), "downleft": (-0.7, 0.7)}.items():
            ensure_alive("joy_" + label)
            want = math.atan2(dy, dx)
            down([(ox, oy)])
            page.wait_for_timeout(60)
            move([(ox + dx * 90, oy + dy * 90)])
            page.wait_for_timeout(120)
            st = state()
            aim_err = 999.0 if st["aim"] is None else ang_err(st["aim"], want)
            # 진행각 수렴은 따로 본다(각속도 상한 때문에 시간이 걸린다).
            page.wait_for_timeout(1400)
            st2 = state()
            turn_err = ang_err(st2["angle"], want) if st2["alive"] else None
            results[f"joystick_{label}"] = {
                "aimErrDeg": round(aim_err, 1),
                "turnErrDeg": None if turn_err is None else round(turn_err, 1),
                "stick": st["stick"],
            }
            if label == "up":
                page.screenshot(path=str(OUT / "joystick.png"))
            release()
            if aim_err > 3:
                failures.append(f"joystick/{label}: 입력 해석 오차 {aim_err:.1f}도")
            if not st["stick"]:
                failures.append(f"joystick/{label}: 스틱이 활성화되지 않았다")
            if turn_err is not None and turn_err > 20:
                failures.append(f"joystick/{label}: 진행각이 수렴하지 않았다({turn_err:.1f}도)")

        # ── 2) drag: 손가락이 «가리키는 지점»으로 향하는가 ────────────────
        page.evaluate("() => window.__coil.setControl('drag')")
        for label, (tx, ty) in {"topright": (W * 0.85, H * 0.18), "bottomleft": (W * 0.12, H * 0.86)}.items():
            st0 = ensure_alive("drag_" + label)
            want = math.atan2(ty - st0["headSY"], tx - st0["headSX"])
            down([(tx, ty)])
            page.wait_for_timeout(140)
            st = state()
            aim_err = 999.0 if st["aim"] is None else ang_err(st["aim"], want)
            results[f"drag_{label}"] = {"aimErrDeg": round(aim_err, 1)}
            release()
            if aim_err > 6:
                failures.append(f"drag/{label}: 입력 해석 오차 {aim_err:.1f}도")

        # ── 3) 부스트 버튼 ────────────────────────────────────────────────
        page.evaluate("() => window.__coil.setControl('joystick')")
        st = ensure_alive("boost")
        bb = st["boostBtn"]
        down([(bb["x"], bb["y"])])
        page.wait_for_timeout(250)
        st = state()
        results["boostButton"] = {
            "inputBoost": st["inputBoost"], "boosting": st["boosting"],
            "mass": round(st["mass"], 1), "btn": bb,
        }
        page.screenshot(path=str(OUT / "boost.png"))
        release()
        if not st["inputBoost"]:
            failures.append("부스트 버튼: 눌러도 입력이 잡히지 않았다")

        # 히트 영역이 시각 반경보다 넓은가(엄지 오차 흡수) - 가장자리 바깥을 눌러본다
        st = ensure_alive("boost_edge")
        down([(bb["x"] - bb["r"] * 1.2, bb["y"])])
        page.wait_for_timeout(200)
        results["boostButtonEdge"] = {"inputBoost": state()["inputBoost"]}
        release()
        if not results["boostButtonEdge"]["inputBoost"]:
            failures.append("부스트 버튼: 확장 히트영역이 동작하지 않는다")

        # ── 4) 두 번째 손가락 부스트 ──────────────────────────────────────
        ensure_alive("twofinger")
        down([(W * 0.3, H * 0.7)])
        page.wait_for_timeout(80)
        move([(W * 0.3, H * 0.62)])
        page.wait_for_timeout(80)
        # 두 번째 손가락 추가: 기존 점을 «유지한 채» 새 점을 붙인 touchStart 를 보낸다.
        cdp.send("Input.dispatchTouchEvent", {
            "type": "touchStart",
            "touchPoints": [
                {"x": W * 0.3, "y": H * 0.62, "id": 0},
                {"x": W * 0.72, "y": H * 0.35, "id": 1},
            ],
        })
        touching = [(W * 0.3, H * 0.62), (W * 0.72, H * 0.35)]
        page.wait_for_timeout(250)
        st = state()
        results["twoFinger"] = {"inputBoost": st["inputBoost"]}
        release()
        if not st["inputBoost"]:
            failures.append("두 번째 손가락: 부스트가 걸리지 않았다")

        # ── 5) 손을 떼면 «즉시» 멈추는가(입력이 굳지 않는가) ──────────────
        page.wait_for_timeout(200)
        st = state()
        results["releaseStops"] = {"inputBoost": st["inputBoost"], "stick": st["stick"]}
        if st["inputBoost"] or st["stick"]:
            failures.append("손을 뗐는데 입력이 유지된다(부스트/스틱이 굳음)")

        results["consoleErrors"] = errors
        if errors:
            failures.append(f"콘솔 에러 {len(errors)}건")

        print(json.dumps(results, ensure_ascii=False, indent=2))
        ctx.close()
        browser.close()
    httpd.shutdown()

    if failures:
        print("\n[FAIL]")
        for f in failures:
            print("  -", f)
        return 1
    print("\n[PASS] 전 항목 통과.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
