# -*- coding: utf-8 -*-
"""qa_scale_ab.py — 거대 비늘 뱀의 «같은 장면» 전/후 크롭 + 선명도 수치.

  python tools/qa_scale_ab.py <distA> <distB> <tagA> <tagB>

★ 왜 이렇게 찍나
  실플레이 화면은 시뮬 이력에 따라 매번 달라 전/후 대조가 안 된다.
  `__coil.stress(n, mass, ..., 'grid')` 는 뱀을 «코드로» 격자에 눕히므로
  같은 씨앗·같은 호출이면 거의 같은 프레임이 나온다. 바로 freeze 해서 찍는다.

★ 선명도 수치 = 크롭의 «평균 |라플라시안|».
  비늘이 뭉개지면(원본을 3.4배 확대) 고주파가 사라져 값이 «내려간다».
  선명해지면 올라간다. 눈으로 본 것을 숫자로 한 번 더 잡는 용도다.
  ⚠ 장면이 픽셀 단위로 같지는 않다 — 그래서 이 값은 «보조 증거»다.
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
from PIL import Image, ImageFilter  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_render_260908"
VW, VH = 390, 844
SAVE = {"v": 1, "savedAt": 0, "bestScore": 6000, "bestRank": 1, "games": 40,
        "totalKills": 30, "playSeconds": 5000, "nick": "", "skin": "corn",
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


def sharpness(p: Path) -> float:
    im = Image.open(p).convert("L")
    lap = im.filter(ImageFilter.Kernel((3, 3), [0, 1, 0, 1, -4, 1, 0, 1, 0], 1, 128))
    px = list(lap.getdata())
    return sum(abs(v - 128) for v in px) / len(px)


def shoot(dist: Path, tag: str) -> dict:
    port, srv = serve(dist)
    info = {}
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(headless=True)
            ctx = b.new_context(viewport={"width": VW, "height": VH},
                                device_scale_factor=4, is_mobile=True,
                                has_touch=True, locale="ko-KR")
            ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                                % json.dumps(json.dumps(SAVE, ensure_ascii=False)))
            page = ctx.new_page()
            page.goto("http://127.0.0.1:%d/?debug=1&quiet=1&seed=7" % port,
                      wait_until="load")
            page.wait_for_timeout(900)
            page.evaluate("() => window.__coil.startRun()")
            page.wait_for_timeout(600)
            page.evaluate("() => window.__coil.ghost(9000)")
            # 결정론적 배치: 코드가 격자에 눕힌다. 바로 얼려 시뮬 이력을 없앤다.
            page.evaluate("() => window.__coil.stress(4, 5200, false, 5200, 'grid')")
            page.wait_for_timeout(500)
            page.evaluate("() => window.__coil.freeze(true)")
            page.wait_for_timeout(250)
            f = page.evaluate("() => window.__coil.frame()")
            me = next((s for s in f["snakes"] if s["mine"]), f["snakes"][0])
            info = {"mass": round(me["mass"]), "zoom": round(f["zoom"], 4)}
            OUT.mkdir(parents=True, exist_ok=True)
            full = OUT / ("ab_%s_full.png" % tag)
            page.screenshot(path=str(full))
            crop = OUT / ("ab_%s_crop.png" % tag)
            page.screenshot(path=str(crop),
                            # ★ 머리·눈·배경이 아니라 «몸통»만. 머리가 섞이면
                            #   선명도 수치가 그쪽 고주파에 묻혀 아무것도 못 가른다.
                            clip={"x": VW / 2 - 72, "y": VH / 2 + 10,
                                  "width": 76, "height": 86})
            info["full"] = full.name
            info["crop"] = crop.name
            info["sharpness"] = round(sharpness(crop), 3)
            page.evaluate("() => window.__coil.freeze(false)")
            ctx.close()
            b.close()
    finally:
        srv.shutdown()
    return info


def main() -> int:
    a = shoot(Path(sys.argv[1]).resolve(), sys.argv[3])
    b = shoot(Path(sys.argv[2]).resolve(), sys.argv[4])
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "ab_summary.json").write_text(
        json.dumps({sys.argv[3]: a, sys.argv[4]: b}, ensure_ascii=False, indent=1),
        encoding="utf-8")
    # 나란히 붙인 한 장
    ia = Image.open(OUT / a["crop"])
    ib = Image.open(OUT / b["crop"])
    sbs = Image.new("RGB", (ia.width + ib.width + 8, max(ia.height, ib.height)),
                    (10, 12, 26))
    sbs.paste(ia, (0, 0))
    sbs.paste(ib, (ia.width + 8, 0))
    sbs.save(OUT / "ab_side_by_side.png")

    print("== 거대 비늘 뱀 전/후 (같은 씨앗·같은 stress 격자·freeze)")
    for tag, r in ((sys.argv[3], a), (sys.argv[4], b)):
        print("  %-8s 질량 %s  zoom %s  선명도(평균|라플라시안|) %.3f  -> %s"
              % (tag, r["mass"], r["zoom"], r["sharpness"], r["crop"]))
    d = b["sharpness"] - a["sharpness"]
    print("  차이 %+.3f (%+.1f%%)  나란히: ab_side_by_side.png"
          % (d, d / a["sharpness"] * 100 if a["sharpness"] else 0))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
