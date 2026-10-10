# -*- coding: utf-8 -*-
"""
광고 화이트리스트 «전/후» 실렌더 증거. headless 전용(창을 띄우지 않는다).

  python tools/shots_adwl.py <dist> <outdir> [--locale ko]

찍는 것 (390x844 @2, 모바일 세로 — 주 타깃):
  menu.png        메뉴 전체
  rail_low.png    스킨 레일 «앞»(하위 5종이 보이는 자리)
  rail_high.png   스킨 레일 «끝»(방울뱀·블랙맘바·킹코브라·알비노가 보이는 자리)
  ★같은 상태(bestScore=0 · 리워드 스텁 ON · 상한 미소진)에서 찍어야 전/후가 비교된다.
    상한을 쓴 채로 찍으면 「배지가 사라진 이유」가 화이트리스트인지 상한인지 구분이 안 된다.
"""
import json
import os
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')

SAVE_KEY = 'king-snake.save'


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main():
    dist = os.path.abspath(sys.argv[1])
    out = os.path.abspath(sys.argv[2])
    locale = sys.argv[sys.argv.index('--locale') + 1] if '--locale' in sys.argv else 'ko'
    os.makedirs(out, exist_ok=True)
    srv = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=dist))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{srv.server_address[1]}/?debug=1&quiet=1&seed=7'

    save = json.dumps({'v': 1, 'savedAt': 1, 'bestScore': 0, 'bestRank': 999, 'games': 0,
                       'totalKills': 0, 'playSeconds': 0, 'nick': '', 'skin': 'corn',
                       'control': 'joystick', 'sound': False, 'locale': locale})

    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)          # ⛔headless 고정
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                            is_mobile=True, has_touch=True, locale=locale + '-KR')
        page = ctx.new_page()
        page.add_init_script(
            'try{localStorage.clear();localStorage.setItem(%s,%s);}catch(e){}'
            % (json.dumps(SAVE_KEY), json.dumps(save)))
        page.goto(url, wait_until='load')
        page.wait_for_function('window.__coil && window.__coilReward', timeout=20000)
        page.evaluate("window.__coilAds.installStub({load:'ok', show:'reward', supported:true})")
        page.evaluate('window.__coilReward.refresh()')
        page.evaluate('window.__coil.toMenu()')
        page.wait_for_timeout(700)

        n = page.evaluate("document.querySelectorAll('.skin.is-ad').length")
        ids = page.evaluate(
            "Array.from(document.querySelectorAll('.skin.is-ad')).map(e=>e.getAttribute('aria-label'))")
        print('광고 배지 %d개: %s' % (n, ids))

        page.screenshot(path=os.path.join(out, 'menu.png'))
        rail = page.query_selector('.skin-rail')
        page.evaluate("document.querySelector('.skin-rail').scrollLeft = 0")
        page.wait_for_timeout(250)
        rail.screenshot(path=os.path.join(out, 'rail_low.png'))
        page.evaluate("const r=document.querySelector('.skin-rail'); r.scrollLeft = r.scrollWidth;")
        page.wait_for_timeout(400)
        rail.screenshot(path=os.path.join(out, 'rail_high.png'))
        page.screenshot(path=os.path.join(out, 'menu_high.png'))

        with open(os.path.join(out, 'state.json'), 'w', encoding='utf-8') as f:
            json.dump({'adBadges': n, 'badgeLabels': ids,
                       'whitelist': page.evaluate('window.__coilReward.state().adUnlockable'),
                       'canMamba': page.evaluate("window.__coilReward.canAdUnlockSkin('mamba')")},
                      f, ensure_ascii=False, indent=1)
        ctx.close()
        b.close()
    srv.shutdown()
    print('→', out)


if __name__ == '__main__':
    main()
