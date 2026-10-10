# -*- coding: utf-8 -*-
"""arena_sweep.py — 레버 6개를 «하나씩 켜 가며» 같은 시드로 잰다. 창 0(브라우저 없음).

    python tools/arena_sweep.py [--seeds 12] [--secs 180] [--only A,B,C]

★ 왜 «누적 절제(ablation)»인가
  이번 지시는 레버가 6개(②난도·④봇실력·⑥바깥분포·⑦초거대·⑧가두리·⑨맵확대)고
  서로 밀고 당긴다. 「A안/B안/C안」처럼 임의 조합을 늘어놓으면 «무엇이 무엇을
  움직였는지»를 끝내 모른다. 지난 레인에서 「큰 봇 비율을 올렸더니 오히려 쉬워졌다」를
  잡아낸 것도 한 번에 하나만 바꿨기 때문이다.
  ⇒ base 에서 시작해 레버를 «하나씩» 얹는다. 각 줄의 차이가 곧 그 레버의 기여다.

★ 원본은 메모리에 들고 있다가 finally 에서 «반드시» 되돌린다. 중간에 죽어도
  워킹트리가 더러워지지 않는다(balance_sweep.mjs 와 같은 규율).

★ 「패턴을 못 찾으면 즉시 죽는다」 — 조용히 «아무것도 안 바꾸고» 통과하면
  그게 죽은 스윕이다(0건은 부재의 증거가 아니다).
"""
import io, json, os, subprocess, sys, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CFG = os.path.join(ROOT, 'src', 'game', 'config.ts')
BOTS = os.path.join(ROOT, 'src', 'game', 'bots.ts')
OUT = os.path.join(ROOT, '_arena')

ap = argparse.ArgumentParser()
ap.add_argument('--seeds', type=int, default=12)
ap.add_argument('--secs', type=int, default=180)
ap.add_argument('--only', default='')
args = ap.parse_args()

os.makedirs(OUT, exist_ok=True)

def read(p):
    return io.open(p, encoding='utf-8').read()

def write(p, s):
    io.open(p, 'w', encoding='utf-8').write(s)

CFG0 = read(CFG)
BOTS0 = read(BOTS)

# ── 되돌리기용 «옛 값» 조각 ────────────────────────────────────────────────
OLD_TIERS = """const TIERS: Record<BotTier, TierParams> = {
  rookie:  { look: 105, reaction: 0.20, noise: 0.55, foodScan: 340, huntRange: 0,   wAvoid: 2.4, wFood: 1.35, wHunt: 0,    fleeAt: 0.78, encircle: 0 },
  regular: { look: 175, reaction: 0.11, noise: 0.30, foodScan: 430, huntRange: 430, wAvoid: 3.1, wFood: 1.15, wHunt: 0.85, fleeAt: 0.58, encircle: 0 },
  hunter:  { look: 245, reaction: 0.065,noise: 0.16, foodScan: 520, huntRange: 640, wAvoid: 3.6, wFood: 0.95, wHunt: 1.5,  fleeAt: 0.46, encircle: 0 },
  elite:   { look: 245, reaction: 0.065,noise: 0.16, foodScan: 520, huntRange: 640, wAvoid: 3.6, wFood: 0.95, wHunt: 1.5,  fleeAt: 0.46, encircle: 0 },
};"""

OLD_PICKTIER = """export function pickTier(rng: Rng): BotTier {
  const r = rng.next();
  if (r < 0.34) return 'rookie';
  if (r < 0.79) return 'regular';
  return 'hunter';
}"""

def cut(src, marker, repl, tag):
    """marker 를 repl 로 바꾼다. 못 찾으면 «죽는다»."""
    if src.count(marker) != 1:
        raise SystemExit('arena_sweep: 패턴 불일치 (%s) count=%d' % (tag, src.count(marker)))
    return src.replace(marker, repl)

# ── 레버 정의 ──────────────────────────────────────────────────────────────
# 각 레버는 «끄는» 방법으로 적는다(최종 상태가 소스에 이미 들어 있으므로).
def off_map(cfg, bots):
    cfg = cut(cfg, 'export const MAP_SCALE = 3.6;', 'export const MAP_SCALE = 3.0;', 'MAP_SCALE')
    cfg = cut(cfg, 'export const BOT_COUNT = 90;',
              'export const BOT_COUNT = Math.round(BOT_COUNT_BASE * MAP_SCALE);', 'BOT_COUNT')
    return cfg, bots

def off_titan(cfg, bots):
    cfg = cut(cfg, 'export const SPAWN_MASS_TITAN_FRAC = 0.05;',
              'export const SPAWN_MASS_TITAN_FRAC = 0;', 'TITAN_FRAC')
    return cfg, bots

def off_skill(cfg, bots):
    i = bots.index('const TIERS: Record<BotTier, TierParams> = {')
    j = bots.index('};', i) + 2
    bots = bots[:i] + OLD_TIERS + bots[j:]
    i = bots.index('export function pickTier(rng: Rng): BotTier {')
    j = bots.index('}\n', i) + 2
    bots = bots[:i] + OLD_PICKTIER + '\n' + bots[j:]
    # elite 승격도 끈다(옛 상태에는 elite 가 없었다)
    bots = cut(bots, 'export const ELITE_MASS = 2200;',
               'export const ELITE_MASS = Number.POSITIVE_INFINITY;', 'ELITE_MASS')
    return cfg, bots

def off_spread(cfg, bots):
    bots = cut(bots, 'export const BOT_WALL_START = 0.93;', 'export const BOT_WALL_START = 0.8;', 'WALL_START')
    bots = cut(bots, 'export const BOT_WALL_PUSH = 6.0;', 'export const BOT_WALL_PUSH = 4.5;', 'WALL_PUSH')
    bots = cut(bots, 'export const BOT_WALL_THREAT_K = 0.5;', 'export const BOT_WALL_THREAT_K = 1.0;', 'WALL_THREAT')
    bots = cut(bots, 'export const BOT_ROAM_W = 0.55;', 'export const BOT_ROAM_W = 0;', 'ROAM_W')
    return cfg, bots

def off_wrap(cfg, bots):
    bots = cut(bots, 'export const ENCIRCLE_K = 1.0;', 'export const ENCIRCLE_K = 0;', 'ENCIRCLE_K')
    return cfg, bots

# 이름, 「끌 레버들」  (base = 전부 끔 = 라이브 -23 상태)
VARIANTS = [
    ('base  live-23',      [off_map, off_titan, off_skill, off_spread, off_wrap]),
    ('A  +map3.6/bot90',   [off_titan, off_skill, off_spread, off_wrap]),
    ('B  +titan',          [off_skill, off_spread, off_wrap]),
    ('C  +skill',          [off_spread, off_wrap]),
    ('D  +spread',         [off_wrap]),
    ('E  FINAL +encircle', []),
]

only = [x.strip() for x in args.only.split(',') if x.strip()]
rows = []
try:
    for name, offs in VARIANTS:
        key = name.split()[0]
        if only and key not in only:
            continue
        cfg, bots = CFG0, BOTS0
        for f in offs:
            cfg, bots = f(cfg, bots)
        write(CFG, cfg)
        write(BOTS, bots)
        entry = os.path.join(OUT, 'sweep.mjs')
        subprocess.run(['npx', 'esbuild', 'tools/arena_entry.ts', '--bundle', '--format=esm',
                        '--platform=node', '--outfile=_arena/sweep.mjs', '--log-level=error'],
                       cwd=ROOT, check=True, shell=True)
        jf = os.path.join(OUT, 'v_%s.json' % key)
        r = subprocess.run(['node', 'tools/qa_arena.mjs', '_arena/sweep.mjs',
                            '--seeds', str(args.seeds), '--secs', str(args.secs), '--json', jf],
                           cwd=ROOT, check=True, capture_output=True, text=True)
        d = json.loads(r.stdout.strip().split('\n')[-1])
        d['_name'] = name
        rows.append(d)
        print('[done] %-22s deaths150=%s  rank1=%s  runPeak=%s  leaderMax=%s  outer%%=%s'
              % (name, d['difficulty']['deathsPer150s'], d['compete']['rank1Frac'],
                 d['compete']['runPeakMean'], d['compete']['leaderMassMax'],
                 d['radial']['outerHeadPct']), flush=True)
        _ = entry
finally:
    write(CFG, CFG0)
    write(BOTS, BOTS0)
    print('\nconfig.ts / bots.ts 원복 완료')

write(os.path.join(OUT, 'sweep_all.json'), json.dumps(rows, ensure_ascii=False, indent=1))
print('\n%-22s %8s %7s %8s %9s %9s %8s %8s %7s %8s' % (
    'variant', 'deaths150', 'cross3s', 'runPeak', 'leaderMax', 'giantAlv', 'giantLife', 'outer%', 'rank1', 'fill'))
for d in rows:
    print('%-22s %8s %7s %8s %9s %9s %8s %8s %7s %8s' % (
        d['_name'], d['difficulty']['deathsPer150s'], d['cross3s']['pct'],
        d['compete']['runPeakMean'], d['compete']['leaderMassMax'],
        d['size']['giantAliveMean'], d['giants']['lifeMeanS'],
        d['radial']['outerHeadPct'], d['compete']['rank1Frac'],
        d['size']['fillLenPerMunits2']))
