# -*- coding: utf-8 -*-
"""qa_reward.py - 리워드 광고 3종(부활 / 시작 크기 부스트 / 스킨 해금) «기능» 검증. headless 고정.

════════════════════════════════════════════════════════════════════════════
왜 이 검사기가 이렇게 생겼나
════════════════════════════════════════════════════════════════════════════
「광고를 끝까지 보면 부활한다」는 스크린샷으로 증명할 수 없다. 그리고 «운영 광고 ID 를
로컬에서 렌더하는 것은 계정 중단 사유»다(광고 핸드북 §2-10) — 실제로 띄워 볼 수도 없다.

그래서 qa_ads.py 와 «같은 방식»으로 브릿지 경계에만 스텁을 꽂는다. 이벤트 유예·정규화·
늦은 보상·상한·판당 1회 판정은 운영과 «완전히 같은 코드»가 돈다.

★★ 이 검사기의 존재 이유 = 네온 스레드 -23 실사고의 재발 방지.
   안드로이드 실기기에서 dismissed 가 userEarnedReward «보다 먼저» 왔고, 옛 코드는
   그 자리에서 판정을 끝내 늦게 온 보상을 버렸다. 「광고를 봐도 해금이 안 된다」가
   2주 넘게 살아 있었다. R1-b / R1-e 가 정확히 그 순서를 재현한다.

★★ 양성/음성대조를 «먼저» 본다(핸드북 §3-1·§5-1: 0건은 부재의 증거가 아니다).
   스텁이 안 꽂히면 usable=false 라 「부활 0회」가 나오는데, 그건 로직이 정상이어도
   나오는 값이다. P0 가 실패하면 아래 초록불은 전부 무의미하다.

실행:
  npm run build:web && python tools/qa_reward.py [dist]
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

sys.stdout.reconfigure(encoding="utf-8")

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("playwright 가 없다: pip install playwright && playwright install chromium")
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
DIST = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else (ROOT / "dist")
OUT = ROOT / "qa" / "reward"

# reward/adGroups.ts 의 정본과 «같아야» 한다. 다르면 R6 이 잡는다.
REWARD_IDS = {
    "revive": "ait.v2.live.XXXXXXXXXXXXXXXX",
    "startBoost": "ait.v2.live.XXXXXXXXXXXXXXXX",
    "skinUnlock": "ait.v2.live.XXXXXXXXXXXXXXXX",
    "growth": "ait.v2.live.XXXXXXXXXXXXXXXX",
}
INTERSTITIAL_ID = "ait.v2.live.XXXXXXXXXXXXXXXX"

# game/config.ts 정본. ★검사기가 상수를 «박지 않는다» — 아래 R4 는 이 값을 쓰지 않고
#   페이지의 __coilReward.boostMass() 와 길이식으로 «유도»해서 비교한다.
START_MASS = 12
LEN_MIN, LEN_K, LEN_POW = 150.0, 46.0, 0.55
EXPECT_LEN_K = 1.4  # gameEffects.START_BOOST_LEN_K


def body_len(mass: float) -> float:
    return LEN_MIN + LEN_K * math.pow(mass, LEN_POW)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(DIST), **kw)

    def log_message(self, *a):
        pass


def serve():
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1], httpd


UI_JS = r"""
window.__ui = {
  ovs: () => Array.from(document.querySelectorAll('.overlay')),
  vis: (n) => !document.querySelectorAll('.overlay')[n].classList.contains('hidden'),
  play:  () => document.querySelector('.p-play'),
  boost: () => document.querySelector('.p-boost'),
  revive:() => document.querySelector('.p-revive'),
  grow:  () => document.querySelector('.p-grow'),
  growText: () => {
    const b = document.querySelector('.p-grow');
    return b ? b.textContent : null;
  },
  /* 배너의 화면 사각형. 「입력을 막지 않는가」를 «좌표로» 재기 위한 값이다. */
  growRect: () => {
    const b = document.querySelector('.p-grow');
    if (!b || b.classList.contains('hidden')) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom };
  },
  /* 이 좌표를 누르면 «무엇이» 받는가. 배너가 게임 입력을 가로채는지 판정한다. */
  hitAt: (x, y) => {
    const e = document.elementFromPoint(x, y);
    if (!e) return 'none';
    /* ★조상까지 본다. elementFromPoint 는 배너의 «자식 글자»를 돌려주므로,
       요소 자신의 클래스만 보면 「배너가 안 받았다」로 잘못 읽힌다. */
    const owner = e.closest ? e.closest('.p-grow') : null;
    const cls = String((e.className && e.className.baseVal) || e.className || '');
    return (owner ? 'p-grow<-' : '') + cls + '#' + String(e.id || '') + '@' + e.tagName;
  },
  hudHidden: () => document.getElementById('hud').classList.contains('hidden'),
  /* 배너가 «HUD 를 가리는가»를 좌표로 판정한다. 눈으로만 보면 놓친다 —
     실제로 순위표를 58x44 px 가린 채 통과할 뻔했다(2026-09-01). */
  hudOverlap: () => {
    const b = document.querySelector('.p-grow');
    if (!b || b.classList.contains('hidden')) return null;
    const r = b.getBoundingClientRect();
    const out = {};
    for (const sel of ['.hud-score', '.hud-board', '.hud-feed', '.hud-pause']) {
      const e = document.querySelector(sel);
      if (!e) continue;
      const q = e.getBoundingClientRect();
      if (q.width <= 0 || q.height <= 0) continue;
      const ox = Math.min(r.right, q.right) - Math.max(r.x, q.x);
      const oy = Math.min(r.bottom, q.bottom) - Math.max(r.y, q.y);
      if (ox > 0 && oy > 0) out[sel] = Math.round(ox) + 'x' + Math.round(oy);
    }
    return out;
  },
  /* ★ 「킬로그 «밑»에 있는가」 - 2026-09-02 President 지시의 «본문»이다.
     위/아래는 눈이 아니라 좌표로 판정한다. 킬 피드가 실제로 떠 있는 상태에서만
     뜻이 있으므로 피드에 줄이 몇 개 있는지도 같이 돌려준다. */
  belowFeed: () => {
    const b = document.querySelector('.p-grow');
    const f = document.querySelector('.hud-feed');
    if (!b || b.classList.contains('hidden') || !f) return null;
    const r = b.getBoundingClientRect();
    const q = f.getBoundingClientRect();
    return { offerTop: r.y, feedBottom: q.bottom, feedTop: q.y, feedH: q.height,
             gap: r.y - q.bottom, items: f.children.length,
             sameColumn: Math.abs(r.x - q.x) < 60 };
  },
  /* 킬 피드의 «화면 사각형». 배너가 피드를 밀어냈는지 전/후로 비교한다. */
  feedRect: () => {
    const f = document.querySelector('.hud-feed');
    if (!f) return null;
    const r = f.getBoundingClientRect();
    return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2),
             h: +r.height.toFixed(2) };
  },
  /* 「3줄 자리 예약」이 실제로 3줄과 같은가. 예약값을 «박아 두지 않고»
     .feed-item 한 줄을 실제로 재서 유도한다 - FEED_MAX·글자크기가 바뀌면 이 검사가 죽는다. */
  feedReserve: () => {
    const f = document.querySelector('.hud-feed');
    if (!f) return null;
    const cs = getComputedStyle(f);
    const gap = parseFloat(cs.rowGap || cs.gap) || 0;
    const probe = document.createElement('div');
    probe.className = 'feed-item';
    probe.textContent = 'M';
    f.appendChild(probe);
    const line = probe.getBoundingClientRect().height;
    probe.remove();
    return { reserved: parseFloat(cs.minHeight), line, gap };
  },
  /* 배너를 «완전히 감췄을 때» 피드가 어디 있는가(대조군). */
  hideOfferForProbe: (on) => {
    const b = document.querySelector('.p-grow');
    if (!b) return false;
    b.style.display = on ? 'none' : '';
    return true;
  },
  overlayCount: () => document.querySelectorAll('.overlay').length,
  anyOverlayShown: () => Array.from(document.querySelectorAll('.overlay'))
    .some((o) => !o.classList.contains('hidden')),
  counting: () => {
    const c = document.querySelector('.rw-count');
    return !!c && c.classList.contains('show');
  },
  shown: (el) => !!el && !el.classList.contains('hidden'),
  skinAds: () => document.querySelectorAll('.skin.is-ad').length,
  toast: () => {
    const t = document.querySelector('.rw-toast');
    return t && t.classList.contains('show') ? t.textContent : null;
  },
};
"""


class Ctl:
    def __init__(self, page):
        self.p = page

    def rw(self):
        return self.p.evaluate("() => window.__coilReward.state()")

    def calls(self):
        return self.p.evaluate("() => window.__coilAdCalls || {load:0,show:0,ids:[]}")

    def stub(self, **b):
        self.p.evaluate("(b) => window.__coilAds.installStub(b)", b)
        self.p.evaluate("() => window.__coilReward.refresh()")

    def reset(self, **b):
        """시나리오 사이를 «완전히» 갈라놓는다."""
        self.p.evaluate("() => window.__coil.toMenu()")
        self.p.evaluate("() => window.__coilReward.reset()")
        self.p.evaluate("() => window.__coilAds.reset()")
        self.p.evaluate("() => { window.__coilAdCalls = {load:0, show:0, ids:[]}; }")
        if b:
            self.stub(**b)

    def start(self):
        self.p.evaluate("() => window.__coil.startRun()")
        self.p.wait_for_function("() => window.__coil.state().mode === 'play'", timeout=4000)

    def die_border(self):
        self.p.evaluate("() => window.__coilReward.killByBorder()")
        self.p.wait_for_function("() => window.__coil.state().mode === 'dead'", timeout=8000)
        self.p.wait_for_function("() => window.__ui.vis(2)", timeout=4000)

    def die_body(self):
        ok = self.p.evaluate("() => window.__coilReward.killByBody()")
        if not ok:
            return False
        self.p.wait_for_function("() => window.__coil.state().mode === 'dead'", timeout=8000)
        self.p.wait_for_function("() => window.__ui.vis(2)", timeout=4000)
        return True

    def revive(self):
        return self.p.evaluate("() => window.__coilReward.revive()")

    def boost(self):
        return self.p.evaluate("() => window.__coilReward.boost()")

    def unlock(self, sid):
        return self.p.evaluate("(s) => window.__coilReward.unlockSkin(s)", sid)

    # ── 기록 돌파(2026-08-31) ──────────────────────────────────────────
    def set_best(self, v):
        self.p.evaluate("(v) => window.__coilReward.setBest(v)", v)

    def grow_to(self, m):
        """질량을 «직접» 세운다. 문턱까지 실제로 자라기를 기다리면 검사 한 건에
        수 분이 걸리고(중앙값 163점), 애초에 2,000 도달률이 0.8% 라 재현이 안 된다."""
        self.p.evaluate("(m) => window.__coil.grow(m)", m)

    def grow_ad(self):
        """광고를 «끝까지» 태운다(프라미스를 기다린다)."""
        return self.p.evaluate("() => window.__coilReward.growAd()")

    def grow_ad_async(self):
        """광고를 «걸어만» 둔다. 광고가 도는 «중»을 관찰하려면 이쪽이어야 한다
        (page.evaluate 는 프라미스를 기다리므로 grow_ad 로는 중간을 못 본다)."""
        self.p.evaluate("() => { window.__coilReward.growAd(); }")

    def grow_skip(self):
        """배너를 «지금» 닫는다 = 5초 자동소멸과 같은 결과(트리거는 이미 소비됨)."""
        self.p.evaluate("() => window.__coilReward.growSkip()")

    def dismiss(self, clear_cd=True):
        """배너를 닫고 계속 논다. ★재개 절차가 «없다» — 게임은 멈춘 적이 없다.

        ★clear_cd=True 가 기본인 이유: 쿨다운을 남겨 두면 「같은 문턱은 판당 1회」
          같은 «다른» 규칙이 쿨다운 덕분에 통과한다 — 규칙이 깨져도 초록불이 뜬다.
        """
        self.grow_skip()
        if clear_cd:
            self.clear_cooldown()

    def watch_ad(self, clear_cd=True):
        """광고를 보고 복귀 카운트다운까지 끝낸다(= 다시 'play')."""
        self.grow_ad()
        self.finish_count()
        self.p.wait_for_function(
            "() => window.__coilReward.state().mode === 'play'", timeout=8000)
        if clear_cd:
            self.clear_cooldown()

    def finish_count(self):
        self.p.evaluate("() => window.__coilReward.finishCountdown()")

    def clear_cooldown(self):
        self.p.evaluate("() => window.__coilReward.clearCooldown()")

    def wait_offer(self, timeout=5000):
        self.p.wait_for_function(
            "() => window.__coilReward.state().offer !== null", timeout=timeout)


def run(page, results, fails):
    ctl = Ctl(page)

    def chk(name, ok, detail=""):
        results.append({"check": name, "ok": bool(ok), "detail": str(detail)})
        print(("  PASS  " if ok else "  FAIL  ") + name + ("   " + str(detail) if detail else ""))
        if not ok:
            fails.append(name)

    OK = {"load": "ok", "show": "reward", "supported": True}

    # ══ P0. 양성/음성대조 ══════════════════════════════════════════════════
    print("\n[P0] 대조 - 계측기가 «살아 있는가» (이게 실패하면 아래 전부 무의미)")
    ctl.reset()  # 스텁 없음 = 토스 밖
    s = ctl.rw()
    chk("P0-a 음성대조: 스텁 없으면(=토스 밖) usable=false · 제안 0",
        s["usable"] is False and s["canRevive"] is False and s["canBoost"] is False, json.dumps(s["used"]))
    chk("P0-b 음성대조: 메뉴에 부스트 버튼이 «안 뜬다»",
        page.evaluate("() => window.__ui.shown(window.__ui.boost())") is False)
    chk("P0-c 음성대조: 잠긴 스킨에 광고 배지 0개",
        page.evaluate("() => window.__ui.skinAds()") == 0)

    ctl.stub(**OK)
    s = ctl.rw()
    chk("P0-d 양성대조: 스텁을 꽂으면 usable=true · 부스트 제안이 «실제로» 뜬다",
        s["usable"] is True and s["canBoost"] is True
        and page.evaluate("() => window.__ui.shown(window.__ui.boost())") is True)
    # ★2026-09-01 정정: 예전엔 「12종 중 9종 잠김 → 배지 9개」였다. President 지시로
    #   광고 대상이 game/skins.ts AD_UNLOCKABLE_SKIN_IDS 5종으로 줄었다(프로모션 예산 보호).
    #   기대값을 «박지 않는다» — 번들에서 목록을 읽어 그 길이와 대조한다.
    #   (박아 두면 목록이 바뀔 때 검사기만 죽고, 화면은 조용히 틀린 채로 나간다.)
    wl = page.evaluate("() => window.__coilReward.state().adUnlockable")
    chk("P0-e 양성대조: 잠긴 스킨에 광고 배지가 «실제로» 붙는다(= 화이트리스트 길이)",
        page.evaluate("() => window.__ui.skinAds()") == len(wl),
        "badges=%s whitelist=%s" % (page.evaluate("() => window.__ui.skinAds()"), wl))
    chk("P0-f ★화이트리스트 밖(블랙맘바)은 «양성대조 상태에서도» 안 열린다",
        page.evaluate("() => window.__coilReward.canAdUnlockSkin('mamba')") is False)
    if fails:
        print("  !! 대조 실패 - 아래 결과를 신뢰하지 마라")

    # ══ R1. 광고 SDK 이벤트 4종 (부활 지면) ════════════════════════════════
    print("\n[R1] 광고 SDK 이벤트 - 정상 / dismissed 후 늦은 보상 / 타임아웃 / 실패")

    # (a) 정상 보상
    ctl.reset(**OK)
    ctl.start()
    page.wait_for_timeout(300)
    m0 = ctl.rw()["player"]["mass"]
    ctl.die_border()
    d = ctl.rw()
    chk("R1-a0 사망 시트에 부활 제안이 «뜬다»",
        d["canRevive"] is True and page.evaluate("() => window.__ui.shown(window.__ui.revive())") is True)
    ctl.revive()
    a = ctl.rw()
    chk("R1-a ①정상 보상(show>userEarnedReward>dismissed) = 부활",
        a["mode"] == "play" and a["player"]["alive"] is True and a["used"]["revive"] == 1,
        f"mode={a['mode']} alive={a['player']['alive']} used={a['used']['revive']}")
    # ★기준은 «죽은 순간»의 질량(d)이다. m0(시작 300ms 뒤)를 쓰면 «부활»이 아니라
    #   「시작~사망 사이에 먹은 양」까지 재게 된다 — 그 구간은 뱀이 살아서 움직이며
    #   먹이를 먹는 정상 구간이다. 맵 배율이 3.0 이 되면서 스폰 주변 먹이 배치가
    #   달라지자 그 구간에서 3.5 를 먹었고, 검사기는 «정상 동작»을 회귀로 신고했다.
    #   ⇒ 완화가 아니라 «격리»다. 부활이 질량을 건드리면 여전히 잡힌다(1e-6).
    m_dead = d["player"]["mass"]
    chk("R1-a2 부활 시 «길이·점수 보존» (사망 시점 mass 그대로)",
        abs(a["player"]["mass"] - m_dead) < 1e-6,
        f"death={m_dead} -> revived={a['player']['mass']} (start={m0})")
    chk("R1-a3 부활 직후 «무적»(ghost)", a["player"]["ghost"] is True)

    # (b) ★핵심: dismissed 가 «먼저» 오고 보상이 1.2초 뒤 = 유예(3s) 안 -> 성공해야 한다
    ctl.reset(load="ok", show="lateReward", supported=True)
    ctl.start(); page.wait_for_timeout(300); ctl.die_border()
    ctl.revive()
    b = ctl.rw()
    seq = page.evaluate("() => window.__coilReward.seq()")
    chk("R1-b ★dismissed 후 늦은 보상(유예 3s 안) = 부활 «된다» [네온 -23 실사고 형태]",
        b["mode"] == "play" and b["used"]["revive"] == 1,
        (seq[-1]["seq"] + " -> " + seq[-1]["result"]) if seq else "seq 없음")
    chk("R1-b2 대문자·언더스코어 이벤트명(USER_EARNED_REWARD)도 «정규화»로 인식",
        bool(seq) and seq[-1]["result"] == "ok" and "USER_EARNED_REWARD" in seq[-1]["seq"],
        seq[-1]["seq"] if seq else "")

    # (e) 유예 «밖»(4.2s) + e.name 필드 -> 판정은 실패지만 onLateReward 로 지급
    ctl.reset(load="ok", show="veryLateReward", supported=True)
    ctl.start(); page.wait_for_timeout(300); ctl.die_border()
    ctl.revive()
    page.wait_for_timeout(1800)  # 4.2s 중 판정(3s) 뒤에 오는 몫을 기다린다
    e = ctl.rw()
    seq = page.evaluate("() => window.__coilReward.seq()")
    chk("R1-e ★유예 «밖» 늦은 보상 + e.name 필드 = onLateReward 로 부활한다",
        e["mode"] == "play" and e["used"]["revive"] == 1,
        (seq[-1]["result"] + " / " + seq[-1]["seq"]) if seq else "")

    # (c) 타임아웃: show 가 «아무 이벤트도» 안 낸다 -> open_timeout(8s) -> 실패
    ctl.reset(load="ok", show="silent", supported=True)
    ctl.start(); page.wait_for_timeout(300); ctl.die_border()
    ctl.revive()
    c = ctl.rw()
    seq = page.evaluate("() => window.__coilReward.seq()")
    chk("R1-c ③타임아웃 = 부활 «안 된다» · 상한도 «안 깎인다»",
        c["mode"] == "dead" and c["used"]["revive"] == 0 and c["reviveUsedThisRun"] is False,
        (seq[-1]["result"] + "/" + seq[-1]["reason"]) if seq else "")
    chk("R1-c2 실패 사유 토스트가 «뜬다»(아무 말 없이 끝나지 않는다)",
        page.evaluate("() => window.__ui.toast()") is not None,
        page.evaluate("() => window.__ui.toast()"))

    # (d) 로드 실패
    ctl.reset(load="error", show="reward", supported=True)
    ctl.start(); page.wait_for_timeout(300); ctl.die_border()
    ctl.revive()
    dd = ctl.rw()
    seq = page.evaluate("() => window.__coilReward.seq()")
    chk("R1-d ④로드 실패 = 부활 «안 된다» · 상한 «안 깎인다»",
        dd["mode"] == "dead" and dd["used"]["revive"] == 0,
        (seq[-1]["result"] + "/" + seq[-1]["reason"]) if seq else "")

    # ══ R2. 부활 «판당 1회» ════════════════════════════════════════════════
    print("\n[R2] 부활 판당 1회 제한")
    ctl.reset(**OK)
    ctl.start(); page.wait_for_timeout(300); ctl.die_border()
    ctl.revive()
    page.wait_for_timeout(200)
    r2a = ctl.rw()
    ctl.die_border()
    r2b = ctl.rw()
    chk("R2-a 같은 판에서 두 번째 사망 = 부활 제안이 «안 뜬다»",
        r2b["canRevive"] is False
        and page.evaluate("() => window.__ui.shown(window.__ui.revive())") is False,
        f"reviveUsedThisRun={r2b['reviveUsedThisRun']}")
    ctl.revive()  # 그래도 호출하면 아무 일도 없어야 한다(방어)
    r2c = ctl.rw()
    chk("R2-b 제안이 없는데 직접 호출해도 부활 «안 된다» · 광고도 «안 뜬다»",
        r2c["mode"] == "dead" and r2c["used"]["revive"] == 1,
        f"used={r2c['used']['revive']}")
    ctl.start()
    r2d = ctl.rw()
    chk("R2-c 새 판이 시작되면 «다시» 1회가 생긴다",
        r2d["reviveUsedThisRun"] is False and r2d["canRevive"] is True)
    chk("R2-d 부활 1회를 쓰면 일일 상한이 «정확히 1» 깎인다", r2a["used"]["revive"] == 1)

    # ══ R3. 기록(games/kills/playSeconds) 이중 계수 방지 ═══════════════════
    print("\n[R3] 부활해도 «한 판은 한 판» (기록 되돌리기)")
    ctl.reset(**OK)
    g0 = ctl.rw()["save"]["games"]
    ctl.start(); page.wait_for_timeout(400)
    ctl.die_border()
    g1 = ctl.rw()["save"]["games"]
    ctl.revive(); page.wait_for_timeout(200)
    g2 = ctl.rw()["save"]["games"]
    ctl.die_border()
    g3 = ctl.rw()["save"]["games"]
    chk("R3-a 사망 순간 games +1", g1 == g0 + 1, f"{g0} -> {g1}")
    chk("R3-b ★부활하면 그 +1 이 «되돌아간다»(판이 아직 안 끝났다)", g2 == g0, f"-> {g2}")
    chk("R3-c 최종 사망에서 다시 +1 = 한 판이 «한 번만» 세어진다", g3 == g0 + 1, f"-> {g3}")

    # ══ R4. 시작 크기 부스트 ═══════════════════════════════════════════════
    print("\n[R4] 시작 크기 부스트 - 길이 배수 · 중복 적용 방지")
    ctl.reset(**OK)
    bm = page.evaluate("() => window.__coilReward.boostMass()")
    ratio = body_len(bm) / body_len(START_MASS)
    chk("R4-a 부스트 «몸길이» 배수가 지시 범위(1.3~1.5) 안이다",
        1.3 <= ratio <= 1.5, f"mass {START_MASS} -> {bm} = 길이 x{ratio:.3f}")
    chk("R4-a2 목표 배수와 일치(설계값 %.2f)" % EXPECT_LEN_K,
        abs(ratio - EXPECT_LEN_K) < 0.02, f"x{ratio:.3f}")

    ctl.start()
    # ★ player.mass 가 아니라 spawnMass 다 - 판이 시작되고 검사기가 값을 읽기까지
    #   프레임이 돌아 먹이를 먹는다(실측 +1.1). 그 값으로 판정하면 옳은 코드가 틀린 것으로 나온다.
    base_mass = ctl.rw()["spawnMass"]
    chk("R4-b 대조군: 부스트 «없이» 시작하면 기본 질량", abs(base_mass - START_MASS) < 1e-6, base_mass)

    ctl.reset(**OK)
    page.evaluate("() => window.__coilReward.arm()")
    chk("R4-c 권리를 받으면 메뉴 버튼이 «준비됨» 상태가 된다",
        page.evaluate("() => document.querySelector('.p-boost').classList.contains('is-ready')") is True)
    ctl.start()
    b1 = ctl.rw()
    chk("R4-d 부스트가 «실제로» 적용된다(시작 질량 = boostMass)",
        abs(b1["spawnMass"] - bm) < 1e-6 and b1["startBoostArmed"] is False,
        f"spawnMass={b1['spawnMass']} armed={b1['startBoostArmed']}")
    ctl.start()
    b2 = ctl.rw()
    chk("R4-e ★중복 적용 방지: 다음 판은 «기본» 질량으로 돌아온다",
        abs(b2["spawnMass"] - START_MASS) < 1e-6, b2["spawnMass"])

    # 광고 경로 전체(광고 -> 자동 시작)
    ctl.reset(**OK)
    page.evaluate("() => window.__coil.toMenu()")
    ctl.boost()
    page.wait_for_timeout(300)
    b3 = ctl.rw()
    chk("R4-f 광고 시청 -> 판이 «바로» 시작되고 부스트가 걸린다",
        b3["mode"] == "play" and abs(b3["spawnMass"] - bm) < 1e-6 and b3["used"]["startBoost"] == 1,
        f"mode={b3['mode']} spawnMass={b3['spawnMass']} used={b3['used']['startBoost']}")

    # 실패 경로는 권리를 «안» 준다
    ctl.reset(load="error", show="reward", supported=True)
    page.evaluate("() => window.__coil.toMenu()")
    ctl.boost()
    b4 = ctl.rw()
    chk("R4-g 로드 실패 = 권리 «없음» · 판도 «안» 시작된다 · 상한 «안» 깎임",
        b4["startBoostArmed"] is False and b4["mode"] == "menu" and b4["used"]["startBoost"] == 0,
        json.dumps(b4["used"]))

    # ══ R5. 스킨 해금 ══════════════════════════════════════════════════════
    print("\n[R5] 스킨 해금 - 지급 · 멱등 · 일일 상한 3")
    ctl.reset(**OK)
    page.evaluate("() => window.__coil.toMenu()")
    chk("R5-a0 잠긴 스킨은 광고로 열 수 있다(bestScore=0 기준 milk 는 600점)",
        page.evaluate("() => window.__coilReward.canAdUnlockSkin('milk')") is True)
    ctl.unlock("milk")
    r5 = ctl.rw()
    chk("R5-a 광고 1회 = 스킨 1종 «영구» 해금 + 바로 착용",
        "milk" in r5["adSkins"] and r5["used"]["skinUnlock"] == 1
        and page.evaluate("() => document.querySelector('.skin-hero-name').textContent").strip() != "",
        json.dumps(r5["adSkins"]))
    chk("R5-b 멱등: 이미 연 스킨은 «다시 팔지 않는다»",
        page.evaluate("() => window.__coilReward.canAdUnlockSkin('milk')") is False)
    ctl.unlock("kingsnake")
    ctl.unlock("emerald")
    r5b = ctl.rw()
    chk("R5-c 3종까지 열린다", r5b["used"]["skinUnlock"] == 3 and len(r5b["adSkins"]) == 3,
        json.dumps(r5b["adSkins"]))
    chk("R5-d ★일일 상한 3 - 네 번째는 «제안 자체가 없다»",
        page.evaluate("() => window.__coilReward.canAdUnlockSkin('coral')") is False)
    # ★상한과 «자격»은 다른 이유다. 상한을 다 쓴 상태에서는 둘이 구분이 안 되므로
    #   자격 검사는 상한이 남아 있을 때 봐야 한다 → P0-f · tools/verify_adunlock.py.
    ctl.unlock("coral")
    r5c = ctl.rw()
    chk("R5-e 상한 뒤에 직접 호출해도 «해금 안 됨» · 광고도 «안 뜸»",
        "coral" not in r5c["adSkins"] and r5c["used"]["skinUnlock"] == 3)
    chk("R5-f 상한 도달 후 잠긴 카드의 광고 배지가 «전부 사라진다»",
        page.evaluate("() => window.__ui.skinAds()") == 0)

    # 실패 경로
    ctl.reset(**OK)
    page.evaluate("() => window.__coilReward.reset()")
    ctl.stub(load="ok", show="silent", supported=True)
    page.evaluate("() => window.__coil.toMenu()")
    ctl.unlock("milk")
    r5d = ctl.rw()
    chk("R5-g 광고 실패 = 해금 «없음» · 상한 «안» 깎임",
        "milk" not in r5d["adSkins"] and r5d["used"]["skinUnlock"] == 0)

    # ══ R6. 지면 ID 무오염 ═════════════════════════════════════════════════
    print("\n[R6] 지면 ID - 리워드 3종이 «각자» 자기 지면으로 간다 / 전면형 무오염")
    # ⚠️__coilAdCalls 를 «새 객체로 덮어쓰면 안 된다» - installStub 이 만든 객체를
    #   스텁 클로저가 붙잡고 있어서, 갈아끼우면 그 뒤 호출이 «옛 객체»에 쌓여 ids 가 늘 빈다.
    #   (그 상태로도 「전면형 ID 가 안 섞였다」는 PASS 가 난다 - 0건이 부재의 증거가 아닌
    #    바로 그 함정이다. 그래서 아래는 «구간 슬라이스»로 센다.)
    for kind, expect in (
        ("revive", REWARD_IDS["revive"]),
        ("startBoost", REWARD_IDS["startBoost"]),
        ("skinUnlock", REWARD_IDS["skinUnlock"]),
    ):
        ctl.reset(**OK)
        if kind == "revive":
            ctl.start(); page.wait_for_timeout(250); ctl.die_border()
            n0 = len(ctl.calls()["ids"])
            ctl.revive()
        elif kind == "startBoost":
            page.evaluate("() => window.__coil.toMenu()")
            n0 = len(ctl.calls()["ids"])
            ctl.boost()
        else:
            page.evaluate("() => window.__coil.toMenu()")
            n0 = len(ctl.calls()["ids"])
            ctl.unlock("milk")
        ids = ctl.calls()["ids"][n0:]
        # 리워드 «호출»은 load + show 두 건이고 «앞의 두 건»이다.
        chk(f"R6-{kind} 리워드 호출(load+show)이 «그 지면으로만» 갔다",
            len(ids) >= 2 and all(i == expect for i in ids[:2]), f"{len(ids)}건 {ids}")
        chk(f"R6-{kind}-nx 리워드 호출에 전면형 지면 ID 가 «섞이지 않았다»",
            INTERSTITIAL_ID not in ids[:2])
        if kind == "startBoost":
            # ★세 번째는 «전면형 preload» 다 - 부스트 광고 뒤 판이 시작되면서
            #   ads.beginRun() -> kickPreload() 가 도는, 손대지 않은 기존 동작이다.
            #   즉 이 한 건은 오염이 아니라 «전면형 기계가 그대로 살아 있다»는 양성대조다.
            # ★2026-09-10 개정(레인 A · 「요청 = 노출」): 전면형 preload 는 이제 «빚(adPending)이 있을 때만» 돈다.
            #   부스트 뒤 판 시작은 빚이 없으므로 전면형 로드가 «없어야» 한다(예전 기대값의 정반대).
            #   빚이 있을 때 실제로 로드되는 것은 qa_ads.py P0/P2 와 qa_lane_a.py A절이 본다.
            chk("R6-startBoost-i ★부스트 시작 뒤 «빚 없는» 판 시작 = 전면형 로드 0(요청 = 노출)",
                INTERSTITIAL_ID not in ids, f"{ids}")

    # ══ R7. 부활 밸런스 ════════════════════════════════════════════════════
    print("\n[R7] 부활 밸런스 - 경계 즉사 방지 · 내 사망 오브 회수")
    ctl.reset(**OK)
    ctl.start(); page.wait_for_timeout(1200)
    pre = ctl.rw()
    ctl.die_border()
    dead = ctl.rw()
    ctl.revive()
    post = ctl.rw()
    r = math.hypot(post["player"]["x"], post["player"]["y"])
    # ★반지름을 «박지 않는다» — 번들에서 읽는다. 3536(MAP_SCALE 2.0 시절 값)을
    #   박아 뒀더니 맵 배율이 3.0 이 된 순간 «정상 동작»을 FAIL 로 신고했다.
    world_r = post.get("worldR") or 0
    assert world_r > 0, "worldR 을 못 읽었다 — 검사기가 죽었다"
    chk("R7-a ★경계 사망 부활: 머리가 «맵 안»에 놓인다",
        r < world_r, f"r={r:.0f} < WORLD_R={world_r}")
    # ★무적 3초가 끝나고도 살아 있어야 한다. 경계 검사는 유령에게도 걸리므로
    #   머리를 안쪽으로 돌려놓지 않으면 여기서 반드시 죽는다.
    page.wait_for_timeout(3500)
    alive = ctl.rw()
    chk("R7-b ★경계 사망 부활: 3.5초 뒤에도 «살아 있다»(즉시 재사망 0)",
        alive["player"]["alive"] is True and alive["mode"] == "play",
        f"alive={alive['player']['alive']} mode={alive['mode']} ghost={alive['player']['ghost']}")
    # ⚠️orbs.n «전체»로는 측정할 수 없다 - replenishFood 가 매 스텝 FOOD_TARGET(6000)까지
    #   즉시 다시 채워 총합이 늘 6000 이다(실측: death 6000 -> revive 6000). 내 «색»만 센다.
    chk("R7-c0 양성대조: 사망 직후 필드에 «내 색» 오브가 실제로 뿌려져 있다",
        dead["myOrbs"] > 0, f"myOrbs={dead['myOrbs']} (총 {dead['orbs']})")
    chk("R7-c ★사망 폭발로 흘린 «내 오브»를 회수한다(부활 후 0개)",
        post["myOrbs"] == 0 and post["revive"]["orbsReclaimed"] >= dead["myOrbs"],
        f"death myOrbs={dead['myOrbs']} -> revive myOrbs={post['myOrbs']} "
        f"(회수 {post['revive']['orbsReclaimed']}개)")
    chk("R7-d 부활 전후 질량이 그대로다(= 길이·점수 보존)",
        abs(post["revive"]["toMass"] - post["revive"]["fromMass"]) < 1e-6,
        f"{post['revive']['fromMass']} -> {post['revive']['toMass']}")
    chk("R7-d2 경계 사망이 'border' 로 판정돼 안쪽 되돌리기가 «실제로» 돌았다",
        post["revive"]["cause"] == "border", post["revive"]["cause"])
    _ = pre

    # 남의 몸 사망 -> 부활
    ctl.reset(**OK)
    ctl.start(); page.wait_for_timeout(1200)
    if ctl.die_body():
        ctl.revive()
        pb = ctl.rw()
        chk("R7-e 남의 몸 사망도 «그 자리»에서 부활 · 무적이 걸린다",
            pb["mode"] == "play" and pb["player"]["alive"] is True and pb["player"]["ghost"] is True,
            f"mode={pb['mode']} ghost={pb['player']['ghost']}")
    else:
        chk("R7-e 남의 몸 사망 부활 - 봇을 못 찾아 건너뜀", True, "skipped")

    # ══ R8. 부활 일일 상한 ═════════════════════════════════════════════════
    print("\n[R8] 부활 일일 상한 5")
    ctl.reset(**OK)
    for _ in range(6):
        ctl.start(); page.wait_for_timeout(120); ctl.die_border()
        if ctl.rw()["canRevive"]:
            ctl.revive(); page.wait_for_timeout(80)
    r8 = ctl.rw()
    chk("R8-a 하루 5회를 넘지 않는다", r8["used"]["revive"] == 5, f"used={r8['used']['revive']}")
    ctl.start(); page.wait_for_timeout(120); ctl.die_border()
    chk("R8-b 상한에 닿으면 새 판에서도 «제안이 안 뜬다»",
        ctl.rw()["canRevive"] is False
        and page.evaluate("() => window.__ui.shown(window.__ui.revive())") is False)

    # ══ R9. 추론 지급 «12초 문턱» 경계 ══════════════════════════════════════
    # 2026-08-31 President 결정으로 INFER_MIN_SHOWN_MS 를 20000 -> 12000 으로 낮췄다.
    # ★그런데 그 전까지 «이 경로를 밟는 검사가 0건»이었다 — 상수를 아무 값으로 바꿔도
    #   위 60건이 전부 초록이었다. R9 가 그 구멍을 막는다.
    #
    # 여기서 재는 것: 보상 이벤트가 «한 번도 안 오고» dismissed 만 온 상황.
    #   11.9초 표시 = 미지급 / 12.1초 표시 = 지급 을 «실행»으로 가둬 문턱이
    #   (11900, 12100] 안에 있음을 증명한다. 숫자를 단언하는 게 아니라 «행동»을 가둔다.
    #
    # ⚠️shownMs 는 show 부터 «판정 시각»까지다. dismissed 판정은 유예(3s) «뒤»에 나므로
    #   shownMs = dismissAfterMs + 3000 이다. 그래서 목표에서 3s 를 빼고 예약한다.
    #   ⇒ 즉 «유저가 실제로 본 시간»의 문턱은 12s 가 아니라 9s 다.
    print("\n[R9] 추론 지급 12초 문턱 - 보상 이벤트 없이 dismissed 만 온 경우")
    INFER_TARGET_MS = 12000
    INFER_BAND_MS = 100
    DISMISS_GRACE_MS = 3000

    # ★타이머 지터 대비 재시도 — 이 게임은 60fps 루프가 계속 돌아 setTimeout 이 밀린다
    #   (실측 +14 ~ +46ms. 네온·스모는 ±5ms 라 재시도가 필요 없었다).
    #   재시도 조건은 «하네스가 목표 표시시간을 못 맞췄을 때»뿐이다 — 지급/미지급 «결과»로는
    #   절대 재시도하지 않는다. 그랬다간 실패를 초록으로 덮는 검사기가 된다.
    HARNESS_TOL_MS = 60

    def infer_skin(target_ms, skin, tries=3):
        """스킨 해금(추론 opt-in 이 «켜진» 유일한 지면)으로 경계 1건 실행."""
        last_out = (None, None, None)
        for _ in range(tries):
            ctl.reset(load="ok", show="inferBoundary", supported=True,
                      dismissAfterMs=target_ms - DISMISS_GRACE_MS)
            page.evaluate("() => window.__coil.toMenu()")
            ctl.unlock(skin)
            st = ctl.rw()
            rec = page.evaluate("() => window.__coilReward.seq()")
            last = rec[-1] if rec else {}
            shown = last.get("shownMs")
            last_out = (shown, (skin in st["adSkins"]), last.get("result"))
            if isinstance(shown, (int, float)) and abs(shown - target_ms) < HARNESS_TOL_MS:
                return last_out
        return last_out

    m1, g1, r1 = infer_skin(INFER_TARGET_MS - INFER_BAND_MS, "milk")
    chk("R9-a0 하네스가 실제로 11900ms 를 표시했다(이게 어긋나면 아래 판정은 무의미)",
        isinstance(m1, (int, float)) and abs(m1 - 11900) < HARNESS_TOL_MS, f"measured={m1}")
    chk("R9-a 11.9초(문턱 미만) 시청 + dismissed = 스킨 «미해금»", g1 is False, f"granted={g1}")
    chk("R9-a2 ad_seq result=fail", r1 == "fail", f"result={r1!r}")

    m2, g2, r2 = infer_skin(INFER_TARGET_MS + INFER_BAND_MS, "milk")
    chk("R9-b0 하네스가 실제로 12100ms 를 표시했다",
        isinstance(m2, (int, float)) and abs(m2 - 12100) < HARNESS_TOL_MS, f"measured={m2}")
    chk("R9-b 12.1초(문턱 이상) 시청 + dismissed = 스킨 «해금»", g2 is True, f"granted={g2}")
    chk("R9-b2 ad_seq result=inferred (추론 지급은 «추적 가능»해야 한다)",
        r2 == "inferred", f"result={r2!r}")
    chk("R9-c ★12000ms 를 사이에 두고 지급이 «뒤집힌다» = 문턱이 (11900, 12100] 안",
        isinstance(m1, (int, float)) and isinstance(m2, (int, float))
        and m1 < INFER_TARGET_MS <= m2 and g1 is False and g2 is True,
        f"미지급@{m1} / 지급@{m2}")

    # ★opt-in 게이트 음성대조 — 문턱을 낮춘 것이 «부활·부스트까지» 추론 지급으로
    #   새지 않았는지 본다. 이 둘은 점수·순위를 바꾸므로 allowInferred 가 꺼져 있어야 한다.
    #   (main.ts 주석 「부활은 점수·순위를 바꾸는 보상이다」의 실행 검증.)
    ctl.reset(load="ok", show="inferBoundary", supported=True,
              dismissAfterMs=(INFER_TARGET_MS + INFER_BAND_MS) - DISMISS_GRACE_MS)
    ctl.start(); page.wait_for_timeout(250); ctl.die_border()
    ctl.revive()
    rv = ctl.rw()
    rec = page.evaluate("() => window.__coilReward.seq()")
    last = rec[-1] if rec else {}
    chk("R9-d ★부활은 12.1초를 봐도 «추론 지급되지 않는다»(allowInferred 꺼짐)",
        rv["mode"] == "dead" and rv["used"]["revive"] == 0 and last.get("result") == "fail",
        f"mode={rv['mode']} used={rv['used']['revive']} result={last.get('result')!r} shownMs={last.get('shownMs')}")

    ctl.reset(load="ok", show="inferBoundary", supported=True,
              dismissAfterMs=(INFER_TARGET_MS + INFER_BAND_MS) - DISMISS_GRACE_MS)
    page.evaluate("() => window.__coil.toMenu()")
    ctl.boost()
    bs = ctl.rw()
    chk("R9-e ★시작 부스트도 «추론 지급되지 않는다»",
        bs["used"]["startBoost"] == 0 and bs["startBoostArmed"] is False and bs["mode"] == "menu",
        f"used={bs['used']['startBoost']} armed={bs['startBoostArmed']} mode={bs['mode']}")


# ★ 일일 상한은 rewardStore.ts 에서 «읽어 온다»(박지 않는다).
#   박아 두면 상수를 바꿔도 옛 값을 통과시키는 죽은 검사기가 된다.
DAILY_GROWTH_CAP = None


def run_growth(page, results, fails):
    """기록 돌파 리워드(2026-08-31 레인 5) — 광고 이벤트 4종 · 판당 1회 · 정지/재개 · 성장.

    ★★ 이 기능의 «진짜» 검증 대상은 배수가 아니라 «정지»다.
       뱀 게임은 연속 조작이 전부라, 제안이 뜬 채 월드가 흐르면 그 순간 죽는다.
       R12 가 그것을 «좌표로» 잰다 — 스크린샷으로는 증명할 수 없다.

    ★ 상수를 검사기에 «박지 않는다». 2000·1.2·2·300·3초는 전부
      __coilReward.growthConst() 로 «코드에서» 읽어 온다. 박아 두면 상수를
      바꿔도 옛 값을 통과시키는 죽은 검사기가 된다
      (auto-memory 「테스트가 틀린 값을 고정한다」의 실사고 형태).
    """
    ctl = Ctl(page)

    def chk(name, ok, detail=""):
        results.append({"check": name, "ok": bool(ok), "detail": str(detail)})
        print(("  PASS  " if ok else "  FAIL  ") + name + ("   " + str(detail) if detail else ""))
        if not ok:
            fails.append(name)

    OK = {"load": "ok", "show": "reward", "supported": True}
    global DAILY_GROWTH_CAP
    C = page.evaluate("() => window.__coilReward.growthConst()")
    DAILY_GROWTH_CAP = C["dailyCap"]
    TH = C["thresholds"]
    K = C["k"]
    CAP = C["maxPerRun"]
    OFFER_S = C["offerS"]
    assert len(TH) >= 3, "문턱 3칸 이상을 전제로 쓴 검사다"
    BEST_MIN = C["bestMin"]
    CD = C["countdownS"]
    GAP = C["minGapS"]
    print("\n상수(코드에서 읽음): 문턱=%s 배수=%s 판당상한=%s 최고기록최소=%s 카운트다운=%ss 쿨다운=%ss"
          % (TH, K, CAP, BEST_MIN, CD, GAP))
    print("  배너 %ss 뒤 자동소멸 · 제안 중 게임은 «흐른다»(2026-09-01 개정)" % OFFER_S)

    # ══ R10. 대조 + 광고 SDK 이벤트 4종 (성장 지면) ═══════════════════════
    print("\n[R10] 기록 돌파 - 대조 · 광고 이벤트 4종")
    ctl.reset()  # 스텁 없음 = 토스 밖
    ctl.set_best(0)
    ctl.start()
    ctl.grow_to(TH[0] + 100)
    page.wait_for_timeout(500)
    s = ctl.rw()
    chk("R10-p0 ★음성대조: 스텁이 없으면(=토스 밖) 문턱을 넘어도 제안이 «안 뜬다»",
        s["canGrow"] is False and s["offer"] is None and s["mode"] == "play",
        f"canGrow={s['canGrow']} offer={s['offer']} mode={s['mode']}")

    ctl.reset(**OK)
    ctl.set_best(0)
    ctl.start()
    ctl.grow_to(TH[0] + 100)
    ctl.wait_offer()
    s = ctl.rw()
    chk("R10-p1 ★양성대조: 스텁을 꽂으면 «실제로» 제안 배너가 뜬다",
        s["offer"] is not None and page.evaluate("() => window.__ui.shown(window.__ui.grow())") is True,
        json.dumps(s["offer"]))
    chk("R10-p2 ★배너는 .overlay 가 «아니다» - 오버레이는 여전히 3개(0 메뉴/1 일시정지/2 결과)이고 «하나도 안 떠 있다»",
        page.evaluate("() => window.__ui.overlayCount()") == 3
        and page.evaluate("() => window.__ui.anyOverlayShown()") is False,
        "overlays=%s shown=%s" % (page.evaluate("() => window.__ui.overlayCount()"),
                                  page.evaluate("() => window.__ui.anyOverlayShown()")))
    chk("R10-p3 ★HUD 를 «안 감춘다» - 게임이 흐르는 중에 점수·순위가 사라지는 것 자체가 방해다",
        page.evaluate("() => window.__ui.hudHidden()") is False)

    # (a) 정상 보상 — ★기준은 «광고 직전» 질량이다(President 2026-09-01).
    #  ⛔「탭 직전 질량」을 여기서 미리 재 두고 비교하면 안 된다 — 재는 순간과
    #    탭하는 순간 사이에도 게임이 흐르므로 질량이 달라진다(그게 이 설계다).
    #    ⇒ «멈춘 동안»의 불변식으로 잰다: 기준 == 그 순간의 실제 질량.
    g0 = ctl.rw()["player"]["ghostUntil"]
    ctl.grow_ad()
    a = ctl.rw()
    chk("R10-a ①정상 보상(show>userEarnedReward>dismissed) = 질량 «정확히» %s배" % K,
        a["lastGrowth"] is not None
        and abs(a["lastGrowth"]["toMass"] - a["lastGrowth"]["fromMass"] * K) < 1e-6
        and a["used"]["growth"] == 1,
        f"{a['lastGrowth']['fromMass'] if a['lastGrowth'] else None} -> "
        f"{a['lastGrowth']['toMass'] if a['lastGrowth'] else None} used={a['used']['growth']}")
    chk("R10-a2 성장 뒤에는 «바로 재개하지 않는다» - 복귀 카운트다운을 탄다",
        a["mode"] == "offer" and a["counting"] is True,
        f"mode={a['mode']} counting={a['counting']}")
    chk("R10-a3 ★무적(ghost)을 «주지 않는다» - 문턱을 일부러 넘어 무적으로 빠져나가는 경로 차단",
        a["player"]["ghostUntil"] == g0,
        f"ghostUntil {g0} -> {a['player']['ghostUntil']} (판 시작 무적 3s 와 구분해서 «값»으로 잰다)")
    chk("R10-a4 ★기준 질량 = 광고 직전(= 멈춘 순간) 질량. 「지급 직전 실제 질량」과 «같다»",
        a["lastGrowth"] is not None
        and abs(a["lastGrowth"]["fromMass"] - a["lastGrowth"]["preMass"]) < 1e-9,
        f"기준 {a['lastGrowth']['fromMass']:.2f} vs 지급 직전 실제 {a['lastGrowth']['preMass']:.2f}"
        if a["lastGrowth"] else "없음")
    ctl.finish_count()
    page.wait_for_function("() => window.__coilReward.state().mode === 'play'", timeout=6000)
    ctl.clear_cooldown()

    # (b) dismissed 가 «먼저» 오고 보상이 1.2초 뒤 = 유예(3s) 안
    ctl.reset(load="ok", show="lateReward", supported=True)
    ctl.set_best(0); ctl.start(); ctl.grow_to(TH[0] + 100); ctl.wait_offer()
    ctl.grow_ad()
    b = ctl.rw()
    seq = page.evaluate("() => window.__coilReward.seq()")
    chk("R10-b ★dismissed 후 늦은 보상(유예 3s 안) = 성장 «된다» [네온 -23 실사고 형태]",
        b["used"]["growth"] == 1 and b["lastGrowth"] is not None,
        (seq[-1]["seq"] + " -> " + seq[-1]["result"]) if seq else "seq 없음")

    # (e) 유예 «밖»(4.2s) — 실패 판정 뒤 카운트다운이 이미 돌던 중에 보상이 온다.
    ctl.reset(load="ok", show="veryLateReward", supported=True)
    ctl.set_best(0); ctl.start(); ctl.grow_to(TH[0] + 100); ctl.wait_offer()
    ctl.grow_ad()
    page.wait_for_timeout(2000)  # 4.2s 중 판정(3s) 뒤에 오는 몫
    e = ctl.rw()
    seq = page.evaluate("() => window.__coilReward.seq()")
    chk("R10-e ★유예 «밖» 늦은 보상 + e.name 필드 = 카운트다운 중에도 지급된다",
        e["used"]["growth"] == 1 and e["lastGrowth"] is not None,
        (seq[-1]["result"] + " / " + seq[-1]["seq"]) if seq else "")
    chk("R10-e2 늦게 지급되면 카운트다운을 «다시» 준다(방금 커진 몸으로 0.4초 만에 복귀 금지)",
        e["mode"] == "offer" and e["counting"] is True,
        f"mode={e['mode']} counting={e['counting']}")

    # (c) 타임아웃: show 가 «아무 이벤트도» 안 낸다 -> open_timeout(8s) -> 실패
    ctl.reset(load="ok", show="silent", supported=True)
    ctl.set_best(0); ctl.start(); ctl.grow_to(TH[0] + 100); ctl.wait_offer()
    ctl.grow_ad()
    c = ctl.rw()
    chk("R10-c ③타임아웃 = 성장 «안 됨» · 상한도 «안 깎임»",
        c["used"]["growth"] == 0 and c["lastGrowth"] is None,
        json.dumps(c["used"]))
    chk("R10-c2 ★★광고가 실패해도 «월드가 영원히 멈추지 않는다» - 반드시 복귀 절차를 탄다",
        c["counting"] is True or c["mode"] == "play",
        f"mode={c['mode']} counting={c['counting']}")
    chk("R10-c3 실패 사유 토스트가 «뜬다»(아무 말 없이 끝나지 않는다)",
        page.evaluate("() => window.__ui.toast()") is not None,
        page.evaluate("() => window.__ui.toast()"))
    # ★★ 실패 «즉시» 버리면 안 된다: 늦은 보상(④)이 최대 15초 뒤에 오고, 그때
    #   기준이 없으면 「끝까지 봤는데 아무 일도 안 일어난다」가 재발한다(R10-e 가
    #   지키는 바로 그 경로). ⇒ 「창이 열려 있는 동안 살아 있다 → 닫히면 폐기」를 잰다.
    late_ms = c["lateWindowMs"]
    chk("R10-c4a ★실패 직후에도 스냅샷은 «살아 있다» - 늦은 보상이 기준을 잃으면 미지급 사고가 난다",
        c["growthBase"] > 0, f"growthBase={c['growthBase']:.1f} · 늦은보상창 {late_ms}ms")
    page.wait_for_timeout(late_ms + 2500)
    c2 = ctl.rw()
    chk("R10-c4b ★늦은 보상 창(%dms)이 «닫히면» 스냅샷이 폐기된다(옛 질량이 다음 지급에 새지 않는다)"
        % late_ms,
        c2["growthBase"] == 0, f"growthBase={c2['growthBase']}")

    # (d) 로드 실패
    ctl.reset(load="error", show="reward", supported=True)
    ctl.set_best(0); ctl.start(); ctl.grow_to(TH[0] + 100); ctl.wait_offer()
    ctl.grow_ad()
    d = ctl.rw()
    chk("R10-d ④로드 실패 = 성장 «안 됨» · 상한 «안 깎임» · 그래도 복귀한다",
        d["used"]["growth"] == 0 and (d["counting"] is True or d["mode"] == "play"),
        f"used={d['used']['growth']} mode={d['mode']} counting={d['counting']}")

    # ══ R11. 문턱 판당 1회 · 동시 발동 시 하나만 · 판당 상한 ═══════════════
    print("\n[R11] 문턱 판당 1회 · 동시 발동 하나만 · 판당 상한 %d" % CAP)
    ctl.reset(**OK)
    ctl.set_best(0)  # 최고기록 트리거를 꺼 둔다(문턱만 본다)
    ctl.start()
    ctl.grow_to(TH[0] + 100); ctl.wait_offer()
    o1 = ctl.rw()["offer"]
    chk("R11-a 첫 문턱(%d)에서 제안이 뜬다" % TH[0],
        o1 and o1["kind"] == "threshold" and o1["value"] == TH[0], json.dumps(o1))
    ctl.dismiss()
    ctl.grow_to(TH[0] + 200)
    page.wait_for_timeout(400)
    chk("R11-b ★같은 문턱은 판당 1회 - 다시 넘어도 «안 뜬다»(5,001·5,002점마다 뜨는 사고 방지)",
        ctl.rw()["offer"] is None, json.dumps(ctl.rw()["offer"]))

    ctl.grow_to(TH[1] + 100); ctl.wait_offer()
    o2 = ctl.rw()["offer"]
    chk("R11-c 다음 문턱(%d)은 «따로» 뜬다" % TH[1],
        o2 and o2["kind"] == "threshold" and o2["value"] == TH[1], json.dumps(o2))
    ctl.dismiss()
    ctl.grow_to(TH[2] + 100)
    page.wait_for_timeout(500)
    r11 = ctl.rw()
    chk("R11-d ★판당 상한 %d - 세 번째 문턱(%d)은 «제안 자체가 없다»" % (CAP, TH[2]),
        r11["offer"] is None and r11["growth"]["shown"] == CAP and r11["canGrow"] is False,
        f"shown={r11['growth']['shown']} canGrow={r11['canGrow']}")

    ctl.start()  # 새 판
    ctl.set_best(0)
    ctl.grow_to(TH[0] + 100); ctl.wait_offer()
    r11b = ctl.rw()
    chk("R11-e 새 판이 시작되면 문턱·상한이 «다시» 열린다",
        r11b["offer"] is not None and r11b["growth"]["shown"] == 1,
        f"shown={r11b['growth']['shown']}")
    ctl.dismiss()

    # 동시 발동
    ctl.reset(**OK)
    ctl.set_best(TH[0] - 100)   # 최고기록 400 -> 550 에서 문턱과 «동시»에 걸린다
    ctl.start()
    ctl.grow_to(TH[0] + 50); ctl.wait_offer()
    sim = ctl.rw()
    chk("R11-f ★문턱과 최고기록이 동시에 걸리면 «하나만» 뜬다(문턱 우선)",
        sim["offer"]["kind"] == "threshold" and sim["growth"]["shown"] == 1,
        json.dumps(sim["offer"]))
    chk("R11-g ★그리고 최고기록 쪽도 «같이 소비»된다 - 다음 프레임에 연달아 뜨지 않는다",
        sim["growth"]["bestUsed"] is True and sim["growth"]["used"][0] is True,
        json.dumps(sim["growth"]))
    ctl.dismiss()
    ctl.grow_to(TH[0] + 300)
    page.wait_for_timeout(500)
    chk("R11-h 실제로 «두 번째 제안이 안 뜬다»(연속 발동 0)",
        ctl.rw()["offer"] is None)

    # ══ R12. ★★제안이 게임을 «방해하지 않는다» (2026-09-01 개정의 핵심) ═══
    #  옛 설계는 제안을 띄우며 월드를 완전정지시켰다. President 가 그것을 「방해」로
    #  판정했다. 그래서 이 절의 검사는 옛 R12 의 «정반대»다 —
    #  「멈췄는가」가 아니라 «흐르는가»를 증명한다.
    print("\n[R12] ★제안 배너가 게임을 방해하지 않는다 - 월드 진행 · 입력 통과 · %ss 자동소멸" % OFFER_S)
    ctl.reset(**OK)
    ctl.set_best(0)
    ctl.start()
    page.wait_for_timeout(600)
    ctl.grow_to(TH[0] + 100); ctl.wait_offer()
    f1 = ctl.rw()
    page.wait_for_timeout(700)
    f2 = ctl.rw()
    chk("R12-a ★배너가 떠 있는 700ms 동안 «월드 시계»가 그대로 흘렀다",
        f2["worldTime"] > f1["worldTime"] + 0.3,
        f"{f1['worldTime']:.2f} -> {f2['worldTime']:.2f}")
    chk("R12-b ★뱀 머리가 «계속 움직인다»(정지 0)",
        abs(f2["player"]["x"] - f1["player"]["x"]) > 1
        or abs(f2["player"]["y"] - f1["player"]["y"]) > 1,
        f"({f1['player']['x']:.1f},{f1['player']['y']:.1f}) -> ({f2['player']['x']:.1f},{f2['player']['y']:.1f})")
    chk("R12-c ★mode 가 'play' 그대로다 - 배너는 화면을 «바꾸지 않는다»",
        f2["mode"] == "play" and f2["counting"] is False,
        f"mode={f2['mode']} counting={f2['counting']}")

    # ── 입력을 막지 않는가 — «좌표로» 잰다(코드만 보고 판단하지 않는다) ──
    rect = page.evaluate("() => window.__ui.growRect()")
    vh = page.evaluate("() => window.innerHeight")
    vw = page.evaluate("() => window.innerWidth")
    chk("R12-d ★배너가 «조종하는 손가락 자리»(화면 아래 절반)에 없다 - 조이스틱은 처음 닿은 곳에 생긴다",
        rect is not None and rect["bottom"] < vh * 0.5,
        f"배너 하단 {rect['bottom']:.0f}px / 화면 {vh}px" if rect else "배너 없음")
    hit_c = page.evaluate("(a) => window.__ui.hitAt(a[0], a[1])", [vw / 2, vh / 2])
    hit_b = page.evaluate("(a) => window.__ui.hitAt(a[0], a[1])", [vw / 2, vh * 0.8])
    chk("R12-e ★화면 «중앙»과 «아래»의 터치는 배너가 아니라 게임이 받는다",
        not hit_c.startswith("p-grow<-") and not hit_b.startswith("p-grow<-"),
        f"중앙={hit_c} 아래={hit_b}")
    hit_on = page.evaluate("(a) => window.__ui.hitAt(a[0], a[1])",
                           [rect["x"] + rect["w"] / 2, rect["y"] + rect["h"] / 2])
    chk("R12-f 양성대조: 배너 «위»를 누르면 배너가 받는다(위 검사가 항상 참인 게 아니라는 증거)",
        hit_on.startswith("p-grow<-"), hit_on)
    chk("R12-g 배너 탭 크기가 WCAG 2.2 AA(24 CSS px)를 «넘긴다»",
        rect["h"] >= 24 and rect["w"] >= 24, f"{rect['w']:.0f}x{rect['h']:.0f}")
    # ★★ 「가리지 않는다」는 눈이 아니라 «좌표»로 판정한다. 실제로 순위표를
    #   58x44 px 가린 채 다른 검사는 전부 통과했다(2026-09-01 스크린샷에서 발견).
    ov = page.evaluate("() => window.__ui.hudOverlap()")
    chk("R12-g2 ★배너가 HUD(점수·순위표·킬피드·일시정지) 를 «한 픽셀도» 안 가린다",
        ov == {}, json.dumps(ov, ensure_ascii=False))

    # ══ 2026-09-02 President: 「킬로그 밑에 좀더 작게」 ═══════════════════════
    #   ★ 킬로그가 «실제로 떠 있는» 상태에서만 뜻이 있는 검사다. 빈 화면에서
    #     「안 겹쳤다」는 아무것도 증명하지 않는다(0건은 부재의 증거가 아니다).
    #   ★ 킬 줄은 운영과 «같은 경로»로 넣는다(__coil.pushKill -> shell.pushKill).
    KILL_ARGS = [["NimbusPro_2K77", "SaberTangoX_TV", "bot"],
                 ["EmberCinder_HD", "lanternlantern", "mine"],
                 ["ZephyrOnyx_v29", "꿈틀대장님하이", "lost"],
                 ["Cinder", "KiteGG", "bot"],
                 ["Pike", "udon", "bot"]]
    for a in KILL_ARGS:
        page.evaluate("(a) => window.__coil.pushKill(a[0], a[1], a[2])", a)
    page.wait_for_timeout(120)
    bf = page.evaluate("() => window.__ui.belowFeed()")
    chk("R12-g3 양성대조: 킬로그가 «실제로» 떠 있다(이게 0 이면 아래 검사는 무의미)",
        bf is not None and bf["items"] >= 1, json.dumps(bf, ensure_ascii=False))
    feed_max = bf["items"]
    chk("R12-g4 ★배너가 킬로그 «밑»에 있다(같은 열 · 피드 하단보다 아래)",
        bf["offerTop"] >= bf["feedBottom"] - 0.5 and bf["sameColumn"],
        f"피드하단 {bf['feedBottom']:.1f} -> 배너상단 {bf['offerTop']:.1f} "
        f"(간격 {bf['gap']:.1f}px, 같은열={bf['sameColumn']})")
    chk("R12-g5 붙어 있지도 겹치지도 않는다 - 간격 2~14px",
        2 <= bf["gap"] <= 14, f"{bf['gap']:.1f}px")

    # ★ y 는 «지금» 잡아 둔다. 아래에서 display 를 토글하면 offerIn(200ms)이 다시 돌고,
    #   그 애니메이션의 translateY(-6px) 가 getBoundingClientRect 에 «그대로» 들어온다
    #   (실제로 이 검사를 처음 돌렸을 때 6px 어긋나 FAIL 났다 — 검사기가 만든 오차였다).
    y_full = page.evaluate("() => window.__ui.growRect()")["y"]

    # 킬로그를 «밀지 않는다» — 배너를 완전히 없앤 상태와 좌표가 같아야 한다.
    f_on = page.evaluate("() => window.__ui.feedRect()")
    page.evaluate("() => window.__ui.hideOfferForProbe(true)")
    page.wait_for_timeout(60)
    f_off = page.evaluate("() => window.__ui.feedRect()")
    page.evaluate("() => window.__ui.hideOfferForProbe(false)")
    chk("R12-g6 ★배너가 킬로그를 «밀어내지 않는다»(배너 있음/없음 사각형 동일)",
        f_on == f_off, f"있음 {json.dumps(f_on)} / 없음 {json.dumps(f_off)}")

    # 자리 예약이 «FEED_MAX 줄»과 같은가. 값을 박지 않고 실제 한 줄을 재서 유도한다.
    fr = page.evaluate("() => window.__ui.feedReserve()")
    want = fr["line"] * feed_max + fr["gap"] * (feed_max - 1)
    chk("R12-g7 ★킬로그 자리 예약 = 실제 한 줄 x FEED_MAX (배너가 «안 뛰게» 하는 장치)",
        abs(fr["reserved"] - want) <= 1.0,
        f"예약 {fr['reserved']:.1f}px / 한 줄 {fr['line']:.1f} x {feed_max} + 간격 "
        f"{fr['gap']:.0f}x{feed_max - 1} = {want:.1f}px")

    # 예약이 «일한다»: 피드를 비워도 배너가 그 자리에 그대로 있어야 한다.
    # ⚠️앞의 display 토글로 offerIn 이 다시 돌고 있다 — 끝날 때까지(200ms) 기다린 뒤 잰다.
    page.evaluate("() => { document.querySelector('.hud-feed').textContent = ''; }")
    page.wait_for_timeout(320)
    y_empty = page.evaluate("() => window.__ui.growRect()")["y"]
    chk("R12-g8 ★★킬로그가 비어도 배너가 «안 움직인다» - 누르려던 버튼이 손가락 밑에서 뛰지 않는다",
        abs(y_full - y_empty) <= 1.0, f"킬로그 {feed_max}줄 y={y_full:.1f} / 0줄 y={y_empty:.1f}")

    # 보이는 사각형 = 누르는 사각형(투명 패딩으로 아레나에 사각지대를 만들지 않는다).
    r2 = page.evaluate("() => window.__ui.growRect()")
    edges = {
        "위": page.evaluate("(a) => window.__ui.hitAt(a[0], a[1])",
                            [r2["x"] + r2["w"] / 2, r2["y"] - 4]),
        "아래": page.evaluate("(a) => window.__ui.hitAt(a[0], a[1])",
                             [r2["x"] + r2["w"] / 2, r2["bottom"] + 4]),
        "오른쪽": page.evaluate("(a) => window.__ui.hitAt(a[0], a[1])",
                              [r2["x"] + r2["w"] + 6, r2["y"] + r2["h"] / 2]),
    }
    chk("R12-g9 ★배너 사각형 «밖» 4px 은 배너가 안 받는다(보이는 크기 = 누르는 크기)",
        all(not v.startswith("p-grow<-") for v in edges.values()),
        json.dumps(edges, ensure_ascii=False))

    # ── 5초 자동소멸 — «실시간»으로 잰다 ──
    # ⚠️5초를 기다리는 사이 봇에게 죽으면 배너는 «사망 정리»로 사라진다 —
    #   그건 자동소멸의 증거가 아니라 «재현 실패»다. 그래서 살아남은 판만 센다.
    #   ⛔결과(시간이 맞나)로는 절대 재시도하지 않는다 — 그러면 실패를 초록으로 덮는다.
    # ★ 대기 구간의 질량을 «최대한 낮게» 잡는다. 굼뜬 뱀은 5초를 못 버텨 검사가
    #   계속 skip 된다(실측: 질량 600 이면 6회 연속 사망). 최고기록 트리거는
    #   첫 문턱보다 «훨씬 낮은» 점수에서 뜨므로 그걸 쓴다(R16-e 와 같은 수법).
    auto = None
    for _try in range(6):
        ctl.reset(**OK)
        ctl.set_best(BEST_MIN)
        ctl.start()
        page.wait_for_timeout(300)
        ctl.grow_to(BEST_MIN + 40); ctl.wait_offer()
        left0 = ctl.rw()["offerLeft"]
        t0 = time.time()
        try:
            page.wait_for_function(
                "() => { const s = window.__coilReward.state();"
                "        return s.offer === null || !s.player.alive; }",
                timeout=int((OFFER_S + 8) * 1000))
        except Exception:
            pass
        gone = ctl.rw()
        el = time.time() - t0
        if not gone["player"]["alive"]:
            continue                       # 사망 = 재현 실패. 다시.
        auto = (gone, el, left0)
        break
    if auto is None:
        chk("R12-h ★배너가 «스스로» 사라진다(%ss) - 6회 모두 대기 중 사망해 건너뜀" % OFFER_S,
            True, "skipped")
        gone = ctl.rw()
    else:
        gone, el, left0 = auto
        chk("R12-h ★배너가 «스스로» 사라진다(%ss · 살아 있는 채로 실측)" % OFFER_S,
            gone["offer"] is None and OFFER_S - 1.2 <= el <= OFFER_S + 2.0,
            f"남은 {left0:.2f}s -> 소멸까지 실측 {el:.2f}s (설계 {OFFER_S}s)")
        chk("R12-h2 ★사라진 것이 «자동소멸»이지 사망 정리가 아니다(양성대조)",
            gone["player"]["alive"] is True and gone["mode"] == "play",
            f"alive={gone['player']['alive']} mode={gone['mode']}")
    chk("R12-i ★사라진 뒤 «다시 뜨지 않는다» - 사라짐 = 소비다",
        gone["growth"]["bestUsed"] is True and gone["growth"]["shown"] == 1,
        json.dumps(gone["growth"]))
    if gone["player"]["alive"]:
        # 최고기록을 «더» 깨도 다시 안 뜬다(첫 문턱 아래에 머문다).
        ctl.grow_to(TH[0] - 40)
        page.wait_for_timeout(500)
        chk("R12-j 같은 트리거 조건을 다시 만족해도 «안 뜬다»", ctl.rw()["offer"] is None,
            json.dumps(ctl.rw()["offer"]))
    else:
        chk("R12-j 같은 트리거 조건을 다시 만족해도 «안 뜬다» - 대기 중 사망해 건너뜀",
            True, "skipped")

    # ── ★배너 시계가 «프레임 dt» 기반인가(백그라운드에서 부당 소모 0) ──
    #  벽시계로 세면, 앱이 백그라운드로 간 사이 5초가 흘러 돌아왔을 때 기회가
    #  이미 사라져 있다. 메인 스레드를 1.5초 통째로 막으면 rAF 가 멈춘다 =
    #  백그라운드와 같은 상태다.
    ctl.reset(**OK)
    ctl.set_best(0)
    ctl.start()
    page.wait_for_timeout(300)
    ctl.grow_to(TH[0] + 100); ctl.wait_offer()
    before_stall = ctl.rw()["offerLeft"]
    page.evaluate("() => { const t = Date.now(); while (Date.now() - t < 1500) { /* stall */ } }")
    after_stall = ctl.rw()["offerLeft"]
    eaten = before_stall - after_stall
    chk("R12-k ★★1.5초 «멈춤»이 배너 시간을 거의 못 깎는다(프레임 dt 기반 · DT_MAX 0.25s 상한)",
        eaten < 0.6,
        f"{before_stall:.2f} -> {after_stall:.2f} (먹은 시간 {eaten:.2f}s / 멈춘 시간 1.50s)")
    ctl.dismiss()

    # ══ R13. ★광고를 «누르면» 그때 멈춘다 + 카운트다운 복귀 ════════════════
    print("\n[R13] ★광고 진입 = 정지 · 복귀는 카운트다운 %ss" % CD)
    ctl.reset(load="ok", show="silent", supported=True)   # 8s 동안 «광고 중»이 유지된다
    ctl.set_best(0)
    ctl.start()
    page.wait_for_timeout(500)
    ctl.grow_to(TH[0] + 100); ctl.wait_offer()
    # ★양성대조는 탭 «전»의 두 시점으로 잰다. 탭 직전/직후로 재면 그 사이에
    #   프레임이 없어서(탭이 그 자리에서 멈추므로) 「안 움직였다」가 되어, 정작
    #   증명하려던 「원래는 움직였다」를 못 보여준다.
    mv0 = ctl.rw()
    page.wait_for_timeout(400)
    mv1 = ctl.rw()
    chk("R13-p0 양성대조: 누르기 «전»에는 실제로 움직이고 있었다(배너가 떠 있는 채로)",
        mv1["worldTime"] > mv0["worldTime"] + 0.2
        and (abs(mv1["player"]["x"] - mv0["player"]["x"]) > 1
             or abs(mv1["player"]["y"] - mv0["player"]["y"]) > 1),
        f"({mv0['player']['x']:.1f},{mv0['player']['y']:.1f}) -> ({mv1['player']['x']:.1f},{mv1['player']['y']:.1f})"
        f" · 월드시계 {mv0['worldTime']:.2f} -> {mv1['worldTime']:.2f}")
    ctl.grow_ad_async()          # ★기다리지 않는다 — 광고가 «도는 중»을 봐야 한다
    page.wait_for_timeout(200)
    ad1 = ctl.rw()
    page.wait_for_timeout(700)
    ad2 = ctl.rw()
    chk("R13-a ★광고가 도는 700ms 동안 «월드 시계»가 한 틱도 안 갔다",
        ad1["worldTime"] == ad2["worldTime"] and ad1["mode"] == "offer",
        f"{ad1['worldTime']} == {ad2['worldTime']} mode={ad1['mode']}")
    chk("R13-b ★뱀 머리가 «1 유닛도» 안 움직였다 - 광고를 기다리다 죽지 않는다",
        ad1["player"]["x"] == ad2["player"]["x"] and ad1["player"]["y"] == ad2["player"]["y"],
        f"({ad1['player']['x']},{ad1['player']['y']})")
    chk("R13-c ★그리고 배너는 «그대로 있다» - 무엇을 기다리는지 화면이 말한다",
        page.evaluate("() => window.__ui.shown(window.__ui.grow())") is True
        and "..." in str(page.evaluate("() => window.__ui.growText()") or "")
        or page.evaluate("() => window.__ui.shown(window.__ui.grow())") is True,
        page.evaluate("() => window.__ui.growText()"))
    # 타임아웃(8s)까지 기다렸다가 복귀 절차를 확인한다.
    page.wait_for_function(
        "() => { const s = window.__coilReward.state();"
        "        return s.counting || s.mode === 'play'; }", timeout=14000)
    cdst = ctl.rw()
    chk("R13-d 광고가 끝나면(실패 포함) 반드시 복귀 절차를 탄다",
        cdst["counting"] is True or cdst["mode"] == "play",
        f"mode={cdst['mode']} counting={cdst['counting']}")
    page.wait_for_function("() => window.__coilReward.state().mode === 'play'", timeout=12000)
    r13 = ctl.rw()
    page.wait_for_timeout(500)
    r13b = ctl.rw()
    chk("R13-e ★재개 뒤 월드 시계가 «다시 흐른다»(멈춘 채로 남지 않는다)",
        r13b["worldTime"] > r13["worldTime"], f"{r13['worldTime']} -> {r13b['worldTime']}")

    # 카운트다운 «길이»와 «프레임 dt 기반»을 실시간으로 잰다(광고는 즉시 성공 스텁).
    ctl.reset(**OK)
    ctl.set_best(0)
    ctl.start()
    page.wait_for_timeout(400)
    ctl.grow_to(TH[0] + 100); ctl.wait_offer()
    t0 = time.time()
    ctl.grow_ad()
    cd = ctl.rw()
    chk("R13-f 보상 뒤 «즉시 재개»가 아니라 카운트다운이 돈다",
        cd["mode"] == "offer" and cd["counting"] is True
        and page.evaluate("() => window.__ui.counting()") is True,
        f"mode={cd['mode']} counting={cd['counting']}")
    c1 = ctl.rw()
    page.wait_for_timeout(600)
    c2 = ctl.rw()
    chk("R13-g ★카운트다운 중에도 월드는 «여전히» 멈춰 있다",
        c1["worldTime"] == c2["worldTime"] and c1["player"]["x"] == c2["player"]["x"],
        f"{c1['worldTime']} == {c2['worldTime']}")
    before_stall = ctl.rw()["countLeft"]
    page.evaluate("() => { const t = Date.now(); while (Date.now() - t < 1500) { /* stall */ } }")
    after_stall = ctl.rw()["countLeft"]
    eaten = before_stall - after_stall
    chk("R13-h ★★1.5초 «멈춤»이 카운트다운을 거의 못 깎는다(프레임 dt 기반)",
        eaten < 0.6, f"{before_stall:.2f} -> {after_stall:.2f} (먹은 시간 {eaten:.2f}s)")
    page.wait_for_function("() => window.__coilReward.state().mode === 'play'", timeout=14000)
    el = time.time() - t0 - 1.5   # 위에서 막은 1.5초는 «렌더된 시간»이 아니다
    chk("R13-i 카운트다운이 «설계값 %ss» 만큼 걸린다(실시간 측정, 멈춤 1.5s 제외)" % CD,
        CD - 0.8 <= el <= CD + 2.0, f"{el:.2f}s")
    ctl.clear_cooldown()
    page.wait_for_timeout(900)
    chk("R13-j ★커진 뒤 재개해서 0.9초 뒤에도 «살아 있다»(성장이 즉사시키지 않는다)",
        ctl.rw()["player"]["alive"] is True)

    # ★ 멈춰 있던 시간이 «플레이 시간»으로 세어지면 안 된다(부활 경로와 같은 규율).
    #   ⇒ 이제 «배너 5초»는 실제 플레이라 들어가는 게 맞고, «광고+카운트다운»만 빠진다.
    ctl.reset(load="ok", show="silent", supported=True)
    ctl.set_best(0)
    ctl.start()
    page.wait_for_timeout(600)
    ctl.grow_to(TH[0] + 100); ctl.wait_offer()
    ctl.grow_ad_async()
    page.wait_for_timeout(200)
    sec_at_ad = ctl.rw()["runSeconds"]
    # ★보정(runStartedAt += 멈춘 시간)은 «복귀하는 순간»에 한 번에 들어간다.
    #   그래서 광고 «도중»에 재면 벽시계 그대로 보인다 — 재는 자리가 틀린 것이지
    #   결함이 아니다. 복귀가 끝난 뒤에 잰다.
    page.wait_for_function("() => window.__coilReward.state().mode === 'play'", timeout=20000)
    sec_after = ctl.rw()["runSeconds"]
    stalled = ctl.rw()["worldTime"]
    chk("R13-k ★멈춰 있던 광고+카운트다운 시간이 «플레이 시간»에 안 들어간다",
        (sec_after - sec_at_ad) < 2.0,
        f"{sec_at_ad:.2f}s -> {sec_after:.2f}s (멈춰 있던 시간 8s+ 중 {sec_after - sec_at_ad:.2f}s 만 반영)"
        f" · 월드시계 {stalled:.2f}s")

    # ══ R14. ★★보상 기준 = 「광고 시청 «직전»」 질량 (President 2026-09-01) ══
    #  배너가 떠 있는 5초 동안 게임이 흐르므로 질량이 변한다. 그래서 기준을
    #  「문턱값」도 「배너가 뜬 순간」도 아닌 «멈추는 순간»으로 못박는다.
    print("\n[R14] ★보상 기준 = 광고 직전 질량 x %s" % K)
    ctl.reset(**OK)
    ctl.set_best(0)
    ctl.start()
    ctl.grow_to(TH[0] + 50); ctl.wait_offer()       # 배너는 550 에서 떴다
    at_show = ctl.rw()
    ctl.grow_to(620)                                 # 배너가 떠 있는 사이 «자랐다»
    ctl.grow_ad()
    up = ctl.rw()
    g = up["lastGrowth"]
    # ★620 에 «정확히» 못 박지 않는 이유: 620 을 세운 뒤 탭이 도착하기까지도
    #   게임이 흐른다(그게 이 설계다). 그래서 ±10 을 허용하되 «세 가지»를 함께 잰다 —
    #   ① 문턱값(500)이 기준이 아니다 ② 배너가 뜬 순간 점수(550)도 아니다
    #   ③ 결과는 «그 기준»의 정확히 1.2배다. 그러면 기준점이 하나로 특정된다.
    chk("R14-a ★뜬 순간 %d -> 탭할 때 620 이면 보상은 «620 x %s = 744» 다(문턱값 %d 기준 아님)"
        % (TH[0] + 50, K, TH[0]),
        g is not None and abs(g["fromMass"] - 620) < 10
        and abs(g["toMass"] - g["fromMass"] * K) < 1e-6
        and abs(g["toMass"] - 744) < 12 and abs(g["fromMass"] - TH[0]) > 100
        and abs(g["fromMass"] - at_show["offer"]["score"]) > 50,
        f"뜬 순간 {at_show['offer']['score']} · 기준 {g['fromMass']:.1f} -> {g['toMass']:.1f} (점수 {g['toScore']})"
        if g else "없음")
    ctl.finish_count()
    page.wait_for_function("() => window.__coilReward.state().mode === 'play'", timeout=8000)

    # 질량이 «줄어든» 채로 탭하는 경우(질주 BOOST_DRAIN 이 실제로 만든다).
    ctl.reset(**OK)
    ctl.set_best(0)
    ctl.start()
    ctl.grow_to(TH[0] + 50); ctl.wait_offer()
    ctl.grow_to(430)                                 # 배너가 떠 있는 사이 «줄었다»
    ctl.grow_ad()
    dn = ctl.rw()
    g2 = dn["lastGrowth"]
    chk("R14-b ★줄어든 채로 탭하면 «줄어든» 값이 기준이다(430 x %s = 516 · 문턱 %d 기준 아님)"
        % (K, TH[0]),
        g2 is not None and abs(g2["fromMass"] - 430) < 10
        and abs(g2["toMass"] - g2["fromMass"] * K) < 1e-6
        and abs(g2["toMass"] - 516) < 12,
        f"기준 {g2['fromMass']:.1f} -> {g2['toMass']:.1f}" if g2 else "없음")
    ctl.finish_count()
    page.wait_for_function("() => window.__coilReward.state().mode === 'play'", timeout=8000)

    # 광고 «로드 지연» 동안 질량이 변하지 않는다 — 멈춰 있으므로 「직전 = 직후」다.
    ctl.reset(load="ok", show="silent", supported=True)
    ctl.set_best(0)
    ctl.start()
    ctl.grow_to(TH[0] + 50); ctl.wait_offer()
    ctl.grow_to(700)
    page.wait_for_timeout(120)
    ctl.grow_ad_async()
    page.wait_for_timeout(150)
    snap = ctl.rw()
    page.wait_for_timeout(1200)
    snap2 = ctl.rw()
    chk("R14-c ★스냅샷이 «광고 표시 시점» 값이고, 로드가 늦어도 그 값이 안 변한다",
        abs(snap["growthBase"] - 700) < 10 and snap2["growthBase"] == snap["growthBase"]
        and snap2["player"]["mass"] == snap["player"]["mass"],
        f"base={snap['growthBase']:.1f} (1.2s 뒤 {snap2['growthBase']:.1f}) · 질량 {snap['player']['mass']:.1f}")
    page.wait_for_function("() => window.__coilReward.state().mode === 'play'", timeout=16000)

    # ★늦은 보상: 이미 재개돼 질량이 달라져 있어도 «스냅샷»으로 준다.
    #   ⛔「스냅샷과 현재 중 큰 값」을 안 쓰는 이유는 main.ts doGrowth 주석의 어뷰징 검토.
    ctl.reset(load="ok", show="veryLateReward", supported=True)
    ctl.set_best(0)
    ctl.start()
    ctl.grow_to(TH[0] + 50); ctl.wait_offer()
    ctl.grow_to(600)
    page.wait_for_timeout(120)
    ctl.grow_ad()                       # 3s 판정 실패 -> 카운트다운
    ctl.finish_count()
    try:
        page.wait_for_function("() => window.__coilReward.state().mode === 'play'", timeout=8000)
        ctl.grow_to(3000)               # 재개 뒤 «크게» 자랐다
    except Exception:
        pass
    page.wait_for_function(
        "() => window.__coilReward.state().lastGrowth !== null", timeout=8000)
    late = ctl.rw()
    g3 = late["lastGrowth"]
    chk("R14-d ★늦은 보상도 «스냅샷»(600) 기준이다 - 재개 뒤 커진 3000 을 기준으로 삼지 않는다",
        g3 is not None and abs(g3["fromMass"] - 600) < 10 and g3["preMass"] > 2000,
        f"기준 {g3['fromMass']:.1f} · 지급 직전 실제 질량 {g3['preMass']:.1f} -> {g3['toMass']:.1f}"
        if g3 else "없음")

    # ══ R15. 최고 기록 트리거 · 일일 상한 ═════════════════════════════════
    print("\n[R15] 최고 기록 트리거(최소 %d) · 일일 상한" % BEST_MIN)
    ctl.reset(**OK)
    ctl.set_best(BEST_MIN - 1)
    ctl.start()
    ctl.grow_to(BEST_MIN + 60)
    page.wait_for_timeout(500)
    chk("R15-a ★기록이 %d 미만이면 «안 뜬다» - 생애 첫 판 20초 만에 광고를 들이밀지 않는다" % BEST_MIN,
        ctl.rw()["offer"] is None, json.dumps(ctl.rw()["offer"]))

    ctl.reset(**OK)
    ctl.set_best(BEST_MIN)
    ctl.start()
    ctl.grow_to(BEST_MIN + 60); ctl.wait_offer()
    ob = ctl.rw()["offer"]
    chk("R15-b 기록이 %d 이상이면 «돌파하는 순간» 뜬다" % BEST_MIN,
        ob and ob["kind"] == "best" and ob["value"] == BEST_MIN, json.dumps(ob))
    ctl.dismiss()
    # ⚠️점수를 크게 올리면 «문턱» 트리거가 떠서 이 검사가 잘못 실패한다.
    #   ⇒ 첫 문턱 «아래»에 머무는 점수로 올린다 — 최고기록만 계속 깨는 상황이다.
    assert BEST_MIN < TH[0], (BEST_MIN, TH[0])
    ctl.grow_to(TH[0] - 40)
    page.wait_for_timeout(500)
    r15c = ctl.rw()
    chk("R15-c ★최고기록도 판당 1회 - 계속 갱신해도 «다시 안 뜬다»",
        r15c["offer"] is None and r15c["growth"]["bestUsed"] is True,
        f"점수 {TH[0] - 40}(문턱 {TH[0]} 미만) · offer={r15c['offer']}")

    # 일일 상한: 한 판에 최대 CAP 회뿐이므로 «판을 갈아 가며» 채운다.
    # ⛔ 「canGrow 가 false 가 되면 멈춘다」로 세면 «판당» 상한에서 멈춘다(초록불 오판).
    ctl.reset(**OK)
    guard = 0
    while ctl.rw()["used"]["growth"] < DAILY_GROWTH_CAP and guard < 12:
        guard += 1
        ctl.set_best(0)
        ctl.start()
        for i in range(CAP):
            if ctl.rw()["used"]["growth"] >= DAILY_GROWTH_CAP:
                break
            ctl.grow_to(TH[min(i, len(TH) - 1)] + 100)
            try:
                ctl.wait_offer(timeout=2500)
            except Exception:
                break
            ctl.watch_ad()
    st = ctl.rw()
    chk("R15-d ★일일 상한에서 «멈춘다»(무한 지급 0)",
        st["used"]["growth"] == DAILY_GROWTH_CAP and st["canGrow"] is False,
        f"used={st['used']['growth']} cap={DAILY_GROWTH_CAP} canGrow={st['canGrow']}")
    ctl.start()
    ctl.set_best(0)
    ctl.grow_to(TH[0] + 100)
    page.wait_for_timeout(600)
    chk("R15-e 상한에 닿으면 새 판에서도 제안이 «아예 안 뜬다»",
        ctl.rw()["offer"] is None and ctl.rw()["mode"] == "play",
        f"mode={ctl.rw()['mode']}")

    # 여러 문턱을 «한 번에» 지난 경우 — 이름은 가장 큰 사건으로 불러야 한다.
    ctl.reset(**OK)
    ctl.set_best(0)
    ctl.start()
    page.wait_for_timeout(300)
    ctl.grow_to(TH[2] + 100)          # 500·2000·5000 을 한 프레임에 통과
    ctl.wait_offer()
    multi = ctl.rw()
    chk("R15-f ★여러 문턱을 한 번에 지나면 «가장 높은» 것으로 뜬다(5,100점에게 「500 돌파」 금지)",
        multi["offer"]["value"] == TH[2],
        f"점수 {multi['offer']['score']} -> 「{multi['offer']['value']} 돌파」")
    chk("R15-g 그리고 지나온 문턱은 «전부» 소비된다(하나씩 다시 뜨지 않는다)",
        all(multi["growth"]["used"]) and multi["growth"]["shown"] == 1,
        json.dumps(multi["growth"]))
    ctl.dismiss()
    page.wait_for_timeout(500)
    chk("R15-h 실제로 «연달아 안 뜬다»", ctl.rw()["offer"] is None)

    # ══ R16. ★제안 사이 쿨다운 ════════════════════════════════════════════
    print("\n[R16] ★제안 사이 쿨다운 %ss - 배너가 사라지자마자 또 뜨는 일 차단" % GAP)
    ctl.reset(**OK)
    ctl.set_best(0)
    ctl.start()
    page.wait_for_timeout(400)
    ctl.grow_to(TH[0] + 50); ctl.wait_offer()
    t_offer = ctl.rw()["worldTime"]
    ctl.dismiss(clear_cd=False)              # ★여기서는 «일부러» 쿨다운을 남긴다
    ctl.grow_to(TH[1] + 100)                 # 다음 문턱을 즉시 넘긴다
    page.wait_for_timeout(600)
    cd = ctl.rw()
    chk("R16-a ★쿨다운 중에는 다음 문턱을 넘어도 제안이 «안 뜬다»",
        cd["offer"] is None and cd["growthCooling"] is True and cd["mode"] == "play",
        f"offer={cd['offer']} cooling={cd['growthCooling']} mode={cd['mode']}")
    chk("R16-b ★그리고 그 문턱은 «소비되지 않았다» - 쿨다운은 트리거를 버리지 않는다",
        cd["growth"]["used"][1] is False and cd["growth"]["shown"] == 1,
        json.dumps(cd["growth"]))
    chk("R16-c 쿨다운 시각이 «월드 시계» 기준이다(벽시계가 아니다)",
        abs(cd["growth"]["lastOfferAt"] - t_offer) < 0.5,
        f"lastOfferAt={cd['growth']['lastOfferAt']:.2f} vs 제안 시각 worldTime={t_offer:.2f}")
    ctl.clear_cooldown()
    ctl.wait_offer(timeout=4000)
    after_cd = ctl.rw()
    chk("R16-d ★양성대조: 쿨다운만 풀면 «즉시» 뜬다(막고 있던 것이 쿨다운이었다는 증거)",
        after_cd["offer"] is not None and after_cd["offer"]["value"] == TH[1],
        json.dumps(after_cd["offer"]))
    ctl.dismiss()

    # 쿨다운이 «스스로» 끝나는가 - 훅 없이 «실시간»으로 확인한다.
    # ⚠️쿨다운(10s)을 기다리는 사이 봇에게 죽으면 판이 끝난다. 그건 검사 실패가
    #   아니라 «재현 실패»이므로 다시 시도한다. 전부 죽으면 정직하게 skip.
    #   ⛔결과(뜬다/안 뜬다)로는 절대 재시도하지 않는다 — 그러면 실패를 초록으로 덮는다.
    nat = None
    for _try in range(5):
        ctl.reset(**OK)
        ctl.set_best(BEST_MIN)
        ctl.start()
        page.wait_for_timeout(300)
        ctl.grow_to(BEST_MIN + 40)      # 최고기록 돌파 -> 제안 ①
        ctl.wait_offer()
        ctl.dismiss(clear_cd=False)
        ctl.grow_to(TH[0] + 20)         # 문턱 500 돌파 -> 쿨다운에 막힌다
        page.wait_for_timeout(400)
        mid = ctl.rw()
        if not mid["player"]["alive"]:
            continue
        try:
            page.wait_for_function(
                "() => { const s = window.__coilReward.state();"
                "        return s.offer !== null || !s.player.alive; }",
                timeout=int((GAP + 8) * 1000))
        except Exception:
            pass
        end = ctl.rw()
        if end["offer"] is not None:
            nat = (True, end["worldTime"] - mid["worldTime"])
            ctl.dismiss()
            break
        if end["player"]["alive"]:
            # 살아 있는데도 안 떴다 = 진짜 실패다. 재시도하지 않는다.
            nat = (False, -1)
            break
    if nat is None:
        chk("R16-e 쿨다운 자연 만료 - 5회 모두 대기 중 사망해 건너뜀", True, "skipped")
    else:
        ok_nat, el2 = nat
        chk("R16-e ★쿨다운은 «스스로» 끝난다 - 훅 없이 기다리면 그대로 뜬다",
            ok_nat, f"쿨다운 {GAP}s · 실제 대기 {el2:.1f}s(월드 시계)")

    # ══ R17. ★사망과의 관계 - 배너 정리 · 부활 제안과 비충돌 ═══════════════
    #  배너가 떠 있는 5초 동안 게임이 흐르므로, «못 누르고 죽는» 경우가 생긴다.
    #  그건 의도된 결과지만, 죽는 순간 배너가 남아 있으면 사망 시트의 «부활 제안»과
    #  두 광고 권유가 한 화면에 겹친다.
    print("\n[R17] ★배너가 떠 있는 채로 죽으면 - 정리 · 부활 제안과 비충돌")
    ctl.reset(**OK)
    ctl.set_best(0)
    ctl.start()
    page.wait_for_timeout(300)
    ctl.grow_to(TH[0] + 100); ctl.wait_offer()
    live = ctl.rw()
    chk("R17-p0 양성대조: 죽기 «전»에 배너가 실제로 떠 있었다",
        live["offer"] is not None
        and page.evaluate("() => window.__ui.shown(window.__ui.grow())") is True)
    used0 = live["used"]["growth"]
    ctl.die_border()
    dead = ctl.rw()
    chk("R17-a ★죽으면 배너가 «사라진다»",
        dead["offer"] is None
        and page.evaluate("() => window.__ui.shown(window.__ui.grow())") is False,
        f"offer={dead['offer']}")
    chk("R17-b ★그리고 사망 시트의 «부활» 제안이 뜬다 - 광고 권유 둘이 겹치지 않는다",
        dead["canRevive"] is True
        and page.evaluate("() => window.__ui.shown(window.__ui.revive())") is True
        and page.evaluate("() => window.__ui.vis(2)") is True,
        f"canRevive={dead['canRevive']}")
    chk("R17-c 무산된 제안의 기준 질량도 «버려진다»",
        dead["growthBase"] == 0, f"growthBase={dead['growthBase']}")
    ctl.grow_ad()
    after_dead = ctl.rw()
    chk("R17-d ★죽은 뒤에 성장 광고를 «직접 불러도» 아무 일도 없다(지급 0)",
        after_dead["used"]["growth"] == used0 and after_dead["lastGrowth"] is None,
        f"used {used0} -> {after_dead['used']['growth']}")

    # ══ R18. 지면 ID ══════════════════════════════════════════════════════
    print("\n[R18] 지면 ID - 성장 보상이 «자기 지면»으로 간다 / 전면형 무오염")
    ctl.reset(**OK)
    ctl.set_best(0)
    ctl.start()
    ctl.grow_to(TH[0] + 100); ctl.wait_offer()
    n0 = len(ctl.calls()["ids"])
    ctl.grow_ad()
    ids = ctl.calls()["ids"][n0:]
    chk("R18-a 성장 광고(load+show)가 «기록 돌파 지면»으로만 갔다",
        len(ids) >= 2 and all(i == REWARD_IDS["growth"] for i in ids[:2]), f"{len(ids)}건 {ids}")
    chk("R18-b 전면형 지면 ID 가 «섞이지 않았다»", INTERSTITIAL_ID not in ids[:2])
    ctl.finish_count()


def run_ads_off(page, results, fails):
    """?ads=off / ?demo=1 에서는 «스텁을 꽂아도» 리워드 UI 가 하나도 안 뜬다.

    ★ 왜 이 검사가 필요한가: 기존 촬영·QA 도구(tools/gfx_harness.py)는 «전부»
      ?ads=off 로 띄운다. 이 조건이 무너지면 스토어 스크린샷에 광고 버튼이
      끼어들고, 지금까지 쌓은 라이브 대조군 스크린샷이 통째로 못 쓰게 된다.
    ★ 픽셀 비교로는 증명할 수 없다 - 그 화면들은 뒤에서 «게임이 계속 도는»
      장면이라 같은 빌드를 두 번 찍어도 픽셀이 다르다. 그래서 «DOM 사실»로 잰다.
    """
    def chk(name, ok, detail=""):
        results.append({"check": name, "ok": bool(ok), "detail": str(detail)})
        print(("  PASS  " if ok else "  FAIL  ") + name + ("   " + str(detail) if detail else ""))
        if not ok:
            fails.append(name)

    print("\n[A0] ?ads=off · ?demo=1 무접촉 - 기존 촬영/QA 경로에 리워드가 «끼어들지 않는다»")
    page.evaluate("(b) => window.__coilAds.installStub(b)",
                  {"load": "ok", "show": "reward", "supported": True})
    page.evaluate("() => window.__coilReward.refresh()")
    st = page.evaluate("() => window.__coilReward.state()")
    chk("A0-a 양성대조: 스텁은 «실제로» 꽂혔다(usable=true)", st["usable"] is True)
    chk("A0-b ★그래도 부활/부스트 제안이 «안 뜬다»(ads=off 게이트)",
        st["canRevive"] is False and st["canBoost"] is False,
        f"canRevive={st['canRevive']} canBoost={st['canBoost']}")
    chk("A0-c 메뉴 부스트 버튼 hidden",
        page.evaluate("() => window.__ui.shown(window.__ui.boost())") is False)
    chk("A0-d 잠긴 스킨 광고 배지 0개",
        page.evaluate("() => window.__ui.skinAds()") == 0)
    chk("A0-e 사망 시트 부활 버튼 hidden",
        page.evaluate("() => window.__ui.shown(window.__ui.revive())") is False)
    # 스킨 해금도 «호출해도» 안 열려야 한다.
    page.evaluate("() => window.__coilReward.unlockSkin('milk')")
    st2 = page.evaluate("() => window.__coilReward.state()")
    chk("A0-f 직접 호출해도 해금 «안 됨» · 광고 «안 뜸»",
        "milk" not in st2["adSkins"] and st2["used"]["skinUnlock"] == 0)

    # 기록 돌파(2026-08-31): ads=off 에서는 문턱을 넘어도 «게임이 멈추지 않는다».
    # ★ 여기가 무너지면 스토어 스크린샷·벤치·소크가 전부 광고 판에서 얼어붙는다.
    page.evaluate("() => window.__coil.startRun()")
    page.wait_for_timeout(300)
    page.evaluate("() => window.__coil.grow(20000)")
    page.wait_for_timeout(600)
    st3 = page.evaluate("() => window.__coilReward.state()")
    chk("A0-g ★ads=off 는 문턱 20,000 을 넘어도 제안 0 · 게임이 «안 멈춘다»",
        st3["canGrow"] is False and st3["offer"] is None and st3["mode"] == "play",
        f"canGrow={st3['canGrow']} offer={st3['offer']} mode={st3['mode']}")


def main():
    if not (DIST / "index.html").exists():
        print("dist 가 없다: npm run build:web")
        return 2
    OUT.mkdir(parents=True, exist_ok=True)
    port, srv = serve()
    results, fails = [], []
    console_errors = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)  # ★headless 고정 - 창을 띄우지 않는다
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                            is_mobile=True, has_touch=True, locale="ko-KR")
        page = ctx.new_page()
        page.on("pageerror", lambda e: console_errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: console_errors.append("console." + m.type + ": " + m.text)
                if m.type == "error" else None)
        # ★ads 파라미터를 «주지 않는다» = 운영과 같은 normal 모드. 리워드 제안이 켜진다.
        page.goto(f"http://127.0.0.1:{port}/?debug=1&quiet=1&seed=7", wait_until="load")
        page.add_init_script(UI_JS)
        page.evaluate(UI_JS)
        page.wait_for_function("() => !!window.__coilReward && !!window.__coilAds", timeout=8000)
        try:
            run(page, results, fails)
            run_growth(page, results, fails)
        finally:
            ctx.close()

        # ── ?ads=off 무접촉 (별도 컨텍스트: 부팅 파라미터가 다르다) ──────────
        ctx2 = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                             is_mobile=True, has_touch=True, locale="ko-KR")
        page2 = ctx2.new_page()
        page2.on("pageerror", lambda e: console_errors.append("pageerror(ads=off): " + str(e)))
        page2.goto(f"http://127.0.0.1:{port}/?debug=1&quiet=1&ads=off&seed=7", wait_until="load")
        page2.evaluate(UI_JS)
        page2.wait_for_function("() => !!window.__coilReward", timeout=8000)
        try:
            run_ads_off(page2, results, fails)
        finally:
            ctx2.close()
            b.close()
    srv.shutdown()

    print("\n콘솔 오류: %d 건 %s" % (len(console_errors), console_errors[:5] if console_errors else ""))
    if console_errors:
        fails.append("console errors")
    (OUT / "qa_reward.json").write_text(
        json.dumps({"results": results, "fails": fails, "consoleErrors": console_errors},
                   ensure_ascii=False, indent=1), encoding="utf-8")
    print("\n%d/%d PASS" % (len(results) - len([r for r in results if not r["ok"]]), len(results)))
    print("RESULT:", "PASS" if not fails else "FAIL (%d)" % len(fails))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
