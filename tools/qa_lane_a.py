# -*- coding: utf-8 -*-
"""qa_lane_a.py — 레인 A(2026-09-10) 검사기. ⛔headless 전용(President 화면 점유 금지).

  python tools/qa_lane_a.py [distDir] [--quick]      기본 dist · --quick 은 60초 체류 측정을 10초로 줄인다(개발용)

★ 무엇을 증명하나 (각 절마다 «양성대조»를 하나 이상 둔다 — 0건은 부재의 증거가 아니다)
  A  전면형 «요청 = 노출»: 빚(adPending) 없는 판 시작·부팅에서 로드 0 / 2판째 사망(빚)에서 로드 1 → 표시 1
     · 묵은 로드(TTL 30분) 는 안 띄우고 다시 받는다 · 백그라운드 복귀(onForeground) 재요청 · 숨김 중 요청 0
     · 결과 화면 100회 리렌더에도 요청 1 · 화면별 60초 체류 요청 수(메뉴·플레이·일시정지·결과)
  B  시작 화면 배너 «부재»: 훅·컨테이너·번들 지면 ID 0 · 기록↔설정 간격 12px(설치 전과 같다)
  C  결과 화면 「이번 판 성장 2배」 + 이어받기: 기본 몫(광고 없이) · 2배 지급 · 세션 1회 · 일 3회 · 날짜 롤오버
     · 다음 판 시작 질량 = START_MASS + 이어받기(부스트와 겹치면 길이 1.4배 위에) · 리워드 뒤 전면형 건너뛰기(빚 유지)
     · 부활 뒤 최종 사망에서 2배 유지 · 실패 경로(미시청)엔 지급 0
  P  토스 푸시 동의: 토스 밖 행·카드 «부재» / 토스 안(가짜 네이티브 브릿지) «진짜 SDK 코드»가 addEventListener 를 보내고
     templateCode 가 글자 그대로 · newAgreement→켜짐·네이티브 Storage 미러·재시작 복원 · rejected→다시 켜기 · onError 무사
     · 연속 탭 구독 1건 · 닫기 영속 · 스텁 경로 cleanup 1
  X  머니 리그 교차추천: 토스 안 하루 1회 · openURL 브릿지 args = intoss://moneyleague · 닫기 · 날짜 롤오버 · 토스 밖 0
  I  로케일·폭(ko/en × 375/390/430): 넘침 0 · raw i18n 키 0 · 보간 누락 0 · 이모지 0 · 터치 타깃 ≥ 44

★ 네이티브 브릿지 «흉내»(P·X 절): ReactNativeWebView.postMessage 감청 + __GRANITE_NATIVE_EMITTER 응답. Storage 3종은
  작동하는 미니 저장소(sessionStorage 에 백업 → 새로고침 뒤 «재시작 복원»을 실측). 광고는 __coilAds.installStub 스텁으로만 —
  운영 지면 ID 로 로컬 렌더 금지. 외부 네트워크는 route guard 로 «전부» 차단하고 0건을 확인한다.
"""
from __future__ import annotations

import http.server
import json
import math
import socketserver
import sys
import threading
import time
from pathlib import Path

for _st in (sys.stdout, sys.stderr):
    try:
        _st.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

sys.path.insert(0, r'C:/Users/USER/tools')
from safe_headless_browser import open_browser  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
DIST = Path(ARGS[0]).resolve() if ARGS else (ROOT / 'dist')
QUICK = '--quick' in sys.argv
DWELL_S = 10 if QUICK else 60
OUT = ROOT / '_lane_a_evidence_260910' / 'qa_lane_a'

# ★콘솔 값 «글자 그대로»(레인 파일). 검사기가 코드에서 읽은 값과 «둘 다» 대조한다 — 코드가 오타면 여기서 잡힌다.
TEMPLATE_CODE_EXPECT = '__PUSH_TEMPLATE_CODE__'
DOUBLE_ID_EXPECT = 'ait.v2.live.XXXXXXXXXXXXXXXX'
BANNER_ID_REMOVED = 'ait.v2.live.XXXXXXXXXXXXXXXX'
REVIVE_ID = 'ait.v2.live.XXXXXXXXXXXXXXXX'
INTERSTITIAL_ID = 'ait.v2.live.XXXXXXXXXXXXXXXX'
XPROMO_URL_EXPECT = 'intoss://moneyleague'

# game/config.ts 정본(START_MASS·길이식). R4 와 같은 유도식이다.
START_MASS = 12
LEN_MIN, LEN_K, LEN_POW = 150.0, 46.0, 0.55
BOOST_LEN_K = 1.4

SAVE = {
    "v": 1, "savedAt": 0, "bestScore": 20847, "bestRank": 1, "games": 5,
    "totalKills": 18, "playSeconds": 900, "nick": "리미", "skin": "corn",
    "control": "joystick", "sound": True, "locale": "ko",
}

FAKE_BRIDGE_JS = r"""(() => {
  window.__KS_SENT = [];
  let store = {};
  try { store = JSON.parse(sessionStorage.getItem('__KS_STORE') || '{}'); } catch { store = {}; }
  const save = () => { try { sessionStorage.setItem('__KS_STORE', JSON.stringify(store)); } catch {} };
  window.__KS_STORE = () => Object.assign({}, store);
  const listeners = new Map();
  /* ★★ 실측(2026-09-10, tools 진단): 광고·푸시 SDK 청크가 «로드되는 순간» 이 한 줄을 돈다 —
     `typeof window!="undefined"&&(window.__GRANITE_NATIVE_EMITTER=le())` (web-bridge dist 번들).
     즉 우리가 먼저 꽂아 둔 emitter 는 «갈아끼워진다». 그래도 배관은 그대로 산다:
       · 우리 postMessage 감청은 window.ReactNativeWebView 라 영향 없다.
       · 응답·이벤트는 window 의 «현재» emitter 로 보내면 SDK 리스너에게 그대로 간다.
     ⛔그래서 「우리 Map 의 크기」로 구독 수를 세면 안 된다 — 0 이 나오고 「아무도 안 받았다」로 오판한다
       (P2-e 가 실제로 그렇게 틀렸다). 아래 __KS_LISTENERS 는 «지금 살아 있는» emitter 를 센다. */
  const mine = {
    on: (ev, cb) => { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(cb);
      return () => { const s = listeners.get(ev); if (s) s.delete(cb); }; },
    emit: (ev, data) => { const s = listeners.get(ev); if (!s) return 0; const arr = [...s];
      for (const cb of arr) { try { cb(data); } catch (e) {} } return arr.length; },
  };
  window.__GRANITE_NATIVE_EMITTER = mine;
  /** 지금 그 이벤트를 듣고 있는 구독 수. SDK 구현(events 객체)과 우리 것(Map) 둘 다 센다. */
  window.__KS_LISTENERS = (ev) => {
    const em = window.__GRANITE_NATIVE_EMITTER;
    if (em && em !== mine && em.events && Array.isArray(em.events[ev])) return em.events[ev].length;
    const s = listeners.get(ev); return s ? s.size : 0;
  };
  /** 지금 emitter 가 «누구» 것인가(진단·기록용). */
  window.__KS_EMITTER = () => (window.__GRANITE_NATIVE_EMITTER === mine ? 'harness' : 'sdk');
  window.__CONSTANT_HANDLER_MAP = {};
  window.ReactNativeWebView = {
    postMessage: (raw) => {
      let m = null;
      try { m = JSON.parse(raw); } catch { m = { raw }; }
      window.__KS_SENT.push(m);
      if (!m || !m.eventId || !m.functionName) return;
      if (m.type === 'addEventListener' || m.type === 'removeEventListener') return; // 이벤트는 테스트가 흘린다
      const a = Array.isArray(m.args) ? m.args : [];
      let reply = null;
      // ★getStorageItem 응답을 «늦출» 수 있다 — 부팅 복원과 유저 동의의 «경합»을 재현하려면 필요하다.
      const delay = (m.functionName === 'getStorageItem' && window.__KS_STORAGE_DELAY) ? window.__KS_STORAGE_DELAY : 0;
      if (m.functionName === 'getStorageItem') reply = (a[0] in store) ? store[a[0]] : null;
      else if (m.functionName === 'setStorageItem') { store[a[0]] = String(a[1]); save(); reply = null; }
      else if (m.functionName === 'removeStorageItem') { delete store[a[0]]; save(); reply = null; }
      else if (m.functionName === 'openURL') reply = null;
      setTimeout(() => { window.__GRANITE_NATIVE_EMITTER.emit(m.functionName + '/resolve/' + m.eventId, reply); }, delay);
    },
  };
  window.__KS_PUSH_SUBS = () => window.__KS_SENT.filter((m) => m.functionName === 'requestNotificationAgreement' && m.type === 'addEventListener');
  window.__KS_PUSH_FIRE = (type) => {
    const s = window.__KS_PUSH_SUBS(); if (!s.length) return { ok: false, reason: 'no-subscription' };
    const last = s[s.length - 1];
    const ev = 'requestNotificationAgreement/onEvent/' + last.eventId;
    const before = window.__KS_LISTENERS(ev);   // 발화 «전» 구독자 수 = 실제로 전달될 대상
    window.__GRANITE_NATIVE_EMITTER.emit(ev, { type });
    return { ok: before > 0, eventId: last.eventId, args: last.args, listeners: before,
             emitter: window.__KS_EMITTER(), after: window.__KS_LISTENERS(ev) };
  };
  window.__KS_PUSH_ERROR = (msg) => {
    const s = window.__KS_PUSH_SUBS(); if (!s.length) return { ok: false, reason: 'no-subscription' };
    const last = s[s.length - 1];
    const n = window.__GRANITE_NATIVE_EMITTER.emit('requestNotificationAgreement/onError/' + last.eventId, { __isError: true, message: msg || 'UNSUPPORTED_APP_VERSION' });
    return { ok: n > 0, eventId: last.eventId };
  };
  window.__KS_OPEN_CALLS = () => window.__KS_SENT.filter((m) => m.functionName === 'openURL' && m.type === 'method').map((m) => (m.args || [])[0]);
})()"""

HIDDEN_JS = r"""(h) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
  return document.hidden;
}"""

UI_JS = r"""
window.__ui = {
  ovs: () => Array.from(document.querySelectorAll('.overlay')),
  vis: (n) => !document.querySelectorAll('.overlay')[n].classList.contains('hidden'),
  again: () => document.querySelectorAll('.overlay')[2].querySelector('.btn-primary'),
  toMenu:() => document.querySelectorAll('.overlay')[2].querySelector('.btn-ghost'),
  play:  () => document.querySelector('.p-play'),
  pauseBtn: () => document.querySelector('.hud-pause'),
  shown: (el) => !!el && !el.classList.contains('hidden'),
  q: (s) => document.querySelector(s),
  count: (s) => document.querySelectorAll(s).length,
  rect: (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2), top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2) }; },
  text: (s) => { const e = document.querySelector(s); return e ? (e.textContent || '').trim() : null; },
  toast: () => { const t = document.querySelector('.rw-toast'); return t && t.classList.contains('show') ? t.textContent : null; },
  colOrder: () => Array.from(document.querySelector('.col-b').children).map((n) => n.className),
  gapStatsSet: () => { const a = document.querySelector('.p-stats').getBoundingClientRect(); const b = document.querySelector('.p-set').getBoundingClientRect(); return +(b.top - a.bottom).toFixed(2); },
  carryRow: () => { const r = document.querySelector('.kv-carry'); if (!r) return null; return { hidden: r.classList.contains('hidden'), k: r.querySelector('.kv-k').textContent, v: r.querySelector('.kv-v').textContent, best: r.querySelector('.kv-v').classList.contains('is-best') }; },
  doubleBtn: () => { const b = document.querySelector('.p-double'); if (!b) return null; return { hidden: b.classList.contains('hidden'), disabled: b.disabled, title: (b.querySelector('.rw-title')||{}).textContent, sub: (b.querySelector('.rw-sub')||{}).textContent, busy: b.getAttribute('aria-busy') }; },
  pushRow: () => { const g = document.querySelector('.push-group'); if (!g) return null; const b = g.querySelector('.push-btn'); const r = b.getBoundingClientRect(); return { label: g.querySelector('.row-label').textContent, btn: b.textContent, disabled: b.disabled, busy: b.getAttribute('aria-busy'), on: b.classList.contains('is-on'), hint: g.querySelector('.hint-line').textContent, hintErr: g.querySelector('.hint-line').classList.contains('is-error'), w: Math.round(r.width), h: Math.round(r.height), connected: g.isConnected }; },
  nudge: () => { const n = document.querySelector('.p-nudge'); if (!n) return null; const r = n.getBoundingClientRect(); const cta = n.querySelector('.nudge-cta'); const x = n.querySelector('.nudge-x'); const rc = cta.getBoundingClientRect(); const rx = x.getBoundingClientRect(); return { title: n.querySelector('.nudge-title').textContent, sub: n.querySelector('.nudge-sub').textContent, cta: cta.textContent, ctaDisabled: cta.disabled, ctaW: Math.round(rc.width), ctaH: Math.round(rc.height), xW: Math.round(rx.width), xH: Math.round(rx.height), xLabel: x.getAttribute('aria-label'), top: Math.round(r.top), h: Math.round(r.height), bottom: Math.round(r.bottom) }; },
  xpromo: () => { const n = document.querySelector('.p-xpromo'); if (!n) return null; if (n.classList.contains('hidden')) return { hidden: true }; const o = n.querySelector('.xpromo-open'); const x = n.querySelector('.xpromo-x'); const ro = o.getBoundingClientRect(); const rx = x.getBoundingClientRect(); return { hidden: false, title: n.querySelector('.xpromo-title').textContent, tag: n.querySelector('.xpromo-tag').textContent, sub: n.querySelector('.xpromo-sub').textContent, open: o.textContent.trim(), openW: Math.round(ro.width), openH: Math.round(ro.height), xW: Math.round(rx.width), xH: Math.round(rx.height), xLabel: x.getAttribute('aria-label') }; },
  overflow: (sel) => { const out=[]; for (const root of document.querySelectorAll(sel)) { for (const e of root.querySelectorAll('*')) { if (e.children.length) continue; if (!(e.textContent||'').trim()) continue; const cs=getComputedStyle(e); if (cs.display==='none') continue; if (cs.overflow==='hidden'||cs.textOverflow==='ellipsis') continue; if (e.scrollWidth > e.clientWidth + 1 && cs.whiteSpace==='nowrap') out.push({t:(e.textContent||'').trim().slice(0,30), sw:e.scrollWidth, cw:e.clientWidth}); } } return out; },
  smallTargets: (sel) => { const out=[]; for (const root of document.querySelectorAll(sel)) { for (const b of root.querySelectorAll('button')) { const r=b.getBoundingClientRect(); if (r.width>0 && r.height>0 && (r.width<44||r.height<44)) out.push((b.className||b.tagName)+' '+Math.round(r.width)+'x'+Math.round(r.height)); } } return out; },
  rawKeys: (sel) => { const out=[]; const re=/(?:^|[\s>\[(])([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+){1,4})(?:$|[\s<\])])/g; for (const root of document.querySelectorAll(sel)) { for (const e of root.querySelectorAll('*')) { if (e.children.length) continue; const t=(e.textContent||'').trim(); if (!t) continue; let m; re.lastIndex=0; while ((m=re.exec(' '+t+' '))) { if (/\d|\.(com|io|kr|js|css|png|json)$/.test(m[1])) continue; out.push(m[1]); } } } return out; },
  interp: (sel) => { const out=[]; for (const root of document.querySelectorAll(sel)) { const w=document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n=w.nextNode())) { const t=n.textContent||''; if (t.includes('{{')||t.includes('}}')||/\{[a-z]+\}/.test(t)) out.push(t.trim().slice(0,40)); } } return out; },
  emoji: (sel) => { const RE=/(\p{Extended_Pictographic}|\u2705|\u2713|\u2717)/u; const out=[]; for (const root of document.querySelectorAll(sel)) { const w=document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n=w.nextNode())) { const p=n.parentElement; if (!p) continue; if (['SCRIPT','STYLE'].includes(p.tagName)) continue; const cs=getComputedStyle(p); if (cs.display==='none') continue; if (RE.test(n.textContent||'')) out.push((n.textContent||'').trim().slice(0,30)); } } return out; },
};
"""


def body_len(mass: float) -> float:
    return LEN_MIN + LEN_K * math.pow(mass, LEN_POW)


def boosted_from(base: float) -> int:
    target = body_len(base) * BOOST_LEN_K
    raw = math.pow(max(0.0, target - LEN_MIN) / LEN_K, 1 / LEN_POW)
    return max(int(base), round(raw))


def serve(d: Path):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(d), **k)

        def log_message(self, *a):
            pass
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s.server_address[1], s


class Ctl:
    def __init__(self, page):
        self.p = page

    def ev(self, js, arg=None):
        return self.p.evaluate(js, arg) if arg is not None else self.p.evaluate(js)

    def rw(self):
        return self.ev("() => window.__coilReward.state()")

    def ads(self):
        return self.ev("() => window.__coilAds.state()")

    def calls(self):
        return self.ev("() => window.__coilAdCalls || {load:0,show:0,ids:[]}")

    def stub(self, **b):
        self.ev("(b) => window.__coilAds.installStub(b)", b)
        self.ev("() => window.__coilReward.refresh()")

    def reset(self, **b):
        self.ev("() => window.__coil.toMenu()")
        self.ev("() => window.__coilReward.reset()")
        self.ev("() => window.__coilAds.reset()")
        self.ev("() => { window.__coilAdCalls = {load:0, show:0, ids:[]}; }")
        if b:
            self.stub(**b)

    def mode(self):
        return self.ev("() => window.__coil.state().mode")

    def start(self):
        self.ev("() => window.__coil.startRun()")
        self.p.wait_for_function("() => window.__coil.state().mode === 'play'", timeout=5000)

    def grow(self, m):
        self.ev("(m) => window.__coil.grow(m)", m)

    def die(self):
        self.ev("() => window.__coil.kill()")
        self.p.wait_for_function("() => window.__coil.state().mode === 'dead'", timeout=6000)
        self.p.wait_for_function("() => window.__ui.vis(2)", timeout=4000)
        self.p.wait_for_timeout(120)

    def run_and_die(self, grow_to=None):
        if self.mode() != 'play':
            self.start()
        self.p.wait_for_timeout(250)
        if grow_to:
            self.grow(grow_to)
            self.p.wait_for_timeout(120)
        self.die()


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    rep = {'dist': str(DIST), 'checks': [], 'controls': [], 'fail': [], 'requests_per_screen': {}, 'external': [], 'errors': []}

    def chk(name, ok, detail=''):
        rep['checks'].append([name, bool(ok), str(detail)])
        if not ok:
            rep['fail'].append([name, str(detail)])
        print(f"  {'PASS' if ok else '★FAIL'}  {name}  {detail}")

    def ctl_(name, caught):
        """양성/음성 대조. ★대조가 «놓치면» 그것도 실패다 — 종료코드에 반영한다.
        ⛔예전엔 controls 에만 적고 rep['fail'] 을 안 건드려서, 대조가 죽어도 검사기가 초록으로 끝났다
          (Codex 적대적 리뷰 2026-09-10 지적 11 — 「검사기의 양성대조 실패가 최종 실패로 연결되지 않는다」).
          그러면 이 파일의 모든 「PASS」가 근거를 잃는다."""
        ok = bool(caught)
        rep['controls'].append([name, ok])
        if not ok:
            rep['fail'].append(['CONTROL ' + name, 'control missed'])
        print(f"  {'CAUGHT' if ok else '★MISSED'}  {name}")
        return ok

    if not (DIST / 'index.html').exists():
        print('FAILED: 빌드가 없다 —', DIST)
        return 1

    # ══ 번들 grep(정적) ═══════════════════════════════════════════════════════
    print('\n[G] 번들 grep — 양성/음성')
    js = ' '.join(p.read_text(encoding='utf-8', errors='ignore') for p in (DIST / 'assets').glob('*.js'))
    chk('G-a 신설 지면 XXXXXXXXXXXXXXXX 가 번들에 «정확히 1회»', js.count(DOUBLE_ID_EXPECT) == 1, js.count(DOUBLE_ID_EXPECT))
    chk('G-b 배너 지면 XXXXXXXXXXXXXXXX 는 «0회»', js.count(BANNER_ID_REMOVED) == 0, js.count(BANNER_ID_REMOVED))
    chk('G-c templateCode __PUSH_TEMPLATE_CODE__ 이 «1회»', js.count(TEMPLATE_CODE_EXPECT) == 1, js.count(TEMPLATE_CODE_EXPECT))
    chk('G-d intoss://moneyleague 가 «1회»', js.count(XPROMO_URL_EXPECT) == 1, js.count(XPROMO_URL_EXPECT))
    chk('G-e TEST_/TESTONLY/PROMO_IGNORE_BASELINE=true 표식 0(토스 SDK 자체의 TEST_MODE 상수 제외)',
        'TESTONLY' not in js and 'PROMO_IGNORE_BASELINE = true' not in js and js.count('TEST_') == js.count('TEST_MODE'),
        f"TEST_={js.count('TEST_')} TEST_MODE={js.count('TEST_MODE')}")
    chk('G-f 배너 훅 이름(__coilBanner)·attachBanner 호출 0', '__coilBanner' not in js and 'attachBanner(' not in js.replace('TossAds', ''),
        f"__coilBanner={js.count('__coilBanner')}")
    ctl_('G 양성대조: 없는 지면 ID(ait.v2.live.XXXXXXXXXXXXXXXX)는 0회', js.count('ait.v2.live.XXXXXXXXXXXXXXXX') == 0)

    port, srv = serve(DIST)
    base = f'http://127.0.0.1:{port}/index.html'

    def new_ctx(browser, in_toss, lang='ko', width=390, save=None, init_extra=None):
        ctx = browser.new_context(viewport={'width': width, 'height': 844}, device_scale_factor=2,
                                  locale='ko-KR' if lang == 'ko' else 'en-US', has_touch=True, is_mobile=True)

        def guard(route):
            u = route.request.url
            if u.startswith(f'http://127.0.0.1:{port}') or u.startswith('data:') or u.startswith('blob:'):
                return route.continue_()
            rep['external'].append(u)
            return route.abort()
        ctx.route('**/*', guard)
        if in_toss:
            ctx.add_init_script(FAKE_BRIDGE_JS)
        sv = dict(save or SAVE)
        sv['locale'] = lang
        ctx.add_init_script("localStorage.setItem('king-snake.save', %s)" % json.dumps(json.dumps(sv, ensure_ascii=False)))
        if init_extra:
            ctx.add_init_script(init_extra)
        page = ctx.new_page()
        errs = []
        page.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        return ctx, page, errs

    def boot(page, qs='?debug=1&quiet=1'):
        page.goto(base + qs, wait_until='load')
        page.wait_for_function('() => window.__coil && window.__coilAds && window.__coilReward && window.__coilPush && window.__coilXpromo', timeout=10000)
        page.evaluate(UI_JS)
        page.wait_for_timeout(600)

    with open_browser() as (_pw, browser):
        try:
            # ══ A. 전면형 요청 규율 ═══════════════════════════════════════════
            print('\n[A] 전면형 «요청 = 노출» — 빚이 있을 때만 로드')
            ctx, page, errs = new_ctx(browser, False)
            boot(page)
            c = Ctl(page)
            OK = dict(load='ok', show='dismissed', supported=True)
            c.reset(**OK)
            page.wait_for_timeout(300)
            chk('A0 부팅·메뉴(빚 없음) 로드 0', c.calls()['load'] == 0, c.calls())
            c.run_and_die()
            page.wait_for_timeout(300)
            st = c.ads()
            chk('A1 ★첫 판 시작·사망(빚 없음) 로드 0 · adPending false', c.calls()['load'] == 0 and st['adPending'] is False, f"load={c.calls()['load']} pending={st['adPending']}")
            page.evaluate("() => window.__ui.again().click()")
            page.wait_for_timeout(300)
            c.run_and_die()
            page.wait_for_timeout(300)
            st = c.ads()
            chk('A2 ★2판째 사망 = 빚 → 로드 «1» · adReady', st['adPending'] is True and c.calls()['load'] == 1 and st['adReady'] is True, f"load={c.calls()['load']} {st['adPending']}/{st['adReady']}")
            # 결과 화면 100회 리렌더 → 요청 그대로 1
            for _ in range(100):
                page.evaluate("() => window.__coilReward.refresh()")
            page.wait_for_timeout(200)
            chk('A3 결과 화면 100회 리렌더에도 요청 «1» 그대로', c.calls()['load'] == 1, c.calls()['load'])
            rep['requests_per_screen']['result_rerender_100'] = c.calls()['load']
            before_show = c.calls()['show']
            page.evaluate("() => window.__ui.again().click()")
            page.wait_for_timeout(500)
            chk('A4 「다시 하기」에서 표시 1 · 빚 소비 · 표시 뒤 «빚 없어» 재로드 0', c.calls()['show'] - before_show == 1 and c.ads()['adPending'] is False and c.calls()['load'] == 1, f"show+{c.calls()['show'] - before_show} load={c.calls()['load']}")
            ctl_('A 양성대조: 로드 계수기가 움직인다(0 → 1 을 실제로 봤다)', c.calls()['load'] == 1)

            # TTL — 묵은 로드는 띄우지 않고 다시 받는다
            c.reset(**OK)
            c.run_and_die(); page.evaluate("() => window.__ui.again().click()"); page.wait_for_timeout(250); c.run_and_die()
            page.wait_for_timeout(300)
            chk('A5-pre 빚·준비 상태 확보', c.ads()['adPending'] is True and c.ads()['adReady'] is True and c.calls()['load'] == 1)
            page.evaluate("() => window.__coilAds.ageReady(31 * 60 * 1000)")
            b_show, b_load = c.calls()['show'], c.calls()['load']
            page.evaluate("() => window.__ui.again().click()")
            page.wait_for_timeout(500)
            st = c.ads()
            chk('A5 ★묵은 로드(31분) 는 «안 띄우고» 버린 뒤 다시 받는다: 표시 0 · 로드 +1 · 빚 유지', c.calls()['show'] - b_show == 0 and c.calls()['load'] - b_load == 1 and st['adPending'] is True, f"show+{c.calls()['show'] - b_show} load+{c.calls()['load'] - b_load} pending={st['adPending']}")
            page.wait_for_timeout(200)
            c.run_and_die()
            b_show = c.calls()['show']
            page.evaluate("() => window.__ui.again().click()"); page.wait_for_timeout(500)
            chk('A5-b 새로 받은 광고가 다음 지점에서 표시된다(빚이 사라지지 않았다)', c.calls()['show'] - b_show == 1, c.calls()['show'] - b_show)

            # 복귀(onForeground)와 백오프 — ★2026-09-10 Codex 지적 5 로 기대값이 «뒤집혔다».
            #   예전 구현은 복귀할 때 nextRetryAt 을 0 으로 밀어 백오프를 통째로 무력화했다
            #   (실측 재현: 대기 없이 총 6회 요청). 지금은 복귀가 백오프를 «지킨다».
            c.reset(load='silent', show='dismissed', supported=True)
            c.run_and_die(); page.evaluate("() => window.__ui.again().click()"); page.wait_for_timeout(250); c.run_and_die()
            page.wait_for_timeout(5600)   # PRELOAD_TIMEOUT 5s → 실패 → 백오프 30s
            st = c.ads()
            chk('A6-pre 무응답 로드가 실패로 확정돼 백오프에 걸렸다', st['adPending'] is True and st['loading'] is False and st['preloadFails'] == 1 and st['nextRetryInMs'] > 20000, f"pending={st['adPending']} fails={st['preloadFails']} retryIn={st['nextRetryInMs']}")
            page.evaluate("(b) => window.__coilAds.installStub(b)", OK)
            b_load = c.calls()['load']
            for _ in range(3):
                page.evaluate("() => window.__coilAds.foreground()")
                page.wait_for_timeout(200)
            chk('A6 ★백오프 중 복귀를 반복해도 요청 0(복귀가 백오프를 무력화하지 않는다)',
                c.calls()['load'] - b_load == 0 and c.ads()['preloadFails'] == 1,
                f"load+{c.calls()['load'] - b_load} fails={c.ads()['preloadFails']}")
            # 숨김 중 요청 0 — 백오프가 풀린 뒤에도 «안 보이면» 안 부른다
            #
            # ★2026-09-10 정정(공허한 통과였다). 예전엔 26,000ms 만 기다렸는데 백오프 잔여가
            #   28,532ms 였다 — 즉 A7 은 「백오프가 풀렸는데도 안 부른다」가 아니라
            #   «아직 백오프 중이라 원래 안 부르는» 상태를 보고 PASS 를 냈다. 전제가 거짓이면
            #   그 아래 A7-b(다시 보이면 1회 재요청)는 «반드시» 실패한다 — 실제로 실패했다.
            #   ⇒ 넉넉히 넘기고, 넘어갔다는 사실을 «먼저 재서» 확인한다(전제 확인 = 양성대조).
            page.evaluate(HIDDEN_JS, True)
            page.wait_for_timeout(31000)   # 백오프(30s) 만료를 숨긴 채로 «확실히» 넘긴다
            st = c.ads()
            ctl_(f"A7-pre 전제 — 백오프가 «실제로» 풀렸다(retryIn={st['nextRetryInMs']}ms). 안 풀렸으면 아래 A7 은 공허한 통과다",
                 st['nextRetryInMs'] == 0)
            page.evaluate("() => window.__coilAds.foreground()")
            page.wait_for_timeout(500)
            chk('A7 ★숨김(hidden) 중에는 백오프가 풀려도 요청 0', c.calls()['load'] - b_load == 0, c.calls()['load'] - b_load)
            page.evaluate(HIDDEN_JS, False)
            page.wait_for_timeout(800)
            st = c.ads()
            chk('A7-b 다시 보이면 «그때» 1회 재요청 → 준비', c.calls()['load'] - b_load == 1 and st['adReady'] is True, f"load+{c.calls()['load'] - b_load} ready={st['adReady']}")
            c.reset(**OK)
            b_load = c.calls()['load']
            page.evaluate("() => window.__coilAds.foreground()")
            page.wait_for_timeout(300)
            chk('A6-neg 빚이 없으면 복귀해도 요청 0', c.calls()['load'] - b_load == 0, c.calls()['load'] - b_load)

            # 부활 리워드는 «버튼 뒤 로드» — 사망 시트에서 부활 지면 로드 0, 탭 뒤 1
            c.reset(load='ok', show='reward', supported=True)
            c.run_and_die()
            ids0 = list(c.calls()['ids'])
            chk('A8 ★사망 시트가 떠도 부활 지면 로드 0(프리로드 없음 · 요청 = 노출)', REVIVE_ID not in ids0, ids0)
            page.evaluate("() => window.__coilReward.revive()")
            ids1 = c.calls()['ids'][len(ids0):]
            chk('A8-b 부활 탭 → 그 지면 로드 1 · 표시 1', ids1[:2] == [REVIVE_ID, REVIVE_ID] and c.mode() == 'play', ids1)

            # 화면별 체류 요청 수
            print(f'\n[A9] 화면별 {DWELL_S}초 체류 요청 수(빚이 있는 상태에서도 «타이머 재요청 0» 이어야 한다)')
            c.reset(load='silent', show='dismissed', supported=True)   # 무응답 로드 = 「요청이 재발화하면 바로 보이는」 조건
            c.run_and_die(); page.evaluate("() => window.__ui.again().click()"); page.wait_for_timeout(250); c.run_and_die()
            page.wait_for_timeout(5600)  # 실패 확정 → 빚은 남아 있다
            per = {}

            def dwell(tag):
                b = c.calls()['load']
                t0 = time.time()
                while time.time() - t0 < DWELL_S:
                    page.wait_for_timeout(1000)
                per[tag] = c.calls()['load'] - b
                chk(f'A9-{tag} {DWELL_S}초 체류 요청 +{per[tag]} (기대 0)', per[tag] == 0, per[tag])
            dwell('result')
            page.evaluate("() => window.__ui.again().click()"); page.wait_for_timeout(400)   # 빚 있음·미준비 → 광고 없이 시작(백오프)
            page.evaluate("() => window.__coil.ghost(600)")
            dwell('play')
            page.evaluate("() => window.__ui.pauseBtn().click()"); page.wait_for_timeout(300)
            dwell('pause')
            page.evaluate("() => window.__coil.toMenu()"); page.wait_for_timeout(300)
            dwell('menu')
            rep['requests_per_screen'].update(per)
            rep['requests_per_screen']['dwell_seconds'] = DWELL_S
            chk('A9 총평: 4화면 체류 요청 0 — 요청은 «사망(빚)·유저 행동·복귀»에서만 나간다', all(v == 0 for v in per.values()), per)
            rep['errors'] += errs
            ctx.close()

            # ══ B. 배너 부재 ═══════════════════════════════════════════════════
            print('\n[B] 시작 화면 배너 «부재»')
            ctx, page, errs = new_ctx(browser, False)
            boot(page)
            chk('B-a __coilBanner 훅 없음', page.evaluate("() => typeof window.__coilBanner") == 'undefined')
            chk('B-b .ad-slot/.p-adslot 컨테이너 0', page.evaluate("() => window.__ui.count('.ad-slot, .p-adslot')") == 0)
            gap = page.evaluate("() => window.__ui.gapStatsSet()")
            chk('B-c 기록 카드 ↔ 설정 카드 간격 12px(설치 전과 같다 · 유령 여백 0)', gap == 12, gap)
            order = page.evaluate("() => window.__ui.colOrder()")
            chk('B-d 오른쪽 열 순서 = 기록 → 설정 → 조작법(토스 밖)', [x.split(' ')[-1] for x in order] == ['p-stats', 'p-set', 'p-how'], order)
            rep['errors'] += errs
            ctx.close()

            # ══ C. 결과 화면 「이번 판 성장 2배」 + 이어받기 ═════════════════════
            print('\n[C] 결과 화면 「이번 판 성장 2배」 + 이어받기')
            ctx, page, errs = new_ctx(browser, False)
            boot(page)
            c = Ctl(page)
            RW = dict(load='ok', show='reward', supported=True)
            c.reset(**RW)
            k = c.rw()['carryConst']
            K, CAP, DK, DAILY = k['k'], k['cap'], k['doubleK'], k['dailyCap']
            chk('C0 상수를 코드에서 읽었다(k·cap·2배·일 상한)', 0 < K < 1 and CAP > 0 and DK == 2 and DAILY == 3, k)

            def carry_base(growth):
                return min(CAP, int(math.floor(growth * K)))
            # 성장 0 판 → 몫 0 → 행·버튼 없음
            c.run_and_die()
            r = c.rw()
            chk('C1 성장 ≈ 0 판 = 이어받기 0 · 행 숨김 · 2배 버튼 숨김(죽은 버튼 0)', r['carry']['mass'] == 0 and page.evaluate("() => window.__ui.carryRow()")['hidden'] and page.evaluate("() => window.__ui.doubleBtn()")['hidden'] and r['canDouble'] is False, f"carry={r['carry']} canDouble={r['canDouble']}")
            # 성장 큰 판 → 기본 몫 확정(광고 없이) · 행 「+N」 · 버튼 「+N → +2N」
            page.evaluate("() => window.__ui.again().click()"); page.wait_for_timeout(250)
            c.run_and_die(grow_to=1483)
            r = c.rw()
            exp = carry_base(r['lastRunGrowth'])
            row = page.evaluate("() => window.__ui.carryRow()")
            btn = page.evaluate("() => window.__ui.doubleBtn()")
            chk('C2 ★최종 사망 = 기본 몫 확정(광고 없이) base=min(cap, floor(growth×k))', r['carry']['base'] == exp and r['carry']['mass'] == exp and r['carry']['doubled'] is False and exp > 0, f"growth={r['lastRunGrowth']} carry={r['carry']} exp={exp}")
            chk('C2-b 결과 기록 행 「다음 판 시작 +N」 보임', row and not row['hidden'] and row['v'] == '+' + f'{exp:,}' and not row['best'], row)
            chk('C2-c 2배 버튼 보임 · 부제에 「+N → +2N」', btn and not btn['hidden'] and str(exp) in btn['sub'] and str(exp * 2) in btn['sub'] and r['canDouble'] is True, btn)
            # 지급
            c.ev("() => window.__coilReward.doubleAd()")
            page.wait_for_timeout(300)
            r = c.rw()
            row = page.evaluate("() => window.__ui.carryRow()")
            btn = page.evaluate("() => window.__ui.doubleBtn()")
            chk('C3 ★2배 지급: mass = 2×base · doubled · 상한 +1 · 세션 사용 · 버튼 사라짐 · 행 강조', r['carry']['mass'] == exp * DK and r['carry']['doubled'] is True and r['used']['resultDouble'] == 1 and r['doubleUsedSession'] is True and btn['hidden'] and row['best'] and row['v'] == '+' + f'{exp * DK:,}', f"carry={r['carry']} used={r['used']['resultDouble']}")
            chk('C3-b 지급 토스트가 뜬다', page.evaluate("() => window.__ui.toast()") is not None, page.evaluate("() => window.__ui.toast()"))
            chk('C3-c 광고 호출이 «그 지면으로만» 갔다(load+show)', c.calls()['ids'][-2:] == [DOUBLE_ID_EXPECT, DOUBLE_ID_EXPECT], c.calls()['ids'][-2:])
            chk('C3-d 리워드가 표시된 결과 화면 = rewardShownOnResult', r['rewardShownOnResult'] is True)
            chk('C3-e ★한 화면 한 번: 2배를 본 뒤 «부활» 제안도 접힌다(같은 화면 리워드 2연타 금지)',
                r['canRevive'] is False and page.evaluate("() => window.__ui.shown(document.querySelector('.p-revive'))") is False,
                f"canRevive={r['canRevive']}")
            # 리워드 뒤 「다시 하기」 → 전면형 건너뛰기(빚은 유지)
            st = c.ads()
            chk('C4-pre 이 시점에 전면형 빚이 있다(plays=2)', st['adPending'] is True and st['plays'] == 2, st)
            b_show = c.calls()['show']
            page.evaluate("() => window.__ui.again().click()")
            page.wait_for_function("() => window.__coil.state().mode === 'play'", timeout=4000)
            page.wait_for_timeout(300)
            r = c.rw()
            chk('C4 ★리워드 직후 「다시 하기」 = 전면형 «건너뜀»(표시 0) · 빚 «유지»', c.calls()['show'] - b_show == 0 and c.ads()['adPending'] is True, f"show+{c.calls()['show'] - b_show} pending={c.ads()['adPending']}")
            chk('C5 ★다음 판 시작 질량 = START_MASS + 2배 몫 · 이어받기 소비됨', abs(r['spawnMass'] - (START_MASS + exp * DK)) < 1e-6 and r['carry']['mass'] == 0, f"spawn={r['spawnMass']} exp={START_MASS + exp * DK} carry={r['carry']}")
            # 다음 사망(plays=3, 빚은 그대로) → 다시 하기에서 미뤄진 전면형이 뜬다
            c.die()
            b_show = c.calls()['show']
            page.evaluate("() => window.__ui.again().click()"); page.wait_for_timeout(500)
            chk('C4-b 미뤄진 빚은 다음 결과 화면의 「다시 하기」에서 소비된다(표시 1)', c.calls()['show'] - b_show == 1 and c.ads()['adPending'] is False, f"show+{c.calls()['show'] - b_show}")
            # 세션 1회 · 일 3회
            c.die()
            page.evaluate("() => window.__ui.again().click()"); page.wait_for_timeout(250)
            c.run_and_die(grow_to=900)
            r = c.rw()
            chk('C6 세션 1회: 성장 판인데 canDouble false(이미 썼다)', r['carry']['base'] > 0 and r['canDouble'] is False and r['doubleUsedSession'] is True, f"carry={r['carry']}")
            page.evaluate("() => window.__coilReward.clearDoubleSession()")
            chk('C6-b 세션 상한만 풀면 다시 제안된다(그 아래 규칙은 그대로)', c.rw()['canDouble'] is True)
            c.ev("() => window.__coilReward.doubleAd()"); page.wait_for_timeout(250)
            page.evaluate("() => window.__ui.again().click()"); page.wait_for_timeout(250)
            c.run_and_die(grow_to=900); page.evaluate("() => window.__coilReward.clearDoubleSession()")
            c.ev("() => window.__coilReward.doubleAd()"); page.wait_for_timeout(250)
            r = c.rw()
            chk('C6-c 일 상한 3 도달(used=3)', r['used']['resultDouble'] == DAILY, r['used']['resultDouble'])
            page.evaluate("() => window.__ui.again().click()"); page.wait_for_timeout(250)
            c.run_and_die(grow_to=900); page.evaluate("() => window.__coilReward.clearDoubleSession()")
            r = c.rw()
            chk('C6-d ★일 상한 뒤엔 세션을 풀어도 canDouble false · 버튼 숨김 · 기본 몫은 «그대로» 받는다', r['canDouble'] is False and page.evaluate("() => window.__ui.doubleBtn()")['hidden'] and r['carry']['base'] > 0 and r['carry']['doubled'] is False, f"carry={r['carry']} used={r['used']['resultDouble']}")
            c.ev("() => window.__coilReward.doubleAd()"); page.wait_for_timeout(250)
            chk('C6-e 상한 뒤 직접 호출해도 지급 0 · 광고 0', c.rw()['used']['resultDouble'] == DAILY and c.rw()['carry']['doubled'] is False)
            # 부활 → (판 계속) → 최종 사망에서 2배. ★「한 화면 한 번」 규율에서 «둘 다 받는» 유일한 순서다.
            c.reset(**RW)
            c.run_and_die(grow_to=1200)
            r0 = c.rw()
            chk('C7-0 사망 화면에 부활·2배가 «둘 다» 선다(선택지)', r0['canRevive'] is True and r0['canDouble'] is True, (r0['canRevive'], r0['canDouble']))
            order = page.evaluate("() => Array.from(document.querySelectorAll('.overlay')[2].querySelector('.panel').children).map(n => n.className.split(' ').pop())")
            chk('C7-0b ★부활이 «위», 2배가 «아래»(부활 먼저 고르면 2배 기회가 남는다)', order.index('p-revive') < order.index('p-double'), order)
            c.ev("() => window.__coilReward.revive()"); page.wait_for_timeout(250)
            r1 = c.rw()
            chk('C7 부활하면 이어받기가 «되돌아간다»(그 판은 아직 안 끝났다) · 게임 재개', r1['mode'] == 'play' and r1['carry']['mass'] == 0 and r1['used']['revive'] == 1, f"carry={r1['carry']}")
            c.grow(700); page.wait_for_timeout(120); c.die()
            r2 = c.rw()
            chk('C7-b ★최종 사망: 이어받기가 다시 확정되고 2배 제안이 «다시» 선다(같은 판에서 둘 다 받을 수 있다)',
                r2['carry']['base'] == carry_base(r2['lastRunGrowth']) and r2['carry']['base'] > 0 and r2['canDouble'] is True and r2['rewardShownOnResult'] is False,
                f"carry={r2['carry']} canDouble={r2['canDouble']}")
            c.ev("() => window.__coilReward.doubleAd()"); page.wait_for_timeout(250)
            r3 = c.rw()
            chk('C7-c 그 화면에서 2배 지급 = 부활 1 + 2배 1(광고 2편이지만 «서로 다른 화면»)',
                r3['carry']['doubled'] is True and r3['used']['revive'] == 1 and r3['used']['resultDouble'] == 1, f"carry={r3['carry']} used={r3['used']}")
            # 부스트 + 이어받기 겹침
            c.reset(**RW)
            c.run_and_die(grow_to=1483)
            carry_now = c.rw()['carry']['mass']
            page.evaluate("() => window.__coilReward.arm()")
            page.evaluate("() => window.__ui.again().click()")
            page.wait_for_function("() => window.__coil.state().mode === 'play'", timeout=4000)
            r = c.rw()
            exp_mass = boosted_from(START_MASS + carry_now)
            chk('C8 ★부스트(길이 1.4배)가 이어받기 «위에» 곱해진다: spawn = boosted(START+carry)', abs(r['spawnMass'] - exp_mass) < 1e-6 and r['startBoostArmed'] is False, f"spawn={r['spawnMass']} exp={exp_mass} carry={carry_now}")
            chk('C8-b 부스트만(이어받기 0)은 예전과 같은 질량(R4 회귀 0)', boosted_from(START_MASS) == page.evaluate("() => window.__coilReward.boostMass()"), boosted_from(START_MASS))
            # 실패 경로: 미시청 → 지급 0 · 상한 0 · 전면형은 건너뛴다(광고가 떴으므로)
            # ★doubleAd() 는 «판정까지 기다린다»(dismissed 유예 3s 포함) — 그 뒤에 토스트를 바로 본다.
            #   예전엔 여기서 3.6초를 더 기다려 토스트(2.6초)가 이미 사라진 뒤에 재고 「실패」로 신고했다.
            c.reset(load='ok', show='dismissed', supported=True)
            c.run_and_die(grow_to=1483)
            c.ev("() => window.__coilReward.doubleAd()")
            toast = page.evaluate("() => window.__ui.toast()")
            page.wait_for_timeout(200)
            r = c.rw()
            chk('C9 미시청(dismissed) = 지급 0(doubled false)', r['carry']['doubled'] is False, r['carry'])
            chk('C9-a2 상한이 «안» 깎인다', r['used']['resultDouble'] == 0, r['used']['resultDouble'])
            # ★2026-09-10 기대값 정정 — 예전 줄은 「미시청이면 같은 화면에서 다시 제안된다」였고,
            #   그건 바로 아래 C9-b(광고가 «떴으므로» 같은 화면 전면형은 건너뛴다)와 «서로 모순»이었다.
            #   광고는 실제로 떴다(유저가 중간에 닫았을 뿐) — 같은 화면에서 또 제안하면 「한 화면 한 번」
            #   규율이 깨지고, 방금 안 보겠다고 한 유저에게 같은 요청을 또 내보내는 «헛요청»이 된다.
            #   대신 «기회를 영구히 잃지 않는다»를 아래 C9-a3b 가 실제로 확인한다(상한도 안 깎였다).
            chk('C9-a3 ★같은 결과 화면에서는 다시 제안하지 않는다(광고가 떴다 = 한 화면 한 번)',
                r['canDouble'] is False, r['canDouble'])
            chk('C9-a4 실패 사유 토스트가 뜬다(아무 말 없이 끝나지 않는다)', toast is not None, toast)
            chk('C9-b 광고가 «떴으므로» 같은 화면 전면형은 건너뛴다(rewardShownOnResult)', r['rewardShownOnResult'] is True)
            # ★C9-a3 의 «대조» — 감춘 것이 「이 화면에서만」인지 「영영」인지를 실제로 갈라 본다.
            #   여기서 canDouble 이 False 로 남는다면 위 C9-a3 는 「기회를 통째로 날린」 것이고, 그건 결함이다.
            b_used = r['used']['resultDouble']
            c.run_and_die(grow_to=1483)          # 다음 판 결과 화면
            r2 = c.rw()
            chk('C9-a3b ★대조 — 다음 판 결과 화면에서는 «다시» 제안된다(기회를 영구히 잃지 않는다)',
                r2['canDouble'] is True and r2['rewardShownOnResult'] is False and r2['used']['resultDouble'] == b_used,
                f"canDouble={r2['canDouble']} shown={r2['rewardShownOnResult']} used={r2['used']['resultDouble']}")
            c.reset(load='error', show='reward', supported=True)
            c.run_and_die(grow_to=1483)
            c.ev("() => window.__coilReward.doubleAd()"); page.wait_for_timeout(300)
            r = c.rw()
            chk('C9-c 로드 실패 = 광고가 «안 떴으므로» 전면형은 그대로 뜰 수 있다(rewardShownOnResult false)', r['rewardShownOnResult'] is False and r['carry']['doubled'] is False)
            chk('C9-d ★로드 실패 뒤에는 «부활» 제안이 그대로 남는다(노출 기회를 잃지 않는다)',
                r['canRevive'] is True and page.evaluate("() => window.__ui.shown(document.querySelector('.p-revive'))") is True,
                f"canRevive={r['canRevive']}")
            # 음성대조: 스텁 없으면(토스 밖) 성장 판이어도 버튼 0 · 기본 몫은 받는다
            c.reset()
            c.run_and_die(grow_to=1483)
            r = c.rw()
            chk('C10 음성대조: 토스 밖 = 2배 버튼 0 · 기본 몫은 «그대로» 확정', r['canDouble'] is False and page.evaluate("() => window.__ui.doubleBtn()")['hidden'] and r['carry']['base'] > 0, f"carry={r['carry']}")
            # ★진짜 대조 — 「이어받기가 없는 상태」를 실제로 만들어, C2 가 쓰는 판정식이 «뒤집히는지» 본다.
            #   ⛔예전엔 `ctl_(..., True)` 를 그냥 넘겨 대조가 «아무것도 실행하지 않았다»(Codex 지적 11).
            page.evaluate("() => window.__coilReward.reset()")
            page.wait_for_timeout(200)
            zero = c.rw()
            ctl_('C 대조: 이어받기를 «비우면» 같은 판정식이 뒤집힌다(행·버튼 사라짐 = 죽은 검사기 아님)',
                 zero['carry']['base'] == 0 and zero['canDouble'] is False
                 and page.evaluate("() => window.__ui.doubleBtn()")['hidden']
                 and page.evaluate("() => window.__ui.carryRow()")['hidden'])
            rep['errors'] += errs
            ctx.close()

            # 날짜 롤오버 — 어제 원장(used.resultDouble=3) → 오늘 0
            ctx, page, errs = new_ctx(browser, False, init_extra="localStorage.setItem('king-snake.reward.v1', JSON.stringify({v:1, day:'2000-01-01', used:{revive:5,startBoost:5,skinUnlock:3,growth:6,skinProgress:10,resultDouble:3}, skins:[]}))")
            boot(page)
            r = page.evaluate("() => window.__coilReward.state()")
            chk('C11 원장 날짜 롤오버: 어제 used=3 → 오늘 0(전 지면 0)', r['used']['resultDouble'] == 0 and r['used']['revive'] == 0, r['used'])
            ctx.close()

            # ══ P. 푸시 동의 ═══════════════════════════════════════════════════
            print('\n[P] 토스 푸시 동의 — 토스 밖 부재 / 토스 안 배선')
            ctx, page, errs = new_ctx(browser, False)
            boot(page)
            chk('P0 토스 밖: available=false · 「알림」 행 0 · 안내 카드 0(빈 래퍼 0)', page.evaluate("() => window.__coilPush.state().available") is False and page.evaluate("() => window.__ui.count('.push-group, .push-row, .p-nudge')") == 0)
            rows = page.evaluate("() => window.__ui.count('.p-set .row')")
            chk('P0-b 토스 밖 설정 행 수 = 3(조작·소리·언어) 그대로', rows == 3, rows)
            rep['errors'] += errs
            ctx.close()

            ctx, page, errs = new_ctx(browser, True)
            boot(page)
            c = Ctl(page)
            c.stub(load='ok', show='reward', supported=True)   # 광고는 스텁으로만(운영 ID 로컬 렌더 금지)
            page.wait_for_timeout(800)   # hydrate(네이티브 Storage 조회) 완료 대기
            # 대조 — 감청기가 살아 있는가
            page.evaluate("() => window.ReactNativeWebView.postMessage(JSON.stringify({type:'needle',functionName:'__needle__'}))")
            ok0 = ctl_('P 대조: 브릿지 감청기(postMessage)가 산다', page.evaluate("() => window.__KS_SENT.some(m => m.functionName === '__needle__')"))
            ok0 &= ctl_('P 대조: 네이티브 Storage 흉내가 «실제로 쓰인다»(SDK 가 getStorageItem 을 보냈다)', page.evaluate("() => window.__KS_SENT.some(m => m.functionName === 'getStorageItem')"))
            page.evaluate("() => setTimeout(() => { throw new Error('NEEDLE_PAGE'); }, 0)"); page.wait_for_timeout(200)
            ok0 &= ctl_('P 대조: pageerror 감시기', any('NEEDLE_PAGE' in e for e in errs))
            errs.clear()
            st = page.evaluate("() => window.__coilPush.state()")
            chk('P1 토스 안: available · hydrated · nudge', st['available'] is True and st['hydrated'] is True and st['nudge'] is True, st)
            code = page.evaluate("() => window.__coilPush.templateCode()")
            chk('P1-b templateCode 가 콘솔 값과 «글자 그대로» 같다', code == TEMPLATE_CODE_EXPECT, code)
            row = page.evaluate("() => window.__ui.pushRow()")
            chk('P1-c 「알림」 행 1 · 버튼 「받기」 · 44px 이상', row and row['connected'] and row['btn'] == '받기' and row['h'] >= 44 and row['w'] >= 44, row)
            chk('P1-d 힌트에 「8시 30분」·「토스 앱」(끄기 경로)', row and '8시 30분' in row['hint'] and '토스 앱' in row['hint'], row and row['hint'])
            order = page.evaluate("() => window.__ui.colOrder()")
            chk('P1-e 안내 카드가 기록 카드와 설정 카드 «사이»', [x.split(' ')[-1] for x in order] == ['p-stats', 'p-nudge', 'p-set', 'p-how'], order)
            nd = page.evaluate("() => window.__ui.nudge()")
            chk('P1-f 카드: 「받기」·닫기(aria-label) 둘 다 44px 이상 · 높이 ≤ 92', nd and nd['ctaH'] >= 44 and nd['ctaW'] >= 44 and nd['xW'] >= 44 and nd['xH'] >= 44 and nd['xLabel'] and nd['h'] <= 92, nd)
            gaps = page.evaluate("() => { const s=document.querySelector('.p-stats').getBoundingClientRect(); const n=document.querySelector('.p-nudge').getBoundingClientRect(); const t=document.querySelector('.p-set').getBoundingClientRect(); return [+(n.top-s.bottom).toFixed(2), +(t.top-n.bottom).toFixed(2)]; }")
            chk('P1-g 카드 위 12 · 아래 12(다른 카드 사이와 같은 리듬)', gaps == [12, 12], gaps)
            rows = page.evaluate("() => window.__ui.count('.p-set .row')")
            borders = page.evaluate("""() => {
              const g = document.querySelector('.push-group');
              const rows = [...document.querySelectorAll('.p-set .row')];
              const lang = rows.find((r) => !g.contains(r) && r === rows.filter((x) => !g.contains(x)).pop());
              return { push: getComputedStyle(document.querySelector('.push-row')).borderBottomWidth,
                       lang: lang ? getComputedStyle(lang).borderBottomWidth : null };
            }""")
            chk('P1-h 설정 행 4개 · 언어 행 밑줄 «있다»(알림과 갈린다) · 알림 행 밑줄 «없다»(바로 아래가 자기 힌트)',
                rows == 4 and borders['push'] == '0px' and borders['lang'] == '1px', (rows, borders))
            # 받기(행) → 진짜 SDK 가 addEventListener 를 postMessage
            page.evaluate("() => document.querySelector('.push-btn').click()")
            page.wait_for_timeout(600)
            subs = page.evaluate("() => window.__KS_PUSH_SUBS()")
            chk('P2 ★행 「받기」 → requestNotificationAgreement 구독 «1건» postMessage', len(subs) == 1, subs)
            chk('P2-b ★args.templateCode 가 콘솔 값과 «글자 그대로»', bool(subs) and (subs[-1].get('args') or {}).get('templateCode') == TEMPLATE_CODE_EXPECT, subs and subs[-1].get('args'))
            row = page.evaluate("() => window.__ui.pushRow()")
            nd = page.evaluate("() => window.__ui.nudge()")
            chk('P2-c 대기 중: 행 「확인 중」·disabled · 카드 CTA 「확인 중」', row['btn'] == '확인 중' and row['disabled'] and nd['cta'] == '확인 중' and nd['ctaDisabled'], (row['btn'], nd['cta']))
            page.evaluate("() => { document.querySelector('.push-btn').click(); document.querySelector('.nudge-cta').click(); }")
            page.wait_for_timeout(300)
            chk('P2-d ★대기 중 연속 탭(행+카드) → 구독 «1건» 그대로(busy 가드)', len(page.evaluate("() => window.__KS_PUSH_SUBS()")) == 1)
            fired = page.evaluate("() => window.__KS_PUSH_FIRE('newAgreement')")
            page.wait_for_timeout(800)
            chk('P2-e 이벤트가 «실제 구독자»에게 전달됐다(발화 전 구독 1건 · emitter 는 SDK 것)',
                fired.get('ok') is True and fired.get('listeners') == 1 and fired.get('emitter') == 'sdk', fired)
            chk('P2-e2 ★전달 뒤 그 구독은 «사라졌다»(SDK 가 스스로 해제 = 누수 0)', fired.get('after') == 0, fired.get('after'))
            removed = page.evaluate("() => window.__KS_SENT.filter(m => m.functionName==='requestNotificationAgreement' && m.type==='removeEventListener').length")
            chk('P2-f ★결과 뒤 브릿지 콜백 «해제»(removeEventListener 1)', removed == 1, removed)
            row = page.evaluate("() => window.__ui.pushRow()")
            st = page.evaluate("() => window.__coilPush.state()")
            chk('P2-g 행 「켜짐」·is-on · enabled · 카드 사라짐', row['btn'] == '켜짐' and row['on'] and st['enabled'] is True and page.evaluate("() => window.__ui.nudge()") is None, (row['btn'], st['enabled']))
            key = page.evaluate("() => window.__coilPush.key()")
            native = page.evaluate("() => window.__KS_STORE()")
            chk('P2-h ★네이티브 Storage 미러에 기록(agreedAt) + localStorage', key in native and 'agreedAt' in json.loads(native[key]) and 'agreedAt' in json.loads(page.evaluate("(k) => localStorage.getItem(k)", key) or '{}'), (key, native.get(key)))
            # 재시작 복원 — localStorage 를 지우고 새로고침(같은 컨텍스트 = 같은 네이티브 흉내 저장소)
            page.evaluate("(k) => localStorage.removeItem(k)", key)
            boot(page)
            page.wait_for_timeout(900)
            row = page.evaluate("() => window.__ui.pushRow()")
            chk('P3 ★재시작: localStorage 가 비어도 네이티브 Storage 에서 「켜짐」 복원', row and row['btn'] == '켜짐' and page.evaluate("() => window.__ui.nudge()") is None, row and row['btn'])
            page.evaluate("() => document.querySelector('.push-btn').click()"); page.wait_for_timeout(400)
            page.evaluate("() => window.__KS_PUSH_FIRE('alreadyAgreed')"); page.wait_for_timeout(500)
            chk('P3-b 켜진 뒤 재탭 → alreadyAgreed → 「켜짐」 유지', page.evaluate("() => window.__ui.pushRow()")['btn'] == '켜짐')
            chk('P3-c pageerror 0', not any('PAGEERROR' in e for e in errs), [e for e in errs if 'PAGEERROR' in e][:2])
            rep['errors'] += errs
            ctx.close()

            # 거부 · 오류 · 닫기 (새 컨텍스트 = 새 저장소)
            ctx, page, errs = new_ctx(browser, True)
            boot(page); page.wait_for_timeout(800)
            page.evaluate("() => document.querySelector('.push-btn').click()"); page.wait_for_timeout(400)
            page.evaluate("() => window.__KS_PUSH_FIRE('agreementRejected')"); page.wait_for_timeout(600)
            row = page.evaluate("() => window.__ui.pushRow()")
            chk('P4 거부 → 행 「다시 켜기」 · 카드 사라짐(귀찮게 하지 않는다)', row['btn'] == '다시 켜기' and not row['on'] and page.evaluate("() => window.__ui.nudge()") is None, row['btn'])
            page.evaluate("() => document.querySelector('.push-btn').click()"); page.wait_for_timeout(400)
            page.evaluate("() => window.__KS_PUSH_ERROR('UNSUPPORTED_APP_VERSION')"); page.wait_for_timeout(600)
            row = page.evaluate("() => window.__ui.pushRow()")
            chk('P5 onError → 힌트가 오류 문구(업데이트 안내)·is-error · 행은 다시 누를 수 있다 · 앱 무사', '업데이트' in row['hint'] and row['hintErr'] and not row['disabled'] and not any('PAGEERROR' in e for e in errs), row['hint'])
            rep['errors'] += errs
            ctx.close()

            ctx, page, errs = new_ctx(browser, True)
            boot(page); page.wait_for_timeout(800)
            chk('P6-pre 새 기기: 카드 있음', page.evaluate("() => window.__ui.nudge()") is not None)
            page.evaluate("() => document.querySelector('.nudge-x').click()"); page.wait_for_timeout(400)
            chk('P6 「닫기」 → 카드 사라짐 · 브릿지 구독 0 · 행은 「받기」로 남는다', page.evaluate("() => window.__ui.nudge()") is None and len(page.evaluate("() => window.__KS_PUSH_SUBS()")) == 0 and page.evaluate("() => window.__ui.pushRow()")['btn'] == '받기')
            boot(page); page.wait_for_timeout(900)
            chk('P6-b ★재시작 뒤에도 닫은 카드는 안 뜬다(기록 영속) · 행은 남는다', page.evaluate("() => window.__ui.nudge()") is None and page.evaluate("() => window.__ui.pushRow()") is not None)
            # 스텁 경로(브릿지 경계) — cleanup 호출 확인
            page.evaluate("() => window.__coilPush.reset()"); page.wait_for_timeout(300)
            page.evaluate("() => window.__coilPush.installStub('newAgreement', 50)")
            page.evaluate("() => window.__coilPush.enable()")
            page.wait_for_timeout(300)
            calls = page.evaluate("() => window.__coilPushCalls")
            st = page.evaluate("() => window.__coilPush.state()")
            chk('P7 스텁 경로: 요청 1 · templateCode 일치 · 결과 뒤 cleanup 1 · enabled', calls['requests'] == 1 and calls['codes'] == [TEMPLATE_CODE_EXPECT] and calls['cleanups'] == 1 and st['enabled'] is True, (calls, st['enabled']))
            page.evaluate("() => window.__coilPush.reset()"); page.wait_for_timeout(200)
            page.evaluate("() => window.__coilPush.installStub('throw')")
            page.evaluate("() => window.__coilPush.enable()"); page.wait_for_timeout(300)
            st = page.evaluate("() => window.__coilPush.state()")
            chk('P7-b 스텁 동기 throw → busy 해제 · error 기록 · 앱 무사', st['busy'] is False and st['error'] != '' and not any('PAGEERROR' in e for e in errs), st)
            page.evaluate("() => window.__coilPush.removeStub()")
            rep['errors'] += errs
            ctx.close()

            # ══ X. 교차추천 ════════════════════════════════════════════════════
            print('\n[X] 「머니 리그」 교차추천 — 하루 1회 · openURL')
            ctx, page, errs = new_ctx(browser, True)
            boot(page); c = Ctl(page)
            c.stub(load='ok', show='reward', supported=True)
            page.wait_for_timeout(300)
            url = page.evaluate("() => window.__coilXpromo.url()")
            chk('X0 딥링크가 지시값과 «글자 그대로»', url == XPROMO_URL_EXPECT, url)
            chk('X0-b 오늘 아직 안 보였다(canShow)', page.evaluate("() => window.__coilXpromo.canShow()") is True)
            c.run_and_die(grow_to=600)
            xp = page.evaluate("() => window.__ui.xpromo()")
            snap = page.evaluate("() => window.__coilXpromo.state()")
            chk('X1 ★첫 결과 화면: 카드 보임 · 제목 「머니 리그」·태그 「추천」·부제 · 열기/닫기 44px 이상', xp and not xp['hidden'] and xp['title'] == '머니 리그' and xp['tag'] == '추천' and '1만 명' in xp['sub'] and xp['open'] == '열기' and xp['openH'] >= 44 and xp['openW'] >= 44 and xp['xW'] >= 44 and xp['xH'] >= 44 and xp['xLabel'], xp)
            chk('X1-b 노출일 기록 = 오늘 · shows 1', snap['shownDay'] == snap['today'] and snap['shows'] == 1, snap)
            order = page.evaluate("() => Array.from(document.querySelectorAll('.overlay')[2].querySelector('.panel').children).map(n => n.className.split(' ').pop())")
            chk('X1-c 자리 = 「다시 하기」 행 «아래» 마지막', order[-1] == 'p-xpromo' and order[-2] == 'btn-row', order)
            page.evaluate("() => document.querySelector('.xpromo-open').click()")
            page.wait_for_timeout(600)
            opens = page.evaluate("() => window.__KS_OPEN_CALLS()")
            chk('X2 ★「열기」 → openURL 브릿지 args[0] = intoss://moneyleague(진짜 bridge-core 경로) · clicks 1', opens == [XPROMO_URL_EXPECT] and page.evaluate("() => window.__coilXpromo.state().clicks") == 1, opens)
            page.evaluate("() => window.__ui.again().click()"); page.wait_for_timeout(250)
            c.run_and_die(grow_to=600)
            xp = page.evaluate("() => window.__ui.xpromo()")
            chk('X3 ★같은 날 두 번째 결과 화면 = 카드 없음(하루 1회)', xp is not None and xp['hidden'] and page.evaluate("() => window.__coilXpromo.canShow()") is False, xp)
            # 닫기
            page.evaluate("() => window.__coilXpromo.reset()")
            page.evaluate("() => window.__ui.again().click()"); page.wait_for_timeout(250)
            c.run_and_die(grow_to=600)
            chk('X4-pre 기록을 비우면 다시 보인다', not page.evaluate("() => window.__ui.xpromo()")['hidden'])
            page.evaluate("() => document.querySelector('.xpromo-x').click()"); page.wait_for_timeout(300)
            chk('X4 「닫기」 → 카드 숨김 · openURL 호출 없음(그대로 1)', page.evaluate("() => window.__ui.xpromo()")['hidden'] and len(page.evaluate("() => window.__KS_OPEN_CALLS()")) == 1)
            # 스텁 경로 — 열기 결과 «세 갈래»가 화면에 어떻게 나타나는가(땅따먹기 -28 규율 이식)
            page.evaluate("() => window.__coilXpromo.installOpenStub('ok')")
            page.evaluate("() => window.__coilXpromo.open()"); page.wait_for_timeout(200)
            chk('X5 스텁 경로: open() → 호출 인자 = 딥링크', page.evaluate("() => window.__coilOpenCalls") == [XPROMO_URL_EXPECT])
            # (a) 실패로 «확인»된 경우 = 실패 문구
            page.evaluate("() => window.__coilXpromo.reset()")
            page.evaluate("() => window.__coilXpromo.installOpenStub('fail')")
            page.evaluate("() => window.__ui.again().click()"); page.wait_for_timeout(250)
            c.run_and_die(grow_to=600)
            chk('X5-a-pre 카드가 다시 보이고 실패 문구는 «아직» 없다', not page.evaluate("() => window.__ui.xpromo()")['hidden'] and page.evaluate("() => window.__coilXpromo.failed()") is False)
            page.evaluate("() => document.querySelector('.xpromo-open').click()")
            page.wait_for_timeout(500)
            xp = page.evaluate("() => window.__ui.xpromo()")
            chk('X5-a ★열기 실패(reject) → 카드 부제가 «실패 문구»로 바뀐다 · 버튼은 다시 누를 수 있다', page.evaluate("() => window.__coilXpromo.failed()") is True and '다시' in xp['sub'] and page.evaluate("() => document.querySelector('.xpromo-open').disabled") is False, xp['sub'])
            # (b) 무응답 = «실패로 단정하지 않는다»(앱이 열려서 WebView 가 멈춘 경우)
            page.evaluate("() => window.__coilXpromo.reset()")
            page.evaluate("() => window.__coilXpromo.installOpenStub('silent')")
            page.evaluate("() => window.__ui.again().click()"); page.wait_for_timeout(250)
            c.run_and_die(grow_to=600)
            page.evaluate("() => document.querySelector('.xpromo-open').click()")
            page.wait_for_timeout(400)
            chk('X5-b-pre 대기 중: 버튼 disabled(연타 잠금) · 실패 문구 없음', page.evaluate("() => document.querySelector('.xpromo-open').disabled") is True and page.evaluate("() => window.__coilXpromo.failed()") is False)
            n_calls = len(page.evaluate("() => window.__coilOpenCalls"))
            page.evaluate("() => document.querySelector('.xpromo-open').click()")
            page.wait_for_timeout(200)
            chk('X5-b2 대기 중 연타 → 브릿지 호출 «그대로»', len(page.evaluate("() => window.__coilOpenCalls")) == n_calls, n_calls)
            page.wait_for_timeout(4200)
            chk('X5-b ★4초 무응답 = 실패 문구를 «띄우지 않는다»(앱이 열렸을 수 있다) · 버튼 복구', page.evaluate("() => window.__coilXpromo.failed()") is False and page.evaluate("() => document.querySelector('.xpromo-open').disabled") is False)
            page.evaluate("() => window.__coilXpromo.removeOpenStub()")
            chk('X-err pageerror 0', not any('PAGEERROR' in e for e in errs), [e for e in errs if 'PAGEERROR' in e][:2])
            rep['errors'] += errs
            ctx.close()
            # 날짜 롤오버(어제 기록) → 오늘 보인다
            ctx, page, errs = new_ctx(browser, True, init_extra="localStorage.setItem('king-snake.xpromo.v1', JSON.stringify({shownDay:'2000-01-01', shows:1, clicks:0}))")
            boot(page)
            chk('X6 날짜 롤오버: 어제 노출 기록 → 오늘 canShow true', page.evaluate("() => window.__coilXpromo.canShow()") is True)
            ctx.close()
            # 토스 밖
            ctx, page, errs = new_ctx(browser, False)
            boot(page); c = Ctl(page); c.stub(load='ok', show='reward', supported=True)
            c.run_and_die(grow_to=600)
            chk('X7 토스 밖: 결과 화면에 카드 «없다»(hidden) · canShow false', page.evaluate("() => window.__ui.xpromo()")['hidden'] and page.evaluate("() => window.__coilXpromo.canShow()") is False)
            ctx.close()

            # ══ V. Codex 적대적 리뷰(2026-09-10) 수정분 «실행» 검증 ══════════════
            print('\n[V] 리뷰 지적 수정분 — 고쳤다가 아니라 «작동을 확인했다»로 끝낸다')
            ctx, page, errs = new_ctx(browser, True)
            boot(page)
            c = Ctl(page)
            # V1(지적 2) 리워드 로딩 중 화면 전환 → 전면형과 «동시 show» 0
            c.reset(load='ok', show='reward', supported=True)
            c.run_and_die(grow_to=1483)                       # 1판: 빚 없음
            page.evaluate("() => window.__ui.again().click()"); page.wait_for_timeout(250)
            c.run_and_die(grow_to=1483)                       # 2판: 빚 발생 → 전면형 준비
            page.wait_for_timeout(600)
            st = c.ads()
            chk('V1-pre 전면형이 «준비된» 결과 화면이다(빚·ready)', st['adPending'] is True and st['adReady'] is True, f"pending={st['adPending']} ready={st['adReady']}")
            page.evaluate("(b) => window.__coilAds.installStub(b)", dict(load='silent', show='reward', supported=True))
            page.evaluate("() => { window.__coilReward.doubleAd(); }")   # 로드가 «안 끝나는» 리워드
            page.wait_for_timeout(500)
            b_show = c.calls()['show']
            again_disabled = page.evaluate("() => window.__ui.again().disabled")
            page.evaluate("() => window.__ui.again().click()")
            page.wait_for_timeout(700)
            chk('V1 ★리워드 로딩 중 「다시 하기」 → 전면형 show 0 · 화면 그대로(광고 2편 겹침 0)',
                c.calls()['show'] - b_show == 0 and c.mode() == 'dead', f"show+{c.calls()['show'] - b_show} mode={c.mode()}")
            chk('V1-b 그 버튼은 «눌리지 않게» 잠겨 있다(죽은 버튼이 아니라 disabled)', again_disabled is True, again_disabled)
            page.wait_for_timeout(8200)   # 리워드 로드 타임아웃(8s) — 상태를 원래대로 돌려놓는다
            chk('V1-c 로드 타임아웃 뒤 버튼 잠금이 «풀린다»', page.evaluate("() => window.__ui.again().disabled") is False)

            # V2(지적 6) 늦은 2배 보상이 «메뉴에서» 도착해도 지급된다
            c.reset(load='ok', show='veryLateReward', supported=True)
            c.run_and_die(grow_to=1483)
            base_v2 = c.rw()['carry']['base']
            page.evaluate("() => { window.__coilReward.doubleAd(); }")
            page.wait_for_timeout(3300)                        # dismissed 유예 3s → 실패 판정
            page.evaluate("() => window.__coil.toMenu()")       # 결과 화면을 «떠난다»
            page.wait_for_timeout(1500)                         # 4.2s 째 늦은 보상 도착
            r = c.rw()
            chk('V2 ★메뉴로 옮긴 뒤 도착한 늦은 보상도 «지급»된다(예전엔 통째로 사라졌다)',
                r['carry']['doubled'] is True and r['carry']['mass'] == base_v2 * DK and r['used']['resultDouble'] == 1,
                f"carry={r['carry']} used={r['used']['resultDouble']}")

            # V3(지적 4) 숨김 중 리워드 «표시» 0
            c.reset(load='ok', show='reward', supported=True)
            c.run_and_die(grow_to=1483)
            page.evaluate("(b) => window.__coilAds.installStub(b)", dict(load='ok', show='reward', supported=True))
            b_show = c.calls()['show']
            page.evaluate(HIDDEN_JS, True)
            page.evaluate("() => { window.__coilReward.doubleAd(); }")
            page.wait_for_timeout(900)
            chk('V3 ★숨김 중 탭이 들어와도 광고를 «띄우지 않는다»(show 0) · 상한도 안 깎인다',
                c.calls()['show'] - b_show == 0 and c.rw()['used']['resultDouble'] == 0,
                f"show+{c.calls()['show'] - b_show} used={c.rw()['used']['resultDouble']}")
            page.evaluate(HIDDEN_JS, False)
            page.wait_for_timeout(300)
            chk('V3-b 다시 보이면 제안이 «그대로» 남아 있다(기회를 잃지 않는다)', c.rw()['canDouble'] is True, c.rw()['canDouble'])

            # V4(지적 9) 교차추천 하루 기준 = KST
            today_kst = time.strftime('%Y-%m-%d', time.gmtime(time.time() + 9 * 3600))
            chk('V4 ★교차추천의 「오늘」이 KST 날짜다(기기 시간대와 무관)',
                page.evaluate("() => window.__coilXpromo.state().today") == today_kst,
                f"app={page.evaluate('() => window.__coilXpromo.state().today')} kst={today_kst}")

            # V5(지적 10) openURL 무응답 상한 — 리스너 누수를 «횟수로» 닫는다
            page.evaluate("() => window.__coilXpromo.reset()")
            page.evaluate("() => window.__coilXpromo.installOpenStub('silent')")
            for _ in range(3):
                page.evaluate("() => { window.__coilXpromo.open(); }")
                page.wait_for_timeout(4300)
            n3 = len(page.evaluate("() => window.__coilOpenCalls"))
            page.evaluate("() => { window.__coilXpromo.open(); }")
            page.wait_for_timeout(300)
            chk('V5 ★무응답 3회 뒤에는 브릿지를 «더 부르지 않는다»(리스너 상한)',
                n3 == 3 and len(page.evaluate("() => window.__coilOpenCalls")) == 3 and page.evaluate("() => window.__coilXpromo.unknowns()") == 3,
                f"calls={len(page.evaluate('() => window.__coilOpenCalls'))} unknowns={page.evaluate('() => window.__coilXpromo.unknowns()')}")
            page.evaluate("() => window.__coilXpromo.removeOpenStub()")
            rep['errors'] += errs
            ctx.close()

            # V6(지적 7) 푸시 복원 경합 — 늦게 도착한 «빈» 응답이 방금 한 동의를 덮지 않는다
            ctx, page, errs = new_ctx(browser, True, init_extra="window.__KS_STORAGE_DELAY = 2500;")
            boot(page)
            page.evaluate("() => document.querySelector('.push-btn').click()")
            page.wait_for_timeout(500)
            page.evaluate("() => window.__KS_PUSH_FIRE('newAgreement')")
            page.wait_for_timeout(400)
            mid = page.evaluate("() => window.__coilPush.state()")
            chk('V6-pre 복원이 «아직 끝나기 전»에 동의가 끝났다', mid['enabled'] is True, mid)
            page.wait_for_timeout(3000)      # 늦은 빈 응답 도착
            after = page.evaluate("() => window.__coilPush.state()")
            chk('V6 ★늦게 도착한 옛 응답이 동의를 «덮지 않는다»(enabled 유지 · 안내 카드 안 뜸)',
                after['enabled'] is True and after['nudge'] is False and after['hydrated'] is True, after)

            # V7(지적 8) 동기 콜백 cleanup
            page.evaluate("() => window.__coilPush.reset()"); page.wait_for_timeout(200)
            page.evaluate("() => window.__coilPush.installStub('newAgreement', -1)")   # 반환 «전»에 동기 호출
            page.evaluate("() => window.__coilPush.enable()")
            page.wait_for_timeout(400)
            calls = page.evaluate("() => window.__coilPushCalls")
            chk('V7 ★동기 콜백에서도 cleanup 이 «1회» 불린다(리스너 누수 0)',
                calls['requests'] == 1 and calls['cleanups'] == 1 and page.evaluate("() => window.__coilPush.state().enabled") is True, calls)
            page.evaluate("() => window.__coilPush.removeStub()")
            rep['errors'] += errs
            ctx.close()

            # ══ I. 로케일 · 폭 ═════════════════════════════════════════════════
            print('\n[I] ko/en × 375/390/430 — 넘침·raw 키·보간·이모지·터치 타깃')
            for lang in ('ko', 'en'):
                for w in (375, 390, 430):
                    ctx, page, errs = new_ctx(browser, True, lang=lang, width=w)
                    boot(page); c = Ctl(page); c.stub(load='ok', show='reward', supported=True)
                    page.wait_for_timeout(700)
                    sel_menu = '.p-nudge, .push-group'
                    ov = page.evaluate("(s) => window.__ui.overflow(s)", sel_menu)
                    sm = page.evaluate("(s) => window.__ui.smallTargets(s)", sel_menu)
                    rk = page.evaluate("(s) => window.__ui.rawKeys(s)", sel_menu)
                    ip = page.evaluate("(s) => window.__ui.interp(s)", sel_menu)
                    em = page.evaluate("(s) => window.__ui.emoji(s)", sel_menu)
                    nd = page.evaluate("() => window.__ui.nudge()")
                    chk(f'I-{lang}-{w} 메뉴(카드·알림 행): 넘침 0 · 44px 미만 0 · raw 키 0 · 보간 0 · 이모지 0 · 카드 ≤ 92px', not ov and not sm and not rk and not ip and not em and nd and nd['h'] <= 92, (ov[:2], sm[:2], rk[:2], ip[:2], em[:2], nd and nd['h']))
                    if w == 390:
                        page.screenshot(path=str(OUT / f'menu_{lang}_{w}.png'))
                    c.run_and_die(grow_to=1483)
                    sel_res = '.p-double, .kv-carry, .p-xpromo'
                    ov = page.evaluate("(s) => window.__ui.overflow(s)", sel_res)
                    sm = page.evaluate("(s) => window.__ui.smallTargets(s)", sel_res)
                    rk = page.evaluate("(s) => window.__ui.rawKeys(s)", sel_res)
                    ip = page.evaluate("(s) => window.__ui.interp(s)", sel_res)
                    em = page.evaluate("(s) => window.__ui.emoji(s)", sel_res)
                    btn = page.evaluate("() => window.__ui.doubleBtn()")
                    chk(f'I-{lang}-{w} 결과(2배 버튼·행·카드): 넘침 0 · 44px 미만 0 · raw 키 0 · 보간 0 · 이모지 0 · 버튼 보임', not ov and not sm and not rk and not ip and not em and btn and not btn['hidden'], (ov[:2], sm[:2], rk[:2], ip[:2], em[:2]))
                    page.screenshot(path=str(OUT / f'result_{lang}_{w}.png'))
                    chk(f'I-{lang}-{w} pageerror 0', not any('PAGEERROR' in e for e in errs), [e for e in errs if 'PAGEERROR' in e][:1])
                    ctx.close()
        finally:
            srv.shutdown()
            srv.server_close()

    chk('Z 외부 네트워크 요청 0건(운영 지면 ID 로컬 렌더 금지)', len(rep['external']) == 0, rep['external'][:3])
    chk('Z 콘솔 에러 0건(NEEDLE 대조 제외)', not [e for e in rep['errors'] if 'NEEDLE' not in e], [e for e in rep['errors'] if 'NEEDLE' not in e][:3])
    (OUT / 'report.json').write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding='utf-8')
    passed = sum(1 for _, ok, _ in rep['checks'] if ok)
    print(f"\n대조 {sum(1 for _, c in rep['controls'] if c)}/{len(rep['controls'])} · 검사 {passed}/{len(rep['checks'])} · 화면별 요청 {rep['requests_per_screen']}")
    if rep['fail']:
        print('FAILED:')
        for n, d in rep['fail']:
            print('  -', n, d)
        return 1
    print('OK')
    return 0


if __name__ == '__main__':
    sys.exit(main())
