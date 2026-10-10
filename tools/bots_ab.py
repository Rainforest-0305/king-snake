# -*- coding: utf-8 -*-
"""bots_ab.py - 봇 «실력» A/B. 브라우저·창 없음.

  python tools/bots_ab.py CURRENT NAME=K:V,K2:V2 ... [--seeds N] [--secs S]

★ sim_ab.py 와 무엇이 다른가
  sim_ab 는 오토파일럿 «플레이어»의 peak 를 본다. 그 대리인이 약해서(peak 중앙
  1,300) 난도 변화가 분산에 묻혔다. 이쪽은 tools/sim_bots.mjs 를 써서 «봇 세계»
  자체를 잰다 - 초거대 생존시간·사망원인 분포가 주 지표다.

★ 상수는 config.ts «와» bots.ts 양쪽에서 찾는다. 정확히 한 곳에서만 맞아야 하고
  아니면 즉시 죽는다 - 조용히 «안 바뀐 채» A/B 를 돌리면 「효과 없음」이라는
  거짓 결론이 나온다(2026-09-04 실제로 이 함정을 밟을 뻔했다).

★ 프로젝트 폴더를 더럽히지 않는다. 변형 소스·번들은 OS 임시 폴더에 만든다.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
TMP = Path(os.environ.get("SIM_TMP", Path(tempfile.gettempdir()) / "coilrush_bots"))
ESBUILD = ROOT / "node_modules" / ".bin" / "esbuild.cmd"

ENTRY = """export { World } from './game/world';
export { __botDebug } from './game/bots';
export { __gridDebug } from './game/spatial';
export * as __cfg from './game/config';
"""


def build(name: str, over: dict) -> Path:
    d = TMP / name
    if d.exists():
        shutil.rmtree(d)
    d.mkdir(parents=True)
    shutil.copytree(ROOT / "src" / "game", d / "game")
    files = [d / "game" / "config.ts", d / "game" / "bots.ts"]
    texts = {f: f.read_text(encoding="utf-8") for f in files if f.exists()}
    for k, v in over.items():
        hits = 0
        for f, src in list(texts.items()):
            new, cnt = re.subn(r"(export const %s\s*=\s*)[-0-9.eE]+" % re.escape(k),
                               r"\g<1>%s" % v, src)
            if cnt:
                hits += cnt
                texts[f] = new
        if hits != 1:
            raise SystemExit("상수 치환 실패: %s (%d건)" % (k, hits))
    for f, src in texts.items():
        f.write_text(src, encoding="utf-8")
    (d / "entry.ts").write_text(ENTRY, encoding="utf-8")
    out = d / "bundle.mjs"
    subprocess.run([str(ESBUILD), str(d / "entry.ts"), "--bundle", "--format=esm",
                    "--platform=node", "--log-level=warning",
                    "--outfile=" + str(out)], check=True)
    return out


def run(bundle: Path, seeds: int, secs: int) -> dict:
    p = subprocess.run(["node", str(ROOT / "tools" / "sim_bots.mjs"), str(bundle),
                        "20260818", str(seeds), str(secs)],
                       capture_output=True, text=True, encoding="utf-8")
    if p.returncode != 0:
        raise SystemExit("시뮬 실패:\n" + (p.stderr or "")[-2000:])
    return json.loads(p.stdout)


def signtest_p(up: int, k: int) -> float:
    """양측 부호검정 p값. k = 무변을 «뺀» 표본 수."""
    if k == 0:
        return 1.0
    from math import comb
    tail = min(up, k - up)
    c = sum(comb(k, i) for i in range(tail + 1))
    return min(1.0, 2.0 * c / (2 ** k))


def main() -> int:
    # 플래그«와 그 값»을 함께 걷어낸다. 값을 안 걷어내면 "20"·"180" 이
    # 변형 이름으로 잡혀 같은 조건을 세 번 돌린다(2026-09-04 실제로 그랬다).
    argv = sys.argv[1:]
    seeds, secs, args = 20, 180, []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--seeds":
            seeds = int(argv[i + 1]); i += 2; continue
        if a == "--secs":
            secs = int(argv[i + 1]); i += 2; continue
        if a.startswith("--"):
            i += 1; continue
        args.append(a); i += 1

    variants = []
    for a in args:
        if "=" in a:
            name, kv = a.split("=", 1)
            over = {}
            for pair in kv.split(","):
                k, v = pair.split(":")
                over[k.strip()] = v.strip()
            variants.append((name, over))
        else:
            variants.append((a, {}))

    res = {}
    for name, over in variants:
        b = build(name, over)
        res[name] = run(b, seeds, secs)
        (ROOT / "_joy_260903" / ("bots_%s.json" % name)).write_text(
            json.dumps(res[name], ensure_ascii=False, indent=1), encoding="utf-8")

    base = res[variants[0][0]]
    print("시드 %d x %ds   (초거대 기준 질량 %s)" % (seeds, secs, base["titanMass"]))
    print()
    hdr = ("%-10s | %8s %8s %8s | %6s %6s %6s | %7s %7s %7s %6s"
           % ("variant", "초거대", "초반사망", "생존율",
              "벽%", "몸통%", "정면%", "킬/분", "가두리%", "중위생존", "peak"))
    print(hdr)
    print("-" * len(hdr))
    for name, _ in variants:
        r = res[name]
        tc = r["titanCause"]
        print("%-10s | %8.1f %7.1f%% %7.1f%% | %6.1f %6.1f %6.1f | %7.2f %7.2f %7.1f %6.0f"
              % (name, r["titanLifeMed"], r["titanEarlyPctMed"], r["titanSurvivePctMed"],
                 tc["borderPct"], tc["bodyPct"], tc["headonPct"],
                 r["killsPerMinMed"], r["wrapKillPctMed"], r["lifeMedMed"],
                 r["playerPeakMed"]))
    print()
    print("(초거대=중위 생존초 · 초반사망=생후 10초 내 사망 비율 · 생존율=180초 완주 비율)")
    print("(벽/몸통/정면 = 초거대 사망 원인 분포 · 가두리% = 전체 킬 중 가두리 중 발생분)")
    print()
    for name, _ in variants:
        r = res[name]
        print("  %-10s 전체봇 사망원인 벽 %.1f%% 몸통 %.1f%% 정면 %.1f%% (n=%d) · 초거대 표본 %d"
              % (name, r["allCause"]["borderPct"], r["allCause"]["bodyPct"],
                 r["allCause"]["headonPct"], r["allCause"]["total"], r["titanCause"]["total"]))

    # ── ★조용한 절단 — 0 이 아니면 그 실험은 «무효»다 ──────────────────────
    print()
    for name, _ in variants:
        r = res[name]
        print("  %-10s 죽는 순간 질주 중이었던 비율  초거대 %5.1f%%  |  전체봇 %5.1f%%"
              % (name, r.get("titanDeadBoostPctMed", 0), r.get("allDeadBoostPctMed", 0)))
    print()
    for name, _ in variants:
        print("  %-10s 엄폐 발동 틱(중위) %s   ← 0 이면 코드가 «안 도는» 것이다"
              % (name, res[name].get("shelterTicksMed", 0)))
        print("  %-10s   그중 «몸이 위협과 나 사이»에 놓인 비율 %.1f%%  <- 진짜 성공 지표"
              % (name, res[name].get("shelterShieldPctMed", 0)))
    print()
    print("  ── 플레이어 쪽(난도 상승인가 «심심해짐»인가) ─────────────────────")
    for name, _ in variants:
        r = res[name]
        print("  %-11s 오브 %6.0f개 / 총가치 %8.0f · 초거대 동시존재 %4.1f마리"
              " · 1위 3만도달 %s"
              % (name, r.get("orbNMed", 0), r.get("orbVMed", 0),
                 r.get("titanConcMed", 0),
                 ("%.0f초 (%d/%d판)" % (r.get("reach30kMed", 0),
                  r.get("reach30kN", 0), r["n"])) if r.get("reach30kN") else "없음"))
    print()
    bad = []
    for name, _ in variants:
        t = res[name].get("gridTruncated", 0)
        mark = "" if t == 0 else "   !! 무효 - 후보 버퍼가 넘쳐 회피 대상이 잘렸다"
        if t:
            bad.append(name)
        print("  %-10s 그리드 조용한 절단 %d 회%s" % (name, t, mark))

    # ── ★시드 페어링 — 「효과인가 잡음인가」를 가른다 ───────────────────────
    #   중위값만 보면 이 시뮬의 흔들림(같은 조건에서 peak 1300 vs 1658 = 28%)에
    #   묻힌다. 같은 시드끼리 짝지어 «차이의 부호»가 일관되는지 본다.
    #   20개 중 15개 이상이 개선 쪽이면 그때 믿는다(부호검정 p<0.05 근방).
    base_name = variants[0][0]
    bruns = {r["seed"]: r for r in res[base_name]["runs"]}
    print()
    print("  시드 페어링 (기준=%s) — 초거대 중위생존 차이의 부호" % base_name)
    for name, _ in variants[1:]:
        up = down = same = 0
        deltas = []
        for r in res[name]["runs"]:
            b0 = bruns.get(r["seed"])
            if not b0:
                continue
            d = r["titanLifeMed"] - b0["titanLifeMed"]
            deltas.append(d)
            if d > 0.5:
                up += 1
            elif d < -0.5:
                down += 1
            else:
                same += 1
        n2 = len(deltas)
        avg = sum(deltas) / n2 if n2 else 0
        # ★부호검정(sign test). 무변(tie)은 «분모에서 뺀다» — 그게 표준이다.
        #   기존 문턱은 tie 를 분모에 넣어 40시드 29:8(p<0.001)도 흘렸다.
        k = up + down
        pv = signtest_p(up, k)
        verdict = ("★유의(p=%.4f)" % pv) if (pv < 0.05 and up > down) else (
            ("⛔악화(p=%.4f)" % pv) if (pv < 0.05 and down > up)
            else "판정보류(p=%.3f)" % pv)
        print("    %-10s 개선 %2d / 악화 %2d / 무변 %2d  평균차 %+6.1f초   %s"
              % (name, up, down, same, avg, verdict))
    if bad:
        print()
        print("  !! 절단이 발생한 변형이 있다: %s -> 그 결과는 쓰지 마라" % ", ".join(bad))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
