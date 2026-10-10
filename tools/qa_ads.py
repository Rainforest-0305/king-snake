# -*- coding: utf-8 -*-
"""qa_ads.py - 전면광고 게이트 «기능» 검증. headless 고정.

════════════════════════════════════════════════════════════════════════════
왜 이 검사기가 이렇게 생겼나
════════════════════════════════════════════════════════════════════════════
「2판마다 광고」는 스크린샷으로 증명할 수 없다. 그리고 «운영 광고 ID 를 로컬에서
렌더하는 것은 계정 중단 사유»다(광고 핸드북 §2-10) - 실제로 띄워 볼 수도 없다.

그래서 «브릿지 경계»에만 스텁을 꽂는다. 계수·빚·노출 판정·타임아웃 로직은
운영과 «완전히 같은 코드»가 돈다. 스텁은 SDK 함수 두 개를 대신할 뿐이다.

★★ 양성대조(positive control) 를 «먼저» 본다.
   핸드북 §3-1·§5-1: 「0건」은 부재의 증거가 아니다. 계측기가 죽어도 0 이 나온다.
   그래서 P0 에서 「반드시 움직여야 하는 값이 실제로 움직이는가」를 먼저 확인하고,
   그게 실패하면 나머지 초록불은 «전부 무의미»하다고 선언한다.

실행:
  npm run build:web && python tools/qa_ads.py
"""
from __future__ import annotations

import http.server
import json
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
DIST = ROOT / "dist"
OUT = ROOT / "qa" / "ads"

LIVE_AD_ID = "ait.v2.live.XXXXXXXXXXXXXXXX"


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


# ── 페이지 조작 헬퍼 (셸 DOM 실측: .overlay 순서 = 0 메뉴 / 1 일시정지 / 2 결과) ──
UI_JS = r"""
window.__ui = {
  ovs: () => Array.from(document.querySelectorAll('.overlay')),
  play:  () => document.querySelector('.p-play'),
  pauseBtn: () => document.querySelector('.hud-pause'),
  quit:  () => document.querySelectorAll('.overlay')[1].querySelector('.btn-ghost'),
  resume:() => document.querySelectorAll('.overlay')[1].querySelector('.btn-primary'),
  again: () => document.querySelectorAll('.overlay')[2].querySelector('.btn-primary'),
  toMenu:() => document.querySelectorAll('.overlay')[2].querySelector('.btn-ghost'),
  vis: (n) => !document.querySelectorAll('.overlay')[n].classList.contains('hidden'),
};
"""


class Ctl:
    """한 페이지를 잡고 게임을 몰아가는 조종기."""

    def __init__(self, page):
        self.p = page

    def state(self):
        return self.p.evaluate("() => window.__coilAds.state()")

    def mode(self):
        return self.p.evaluate("() => window.__coil.state().mode")

    def calls(self):
        return self.p.evaluate("() => window.__coilAdCalls || {load:0,show:0,ids:[]}")

    def reset(self, stub=None):
        # ★ 시나리오 사이를 «완전히» 갈라놓는다. 안 하면 앞 시나리오가 남긴
        #   「열린 판」이 다음 시나리오의 안전망 계수에 걸려 결과가 섞인다.
        self.p.evaluate("() => window.__coil.toMenu()")
        self.p.evaluate("() => window.__coilAds.reset()")
        self.p.evaluate("() => { window.__coilAdCalls = {load:0, show:0, ids:[]}; }")
        if stub is not None:
            self.p.evaluate("(b) => window.__coilAds.installStub(b)", stub)

    def click(self, name):
        self.p.evaluate(f"() => window.__ui.{name}().click()")

    def start(self):
        """메뉴 또는 결과 화면에서 새 판을 시작한다."""
        if self.p.evaluate("() => window.__ui.vis(2)"):
            self.click("again")
        else:
            self.click("play")

    def die(self):
        """경계 밖으로 머리를 옮겨 «정상 경로»로 죽인다(테스트용 분기 없음)."""
        self.p.evaluate("() => window.__coil.kill()")
        self.p.wait_for_function("() => window.__coil.state().mode === 'dead'", timeout=4000)

    def wait_death_screen(self):
        self.p.wait_for_function("() => window.__ui.vis(2)", timeout=4000)

    def pause_quit(self):
        self.click("pauseBtn")
        self.p.wait_for_function("() => window.__ui.vis(1)", timeout=3000)
        self.click("quit")


def run(page, results, fails):
    ctl = Ctl(page)

    def chk(name, ok, detail=""):
        # ★2026-09-10: detail 이 dict/list 로 와서 TypeError 로 «검사기가 통째로 죽은» 사고가 있었다
        #   (P7 이후 검사 전부가 안 돌았는데 종료코드만 1 이라 「그냥 실패」로 보였다).
        #   출력용으로만 문자열화한다 — results 에는 원본을 그대로 남겨 보고서가 값을 잃지 않게 한다.
        results.append({"check": name, "ok": bool(ok), "detail": detail})
        if detail is None:
            shown = ""
        elif isinstance(detail, str):
            shown = detail
        else:
            try:
                shown = json.dumps(detail, ensure_ascii=False)
            except Exception:  # noqa: BLE001
                shown = repr(detail)
        print(("  PASS  " if ok else "  FAIL  ") + name + ("   " + shown if shown else ""))
        if not ok:
            fails.append(name)

    stub_ok = {"load": "ok", "show": "dismissed", "supported": True}

    # ══ P0. 양성대조 — 계측기가 «살아 있는가» ════════════════════════════
    print("\n[P0] 양성대조 - 계측기 생존 확인 (이게 실패하면 아래 전부 무의미)")
    ctl.reset(stub_ok)
    s0 = ctl.state()
    ctl.start()
    time.sleep(0.3)
    ctl.die()
    s1 = ctl.state()
    chk("P0-a 판 계수가 «실제로 움직인다» (0 -> 1)",
        s0["plays"] == 0 and s1["plays"] == 1, f"plays {s0['plays']} -> {s1['plays']}")
    # ★2026-09-10 개정(레인 A · 「요청 = 노출」): 전면형 로드는 «빚(adPending)이 있을 때만» 나간다.
    #   첫 판(빚 없음)에서는 로드가 «0» 이어야 한다 — 예전엔 판 시작마다 미리 받아 요청 3,471 → 노출 1,392(40%)였다.
    page.wait_for_timeout(300)
    c = ctl.calls()
    chk("P0-b ★빚 없는 첫 판 = 전면형 로드 «0»(요청 = 노출)", c["load"] == 0, f"load={c['load']}")
    # 2판째 사망 = 빚 발생 → 이때 «비로소» 로드가 나가야 한다. 안 나가면 광고 0건은 게이트가 아니라 스텁 탓이다.
    ctl.wait_death_screen(); ctl.click("again"); time.sleep(0.3); ctl.die()
    page.wait_for_timeout(300)
    c = ctl.calls()
    chk("P0-b2 2판째 사망(빚 발생) = 스텁 loadFullScreenAd 가 «실제로 불렸다»", c["load"] > 0,
        f"load={c['load']} adPending={ctl.state()['adPending']}")
    chk("P0-c 스텁에 «운영 지면 ID» 가 그대로 전달됐다",
        len(c["ids"]) > 0 and all(i == LIVE_AD_ID for i in c["ids"]), str(set(c["ids"])))
    # 음성대조: 스텁을 빼면 adReady 가 서지 «않아야» 한다(스텁이 진짜 원인임을 증명).
    # ★ 이게 곧 「토스 밖(브라우저·MS Store·Pages)에서는 광고 기계가 아예 안 돈다」의 실측이다.
    ctl.reset(None)
    for _ in range(2):                      # 빚이 «있는» 상태에서 본다 — 빚 없는 0 은 이 규칙만으로도 0 이다
        if ctl.mode() != "play":
            ctl.start()
        time.sleep(0.3); ctl.die(); ctl.wait_death_screen()
    page.wait_for_timeout(600)
    sN = ctl.state()
    chk("P0-d 음성대조 - 스텁 없으면(=토스 밖) 빚이 있어도 adReady=false · show 0건",
        sN["adPending"] is True and sN["adReady"] is False and ctl.calls()["show"] == 0, json.dumps(sN))
    if fails:
        print("  !! 양성/음성대조 실패 - 아래 결과를 신뢰하지 마라")

    # ══ P1. 「판」이 «모든 종료 경로»에서 동일하게 세어지는가 ══════════════
    print("\n[P1] 판 계수 - 종료 경로별 (요구사항 1)")

    # (a) 사망 -> 결과 화면 -> 다시하기
    ctl.reset(stub_ok)
    ctl.start(); time.sleep(0.25); ctl.die(); a1 = ctl.state()["plays"]
    ctl.wait_death_screen(); ctl.click("again"); page.wait_for_timeout(300)
    chk("P1-a 사망(결과 화면 «거침») = +1", a1 == 1, f"plays={a1}")

    # (b) 사망 -> 결과 화면 -> 메뉴 (결과 화면 버튼을 «다른 것»으로 나감)
    ctl.reset(stub_ok)
    ctl.start(); time.sleep(0.25); ctl.die(); b1 = ctl.state()["plays"]
    ctl.wait_death_screen(); ctl.click("toMenu"); page.wait_for_timeout(300)
    b2 = ctl.state()["plays"]
    chk("P1-b 사망 -> 「메뉴」 = +1 (이탈 버튼이 «중복 계수»를 만들지 않는다)",
        b1 == 1 and b2 == 1, f"death={b1} afterMenu={b2}")

    # (c) 결과 화면을 «안 거치고» 나가는 경로 - 일시정지 -> 그만두기 (자격 충족)
    ctl.reset(stub_ok)
    ctl.start()
    time.sleep(2.4)  # MIN_PLAY_MS(2000) 초과
    ctl.pause_quit(); page.wait_for_timeout(300)
    c1 = ctl.state()["plays"]
    chk("P1-c ★일시정지->그만두기(결과 화면 «안 거침») = +1", c1 == 1, f"plays={c1}")

    # (d) 같은 경로인데 «즉시» 나감 - 최소 자격 미달이라 세지 «않아야» 한다
    ctl.reset(stub_ok)
    ctl.start()
    ctl.pause_quit(); page.wait_for_timeout(300)
    d1 = ctl.state()["plays"]
    chk("P1-d 일시정지->그만두기 «즉시»(2초 미만) = +0 (연타 방지)", d1 == 0, f"plays={d1}")

    # (e) 안전망 - 판이 열린 채 startRun 이 다시 불리는 경로
    ctl.reset(stub_ok)
    ctl.start(); time.sleep(2.4)
    page.evaluate("() => window.__coil.startRun()")
    page.wait_for_timeout(200)
    e1 = ctl.state()["plays"]
    chk("P1-e 안전망 - 판이 열린 채 새 판 시작 = +1", e1 == 1, f"plays={e1}")

    # (f) 「같은 판이 두 경로에 걸쳐 두 번 세어지지 않는가」
    ctl.reset(stub_ok)
    ctl.start(); time.sleep(0.25); ctl.die()
    ctl.wait_death_screen()
    ctl.click("toMenu"); page.wait_for_timeout(300)
    page.evaluate("() => window.__coil.toMenu()")
    page.wait_for_timeout(200)
    f1 = ctl.state()["plays"]
    chk("P1-f 중복 계수 0 (사망 + 메뉴이동 + toMenu 재호출 = 여전히 1)",
        f1 == 1, f"plays={f1}")

    # ══ P2. 노출 위상 - 「2판마다 · 첫 판 제외」 ═══════════════════════════
    # ★2026-09-10 개정: 정책 가드 3종(세션 60초·10분 간격·일 3회)이 신설됐다.
    #   간격 가드 때문에 «연속으로» 재면 2·4·6 판에서 뜨지 않는다 — 그건 회귀가 아니라 규칙이다.
    #   그래서 노출 «위상»(2판마다)을 볼 때는 노출 사이에 시계를 10분 앞으로 민다.
    #   가드 자체는 아래 P7 이 «따로» 잰다(위상과 가드를 한 검사에 섞으면 어느 쪽이 깨졌는지 모른다).
    print("\n[P2] 노출 위상 (요구사항 1·3) — 간격 가드는 시계를 밀어 격리")
    ctl.reset(stub_ok)
    seen = []
    for i in range(1, 7):
        # 「다시하기」가 «다음 판을 이미 시작»하므로 2회차부터는 새로 시작하지 않는다.
        if ctl.mode() != "play":
            ctl.start()
        time.sleep(0.25)
        ctl.die()
        ctl.wait_death_screen()
        before = ctl.calls()["show"]
        ctl.click("again")           # 결과 화면 이탈 = 합법 노출 지점
        page.wait_for_timeout(400)   # 스텁은 setTimeout(0) 으로 dismissed 를 준다
        after = ctl.calls()["show"]
        seen.append(after - before)
        page.evaluate("() => window.__coilAds.advanceGuard(10 * 60 * 1000 + 1000)")
    chk("P2-a 판별 광고 노출 = [0,1,0,1,0,1] (2·4·6 판에서만)",
        seen == [0, 1, 0, 1, 0, 1], f"실측 {seen}")
    chk("P2-b ★첫 판에는 «절대» 안 뜬다", seen[0] == 0, f"1판째 노출 {seen[0]}회")

    # ══ P7. ★정책 가드 3종 (2026-09-10 신설) ═════════════════════════════
    #   Codex 적대적 리뷰가 실측한 위반: 3.5초짜리 8판에서 7·14·21·28초에 «4회» 표시.
    #   여기서 재는 것은 「그 4회가 이제 몇 회가 되는가」와 「가드에 걸리면 요청조차 안 나가는가」다.
    print("\n[P7] 정책 가드 - 세션 60초 · 10분 간격 · 일 3회 (요청 전 차단)")
    gc = ctl.state()["guardConst"]
    chk("P7-const 상수를 코드에서 읽었다(60s · 600s · 3회)",
        gc["sessionMs"] == 60000 and gc["gapMs"] == 600000 and gc["dailyCap"] == 3, gc)

    # (a) 세션 시작 60초 안 = 0회 · 요청도 0
    ctl.reset(stub_ok)
    page.evaluate("() => window.__coilAds.advanceGuard(-60 * 1000)")   # 세션을 «막 시작한» 상태로 되돌린다
    loads0 = ctl.calls()["load"]
    shows0 = ctl.calls()["show"]
    for _ in range(3):
        if ctl.mode() != "play":
            ctl.start()
        time.sleep(0.25)
        ctl.die()
        ctl.wait_death_screen()
        ctl.click("again")
        page.wait_for_timeout(350)
    st = ctl.state()
    chk("P7-a ★세션 60초 안: 노출 0 · «요청도» 0(가드 통과 전에는 안 부른다) · 빚은 남는다",
        ctl.calls()["show"] - shows0 == 0 and ctl.calls()["load"] - loads0 == 0 and st["adPending"] is True,
        f"show+{ctl.calls()['show'] - shows0} load+{ctl.calls()['load'] - loads0} pending={st['adPending']} why={st['guard']['why']}")
    # 60초가 지나면 «미뤄둔 빚»이 그대로 소비된다(노출을 잃지 않는다)
    page.evaluate("() => window.__coilAds.advanceGuard(61 * 1000)")
    before = ctl.calls()["show"]
    if ctl.mode() != "play":
        ctl.start()
    time.sleep(0.25); ctl.die(); ctl.wait_death_screen(); ctl.click("again")
    page.wait_for_timeout(600)
    chk("P7-b 60초가 지나면 미뤄둔 빚이 «그대로» 소비된다(노출 1)",
        ctl.calls()["show"] - before == 1, f"show +{ctl.calls()['show'] - before}")

    # (b) 10분 간격
    before = ctl.calls()["show"]
    for _ in range(4):
        if ctl.mode() != "play":
            ctl.start()
        time.sleep(0.25); ctl.die(); ctl.wait_death_screen(); ctl.click("again")
        page.wait_for_timeout(350)
    st = ctl.state()
    chk("P7-c ★10분 간격: 방금 띄운 뒤 4판을 더 해도 노출 0 · 요청 0",
        ctl.calls()["show"] - before == 0, f"show +{ctl.calls()['show'] - before} why={st['guard']['why']}")
    page.evaluate("() => window.__coilAds.advanceGuard(10 * 60 * 1000 + 1000)")
    before = ctl.calls()["show"]
    if ctl.mode() != "play":
        ctl.start()
    time.sleep(0.25); ctl.die(); ctl.wait_death_screen(); ctl.click("again")
    page.wait_for_timeout(600)
    chk("P7-d 10분이 지나면 다시 뜬다", ctl.calls()["show"] - before == 1, f"show +{ctl.calls()['show'] - before}")

    # (c) 일 3회 상한 — 시계를 계속 밀어 간격 가드를 풀면서 4번째를 시도한다
    n_shown = ctl.state()["shownToday"]
    got = 0
    for _ in range(4):
        page.evaluate("() => window.__coilAds.advanceGuard(10 * 60 * 1000 + 1000)")
        before = ctl.calls()["show"]
        if ctl.mode() != "play":
            ctl.start()
        time.sleep(0.25); ctl.die(); ctl.wait_death_screen(); ctl.click("again")
        page.wait_for_timeout(600)
        got += ctl.calls()["show"] - before
    st = ctl.state()
    chk("P7-e ★일 3회 상한: 간격을 다 풀어도 그날 노출은 3 에서 멈춘다",
        st["shownToday"] == 3 and n_shown + got <= 3,
        f"shownToday={st['shownToday']} 이번 구간 +{got} why={st['guard']['why']}")
    chk("P7-f 상한에 걸린 뒤에는 요청도 0(가드가 요청 앞에 선다)",
        st["guard"]["ok"] is False and st["guard"]["why"] == "daily_cap" and st["loading"] is False, st["guard"])
    chk("P7-g 상한에 걸려도 빚은 «사라지지 않는다»(다음 날 소비)", st["adPending"] is True, st["adPending"])

    # ══ P6. 합법 노출 지점 «4곳 전부»에서 실제로 뜨는가 ═══════════════════
    # P2 는 「결과 화면 -> 다시하기」 하나만 봤다. 나머지 셋도 봐야
    # 「어떤 경로로 2판을 채우든 광고가 뜬다」가 성립한다.
    print("\n[P6] 합법 노출 지점 4곳")

    def two_runs_then(action_desc, finisher):
        """2판을 채운 뒤 finisher() 를 실행하고, 그 자리에서 광고가 떴는지 본다."""
        ctl.reset(stub_ok)
        for _ in range(2):
            if ctl.mode() != "play":
                ctl.start()
            time.sleep(0.25)
            ctl.die()
            ctl.wait_death_screen()
        st = ctl.state()
        before = ctl.calls()["show"]
        finisher()
        page.wait_for_timeout(500)
        after = ctl.calls()["show"]
        chk(f"P6 {action_desc} 에서 광고가 뜬다", after - before == 1,
            f"show +{after - before} (빚={st['adPending']} ready={st['adReady']})")

    two_runs_then("결과 화면 「다시하기」", lambda: ctl.click("again"))
    two_runs_then("결과 화면 「메뉴」", lambda: ctl.click("toMenu"))

    # ★ 2판째를 «결과 화면을 안 거치고» 끝내는 경우 - 요구사항 1 의 핵심 함정.
    #   스폰 무적 3.0초 안에 일시정지하므로 자연사가 끼어들 수 없다.
    # ★2026-09-10 개정(요청 = 노출): 빚은 «그만두기 순간»에 생기고 로드도 그때 «시작»된다. gate 는 로드를
    #   기다리지 않으므로(대기 화면 없음 원칙) 그 자리에서는 안 뜨고 빚이 «남는다». 로드가 끝난 뒤의
    #   다음 합법 지점(메뉴 「시작」)에서 뜬다 — 노출은 «미뤄질» 뿐 사라지지 않는다.
    ctl.reset(stub_ok)
    ctl.start(); time.sleep(0.25); ctl.die(); ctl.wait_death_screen()   # 1판(사망)
    ctl.click("again"); page.wait_for_timeout(300)                      # 2판 시작
    time.sleep(2.4)                                                     # 최소 자격 확보
    before = ctl.calls()["show"]
    loads_before = ctl.calls()["load"]
    ctl.pause_quit()
    page.wait_for_timeout(500)
    st = ctl.state()
    chk("P6 ★일시정지「그만두기」로 2판째를 끝내면 그 순간 빚이 서고 로드가 «시작»된다(요청 1)",
        st["plays"] == 2 and st["adPending"] is True and ctl.calls()["load"] - loads_before == 1
        and ctl.calls()["show"] - before == 0,
        f"plays={st['plays']} adPending={st['adPending']} load +{ctl.calls()['load'] - loads_before} show +{ctl.calls()['show'] - before}")
    ctl.click("play")                                                   # 메뉴 「시작」 = 다음 합법 지점
    page.wait_for_timeout(500)
    chk("P6 ★그 빚은 다음 합법 지점(메뉴 「시작」)에서 «소비»된다(노출은 미뤄질 뿐 사라지지 않는다)",
        ctl.calls()["show"] - before == 1 and ctl.state()["adPending"] is False,
        f"show +{ctl.calls()['show'] - before} adPending={ctl.state()['adPending']}")

    # 「메뉴 시작」 - 결과 화면에서 «광고 없이» 메뉴로 빠져나간 뒤 시작할 때 빚이 남아 있는가
    ctl.reset({"load": "silent", "show": "dismissed"})   # 일부러 준비 안 된 상태로 만든다
    for _ in range(2):
        if ctl.mode() != "play":
            ctl.start()
        time.sleep(0.25)
        ctl.die()
        ctl.wait_death_screen()
    ctl.click("toMenu")                     # 준비가 안 돼 «못 띄운다» - 빚은 남아야 한다
    page.wait_for_timeout(300)
    kept = ctl.state()["adPending"]
    chk("P6 못 띄웠을 때 빚(adPending)이 «소비되지 않고 남는다»", kept is True, f"adPending={kept}")
    # 이제 로드가 «되게» 바꾼다. 다만 즉시 뜨지는 않는다 - 앞선 무응답 시도가
    # PRELOAD_TIMEOUT(5s) 뒤 실패로 확정되고 백오프(첫 회 30s — 2026-09-10 Partner 지시 30/60/120)가 걸리기 때문이다.
    # ★ 재시도 트리거는 «타이머가 아니라 유저 행동»이므로, 판을 계속 돌리면서 본다.
    #   여기서 재는 것은 「빚이 언젠가 소비되는가」와 «그때까지 걸린 시간»이다(상한 5s + 30s + 여유).
    page.evaluate("(b) => window.__coilAds.installStub(b)", stub_ok)
    t0 = time.time()
    consumed = False
    while time.time() - t0 < 60:
        if ctl.mode() != "play":
            ctl.start()
        time.sleep(0.3)
        ctl.die()
        ctl.wait_death_screen()
        before = ctl.calls()["show"]
        ctl.click("again")
        page.wait_for_timeout(400)
        if ctl.calls()["show"] - before >= 1:
            consumed = True
            break
    chk("P6 로드 실패 뒤에도 «유저 행동»으로 재시도되어 결국 광고가 뜬다",
        consumed, f"복구까지 {int((time.time() - t0) * 1000)}ms (타임아웃 5s + 백오프 30s 포함)")

    # ══ P3. 광고 실패가 게임을 막지 않는가 ════════════════════════════════
    print("\n[P3] 실패 내성 (요구사항 2) - 각 실패 유형에서 «판이 시작되는가»")

    def build_debt(stub):
        """2판을 «실제로» 치러 빚(adPending)을 세우고 결과 화면에 선다."""
        ctl.reset(stub)
        for _ in range(2):
            if ctl.mode() != "play":
                ctl.start()
            time.sleep(0.25)
            ctl.die()
            ctl.wait_death_screen()

    def fail_case(name, stub, budget_ms, expect_show):
        build_debt(stub)
        st = ctl.state()
        t0 = time.time()
        ctl.click("again")
        try:
            page.wait_for_function("() => window.__coil.state().mode === 'play'",
                                   timeout=budget_ms)
            ok = True
        except Exception:
            ok = False
        dt = int((time.time() - t0) * 1000)
        shown = ctl.calls()["show"]
        chk(f"P3 {name}: 판이 시작된다", ok,
            f"{dt}ms (빚={st['adPending']} ready={st['adReady']} show호출={shown})")
        if expect_show is not None:
            chk(f"P3 {name}: show 호출 {expect_show}", (shown > 0) == expect_show,
                f"show={shown}")
        return dt

    t_ok = fail_case("정상(dismissed)", stub_ok, 5000, True)
    fail_case("SDK 없음(스텁 미설치)", None, 5000, None)
    fail_case("isSupported=false", {"load": "ok", "show": "dismissed", "supported": False}, 5000, False)
    fail_case("load onError", {"load": "error", "show": "dismissed"}, 5000, False)
    fail_case("load 무응답(타임아웃)", {"load": "silent", "show": "dismissed"}, 5000, False)
    fail_case("show onError", {"load": "ok", "show": "error"}, 5000, True)
    fail_case("show 동기 throw", {"load": "ok", "show": "throw"}, 5000, True)
    fail_case("show failedToShow", {"load": "ok", "show": "failedToShow"}, 5000, True)
    # ★병리 - 네이티브가 열지도 에러도 안 줌. OPEN 타임아웃(7초) 뒤 «반드시» 풀려야 한다.
    t_sil = fail_case("show 무응답(병리·OPEN 타임아웃)", {"load": "ok", "show": "silent"}, 12000, True)
    chk("P3 정상 경로는 지연이 «사실상 0» 이다", t_ok < 1500, f"{t_ok}ms")
    chk("P3 병리 경로도 «영구 정지»가 아니다(7초 상한 뒤 해제)",
        7000 <= t_sil < 11000, f"{t_sil}ms")

    # ★ 병리 상황에서 유저가 «다시 눌러» 즉시 탈출할 수 있는가 + 뒤늦은 콜백이
    #   진행 중인 판을 리셋하지 «않는가» (gateSeq)
    #
    # ★ 「메뉴」 버튼(next=toMenu)으로 잰다. 「다시하기」(next=startRun)로 재면
    #   8초를 기다리는 동안 플레이어가 «자연사»할 수 있어 mode 만으로는
    #   「지각 콜백이 리셋했다」와 「그냥 죽었다」를 구분할 수 없다.
    #   next=toMenu 면 지각 콜백의 흔적이 mode==='menu' 로 «유일하게» 나타난다.
    print("\n[P3x] 병리 - 재탭 즉시 탈출 & 지각 콜백 무해 (gateSeq)")
    build_debt({"load": "ok", "show": "silent"})
    ctl.click("toMenu")          # 1차 - 광고가 «열리지도 닫히지도» 않는다
    page.wait_for_timeout(500)
    m_mid = ctl.mode()
    t0 = time.time()
    ctl.click("toMenu")          # 2차 - 유저가 다시 누른다
    page.wait_for_function("() => window.__coil.state().mode === 'menu'", timeout=3000)
    dt2 = int((time.time() - t0) * 1000)
    chk("P3x 재탭으로 «즉시» 탈출된다 (버튼이 죽지 않는다)",
        dt2 < 1000 and m_mid == "dead", f"1차후mode={m_mid} 재탭후 {dt2}ms")
    # 새 판을 시작해 두고 7초를 넘겨 «지각 콜백»을 기다린다.
    ctl.start()
    page.wait_for_function("() => window.__coil.state().mode === 'play'", timeout=3000)
    page.wait_for_timeout(8000)
    m_late = ctl.mode()
    menu_open = page.evaluate("() => window.__ui.vis(0)")
    chk("P3x 7초 뒤 지각 콜백이 «판을 강제로 끝내지 않는다»(mode != menu)",
        m_late != "menu" and not menu_open, f"mode={m_late} menu={menu_open}")

    # ══ P5. MIN_PLAY_MS 밴드 «하한»을 실측한다 ════════════════════════════
    # 상한은 코드에서 유도된다: SPAWN_GHOST_PLAYER(3.0s) = 사망으로 끝나는 판의 물리적 최소.
    # 하한 = 「시작 -> 일시정지 -> 그만두기」 한 바퀴를 최대한 빨리 돈 시간.
    #
    # ★★ 두 가지를 «갈라서» 잰다. 섞으면 이 상수를 「어뷰징 방어」로 오해하게 된다.
    #   ① 사람 한계  - 실제 «입력 이벤트» 3회(Playwright tap, 브라우저 왕복 포함).
    #                  MIN_PLAY_MS 는 이것보다 «커야» 의미가 있다.
    #   ② 스크립트 한계 - 한 태스크 안에서 element.click() 3회. 이건 사실상 0 이다.
    #                  ⇒ 어떤 시간 임계값도 «자동화를 막지 못한다». 사람 연타만 막는다.
    print("\n[P5] MIN_PLAY_MS 밴드 실측")
    human = []
    for _ in range(3):
        ctl.reset(stub_ok)
        t0 = time.perf_counter()
        page.tap(".p-play")
        page.tap(".hud-pause")
        page.locator(".overlay").nth(1).locator(".btn-ghost").tap()
        human.append(round((time.perf_counter() - t0) * 1000, 1))
    script = []
    for _ in range(3):
        ctl.reset(stub_ok)
        t = page.evaluate(
            """() => { const t0 = performance.now();
                 window.__ui.play().click();
                 window.__ui.pauseBtn().click();
                 window.__ui.quit().click();
                 return performance.now() - t0; }"""
        )
        script.append(round(t, 1))
    lo = min(human)
    mn = ctl.state()["minPlayMs"]
    print(f"    ① 사람 한계(실입력 왕복)  {human}  최소 {lo:.0f} ms")
    print(f"    ② 스크립트 한계(한 태스크) {script}  <- 이 값이 「시간으로는 자동화를 못 막는다」의 증거")
    print(f"    밴드 = ({lo:.0f}, 3000)   3000 = SPAWN_GHOST_PLAYER, 사망 판의 물리적 최소")
    print(f"    현재 MIN_PLAY_MS = {mn}")
    chk("P5 MIN_PLAY_MS 가 밴드 «안»에 있다 (사람 한계 초과 · 사망 최소 미만)",
        lo < mn < 3000, f"{lo:.0f} < {mn} < 3000")

    # ══ P4. 저장 호환 ═════════════════════════════════════════════════════
    print("\n[P4] 저장 호환 (요구사항 4)")
    keys = page.evaluate("() => Object.keys(localStorage)")
    save_raw = page.evaluate("() => localStorage.getItem('king-snake.save')")
    ads_raw = page.evaluate("() => localStorage.getItem('king-snake.ads.v1')")
    chk("P4-a 광고 카운터가 «별도 키»에 있다", ads_raw is not None, f"{ads_raw}")
    chk("P4-b 게임 저장키 이름이 그대로다('king-snake.save')",
        "king-snake.save" in keys, str(keys))
    v = json.loads(save_raw)["v"] if save_raw else None
    chk("P4-c SAVE_VERSION 이 여전히 1 이다", v == 1, f"v={v}")
    chk("P4-d 광고 키가 게임 저장키와 «다르다»",
        "king-snake.ads.v1" in keys and "king-snake.ads.v1" != "king-snake.save", str(keys))

    return results


def main() -> int:
    if not (DIST / "index.html").exists():
        print("dist 가 없다. 먼저: npm run build:web")
        return 2
    OUT.mkdir(parents=True, exist_ok=True)

    port, httpd = serve()
    base = f"http://127.0.0.1:{port}"
    results: list[dict] = []
    fails: list[str] = []
    errors: list[str] = []

    with sync_playwright() as pw:
        # ★ headless 고정. President 가 같은 컴퓨터에서 업무 중이다 - 창을 띄우지 않는다.
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": 390, "height": 844},
                                  is_mobile=True, has_touch=True, locale="ko-KR")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
        page.goto(f"{base}/?debug=1", wait_until="load")
        page.wait_for_function("() => window.__coilAds && window.__coil", timeout=8000)
        page.evaluate(UI_JS)
        try:
            run(page, results, fails)
        finally:
            ctx.close()
            browser.close()
    httpd.shutdown()

    print("\n[콘솔 에러]", len(errors))
    for e in errors[:10]:
        print("   ", e)
    if errors:
        fails.append("console errors")

    (OUT / "result.json").write_text(
        json.dumps({"results": results, "errors": errors, "fails": fails},
                   ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n" + "=" * 62)
    print(f"통과 {sum(1 for r in results if r['ok'])} / {len(results)}")
    if fails:
        print("실패:", ", ".join(fails))
        return 1
    print("전량 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())
