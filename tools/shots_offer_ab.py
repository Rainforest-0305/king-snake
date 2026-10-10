# -*- coding: utf-8 -*-
"""shots_offer_ab.py - 기록 돌파 배너 «디자인 안» 실렌더 비교. headless 고정, 창 0.

  python tools/shots_offer_ab.py <distDir> <outTag> [--locale ko] [--vw 390] [--vh 844]

★ President 2026-09-02 재지시: 「킬로그 밑으로 옮기니까 좀 «리워드가 안 보여».
  그리고 «리워드 광고 배너가 못 생겼어». 적당히 키우면서 «이쁘게» 만들 수는 없어?」
  ⇒ 코드만 보고 정하지 않는다. 안을 CSS 로 «주입»해 같은 프레임에서 찍고 눈으로 고른다.
    주입하는 CSS 가 곧 «채택 시 소스에 들어갈 것»이라 비교가 정직하다.

★ 안(案)은 아래 VARIANTS 하나에 모여 있다. 채택본은 소스로 옮기고, 옮긴 뒤
  이 파일의 그 항목은 «baseline» 이 된다(= 다음 비교의 대조군).
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
OUTBASE = ROOT / "_offer_evidence_260902"
DPR = 3

SAVE_BASE = {
    "v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
    "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
    "control": "joystick", "sound": True, "locale": None,
}
STUB_OK = {"load": "ok", "show": "reward", "supported": True}
KILLS_LONG = [
    ("NimbusPro_2K77", "꿈틀대장님하이", "bot"),
    ("EmberCinder_HD", "lanternlantern", "mine"),
    ("ZephyrOnyx_v29", "SaberTangoX_TV", "lost"),
]

# ── 「크게」 공통분 — 안 V2~V4 가 전부 이 위에 쌓인다 ──────────────────────
#    -22 는 34px/13/12.5/11 이었다. 원래(09-01)는 58px/22/15/12 «인데 화면 한가운데»
#    였다. 자리가 왼쪽 열로 바뀌었으니 원래 크기가 곧 원래 방해가 아니다.
BIGGER = """
.rw-offer { min-height: 50px; gap: 9px; padding: 7px 12px 8px; }
.rw-offer-ico { width: 22px; height: 22px; box-shadow: 0 0 0 4px rgba(255,180,60,.16); }
.rw-offer-title { font-size: 15px; }
.rw-offer-sub { font-size: 12px; }
.rw-offer-bar { height: 3px; }
"""

# 다듬기: 표면에 «층»을 주고(그라디언트), 앰버를 «신호»로 세우고(글로우·테),
# 아이콘에 «뜻»을 넣고(위로 향한 꺾쇠 = 키운다), 「눌러라」를 오른쪽 꺾쇠로 말한다.
REFINE = """
.rw-offer {
  padding-right: 26px;
  background: linear-gradient(180deg, var(--surface-2) 0%, var(--surface) 100%);
  border-color: var(--reward-edge-hi);
  box-shadow: 0 8px 20px rgba(4,6,13,.55), 0 0 20px rgba(255,180,60,.20);
}
.rw-offer-ico { position: relative; }
.rw-offer-ico::before {
  content: ''; position: absolute; left: 50%; top: 53%;
  width: 7px; height: 7px; margin: -4px 0 0 -3.5px;
  border-left: 2.2px solid var(--on-signal);
  border-top: 2.2px solid var(--on-signal);
  transform: rotate(45deg);
}
.rw-offer::after {
  content: ''; position: absolute; right: 11px; top: 50%;
  width: 6px; height: 6px; margin-top: -4px;
  border-right: 2px solid var(--signal);
  border-top: 2px solid var(--signal);
  transform: rotate(45deg);
  opacity: .8;
}
@keyframes offerIn {
  from { transform: translateY(-6px) scale(.94); opacity: 0; }
  to   { transform: translateY(0) scale(1); opacity: 1; }
}
"""

# 더 세게: 왼쪽을 «앰버 캡»으로 채운다. 멀리서 보면 「앰버 탭 = 보상」 한 덩어리다.
CAP = """
.rw-offer { padding-left: 0; gap: 10px; }
.rw-offer-ico {
  align-self: stretch;
  width: 32px; height: auto;
  margin: -7px 0 -8px;
  border-radius: 0;
  background: var(--signal);
  box-shadow: none;
  position: relative;
}
.rw-offer-ico::before {
  content: ''; position: absolute; left: 50%; top: 50%;
  width: 9px; height: 9px; margin: -5px 0 0 -4.5px;
  border-left: 2.6px solid var(--on-signal);
  border-top: 2.6px solid var(--on-signal);
  transform: rotate(45deg);
}
"""

# 2차: V3 를 «조인다». 폭이 09-01 원본(194)을 넘지 않게 오른쪽 여백을 줄이고,
#      아이콘 링을 한 단 세워 「원반이 곧 버튼」으로 읽히게 한다.
TIGHT = """
.rw-offer { padding-right: 23px; }
.rw-offer::after { right: 9px; opacity: .62; }
.rw-offer-ico { box-shadow: 0 0 0 4px rgba(255,180,60,.22); }
"""

# 3차 후보: 「더 크게」. 채택되면 폭·높이가 원본을 넘는다 - 그래서 «측정해 보고» 정한다.
TALLER = """
.rw-offer { min-height: 54px; }
.rw-offer-title { font-size: 16px; }
"""

VARIANTS = {
    "V1_baseline": "",                        # 지금 라이브(-22)
    "V2_bigger": BIGGER,                      # 크기만
    "V3_refined": BIGGER + REFINE,            # 크기 + 다듬기
    "V4_cap": BIGGER + REFINE + CAP,          # 크기 + 다듬기 + 앰버 캡
    "V5_tight": BIGGER + REFINE + TIGHT,      # V3 를 조인 것  <- 채택 후보
    "V6_taller": BIGGER + REFINE + TIGHT + TALLER,
}

RECTS = """() => {
  const g = (s) => {
    const n = document.querySelector(s);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return null;
    return { x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1),
             h:+r.height.toFixed(1), right:+r.right.toFixed(1), bottom:+r.bottom.toFixed(1) };
  };
  const out = { rects:{}, overlap:{}, vw: innerWidth, vh: innerHeight };
  for (const s of ['.hud-score','.hud-board','.hud-left','.hud-feed','.hud-pause','.rw-offer'])
    out.rects[s] = g(s);
  const b = document.querySelector('.rw-offer');
  if (b && !b.classList.contains('hidden')) {
    const r = b.getBoundingClientRect();
    for (const s of ['.hud-score','.hud-board','.hud-feed','.hud-pause']) {
      const e = document.querySelector(s);
      if (!e) continue;
      const q = e.getBoundingClientRect();
      if (q.width <= 0 || q.height <= 0) continue;
      const ox = Math.min(r.right,q.right) - Math.max(r.x,q.x);
      const oy = Math.min(r.bottom,q.bottom) - Math.max(r.y,q.y);
      out.overlap[s] = (ox > 0 && oy > 0) ? (Math.round(ox)+'x'+Math.round(oy)) : 0;
    }
    /* 배너가 «아레나의 몇 %»를 덮나. 화면 전체 대비와, 「위협이 오는 통로」로
       President 가 지목한 상단 절반 대비를 따로 낸다. */
    out.coverAll = +((r.width*r.height) / (innerWidth*innerHeight) * 100).toFixed(2);
    out.coverTopHalf = +((r.width*r.height) / (innerWidth*innerHeight/2) * 100).toFixed(2);
    out.area = Math.round(r.width * r.height);
    const hit = (x,y) => { const e = document.elementFromPoint(x,y);
      return e ? ((e.closest && e.closest('.rw-offer')) ? 'OFFER' : String(e.id||e.className||e.tagName)) : 'none'; };
    out.hit = {
      onBanner: hit(r.x+r.width/2, r.y+r.height/2),
      center: hit(innerWidth/2, innerHeight/2),
      rightOfBanner: hit(Math.min(innerWidth-4, r.right+20), r.y+r.height/2),
      justBelow: hit(r.x+r.width/2, Math.min(innerHeight-2, r.bottom+14)),
    };
  }
  return out;
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
    vw = int(sys.argv[sys.argv.index("--vw") + 1]) if "--vw" in sys.argv else 390
    vh = int(sys.argv[sys.argv.index("--vh") + 1]) if "--vh" in sys.argv else 844
    only = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else None
    out = OUTBASE / "shots" / tag
    out.mkdir(parents=True, exist_ok=True)
    port, srv = serve(dist)
    errs: list[str] = []
    data: dict = {}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(headless=True)   # ★headless 고정 — 창 0
            for name, css in VARIANTS.items():
                if only and name not in only:
                    continue
                save = dict(SAVE_BASE)
                save["locale"] = None if loc == "ko" else loc
                ctx = br.new_context(viewport={"width": vw, "height": vh},
                                     device_scale_factor=DPR, is_mobile=True, has_touch=True,
                                     locale=("ko-KR" if loc == "ko" else loc))
                ctx.add_init_script("localStorage.setItem('king-snake.save', %s)"
                                    % json.dumps(json.dumps(save, ensure_ascii=False)))
                page = ctx.new_page()
                page.on("pageerror", lambda e: errs.append(name + ": " + str(e)))
                page.on("console", lambda m: errs.append(name + ": " + m.text)
                        if m.type == "error" else None)
                page.goto("http://127.0.0.1:%d/?debug=1&quiet=1&seed=7" % port, wait_until="load")
                page.wait_for_timeout(800)
                if css:
                    page.add_style_tag(content=css)
                page.evaluate("(b) => window.__coilAds.installStub(b)", STUB_OK)
                page.evaluate("() => window.__coilReward.refresh()")
                page.evaluate("() => window.__coilReward.setBest(1200)")
                page.evaluate("() => window.__coil.startRun()")
                page.wait_for_timeout(800)
                for k, v, who in KILLS_LONG:
                    page.evaluate("(a) => window.__coil.pushKill(a[0], a[1], a[2])", [k, v, who])
                page.evaluate("(m) => window.__coil.grow(m)", 520)
                page.wait_for_function("() => window.__coilReward.state().offer !== null",
                                       timeout=6000)
                page.wait_for_timeout(420)
                data[name] = page.evaluate(RECTS)
                page.screenshot(path=str(out / (name + "_full.png")))
                page.screenshot(path=str(out / (name + "_crop.png")),
                                clip={"x": 0, "y": 0, "width": vw, "height": 260})
                r = data[name]["rects"][".rw-offer"]
                print("%-12s %6.1fx%-5.1f area=%5d cover(all/top)=%.2f%%/%.2f%% overlap=%s"
                      % (name, r["w"], r["h"], data[name]["area"],
                         data[name]["coverAll"], data[name]["coverTopHalf"],
                         data[name]["overlap"]))
                ctx.close()
            br.close()
    finally:
        srv.shutdown()
        srv.server_close()
    (OUTBASE / ("rects_" + tag + ".json")).write_text(
        json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print("errors:", len(errs), errs[:4])
    print("saved ->", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
