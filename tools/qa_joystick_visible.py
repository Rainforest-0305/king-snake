# -*- coding: utf-8 -*-
"""qa_joystick_visible.py — 「쉴 때 조이스틱이 질주 버튼만큼 보이는가」.

  python tools/qa_joystick_visible.py <distDir> <tag>

★ 왜 이 검사를 새로 만드나 — 앞선 대비 측정이 «틀렸다»
  qa_joystick_contrast.py 는 링 위(R=58) 픽셀과 링 바깥(R+7=65) 픽셀을 비교했다.
  그런데 어두운 받침(plate)도 R=58 까지 깔린다. 즉 그 측정이 잡은 것은
  «링 선»이 아니라 «받침 원 전체의 어두워짐»이었다. 게다가 그때 시드-7 장면은
  조이스틱 자리에 «밝은 청록 뱀»이 깔려 있었다 — 어두운 받침이 가장 잘 보이는
  최선의 배경이다. 그 값(10.8배)을 「어떤 배경에서도 보인다」로 일반화한 것이
  실기기에서 안 보인 것과 어긋난 이유다.
  ⇒ 이번엔 (a) «선»만 재고 (b) «어두운 빈 아레나»(가장 불리한 배경)에서 재고
    (c) ★같은 프레임의 «질주 버튼 링»을 기준자로 나란히 잰다.
    질주 버튼은 President 가 한 번도 「안 보인다」고 한 적이 없다 = 합격선이다.

★ 재는 법: 링 둘레 720점에서 «선 위» 픽셀 vs «선 바로 안쪽 5px» 픽셀.
  둘 다 받침 위라, 차이는 오직 «선» 때문이다.
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
# ★ src/input.ts 의 STICK_MAX(링 반지름)와 «반드시» 같아야 한다. 2026-09-06 58→52.
STICK_MAX = 52

SAVE = {"v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
        "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
        "control": "joystick", "sound": False, "locale": None}


def lum(c):
    def f(v):
        v /= 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])


def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


# 선 «위» vs 선 «안쪽 5px». 둘 다 받침 위라 차이는 선 때문만이다.
# 바깥쪽(+5)도 같이 재서 「받침 경계」가 만드는 대비와 분리한다.
PX = """([cx, cy, R]) => {
  const c = document.getElementById('stage');
  const g = c.getContext('2d');
  const sx = c.width / parseFloat(c.style.width);
  const sy = c.height / parseFloat(c.style.height);
  const at = (x, y) => {
    const d = g.getImageData(Math.round(x * sx), Math.round(y * sy), 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const out = [];
  for (let i = 0; i < 720; i++) {
    const a = Math.PI * 2 * i / 720;
    const ca = Math.cos(a), sa = Math.sin(a);
    out.push({ on: at(cx + ca * R, cy + sa * R),
               inn: at(cx + ca * (R - 5), cy + sa * (R - 5)),
               out: at(cx + ca * (R + 5), cy + sa * (R + 5)) });
  }
  return out;
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


def stats(px, key):
    rs = sorted(ratio(p["on"], p[key]) for p in px)
    return {"min": round(rs[0], 2), "p05": round(rs[len(rs) // 20], 2),
            "med": round(rs[len(rs) // 2], 2), "max": round(rs[-1], 2)}


def main() -> int:
    dist = Path(sys.argv[1]).resolve()
    tag = sys.argv[2]
    port, srv = serve(dist)
    rows = []
    outdir = OUT / "visible"
    outdir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": 390, "height": 844},
                            device_scale_factor=1, is_mobile=True,
                            has_touch=True, locale="ko-KR")
        ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                            % json.dumps(json.dumps(SAVE, ensure_ascii=False)))
        page = ctx.new_page()
        page.goto(f"http://127.0.0.1:{port}/?debug=1&quiet=1&seed=7", wait_until="load")
        page.wait_for_timeout(900)
        page.evaluate("() => window.__coil.startRun()")
        page.wait_for_timeout(1400)
        page.evaluate("() => window.__coil.ghost(900)")

        # ★ 「가장 불리한 배경」= 어두운 빈 아레나. 뱀·먹이가 조이스틱 자리에
        #   없을 때까지 «시간»을 흘리며 여러 장 재고 그중 최악을 쓴다.
        for t in range(6):
            page.wait_for_timeout(700)
            st = page.evaluate("() => window.__coil.stick()")
            bs = page.evaluate("() => window.__coil.state().boostBtn")
            joy = page.evaluate(PX, [st["homeX"], st["homeY"], STICK_MAX])
            boo = page.evaluate(PX, [bs["x"], bs["y"], bs["r"]])
            rows.append({
                "t": t,
                "joy_in": stats(joy, "inn"), "joy_out": stats(joy, "out"),
                "boost_in": stats(boo, "inn"), "boost_out": stats(boo, "out"),
            })
            page.screenshot(path=str(outdir / f"{tag}_t{t}.png"))
        ctx.close()
        b.close()
    srv.shutdown()

    (OUT / f"visible_{tag}.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"== {tag}  (선 위 vs 선 안쪽 5px — 받침 효과를 뺀 «선»만의 대비)")
    print(f"{'':10s} {'조이스틱 링':>26s}   {'질주 버튼 링(기준자)':>26s}")
    for r in rows:
        j, k = r["joy_in"], r["boost_in"]
        print(f"  t={r['t']}     med={j['med']:6.2f} p05={j['p05']:5.2f}"
              f"      med={k['med']:6.2f} p05={k['p05']:5.2f}")
    jm = min(r["joy_in"]["med"] for r in rows)
    km = min(r["boost_in"]["med"] for r in rows)
    print()
    print(f"  최악 프레임 기준  조이스틱 {jm}  vs  질주 {km}")
    print(f"  ⇒ 조이스틱이 질주 버튼의 {jm / km * 100:.0f}% 만큼 보인다"
          f"  ({'합격' if jm >= km * 0.8 else '★미달 — 더 진하게 해야 한다'})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
