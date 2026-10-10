# -*- coding: utf-8 -*-
"""qa_growth.py - 데모 뱀의 «성장 곡선»을 전/후로 직접 비교한다.

왜 필요한가:
  perf.py 가 t=120s 에 찍은 길이가 병합 전 1,324 / 병합 후 360 이었다.
  fps 보다 이쪽이 크다 - President 요구가 「빨리 성장」이라서, 성장이
  느려졌다면 이번 변경은 목적을 «거꾸로» 달성한 것이 된다.

★단, 길이 한 점만 보면 «죽어서 리셋된 것»과 «못 자란 것»을 구분할 수 없다.
  그래서 순위(#N)와 최고 길이를 «함께» 추적한다. 죽으면 길이가 급락하므로
  최고값과 현재값이 벌어지는 것으로 사망을 식별한다.

두 디렉터리를 각각 띄워 같은 시드로 잰다. headless 고정.

  python tools/qa_growth.py <before_dir> <after_dir>
  python tools/qa_growth.py <before_dir> <after_dir> --seeds 6 --secs 90

★★ 시드 1개로 판정하지 마라 (2026-08-25 실측으로 확인).
   같은 빌드를 두 번 재면 곡선이 «완전히 같다» - 이 하네스는 결정론적이다.
   그래서 문제는 「재현이 안 된다」가 아니라 «시드마다 결과가 따로 논다»는 것이다.
   실제로 시드 20260818 하나에서, 상수 하나(MAGNET_RADIUS_K)만 4.7/5.0/5.6 으로
   바꾼 세 빌드의 최고길이가 477 / 1639 / 873 으로 «3.4배» 벌어졌다.
   한 판이 킬 한 번, 사망 한 번에 통째로 갈리기 때문이다.
   ⇒ 시드 1개짜리 차이는 «측정이 아니라 뽑기»다. --seeds 로 여러 판을 재고
     중앙값으로 말하라. 더 싸고 더 정확한 판정은 tools/sim_ab.py (브라우저 없이
     같은 시뮬을 수십~수백 시드로 돌린다).
"""
from __future__ import annotations

import http.server
import socketserver
import sys
import threading
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

SEED = 20260818
SAMPLE_S = 5
TOTAL_S = 150
SEED_STRIDE = 7919  # sim_ab.py 와 같은 간격 - 두 하네스의 시드를 맞춰 둔다


def serve(d: Path) -> int:
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(d), **k)

        def log_message(self, *a):
            pass

    s = socketserver.TCPServer(("127.0.0.1", 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s.server_address[1]


READ_HUD = """() => {
  const txt = (document.body.innerText || '');
  const m = txt.match(/([0-9][0-9,]*)/);
  const el = document.querySelector('[class*=score], [class*=hud-score]');
  const s = el ? el.textContent : txt.slice(0, 60);
  const n = (s.match(/([0-9][0-9,]*)/) || [])[1] || '0';
  const r = (s.match(/#([0-9]+)/) || [])[1] || '';
  return {len: parseInt(n.replace(/,/g, ''), 10) || 0, rank: r};
}"""


def measure(label: str, d: Path, pw, seeds: int = 1, secs: int = TOTAL_S) -> dict:
    port = serve(d)
    b = pw.chromium.launch(headless=True)
    peaks, deaths_all, runs = [], [], []
    try:
        ctx = b.new_context(viewport={"width": 390, "height": 652},
                            locale="ko-KR", has_touch=True, is_mobile=True)
        for k in range(seeds):
            seed = SEED + k * SEED_STRIDE
            pg = ctx.new_page()
            pg.goto("http://127.0.0.1:%d/?demo=1&seed=%d" % (port, seed),
                    wait_until="networkidle")
            peak = 0
            deaths = 0
            prev = 0
            series = []
            for _ in range(secs // SAMPLE_S):
                pg.wait_for_timeout(SAMPLE_S * 1000)
                h = pg.evaluate(READ_HUD)
                cur = h["len"]
                # 길이가 «절반 이하»로 떨어지면 죽고 리스폰한 것으로 본다.
                if prev > 60 and cur < prev * 0.5:
                    deaths += 1
                peak = max(peak, cur)
                series.append(cur)
                prev = cur
            pg.close()
            peaks.append(peak)
            deaths_all.append(deaths)
            runs.append({"seed": seed, "peak": peak, "deaths": deaths, "series": series})
        ctx.close()
    finally:
        b.close()
    sp = sorted(peaks)
    m = len(sp) // 2
    peak_med = sp[m] if len(sp) % 2 else (sp[m - 1] + sp[m]) / 2
    return {"label": label, "peak": peak_med, "peakMax": max(peaks),
            "deaths": sum(deaths_all) / len(deaths_all), "runs": runs,
            "final": runs[0]["series"][-1] if runs else 0,
            "series": runs[0]["series"], "peaks": peaks}


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    argv = sys.argv[1:]
    seeds, secs = 1, TOTAL_S
    pos = []
    i = 0
    while i < len(argv):
        if argv[i] == "--seeds":
            seeds = int(argv[i + 1]); i += 2
        elif argv[i] == "--secs":
            secs = int(argv[i + 1]); i += 2
        else:
            pos.append(argv[i]); i += 1
    before, after = Path(pos[0]), Path(pos[1])
    for p in (before, after):
        if not p.is_dir():
            print("디렉터리 없음: %s" % p)
            return 2

    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        rb = measure("기준", before, pw, seeds, secs)
        ra = measure("대상", after, pw, seeds, secs)

    print("  시드 %d개 x %d초" % (seeds, secs))
    for r in (rb, ra):
        print("  %-4s  최고길이 중앙 %-7.0f 최대 %-6d  사망(평균) %.1f회"
              % (r["label"], r["peak"], r["peakMax"], r["deaths"]))
        print("        시드별 최고: %s" % r["peaks"])
        if seeds == 1:
            print("        곡선: %s" % r["series"])
    if seeds == 1:
        print("  ⚠️ 시드 1개다 - 이 차이는 «측정이 아니라 뽑기»일 수 있다. --seeds 를 써라.")

    print()
    if rb["peak"] <= 0:
        print("★기준선이 0이다 - 이 검사기가 HUD 를 못 읽는다(판정 불가)")
        return 1
    delta = (ra["peak"] - rb["peak"]) / rb["peak"] * 100.0
    print("  최고길이 변화: %+.1f%%" % delta)
    if ra["deaths"] > rb["deaths"]:
        print("  ★병합 후 사망이 %d회 더 많다 - 성장이 아니라 «생존»이 원인일 수 있다"
              % (ra["deaths"] - rb["deaths"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
