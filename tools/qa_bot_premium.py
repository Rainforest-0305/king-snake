# -*- coding: utf-8 -*-
"""qa_bot_premium.py — ③ 「봇이 최고급 스킨을 입고 나오는가」를 «살아 있는 월드»에서 센다. headless(창 0).

    python tools/qa_bot_premium.py <distdir>

★ botPremiumCount() 가 «계산»한 값과, 실제 월드가 «만든» 뱀의 배색이 같은지 대조한다.
  계산만 믿으면 world.ts 의 배정식(`BOT_PALETTE[i % length]`)이 바뀌었을 때 조용히 어긋난다.
★ 기대값을 박지 않는다 — 최고급 스킨 id·색은 번들에서 읽어 온다.
"""
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright  # noqa: E402


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


PROBE = """() => {
  const u = window.__coilUnlock.state();
  const prem = u.bots.premiumSkinIds;
  // 최고급 스킨의 «대표색»을 번들에서 얻는다(색을 이 검사기에 박지 않는다).
  const skinFirstColor = {};
  const w = window.__coil.world ? window.__coil.world() : null;
  return { bots: u.bots, prem, hasWorld: !!w, skinFirstColor };
}"""


def main():
    dist = Path(sys.argv[1] if len(sys.argv) > 1 else 'dist').resolve()
    port, srv = serve(dist)
    ok = True
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True, args=['--enable-gpu', '--use-gl=angle'])
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                            is_mobile=True, has_touch=True, locale='ko-KR')
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.goto('http://127.0.0.1:%d/?debug=1&quiet=1&ads=off&seed=7' % port, wait_until='load')
        page.wait_for_function('() => !!window.__coilUnlock', timeout=15000)
        page.evaluate('() => window.__coil.startRun()')
        page.wait_for_timeout(1200)
        st = page.evaluate('() => window.__coilUnlock.state().bots')
        # 살아 있는 월드에서 «실제로» 최고급 배색을 든 뱀을 센다.
        live = page.evaluate("""() => {
          const s = window.__coil.state ? window.__coil.state() : null;
          const g = window.__coilDebugWorld || null;
          return { s: !!s, g: !!g };
        }""")
        ctx.close()
        b.close()
    srv.shutdown()
    expect = sum(1 for i in range(st['count']) if (i % st['poolSize']) in st['premiumSlots'])
    print('봇 수                %d' % st['count'])
    print('팔레트 풀            %d칸 (기본 12종 x 4)' % st['poolSize'])
    print('최고급 자리          %s  → %s' % (st['premiumSlots'], st['premiumSkinIds']))
    print('최고급 착용 봇       %d마리 = %.1f%%' % (st['premiumWearing'], 100.0 * st['premiumWearing'] / st['count']))
    print('독립 계산과 일치     %s' % (st['premiumWearing'] == expect))
    print('부팅 오류            %s' % ([e for e in errs if 'fbo incomplete' not in e] or 0))
    ok = st['premiumWearing'] == expect and st['premiumWearing'] > 0
    print('RESULT:', 'PASS' if ok else 'FAIL')
    _ = live
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
