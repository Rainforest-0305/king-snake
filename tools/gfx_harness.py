# -*- coding: utf-8 -*-
"""gfx_harness.py - 뱀 키우기 그래픽 개선 «증거 하네스». headless 전용(창 0).

  python tools/gfx_harness.py shots <distdir> <label> [--sizes 375x812,390x844,430x932] [--locale ko|en]
      1_menu / 2_play(데모 3초) / 2b_play30(봇 30마리 화면 안) / 3_result / 4_skins(메뉴 스킨 블록) /
      zoom_corn_x3(내 옥수수뱀 확대) / skins_sheet(플레이어 12 + 봇 12, 게임과 같은 렌더 코드) + 콘솔 에러
  python tools/gfx_harness.py bench <distdir> <label> --cpu 4 --n 10 --mass 600 [--sec 60] [--adaptive] [--bloom on|off|watch]
      ?demo=1&debug=1 로 띄우고 __coil.stress(n, mass, boost, playerMass) 를 2.5초마다 다시 걸어 «봇 n 마리가 화면 안에서
      질주하는» 최악 상태를 유지하며 rAF 간격을 «전부» 모아 p50/p95/p99 를 낸다. CDP CPU 스로틀. 실 GPU(ANGLE D3D11).
      --adaptive 없으면 fixscale=0(해상도 고정 = 상한). --bloom on 이면 감시 off(순수 비용), watch 면 자동 강등 허용.
      결과에 전환 로그(qlog)·«5초 창 안 전환 쌍» 수·플레이 중 캔버스 크기 집합을 싣는다(2026-08-30 거버너 검증).
  python tools/gfx_harness.py xfade <distdir> <label>
      T0→T1→T2→T3 강제 전환을 0/200/400/600/900ms 에 찍는다(순차 크로스페이드 증거).
산출물: _gfx_evidence_260830/<shots|bench>/...
"""
from __future__ import annotations

import argparse
import base64
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EV = ROOT / "_gfx_evidence_260830"
SEED = 4242
GPU_ARGS = ["--use-gl=angle", "--use-angle=d3d11", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"]
SAVE_JS = ("localStorage.setItem('king-snake.save', JSON.stringify({v:1,nick:'',skin:'corn',sound:false,"
           "control:'joystick',locale:'%s',bestScore:%d,bestRank:999,games:9,totalKills:0,playSeconds:0}))")


def serve(d: Path) -> tuple[int, socketserver.TCPServer]:
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(d), **k)

        def log_message(self, *a):
            pass

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s.server_address[1], s


def pct(sorted_list, p):
    n = len(sorted_list)
    if n == 0:
        return 0.0
    k = (n - 1) * p
    lo, hi = int(k), min(n - 1, int(k) + 1)
    return sorted_list[lo] + (sorted_list[hi] - sorted_list[lo]) * (k - lo)


def crop_scale(src: Path, box, k: int, dst: Path) -> None:
    im = Image.open(src)
    c = im.crop(box)
    c = c.resize((c.width * k, c.height * k), Image.LANCZOS)
    c.save(dst)


def gpu_name(page) -> str:
    return page.evaluate("""() => { const c=document.createElement('canvas'); const gl=c.getContext('webgl');
      const d=gl&&gl.getExtension('WEBGL_debug_renderer_info'); return d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):'n/a'; }""")


def cmd_shots(a) -> int:
    dist = Path(a.dist).resolve()
    out = EV / "shots" / a.label
    out.mkdir(parents=True, exist_ok=True)
    port, srv = serve(dist)
    base = f"http://127.0.0.1:{port}"
    errs: list[str] = []
    sizes = [tuple(int(v) for v in s.split("x")) for s in a.sizes.split(",")]
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True, args=GPU_ARGS)
        for (W, H) in sizes:
            ctx = b.new_context(viewport={"width": W, "height": H}, device_scale_factor=2,
                                is_mobile=True, has_touch=True, locale="ko-KR" if a.locale == "ko" else "en-US")
            ctx.add_init_script(SAVE_JS % (a.locale, 700))  # 700점: 밀크스네이크 1종 해금 상태(잠금/해금 둘 다 보인다)
            page = ctx.new_page()
            page.on("pageerror", lambda e: errs.append("pageerror:" + str(e)))
            page.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)
            tag = f"{W}x{H}"
            # 1) 메뉴
            page.goto(f"{base}/?ads=off&seed={SEED}", wait_until="load")
            page.wait_for_timeout(1500)
            page.screenshot(path=str(out / f"{tag}_1_menu.png"))
            # 4) 스킨 블록(메뉴 안) - 해당 블록으로 스크롤해 «블록만» 캡처
            try:
                el = page.query_selector(".p-skin")
                if el:
                    el.scroll_into_view_if_needed()
                    page.wait_for_timeout(300)
                    el.screenshot(path=str(out / f"{tag}_4_skins.png"))
            except Exception as e:  # noqa: BLE001
                errs.append("skins shot: " + str(e))
            # 2) 플레이(데모 AI) 3초 - 디버그 오버레이 없이(깨끗한 화면)
            page.goto(f"{base}/?demo=1&ads=off&seed={SEED}", wait_until="load")
            page.wait_for_timeout(3000)
            page.screenshot(path=str(out / f"{tag}_2_play.png"))
            # 2b) 봇 30마리 «화면 안» (stress 훅, 격자 배치·유령 없음) → 즉시 freeze(충돌 전 프레임)
            page.goto(f"{base}/?demo=1&debug=1&quiet=1&ads=off&seed={SEED}", wait_until="load")
            page.wait_for_timeout(2500)
            st = page.evaluate("() => window.__coilTimes ? window.__coilTimes() : null")
            page.evaluate("() => { window.__coil.stress(30, 120, false, 900, 'grid', false); window.__coil.freeze(true); }")
            page.wait_for_timeout(700)
            page.screenshot(path=str(out / f"{tag}_2b_play30.png"))
            st2 = page.evaluate("() => window.__coilTimes ? window.__coilTimes() : null")
            page.evaluate("() => { window.__coil.freeze(false); window.__coil.stopStress(); }")
            (out / f"{tag}_state.json").write_text(json.dumps({"play": st, "play30": st2}, indent=1), encoding="utf-8")
            # 사람 판(데모 아님 - 데모는 죽어도 결과 화면이 안 뜬다): 입력 없이 2.6초 → 확대 컷 →
            # 3) 제자리 사망(crash, +0.32초: 폭발·흔들림) → 결과 화면(+1.5초)
            page.goto(f"{base}/?debug=1&quiet=1&ads=off&seed={SEED}", wait_until="load")
            page.wait_for_timeout(1200)
            page.tap("button.p-play")
            page.wait_for_timeout(2600)
            page.screenshot(path=str(out / f"{tag}_play_human.png"))
            cx, cy = W, H
            crop_scale(out / f"{tag}_play_human.png", (cx - 220, cy - 150, cx + 220, cy + 150), 3,
                       out / f"{tag}_zoom_corn_x3.png")
            page.evaluate("() => (window.__coil.crash ? window.__coil.crash() : window.__coil.kill())")
            page.wait_for_timeout(320)
            page.screenshot(path=str(out / f"{tag}_3a_death.png"))
            page.wait_for_timeout(1500)
            page.screenshot(path=str(out / f"{tag}_3_result.png"))
            ctx.close()
        # 스킨 시트(디버그 훅, 게임과 같은 렌더 코드)
        ctx = b.new_context(viewport={"width": 1200, "height": 900}, locale="ko-KR")
        page = ctx.new_page()
        page.goto(f"{base}/?debug=1&ads=off&seed={SEED}", wait_until="load")
        page.wait_for_timeout(800)
        data = page.evaluate("() => window.__coilSkinSheet ? window.__coilSkinSheet(6) : ''")
        if data:
            (out / "skins_sheet.png").write_bytes(base64.b64decode(data.split(",", 1)[1]))
        ctx.close()
        b.close()
    srv.shutdown()
    (out / "errors.json").write_text(json.dumps(errs, indent=1, ensure_ascii=False), encoding="utf-8")
    print("shots saved:", out, "errors:", len(errs))
    for e in errs:
        print("  ", e[:200])
    return 0


def cmd_bench(a) -> int:
    dist = Path(a.dist).resolve()
    out = EV / "bench"
    out.mkdir(parents=True, exist_ok=True)
    port, srv = serve(dist)
    base = f"http://127.0.0.1:{port}"
    errs: list[str] = []
    W, H, DPR = 390, 844, 3
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True, args=GPU_ARGS)
        ctx = b.new_context(viewport={"width": W, "height": H}, device_scale_factor=DPR,
                            is_mobile=True, has_touch=True, locale="ko-KR")
        ctx.add_init_script(SAVE_JS % ("ko", 0))
        ctx.add_init_script("""
          window.__pf = new Float64Array(40000); window.__pn = 0;
          const raf = window.requestAnimationFrame.bind(window);
          window.requestAnimationFrame = (cb) => raf((t) => { if (window.__pn < 40000) window.__pf[window.__pn++] = t; return cb(t); });
        """)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errs.append("pageerror:" + str(e)))
        page.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)
        cdp = ctx.new_cdp_session(page)
        url = f"{base}/?demo=1&debug=1&ads=off&seed={SEED}"
        if not a.adaptive:
            url += "&fixscale=0"
        if a.bloom == "off":
            url += "&bloom=off"
        if a.layers:
            url += "&layers=" + a.layers
        page.goto(url, wait_until="load")
        gpu = gpu_name(page)
        page.wait_for_timeout(2500)
        has_bloom = page.evaluate("() => !!(window.__coil && window.__coil.setBloom)")
        if has_bloom and a.bloom == "on":
            page.evaluate("() => window.__coil.setBloom(true, false)")  # 감시 off = 순수 비용
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": a.cpu})
        page.evaluate("(x) => window.__coil.stress(x[0], x[1], true, x[2], x[3])", [a.n, a.mass, a.player_mass, a.layout])
        page.evaluate("(x) => { window.__st = setInterval(() => window.__coil.stress(x[0], x[1], true, x[2], x[3]), x[4]); }",
                      [a.n, a.mass, a.player_mass, a.layout, int(a.every * 1000)])
        page.wait_for_timeout(1500)  # 워밍업(스프라이트·타일·셰이더 캐시)
        page.evaluate("() => { window.__pn = 0; }")
        samples = []
        elapsed = 0
        while elapsed < a.sec * 1000:
            page.wait_for_timeout(2000)
            elapsed += 2000
            samples.append(page.evaluate(
                "() => { const t = window.__coilTimes(); return [t.snakesN ?? t.snakes, t.orbsN ?? t.orbs, t.scale, "
                "t.bloom ? 1 : 0, t.canvasW ?? 0, t.canvasH ?? 0, t.tier ?? -1]; }"))
        r = page.evaluate("""() => ({ pf: Array.from(window.__pf.subarray(0, window.__pn)),
            t: window.__coilTimes ? window.__coilTimes() : null, s: window.__coil.state(),
            qlog: window.__coil.qlog ? window.__coil.qlog() : null })""")
        page.evaluate("() => clearInterval(window.__st)")
        ctx.close()
        b.close()
    srv.shutdown()
    iv = [r["pf"][i] - r["pf"][i - 1] for i in range(1, len(r["pf"])) if 0 < r["pf"][i] - r["pf"][i - 1] < 1000]
    s = sorted(iv)
    # ── 전환 로그 분석: «5초 창 안 전환 쌍» 수, 플레이 중 해상도(캔버스) 변경 횟수, 본 캔버스 크기 집합 ──
    qlog = r.get("qlog") or []
    tier_ev = [e for e in qlog if e.get("from", -1) >= 0]
    scale_ev = [e for e in qlog if str(e.get("why", "")).startswith("scale")]
    burst5 = 0
    for i in range(len(tier_ev)):
        for j in range(i + 1, len(tier_ev)):
            if tier_ev[j]["now"] - tier_ev[i]["now"] <= 5000:
                burst5 += 1
            else:
                break
    canvas_sizes = sorted({(x[4], x[5]) for x in samples if len(x) > 5})
    tiers_seen = sorted({x[6] for x in samples if len(x) > 6})
    res = {
        "label": a.label, "dist": str(dist), "gpu": gpu, "viewport": f"{W}x{H}@{DPR}", "cpu": a.cpu, "sec": a.sec,
        "n": a.n, "mass": a.mass, "playerMass": a.player_mass, "adaptive": a.adaptive, "bloomArg": a.bloom,
        "layout": a.layout, "every": a.every,
        "frames": len(iv), "fps": round(len(iv) / (sum(iv) / 1000), 2) if iv else 0,
        "p50": round(pct(s, .5), 2), "p95": round(pct(s, .95), 2), "p99": round(pct(s, .99), 2),
        "max": round(s[-1], 2) if s else 0,
        "over17_5_pct": round(100 * sum(1 for x in s if x > 17.5) / len(s), 2) if s else 0,
        "over25_pct": round(100 * sum(1 for x in s if x > 25) / len(s), 2) if s else 0,
        "spikes33": sum(1 for x in s if x > 33.4),
        "times": r["t"], "snakesDrawn": (r["t"] or {}).get("snakesN", (r["t"] or {}).get("snakes")), "orbsDrawn": (r["t"] or {}).get("orbsN", (r["t"] or {}).get("orbs")),
        "snakesDrawnMean": round(sum(x[0] for x in samples) / len(samples), 1) if samples else None,
        "orbsDrawnMean": round(sum(x[1] for x in samples) / len(samples), 1) if samples else None,
        "scaleMin": min(x[2] for x in samples) if samples else None,
        "bloomOnFrac": round(sum(x[3] for x in samples) / len(samples), 2) if samples else None,
        "scale": (r["t"] or {}).get("scale"), "bloom": (r["t"] or {}).get("bloom"),
        "bloomQuality": (r["t"] or {}).get("bloomQuality"), "bloomAutoOff": (r["t"] or {}).get("bloomAutoOff"),
        "tier": (r["t"] or {}).get("tier"), "tiersSeen": tiers_seen, "promotions": (r["t"] or {}).get("promotions"),
        "qlog": qlog, "tierTransitions": len(tier_ev), "pairsWithin5s": burst5,
        "scaleChangesInPlay": len(scale_ev), "canvasSizesSeen": canvas_sizes,
        "errors": errs,
    }
    p = out / f"{a.label}_cpu{a.cpu}_n{a.n}_m{a.mass}{'_adaptive' if a.adaptive else ''}{'_bloom' + a.bloom}{('_L' + a.layers) if a.layers else ''}.json"
    p.write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: v for k, v in res.items() if k not in ("times", "dist", "errors", "qlog")}, ensure_ascii=False))
    if qlog:
        print("QLOG:", json.dumps(qlog, ensure_ascii=False))
    if errs:
        print("ERRORS:", errs[:5])
    return 0


def cmd_xfade(a) -> int:
    dist = Path(a.dist).resolve()
    out = EV / "shots" / a.label
    out.mkdir(parents=True, exist_ok=True)
    port, srv = serve(dist)
    base = f"http://127.0.0.1:{port}"
    errs: list[str] = []
    W, H = 390, 844
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True, args=GPU_ARGS)
        ctx = b.new_context(viewport={"width": W, "height": H}, device_scale_factor=2,
                            is_mobile=True, has_touch=True, locale="ko-KR")
        ctx.add_init_script(SAVE_JS % ("ko", 700))
        page = ctx.new_page()
        page.on("pageerror", lambda e: errs.append("pageerror:" + str(e)))
        page.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)
        page.goto(f"{base}/?demo=1&debug=1&quiet=1&ads=off&seed={SEED}&fixscale=0", wait_until="load")
        page.wait_for_timeout(2500)
        page.evaluate("() => window.__coil.stress(12, 300, false, 900, 'grid', false)")
        page.wait_for_timeout(600)
        states = []
        for tier in (1, 2, 3):
            t0 = page.evaluate("(t) => { window.__coil.setTier(t); return performance.now(); }", tier)
            for ms in (0, 200, 400, 600, 900):
                page.wait_for_timeout(0 if ms == 0 else (200 if ms <= 600 else 300))
                st = page.evaluate(
                    "() => { const t = window.__coilTimes(); return { tier: t.tier, xf: t.xf, mix: t.bloomMix, "
                    "bloom: t.bloom, q: t.bloomQuality, w: t.canvasW, h: t.canvasH, now: performance.now() }; }")
                st["sinceMs"] = round(st["now"] - t0, 1)
                states.append({"to": tier, "ms": ms, **st})
                page.screenshot(path=str(out / f"xfade_T{tier}_{ms:03d}ms.png"))
            page.wait_for_timeout(400)
        qlog = page.evaluate("() => window.__coil.qlog()")
        ctx.close()
        b.close()
    srv.shutdown()
    (out / "xfade_states.json").write_text(
        json.dumps({"states": states, "qlog": qlog, "errors": errs}, indent=1, ensure_ascii=False), encoding="utf-8")
    for st in states:
        print(st)
    print("errors:", len(errs))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("shots")
    s.add_argument("dist")
    s.add_argument("label")
    s.add_argument("--sizes", default="375x812,390x844,430x932")
    s.add_argument("--locale", default="ko")
    s.add_argument("--zoom-all", action="store_true")
    s.set_defaults(fn=cmd_shots)
    bch = sub.add_parser("bench")
    bch.add_argument("dist")
    bch.add_argument("label")
    bch.add_argument("--cpu", type=int, default=4)
    bch.add_argument("--n", type=int, default=10)
    bch.add_argument("--mass", type=int, default=600)
    bch.add_argument("--player-mass", type=int, default=600)
    bch.add_argument("--sec", type=int, default=60)
    bch.add_argument("--adaptive", action="store_true")
    bch.add_argument("--bloom", default="watch", choices=["on", "off", "watch"])
    bch.add_argument("--layers", default="", help="?layers=N (bit7=128 scales, bit0 glow, bit2 highlight ...)")
    bch.add_argument("--layout", default="grid", choices=["grid", "ring"], help="stress 배치(라이브 빌드는 ring 만 안다 → grid 인자 무시)")
    bch.add_argument("--every", type=float, default=3.0, help="stress 재적용 주기(초)")
    bch.set_defaults(fn=cmd_bench)
    xf = sub.add_parser("xfade")
    xf.add_argument("dist")
    xf.add_argument("label")
    xf.set_defaults(fn=cmd_xfade)
    a = ap.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
