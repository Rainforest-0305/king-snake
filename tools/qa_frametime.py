# -*- coding: utf-8 -*-
"""qa_frametime.py - «최악 시나리오» 프레임 시간 게이트. headless 전용(창 없음).

★ 왜 평균 fps 가 아니라 «분포»인가 (2026-08-29 President: 「프레임 수 안 떨어지게 최종 검사」):
  평균 60 은 「1초에 한 번 40ms 드랍」을 숨긴다. 그래서 프레임마다 delta 를 «전부 모아»
  p50 / p95 / p99 / 최악(ms) / 16.7ms 초과 비율 / 스파이크(>33ms) 횟수를 낸다.

★ 최악 시나리오를 «만든다» (?debug=1 의 __coil.stress 훅):
  · 확장된 맵 그대로(봇 «최대 수» = BOT_COUNT, 먹이 = FOOD_TARGET)
  · 거대 봇(질량 --stress-mass, 기본 1,200) --stress-n 마리를 «화면 안»에 몰아넣고 «계속 질주»
  · 플레이어도 질량 1,200(몸이 길어 화면을 가로지른다) + 데모 AI 가 조종(킬 피드·리더보드 갱신)
  · 적응형 해상도 «고정»(?fixscale=0) - 안 고정하면 해상도가 내려가 드랍이 «숨는다».
    실제 제품은 적응형이 켜져 있으므로 이 값은 «상한»이다(제품은 이보다 좋다).
  · 마크(기본 60/120/180초)마다 --window 초 동안 잰다. 마크 12초 전에 stress 를 «다시» 건다
    (질주 봇은 서로 부딪혀 죽고 작게 리스폰하므로 - 다시 몰아넣어야 최악이 유지된다).

★ 힙: --enable-precise-memory-info + --expose-gc 로 «GC 직후» usedJSHeapSize 를 t=10s 와 마지막 마크
  뒤에 잰다. 누수 징후 = 증가량.

★ 양성대조(--positive-control): dist 사본의 index.html 에 «모든 stroke 에 shadowBlur 20» 을 강제하는
  스크립트를 «앞에» 끼워 넣고 같은 검사를 돌린다. 여기서 드랍이 «안 잡히면» 검사기가 고장난 것이다.

  python tools/qa_frametime.py <distdir> <tag> [--backend gpu|software|both] [--view mobile|desktop|both]
                               [--marks 60,120,180] [--window 8] [--stress-n 6] [--stress-mass 1200]
                               [--positive-control]
산출물: qa/lane12/frametime_<tag>.json + 표 출력
"""
from __future__ import annotations

import argparse
import http.server
import json
import shutil
import socketserver
import sys
import tempfile
import threading
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SEED = 20260818
GPU_ARGS = ["--enable-gpu", "--use-gl=angle", "--use-angle=default", "--ignore-gpu-blocklist"]
MEM_ARGS = ["--enable-precise-memory-info", "--js-flags=--expose-gc"]

PROBE = """
(ms) => new Promise((resolve) => {
  const d = [];
  let prev = performance.now();
  const t0 = prev;
  function tick(now) {
    d.push(now - prev); prev = now;
    if (now - t0 < ms) requestAnimationFrame(tick);
    else resolve(d.slice(3));
  }
  requestAnimationFrame(tick);
});
"""

HEAP = """() => new Promise((resolve) => {
  const g = () => { try { if (window.gc) window.gc(); } catch (e) {} };
  g(); setTimeout(() => { g(); setTimeout(() => {
    resolve(performance.memory ? performance.memory.usedJSHeapSize : -1);
  }, 120); }, 120);
});"""

POSITIVE_CONTROL_JS = (
    "<script>(function(){var P=CanvasRenderingContext2D.prototype,S=P.stroke;"
    "P.stroke=function(){this.shadowBlur=20;this.shadowColor='rgba(255,255,255,0.6)';"
    "var r=S.apply(this,arguments);this.shadowBlur=0;return r;};})();</script>"
)


def serve(d: Path) -> int:
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(d), **k)

        def log_message(self, *a):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s.server_address[1]


def stats(d: list[float]) -> dict:
    s = sorted(d)
    n = len(s)

    def pct(p):
        if n == 0:
            return 0.0
        k = (n - 1) * p
        lo, hi = int(k), min(n - 1, int(k) + 1)
        return s[lo] + (s[hi] - s[lo]) * (k - lo)

    total = sum(s)
    return {
        "frames": n,
        "fps": round(n / (total / 1000), 1) if total > 0 else 0,
        "p50": round(pct(0.5), 2),
        "p95": round(pct(0.95), 2),
        "p99": round(pct(0.99), 2),
        "worst": round(s[-1], 2) if n else 0,
        # vsync miss = >17.5ms. rAF timestamps are quantized (16.70/16.80) so a raw >16.7 count
        # would flag timer jitter as drops. A real missed vsync shows as ~33.3ms.
        "over16_7_pct": round(100 * sum(1 for x in s if x > 17.5) / n, 2) if n else 0,
        "raw_over16_7_pct": round(100 * sum(1 for x in s if x > 16.7) / n, 2) if n else 0,
        "over25_pct": round(100 * sum(1 for x in s if x > 25) / n, 2) if n else 0,
        "spikes33": sum(1 for x in s if x > 33),
    }


def run_combo(pw, port: int, backend: str, view: str, marks: list[int], window: float,
              stress_n: int, stress_mass: int, layers: str = "", nostress: bool = False,
              adaptive: bool = False) -> dict:
    args = (GPU_ARGS if backend == "gpu" else []) + MEM_ARGS
    b = pw.chromium.launch(headless=True, args=args)
    try:
        if view == "mobile":
            ctx = b.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2,
                                is_mobile=True, has_touch=True, locale="ko-KR")
        else:
            ctx = b.new_context(viewport={"width": 1600, "height": 900}, locale="ko-KR")
        pg = ctx.new_page()
        errs: list[str] = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        url = "http://127.0.0.1:%d/?demo=1&debug=1&ads=off&seed=%d" % (port, SEED)
        if not adaptive:
            url += "&fixscale=0"
        if layers:
            url += "&layers=" + layers
        pg.goto(url, wait_until="load")
        t = 0.0

        def wait_until(sec: float):
            nonlocal t
            if sec > t:
                pg.wait_for_timeout(int((sec - t) * 1000))
                t = sec

        wait_until(10)
        heap0 = pg.evaluate(HEAP)
        rows = []
        for m in marks:
            got = 0
            if not nostress:
                wait_until(m - 12)
                got = pg.evaluate("(a) => window.__coil.stress(a[0], a[1], true, 1200)", [stress_n, stress_mass])
                # Boosting bots leave the screen within 2-3 s and the player dies and respawns small.
                # Re-apply the stress every 2.5 s during the probe so the worst case is sustained
                # (applied identically to the before and after builds).
                wait_until(m - 1)
                pg.evaluate("(a) => { window.__stressTimer = setInterval(() => window.__coil.stress(a[0], a[1], true, 1200), 2500); }",
                            [stress_n, stress_mass])
            wait_until(m)
            d = pg.evaluate(PROBE, int(window * 1000))
            t += window
            if not nostress:
                pg.evaluate("() => { clearInterval(window.__stressTimer); }")
            st = pg.evaluate("() => ({ t: window.__coilTimes(), s: window.__coil.state() })")
            r = stats(d)
            r.update({"at": m, "stressed": got, "mass": round(st["s"]["mass"]),
                      # ★ 2026-09-08 정정: 훅이 orbs/snakes(시간 키)를 덮어쓰던 것을
                      #   고치면서 «개수»는 orbsN/snakesN 으로 옮겨졌는데(main.ts 주석)
                      #   이 검사기가 옛 키를 계속 읽어 KeyError 로 «죽어 있었다».
                      #   옛 키가 남아 있는 빌드도 있으니 둘 다 받아 준다.
                      "orbsDrawn": st["t"].get("orbsN", st["t"].get("orbs")),
                      "orbsTotal": st["t"].get("orbsTotal"),
                      "snakesDrawn": st["t"].get("snakesN", st["t"].get("snakes")),
                      "scale": st["t"]["scale"],
                      "ms": {k: round(st["t"][k], 3) for k in
                             ("bg", "bodies", "heads", "labels", "vignette", "mini", "total", "sim")
                             if isinstance(st["t"].get(k), (int, float))}})
            rows.append(r)
            print("    t=%3ds fps %5.1f  p50 %5.2f p95 %5.2f p99 %5.2f worst %6.2f  >16.7 %5.2f%%  spikes %d  "
                  "| snakes %s orbs %s mass %s | ms %s"
                  % (m, r["fps"], r["p50"], r["p95"], r["p99"], r["worst"], r["over16_7_pct"],
                     r["spikes33"], r["snakesDrawn"], r["orbsDrawn"], r["mass"], json.dumps(r["ms"])),
                  flush=True)
        heap1 = pg.evaluate(HEAP)
        ctx.close()
    finally:
        b.close()
    return {"rows": rows, "heap0": heap0, "heap1": heap1,
            "heapDeltaMB": round((heap1 - heap0) / 1048576, 2) if heap0 >= 0 and heap1 >= 0 else None,
            "errors": errs}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dist")
    ap.add_argument("tag")
    ap.add_argument("--backend", default="both")
    ap.add_argument("--view", default="both")
    ap.add_argument("--marks", default="60,120,180")
    ap.add_argument("--window", type=float, default=8)
    ap.add_argument("--stress-n", type=int, default=6)
    ap.add_argument("--stress-mass", type=int, default=1200)
    ap.add_argument("--positive-control", action="store_true")
    ap.add_argument("--layers", default="", help="?layers=N mask (diagnostic: turn snake/bg layers off)")
    ap.add_argument("--nostress", action="store_true", help="measure the plain demo (no worst-case forcing)")
    ap.add_argument("--adaptive", action="store_true", help="leave adaptive resolution ON (product behaviour) instead of fixscale=0")
    a = ap.parse_args()

    dist = Path(a.dist).resolve()
    if a.positive_control:
        tmp = Path(tempfile.mkdtemp(prefix="coil_pc_"))
        shutil.copytree(dist, tmp / "d")
        dist = tmp / "d"
        html = (dist / "index.html").read_text(encoding="utf-8")
        (dist / "index.html").write_text(html.replace("<head>", "<head>" + POSITIVE_CONTROL_JS, 1),
                                         encoding="utf-8")
        print("[positive control] shadowBlur=20 on every stroke ->", dist)

    marks = [int(x) for x in a.marks.split(",")]
    backends = ["gpu", "software"] if a.backend == "both" else [a.backend]
    views = ["mobile", "desktop"] if a.view == "both" else [a.view]
    port = serve(dist)
    out = {"dist": str(dist), "marks": marks, "window": a.window,
           "stress": {"n": a.stress_n, "mass": a.stress_mass}, "combos": {}}
    with sync_playwright() as pw:
        for be in backends:
            for v in views:
                key = be + "/" + v
                print("[frametime %s] %s" % (a.tag, key), flush=True)
                out["combos"][key] = run_combo(pw, port, be, v, marks, a.window, a.stress_n, a.stress_mass,
                                               a.layers, a.nostress, a.adaptive)
                c = out["combos"][key]
                print("    heap %s -> %s MB (delta %s MB)  errors %d"
                      % (round(c["heap0"] / 1048576, 1) if c["heap0"] >= 0 else "n/a",
                         round(c["heap1"] / 1048576, 1) if c["heap1"] >= 0 else "n/a",
                         c["heapDeltaMB"], len(c["errors"])), flush=True)
    (ROOT / "qa" / "lane12").mkdir(parents=True, exist_ok=True)
    p = ROOT / "qa" / "lane12" / ("frametime_%s.json" % a.tag)
    p.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print("saved", p)

    # 합격선: GPU p99 <= 17.5(=16.7 + rAF 타임스탬프 지터) & miss(>17.5ms) <= 1% / SW fps >= 55 & p99 <= 25 / heap delta <= 10MB
    ok = True
    for key, c in out["combos"].items():
        for r in c["rows"]:
            if key.startswith("gpu"):
                good = r["p99"] <= 17.5 and r["over16_7_pct"] <= 1.0
            else:
                good = r["fps"] >= 55 and r["p99"] <= 25
            if not good:
                ok = False
                print("  FAIL %s t=%d: fps %.1f p99 %.2f over16.7 %.2f%%" % (key, r["at"], r["fps"], r["p99"], r["over16_7_pct"]))
        if c["heapDeltaMB"] is not None and c["heapDeltaMB"] > 10:
            ok = False
            print("  FAIL %s heap delta %.1f MB" % (key, c["heapDeltaMB"]))
    print("GATE:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
