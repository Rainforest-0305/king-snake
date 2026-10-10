# -*- coding: utf-8 -*-
"""build_nograndfather.py — ★양성 대조 빌드. 「그랜드파더링을 «뺀»」 dist 를 만든다.

    python tools/build_nograndfather.py       →  dist_nograndfather/

  왜: qa_unlock_ledger.py 가 23/23 PASS 했다는 사실만으로는 «검사가 살아 있다»가
  증명되지 않는다(「0건은 부재의 증거가 아니다」). 회수 방지를 실제로 빼면
  U1-b/U1-d/U1-e/U2/U5-b/U6-c 가 «반드시 FAIL» 해야 한다. 안 나면 검사기가 죽은 것이다.

  ★관문이 «둘»이다 — 1차 시도가 그것을 가르쳐 줬다.
    main.ts 의 주입만 껐더니 회수가 «안 일어났다». skins/skinUnlock.ts 의
    meetsSkinRequirement 가 원장을 «직접» 보고 있었기 때문이다.
    ⇒ 대조 빌드는 둘 다 꺼야 「문턱만 올린 빌드」가 된다. 그게 President 가
      두려워한 그 빌드이고, 이 스크립트가 만드는 것이다.
    ⇒ 부수 소득: 「보유 판정 경로가 둘」이라는 사실이 실측으로 확인됐다.
      새 경로를 또 만들면 이 대조가 다시 깨지므로, 그때 이 파일이 알려 줄 것이다.
"""
import io
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MAIN = os.path.join(ROOT, 'src', 'main.ts')
UNLOCK = os.path.join(ROOT, 'src', 'skins', 'skinUnlock.ts')
OUT = os.path.join(ROOT, 'dist_nograndfather')

PATCHES = [
    (MAIN,
     '  setUnlockLedger(isScoreLedgered);',
     '  setUnlockLedger(() => false); // 양성대조 전용'),
    (UNLOCK,
     '  if (isLedgered(skin.id)) return true;',
     '  if ((false as boolean) && isLedgered(skin.id)) return true; // 양성대조 전용'),
]

orig = {}
for f, old, _new in PATCHES:
    t = io.open(f, encoding='utf-8').read()
    if t.count(old) != 1:
        sys.exit('build_nograndfather: 패턴 불일치 %s / %r' % (f, old))
    orig[f] = t

try:
    for f, old, new in PATCHES:
        io.open(f, 'w', encoding='utf-8').write(orig[f].replace(old, new))
    subprocess.run(['npm', 'run', 'build:web'], cwd=ROOT, check=True, shell=True)
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    shutil.copytree(os.path.join(ROOT, 'dist'), OUT)
finally:
    for f in orig:
        io.open(f, 'w', encoding='utf-8').write(orig[f])
    subprocess.run(['npm', 'run', 'build:web'], cwd=ROOT, check=True, shell=True)

print('\n대조 빌드: %s  (원본 소스·dist 는 복원 완료)' % OUT)
