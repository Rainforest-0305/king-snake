# -*- coding: utf-8 -*-
"""arena_diff_report.py - _diff_260905/r_*.json 을 BASE 와 비교한다.

  판정: 기준 플레이어 생존시간 중앙값 '감소' = 난도 상승.
        보조: 한 판 최고점 중앙값 감소.
        경고: 동시 초거대 마릿수 '감소' = 09-03 실측대로 오히려 쉬워지는 신호.

  통계 두 가지를 «따로» 쓴다 (중요):
    · 짝지은 부호검정(pSign)  - BOOST_DRAIN / DEATH_DROP_RATIO 처럼 «월드 생성이
      동일한» 변경에만 유효하다. 생성 rng 소비가 같아 t=0 배치가 같기 때문.
    · Mann-Whitney U(pMW)     - FOOD_TARGET 처럼 «생성 rng 가 어긋나» 같은 시드라도
      판이 통째로 달라지는 변경에는 페어링이 무의미하다. 비대응 검정을 쓴다.
"""
import io
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, sys.argv[1] if len(sys.argv) > 1 else '_diff_260905')


def med(a):
    if not a:
        return 0.0
    b = sorted(a)
    n = len(b)
    return b[n // 2] if n % 2 else (b[n // 2 - 1] + b[n // 2]) / 2.0


def avg(a):
    return sum(a) / len(a) if a else 0.0


def sign_test(diffs, eps=1e-9):
    neg = sum(1 for d in diffs if d < -eps)
    pos = sum(1 for d in diffs if d > eps)
    n = neg + pos
    if n == 0:
        return 1.0
    k = min(neg, pos)
    p = sum(math.comb(n, i) for i in range(k + 1)) / (2.0 ** n) * 2
    return min(1.0, p)


def wilcoxon(diffs, eps=1e-9):
    """짝지은 부호순위 검정(양측, 정규근사). 부호검정보다 «크기»를 쓰므로 검정력이 높다."""
    d = [x for x in diffs if abs(x) > eps]
    n = len(d)
    if n < 8:
        return 1.0
    order = sorted(range(n), key=lambda i: abs(d[i]))
    ranks = [0.0] * n
    i = 0
    ties = 0
    while i < n:
        j = i
        while j + 1 < n and abs(d[order[j + 1]]) == abs(d[order[i]]):
            j += 1
        r = (i + j) / 2.0 + 1
        t = j - i + 1
        ties += t ** 3 - t
        for k in range(i, j + 1):
            ranks[order[k]] = r
        i = j + 1
    wp = sum(ranks[i] for i in range(n) if d[i] > 0)
    mu = n * (n + 1) / 4.0
    sd = math.sqrt(n * (n + 1) * (2 * n + 1) / 24.0 - ties / 48.0)
    if sd == 0:
        return 1.0
    z = (wp - mu) / sd
    return math.erfc(abs(z) / math.sqrt(2))


def boot_med_ci(a, b, iters=4000, seed=12345):
    """비대응 부트스트랩: median(a)-median(b) 의 95% 구간."""
    import random
    rng = random.Random(seed)
    out = []
    na, nb = len(a), len(b)
    for _ in range(iters):
        sa = [a[rng.randrange(na)] for _ in range(na)]
        sb = [b[rng.randrange(nb)] for _ in range(nb)]
        out.append(med(sa) - med(sb))
    out.sort()
    return out[int(0.025 * iters)], out[int(0.975 * iters)]


def mannwhitney(a, b):
    """양측 p (정규근사, 동순위 보정). a<b 인지 방향은 따로 본다."""
    n1, n2 = len(a), len(b)
    if not n1 or not n2:
        return 1.0
    allv = sorted([(v, 0) for v in a] + [(v, 1) for v in b])
    ranks = [0.0] * len(allv)
    i = 0
    ties = 0
    while i < len(allv):
        j = i
        while j + 1 < len(allv) and allv[j + 1][0] == allv[i][0]:
            j += 1
        r = (i + j) / 2.0 + 1
        t = j - i + 1
        ties += t ** 3 - t
        for k in range(i, j + 1):
            ranks[k] = r
        i = j + 1
    r1 = sum(ranks[k] for k in range(len(allv)) if allv[k][1] == 0)
    u1 = r1 - n1 * (n1 + 1) / 2.0
    mu = n1 * n2 / 2.0
    n = n1 + n2
    sd = math.sqrt((n1 * n2 / 12.0) * ((n + 1) - ties / float(n * (n - 1))))
    if sd == 0:
        return 1.0
    z = (u1 - mu) / sd
    return math.erfc(abs(z) / math.sqrt(2))


def load(name):
    f = os.path.join(OUT, 'r_%s.json' % name)
    return json.load(io.open(f, encoding='utf-8')) if os.path.exists(f) else None


def main():
    names = [x[2:-5] for x in sorted(os.listdir(OUT)) if x.startswith('r_') and x.endswith('.json')]
    base = load('BASE')
    if base is None:
        print('BASE 없음'); return
    order = ['NOOP', 'F2600', 'F2250', 'B14', 'B18', 'D066', 'D057']
    order += [n for n in names if n not in order and n != 'BASE']

    bref = {r['seed']: r for r in base['rows']['ref']}
    bseed = {r['seed']: r for r in base['rows']['perSeed']}
    blife = [r['lifeS'] for r in base['rows']['ref']]
    bpeak = [r['peak'] for r in base['rows']['ref']]

    print('=' * 118)
    print('BASE  refRun=%d  life med=%.1fs mean=%.1fs | peak med=%d mean=%d | giant=%.2f botMassMax=%d botLife=%.1fs food=%s'
          % (len(blife), med(blife), avg(blife), med(bpeak), avg(bpeak),
             base['size']['giantAliveMean'], base['size']['massMax'],
             base['giants']['botLifeMeanS'], base['meta']['foodTarget']))
    print('BASE  rank1도달=%.1f%%  사망시순위중앙=%d'
          % (100.0 * base['refPlayer']['everRank1'] / base['refPlayer']['runs'],
             base['refPlayer']['rankAtEndMed']))
    print('=' * 118)
    print('%-8s %8s %8s %8s %7s %7s %9s %8s %7s %7s %7s'
          % ('variant', 'lifeMed', 'lifeAvg', 'd%med', 'pSign', 'pMW', 'peakMed', 'd%',
             'pMW', 'rank1%', 'rankEnd'))
    print('-' * 118)
    for name in order:
        d = load(name)
        if d is None:
            continue
        vref = {r['seed']: r for r in d['rows']['ref']}
        common = [s for s in bref if s in vref]
        dl = [vref[s]['lifeS'] - bref[s]['lifeS'] for s in common]
        vlife = [r['lifeS'] for r in d['rows']['ref']]
        vpeak = [r['peak'] for r in d['rows']['ref']]
        ml, mb = med(vlife), med(blife)
        pk, pb = med(vpeak), med(bpeak)
        rp = d['refPlayer']
        print('%-8s %8.1f %8.1f %+7.1f%% %7.3f %7.3f %9d %+7.1f%% %7.3f %6.1f%% %7d'
              % (name, ml, avg(vlife), 100 * (ml - mb) / mb if mb else 0,
                 sign_test(dl), mannwhitney(vlife, blife),
                 pk, 100 * (pk - pb) / pb if pb else 0, mannwhitney(vpeak, bpeak),
                 100.0 * rp['everRank1'] / rp['runs'], rp['rankAtEndMed']))
    print('-' * 118)
    print('* lifeMed/peakMed = 기준 플레이어 중앙값. d% 는 BASE 대비.')
    print('* pSign = 짝지은 부호검정(월드 생성이 같은 변경에만 유효 - BOOST/DEATH 계열).')
    print('* pMW   = Mann-Whitney U 비대응(생성 rng 가 어긋나는 FOOD 계열은 이쪽을 봐라).')
    print('* giant(giantAliveMean) 가 «줄면» 09-03 실측대로 오히려 쉬워지는 신호다.'
          .replace('«', '<').replace('»', '>'))

    n = load('NOOP')
    if n is not None:
        b2 = {k: v for k, v in base.items() if k != 'meta'}
        n2 = {k: v for k, v in n.items() if k != 'meta'}
        print('\n[양성대조] NOOP vs BASE : 리포트 전체(meta 제외) 완전 동일 = %s'
              % (json.dumps(b2, sort_keys=True) == json.dumps(n2, sort_keys=True)))

    # ── 정밀 표 : 짝지은 부호순위(검정력↑) + 중앙값차 부트스트랩 95% 구간 ──────
    print('\n[정밀] 생존시간 — 짝지은 부호순위(pWil)·평균차·중앙값차 95%%CI (n=%d쌍)'
          % len(bref))
    print('%-8s %10s %8s %12s %22s' % ('variant', 'd_mean(s)', 'pWil', 'd_med(s)', '95%CI(중앙값차)'))
    for name in order:
        d = load(name)
        if d is None:
            continue
        vref = {r['seed']: r for r in d['rows']['ref']}
        common = [s for s in bref if s in vref]
        dl = [vref[s]['lifeS'] - bref[s]['lifeS'] for s in common]
        vlife = [r['lifeS'] for r in d['rows']['ref']]
        lo, hi = boot_med_ci(vlife, blife)
        print('%-8s %+10.2f %8.3f %+12.2f      [%+7.1f, %+7.1f]'
              % (name, avg(dl), wilcoxon(dl), med(vlife) - med(blife), lo, hi))

    if len(bseed) < 3:
        print('\n[봇 생태계] --refonly 실행이라 생략(생태계 표는 전체 실행 디렉터리에서 본다)')
        return
    print('\n[봇 생태계] 시드 페어드 (FOOD 계열은 참고만)')
    print('%-8s %10s %8s %12s %8s %10s' % ('variant', 'd_giant', 'pSign', 'd_botMassMax', 'pSign', 'd_botLife'))
    for name in order:
        d = load(name)
        if d is None:
            continue
        v = {r['seed']: r for r in d['rows']['perSeed']}
        com = [s for s in bseed if s in v]
        dg = [v[s]['giantAliveMean'] - bseed[s]['giantAliveMean'] for s in com]
        dm = [v[s]['massMax'] - bseed[s]['massMax'] for s in com]
        db = [v[s]['botLifeMean'] - bseed[s]['botLifeMean'] for s in com]
        print('%-8s %+10.2f %8.3f %+12.0f %8.3f %+10.2f'
              % (name, avg(dg), sign_test(dg), avg(dm), sign_test(dm), avg(db)))


if __name__ == '__main__':
    main()
