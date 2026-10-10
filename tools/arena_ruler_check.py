# -*- coding: utf-8 -*-
"""arena_ruler_check.py — 자를 고친 뒤 «옛 자가 옛 결과를 그대로 내는가»를 증명한다.

  _ruler_260905/r_V1CTRL.json  = BOOST_DRAIN 을 09-05 이전(10)으로 되돌리고 «자 v1» 로 측정
  _diff_pw_260905/r_BASE.json  = 09-05 오전, 같은 구성으로 «자 v1» 로 측정한 원본
  ⇒ 둘의 기준 플레이어 원자료가 «완전히 같아야» 한다. 다르면 하네스를 고치다 깨뜨린 것이다.
"""
import io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
old = json.load(io.open(os.path.join(ROOT, '_diff_pw_260905', 'r_BASE.json'), encoding='utf-8'))
new = json.load(io.open(os.path.join(ROOT, '_ruler_260905', 'r_V1CTRL.json'), encoding='utf-8'))

K = ['seed', 'k', 'q', 'lifeS', 'peak', 'died', 'cause', 'rankAtEnd']
a = [{k: r[k] for k in K} for r in old['rows']['ref']]
b = [{k: r[k] for k in K} for r in new['rows']['ref']]
print('[1] refRows 원자료  n=%d vs %d   완전 동일: %s' % (len(a), len(b), a == b))
if a != b:
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y:
            print('    첫 불일치 idx=%d\n      old=%s\n      new=%s' % (i, x, y))
            break

o, n = old['refPlayer'], new['refPlayer']
print('[2] 집계 비교 (자 v1)')
for k in ['runs', 'lifeMeanS', 'lifeMedS', 'peakMean', 'peakMed', 'peakP90',
          'everRank1', 'rank1Frac', 'rankAtEndMed']:
    ok = 'OK' if o[k] == n[k] else '<<< DIFF'
    print('    %-12s old=%-10s new=%-10s %s' % (k, o[k], n[k], ok))
print('    cause        old=%s  new=%s' % (o['cause'], n['cause']))

print('\n[3] 자 v1 이 실제로 부스트를 얼마나 썼나 (새로 붙인 계측기)')
print('    boostFrac=%s  boostMeanS=%s  (봇 기준선 0.159)'
      % (n.get('boostFrac'), n.get('boostMeanS')))

p = os.path.join(ROOT, '_ruler_260905', 'r_BASE.json')
if os.path.exists(p):
    d = json.load(io.open(p, encoding='utf-8'))['refPlayer']
    print('\n[4] 새 자 v2 · 새 베이스라인(라이브 BOOST_DRAIN=14)')
    print('    refVer=%s rushP=%s rushSc=%s fleeAt=%s' %
          (d['refVer'], d['rushP'], d['rushSc'], d['fleeAt']))
    print('    boostFrac=%.4f (봇 0.159) · boostMeanS=%.2f' % (d['boostFrac'], d['boostMeanS']))
    print('    life  med=%.1fs mean=%.1fs | peak med=%d mean=%d'
          % (d['lifeMedS'], d['lifeMeanS'], d['peakMed'], d['peakMean']))
    print('    rank1도달=%.1f%% · 사망시 순위중앙=%d · runs=%d'
          % (100.0 * d['everRank1'] / d['runs'], d['rankAtEndMed'], d['runs']))
    print('    사망원인 %s' % d['cause'])
