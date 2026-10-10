# -*- coding: utf-8 -*-
"""arena_try.py — 상수 «한 줄 치환» 조합을 같은 시드로 재 본다. 창 0.

    python tools/arena_try.py --seeds 14 --secs 180 NAME:sub;sub  NAME2:sub

  sub 형식 = "FILE|찾을문자열|바꿀문자열"  (FILE = cfg | bots)
  ★패턴을 못 찾으면 «죽는다» — 조용히 아무것도 안 바꾸고 통과하면 죽은 스윕이다.
  ★원본은 finally 에서 반드시 되돌린다.
"""
import io, json, os, subprocess, sys, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FILES = {'cfg': os.path.join(ROOT, 'src', 'game', 'config.ts'),
         'bots': os.path.join(ROOT, 'src', 'game', 'bots.ts')}

ap = argparse.ArgumentParser()
ap.add_argument('--seeds', type=int, default=14)
ap.add_argument('--secs', type=int, default=180)
ap.add_argument('specs', nargs='+')
a = ap.parse_args()

orig = {k: io.open(v, encoding='utf-8').read() for k, v in FILES.items()}
out = os.path.join(ROOT, '_arena')
os.makedirs(out, exist_ok=True)
rows = []
try:
    for spec in a.specs:
        name, _, body = spec.partition(':')
        cur = dict(orig)
        for sub in [x for x in body.split(';') if x.strip()]:
            f, old, new = sub.split('|')
            if cur[f].count(old) != 1:
                raise SystemExit('arena_try: 패턴 불일치 [%s] %r count=%d'
                                 % (name, old, cur[f].count(old)))
            cur[f] = cur[f].replace(old, new)
        for k, v in FILES.items():
            io.open(v, 'w', encoding='utf-8').write(cur[k])
        subprocess.run(['npx', 'esbuild', 'tools/arena_entry.ts', '--bundle', '--format=esm',
                        '--platform=node', '--outfile=_arena/try.mjs', '--log-level=error'],
                       cwd=ROOT, check=True, shell=True)
        jf = os.path.join(out, 'try_%s.json' % name)
        r = subprocess.run(['node', 'tools/qa_arena.mjs', '_arena/try.mjs', '--seeds', str(a.seeds),
                            '--secs', str(a.secs), '--json', jf], cwd=ROOT, check=True,
                           capture_output=True, text=True)
        d = json.loads(r.stdout.strip().split('\n')[-1])
        d['_name'] = name
        rows.append(d)
        p = d['refPlayer']
        print('[%s] life=%.1f peakMed=%d peakMean=%d rank1=%d/%d | deaths150=%s cross3s=%s '
              'outer=%s massMax=%d giantAlv=%.2f botLife=%.1f'
              % (name, p['lifeMeanS'], p['peakMed'], p['peakMean'], p['everRank1'], p['runs'],
                 d['difficulty']['deathsPer150s'], d['cross3s']['pct'], d['radial']['outerHeadPct'],
                 d['size']['massMax'], d['size']['giantAliveMean'], d['giants']['botLifeMeanS']),
              flush=True)
finally:
    for k, v in FILES.items():
        io.open(v, 'w', encoding='utf-8').write(orig[k])
    print('원복 완료')
io.open(os.path.join(out, 'try_all.json'), 'w', encoding='utf-8').write(
    json.dumps(rows, ensure_ascii=False, indent=1))
