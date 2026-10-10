# -*- coding: utf-8 -*-
"""
프로모션 「블랙맘바 해금하기」 500원 «헤드리스 실행 검증» — .ait 안 web/ 을 그대로 서빙하고
토스 브릿지를 mock 해서 «실제 코드 경로»로 지급 호출을 센다. (2026-09-01)

  python tools/verify_promo_mamba.py <file.ait> [--mode canon|testonly]

⛔ headless 전용 — 창을 띄우지 않는다(President 화면 점유 금지).
⛔ 외부 네트워크를 «전부 차단»한다(127.0.0.1 만 허용). 운영 광고 ID 가 박힌 번들을
   로컬에서 렌더하므로, 실 광고 요청이 «한 건도» 나가지 않는다는 것이 전제다.
   리워드 광고는 `__coilAds.installStub()` 스텁으로만 돈다(qa_reward.py 와 같은 방식).

★검증 1순위 (President 2026-09-01)
  M0  «이미 달성한 기기»(bestScore 20000 → 블랙맘바 보유) → 부팅·판종료 후에도 지급 «0회».
  M0b «이미 달성한 기기 ②»(광고로 해금한 기록 king-snake.reward.v1.skins=['mamba']) → 0회.
  M1  «기준선 이후 새로 달성»(bestScore 0 → 12000 돌파 후 판 종료) → 지급 «1회», 코드·500 정확.
  M2  ★광고 해금 경로가 «막혔다»(2026-09-01 뒤집힘) → 광고로는 해금도 지급도 0회.
      + M2-ctl 양성대조(하위 스킨 milk 는 열린다) · M2b 기존 광고 해금자는 보유 유지.
  M3  이미 받은 기기(기록 있음) → 다시 달성해도 0회.
  M4  4113 → 1회 + viaAlreadyGranted.  M5 폴백 순서.  M6 토스 밖 → 0회·에러 0.
  M7  기준선은 «코드별» 키에 저장된다.
"""
import json
import os
import sys
import tempfile
import threading
import zipfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

sys.stdout.reconfigure(encoding='utf-8')  # cp949 콘솔에서 « » 가 깨져 죽는다
from playwright.sync_api import sync_playwright

CODE = '__PROMOTION_CODE__'
AMOUNT = 500
SKIN = 'mamba'
UNLOCK_SCORE = 30000  # President 2026-09-03 상향(12000 -> 30000). # game/skins.ts mamba.unlockScore — 아래에서 «페이지에서 읽어» 대조한다
# ★문턱을 «넘기는» 판의 질량. 20000 을 박아 뒀다가 문턱이 30,000 으로 오르자
#   M4·M5 가 「지급 0회」로 조용히 FAIL 했다(2026-09-03). 상수에서 «유도»한다.
PASS_MASS = UNLOCK_SCORE + 2000
SAVE_KEY = 'king-snake.save'
REWARD_KEY = 'king-snake.reward.v1'

MOCK_JS = r"""
(() => {
  const listeners = new Map();
  window.__mockCalls = [];
  if (!window.__mockKV) window.__mockKV = {};
  if (!window.__mockGrant) window.__mockGrant = { key: 'MOCKKEY1' };
  window.__GRANITE_NATIVE_EMITTER = { on(ev, cb) {
    if (!listeners.has(ev)) listeners.set(ev, []);
    listeners.get(ev).push(cb);
    return () => { const a = listeners.get(ev) || []; const i = a.indexOf(cb); if (i >= 0) a.splice(i, 1); };
  } };
  window.__CONSTANT_HANDLER_MAP = {};
  const emit = (ev, data) => {
    const em = window.__GRANITE_NATIVE_EMITTER;
    if (em && typeof em.emit === 'function') { try { em.emit(ev, data); } catch (e) {} return; }
    (listeners.get(ev) || []).slice().forEach((cb) => { try { cb(data); } catch (e) {} });
  };
  window.ReactNativeWebView = { postMessage(raw) {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    window.__mockCalls.push(m);
    if (m.type !== 'method') return;
    const fn = m.functionName, id = m.eventId, args = m.args || [];
    let res = null;
    if (fn === 'getStorageItem') res = (args[0] in window.__mockKV) ? window.__mockKV[args[0]] : null;
    else if (fn === 'setStorageItem') { window.__mockKV[args[0]] = args[1]; res = null; }
    else if (fn === 'grantPromotionReward' || fn === 'grantPromotionRewardForGame') {
      const g = window.__mockGrant;
      res = (g && g.__fn) ? (fn === 'grantPromotionReward' ? g.primary : g.legacy) : g;
      if (res === '__undefined__') res = undefined;
    }
    setTimeout(() => emit(`${fn}/resolve/${id}`, res), 5);
  } };
})();
"""


def extract_web(ait):
    d = tempfile.mkdtemp(prefix='ks_promo_web_')
    z = zipfile.ZipFile(ait)
    n_web = 0
    for n in z.namelist():
        if n.startswith('web/') and not n.endswith('/'):
            p = os.path.join(d, n[4:])
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'wb') as f:
                f.write(z.read(n))
            n_web += 1
    assert n_web > 0, '.ait 안에 web/ 가 없다'
    return d


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve(root):
    srv = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=root))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}/'


errs = []
external = []


def eq(a, b, m):
    if a != b:
        errs.append(f'{m}: expected {b!r}, got {a!r}')


def grants(page, code):
    allc = page.evaluate(
        "(window.__mockCalls||[]).filter(m=>m.type==='method'&&/^grantPromotionReward/.test(m.functionName))")
    return [c for c in allc if (((c.get('args') or [{}])[0] or {}).get('params') or {}).get('promotionCode') == code]


def save_blob(best=0, games=0):
    return json.dumps({'v': 1, 'savedAt': 1, 'bestScore': best, 'bestRank': 999, 'games': games,
                       'totalKills': 0, 'playSeconds': 0, 'nick': '', 'skin': 'corn',
                       'control': 'joystick', 'sound': False, 'locale': 'ko'})


def new_page(browser, url, ls=None, kv=None, grant=None, toss=True, query='?debug=1&quiet=1&ads=off&seed=7'):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    # ⛔ 외부 네트워크 전면 차단 — 운영 광고 ID 호출이 실제로 나가는 일을 구조적으로 막는다.
    ctx.route('**/*', lambda route: (
        route.continue_() if '127.0.0.1' in route.request.url or route.request.url.startswith('data:')
        else (external.append(route.request.url), route.abort())[1]))
    page = ctx.new_page()
    console = []
    page.on('console', lambda m: console.append((m.type, m.text)) if m.type == 'error' else None)
    page.on('pageerror', lambda e: console.append(('pageerror', str(e))))
    if toss:
        page.add_init_script(MOCK_JS)
    if kv is not None:
        page.add_init_script('window.__mockKV = ' + json.dumps(kv) + ';')
    if grant is not None:
        page.add_init_script('window.__mockGrant = ' + json.dumps(grant) + ';')
    seed = 'try{localStorage.clear();'
    for k, v in (ls or {}).items():
        seed += f'localStorage.setItem({json.dumps(k)}, {json.dumps(v)});'
    seed += '}catch(e){}'
    page.add_init_script(seed)
    page.goto(url + query, wait_until='load')
    page.wait_for_function("window.__coil && window.__coilReward", timeout=20000)
    page.wait_for_timeout(600)  # 기준선 확정(저장 왕복)
    return ctx, page, console


def start_and_die(page, mass=0):
    """실제 판을 시작해 죽인다 → onPlayerDied → recordRun → 프로모션 알림(«정상 경로»).

    mass>0 이면 그 질량까지 키운 뒤 죽는다 → 그 판의 점수 = floor(mass) 로 기록된다.
    ⇒ 「블랙맘바 해금 문턱(12000)을 «판으로» 넘는다」를 실제 코드로 재현한다.
    """
    page.evaluate("window.__coil.toMenu()")
    page.wait_for_timeout(120)
    page.evaluate("window.__coil.startRun()")
    page.wait_for_function("window.__coil.state().mode === 'play'", timeout=6000)
    if mass > 0:
        page.evaluate(f"window.__coil.grow({mass})")
        page.wait_for_timeout(120)
    page.evaluate("window.__coil.kill()")
    page.wait_for_function("window.__coil.state().mode === 'dead'", timeout=8000)
    page.wait_for_timeout(800)


def record(page, code):
    raw = page.evaluate(f"localStorage.getItem({json.dumps('king-snake.promo.v1:' + code)})")
    return json.loads(raw) if raw else None


def main():
    ait = sys.argv[1]
    mode = sys.argv[sys.argv.index('--mode') + 1] if '--mode' in sys.argv else 'canon'
    code = CODE if mode == 'canon' else 'TEST_' + CODE
    root = extract_web(ait)
    srv, url = serve(root)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        if mode == 'testonly':
            # T0 — TESTONLY 는 «어떤 기기에서도 부팅 즉시» 지급돼야 한다
            #      (대상 스킨 corn = 항상 보유 + 기준선 규칙 무시). isTested 를 켜기 위한 빌드다.
            ctx, page, con = new_page(browser, url, ls={SAVE_KEY: save_blob(best=20000, games=40)})
            page.wait_for_timeout(900)
            g = grants(page, code)
            eq(len(g), 1, 'T0 ★TESTONLY: 기존 보유 기기에서도 부팅 즉시 grant 1회')
            if g:
                eq(g[0]['args'][0]['params']['promotionCode'], code, 'T0 코드 = TEST_ 접두')
                eq(g[0]['args'][0]['params']['amount'], AMOUNT, 'T0 금액 500')
            eq(con, [], 'T0 콘솔 에러 0')
            ctx.close()
            browser.close()
            srv.shutdown()
            if external:
                errs.append('★외부 네트워크 요청 %d건' % len(external))
            if errs:
                print('[verify_promo_mamba] FAIL %d (testonly)' % len(errs))
                for e in errs:
                    print('  - ' + e)
                sys.exit(1)
            print('[verify_promo_mamba] PASS (testonly) T0 부팅 즉시 1회 · TEST_ 코드 · 500원 · 외부요청 0건')
            return

        # ── M0 ★이미 달성한 기기(점수 해금) ───────────────────────────────────
        ctx, page, con = new_page(browser, url, ls={SAVE_KEY: save_blob(best=20000, games=40)})
        rec = record(page, code)
        eq(bool(rec), True, 'M0 기준선 레코드 생성')
        eq((rec or {}).get('ownedAtBaseline'), True, 'M0 ★기준선에 이미 보유 → ownedAtBaseline=true')
        eq(len(grants(page, code)), 0, 'M0 ★부팅 → grant 0회')
        start_and_die(page)
        eq(len(grants(page, code)), 0, 'M0 ★판 종료 후에도 grant 0회(영구 미지급)')
        eq(con, [], 'M0 콘솔 에러 0')
        ctx.close()

        # ── M0b ★이미 달성한 기기(광고 해금 기록) ─────────────────────────────
        today = None
        ctx, page, con = new_page(browser, url, ls={
            SAVE_KEY: save_blob(best=100, games=3),
            REWARD_KEY: json.dumps({'v': 1, 'day': '1999-01-01',
                                    'used': {'revive': 0, 'startBoost': 0, 'skinUnlock': 1, 'growth': 0},
                                    'skins': [SKIN]}),
        })
        rec = record(page, code)
        eq((rec or {}).get('ownedAtBaseline'), True, 'M0b ★광고 해금 보유자도 ownedAtBaseline=true')
        start_and_die(page)
        eq(len(grants(page, code)), 0, 'M0b ★grant 0회')
        eq(con, [], 'M0b 콘솔 에러 0')
        ctx.close()
        del today

        # ── M1 ★기준선 이후 새로 달성(점수 12000 돌파) ────────────────────────
        ctx, page, con = new_page(browser, url, ls={SAVE_KEY: save_blob(best=0)})
        rec = record(page, code)
        eq((rec or {}).get('ownedAtBaseline'), False, 'M1 ★기준선 미보유')
        eq((rec or {}).get('code'), code, 'M7 ★기준선 레코드에 code 저장(코드별)')
        eq(len(grants(page, code)), 0, 'M1 부팅 → 0회')
        # 해금 문턱을 코드에서 읽어 그 값으로 최고점수를 세운다
        thr = page.evaluate("window.__coilPromo.unlockScore()")
        eq(thr, UNLOCK_SCORE, 'M1 블랙맘바 unlockScore 를 코드에서 읽음')
        eq(page.evaluate("window.__coilPromo.owns()"), False, 'M1 아직 미보유')
        # 문턱 «미만»으로 한 판 → 여전히 0회 (음성 대조)
        start_and_die(page, mass=thr - 1000)
        eq(page.evaluate("window.__coilPromo.owns()"), False, 'M1 문턱 미만 판 → 여전히 미보유')
        eq(len(grants(page, code)), 0, 'M1 ★문턱 미만 판 → grant 0회')
        # 문턱을 «넘는» 판 → 지급
        start_and_die(page, mass=thr + 50)
        eq(page.evaluate("window.__coilPromo.owns()"), True, 'M1 ★문턱 돌파 → 보유로 전이')
        g = grants(page, code)
        eq(len(g), 1, 'M1 ★판 종료 → grant «1회»')
        if g:
            eq(g[0]['functionName'], 'grantPromotionReward', 'M1 현행 API')
            eq(g[0]['args'][0]['params']['promotionCode'], code, 'M1 코드 정확')
            eq(g[0]['args'][0]['params']['amount'], AMOUNT, 'M1 금액 500')
        rec = record(page, code)
        eq(bool((rec or {}).get('grantedAt')), True, 'M1 지급 기록')
        eq((rec or {}).get('ownedAtBaseline'), False, 'M1 ★지급 뒤에도 기준선이 보존된다(병합 저장)')
        start_and_die(page)
        eq(len(grants(page, code)), 1, 'M1 다시 죽어도 여전히 1회(세션 락)')
        kv = page.evaluate('window.__mockKV')
        eq(bool(kv.get('king-snake.promo.v1:' + code)), True, 'M1 네이티브 Storage 에도 기록')
        eq(con, [], 'M1 콘솔 에러 0')
        ctx.close()

        # ── M2 ★광고 해금 «경로가 막혔는가» (2026-09-01 뒤집힘) ────────────────
        #   예전 M2 는 「광고로 블랙맘바를 열면 grant 1회」였다. 그 경로가 바로
        #   예산 5,000원(=10건)을 하루이틀에 비우는 구멍이라 President 지시로 닫혔다
        #   (game/skins.ts AD_UNLOCKABLE_SKIN_IDS). ⇒ 기대값이 «정반대»가 된다.
        #   ★양성대조를 «같이» 본다 — 스텁이 안 꽂히면 어떤 스킨도 안 열려서
        #     「mamba 안 열림」이 로직과 무관하게 PASS 로 나온다.
        ctx, page, con = new_page(browser, url, ls={SAVE_KEY: save_blob(best=0)},
                                  query='?debug=1&quiet=1&seed=7')
        page.evaluate("window.__coilAds.installStub({load:'ok', show:'reward', supported:true})")
        page.evaluate("window.__coilReward.refresh()")
        page.wait_for_timeout(200)
        eq(page.evaluate("window.__coilReward.canAdUnlockSkin('milk')"), True,
           'M2-ctl ★양성대조: 하위 스킨(milk)은 «실제로» 광고로 열린다')
        eq(page.evaluate(f"window.__coilReward.canAdUnlockSkin('{SKIN}')"), False,
           'M2 ★블랙맘바는 광고 해금이 «제안되지 않는다»')
        page.evaluate(f"window.__coilReward.unlockSkin('{SKIN}')")
        page.wait_for_timeout(1500)
        eq(page.evaluate(f"window.__coilReward.state().adSkins.indexOf('{SKIN}')>=0"), False,
           'M2 ★직접 호출해도 해금 «안 됨»')
        eq(len(grants(page, code)), 0, 'M2 ★★광고 경로로는 grant 가 «나가지 않는다»(예산 보호)')
        eq(page.evaluate("window.__coilPromo.owns()"), False, 'M2 여전히 미보유 = 점수 12,000 경로만 남았다')
        eq(con, [], 'M2 콘솔 에러 0')
        ctx.close()

        # ── M2b ★회수 금지 — 이미 광고로 연 사람은 «보유 그대로» ───────────────
        #   ownsPromoSkin() 의 「보유」 정의(점수 ‖ 광고)는 손대지 않았다. 제안만 막았다.
        ctx, page, con = new_page(browser, url, ls={
            SAVE_KEY: save_blob(best=100, games=3),
            REWARD_KEY: json.dumps({'v': 1, 'day': '1999-01-01',
                                    'used': {'revive': 0, 'startBoost': 0, 'skinUnlock': 1, 'growth': 0},
                                    'skins': [SKIN]}),
        }, query='?debug=1&quiet=1&seed=7')
        eq(page.evaluate("window.__coilPromo.owns()"), True,
           'M2b ★기존 광고 해금자는 «여전히 보유»(회수 0)')
        eq(page.evaluate(f"window.__coilReward.state().adSkins.indexOf('{SKIN}')>=0"), True,
           'M2b 광고 해금 원장이 그대로 남아 있다')
        eq(con, [], 'M2b 콘솔 에러 0')
        ctx.close()

        # ── M3 이미 받은 기기 ─────────────────────────────────────────────────
        ctx, page, con = new_page(browser, url, ls={SAVE_KEY: save_blob(best=0)}, kv=kv)
        start_and_die(page, mass=PASS_MASS)
        eq(len(grants(page, code)), 0, 'M3 ★이미 받은 기기 → 0회(already)')
        eq(con, [], 'M3 콘솔 에러 0')
        ctx.close()

        # ── M4 4113 ───────────────────────────────────────────────────────────
        ctx, page, con = new_page(browser, url, ls={SAVE_KEY: save_blob(best=0)},
                                  grant={'errorCode': '4113', 'message': 'dup'})
        start_and_die(page, mass=PASS_MASS)
        eq(len(grants(page, code)), 1, 'M4 4113 → 1회')
        eq((record(page, code) or {}).get('viaAlreadyGranted'), True, 'M4 viaAlreadyGranted 기록')
        ctx.close()

        # ── M5 폴백 ───────────────────────────────────────────────────────────
        ctx, page, con = new_page(browser, url, ls={SAVE_KEY: save_blob(best=0)},
                                  grant={'__fn': True, 'primary': '__undefined__', 'legacy': {'key': 'LEG'}})
        start_and_die(page, mass=PASS_MASS)
        eq([x['functionName'] for x in grants(page, code)],
           ['grantPromotionReward', 'grantPromotionRewardForGame'], 'M5 폴백 순서')
        eq((record(page, code) or {}).get('key'), 'LEG', 'M5 레거시 key 기록')
        ctx.close()

        # ── M6 토스 밖 ────────────────────────────────────────────────────────
        ctx, page, con = new_page(browser, url, ls={SAVE_KEY: save_blob(best=0)}, toss=False)
        eq(page.evaluate("typeof window.ReactNativeWebView"), 'undefined', 'M6 RN 없음')
        start_and_die(page, mass=PASS_MASS)
        eq(page.evaluate("typeof window.__mockCalls"), 'undefined', 'M6 브릿지 호출 경로 자체가 없다')
        eq((record(page, code) or {}).get('grantedAt'), None, 'M6 지급 기록 없음')
        eq(con, [], 'M6 콘솔 에러 0')
        ctx.close()
        browser.close()
    srv.shutdown()
    if external:
        errs.append(f'★외부 네트워크 요청이 시도됐다({len(external)}건): {sorted(set(external))[:5]}')
    if errs:
        print(f'[verify_promo_mamba] FAIL {len(errs)} ({mode})')
        for e in errs:
            print('  - ' + e)
        sys.exit(1)
    print(f'[verify_promo_mamba] PASS ({mode}) '
          f'M0/M0b 기존보유 0회 · M1 신규 점수해금 1회 · M2 ★광고해금 «차단»(지급 0) · '
          f'M2b 기존 광고해금자 보유 유지 · M3 already · M4 4113 · M5 폴백 · M6 토스밖 · 외부요청 0건')


if __name__ == '__main__':
    main()
