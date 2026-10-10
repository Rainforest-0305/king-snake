# -*- coding: utf-8 -*-
"""qa_teleport.py - 「초거대 뱀이 끊기거나 순간이동한다」를 «수치»로 정의한다.

  python tools/qa_teleport.py <distDir> <tag> [초]

★ 판정 기준선을 «먼저» 박는다 (추측 금지)
  snake.step 은 문자 그대로 `x += cos(angle) * speed * dt` 다.
  ⇒ 한 프레임의 «정상 이동량» = speed x dt,  speed = boost ? 385 : 205 (config).
  ⇒ 물리적으로 그보다 더 갈 수 «없다». 그러므로

      ratio = 실제이동 / (speed x dt)

  가 1 을 «의미 있게» 넘으면 그건 물리가 아니라 «다른 것»이 좌표를 옮긴 것이다.
  ★ N = 1.5 로 잡는다. 근거: 이동식이 곱셈 하나라 부동소수 오차는 1e-6 수준이고,
    각도가 프레임 중간에 바뀌어도 이동량 «크기»는 speed x dt 로 고정된다(방향만 바뀐다).
    즉 1.5 는 노이즈보다 5자리 이상 위이고, 리스폰(수천 유닛)보다는 한참 아래다.
    ⇒ 1.5 를 넘는 프레임은 전부 「설명이 필요한」 프레임이다.

★ «보이는» 튐은 따로 잰다
  ratio 가 1 이어도 dt 가 크면 화면에서는 확 튄다(DT_MAX = 0.25s!).
      화면이동px = 실제이동 x zoom
  60fps 정상값은 speed x 0.0167 x zoom ≈ 3.4px(질주 6.4px). 이게 수십 px 이 되면
  사람 눈에는 순간이동이다. ⇒ 두 수치를 «따로» 낸다. 원인이 다르기 때문이다.

★ ⚠가설5(카메라)를 «먼저» 배제한다 — 코디네이터 지시
  뱀만 튀는가, 화면 전체가 튀는가. 카메라 이동/줌 변화를 같은 프레임에서 재서
  「뱀이 튄 프레임」과 「카메라가 튄 프레임」이 겹치는지 본다. 겹치면 뱀 문제가
  아니라 화면 문제이고, 나머지 가설이 통째로 무의미해진다.

★ 리스폰을 순간이동으로 오판하지 않는다
  alive 를 같이 실어서, 죽었다 살아난 프레임은 «별도 범주»로 센다.

★ 큰 뱀(mass>=2500)과 작은 뱀을 «나눠» 낸다 — 「초거대에서만」이 사실인지 확인.
★ headless 고정. 창 0.
"""
from __future__ import annotations

import http.server
import json
import math
import socketserver
import sys
import threading
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_joy_260903"
SPEED_BASE, SPEED_BOOST = 205.0, 385.0
BIG_MASS = 2500
N_JUMP = 1.5          # ratio 임계 (위 주석에 근거)
PX_JUMP = 25.0        # 화면 px 임계: 정상 3.4~6.4px 의 약 4~7배

SAVE = {"v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
        "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
        "control": "joystick", "sound": False, "locale": None}

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


def analyse(frames):
    prev = {}
    st = {"big": {"n": 0, "ratioJump": 0, "pxJump": 0, "maxRatio": 0.0, "maxPx": 0.0},
          "small": {"n": 0, "ratioJump": 0, "pxJump": 0, "maxRatio": 0.0, "maxPx": 0.0}}
    respawns = 0
    camJump = 0
    camMax = 0.0
    dts = []
    zooms = []
    jumpFrames = []          # 뱀이 튄 프레임 번호(카메라와 겹치는지 대조용)
    camFrames = []
    pcam = None
    for fi, f in enumerate(frames):
        dt = f.get("dt") or 0
        zoom = f.get("zoom") or 1
        dts.append(dt)
        zooms.append(zoom)
        if pcam is not None:
            cd = math.hypot(f["camX"] - pcam[0], f["camY"] - pcam[1]) * zoom
            camMax = max(camMax, cd)
            if cd > PX_JUMP:
                camJump += 1
                camFrames.append(fi)
        pcam = (f["camX"], f["camY"])
        for s in f["snakes"]:
            i = s["id"]
            p = prev.get(i)
            prev[i] = s
            if p is None or not s["alive"]:
                continue
            if not p["alive"]:               # 죽었다 살아남 = 리스폰(순간이동 아님)
                respawns += 1
                continue
            d = math.hypot(s["x"] - p["x"], s["y"] - p["y"])
            exp = (SPEED_BOOST if s["boost"] else SPEED_BASE) * dt
            ratio = d / exp if exp > 1e-9 else 0.0
            px = d * zoom
            k = "big" if s["mass"] >= BIG_MASS else "small"
            b = st[k]
            b["n"] += 1
            b["maxRatio"] = max(b["maxRatio"], ratio)
            b["maxPx"] = max(b["maxPx"], px)
            if ratio > N_JUMP:
                b["ratioJump"] += 1
                jumpFrames.append(fi)
            if px > PX_JUMP:
                b["pxJump"] += 1
                jumpFrames.append(fi)
    dts.sort()
    raws = sorted(f.get("rawDt") or 0 for f in frames)
    # ★ 클램프가 «실제로» 물린 프레임 비율. 2% 를 넘으면 상시 슬로모션의 시작이다.
    clamped = sum(1 for f in frames if f.get("clamped"))
    fpsv = sorted(f.get("fps") or 0 for f in frames)
    return {"frames": len(frames), "byMass": st, "respawns": respawns,
            "clampedN": clamped,
            "clampedPct": round(clamped / max(1, len(frames)) * 100, 2),
            "rawMed": round(raws[len(raws) // 2], 4) if raws else 0,
            "rawP95": round(raws[int(len(raws) * .95)], 4) if raws else 0,
            "rawMax": round(raws[-1], 4) if raws else 0,
            "fpsAvg": round(sum(fpsv) / max(1, len(fpsv)), 1),
            "fpsP05": round(fpsv[int(len(fpsv) * .05)], 1) if fpsv else 0,
            "camJump": camJump, "camMaxPx": round(camMax, 2),
            "dtMed": round(dts[len(dts) // 2], 4) if dts else 0,
            "dtP95": round(dts[int(len(dts) * .95)], 4) if dts else 0,
            "dtMax": round(dts[-1], 4) if dts else 0,
            "zoomMin": round(min(zooms), 3) if zooms else 0,
            "zoomMax": round(max(zooms), 3) if zooms else 0,
            "overlap": len(set(jumpFrames) & set(camFrames)),
            "snakeJumpFrames": len(set(jumpFrames))}


def main() -> int:
    dist = Path(sys.argv[1]).resolve()
    tag = sys.argv[2]
    secs = float(sys.argv[3]) if len(sys.argv) > 3 else 12.0
    # ★ 헤드리스는 그냥 두면 dt 최대가 0.05 라 클램프 경로에 «닿지도 못한다».
    #   CPU 를 조여 실기기의 저프레임 구간을 흉내 내야 이 검사가 의미를 갖는다.
    cpu = float(sys.argv[4]) if len(sys.argv) > 4 else 6.0
    port, srv = serve(dist)
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
        page.evaluate("() => window.__coil.startRun()")
        page.wait_for_timeout(1500)
        page.evaluate("() => window.__coil.ghost(900)")
        frames = page.evaluate(COLLECT, secs * 1000)
        res = {"normal": analyse(frames)}
        # ★ 부하를 걸어 «프레임 히칭»을 만든다 - DT_MAX 0.25s 가 실제로 물리는지 본다.
        page.evaluate("() => window.__coil.stress(12, 6000, true, 3000, 'ring', true)")
        try:
            cdp = ctx.new_cdp_session(page)
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": cpu})
        except Exception:
            pass
        page.wait_for_timeout(1200)
        page.evaluate("() => window.__coil.ghost(900)")
        frames2 = page.evaluate(COLLECT, secs * 1000)
        res["stress"] = analyse(frames2)
        page.evaluate("() => window.__coil.stopStress()")
        res["errors"] = errs
        ctx.close()
        b.close()
    srv.shutdown()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / ("teleport_%s.json" % tag)).write_text(
        json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")

    print("== %s   (판정: ratio>%.1f = 물리로 설명 안 되는 이동 / %.0fpx = 눈에 보이는 튐)"
          % (tag, N_JUMP, PX_JUMP))
    for ph in ("normal", "stress"):
        r = res[ph]
        print("  [%s] 프레임 %d   fps 평균 %.1f 하위5%% %.1f"
              % (ph, r["frames"], r["fpsAvg"], r["fpsP05"]))
        print("     원본dt 중앙 %.4f p95 %.4f 최대 %.4f  ->  적용dt 중앙 %.4f p95 %.4f 최대 %.4f"
              % (r["rawMed"], r["rawP95"], r["rawMax"],
                 r["dtMed"], r["dtP95"], r["dtMax"]))
        print("     ★클램프 물린 프레임 %d/%d = %.2f%%  (2%% 넘으면 상시 슬로모션)"
              % (r["clampedN"], r["frames"], r["clampedPct"]))
        for k in ("big", "small"):
            m = r["byMass"][k]
            print("     %-5s 표본 %6d  ratio초과 %4d (최대 %.3f)   px초과 %4d (최대 %.1fpx)"
                  % (k, m["n"], m["ratioJump"], m["maxRatio"], m["pxJump"], m["maxPx"]))
        print("     리스폰 %d건 · 카메라 튐 %d프레임(최대 %.1fpx) · 뱀튐∩카메라튐 %d/%d"
              % (r["respawns"], r["camJump"], r["camMaxPx"], r["overlap"], r["snakeJumpFrames"]))
    if res["errors"]:
        print("  errors:", res["errors"][:3])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
