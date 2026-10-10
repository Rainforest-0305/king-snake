# -*- coding: utf-8 -*-
"""flicker_probe.py - 블룸 깜빡임 프로브(headless 전용, 창 0). 네온 깜빡임 원인 확정(평균 뒤 문턱) 검증 규격:
   cpu 1x · 품질 전환 0(거버너 off) · 해상도 고정 · 뱀이 움직이는 동안(데모 AI) 프레임마다 블룸 에너지(a1 FBO 휘도 합)를
   읽어 «8프레임 창 max/min 비» 와 «블랙아웃(이동 중앙값 50% 이하)» 을 센다.
     python tools/flicker_probe.py dist <label> [--legacy] [--frames 300] [--cpu 1]
   --legacy: ?bright=legacy (1판 «평균 뒤 문턱» 대조군). 산출: _gfx_evidence_260830/flicker/<label>.json
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gfx_harness import EV, GPU_ARGS, SAVE_JS, SEED, serve  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dist")
    ap.add_argument("label")
    ap.add_argument("--legacy", action="store_true")
    ap.add_argument("--frames", type=int, default=300)
    ap.add_argument("--cpu", type=int, default=1)
    ap.add_argument("--n", type=int, default=20)
    a = ap.parse_args()
    dist = Path(a.dist).resolve()
    out = EV / "flicker"
    out.mkdir(parents=True, exist_ok=True)
    port, srv = serve(dist)
    base = f"http://127.0.0.1:{port}"
    errs: list[str] = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True, args=GPU_ARGS)
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3,
                            is_mobile=True, has_touch=True, locale="ko-KR")
        ctx.add_init_script(SAVE_JS % ("ko", 0))
        page = ctx.new_page()
        page.on("pageerror", lambda e: errs.append("pageerror:" + str(e)))
        page.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)
        cdp = ctx.new_cdp_session(page)
        url = f"{base}/?demo=1&debug=1&quiet=1&ads=off&seed={SEED}&fixscale=0" + ("&bright=legacy" if a.legacy else "")
        page.goto(url, wait_until="load")
        page.wait_for_timeout(2000)
        page.evaluate("() => window.__coil.setBloom(true, false)")  # 거버너 off = 품질 전환 0
        if a.cpu > 1:
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": a.cpu})
        page.evaluate("(n) => window.__coil.stress(n, 200, false, 600, 'ring', true)", a.n)
        page.wait_for_timeout(800)
        page.evaluate("""(N) => { window.__en = []; window.__ft = []; window.__q = [];
            (function f(t) { const t0 = performance.now(); const e = window.__coil.bloomEnergy();
              const st = window.__coilTimes(); window.__en.push(e); window.__ft.push(t); window.__q.push([st.tier, st.bloomQuality, st.canvasW, st.canvasH]);
              if (window.__en.length < N) requestAnimationFrame(f); })(performance.now()); }""", a.frames)
        page.wait_for_timeout(int(a.frames / 60 * 1000 * 1.6) + 1500)
        r = page.evaluate("() => ({ en: window.__en, ft: window.__ft, q: window.__q })")
        ctx.close()
        b.close()
    srv.shutdown()
    en = [float(x) for x in r["en"]]
    n = len(en)
    ratios = []
    for i in range(0, n - 7):
        w = en[i:i + 8]
        lo = min(w)
        hi = max(w)
        ratios.append(hi / lo if lo > 0 else float("inf"))
    med = statistics.median(en) if en else 0
    black = sum(1 for x in en if x < 0.5 * med)
    # 이동 중앙값(15프레임) 대비 편차
    dev = []
    for i in range(n):
        lo = max(0, i - 7)
        hi = min(n, i + 8)
        m = statistics.median(en[lo:hi])
        dev.append(abs(en[i] - m) / m if m > 0 else 0)
    qset = sorted({tuple(x) for x in r["q"]})
    res = {
        "label": a.label, "legacy": a.legacy, "cpu": a.cpu, "frames": n, "bots": a.n,
        "energyMedian": round(med, 1), "energyMin": round(min(en), 1) if en else None, "energyMax": round(max(en), 1) if en else None,
        "ratio8_max": round(max(ratios), 3) if ratios else None,
        "ratio8_p95": round(sorted(ratios)[int(len(ratios) * 0.95)], 3) if ratios else None,
        "windows_over_1_5": sum(1 for x in ratios if x > 1.5),
        "windows_total": len(ratios),
        "blackouts": black,
        "dev_mean": round(statistics.mean(dev), 4) if dev else None,
        "dev_max": round(max(dev), 4) if dev else None,
        "states_seen": qset,
        "errors": errs,
        "energy": [round(x) for x in en],
    }
    (out / f"{a.label}.json").write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: v for k, v in res.items() if k != "energy"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
