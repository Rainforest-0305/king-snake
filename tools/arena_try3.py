# -*- coding: utf-8 -*-
"""arena_try3.py — 최종 후보 «맵 크기·초거대 비율·중앙 밀도» 3축 비교. 창 0.

  실측 경과(2026-09-03):
    누적 절제(arena_sweep) 결과 «맵 확대»가 난도를 가장 크게 «낮췄고»
    (기준 플레이어 생존 39.5 → 55.2초), 가두리가 가장 크게 올렸다(65.1 → 51.7).
    먹이 축소·가두리 강화는 둘 다 실측에서 «반대로» 가 기각됐다(arena_try2).
    ⇒ 남은 축은 셋뿐이다: 맵 크기 · 초거대 비율 · 봇의 중앙 밀도.

    python tools/arena_try3.py [--seeds 20] [--secs 180] [--only G1,G2]
"""
import io, json, os, subprocess, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CFG = os.path.join(ROOT, 'src', 'game', 'config.ts')
BOTS = os.path.join(ROOT, 'src', 'game', 'bots.ts')

MAP33 = ('export const MAP_SCALE = 3.6;', 'export const MAP_SCALE = 3.3;')
MAP34 = ('export const MAP_SCALE = 3.6;', 'export const MAP_SCALE = 3.4;')
TITAN7 = ('export const SPAWN_MASS_TITAN_FRAC = 0.05;',
          'export const SPAWN_MASS_TITAN_FRAC = 0.07;')
TITAN9 = ('export const SPAWN_MASS_TITAN_FRAC = 0.05;',
          'export const SPAWN_MASS_TITAN_FRAC = 0.09;')
# 중앙(0~0.3R) 밀도 보정: homeR 하한 0.2R → 0. 실측에서 중앙 밀도가 1.05 → 0.72 로
# 빠졌는데, 플레이어는 0.35R 에서 시작한다 = «시작 지점이 한산해졌다».
CENTER = ('homeR: Math.sqrt(rng.range(0.04, 1)) * 0.94,',
          'homeR: Math.sqrt(rng.range(0, 1)) * 0.94,')
# 행선지를 더 세게 = 봇이 자기 자리를 더 잘 지킨다(분포가 더 균일해진다)
ROAM8 = ('export const BOT_ROAM_W = 0.55;', 'export const BOT_ROAM_W = 0.8;')

VARIANTS = {
    'G0_map3.6':        ([], []),                       # 현재 소스(= 절제표의 E)
    'G1_map3.3':        ([MAP33], []),
    'G2_map3.3_t7':     ([MAP33, TITAN7], []),
    'G3_map3.4_t7_c':   ([MAP34, TITAN7], [CENTER]),
    'G4_map3.6_t9_c':   ([TITAN9], [CENTER, ROAM8]),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seeds', type=int, default=20)
    ap.add_argument('--secs', type=int, default=180)
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    only = [x for x in a.only.split(',') if x]
    cfg0 = io.open(CFG, encoding='utf-8').read()
    bots0 = io.open(BOTS, encoding='utf-8').read()
    out = os.path.join(ROOT, '_arena')
    rows = []
    try:
        for name, (cs, bs) in VARIANTS.items():
            if only and name not in only:
                continue
            cfg, bots = cfg0, bots0
            for o, n in cs:
                assert cfg.count(o) == 1, (name, o[:50], cfg.count(o))
                cfg = cfg.replace(o, n)
            for o, n in bs:
                assert bots.count(o) == 1, (name, o[:50], bots.count(o))
                bots = bots.replace(o, n)
            io.open(CFG, 'w', encoding='utf-8').write(cfg)
            io.open(BOTS, 'w', encoding='utf-8').write(bots)
            subprocess.run(['npx', 'esbuild', 'tools/arena_entry.ts', '--bundle', '--format=esm',
                            '--platform=node', '--outfile=_arena/try.mjs', '--log-level=error'],
                           cwd=ROOT, check=True, shell=True)
            jf = os.path.join(out, 'try_%s.json' % name)
            r = subprocess.run(['node', 'tools/qa_arena.mjs', '_arena/try.mjs',
                                '--seeds', str(a.seeds), '--secs', str(a.secs), '--json', jf],
                               cwd=ROOT, check=True, capture_output=True, text=True)
            d = json.loads(r.stdout.strip().split('\n')[-1])
            d['_name'] = name
            rows.append(d)
            p = d['refPlayer']
            print('[%-16s] life=%5.1f peakMed=%5d rank1=%2d/%-3d | deaths150=%-5s cross3s=%-5s '
                  'outerHead=%-5s dens=%s massMax=%5d giantAlv=%.2f fill=%d'
                  % (name, p['lifeMeanS'], p['peakMed'], p['everRank1'], p['runs'],
                     d['difficulty']['deathsPer150s'], d['cross3s']['pct'],
                     d['radial']['outerHeadPct'], d['radial']['densityRel'],
                     d['size']['massMax'], d['size']['giantAliveMean'],
                     d['size']['fillLenPerMunits2']), flush=True)
    finally:
        io.open(CFG, 'w', encoding='utf-8').write(cfg0)
        io.open(BOTS, 'w', encoding='utf-8').write(bots0)
        print('원복 완료')
    io.open(os.path.join(out, 'try3_all.json'), 'w', encoding='utf-8').write(
        json.dumps(rows, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
