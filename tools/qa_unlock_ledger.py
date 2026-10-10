# -*- coding: utf-8 -*-
"""qa_unlock_ledger.py — ★이번 레인의 «1순위» 검사기. headless(창 0).

    python tools/qa_unlock_ledger.py <distdir> [--expect-nogrand]

═══ 무엇을 지키는가 ══════════════════════════════════════════════════════════
 President 지시로 해금 문턱을 올렸다(블랙맘바 12,000→30,000 / 킹코브라 18,000→50,000
 / 알비노 26,000→70,000). 그런데 `src/save.ts` 는 해금 목록을 «저장하지 않고»
 bestScore 에서 매번 «유도»한다. 그대로 두면
        최고점 20,847 로 블랙맘바를 딴 라이브 유저 → 20,847 < 30,000 → «회수»
 가 실제로 일어난다. 이 검사기는 그 회수가 «일어나지 않음»을 증명한다.

═══ 기대값을 «박지 않는다» ═══════════════════════════════════════════════════
 12000·30000·mamba 를 이 파일에 적으면, 문턱을 또 바꿨을 때 «옛 값을 통과시키는»
 죽은 검사기가 된다(auto-memory 「테스트가 틀린 값을 고정한다」).
 ⇒ 전부 `window.__coilUnlock.state()` 에서 «읽어» 대조한다:
      legacyScore[id]  = 옛 문턱(unlockLedger.ts LEGACY_UNLOCK_SCORE)
      unlockScore      = 새 문턱(game/skins.ts SKINS)
      ledgered/owned   = 실제 판정 결과
    「옛 문턱 < 새 문턱」인 스킨을 «찾아내서» 그 스킨으로 시나리오를 만든다.
    그런 스킨이 하나도 없으면 그것 자체를 FAIL 로 신고한다(= 상향이 안 된 것).

═══ 양성 대조 ═══════════════════════════════════════════════════════════════
 `--expect-nogrand` 는 «그랜드파더링을 뺀» 대조 빌드에 쓴다. 그 빌드에서는
 U1·U2 가 «반드시 FAIL» 해야 한다. FAIL 하지 않으면 이 검사기가 죽은 것이므로
 그때는 검사기 쪽을 FAIL 로 신고한다(0건은 부재의 증거가 아니다).
"""
import argparse
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright  # noqa: E402

SAVE_KEY = 'king-snake.save'
LEDGER_KEY = 'king-snake.unlock.v1'

results = []


def chk(ok, label, extra=''):
    key = label.split()[0]
    results.append((bool(ok), key, label, extra))
    print(('PASS ' if ok else 'FAIL ') + label + ((' | ' + str(extra)) if extra else ''), flush=True)
    return bool(ok)


# ★그랜드파더링(회수 금지)이 «있어야만» 통과하는 검사들.
#   양성 대조 빌드에서는 이 전부가 FAIL 해야 한다. 하나라도 PASS 면 대조가 죽은 것이다.
GRANDFATHER_KEYS = ['U1-b', 'U1-d', 'U1-e', 'U2', 'U5-b', 'U6-c']


def serve(d: Path):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(d), **k)

        def log_message(self, *a):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(('127.0.0.1', 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s.server_address[1], s


def make_save(best):
    return {'v': 1, 'savedAt': 1756400000000, 'bestScore': best, 'bestRank': 3, 'games': 41,
            'totalKills': 77, 'playSeconds': 5400, 'nick': '테스터', 'skin': 'corn',
            'control': 'drag', 'sound': True, 'locale': 'ko'}


def boot(pw, port, save=None, ledger=None):
    """저장본/원장을 «심고» 앱을 띄운 뒤 상태를 돌려준다."""
    # ★qa_render.py 와 «같은» 인자. 소프트웨어 렌더 헤드리스에서는 블룸 FBO 가
    #   만들어지지 않아 render/post.ts 가 'fbo incomplete' 를 던진다 — 코드 회귀가
    #   아니라 GPU 부재 아티팩트다. ANGLE 을 켜면 안 난다(창은 여전히 0).
    b = pw.chromium.launch(headless=True, args=['--enable-gpu', '--use-gl=angle'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                        is_mobile=True, has_touch=True, locale='ko-KR')
    init = []
    if save is not None:
        init.append('localStorage.setItem(%s, %s);' % (
            json.dumps(SAVE_KEY), json.dumps(json.dumps(save, ensure_ascii=False))))
    if ledger is not None:
        init.append('localStorage.setItem(%s, %s);' % (
            json.dumps(LEDGER_KEY), json.dumps(json.dumps(ledger))))
    if init:
        ctx.add_init_script('\n'.join(init))
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    cons = []
    page.on('console', lambda m: cons.append((m.type, m.text)))
    page.goto('http://127.0.0.1:%d/?debug=1&ads=off&seed=1' % port, wait_until='load')
    page.wait_for_function('() => !!window.__coilUnlock', timeout=15000)
    page.wait_for_timeout(400)
    st = page.evaluate('() => window.__coilUnlock.state()')
    ui = page.evaluate("""() => {
      const ids = window.__coilUnlock.state().skins.map(s => s.id);
      const cells = [...document.querySelectorAll('.skin-rail .skin-cell')];
      const out = {};
      cells.forEach((c, i) => {
        const b = c.querySelector('.skin');
        if (!b || !ids[i]) return;
        out[ids[i]] = {
          disabled: !!b.disabled,
          isInfo: b.classList.contains('is-info'),
          isAd: b.classList.contains('is-ad'),
          lock: (b.querySelector('.lock')?.textContent || '').trim(),
          aria: b.getAttribute('aria-label') || '',
        };
      });
      return { cards: out, heroSub: document.querySelector('.skin-hero-sub')?.textContent || '' };
    }""")
    promo = page.evaluate("() => (window.__coilPromo ? window.__coilPromo.owns() : null)")
    ledger_raw = page.evaluate('() => localStorage.getItem(%s)' % json.dumps(LEDGER_KEY))
    ctx.close()
    b.close()
    # 'fbo incomplete' = 헤드리스 GPU 부재 아티팩트(위 launch 주석). 회귀가 아니다.
    errs = [e for e in errs if 'fbo incomplete' not in e]
    return {'state': st, 'ui': ui, 'errors': errs, 'promoOwns': promo,
            'ledgerRaw': json.loads(ledger_raw) if ledger_raw else None,
            'consoleErrors': [t for (k, t) in cons if k == 'error']}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dist')
    ap.add_argument('--expect-nogrand', action='store_true')
    a = ap.parse_args()
    dist = Path(a.dist).resolve()
    port, srv = serve(dist)
    nogrand = a.expect_nogrand

    with sync_playwright() as pw:
        # ── U0 기준: 「옛 문턱 < 새 문턱」인 스킨을 «찾는다» ────────────────────
        base = boot(pw, port, save=make_save(0))
        chk(not base['errors'], 'U0-a 부팅 오류 0', base['errors'])
        st0 = base['state']
        chk(st0['bound'] != nogrand, 'U0-b 원장이 game/skins.ts 에 «주입»돼 있다',
            'bound=%s' % st0['bound'])

        raised = [s for s in st0['skins']
                  if s['legacyScore'] is not None and s['unlockScore'] is not None
                  and s['unlockScore'] > s['legacyScore']]
        chk(len(raised) > 0, 'U0-c 문턱이 «올라간» 스킨이 존재한다(없으면 상향 자체가 안 된 것)',
            [(s['id'], s['legacyScore'], s['unlockScore']) for s in raised])
        if not raised:
            print('\nRESULT: FAIL (기준 스킨 없음)')
            srv.shutdown()
            sys.exit(1)

        # 가장 «낮은» 상향 스킨 = 블랙맘바 자리. 시나리오를 여기서 유도한다.
        target = min(raised, key=lambda s: s['legacyScore'])
        tid = target['id']
        legacy = target['legacyScore']
        new = target['unlockScore']
        print('\n[기준 스킨] %s  옛 %d → 새 %d\n' % (tid, legacy, new))

        # ── U1 ★기존 유저: 옛 규칙으로 보유 중이던 최고점 ─────────────────────
        #   President 실기기 최고점 20,847 이 이 구간에 있다(12,000 ≤ x < 30,000).
        mid = (legacy + new) // 2
        best_real = 20847 if legacy <= 20847 < new else mid
        r1 = boot(pw, port, save=make_save(best_real))
        s1 = {s['id']: s for s in r1['state']['skins']}
        chk(not r1['errors'], 'U1-a 오류 0', r1['errors'])
        got = s1[tid]['owned']
        chk(got,
            'U1-b ★최고점 %d(옛 기준 보유) → «%s 여전히 보유»' % (best_real, tid),
            'owned=%s ledgered=%s (nogrand 대조=%s)' % (got, s1[tid]['ledgered'], nogrand))
        chk((best_real < new), 'U1-c 그 최고점은 «새 문턱에 못 미친다»(= 재계산이면 잠긴다)',
            '%d < %d' % (best_real, new))
        card = r1['ui']['cards'].get(tid, {})
        chk(not card.get('disabled', True),
            'U1-d ★실렌더: 카드가 «고를 수 있는» 상태다', card)
        chk(card.get('lock', 'x') == '',
            'U1-e ★실렌더: 카드에 «필요 점수»가 안 뜬다(= 잠금 표시 없음)', card.get('lock'))
        if not nogrand:
            chk(r1['promoOwns'] is not False,
                'U1-f 프로모션 보유 판정도 «보유»로 같이 움직인다(반쪽 상태 없음)',
                'promoOwns=%s' % r1['promoOwns'])
            nxt = r1['ui']['heroSub']
            chk(tid not in nxt and (str(new) not in nxt.replace(',', '')),
                'U1-g 「다음 스킨」 안내가 «이미 가진 것»을 목표로 그리지 않는다', nxt)

        # ── U2 ★경계: 옛 문턱 «정확히» ───────────────────────────────────────
        r2 = boot(pw, port, save=make_save(legacy))
        s2 = {s['id']: s for s in r2['state']['skins']}
        chk(s2[tid]['owned'],
            'U2 ★경계 최고점 %d(= 옛 문턱 정확히) → 보유 유지' % legacy,
            'owned=%s' % s2[tid]['owned'])

        # ── U2b 경계 «바로 아래»는 보유하면 «안 된다» (씨가 과하게 뿌려지지 않는가)
        r2b = boot(pw, port, save=make_save(legacy - 1))
        s2b = {s['id']: s for s in r2b['state']['skins']}
        chk(not s2b[tid]['owned'],
            'U2b 옛 문턱 -1(%d)은 «보유가 아니다» — 씨가 과하게 뿌려지지 않았다' % (legacy - 1),
            'owned=%s' % s2b[tid]['owned'])

        # ── U3 ★신규 유저: 저장 없음 ─────────────────────────────────────────
        r3 = boot(pw, port, save=None)
        s3 = {s['id']: s for s in r3['state']['skins']}
        free = [s['id'] for s in r3['state']['skins'] if s['unlockScore'] == 0]
        opened = [i for i, s in s3.items() if s['owned']]
        chk(not r3['errors'] and not r3['consoleErrors'],
            'U3-a ★신규 유저 부팅 오류 0(콘솔 포함)', (r3['errors'], r3['consoleErrors']))
        chk(sorted(opened) == sorted(free),
            'U3-b ★신규 유저는 «문턱 0 인 스킨만» 열려 있다', {'opened': opened, 'free': free})
        chk(r3['state']['bestScore'] == 0, 'U3-c 최고점 0', r3['state']['bestScore'])

        # ── U4 ★씨 뿌리기는 «한 번»뿐 ────────────────────────────────────────
        #   이미 씨를 뿌린(seeded) 원장 + 높은 최고점 → «옛 문턱으로 다시 뿌리면 안 된다».
        seeded_empty = {'v': 1, 'seeded': True, 'seededAt': 1, 'score': free, 'ads': []}
        r4 = boot(pw, port, save=make_save(best_real), ledger=seeded_empty)
        s4 = {s['id']: s for s in r4['state']['skins']}
        chk(not s4[tid]['owned'],
            'U4 ★이미 씨를 뿌린 기기에서는 옛 문턱으로 «다시» 열리지 않는다(뒷문 없음)',
            'owned=%s ledger=%s' % (s4[tid]['owned'], r4['state']['ledger']['score']))

        # ── U5 ★단조 증가: 저장이 날아가도 원장은 남는다 ──────────────────────
        keep = r1['ledgerRaw']
        chk(keep is not None and tid in keep.get('score', []),
            'U5-a 원장이 디스크에 실제로 적립됐다', keep)
        if keep:
            r5 = boot(pw, port, save=None, ledger=keep)   # 저장본 «유실» 재현
            s5 = {s['id']: s for s in r5['state']['skins']}
            chk(s5[tid]['owned'],
                'U5-b ★저장본이 통째로 날아가도 원장이 남아 «보유 유지»',
                'owned=%s best=%s' % (s5[tid]['owned'], r5['state']['bestScore']))
            # 손상된 원장(배열이 아닌 값)에도 죽지 않는다
            r5c = boot(pw, port, save=make_save(0), ledger={'v': 1, 'seeded': 'x', 'score': 3, 'ads': None})
            chk(not r5c['errors'], 'U5-c 손상된 원장에도 부팅 오류 0', r5c['errors'])

        # ── U6 새 문턱이 «실제로» 적용된다 ───────────────────────────────────
        #   ⚠검사기 정정(2026-09-03): 처음엔 저장본만 심고 「높은 문턱은 잠겨 있다」를
        #     봤는데 FAIL 이 났다. 원인은 코드가 아니라 «검사가 틀린» 것이었다 —
        #     최고점 30,000 은 «옛 기준으로» 킹코브라(18,000)도 넘으므로 씨 뿌리기가
        #     그것까지 정당하게 적립한다. 그게 회수 금지의 정의다.
        #   ⇒ 「새 문턱이 적용되는가」는 «씨를 이미 뿌린»(= 소급분이 없는) 기기에서
        #     봐야 한다. 그래야 옛 문턱이 개입하지 않는다.
        seeded_free = {'v': 1, 'seeded': True, 'seededAt': 1, 'score': free, 'ads': []}
        r6 = boot(pw, port, save=make_save(new), ledger=seeded_free)
        s6 = {s['id']: s for s in r6['state']['skins']}
        chk(s6[tid]['owned'], 'U6-a 새 문턱 %d 을 넘기면 보유' % new, s6[tid]['owned'])
        higher = [s for s in raised if s['unlockScore'] > new]
        if higher:
            h = min(higher, key=lambda s: s['unlockScore'])
            chk(not s6[h['id']]['owned'],
                'U6-b 소급분이 없는 기기에서 그보다 높은 문턱(%s %d)은 «아직» 잠김'
                % (h['id'], h['unlockScore']), 'owned=%s' % s6[h['id']]['owned'])
        # U6-c ★소급분이 «있는» 기기에서는 같은 최고점으로 더 높은 것도 보유한다
        #       (= 회수 금지가 실제로 작동한다는 반대편 증거)
        r6c = boot(pw, port, save=make_save(new))
        s6c = {s['id']: s for s in r6c['state']['skins']}
        if higher:
            h = min(higher, key=lambda s: s['unlockScore'])
            legacy_h = h['legacyScore']
            chk(s6c[h['id']]['owned'] == (new >= legacy_h),
                'U6-c ★같은 최고점 %d 이라도 «옛 문턱 %d» 을 넘었으면 %s 는 보유가 유지된다'
                % (new, legacy_h, h['id']), 'owned=%s' % s6c[h['id']]['owned'])

        # ── U7 ③ 봇 최고급 착용 — 마릿수를 «유도»해 대조 ─────────────────────
        bots = st0['bots']
        expect = sum(1 for i in range(bots['count'])
                     if (i % bots['poolSize']) in bots['premiumSlots'])
        chk(bots['premiumWearing'] == expect and expect > 0,
            'U7 ③ 최고급 스킨을 입는 봇 = %d / %d 마리 (%.1f%%)'
            % (bots['premiumWearing'], bots['count'], 100.0 * expect / max(1, bots['count'])),
            bots)

    srv.shutdown()
    bad = [r for r in results if not r[0]]
    print('\n%d/%d PASS' % (len(results) - len(bad), len(results)))

    if not nogrand:
        print('RESULT:', 'PASS' if not bad else 'FAIL')
        sys.exit(0 if not bad else 1)

    # ── 양성 대조 모드 ────────────────────────────────────────────────────
    #   ★기대를 «반전하지 않는다». 정본과 «똑같은 검사»를 대조 빌드에 돌리고,
    #     「회수 금지가 있어야만 통과하는 검사들이 실제로 전부 무너졌는가」를 본다.
    #     (1차 시도에서 기대를 반전했다가 판정이 뒤죽박죽이 됐다 — 반전은
    #      「무엇이 실패했는지」를 지워 버린다.)
    got = {k: ok for (ok, k, _l, _e) in results}
    missed = [k for k in GRANDFATHER_KEYS if got.get(k) is not False]
    print('\n[양성 대조] 회수 금지 의존 검사 %d개' % len(GRANDFATHER_KEYS))
    for k in GRANDFATHER_KEYS:
        st = got.get(k)
        print('  %-6s %s' % (k, 'FAIL(정상 — 회수가 실제로 일어났다)' if st is False
                             else ('PASS(⚠비정상 — 회수가 «안» 일어났다)' if st is True else '없음')))
    ok = not missed
    print('\n대조 결과:', 'DETECTED (검사기가 살아 있다)' if ok
          else 'NOT DETECTED — 검사기가 죽었다: ' + ', '.join(missed))
    print('RESULT:', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
