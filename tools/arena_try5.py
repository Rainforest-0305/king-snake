# -*- coding: utf-8 -*-
"""arena_try5.py — 「사람은 표적이 된다」 가중치를 «실측으로» 고른다. 창 0.

  난도 레버 4종(먹이·사망드롭·맵·가두리)이 전부 반대로 간 뒤 남은 마지막 손잡이다.
  근거는 src/game/bots.ts PLAYER_HUNT_BIAS 주석.

  ★판정 기준(둘 다 만족해야 채택):
    ① 기준 플레이어 생존이 라이브(-23, 40.6초) 쪽으로 내려온다
    ② cross3s 가 «악화되지 않는다» — 지난 레인에서 이 지표로 안을 기각한 이력
    ③ 「어렵다」와 「불가능하다」는 다르다: 생존이 라이브보다 «더» 짧아지면 과한 것이다

    python tools/arena_try5.py [--seeds 20] [--secs 180]
"""
import io, json, os, subprocess, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BOTS = os.path.join(ROOT, 'src', 'game', 'bots.ts')
OLD = 'export const PLAYER_HUNT_BIAS = 1.0;'

VALUES = [1.6, 2.4, 3.6]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seeds', type=int, default=20)
    ap.add_argument('--secs', type=int, default=180)
    a = ap.parse_args()
    bots0 = io.open(BOTS, encoding='utf-8').read()
    assert bots0.count(OLD) == 1, 'PLAYER_HUNT_BIAS 패턴을 못 찾았다'
    out = os.path.join(ROOT, '_arena')
    rows = []
    try:
        for v in VALUES:
            name = 'P%s' % str(v).replace('.', '')
            io.open(BOTS, 'w', encoding='utf-8').write(
                bots0.replace(OLD, 'export const PLAYER_HUNT_BIAS = %s;' % v))
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
            print('[bias %-4s] life=%5.1f peakMed=%5d peakMean=%5d rank1=%2d/%-3d rank#=%2d | '
                  'cross3s=%-4s massMax=%5d giantAlv=%.2f cause=%s'
                  % (v, p['lifeMeanS'], p['peakMed'], p['peakMean'], p['everRank1'], p['runs'],
                     p['rankAtEndMed'], d['cross3s']['pct'], d['size']['massMax'],
                     d['size']['giantAliveMean'], p['cause']), flush=True)
    finally:
        io.open(BOTS, 'w', encoding='utf-8').write(bots0)
        print('원복 완료')
    io.open(os.path.join(out, 'try5_all.json'), 'w', encoding='utf-8').write(
        json.dumps(rows, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
