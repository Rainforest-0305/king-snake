# -*- coding: utf-8 -*-
"""verify_lane_a_ait.py — 제출용 «.ait 내부»를 직접 검사한다 (2026-09-10 레인 A).

  python tools/verify_lane_a_ait.py <file.ait>

★ 왜 필요한가: Codex 적대적 리뷰(2026-09-10 지적 3)가 「제출용 .ait 가 변경 전 패키지」임을 잡았다.
  `dist/` 를 검사해 놓고 «.ait 는 옛것»인 상태가 조용히 성립한다 — 검수에 나가는 것은 .ait 다.
  ⇒ 이 검사기는 zip 을 «열어» web/ 안 번들 문자열을 직접 센다.

★ 죽은 검사기 방지(2층):
  ① 양성대조 — 반드시 «있어야» 하는 문자열(전면형 지면 ID)이 0건이면 검사기가 죽은 것으로 보고 FAIL.
  ② 음성대조 — 존재하지 않는 가짜 ID 를 같은 방법으로 세어 0건인지 확인.
  ⛔`zipfile.extractall('/tmp/...')` 을 쓰지 않는다 — Git Bash 의 /tmp 가 아니라 C:\\tmp 로 풀려
    «빈 폴더를 grep» 한 실사고가 있다(_PROGRESS 레인 9 함정). 압축을 풀지 않고 read() 로 센다.
"""
from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path

for _st in (sys.stdout, sys.stderr):
    try:
        _st.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

# 있어야 하는 것 — 값은 콘솔·지시서의 «글자 그대로».
MUST = {
    'ait.v2.live.XXXXXXXXXXXXXXXX': ('전면형(라이브 유지)', 1),
    'ait.v2.live.XXXXXXXXXXXXXXXX': ('리워드 부활', 1),
    'ait.v2.live.XXXXXXXXXXXXXXXX': ('리워드 시작 부스트', 1),
    'ait.v2.live.XXXXXXXXXXXXXXXX': ('리워드 스킨 해금', 1),
    'ait.v2.live.XXXXXXXXXXXXXXXX': ('리워드 기록 돌파', 1),
    'ait.v2.live.XXXXXXXXXXXXXXXX': ('최고급 스킨 진행도', 1),
    'ait.v2.live.XXXXXXXXXXXXXXXX': ('★신설 결과 성장 2배', 1),
    '__PUSH_TEMPLATE_CODE__': ('★푸시 templateCode', 1),
    'intoss://moneyleague': ('★교차추천 딥링크', 1),
    'king-snake.carry.v1': ('이어받기 저장 키', 1),
    'king-snake.push.v1': ('푸시 저장 키', 1),
    'king-snake.xpromo.v1': ('교차추천 저장 키', 1),
}
# 없어야 하는 것.
MUST_NOT = {
    'ait.v2.live.XXXXXXXXXXXXXXXX': '★제거된 시작화면 배너 지면',
    'TESTONLY': 'TESTONLY 표식',
    'PROMO_IGNORE_BASELINE = true': '프로모션 기준선 무시 플래그',
    'ait.v2.test.': '테스트 지면 접두',
}
FAKE = 'ait.v2.live.XXXXXXXXXXXXXXXX'   # 음성대조용(존재할 리 없는 값)

# ★2026-09-10 추가 — 개인정보처리방침이 «실제로 빌드에 실렸는지».
#   Partner 지시: 「빌드에 안 실리는 실사고가 오늘만 3건 났다 — .ait 안에서 새 문구를 직접 확인해라」.
#   ⛔번들(js)과 «분리해» 센다. privacy.html 에도 저장 키가 적히므로 한 덩어리로 세면 개수가 어긋난다.
PRIVACY_NAME = 'privacy.html'
# ★기대 «횟수»는 en·ko 두 절을 «합친» 값이다. 이 문서는 한 파일에 영문·한글이 같이 있고, 표도 둘이다.
#   ⇒ 한 언어 기준으로 세면 전부 정확히 2배로 어긋난다(실측으로 걸렸다 — 이 검사기가 자기 기댓값 오류를 잡았다).
#   ⇒ 그리고 이 값이 «한쪽 언어만 갱신하는» 사고를 잡는 장치이기도 하다. 홀수가 나오면 한쪽이 빠진 것이다.
PRIVACY_MUST = {
    'king-snake.carry.v1': ('저장 항목 표 — 이어받기 (en 1 + ko 1)', 2),
    'king-snake.push.v1': ('저장 항목 표 — 알림 동의 (언어당 표 1 + 알림 절 1 + 미러 설명 1)', 6),
    'king-snake.xpromo.v1': ('저장 항목 표 — 교차추천 (en 1 + ko 1)', 2),
    'king-snake.save': ('저장 항목 표 — 세이브 블롭 (en 1 + ko 1)', 2),
    'king-snake.ads.v1': ('저장 항목 표 — 전면광고 간격 (언어당 표 1 + 미러 설명 1)', 4),
    # ★2026-09-10 -50: 접두 규칙을 «산문»에서 «표 행»으로 옮겼다(공용 감사기가 표에서 찾는다).
    #   그래서 언어당 1회 = 합 2회다. 산문에도 남겨 두면 2벌이 되어 세는 값이 흔들린다.
    'king-snake.promo.v1:': ('프로모션 접두 — 표 행 (en 1 + ko 1) · ★콜론까지가 키다', 2),
    '<!-- SDK-DECLARE: ads=on analytics=off rewardAds=on push=on -->':
        ('★기계 판독 고지 선언(공용 감사기가 읽는다) — 문서 전체에 «한 벌»만', 1),
    'king-snake.reward.v1': ('저장 항목 표 — 보상 원장 (en 1 + ko 1)', 2),
    'king-snake.adseq.v1': ('저장 항목 표 — 광고 이벤트 기록 (en 1 + ko 1)', 2),
    'king-snake.adwatch.v1': ('저장 항목 표 — 스킨 광고 시청 (en 1 + ko 1)', 2),
    'king-snake.unlock.v1': ('저장 항목 표 — 해금 스킨 (en 1 + ko 1)', 2),
    'id="lang-split"': ('언어 경계 표식(검사기가 en/ko 를 가른다)', 1),
    '<table class="keys">': ('저장 항목 «표» 자체 — en·ko 각 1', 2),
    '2026-09-10': ('최종 수정일 갱신', 2),
}
# 방침에 «남아 있으면 안 되는» 옛 거짓 문구(영문 절이 10일 넘게 거짓이었다).
PRIVACY_MUST_NOT = {
    'fully offline': '「완전 오프라인」 — 광고 지면 6개가 라이브다',
    'there is no ad SDK': '「광고 SDK 없음」 — 거짓',
    'None (fully offline)': '네트워크 요청 「없음」 — 거짓',
    '2026-08-18': '옛 최종 수정일',
}

UUID7 = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')


def main() -> int:
    if len(sys.argv) < 2:
        print('usage: python tools/verify_lane_a_ait.py <file.ait>')
        return 2
    p = Path(sys.argv[1]).resolve()
    if not p.exists():
        print('FAILED: 파일이 없다 —', p)
        return 1
    z = zipfile.ZipFile(p)
    names = z.namelist()
    web = [n for n in names if n.startswith('web/') and n.endswith(('.js', '.html', '.css'))]
    print(f'대상: {p}  ({p.stat().st_size:,} B)')
    print(f'zip 항목 {len(names)}개 · web 텍스트 {len(web)}개')
    if not web:
        print('FAILED: web/ 안에 검사할 텍스트가 없다 — 검사기가 죽었다(경로 규약이 바뀌었나)')
        return 1

    blob = ''
    privacy = ''
    privacy_path = ''
    for n in web:
        try:
            text = z.read(n).decode('utf-8', 'ignore')
        except Exception as e:  # noqa: BLE001
            print('  경고: 못 읽음', n, e)
            continue
        if n.endswith('/' + PRIVACY_NAME) or n.endswith(PRIVACY_NAME):
            privacy += text
            privacy_path = n
        else:
            blob += text

    fails = []
    print('\n[있어야 하는 것]')
    for s, (label, want) in MUST.items():
        got = blob.count(s)
        ok = got == want
        print(f"  {'PASS' if ok else '★FAIL'}  {label}: {got}회 (기대 {want})  {s}")
        if not ok:
            fails.append(f'{label} {got}!={want}')
    print('\n[없어야 하는 것]')
    for s, label in MUST_NOT.items():
        got = blob.count(s)
        ok = got == 0
        print(f"  {'PASS' if ok else '★FAIL'}  {label}: {got}회 (기대 0)  {s}")
        if not ok:
            fails.append(f'{label} {got}!=0')

    print('\n[개인정보처리방침 — .ait 안에 «실제로» 실렸나]')
    if not privacy:
        print('  ★FAIL  web/ 안에 privacy.html 이 없다 — 방침이 패키지에 «안 실렸다»')
        fails.append('privacy.html missing in .ait')
    else:
        print(f'  파일: {privacy_path}  ({len(privacy):,}자)')
        for s, (label, want) in PRIVACY_MUST.items():
            got = privacy.count(s)
            ok = got == want
            print(f"  {'PASS' if ok else '★FAIL'}  {label}: {got}회 (기대 {want})  {s}")
            if not ok:
                fails.append(f'privacy {label} {got}!={want}')
        for s, label in PRIVACY_MUST_NOT.items():
            got = privacy.count(s)
            ok = got == 0
            print(f"  {'PASS' if ok else '★FAIL'}  옛 문구 제거 — {label}: {got}회 (기대 0)  {s!r}")
            if not ok:
                fails.append(f'privacy stale {label} {got}!=0')
        # ★선언은 «한 벌»이어야 한다. 두 벌이면 공용 감사기가 첫 매치만 읽고 오판한다(스모 실사고).
        #   ⇒ 「선언 주석 1개」와 「선언 «토큰» 4개(= 그 한 줄 안의 키 4개)」를 «따로» 센다.
        #     산문이 옛 값을 인용하면 토큰 수가 4를 넘어 여기서 걸린다.
        n_decl = len(re.findall(r'<!--\s*SDK-DECLARE:', privacy))
        n_tok = len(re.findall(r'\b(?:ads|analytics|rewardAds|push)=', privacy))
        ok = n_decl == 1 and n_tok == 4
        print(f"  {'PASS' if ok else '★FAIL'}  선언 «한 벌» 규약: SDK-DECLARE 주석 {n_decl}개(기대 1) · "
              f"기계 판독 토큰 {n_tok}개(기대 4 = 그 한 줄 안의 키 넷)")
        if not ok:
            fails.append(f'privacy declare {n_decl}/{n_tok}')

        # 방침 «양성대조» — 반드시 있어야 하는 단언 문장이 실제로 잡히는지(파싱이 산 증거).
        claim_ko = privacy.count('다음이 전부입니다')
        claim_en = privacy.count('all of the following')
        ok = claim_ko >= 1 and claim_en >= 1
        print(f"  {'CAUGHT' if ok else '★MISSED'}  양성대조: 「다음이 전부입니다」/「all of the following」 단언이 문서에 «있다» "
              f"(ko {claim_ko} · en {claim_en})")
        if not ok:
            fails.append('privacy claim sentence missing')

    print('\n[대조]')
    # ① 양성: 라이브 전면형 ID 가 실제로 잡혔다(위 MUST 에서 확인) — 그 자체가 검사기 생존 증거다.
    live_ok = blob.count('ait.v2.live.XXXXXXXXXXXXXXXX') > 0
    print(f"  {'CAUGHT' if live_ok else '★MISSED'}  양성대조: 라이브 지면 문자열이 «실제로» 잡힌다")
    if not live_ok:
        fails.append('positive control missed')
    # ② 음성: 없는 값은 0건이어야 한다(있으면 세는 방법이 틀린 것).
    fake_ok = blob.count(FAKE) == 0
    print(f"  {'CAUGHT' if fake_ok else '★MISSED'}  음성대조: 없는 지면({FAKE}) 0건")
    if not fake_ok:
        fails.append('negative control missed')

    print('\n[deploymentId]')
    dep = None
    for n in names:
        if re.match(r'bundle\.(android|ios)\.', n):
            head = z.read(n)[:8000].decode('utf-8', 'ignore')
            m = UUID7.search(head)
            if m:
                dep = m.group(0)
                break
    print('  deploymentId:', dep or '(못 찾음)')
    if not dep:
        fails.append('deploymentId not found')

    print('\n' + ('RESULT: FAIL — ' + ', '.join(fails) if fails else 'RESULT: PASS'))
    return 1 if fails else 0


if __name__ == '__main__':
    raise SystemExit(main())
