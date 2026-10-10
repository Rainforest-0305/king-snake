# -*- coding: utf-8 -*-
"""arena_try2.py — 「난도가 반대로 갔다」를 «분리»해서 원인을 잡는다. 창 0.

  실측 사고(2026-09-03): 먹이 총량 고정 + 가두리 강화 를 «같이» 넣었더니
  기준 플레이어 생존 51.7 → 94.2초, 한 판 최고점 826 → 2,044 로 «훨씬 쉬워졌다».
  지난 레인의 「큰 봇을 늘렸더니 쉬워졌다」와 같은 형태의 반직관이다.
  ⇒ 한 번에 하나만 되돌려 어느 쪽이 범인인지 가린다.

    python tools/arena_try2.py [--seeds 14] [--secs 180] [--only F1,F3]
"""
import io, json, os, subprocess, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CFG = os.path.join(ROOT, 'src', 'game', 'config.ts')
BOTS = os.path.join(ROOT, 'src', 'game', 'bots.ts')

TIERS_NOW = """  regular: { look: 215, reaction: 0.095, noise: 0.28, foodScan: 560, huntRange: 620,  wAvoid: 3.3, wFood: 1.15, wHunt: 1.25, fleeAt: 0.55, encircle: 0.22 },
  hunter:  { look: 300, reaction: 0.055, noise: 0.15, foodScan: 700, huntRange: 900,  wAvoid: 3.8, wFood: 0.95, wHunt: 2.1,  fleeAt: 0.44, encircle: 0.62 },
  elite:   { look: 320, reaction: 0.045, noise: 0.11, foodScan: 820, huntRange: 1080, wAvoid: 4.0, wFood: 0.90, wHunt: 2.5,  fleeAt: 0.38, encircle: 0.85 },"""

TIERS_E1 = """  regular: { look: 215, reaction: 0.095, noise: 0.28, foodScan: 560, huntRange: 560,  wAvoid: 3.3, wFood: 1.15, wHunt: 1.05, fleeAt: 0.55, encircle: 0.12 },
  hunter:  { look: 300, reaction: 0.055, noise: 0.15, foodScan: 700, huntRange: 820,  wAvoid: 3.8, wFood: 0.95, wHunt: 1.8,  fleeAt: 0.44, encircle: 0.45 },
  elite:   { look: 320, reaction: 0.045, noise: 0.11, foodScan: 820, huntRange: 1000, wAvoid: 4.0, wFood: 0.90, wHunt: 2.1,  fleeAt: 0.38, encircle: 0.70 },"""

# 성향(비율)만 늘리고 «조건»은 E1 로 되돌린 표
TIERS_POPONLY = """  regular: { look: 215, reaction: 0.095, noise: 0.28, foodScan: 560, huntRange: 560,  wAvoid: 3.3, wFood: 1.15, wHunt: 1.05, fleeAt: 0.55, encircle: 0.22 },
  hunter:  { look: 300, reaction: 0.055, noise: 0.15, foodScan: 700, huntRange: 820,  wAvoid: 3.8, wFood: 0.95, wHunt: 1.8,  fleeAt: 0.44, encircle: 0.62 },
  elite:   { look: 320, reaction: 0.045, noise: 0.11, foodScan: 820, huntRange: 1000, wAvoid: 4.0, wFood: 0.90, wHunt: 2.1,  fleeAt: 0.38, encircle: 0.85 },"""

WRAP_E1 = [
    ('export const ENCIRCLE_STEP = 0.95;', 'export const ENCIRCLE_STEP = 0.85;'),
    ('export const ENCIRCLE_PAD = 58;', 'export const ENCIRCLE_PAD = 70;'),
    ('export const ENCIRCLE_MASS_RATIO = 0.72;', 'export const ENCIRCLE_MASS_RATIO = 0.55;'),
    ('export const ENCIRCLE_RANGE_FRAC = 0.72;', 'export const ENCIRCLE_RANGE_FRAC = 0.55;'),
]
WRAP_TIGHT = [
    ('export const ENCIRCLE_MASS_RATIO = 0.72;', 'export const ENCIRCLE_MASS_RATIO = 0.55;'),
    ('export const ENCIRCLE_RANGE_FRAC = 0.72;', 'export const ENCIRCLE_RANGE_FRAC = 0.48;'),
]
FOOD_SCALED = ('export const FOOD_TARGET = 9000;',
               'export const FOOD_TARGET = Math.round(FOOD_TARGET_BASE * MAP_SCALE);')
FOOD_LEAN = ('export const FOOD_TARGET = 9000;', 'export const FOOD_TARGET = 7600;')

# 이름: (cfg 치환들, bots 치환들)
VARIANTS = {
    # 먹이 고정«만» (가두리·TIERS 는 E1 로 되돌림) — 먹이 레버 단독 효과
    'F1_foodOnly':   ([], [(TIERS_NOW, TIERS_E1)] + WRAP_E1),
    # 가두리·TIERS 강화«만» (먹이는 옛 비례) — 가두리 레버 단독 효과
    'F2_wrapOnly':   ([FOOD_SCALED], []),
    # 먹이 고정 + «성향만» 늘리고 조건은 E1 (긴 사거리 랩이 범인인지)
    'F3_popOnly':    ([], [(TIERS_NOW, TIERS_POPONLY)] + WRAP_E1),
    # 먹이 고정 + 성향 늘림 + 랩 조건을 «더 좁힘»(짧은 사거리에서만 감는다)
    'F4_tightWrap':  ([], [(TIERS_NOW, TIERS_POPONLY)] + WRAP_TIGHT),
    # F4 + 먹이를 한 단 더 조임
    'F5_leanFood':   ([FOOD_LEAN], [(TIERS_NOW, TIERS_POPONLY)] + WRAP_TIGHT),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seeds', type=int, default=14)
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
            print('[%-12s] life=%5.1f peakMed=%5d peakMean=%5d rank1=%2d/%d | deaths150=%-5s '
                  'cross3s=%-5s outer=%-5s massMax=%5d giantAlv=%.2f botLife=%.1f'
                  % (name, p['lifeMeanS'], p['peakMed'], p['peakMean'], p['everRank1'], p['runs'],
                     d['difficulty']['deathsPer150s'], d['cross3s']['pct'],
                     d['radial']['outerHeadPct'], d['size']['massMax'],
                     d['size']['giantAliveMean'], d['giants']['botLifeMeanS']), flush=True)
    finally:
        io.open(CFG, 'w', encoding='utf-8').write(cfg0)
        io.open(BOTS, 'w', encoding='utf-8').write(bots0)
        print('원복 완료')
    io.open(os.path.join(out, 'try2_all.json'), 'w', encoding='utf-8').write(
        json.dumps(rows, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
