# -*- coding: utf-8 -*-
"""arena_diff.py — 난도 상향 3건(먹이 밀도·부스트 소모·사망 드롭)을 «각각 단독으로»
   재는 A/B 드라이버. 창 0 (headless, node 프로세스만).

   설계 이유:
     · qa_arena.mjs 는 집계만 뱉는다 ⇒ 시드 페어링·부호검정이 «불가능»하다.
       그래서 원자료를 같이 뱉는 tools/qa_arena_paired.mjs 를 따로 만들었다
       (원본은 다른 검사기가 쓰고 있어 손대지 않는다).
     · config.ts 는 «한 번에 하나»만 존재할 수 있으므로, 번들을 «먼저 전부» 굽고
       (직렬) 그 다음 node 실행만 병렬(≤4)로 돌린다.

   실행:  python tools/arena_diff.py --seeds 20 --secs 180 --jobs 4
"""
import argparse
import concurrent.futures as cf
import io
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CFG = os.path.join(ROOT, 'src', 'game', 'config.ts')
OUT = os.path.join(ROOT, os.environ.get('DIFF_OUT', '_diff_260905'))

FOOD = 'export const FOOD_TARGET_BASE = 3000;'
DRAIN = 'export const BOOST_DRAIN = 14;'   # 2026-09-05 라이브가 14 로 바뀌었다
DROP = 'export const DEATH_DROP_RATIO = 0.76;'

# 이름 -> [(old, new), ...]   빈 리스트 = 무변경
VARIANTS = {
    'BASE':  [],
    # 양성대조 — 값은 같고 바이트만 다른 편집(esbuild 가 3000/3000.0 을 같게 낸다).
    'NOOP':  [(FOOD, 'export const FOOD_TARGET_BASE = 3000.0;')],
    # ★v1 재현 대조 — BOOST_DRAIN 을 09-05 이전(10)으로 되돌린 «옛 라이브».
    #   자 v1 로 돌리면 _diff_pw_260905/r_BASE.json 과 «완전히 같아야» 한다.
    'V1CTRL': [(DRAIN, 'export const BOOST_DRAIN = 10;')],
    'F2600': [(FOOD, 'export const FOOD_TARGET_BASE = 2600;')],
    'F2250': [(FOOD, 'export const FOOD_TARGET_BASE = 2250;')],
    'B10':   [(DRAIN, 'export const BOOST_DRAIN = 10;')],
    'B18':   [(DRAIN, 'export const BOOST_DRAIN = 18;')],
    'D066':  [(DROP, 'export const DEATH_DROP_RATIO = 0.66;')],
    'D057':  [(DROP, 'export const DEATH_DROP_RATIO = 0.57;')],
    'D086':  [(DROP, 'export const DEATH_DROP_RATIO = 0.86;')],
    'C_ALL': [(FOOD, 'export const FOOD_TARGET_BASE = 2250;'),
              (DRAIN, 'export const BOOST_DRAIN = 18;'),
              (DROP, 'export const DEATH_DROP_RATIO = 0.57;')],
}


def build_all(names):
    """config.ts 를 갈아 끼우며 번들만 «직렬»로 굽는다. 끝나면 반드시 원복."""
    # ★바이너리로 읽고 쓴다. 텍스트 모드로 왕복하면 CRLF 가 LF 로 «조용히» 바뀌어
    #   원복 후에도 파일이 전부 바뀐 것처럼 보인다(2026-09-05 실사고).
    cfg0 = io.open(CFG, 'rb').read()
    made = {}
    try:
        for name in names:
            cfg = cfg0
            for o, n in VARIANTS[name]:
                ob, nb = o.encode('utf-8'), n.encode('utf-8')
                assert cfg.count(ob) == 1, (name, o, cfg.count(ob))
                cfg = cfg.replace(ob, nb)
            io.open(CFG, 'wb').write(cfg)
            outfile = os.path.join(OUT, 'b_%s.mjs' % name)
            subprocess.run(
                ['npx', 'esbuild', 'tools/arena_entry.ts', '--bundle', '--format=esm',
                 '--platform=node', '--outfile=%s' % os.path.relpath(outfile, ROOT).replace('\\', '/'),
                 '--log-level=error'],
                cwd=ROOT, check=True, shell=True)
            made[name] = outfile
            print('[build] %-6s ok' % name, flush=True)
    finally:
        io.open(CFG, 'wb').write(cfg0)
        print('[build] config.ts 원복 완료(바이트 동일)', flush=True)
    return made


def run_one(name, bundle, seeds, secs, refonly=False, refruns=4, ref2=False, rushp=None):
    jf = os.path.join(OUT, 'r_%s.json' % name)
    cmd = ['node', 'tools/qa_arena_paired.mjs',
           os.path.relpath(bundle, ROOT).replace('\\', '/'),
           '--seeds', str(seeds), '--secs', str(secs),
           '--refruns', str(refruns), '--json', jf]
    if refonly:
        cmd.append('--refonly')
    # ★V1CTRL 은 «옛 자»로 돌려야 옛 결과와 비교가 된다. 이름으로 강제한다.
    if ref2 and name != 'V1CTRL':
        cmd.append('--ref2')
        if rushp is not None:
            cmd += ['--rushp', str(rushp)]
    subprocess.run(cmd, cwd=ROOT, check=True, capture_output=True, text=True)
    return name, jf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seeds', type=int, default=20)
    ap.add_argument('--secs', type=int, default=180)
    ap.add_argument('--jobs', type=int, default=4)
    ap.add_argument('--only', default='')
    ap.add_argument('--refonly', action='store_true')
    ap.add_argument('--refruns', type=int, default=4)
    ap.add_argument('--ref2', action='store_true')
    ap.add_argument('--rushp', type=float, default=None)
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    names = [x for x in a.only.split(',') if x] or list(VARIANTS)
    made = build_all(names)

    # NOOP 번들은 BASE 와 «파일 내용»부터 같아야 한다(1차 양성대조)
    if 'BASE' in made and 'NOOP' in made:
        b = io.open(made['BASE'], 'rb').read()
        n = io.open(made['NOOP'], 'rb').read()
        print('[noop] 번들 바이트 동일: %s' % (b == n), flush=True)

    with cf.ThreadPoolExecutor(max_workers=a.jobs) as ex:
        futs = [ex.submit(run_one, k, v, a.seeds, a.secs, a.refonly, a.refruns,
                          a.ref2, a.rushp) for k, v in made.items()]
        for f in cf.as_completed(futs):
            name, jf = f.result()
            print('[run] %-6s done' % name, flush=True)


if __name__ == '__main__':
    main()
