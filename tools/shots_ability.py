# -*- coding: utf-8 -*-
"""shots_ability.py - 「터치해서 능력 보기」 전/후 실렌더. headless 고정, 창 0.

  python tools/shots_ability.py <distDir> <outTag> [--locale ko]

★ President 화면을 점유하지 않는다: headless=True 고정, 창을 띄우는 경로 없음.
★ 외부 네트워크는 route 로 전면 차단하고 막힌 요청 목록을 증거로 남긴다.
★ 찍는 것 (390x844 세로, DPR 3):
    A 미보유  레일 끝(최고급 2종) — 표식 유무
    B 미보유  코뿔소북살무사 카드 «탭» -> 설명 열림
    C 미보유  파란말레이산호뱀 카드 «탭» -> 설명 열림
    D 보유    코뿔소북살무사 장착 — 히어로 능력 줄
    E 보유    히어로 능력 줄 «탭» -> 설명 열림
    F 능력 없는 스킨(알비노) 탭 -> «아무 일도 없다»
  before 빌드에는 설명 패널이 없으므로 B/C/E 는 「탭했지만 안 열린다」가 증거다.
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
OUTDIR = ROOT / "_ability_evidence_260902"

SAVE = {
    "v": 1, "savedAt": 0, "bestScore": 20847, "bestRank": 1, "games": 5,
    "totalKills": 18, "playSeconds": 900, "nick": "리미", "skin": "corn",
    "control": "joystick", "sound": True, "locale": "ko",
}

# 카드 상태를 «클래스 이름이 아니라 실제 DOM»에서 읽는다.
PROBE = """(ids) => {
  const cells = Array.from(document.querySelectorAll('.skin-rail .skin-cell'));
  const out = {};
  cells.forEach((c, i) => {
    const b = c.querySelector('.skin');
    const dot = c.querySelector('.skin-info');
    out[ids[i]] = {
      disabled: b.disabled,
      isInfo: b.classList.contains('is-info'),
      isPremium: b.classList.contains('is-premium'),
      dotShown: !!dot && !dot.hidden,
      adBadge: !!c.querySelector('.skin-ad') && !c.querySelector('.skin-ad').hidden,
      lock: (c.querySelector('.lock') || {}).textContent,
      cap: (c.querySelector('.skin-cap') || {}).textContent,
      aria: b.getAttribute('aria-label'),
      pressed: b.getAttribute('aria-pressed'),
      expanded: b.getAttribute('aria-expanded'),
      controls: b.getAttribute('aria-controls'),
    };
  });
  return out;
}"""

PANEL = """() => {
  const d = document.getElementById('skin-ability-detail');
  if (!d) return { exists: false };
  const rows = Array.from(d.querySelectorAll('.skin-detail-row')).map((r) => ({
    k: r.querySelector('.skin-detail-k').textContent,
    v: r.querySelector('.skin-detail-v').textContent,
  }));
  const r = d.getBoundingClientRect();
  return {
    exists: true, hidden: d.hidden,
    name: (d.querySelector('.skin-detail-name') || {}).textContent,
    ab: (d.querySelector('.skin-detail-ab') || {}).textContent,
    lead: (d.querySelector('.skin-detail-lead') || {}).textContent,
    fair: (d.querySelector('.skin-detail-fair') || {}).textContent,
    closeAria: (d.querySelector('.skin-detail-x') || {}).getAttribute
      ? d.querySelector('.skin-detail-x').getAttribute('aria-label') : null,
    closeW: d.querySelector('.skin-detail-x')
      ? d.querySelector('.skin-detail-x').getBoundingClientRect().width : 0,
    closeH: d.querySelector('.skin-detail-x')
      ? d.querySelector('.skin-detail-x').getBoundingClientRect().height : 0,
    rows: rows,
    w: r.width, h: r.height,
  };
}"""

HERO = """() => {
  const b = document.querySelector('.skin-ability');
  if (!b) return { exists: false };
  const r = b.getBoundingClientRect();
  return {
    exists: true, tag: b.tagName, hidden: b.hidden,
    text: b.textContent, more: (b.querySelector('.skin-ability-more') || {}).textContent || null,
    expanded: b.getAttribute('aria-expanded'), aria: b.getAttribute('aria-label'),
    w: r.width, h: r.height,
  };
}"""


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


def main() -> int:
    dist = Path(sys.argv[1]).resolve()
    tag = sys.argv[2]
    loc = sys.argv[sys.argv.index("--locale") + 1] if "--locale" in sys.argv else "ko"
    out = OUTDIR / "shots" / tag
    out.mkdir(parents=True, exist_ok=True)
    port, srv = serve(dist)
    ext, errs = [], []
    rec = {}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(headless=True)
            ctx = br.new_context(viewport=VIEW, device_scale_factor=3,
                                 locale=("%s-KR" % loc) if loc == "ko" else loc,
                                 has_touch=True, is_mobile=True)

            def guard(route):
                u = route.request.url
                if u.startswith("http://127.0.0.1:%d" % port) or u.startswith("data:"):
                    return route.continue_()
                ext.append(u)
                return route.abort()

            ctx.route("**/*", guard)

            def open_page(save_over=None, adwatch=None):
                sv = dict(SAVE)
                sv["locale"] = loc
                if save_over:
                    sv.update(save_over)
                js = "localStorage.setItem('king-snake.save', %s);" % json.dumps(json.dumps(sv))
                if adwatch is not None:
                    js += "localStorage.setItem('king-snake.adwatch.v1', %s);" % json.dumps(
                        json.dumps({"v": 1, "total": adwatch, "bySurface": {"skinProgress": adwatch}}))
                pg = ctx.new_page()
                pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
                pg.on("console", lambda m: errs.append(m.type + ": " + m.text)
                      if m.type == "error" else None)
                pg.add_init_script(js)
                pg.goto("http://127.0.0.1:%d/index.html?debug=1&quiet=1" % port, wait_until="load")
                pg.wait_for_timeout(1300)
                return pg

            def ids(pg):
                return [s["id"] for s in pg.evaluate("() => window.__coilSkins.state().skins")]

            def rail_end(pg):
                pg.evaluate("() => { const r = document.querySelector('.skin-rail');"
                            " r.scrollLeft = r.scrollWidth; }")
                pg.wait_for_timeout(420)

            def tap(pg, sid, sids):
                r = pg.evaluate("""([sid, sids]) => {
                  const i = sids.indexOf(sid);
                  const b = document.querySelectorAll('.skin-rail .skin-cell')[i].querySelector('.skin');
                  if (b.disabled) return 'disabled';
                  b.click();
                  return 'clicked';
                }""", [sid, sids])
                pg.wait_for_timeout(420)
                return r

            def shot(pg, name):
                blk = pg.query_selector(".p-skin")
                if blk:
                    blk.screenshot(path=str(out / (name + ".png")))
                pg.screenshot(path=str(out / (name + "_full.png")))

            # ── A · B · C : 미보유 (bestScore 20,847 / 광고 0회) ──────────
            pg = open_page()
            sids = ids(pg)
            rail_end(pg)
            shot(pg, "A_locked_rail")
            rec["A_cards"] = pg.evaluate(PROBE, sids)
            rec["A_panel"] = pg.evaluate(PANEL)
            rec["A_hero"] = pg.evaluate(HERO)

            r = tap(pg, "rhinoviper", sids)
            rec["B_tap"] = r
            shot(pg, "B_locked_rhinoviper_open")
            rec["B_panel"] = pg.evaluate(PANEL)
            rec["B_cards"] = pg.evaluate(PROBE, sids)

            r = tap(pg, "bluecoral", sids)
            rec["C_tap"] = r
            shot(pg, "C_locked_bluecoral_open")
            rec["C_panel"] = pg.evaluate(PANEL)

            pg.close()

            # F: 능력 «없는» 스킨을 탭한다 -> 아무 일도 없다.
            #    ★ 새 페이지에서 잰다 — 앞 단계에서 열어 둔 패널이 남아 있으면
            #      「안 열렸다」를 증명할 수 없다(v1 에서 실제로 그렇게 헷갈렸다).
            pg = open_page()
            sids = ids(pg)
            rail_end(pg)
            rec["F_tap_albino"] = tap(pg, "albino", sids)   # 능력 없음 · 미보유 · 광고 밖
            rec["F_panel_after_albino"] = pg.evaluate(PANEL)
            rec["F_tap_mamba"] = tap(pg, "mamba", sids)     # 능력 없음 · 광고 대상 밖
            rec["F_panel_after_mamba"] = pg.evaluate(PANEL)
            rec["F_tap_corn"] = tap(pg, "corn", sids)       # 능력 없음 · 보유(선택된다)
            rec["F_panel_after_corn"] = pg.evaluate(PANEL)
            rec["F_cards"] = pg.evaluate(PROBE, sids)
            shot(pg, "F_no_ability_tap")
            pg.close()

            # ── D · E : 보유 + 장착 ──────────────────────────────────────
            pg = open_page({"bestScore": 100000, "skin": "rhinoviper"}, adwatch=100)
            sids = ids(pg)
            shot(pg, "D_owned_hero")
            rec["D_hero"] = pg.evaluate(HERO)
            rec["D_panel"] = pg.evaluate(PANEL)
            rec["D_cards"] = pg.evaluate(PROBE, sids)
            pg.evaluate("() => { const b = document.querySelector('.skin-ability');"
                        " if (b && !b.hidden) b.click(); }")
            pg.wait_for_timeout(420)
            shot(pg, "E_owned_hero_open")
            rec["E_hero"] = pg.evaluate(HERO)
            rec["E_panel"] = pg.evaluate(PANEL)
            rail_end(pg)
            shot(pg, "E_owned_rail")
            rec["E_cards"] = pg.evaluate(PROBE, sids)
            rec["facts"] = pg.evaluate(
                "() => window.__coilSkins.state().skins.filter(s => s.ability)")
            pg.close()

            (out / "probe.json").write_text(json.dumps(rec, ensure_ascii=False, indent=2),
                                            encoding="utf-8")
            (out / "console.json").write_text(
                json.dumps({"errors": errs, "externalBlocked": ext}, ensure_ascii=False, indent=2),
                encoding="utf-8")
            print("console errors:", len(errs), errs[:4])
            print("external blocked:", len(ext))
            ctx.close()
            br.close()
    finally:
        srv.shutdown()
        srv.server_close()
    print("saved ->", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
