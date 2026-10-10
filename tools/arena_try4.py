# -*- coding: utf-8 -*-
"""arena_try4.py — 「점수가 오히려 올랐다」의 «원인 하나»를 겨눈다. 창 0.

  실측(20시드 x 기준 플레이어 80판):
      라이브(-23)  한 판 최고점 중앙  590 · 생존 40.6초 · 1등 8/80
      최종(G0)                    1,114 · 생존 56.6초 · 1등 6/80
  1등은 어려워졌는데(리더보드 1위 5,448 → 9,739) «점수는 배로» 올랐다.
  President 는 「프로모션 달성이 어려워지는 게 맞다」고 했으므로 이건 반대 방향이다.

  원인: ⑦초거대(질량 2,000+ 가 1.47 → 6.40마리)가 죽을 때 뿌리는 «먹이 더미».
        config.ts 의 사망 드롭 표가 이미 「DEATH_DROP_RATIO «만»이 눈덩이를 만든다」고
        적어 두었다(2026-08-25 실측). 초거대가 4배 늘었으니 그 눈덩이도 4배가 된다.

  ★그런데 ratio 만 내리면 President 의 2026-08-25 지시(「큰 지렁이 죽이면 많이
    나와야지」)를 되돌리게 된다. 그래서 «알 개수를 보존»한다:
        count = min(DEATH_ORB_MAX, total / DEATH_ORB_VALUE)   (world.ts explode)
    ratio 와 DEATH_ORB_VALUE 를 «같은 비율»로 내리면 total/value 가 불변 ⇒ 알 개수가
    모든 질량에서 «정확히 같다». 보이는 것(알이 쏟아진다)은 그대로고 «얻는 질량»만 준다.

    python tools/arena_try4.py [--seeds 20] [--secs 180]
"""
import io, json, os, subprocess, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CFG = os.path.join(ROOT, 'src', 'game', 'config.ts')

R0, V0 = 0.76, 6.5


def pair(r):
    """ratio r 에 맞춰 알 개수가 보존되는 DEATH_ORB_VALUE."""
    return round(V0 * r / R0, 2)


VARIANTS = {}
for tag, r in [('H1_r68', 0.68), ('H2_r60', 0.60), ('H3_r52', 0.52)]:
    VARIANTS[tag] = [
        ('export const DEATH_DROP_RATIO = 0.76;',
         'export const DEATH_DROP_RATIO = %s;' % r),
        ('export const DEATH_ORB_VALUE = 6.5;',
         'export const DEATH_ORB_VALUE = %s;' % pair(r)),
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seeds', type=int, default=20)
    ap.add_argument('--secs', type=int, default=180)
    a = ap.parse_args()
    cfg0 = io.open(CFG, encoding='utf-8').read()
    out = os.path.join(ROOT, '_arena')
    rows = []
    try:
        for name, subs in VARIANTS.items():
            cfg = cfg0
            for o, n in subs:
                assert cfg.count(o) == 1, (name, o[:50], cfg.count(o))
                cfg = cfg.replace(o, n)
            io.open(CFG, 'w', encoding='utf-8').write(cfg)
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
            print('[%-8s] life=%5.1f peakMed=%5d peakMean=%5d rank1=%2d/%-3d | deaths150=%-5s '
                  'cross3s=%-4s massMax=%5d giantAlv=%.2f leaderMax=%d'
                  % (name, p['lifeMeanS'], p['peakMed'], p['peakMean'], p['everRank1'], p['runs'],
                     d['difficulty']['deathsPer150s'], d['cross3s']['pct'],
                     d['size']['massMax'], d['size']['giantAliveMean'],
                     d['compete']['leaderMassMax']), flush=True)
    finally:
        io.open(CFG, 'w', encoding='utf-8').write(cfg0)
        print('원복 완료')
    io.open(os.path.join(out, 'try4_all.json'), 'w', encoding='utf-8').write(
        json.dumps(rows, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
