# -*- coding: utf-8 -*-
"""qa_joystick_contrast.py — 「쉴 때 베이스가 «어떤 배경 위에서도» 보이는가」.

  python tools/qa_joystick_contrast.py <distDir> <tag> [seeds...]

★ 왜 눈으로 보는 것만으로는 부족한가
  이 UI 는 «매 프레임 배경이 바뀌는 오버레이»다. 스크린샷 한 장이 예뻐도
  다음 판에서 밝은 먹이 무리나 흰 뱀 위에 얹히면 통째로 묻힌다(선례:
  「질주」 라벨이 분홍 뱀 위에서 안 읽혔다). 배경을 «가정하지 않고» 재려면
  링 둘레를 한 바퀴 돌며 «그 자리의 실제 배경»과 대비를 재야 한다.

★ 재는 법
  베이스 링 둘레 720개 지점에서
    (a) 링 위 픽셀       = 우리가 그린 선
    (b) 링 바깥 6px 픽셀 = 그 자리의 «배경»
  둘의 WCAG 상대휘도 대비비를 구한다. 그중 «최솟값»이 최악의 자리다.
  ⇒ 여러 시드로 반복해 「어떤 판에서도 최악이 얼마인가」를 낸다.

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
VW, VH = 390, 844
TIMES = 5          # 한 판 안에서 «시간»을 흘리며 재는 표본 수
# ★ src/input.ts 의 `export const STICK_MAX`(링 반지름)와 «반드시» 같아야 한다.
#   2026-09-06 에 58 → 52 로 바뀌었는데 여기가 58 로 남아 있었더니, 검사기가
#   링이 «없는» 자리를 재서 대비 13.0배 → 1.0배(=「링이 안 보인다」)로 나왔다.
#   링은 멀쩡히 그려지고 있었다 — 값을 안 맞추면 검사기가 거짓 경보를 낸다.
STICK_MAX = 52

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


def lum(c):
    def f(v):
        v /= 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])


def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


PX_JS = """([cx, cy, R]) => {
  const c = document.getElementById('stage');
  if (!c) return null;
  const g = c.getContext('2d');
  if (!g) return null;
  const sx = c.width / parseFloat(c.style.width || c.width);
  const sy = c.height / parseFloat(c.style.height || c.height);
  const at = (x, y) => {
    const d = g.getImageData(Math.round(x * sx), Math.round(y * sy), 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const out = [];
  for (let i = 0; i < 720; i++) {
    const a = Math.PI * 2 * i / 720;
    out.push([at(cx + Math.cos(a) * R, cy + Math.sin(a) * R),
              at(cx + Math.cos(a) * (R + 7), cy + Math.sin(a) * (R + 7))]);
  }
  return out;
}"""


def stats(px):
    rs = sorted(ratio(on, off) for on, off in px)
    return {"min": round(rs[0], 3), "p05": round(rs[len(rs) // 20], 3),
            "med": round(rs[len(rs) // 2], 3),
            "mean": round(sum(rs) / len(rs), 3)}


def main() -> int:
    dist = Path(sys.argv[1]).resolve()
    tag = sys.argv[2]
    seeds = [int(x) for x in sys.argv[3:]] or [7, 11, 23, 41, 99]
    port, srv = serve(dist)
    rows = []

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)      # ★headless 고정
        for seed in seeds:
            ctx = b.new_context(viewport={"width": VW, "height": VH},
                                device_scale_factor=1,   # 1:1 로 재야 좌표가 곧 픽셀
                                is_mobile=True, has_touch=True, locale="ko-KR")
            ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                                % json.dumps(json.dumps(SAVE, ensure_ascii=False)))
            page = ctx.new_page()
            page.goto(f"http://127.0.0.1:{port}/?debug=1&quiet=1&seed={seed}",
                      wait_until="load")
            page.wait_for_timeout(800)
            page.evaluate("() => window.__coil.startRun()")
            page.wait_for_timeout(1500)
            page.evaluate("() => window.__coil.ghost(600)")
            page.wait_for_timeout(300)

            st = page.evaluate("() => window.__coil.stick ? window.__coil.stick() : null")
            if not st:
                print("!! stick 훅이 없는 빌드다 — 이 검사는 AFTER 에만 돈다")
                ctx.close()
                continue
            cx, cy = st["homeX"], st["homeY"]

            shot = OUT / "contrast" / f"{tag}_seed{seed}.png"
            shot.parent.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(shot))

            # ★★ 양성 대조 — 이것 없이는 이 검사를 믿으면 안 된다.
            #   1차 실행에서 시드 5개가 «바이트 단위로 같은» 값을 냈다. 「어떤
            #   배경에서도 안전하다」로 읽을 뻔했지만, 실제로는 시드를 강제하면
            #   장면이 같아져 «같은 배경을 다섯 번 잰» 것이었다.
            #   ⇒ (a) 한 판 안에서 «시간»을 흘려 배경이 실제로 바뀌게 하고,
            #     (b) drag 모드(=링을 «안 그리는» 상태)를 같은 자리에서 재서
            #        「우리 링이 있을 때와 없을 때가 다르다」를 증명한다.
            #        대조군이 1.0 근처가 아니면 이 측정은 링이 아니라 «배경 무늬»를
            #        재고 있는 것이고, 그러면 결과 전체가 무효다.
            on_s, off_s = [], []
            for t in range(TIMES):
                page.wait_for_timeout(650)
                px = page.evaluate(PX_JS, [cx, cy, STICK_MAX])
                if px:
                    on_s.append(stats(px))
            page.evaluate("() => window.__coil.setControl('drag')")
            page.wait_for_timeout(400)
            for t in range(TIMES):
                page.wait_for_timeout(650)
                px = page.evaluate(PX_JS, [cx, cy, STICK_MAX])
                if px:
                    off_s.append(stats(px))
            ctx.close()

            row = {"seed": seed, "shot": str(shot),
                   "joystick": on_s, "control_drag": off_s,
                   "joy_min": min(x["min"] for x in on_s),
                   "joy_p05": min(x["p05"] for x in on_s),
                   "joy_med": round(sum(x["med"] for x in on_s) / len(on_s), 3),
                   "ctl_med": round(sum(x["med"] for x in off_s) / len(off_s), 3)}
            rows.append(row)
            print(f"seed {seed}: 조이스틱 med={row['joy_med']} p05={row['joy_p05']}"
                  f" min={row['joy_min']}  |  대조군(drag, 링 없음) med={row['ctl_med']}")
        b.close()
    srv.shutdown()

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"contrast_{tag}.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    if rows:
        jm = min(r["joy_p05"] for r in rows)
        jmed = round(sum(r["joy_med"] for r in rows) / len(rows), 3)
        cmed = round(sum(r["ctl_med"] for r in rows) / len(rows), 3)
        print(f"== {tag}")
        print(f"   조이스틱 링 대비: 중앙값 {jmed} · 최악(p05) {jm}")
        print(f"   양성대조(drag=링 없음): 중앙값 {cmed}"
              f"  → 링이 있을 때 {round(jmed / cmed, 1)}배")
        if cmed > 1.6:
            print("   !! 대조군이 1 에서 너무 멀다 — 배경 무늬를 재고 있을 수 있다")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
