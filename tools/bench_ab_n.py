# -*- coding: utf-8 -*-
"""bench_ab_n.py — 「10·30·60마리」 스트레스 프레임을 «전/후 번갈아» 잰다. 창 0.

    python tools/bench_ab_n.py --a <before dist> --b dist [--ns 10,30,60] [--rounds 2] [--sec 45]

★ 왜 «번갈아»인가 — 실측이 가르쳐 준 것(2026-09-03):
  같은 빌드·같은 n 을 두 번 쟀는데 35.4 / 43.8 fps 가 나왔다(차이 24%).
  원인은 코드가 아니라 «다른 백그라운드 작업»이었다(밸런스 스윕이 같이 돌고 있었다).
  순차로 before 전부 → after 전부 를 재면 그 드리프트가 한쪽에만 실려
  「회귀」로 «보인다». 실제로 처음엔 n=30 이 -19% 회귀한 것처럼 나왔다.
  ⇒ A B A B 로 번갈아 재야 드리프트가 양쪽에 똑같이 실린다(perf_ab.py 와 같은 규율).
  ⇒ 이 검사를 돌릴 때는 «다른 잡을 띄우지 마라».

★ gfx_harness.py bench 를 그대로 호출한다(계측 로직을 두 벌 쓰지 않는다).
"""
import argparse
import json
import os
import re
import statistics
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def run(dist, label, n, sec, cpu):
    r = subprocess.run(
        [sys.executable, 'tools/gfx_harness.py', 'bench', dist, label,
         '--cpu', str(cpu), '--n', str(n), '--sec', str(sec)],
        cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    m = re.search(r'^\{.*"fps".*\}$', r.stdout, re.M)
    if not m:
        return None
    return json.loads(m.group(0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--a', required=True)
    ap.add_argument('--b', default='dist')
    ap.add_argument('--ns', default='10,30,60')
    ap.add_argument('--rounds', type=int, default=2)
    ap.add_argument('--sec', type=int, default=45)
    ap.add_argument('--cpu', type=int, default=4)
    a = ap.parse_args()
    ns = [int(x) for x in a.ns.split(',')]

    out = {}
    for n in ns:
        A, B = [], []
        for i in range(a.rounds):
            ra = run(a.a, 'AB_A%d_%d' % (n, i), n, a.sec, a.cpu)
            rb = run(a.b, 'AB_B%d_%d' % (n, i), n, a.sec, a.cpu)
            if ra:
                A.append(ra)
            if rb:
                B.append(rb)
            print('  n=%-3d round %d:  before %5.1f   after %5.1f'
                  % (n, i + 1, ra['fps'] if ra else -1, rb['fps'] if rb else -1), flush=True)
        if A and B:
            out[n] = {
                'beforeFps': round(statistics.median(x['fps'] for x in A), 2),
                'afterFps': round(statistics.median(x['fps'] for x in B), 2),
                'beforeP95': round(statistics.median(x['p95'] for x in A), 1),
                'afterP95': round(statistics.median(x['p95'] for x in B), 1),
                'beforeOver': round(statistics.median(x['over17_5_pct'] for x in A), 2),
                'afterOver': round(statistics.median(x['over17_5_pct'] for x in B), 2),
                'beforeSnakes': round(statistics.median(x['snakesDrawnMean'] for x in A), 1),
                'afterSnakes': round(statistics.median(x['snakesDrawnMean'] for x in B), 1),
                'beforeOrbs': round(statistics.median(x['orbsDrawnMean'] for x in A), 1),
                'afterOrbs': round(statistics.median(x['orbsDrawnMean'] for x in B), 1),
            }

    print('\n%-5s %10s %10s %8s %9s %9s %9s %9s'
          % ('n', 'before fps', 'after fps', 'delta', 'b p95', 'a p95', 'b>17.5%', 'a>17.5%'))
    for n, d in out.items():
        print('%-5d %10.2f %10.2f %+8.2f %9.1f %9.1f %9.2f %9.2f'
              % (n, d['beforeFps'], d['afterFps'], d['afterFps'] - d['beforeFps'],
                 d['beforeP95'], d['afterP95'], d['beforeOver'], d['afterOver']))
    print('\n(참고) 화면 안 평균 뱀/오브 수')
    for n, d in out.items():
        print('  n=%-3d 뱀 %.1f -> %.1f   오브 %.1f -> %.1f'
              % (n, d['beforeSnakes'], d['afterSnakes'], d['beforeOrbs'], d['afterOrbs']))
    with open(os.path.join(ROOT, '_arena', 'bench_ab_n.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
