# -*- coding: utf-8 -*-
"""
광고 해금 «화이트리스트» 헤드리스 검증 — .ait 안 web/ 을 그대로 서빙해 «실제 코드 경로»로
「무엇이 광고로 열리고 무엇이 안 열리는가」를 잰다. (President 2026-09-01)

  python tools/verify_adunlock.py <file.ait>
  python tools/verify_adunlock.py dist/web --dir

⛔ headless 전용 — 창을 띄우지 않는다(President 화면 점유 금지).
⛔ 외부 네트워크 «전면 차단»(127.0.0.1 만 허용). 운영 광고 ID 가 박힌 번들을 로컬에서
   렌더하므로 실 광고 요청이 한 건도 나가지 않는다는 것이 전제다. 광고는
   `__coilAds.installStub()` 스텁으로만 돈다(qa_reward.py 와 같은 방식).

════════════════════════════════════════════════════════════════════════════
★이 검사기의 존재 이유 — 「0건」이 부재의 증거가 아니다
════════════════════════════════════════════════════════════════════════════
「블랙맘바에 광고 제안이 안 뜬다」는 «로직이 정상이어도, 로직이 통째로 죽어도»
똑같이 나오는 값이다. 토스 밖(usable=false)이면 «모든» 스킨이 안 뜬다. 그래서:

  · W0  양성대조를 «먼저» 통과시킨다 — 스텁을 꽂으면 하위 5종이 «실제로» 뜬다.
        이게 실패하면 아래 W3 의 초록불은 전부 무의미하다.
  · W1  기대 목록을 «손으로 안 박는다» — 페이지에서 전 스킨의 문턱을 읽어
        「문턱 있는 것 중 낮은 5개」를 «유도»해서 번들의 화이트리스트와 대조한다.
        박아 두면 소스가 바뀌어도 안 죽는 「죽은 검사기」가 된다.
  · W5  ★회수 금지 — 이미 광고로 블랙맘바를 연 기기에서 «보유가 유지되는가».
        차단만 보고 끝내면 기존 유저의 스킨을 뺏고도 전항목 PASS 가 뜬다.
"""
import json
import os
import sys
import tempfile
import threading
import zipfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')

SAVE_KEY = 'king-snake.save'
REWARD_KEY = 'king-snake.reward.v1'
SKIN_AD_PLACEMENT = 'ait.v2.live.XXXXXXXXXXXXXXXX'  # reward/adGroups.ts skinUnlock

# ★President 지시의 «수»만 박는다. «어느 스킨인가»는 W1 이 문턱에서 유도한다.
N_AD_UNLOCKABLE = 5
# 차단돼야 하는 것들. mamba 는 프로모션 대상이라 1순위, 나머지는 그 위 등급.
MUST_BLOCK = ['rattlesnake', 'mamba', 'kingcobra', 'albino']

errs = []
external = []


def eq(a, b, m):
    ok = a == b
    print(('  PASS  ' if ok else '  FAIL  ') + m + ('' if ok else f'   expected {b!r}, got {a!r}'))
    if not ok:
        errs.append(f'{m}: expected {b!r}, got {a!r}')
    return ok


def extract_web(ait):
    d = tempfile.mkdtemp(prefix='ks_adwl_web_')
    z = zipfile.ZipFile(ait)
    n = 0
    for name in z.namelist():
        if name.startswith('web/') and not name.endswith('/'):
            p = os.path.join(d, name[4:])
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'wb') as f:
                f.write(z.read(name))
            n += 1
    assert n > 0, '.ait 안에 web/ 가 없다'
    return d


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve(root):
    srv = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=root))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}/'


UI_JS = r"""
window.__wl = {
  /* 광고 배지가 «실제로 붙은» 카드 수. 로직이 아니라 DOM 을 센다. */
  adBadges: () => document.querySelectorAll('.skin.is-ad').length,
  /* 카드 하나의 «보이는 상태». 눌리는가 · 잠금칸에 뭐가 적혔나 · 배지가 있나. */
  card: (id, ids) => {
    const i = ids.indexOf(id);
    const b = document.querySelectorAll('.skin-rail .skin')[i];
    if (!b) return null;
    const lock = b.querySelector('.lock');
    const badge = b.querySelector('.skin-ad');
    return {
      disabled: b.disabled === true,
      isAd: b.classList.contains('is-ad'),
      badgeShown: !!badge && badge.hidden === false,
      lock: lock ? lock.textContent : null,
      aria: b.getAttribute('aria-label'),
      pressed: b.getAttribute('aria-pressed'),
    };
  },
  tapCard: (id, ids) => {
    const i = ids.indexOf(id);
    const b = document.querySelectorAll('.skin-rail .skin')[i];
    if (!b) return 'nocard';
    b.click();
    return b.disabled ? 'disabled' : 'clicked';
  },
};
"""


def save_blob(best=0, games=0, skin='corn'):
    return json.dumps({'v': 1, 'savedAt': 1, 'bestScore': best, 'bestRank': 999, 'games': games,
                       'totalKills': 0, 'playSeconds': 0, 'nick': '', 'skin': skin,
                       'control': 'joystick', 'sound': False, 'locale': 'ko'})


def new_page(browser, url, ls=None, query='?debug=1&quiet=1&seed=7'):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True,
                              has_touch=True, device_scale_factor=2, locale='ko-KR')
    ctx.route('**/*', lambda route: (
        route.continue_() if '127.0.0.1' in route.request.url or route.request.url.startswith('data:')
        else (external.append(route.request.url), route.abort())[1]))
    page = ctx.new_page()
    console = []
    page.on('console', lambda m: console.append((m.type, m.text)) if m.type == 'error' else None)
    page.on('pageerror', lambda e: console.append(('pageerror', str(e))))
    seed = 'try{localStorage.clear();'
    for k, v in (ls or {}).items():
        seed += f'localStorage.setItem({json.dumps(k)}, {json.dumps(v)});'
    seed += '}catch(e){}'
    page.add_init_script(seed)
    page.add_init_script(UI_JS)
    page.goto(url + query, wait_until='load')
    page.wait_for_function('window.__coil && window.__coilReward', timeout=20000)
    page.evaluate(UI_JS)
    page.evaluate('window.__coil.toMenu()')
    page.wait_for_timeout(200)
    return ctx, page, console


def stub_on(page):
    """토스 안 = 리워드 광고 «가용». 이게 없으면 모든 스킨이 안 뜬다(음성대조 값).

    ⚠️installStub «뒤에» window.__coilAdCalls 를 새 객체로 덮어쓰면 안 된다 —
      스텁 클로저가 원래 객체를 붙잡고 있어서 그 뒤 호출이 «옛 객체»에 쌓이고,
      ids 가 늘 비어 「광고 요청 0건」이 «로직과 무관하게» PASS 로 나온다.
      (qa_reward.py R6 주석의 함정과 같은 것.) 그래서 여기선 덮어쓰지 않고
      호출 검사는 «구간 슬라이스»로 센다.
    """
    page.evaluate('window.__coilAds.reset()')
    page.evaluate("window.__coilAds.installStub({load:'ok', show:'reward', supported:true})")
    page.evaluate('window.__coilReward.refresh()')
    page.wait_for_timeout(120)


def can(page, sid):
    return page.evaluate(f"window.__coilReward.canAdUnlockSkin({json.dumps(sid)})")


def main():
    target = sys.argv[1]
    if '--dir' in sys.argv:
        root = os.path.abspath(target)
    else:
        root = extract_web(target)
    srv, url = serve(root)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # ══ W0 대조 — 계측기가 살아 있는가 ═════════════════════════════════
        print('\n[W0] 대조 (이게 실패하면 아래 전부 무의미)')
        ctx, page, con = new_page(browser, url, ls={SAVE_KEY: save_blob(best=0)})
        st = page.evaluate('window.__coilReward.state()')
        all_skins = st['allSkins']
        ids = [s['id'] for s in all_skins]
        eq(can(page, 'milk'), False, 'W0-a 음성대조: 스텁 없으면(토스 밖) 하위 스킨도 «안» 열린다')
        eq(page.evaluate('window.__wl.adBadges()'), 0, 'W0-b 음성대조: 광고 배지 0개')
        stub_on(page)
        eq(can(page, 'milk'), True, 'W0-c ★양성대조: 스텁을 꽂으면 milk 가 «실제로» 열린다')
        eq(page.evaluate('window.__wl.adBadges()') > 0, True, 'W0-d ★양성대조: 광고 배지가 «실제로» 붙는다')

        # ══ W1 목록 자체 — «유도»한 기대값과 대조 ═══════════════════════════
        print('\n[W1] 화이트리스트 = 「문턱 있는 스킨 중 가장 낮은 5개」인가')
        paid = sorted([s for s in all_skins if s['unlockScore'] > 0], key=lambda s: s['unlockScore'])
        expect = [s['id'] for s in paid[:N_AD_UNLOCKABLE]]
        got = st['adUnlockable']
        eq(len([s for s in all_skins if s['unlockScore'] == 0]), 3, 'W1-a 기본(문턱 0) 스킨 3종')
        eq(got, expect, 'W1-b ★번들의 화이트리스트 = 문턱 하위 5종(코드에서 «유도»한 값)')
        eq(len(got), N_AD_UNLOCKABLE, 'W1-c 개수 5')
        eq(sorted(set(got) & set(MUST_BLOCK)), [], 'W1-d ★차단 대상이 목록에 «없다»')
        eq([s['unlockScore'] for s in paid[:N_AD_UNLOCKABLE]], [600, 1200, 2200, 3600, 5500],
           'W1-e 문턱 구간 600~5500')
        eq(next(s['unlockScore'] for s in all_skins if s['id'] == 'mamba'), 30000,
           'W1-f 블랙맘바 문턱 30000 (President 2026-09-03 상향) — 5500 에서 «두 단» 위')

        # ══ W2 하위 5종은 «정상 제안»된다 (1순위와 짝을 이루는 검사) ════════
        print('\n[W2] 하위 5종 = 정상 제안 · 정상 지급')
        for sid in expect:
            eq(can(page, sid), True, f'W2-{sid} 광고 제안 가능')
        c = page.evaluate("window.__wl.card('milk', %s)" % json.dumps(ids))
        eq(c['isAd'] and c['badgeShown'] and not c['disabled'], True,
           'W2-ui milk 카드: 광고 배지 «보임» · 누를 수 «있음»')
        eq(page.evaluate('window.__wl.adBadges()'), N_AD_UNLOCKABLE,
           'W2-count ★배지가 «정확히 5개» (bestScore=0 · 상한 미소진)')

        # ══ W3 ★1순위: 상위 4종에 제안이 «없다» ════════════════════════════
        print('\n[W3] ★1순위 — 블랙맘바·킹코브라·알비노·다이아몬드방울뱀')
        for sid in MUST_BLOCK:
            eq(can(page, sid), False, f'W3-{sid} ★광고 해금이 «제안되지 않는다»')
            c = page.evaluate('window.__wl.card(%s, %s)' % (json.dumps(sid), json.dumps(ids)))
            eq(c['isAd'], False, f'W3-{sid}-ui 광고 스타일 «없음»')
            eq(c['badgeShown'], False, f'W3-{sid}-ui 광고 배지 «안 보임»')
            eq(c['disabled'], True, f'W3-{sid}-ui ★죽은 버튼이 아니라 «disabled» — 눌러도 안 눌린다')
        c = page.evaluate("window.__wl.card('mamba', %s)" % json.dumps(ids))
        eq(c['lock'], '30,000', 'W3-lock ★블랙맘바 카드는 «필요 점수»를 보여준다(점수로만 열림)')
        eq('30,000' in (c['aria'] or ''), True, f"W3-aria 스크린리더도 점수로 안내: {c['aria']!r}")

        # ══ W4 뒷문 — 직접 호출해도 «안 열린다» ════════════════════════════
        print('\n[W4] 뒷문 차단 — UI 를 우회해 직접 호출')
        n0 = len(page.evaluate('window.__coilAdCalls.ids'))
        page.evaluate("window.__coilReward.unlockSkin('mamba')")
        page.wait_for_timeout(900)
        st4 = page.evaluate('window.__coilReward.state()')
        eq('mamba' in st4['adSkins'], False, 'W4-a ★직접 호출해도 해금 «안 됨»')
        eq(st4['used']['skinUnlock'], 0, 'W4-b 일일 상한도 «안» 깎임')
        eq(page.evaluate('window.__coilAdCalls.ids')[n0:], [],
           'W4-c ★광고 요청 자체가 «나가지 않았다»(지면 호출 0)')
        eq(page.evaluate("window.__wl.tapCard('mamba', %s)" % json.dumps(ids)), 'disabled',
           'W4-d 카드 탭도 disabled 라 콜백에 «닿지 않는다»')
        page.wait_for_timeout(300)
        eq('mamba' in page.evaluate('window.__coilReward.state().adSkins'), False,
           'W4-e 탭 뒤에도 해금 «없음»')

        # ══ W5 ★회수 금지 — 이미 광고로 블랙맘바를 연 기기 ═════════════════
        print('\n[W5] ★회수 금지 — 이미 광고로 블랙맘바를 연 기기')
        ctx.close()
        ctx, page, con5 = new_page(browser, url, ls={
            SAVE_KEY: save_blob(best=100, games=3),
            REWARD_KEY: json.dumps({'v': 1, 'day': '1999-01-01',
                                    'used': {'revive': 0, 'startBoost': 0, 'skinUnlock': 1, 'growth': 0},
                                    'skins': ['mamba']}),
        })
        stub_on(page)
        st5 = page.evaluate('window.__coilReward.state()')
        eq('mamba' in st5['adSkins'], True, 'W5-a ★보유 기록이 «그대로 있다»(원장 무접촉)')
        c = page.evaluate("window.__wl.card('mamba', %s)" % json.dumps(ids))
        eq(c['disabled'], False, 'W5-b ★카드를 «누를 수 있다»(보유 = 선택 가능)')
        eq(c['lock'], '', 'W5-c 잠금 표시 «없음»')
        eq(page.evaluate("window.__wl.tapCard('mamba', %s)" % json.dumps(ids)), 'clicked', 'W5-d 탭 성공')
        page.wait_for_timeout(250)
        c = page.evaluate("window.__wl.card('mamba', %s)" % json.dumps(ids))
        eq(c['pressed'], 'true', 'W5-e ★★실제로 «착용»된다(카드 aria-pressed) — 회수가 일어나지 않았다')
        eq(page.evaluate("document.querySelector('.skin-hero-name').textContent").strip(), '블랙맘바',
           'W5-e2 큰 미리보기도 블랙맘바로 바뀐다')
        eq(json.loads(page.evaluate(f'localStorage.getItem({json.dumps(SAVE_KEY)})'))['skin'], 'mamba',
           'W5-f 저장본에도 mamba 로 남는다')
        eq(can(page, 'mamba'), False, 'W5-g 그래도 «다시 팔지는 않는다»(보유 + 자격 밖)')
        eq([e for e in con5 if e[0] == 'pageerror'], [], 'W5-h 콘솔 에러 0')

        # ══ W6 DAILY_CAP 관계 — 5종을 며칠에 다 여는가 ═════════════════════
        print('\n[W6] 일일 상한(skinUnlock)과의 관계')
        ctx.close()
        ctx, page, con6 = new_page(browser, url, ls={SAVE_KEY: save_blob(best=0)})
        stub_on(page)
        cap = page.evaluate('window.__coilReward.state().skinCap')
        eq(cap, 3, 'W6-a DAILY_CAP.skinUnlock = 3 (번들에서 읽음)')
        opened = []
        for sid in expect:
            if not can(page, sid):
                break
            page.evaluate(f'window.__coilReward.unlockSkin({json.dumps(sid)})')
            page.wait_for_timeout(700)
            opened.append(sid)
        st6 = page.evaluate('window.__coilReward.state()')
        eq(len(opened), cap, f'W6-b 1일차에 «상한만큼»만 열린다: {opened}')
        eq(st6['used']['skinUnlock'], cap, 'W6-c 상한 소진')
        eq(page.evaluate('window.__wl.adBadges()'), 0, 'W6-d 상한 소진 후 광고 배지 «전부» 사라진다')
        eq(can(page, expect[3]), False, 'W6-e 4번째 스킨은 오늘 더 못 연다')
        # 「다음 날 같은 기기」 — ★reload 로는 못 만든다. add_init_script 가 «재실행»돼
        #   localStorage 를 다시 비우기 때문이다(이 검사기가 실제로 그렇게 틀렸다).
        #   1일차가 «실제로 남긴» 원장을 그대로 들고, day 만 과거로 밀어 새 컨텍스트에 심는다.
        ledger = json.loads(page.evaluate(f'localStorage.getItem({json.dumps(REWARD_KEY)})'))
        eq(sorted(ledger['skins']), sorted(opened), 'W6-e2 1일차 원장이 디스크에 남았다')
        ledger['day'] = '1999-01-01'
        ctx.close()
        ctx, page, con6b = new_page(browser, url, ls={
            SAVE_KEY: save_blob(best=0), REWARD_KEY: json.dumps(ledger),
        })
        con6 = con6 + con6b
        stub_on(page)
        st6b = page.evaluate('window.__coilReward.state()')
        eq(st6b['used']['skinUnlock'], 0, 'W6-f 날이 바뀌면 상한 초기화')
        eq(sorted(st6b['adSkins']), sorted(opened), 'W6-g 어제 연 스킨은 «영구» 보유')
        left = [s for s in expect if s not in opened]
        eq(page.evaluate('window.__wl.adBadges()'), len(left),
           f'W6-h 2일차에 남은 것은 {len(left)}종뿐 — 상한 3 보다 «적다»')
        for sid in left:
            page.evaluate(f'window.__coilReward.unlockSkin({json.dumps(sid)})')
            page.wait_for_timeout(700)
        st6c = page.evaluate('window.__coilReward.state()')
        eq(sorted(st6c['adSkins']), sorted(expect), 'W6-i ★2일이면 5종을 «전부» 연다')
        eq(page.evaluate('window.__wl.adBadges()'), 0, 'W6-j 더 열 것이 없어 배지 0개')
        eq(st6c['used']['skinUnlock'], len(left),
           f'W6-k 2일차 소비 {len(left)}회 — 상한 3 중 {cap - len(left)}회가 «남는다»(목록이 병목)')
        eq(can(page, 'mamba'), False, 'W6-l ★5종을 다 열어도 블랙맘바는 여전히 «안» 열린다')
        eq([e for e in con6 if e[0] == 'pageerror'], [], 'W6-m 콘솔 에러 0')

        ctx.close()
        browser.close()
    srv.shutdown()

    if external:
        errs.append('★외부 네트워크 요청 %d건: %s' % (len(external), sorted(set(external))[:5]))
    print()
    if errs:
        print('[verify_adunlock] FAIL %d' % len(errs))
        for e in errs:
            print('  - ' + e)
        return 1
    print('[verify_adunlock] PASS — 하위 5종 정상 제안 · 상위 4종 전면 차단 · 회수 0 · 외부요청 0건')
    return 0


if __name__ == '__main__':
    sys.exit(main())
