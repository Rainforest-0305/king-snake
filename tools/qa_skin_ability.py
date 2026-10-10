# -*- coding: utf-8 -*-
"""qa_skin_ability.py - 「최고급 스킨 능력을 터치해서 본다」 검사. headless, 창 0.

  python tools/qa_skin_ability.py <distDir>              # 정상(스위치 ON)
  python tools/qa_skin_ability.py <distDir> --expect-off # ★양성대조(스위치 OFF 빌드)

★ 이 검사기가 지키는 것 다섯:
   S1 «충돌 없음»  - 고를 수 있는 카드의 탭은 여전히 «선택»이다(뺏은 탭 0).
   S2 «둘 다 열림» - 미보유(카드 탭) · 보유(히어로 줄 탭) 두 경로가 모두 연다.
   S3 «없으면 없다» - 능력 없는 스킨에는 표식도 경로도 «생기지 않는다».
   S4 «문구 = 구현» - 화면의 배수·초를 «코드가 준 값»(abilityFacts)에서 유도해 대조한다.
                     ⛔1.28·2.6 을 여기 박지 않는다 - 박으면 상수를 바꿔도 통과하는
                       죽은 검사기가 된다(auto-memory 「테스트가 틀린 값을 고정한다」).
   S5 «끄면 사라진다» - SKIN_ABILITIES_ENABLED=false 빌드에서 표식·줄·패널이 전멸한다.

★ 「0건」은 부재의 증거가 아니다 ⇒ 모든 «없음» 검사 앞에 «있음»을 먼저 확인한다.
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
SAVE = {
    "v": 1, "savedAt": 0, "bestScore": 20847, "bestRank": 1, "games": 5,
    "totalKills": 18, "playSeconds": 900, "nick": "리미", "skin": "corn",
    "control": "joystick", "sound": True, "locale": "ko",
}

ok = 0
bad = 0


def chk(name, cond, extra=""):
    global ok, bad
    if cond:
        ok += 1
        print("  PASS  " + name + (("   " + str(extra)) if extra else ""))
    else:
        bad += 1
        print("  FAIL  " + name + "   " + str(extra))


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


CARD = """([sid, sids]) => {
  const i = sids.indexOf(sid);
  const cell = document.querySelectorAll('.skin-rail .skin-cell')[i];
  const b = cell.querySelector('.skin');
  const dot = cell.querySelector('.skin-info');
  const r = b.getBoundingClientRect();
  return {
    disabled: b.disabled, isInfo: b.classList.contains('is-info'),
    dot: !!dot && !dot.hidden,
    dotHit: dot ? getComputedStyle(dot).pointerEvents : null,
    aria: b.getAttribute('aria-label'),
    pressed: b.getAttribute('aria-pressed'),
    expanded: b.getAttribute('aria-expanded'),
    controls: b.getAttribute('aria-controls'),
    w: +r.width.toFixed(1), h: +r.height.toFixed(1),
  };
}"""

TAP = """([sid, sids]) => {
  const i = sids.indexOf(sid);
  const b = document.querySelectorAll('.skin-rail .skin-cell')[i].querySelector('.skin');
  if (b.disabled) return 'disabled';
  b.click();
  return 'clicked';
}"""

PANEL = """() => {
  const d = document.getElementById('skin-ability-detail');
  if (!d) return { exists: false };
  const x = d.querySelector('.skin-detail-x');
  const xr = x ? x.getBoundingClientRect() : null;
  return {
    exists: true, open: !d.hidden,
    name: (d.querySelector('.skin-detail-name') || {}).textContent || '',
    ab: (d.querySelector('.skin-detail-ab') || {}).textContent || '',
    lead: (d.querySelector('.skin-detail-lead') || {}).textContent || '',
    fair: (d.querySelector('.skin-detail-fair') || {}).textContent || '',
    rows: Array.from(d.querySelectorAll('.skin-detail-row')).map((r) => ({
      k: r.querySelector('.skin-detail-k').textContent,
      v: r.querySelector('.skin-detail-v').textContent })),
    xw: xr ? +xr.width.toFixed(1) : 0, xh: xr ? +xr.height.toFixed(1) : 0,
    xaria: x ? x.getAttribute('aria-label') : null,
  };
}"""

HERO = """() => {
  const b = document.querySelector('.skin-ability');
  if (!b) return { exists: false };
  const r = b.getBoundingClientRect();
  return { exists: true, tag: b.tagName, hidden: b.hidden, text: b.textContent,
           expanded: b.getAttribute('aria-expanded'), controls: b.getAttribute('aria-controls'),
           aria: b.getAttribute('aria-label'),
           w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
}"""


def main() -> int:
    dist = Path(sys.argv[1]).resolve()
    expect_off = "--expect-off" in sys.argv
    port, srv = serve(dist)
    errs: list[str] = []
    print("[qa_skin_ability] dist=%s mode=%s" % (dist, "OFF(양성대조)" if expect_off else "ON"))
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(headless=True)   # ★headless 고정 - 창 0
            ctx = br.new_context(viewport=VIEW, device_scale_factor=2, locale="ko-KR",
                                 is_mobile=True, has_touch=True)

            def guard(route):
                u = route.request.url
                if u.startswith("http://127.0.0.1:%d" % port) or u.startswith("data:"):
                    return route.continue_()
                errs.append("EXTERNAL " + u)
                return route.abort()

            ctx.route("**/*", guard)

            def page_for(over=None, adwatch=None):
                sv = dict(SAVE)
                if over:
                    sv.update(over)
                js = "localStorage.setItem('king-snake.save', %s);" % json.dumps(json.dumps(sv))
                if adwatch is not None:
                    js += "localStorage.setItem('king-snake.adwatch.v1', %s);" % json.dumps(
                        json.dumps({"v": 1, "total": adwatch,
                                    "bySurface": {"skinProgress": adwatch}}))
                pg = ctx.new_page()
                pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
                pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
                pg.add_init_script(js)
                pg.goto("http://127.0.0.1:%d/index.html?debug=1&quiet=1" % port,
                        wait_until="load")
                pg.wait_for_timeout(1300)
                return pg

            # ══ S0 대조 - 코드가 무엇을 말하는가 ══════════════════════════
            print("\n[S0] 코드가 준 «사실» (검사 기대값은 전부 여기서 유도한다)")
            pg = page_for()
            st = pg.evaluate("() => window.__coilSkins.state()")
            skins = st["skins"]
            sids = [s["id"] for s in skins]
            withAb = [s for s in skins if s["ability"]]
            noAb = [s for s in skins if not s["ability"]]
            chk("S0-a 스킨 목록을 읽었다", len(skins) >= 12, "n=%d" % len(skins))
            if expect_off:
                chk("S0-off ★스위치 OFF - 능력을 가진 스킨이 «0개»", len(withAb) == 0,
                    [s["id"] for s in withAb])
                chk("S0-off2 facts 도 전부 null",
                    all(s["abilityFacts"] is None for s in skins))
            else:
                chk("S0-b ★능력을 가진 스킨이 «있다»(이게 0 이면 아래는 전부 무의미)",
                    len(withAb) >= 1, [s["id"] for s in withAb])
                chk("S0-c 능력 «없는» 스킨도 있다(S3 의 대조군)", len(noAb) >= 5, len(noAb))
                chk("S0-d 능력 있는 스킨엔 facts 가 «반드시» 딸린다",
                    all(s["abilityFacts"] for s in withAb))

            # ══ S3 능력 «없는» 스킨: 표식도 경로도 없다 ═══════════════════
            print("\n[S3] 능력 «없는» 스킨 - 경로가 «생기지 않는다»")
            pg.evaluate("() => { const r = document.querySelector('.skin-rail');"
                        " r.scrollLeft = r.scrollWidth; }")
            pg.wait_for_timeout(300)
            for s in noAb:
                c = pg.evaluate(CARD, [s["id"], sids])
                chk("S3-%s 표식 «없음»" % s["id"], c["dot"] is False, c["dot"])
                chk("S3-%s-cls is-info «없음»" % s["id"], c["isInfo"] is False)
                chk("S3-%s-aria aria-controls «없음»" % s["id"], c["controls"] is None,
                    c["controls"])
            # 탭해도 패널이 안 열린다(잠긴 것 하나로 확인).
            # ★2026-09-03 정정: 「잠김」을 unlockScore > 20847 로 «유도»하고 있었는데,
            #   문턱 상향 + 해금 원장(소급 적립) 때문에 그 식이 더는 잠김을 뜻하지 않는다
            #   (최고점 20,847 유저는 블랙맘바 30,000 을 «보유»한다 - 회수 금지).
            #   ⇒ 화면과 같은 판정인 owned 를 그대로 쓴다. 조건식을 두 벌 쓰지 않는다.
            locked_noab = [s for s in noAb if not s.get("owned")]
            if locked_noab:
                sid = locked_noab[0]["id"]
                r = pg.evaluate(TAP, [sid, sids])
                pg.wait_for_timeout(300)
                p = pg.evaluate(PANEL)
                chk("S3-tap 잠긴 무능력 카드는 여전히 disabled", r == "disabled", r)
                chk("S3-tap2 ★패널이 «안 열린다»", (not p["exists"]) or (not p["open"]), p.get("open"))
            # 히어로(옥수수뱀 = 무능력)의 능력 줄이 «숨어 있다»
            h = pg.evaluate(HERO)
            chk("S3-hero 무능력 스킨 장착 시 히어로 능력 줄이 «숨는다»",
                (not h["exists"]) or h["hidden"] is True, h)

            if expect_off:
                # OFF 빌드에서는 최고급 2종도 무능력이므로 위 루프가 이미 덮었다.
                chk("S3-off ★패널 노드가 있어도 «열려 있지 않다»",
                    (not pg.evaluate(PANEL)["exists"]) or (not pg.evaluate(PANEL)["open"]))
                chk("S3-off2 화면 어디에도 .skin-info 표식이 «보이지 않는다»",
                    pg.evaluate("() => Array.from(document.querySelectorAll('.skin-info'))"
                                ".filter(n => !n.hidden).length") == 0)
                chk("S3-off3 히어로 능력 줄이 «보이지 않는다»",
                    pg.evaluate("() => { const b = document.querySelector('.skin-ability');"
                                " return !b || b.hidden; }"))
                pg.close()
                ctx.close()
                br.close()
                srv.shutdown()
                srv.server_close()
                print("\n외부 요청/콘솔 오류: %d %s" % (len(errs), errs[:3]))
                print("\n%d/%d PASS" % (ok, ok + bad))
                print("RESULT: " + ("PASS" if bad == 0 and not errs else "FAIL"))
                return 1 if (bad or errs) else 0

            # ★ 아래는 «능력을 가진 스킨이 있다»가 전제다. 없으면 S0-b 가 이미
            #   FAIL 이고, 그대로 진행하면 IndexError 로 «죽어서» 결과가 안 나온다.
            #   검사기는 터지는 게 아니라 «FAIL 을 보고»해야 한다.
            if not withAb:
                pg.close(); ctx.close(); br.close()
                srv.shutdown(); srv.server_close()
                print("\n중단: 능력을 가진 스킨이 0개다(S0-b FAIL). 아래 검사는 무의미하다.")
                print("\n%d/%d PASS" % (ok, ok + bad))
                print("RESULT: FAIL")
                return 1

            # ══ S2a 미보유 - 카드 탭이 «연다» ════════════════════════════
            print("\n[S2a] 미보유 카드 탭 -> 설명이 열린다")
            for s in withAb:
                sid = s["id"]
                c = pg.evaluate(CARD, [sid, sids])
                chk("S2a-%s 표식이 «보인다»" % sid, c["dot"] is True)
                chk("S2a-%s 표식은 «누르는 것이 아니다»(카드 전체가 타깃)" % sid,
                    c["dotHit"] == "none", c["dotHit"])
                chk("S2a-%s 카드가 24px 이상" % sid, c["w"] >= 24 and c["h"] >= 24,
                    "%.0fx%.0f" % (c["w"], c["h"]))
                chk("S2a-%s aria-controls 가 패널을 가리킨다" % sid,
                    c["controls"] == "skin-ability-detail", c["controls"])
                chk("S2a-%s ★aria-pressed 를 «안 쓴다»(고르는 버튼이 아니다)" % sid,
                    c["pressed"] is None, c["pressed"])
                chk("S2a-%s aria-expanded=false(닫힌 상태)" % sid, c["expanded"] == "false")
                r = pg.evaluate(TAP, [sid, sids])
                pg.wait_for_timeout(320)
                p = pg.evaluate(PANEL)
                c2 = pg.evaluate(CARD, [sid, sids])
                chk("S2a-%s ★탭이 «닿는다»(예전엔 disabled 라 안 닿았다)" % sid,
                    r == "clicked", r)
                chk("S2a-%s ★패널이 «열린다»" % sid, p["open"] is True)
                chk("S2a-%s aria-expanded=true 로 바뀐다" % sid, c2["expanded"] == "true")
                # ── S4 문구 = 구현 ──────────────────────────────────────
                f = s["abilityFacts"]
                mul = ("%.2f" % f["radiusMul"]).rstrip("0").rstrip(".")
                sec = ("%.2f" % f["seconds"]).rstrip("0").rstrip(".")
                eff = p["rows"][0]["v"]
                when = p["rows"][1]["v"]
                chk("S4-%s ★효과 문구에 «코드가 준 배수»가 있다" % sid, mul in eff,
                    "expect=%s got=%r" % (mul, eff))
                if f["window"] == "burst":
                    chk("S4-%s ★작동 문구에 «코드가 준 초»가 있다" % sid, sec in when,
                        "expect=%s got=%r" % (sec, when))
                else:
                    chk("S4-%s 상시 능력엔 초가 «안 적힌다»" % sid,
                        not any(ch.isdigit() for ch in when), when)
                chk("S4-%s 획득 칸이 비어 있지 않다" % sid, len(p["rows"][2]["v"]) > 0,
                    p["rows"][2]["v"])
                chk("S4-%s 닫기 버튼 24px 이상 + aria-label" % sid,
                    p["xw"] >= 24 and p["xh"] >= 24 and bool(p["xaria"]),
                    "%.0fx%.0f %r" % (p["xw"], p["xh"], p["xaria"]))
                chk("S4-%s 오해 차단 한 줄이 있다" % sid, len(p["fair"]) > 0, p["fair"])
                # 같은 카드를 다시 누르면 «닫힌다»
                pg.evaluate(TAP, [sid, sids])
                pg.wait_for_timeout(300)
                chk("S2a-%s 같은 카드를 다시 누르면 «닫힌다»" % sid,
                    pg.evaluate(PANEL)["open"] is False)
            pg.close()

            # ══ S1 충돌 없음 - 고를 수 있는 카드는 여전히 «선택» ═════════
            print("\n[S1] ★기존 «선택» 동작이 안 깨졌다")
            pg = page_for({"bestScore": 100000}, adwatch=100)
            sids = pg.evaluate("() => window.__coilSkins.state().skins.map(s => s.id)")
            for sid in ("milk", "mamba", withAb[0]["id"]):
                r = pg.evaluate(TAP, [sid, sids])
                pg.wait_for_timeout(280)
                c = pg.evaluate(CARD, [sid, sids])
                saved = json.loads(pg.evaluate(
                    "() => localStorage.getItem('king-snake.save')"))["skin"]
                chk("S1-%s 탭 = «선택»" % sid, r == "clicked" and c["pressed"] == "true"
                    and saved == sid, "pressed=%s saved=%s" % (c["pressed"], saved))
                chk("S1-%s 보유 카드엔 표식이 «없다»(탭이 설명을 열지 않으니까)" % sid,
                    c["dot"] is False)
                chk("S1-%s 선택으로 패널이 «안 열린다»" % sid,
                    pg.evaluate(PANEL)["open"] is False)

            # ══ S2b 보유 - 히어로 능력 줄 탭이 «연다» ════════════════════
            print("\n[S2b] 보유(장착) - 히어로 능력 줄 탭 -> 설명이 열린다")
            for s in withAb:
                sid = s["id"]
                pg.evaluate(TAP, [sid, sids])
                pg.wait_for_timeout(280)
                h = pg.evaluate(HERO)
                chk("S2b-%s 히어로 능력 줄이 «보인다»" % sid,
                    h["exists"] and not h["hidden"])
                chk("S2b-%s 그 줄이 «버튼»이다" % sid, h["tag"] == "BUTTON", h["tag"])
                chk("S2b-%s 24px 이상" % sid, h["h"] >= 24, h["h"])
                chk("S2b-%s aria-controls 가 패널을 가리킨다" % sid,
                    h["controls"] == "skin-ability-detail")
                pg.evaluate("() => document.querySelector('.skin-ability').click()")
                pg.wait_for_timeout(320)
                p = pg.evaluate(PANEL)
                chk("S2b-%s ★패널이 «열린다»" % sid, p["open"] is True)
                chk("S2b-%s 보유 상태라 획득 칸이 «보유»를 말한다" % sid,
                    not any(ch.isdigit() for ch in p["rows"][2]["v"]), p["rows"][2]["v"])
                chk("S2b-%s 열린 패널이 «그 스킨»을 말한다" % sid,
                    len(p["name"]) > 0 and len(p["ab"]) > 0, (p["name"], p["ab"]))
                # 닫기 버튼으로도 닫힌다
                pg.evaluate("() => document.querySelector('.skin-detail-x').click()")
                pg.wait_for_timeout(280)
                chk("S2b-%s 닫기 버튼이 «닫는다»" % sid,
                    pg.evaluate(PANEL)["open"] is False)
                # 열어 둔 채 «다른 스킨을 고르면» 닫힌다(히어로와 설명이 갈리지 않게)
                pg.evaluate("() => document.querySelector('.skin-ability').click()")
                pg.wait_for_timeout(260)
                chk("S2b-%s 양성대조: 다시 열렸다" % sid, pg.evaluate(PANEL)["open"] is True)
                pg.evaluate(TAP, ["corn", sids])
                pg.wait_for_timeout(280)
                chk("S2b-%s ★다른 스킨을 고르면 설명이 «닫힌다»" % sid,
                    pg.evaluate(PANEL)["open"] is False)
            pg.close()
            ctx.close()
            br.close()
    finally:
        srv.shutdown()
        srv.server_close()

    print("\n외부 요청/콘솔 오류: %d %s" % (len(errs), errs[:3]))
    print("\n%d/%d PASS" % (ok, ok + bad))
    print("RESULT: " + ("PASS" if bad == 0 and not errs else "FAIL"))
    return 1 if (bad or errs) else 0


if __name__ == "__main__":
    raise SystemExit(main())
