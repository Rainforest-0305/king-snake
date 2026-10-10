# -*- coding: utf-8 -*-
"""sim_ab.py - config 상수만 바꿔치기해 «시뮬만» A/B 한다(브라우저·창 없음).

  python tools/sim_ab.py <name>=<K:V,K:V,...> <name2>=... [--seeds N] [--secs S]
  name 이 'CURRENT' 면 무수정, 'PREMERGE' 면 병합 전 상수 세트.
"""
from __future__ import annotations
import json, re, shutil, subprocess, sys, os, tempfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
# 프로젝트 폴더를 더럽히지 않는다 - 변형 소스와 번들은 OS 임시 폴더에 만든다.
TMP = Path(os.environ.get("SIM_TMP", Path(tempfile.gettempdir()) / "coilrush_sim"))
ESBUILD = ROOT / "node_modules" / ".bin" / "esbuild.cmd"

PREMERGE = {
    "R_MIN": 9.5, "PICK_R_MIN": 9.5, "MAGNET_RADIUS_K": 4.2,
    "DEATH_DROP_RATIO": 0.72, "DEATH_ORB_VALUE": 9, "DEATH_ORB_MAX": 220,
    "DEATH_SCATTER_K": 1.4, "DEATH_HEAD_BIAS": 1.0,
}


def build(name: str, over: dict) -> Path:
    d = TMP / name
    if d.exists():
        shutil.rmtree(d)
    (d).mkdir(parents=True)
    shutil.copytree(ROOT / "src" / "game", d / "game")
    # ★ 난도 손잡이는 config.ts 에만 있는 게 아니다 - 봇 «판단» 상수는 bots.ts 에 있다
    #   (PLAYER_HUNT_BIAS 등). 두 파일에서 찾고, 정확히 «한 곳»에서만 맞아야 한다.
    #   두 곳에서 맞거나 아무 데서도 안 맞으면 즉시 죽는다 - 조용히 «안 바뀐 채»
    #   A/B 를 돌리면 「효과 없음」이라는 «거짓 결론»이 나온다.
    files = [d / "game" / "config.ts", d / "game" / "bots.ts"]
    texts = {f: f.read_text(encoding="utf-8") for f in files if f.exists()}
    for k, v in over.items():
        hits = 0
        for f, src in list(texts.items()):
            new, n = re.subn(r"(export const %s\s*=\s*)[-0-9.eE]+" % k,
                             r"\g<1>%s" % v, src)
            if n:
                hits += n
                texts[f] = new
        if hits != 1:
            raise SystemExit("상수 치환 실패: %s (%d건)" % (k, hits))
    for f, src in texts.items():
        f.write_text(src, encoding="utf-8")
    out = d / "bundle.mjs"
    subprocess.run([str(ESBUILD), str(d / "game" / "world.ts"), "--bundle",
                    "--format=esm", "--platform=node", "--log-level=warning",
                    "--outfile=" + str(out)], check=True)
    return out


def run(bundle: Path, seeds: int, secs: int) -> dict:
    r = subprocess.run(["node", str(ROOT / "tools" / "sim_run.mjs"), str(bundle),
                        "20260818", str(seeds), str(secs)],
                       capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def main() -> int:
    args = [a for a in sys.argv[1:]]
    seeds, secs = 12, 150
    rest = []
    i = 0
    while i < len(args):
        if args[i] == "--seeds":
            seeds = int(args[i + 1]); i += 2
        elif args[i] == "--secs":
            secs = int(args[i + 1]); i += 2
        else:
            rest.append(args[i]); i += 1

    results = []
    for spec in rest:
        name, _, body = spec.partition("=")
        if name == "PREMERGE":
            over = dict(PREMERGE)
        elif name == "CURRENT":
            over = {}
        else:
            over = dict(PREMERGE) if body.startswith("pre:") else {}
            body = body[4:] if body.startswith("pre:") else body
            for kv in filter(None, body.split(",")):
                k, _, v = kv.partition(":")
                over[k.strip()] = v.strip()
        b = build(name, over)
        res = run(b, seeds, secs)
        res["name"] = name
        res["over"] = over
        results.append(res)

    def medsel(rs, i):
        v = sorted(x["series"][i] for x in rs)
        m = len(v) // 2
        return v[m] if len(v) % 2 else (v[m - 1] + v[m]) / 2

    base = results[0]
    ns = len(base["runs"][0]["series"])
    marks = [i for i in (int(os.environ.get('M%d'%j, d)) for j, d in enumerate((1,3,5,11,29))) if i < ns]
    hdr = "%-14s %8s %8s %7s %7s %7s %7s %6s" % ("variant", "peakMed", "peakAvg", "orb/s", "eat/s", "deaths", "kill+3s", "killN")
    hdr += "".join(" %7s" % ("t%ds" % ((i + 1) * 5)) for i in marks) + " %8s" % "vs base"
    print(hdr)
    for r in results:
        d = (r["peakMed"] - base["peakMed"]) / max(1, base["peakMed"]) * 100
        line = "%-14s %8.0f %8.0f %7.2f %7.2f %7.2f %7.1f %6.2f" % (
            r["name"], r["peakMed"], r["peakMean"], r["orbRateMed"],
            r["eatRateMed"], r["deathsMean"], r["recovMed"], r["recovN"])
        line += "".join(" %7.0f" % medsel(r["runs"], i) for i in marks)
        line += " %+7.1f%%" % d
        print(line)
    (TMP / "last.json").write_text(json.dumps(results, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
