# -*- coding: utf-8 -*-
"""shots_reward.py - 리워드 광고 UI «실렌더» 스크린샷. headless 고정, 창 0.

  python tools/shots_reward.py <distDir> <outTag> [--before]

--before : 리워드 훅이 «없는» 빌드(dist_before)를 찍을 때. 광고 스텁·리워드 호출을 건너뛴다.

★ 「적용했다」가 아니라 «전후 실렌더»가 산출물이다(CLAUDE.md UI 규율).
★ 운영 광고 ID 를 로컬에서 «렌더»하지 않는다 - 브릿지 스텁만 꽂아 UI 를 띄운다.
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
    "v": 1, "savedAt": 0, "bestScore": 0, "bestRank": 999, "games": 4,
    "totalKills": 3, "playSeconds": 300, "nick": "", "skin": "corn",
    "control": "joystick", "sound": True, "locale": None,
}


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


def shot(page, out: Path, name: str, sel: str | None = None):
    out.mkdir(parents=True, exist_ok=True)
    p = out / (name + ".png")
    if sel:
        el = page.query_selector(sel)
        if el is None:
            print("  (skip, no element) " + name)
            return
        el.screenshot(path=str(p))
    else:
        page.screenshot(path=str(p))
    print("  " + p.name)


def main() -> int:
    dist = Path(sys.argv[1]).resolve()
    tag = sys.argv[2]
    before = "--before" in sys.argv
    out = ROOT / "_reward_evidence_260831" / "shots" / tag
    port, srv = serve(dist)
    errs: list[str] = []

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)  # ★headless 고정
        for locale, lang in (("ko-KR", None), ("en-US", "en"), ("de-DE", "de")):
            save = dict(SAVE_BASE)
            save["locale"] = lang
            ctx = b.new_context(viewport=VIEW, device_scale_factor=DPR, is_mobile=True,
                                has_touch=True, locale=locale)
            ctx.add_init_script(
                "localStorage.setItem('king-snake.save', %s)" % json.dumps(json.dumps(save, ensure_ascii=False)))
            page = ctx.new_page()
            page.on("pageerror", lambda e: errs.append(str(e)))
            page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
            page.goto(f"http://127.0.0.1:{port}/?debug=1&quiet=1&seed=7", wait_until="load")
            page.wait_for_timeout(1000)
            suffix = "" if lang is None else "_" + lang

            if not before:
                page.evaluate("(b) => window.__coilAds.installStub(b)",
                              {"load": "ok", "show": "reward", "supported": True})
                page.evaluate("() => window.__coilReward.refresh()")
                page.wait_for_timeout(200)

            # ① 메뉴 (시작 크기 부스트 제안 + 스킨 레일 광고 배지)
            shot(page, out, "menu" + suffix)
            shot(page, out, "skinrail" + suffix, ".skin-rail")

            # ② 사망 시트 (부활 제안)
            page.evaluate("() => window.__coil.startRun()")
            page.wait_for_timeout(900)
            if before:
                page.evaluate("() => window.__coil.kill()")
            else:
                page.evaluate("() => window.__coilReward.killByBorder()")
            page.wait_for_function("() => !document.querySelectorAll('.overlay')[2].classList.contains('hidden')",
                                   timeout=8000)
            page.wait_for_timeout(400)
            shot(page, out, "death" + suffix)

            if not before and lang is None:
                # ③ 「불러오는 중」 상태 - 스텁이 아무 이벤트도 안 내는 동안 찍는다.
                page.evaluate("(b) => window.__coilAds.installStub(b)",
                              {"load": "ok", "show": "silent", "supported": True})
                page.evaluate("() => { window.__coilReward.revive(); }")  # await 하지 않는다
                page.wait_for_timeout(700)
                shot(page, out, "death_busy")
                # ④ 실패 토스트 - open_timeout(8s) 뒤에 뜬다.
                page.wait_for_timeout(8200)
                shot(page, out, "death_fail_toast")
                # ⑤ 스킨 해금 «후» 메뉴 (배지가 사라지고 새 스킨이 착용된다)
                page.evaluate("(b) => window.__coilAds.installStub(b)",
                              {"load": "ok", "show": "reward", "supported": True})
                page.evaluate("() => window.__coil.toMenu()")
                page.evaluate("() => window.__coilReward.unlockSkin('milk')")
                page.wait_for_timeout(300)
                shot(page, out, "menu_skin_unlocked")
            ctx.close()
        b.close()
    srv.shutdown()
    print("console/page errors:", len(errs), errs[:4])
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
