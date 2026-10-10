# -*- coding: utf-8 -*-
"""shots_growth.py - 「기록 돌파 리워드」 실렌더 스크린샷. headless 고정, 창 0.

  python tools/shots_growth.py <distDir> <outTag>

★ 「적용했다」가 아니라 «실렌더»가 산출물이다(CLAUDE.md UI 규율).
★ 운영 광고 ID 를 로컬에서 «렌더»하지 않는다 - 브릿지 스텁만 꽂아 UI 를 띄운다.
★ 찍는 것 (로케일마다):
    1a offer_500       문턱 500 돌파 배너 — ★게임이 «흐르는 중»이다
    1b offer_2000      문턱 2,000 돌파 배너
    2  offer_best      개인 최고 기록 돌파 배너
    3  offer_busy      탭한 뒤 「불러오는 중」(이때부터 월드가 멈춘다)
    4  countdown       광고 뒤 복귀 카운트다운 (아레나가 보인다)
    5  grown           성장 직후 HUD (커진 점수 + 토스트)

★★ 이 컷들이 답해야 하는 질문(2026-09-01 President): 「배너가 뱀·HUD·순위표를
   가리는가」. 그래서 판정은 코드가 아니라 «이 그림»으로 한다 —
   점수(좌상)·일시정지(상단중앙)·순위표(우상)·내 뱀(화면중앙)이 다 보여야 한다.
"""
from __future__ import annotations

import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
VIEW = {"width": 390, "height": 844}
DPR = 2

SAVE_BASE = {
    "v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
    "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
    "control": "joystick", "sound": True, "locale": None,
}
STUB_OK = {"load": "ok", "show": "reward", "supported": True}


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


def shot(page, out: Path, name: str):
    out.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(out / (name + ".png")))
    print("  " + name + ".png")


def open_offer(page, mass: int):
    """판을 시작하고 질량을 세워 배너를 «실제로» 띄운다.

    ⚠️배너는 5초 뒤 스스로 사라진다. 그래서 여기서 오래 기다리면 «빈 화면»을 찍는다.
      슬라이드인(offerIn 200ms)이 끝날 만큼만 기다린다.
    """
    page.evaluate("() => window.__coil.startRun()")
    page.wait_for_timeout(900)
    page.evaluate("(m) => window.__coil.grow(m)", mass)
    page.wait_for_function("() => window.__coilReward.state().offer !== null", timeout=6000)
    page.wait_for_timeout(300)


def main() -> int:
    dist = Path(sys.argv[1]).resolve()
    tag = sys.argv[2]
    out = ROOT / "_growth_evidence_260831" / "shots" / tag
    port, srv = serve(dist)
    errs: list[str] = []

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)  # ★headless 고정 - 창을 띄우지 않는다
        for locale, lang in (("ko-KR", None), ("en-US", "en"), ("de-DE", "de")):
            save = dict(SAVE_BASE)
            save["locale"] = lang
            ctx = b.new_context(viewport=VIEW, device_scale_factor=DPR, is_mobile=True,
                                has_touch=True, locale=locale)
            ctx.add_init_script(
                "localStorage.setItem('king-snake.save', %s)"
                % json.dumps(json.dumps(save, ensure_ascii=False)))
            page = ctx.new_page()
            page.on("pageerror", lambda e: errs.append(str(e)))
            page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
            page.goto(f"http://127.0.0.1:{port}/?debug=1&quiet=1&seed=7", wait_until="load")
            page.wait_for_timeout(900)
            page.evaluate("(b) => window.__coilAds.installStub(b)", STUB_OK)
            page.evaluate("() => window.__coilReward.refresh()")
            sfx = "" if lang is None else "_" + lang

            # ①-a 문턱 500 돌파 — «가장 자주 보게 될» 컷이다(도달률 18.3%).
            page.evaluate("() => window.__coilReward.setBest(1200)")
            open_offer(page, 520)
            shot(page, out, "1a_offer_500" + sfx)
            page.evaluate("() => window.__coilReward.reset()")
            page.evaluate("() => window.__coil.toMenu()")
            page.evaluate("(b) => window.__coilAds.installStub(b)", STUB_OK)
            page.evaluate("() => window.__coilReward.refresh()")

            # ①-b 문턱 2,000 돌파 — 점수가 500·2000 을 한 번에 지나도
            #     «가장 높은» 문턱 이름으로 뜬다(growthTriggers.evaluate).
            page.evaluate("() => window.__coilReward.setBest(1200)")
            open_offer(page, 2100)
            shot(page, out, "1b_offer_2000" + sfx)

            # ② 탭 -> 광고 -> 카운트다운 -> 커진 HUD
            #   ★탭하는 «그 순간»부터 월드가 멈춘다(그 전까지는 흐르고 있었다).
            page.evaluate("() => window.__coilReward.growAd()")
            page.wait_for_timeout(500)
            shot(page, out, "4_countdown" + sfx)
            page.evaluate("() => window.__coilReward.finishCountdown()")
            page.wait_for_function("() => window.__coilReward.state().mode === 'play'", timeout=6000)
            page.wait_for_timeout(300)
            shot(page, out, "5_grown" + sfx)

            # ③ 개인 최고 기록 돌파 제안
            page.evaluate("() => window.__coilReward.reset()")
            page.evaluate("() => window.__coil.toMenu()")
            page.evaluate("(b) => window.__coilAds.installStub(b)", STUB_OK)
            page.evaluate("() => window.__coilReward.refresh()")
            # ★최고기록 컷은 «문턱과 겹치지 않는» 점수여야 한다.
            #   consume() 은 그 순간 걸린 트리거를 «전부» 닫으므로, 최고기록이 1,200 이면
            #   그걸 넘는 어떤 점수도 문턱 500 을 이미 지나 있어 «문턱»으로 뜬다.
            #   ⇒ 기록을 첫 문턱(500) 아래로 두고 그 사이 점수로 깬다.
            page.evaluate("() => window.__coilReward.setBest(400)")
            open_offer(page, 460)
            shot(page, out, "2_offer_best" + sfx)

            # ④ 「불러오는 중」 — 스텁이 아무 이벤트도 안 내는 동안
            if lang is None:
                page.evaluate("(b) => window.__coilAds.installStub(b)",
                              {"load": "ok", "show": "silent", "supported": True})
                page.evaluate("() => { window.__coilReward.growAd(); }")  # await 하지 않는다
                page.wait_for_timeout(700)
                shot(page, out, "3_offer_busy")
            ctx.close()
        b.close()
    srv.shutdown()
    print("console/page errors:", len(errs), errs[:4])
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
