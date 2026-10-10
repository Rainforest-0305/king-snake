# -*- coding: utf-8 -*-
"""shots_offer_ab3.py - 리워드 유도 배너 «3차» 재설계 비교 + ★좌측 열 정렬 실측. headless 고정, 창 0.

  python tools/shots_offer_ab3.py <distDir> <outTag> [--locale ko] [--vw 390] [--vh 844]
                                  [--only V1,V7] [--feed 3|0]

═══ 왜 3차인가 ═══════════════════════════════════════════════════════════════
 President 실기기 판정(2026-09-03): 「저 광고 유도 버튼 아직도 생김새가 이상하고
 정렬도 안 맞지 않아?」  ⇒ 2차(shots_offer_ab.py, V5 채택)가 «부족했다».

 지적 5건:
   1) ★왼쪽 정렬이 어긋난다 — 같은 좌측 열인데 배너만 안쪽으로 들여쓰기 돼 보인다
   2) 앰버가 «두 번» 나온다(아이콘 링 + 알약 테) → 신호가 갈려 어느 쪽도 강조가 안 됨
   3) 아이콘 원이 과하게 크다 → 「알약에 배지를 덧댄」 인상
   4) 오른쪽 꺾쇠가 붕 떠 있다(세로 중앙에 홀로)
   5) 모서리 반경이 다른 HUD 와 계열이 다르다(혼자 알약)

═══ ★2차의 실패 원인 = 「배너만 봤다」 ══════════════════════════════════════
 2차는 배너 «혼자» 있는 컷으로 골랐다. 정렬은 «이웃과 같이» 봐야 보인다.
 ⇒ 이 도구는 점수줄·킬로그·순위표·일시정지가 «전부 떠 있는» 상태에서만 찍고,
   좌측 열 요소들의 «좌변 x 좌표»를 표로 낸다. 숫자가 같아야 통과다.

═══ 대조군 ══════════════════════════════════════════════════════════════════
 V1_live = 지금 소스 그대로(주입 0). 나머지는 그 위에 CSS 를 얹는다.
 ★주입하는 CSS 가 곧 «채택 시 소스에 들어갈 것»이라 비교가 정직하다.
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
OUTBASE = ROOT / "_offer_evidence_260903"
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

# ══ 안(案) ═══════════════════════════════════════════════════════════════════
#  ★1차 실렌더(ab1)가 가르쳐 준 것 — «상자»는 이미 정렬돼 있었다:
#      .hud-score / .feed-item x3 / .rw-offer 의 좌변이 «전부 x=16.0» (leftSpread 0)
#    그런데 President 는 「정렬이 안 맞는다」고 했다. 화면을 보니 답이 나왔다:
#      눈이 읽는 것은 «상자»가 아니라 «잉크»다.
#        길이 537        잉크 시작 x=16
#        기다린다가…     잉크 시작 x=16
#        [판]  ● 500 돌파  ← 아이콘 x=29 · 제목 x=60
#    ⇒ 판에 padding 이 있는 한 상자를 맞춰도 «글자»는 44px 안쪽에서 시작한다.
#      고칠 것은 상자가 아니라 «잉크의 좌변»이다.
#
#  ★그리고 화면에서 «지적 2» 가 지적보다 심각했다 — 앰버가 두 번이 아니라 «넷»이다:
#      ①아이콘 원반 ②아이콘 링 ③판 «테두리 전체» ④제목 글자 ⑤남은시간 막대
#    가장 큰 앰버는 «판을 두르는 테»다(면적이 제일 크다). 그게 신호를 잡아먹는다.
#
#  ★HUD 언어(styles.css 실측): 일시정지 = --hud-plate(rgba(4,6,13,.74)) «테두리 없음».
#    순위표·킬로그·점수 = «판이 아예 없다»(글자 + 8방향 1px 윤곽).
#    배너만 밝은 카드(surface-2→surface) + 앰버 테 + 앰버 글로우 = 혼자 다른 종족.

# ── A. 잉크 좌변을 열 축(16px)에 맞춘다 ─────────────────────────────────────
#   판을 왼쪽으로 «흘려» padding 만큼 상쇄한다. 그러면 «아이콘»이 정확히 16px 에 선다
#   = 길이/순위·킬로그와 같은 축. 판의 좌변은 6px 로 화면 가장자리에 더 가까워지지만,
#   판은 «배경»이고 눈이 읽는 것은 잉크다.
#   ⛔투명 패딩으로 탭만 키우는 것이 아니다 — 판 자체가 넓어지므로
#     「보이는 사각형 = 누르는 사각형」은 그대로다.
BLEED = """
.rw-offer { margin-left: -10px; padding-left: 10px; }
"""

# ── B. 알약 → HUD 판 ────────────────────────────────────────────────────────
#   반경을 --r-pill(999) → --r-m(11)로. 알약의 둥근 캡이 좌변을 25px 먹어
#   광학적으로도 «안으로 밀린» 인상을 만든다(지적 1·5 가 같은 원인이다).
PLATE = """
.rw-offer {
  border-radius: var(--r-m);
  background: rgba(6, 9, 18, .93);
  border: 0;
  padding-top: 7px; padding-bottom: 8px; padding-right: 18px;
  box-shadow: 0 6px 16px rgba(4, 6, 13, .5);
}
"""

# ── C. 앰버를 «한 구역»으로 ─────────────────────────────────────────────────
#   테·글로우·막대에서 앰버를 걷는다. 남는 것은 «아이콘 + 제목» 한 덩어리뿐.
ONEAMBER = """
.rw-offer-bar { background: rgba(244, 246, 250, .34); opacity: 1; height: 2px; }
.rw-offer::after { border-color: var(--muted); opacity: .9; }
"""

# ── D. 아이콘 축소 ──────────────────────────────────────────────────────────
#   22px 원반 + 4px 링 = 시각 지름 30px. 50px 판의 60% = 「배지를 덧댄」 인상(지적 3).
ICON = """
.rw-offer-ico { width: 16px; height: 16px; box-shadow: 0 0 0 2.5px rgba(255,180,60,.20); }
.rw-offer-ico::before {
  width: 5px; height: 5px; margin: -3px 0 0 -2.5px;
  border-left-width: 1.8px; border-top-width: 1.8px;
}
.rw-offer { gap: 8px; }
"""

# ── E. 꺾쇠를 «제목 줄»에 정착 ──────────────────────────────────────────────
#   판 세로 중앙에 홀로 떠 있어 소속이 모호했다(지적 4). 제목의 첫 줄 높이로 올린다.
CHEV = """
.rw-offer::after {
  top: 0; margin-top: 0;
  transform: translateY(calc(7px + 0.55em)) rotate(45deg);
  right: 7px; width: 5px; height: 5px;
  border-right-width: 1.8px; border-top-width: 1.8px;
}
"""

# ── F. 제목까지 잉크로(앰버 = 아이콘 한 점) ─────────────────────────────────
INKTITLE = """
.rw-offer-title { color: var(--ink); }
"""

# ── G. 흘리지 «않는» 대조 — 판 좌변은 16px, 잉크는 26px ─────────────────────
NOBLEED = """
.rw-offer { margin-left: 0; padding-left: 10px; }
"""

# ── H. 아이콘도 «글자 축»에 두는 극단 — 아이콘을 빼고 제목이 16px 에서 시작 ──
#   「앰버는 한 곳」의 극단이자 정렬의 극단. 다만 3m 밖에서 배너를 찾는 표식이 사라진다.
NOICON = """
.rw-offer-ico { display: none; }
.rw-offer { padding-left: 10px; margin-left: -10px; }
.rw-offer-title { color: var(--signal); }
"""

# ── I. 채택 후보를 «조인다» ─────────────────────────────────────────────────
#   V4 를 고른 뒤의 마감. 왼쪽 안여백을 10 -> 8 로 줄여 아이콘을 축에 더 붙이고,
#   남은시간 막대를 한 단 죽여 「떠 있는 밑줄」로 보이지 않게 한다.
TIGHT = """
.rw-offer { padding-left: 8px; gap: 7px; }
.rw-offer-bar { background: rgba(244, 246, 250, .26); }
"""

CORE = BLEED + PLATE + ONEAMBER + ICON + CHEV

VARIANTS = {
    "V1_live":     "",                                # 지금 소스(-23) = President 가 본 것
    "V2_plate":    PLATE,                             # 판만 HUD 언어로
    "V3_amber1":   PLATE + ONEAMBER,                  # + 앰버 한 구역
    "V4_icon":     PLATE + ONEAMBER + ICON + CHEV,    # + 아이콘 축소 + 꺾쇠 정착 (흘리지 않음)
    "V5_bleed":    CORE,                              # + 잉크 좌변 정렬       <- 후보
    "V6_inktitle": CORE + INKTITLE,                   # 앰버 = 아이콘 한 점
    "V7_nobleed":  PLATE + ONEAMBER + ICON + CHEV + NOBLEED,  # 정렬 대조군
    "V8_noicon":   PLATE + ONEAMBER + CHEV + NOICON,  # 아이콘 제거 극단
    # ★채택 후보 — V4(흘리지 않음) + 마감. 판 좌변이 «곧은 선»으로 x=16 에 선다.
    "V9_ship":     PLATE + ONEAMBER + ICON + CHEV + TIGHT,
}

RECTS = """() => {
  const g = (n) => {
    if (!n) return null;
    const r = n.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return null;
    return { x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1),
             h:+r.height.toFixed(1), right:+r.right.toFixed(1), bottom:+r.bottom.toFixed(1) };
  };
  const q = (s) => g(document.querySelector(s));
  const out = { rects:{}, overlap:{}, vw: innerWidth, vh: innerHeight };
  for (const s of ['.hud-score','.hud-board','.hud-left','.hud-feed','.hud-pause','.rw-offer'])
    out.rects[s] = q(s);
  /* ★좌측 열 «좌변» 표 — 이번 라운드의 핵심 증거.
     .hud-score 는 위치 상자라 좌변이 곧 글자 시작이다. 킬로그는 «줄마다» 잰다
     (가운데 정렬이면 줄마다 다른 값이 나오고, 그게 곧 결함의 증거다). */
  const left = {};
  left['score(길이/순위)'] = (q('.hud-score')||{}).x;
  [...document.querySelectorAll('.feed-item')].forEach((n,i) => {
    left['feed['+i+']'] = +n.getBoundingClientRect().x.toFixed(1);
  });
  const off = q('.rw-offer');
  left['offer(배너 상자)'] = off ? off.x : null;
  const ico = q('.rw-offer-ico');
  left['offer.icon'] = ico ? ico.x : null;
  const ttl = q('.rw-offer-title');
  left['offer.title'] = ttl ? ttl.x : null;
  out.leftEdges = left;
  const vals = Object.entries(left).filter(([k,v]) => v !== null && v !== undefined
      && k !== 'offer.icon' && k !== 'offer.title').map(([,v]) => v);
  out.leftSpreadPx = vals.length ? +(Math.max(...vals) - Math.min(...vals)).toFixed(1) : null;

  const b = document.querySelector('.rw-offer');
  if (b && !b.classList.contains('hidden')) {
    const r = b.getBoundingClientRect();
    for (const s of ['.hud-score','.hud-board','.hud-feed','.hud-pause']) {
      const e = document.querySelector(s);
      if (!e) continue;
      const p = e.getBoundingClientRect();
      if (p.width <= 0 || p.height <= 0) continue;
      const ox = Math.min(r.right,p.right) - Math.max(r.x,p.x);
      const oy = Math.min(r.bottom,p.bottom) - Math.max(r.y,p.y);
      out.overlap[s] = (ox > 0 && oy > 0) ? (Math.round(ox)+'x'+Math.round(oy)) : 0;
    }
    out.coverAll = +((r.width*r.height) / (innerWidth*innerHeight) * 100).toFixed(2);
    out.coverTopHalf = +((r.width*r.height) / (innerWidth*innerHeight/2) * 100).toFixed(2);
    out.area = Math.round(r.width * r.height);
    const hit = (x,y) => { const e = document.elementFromPoint(x,y);
      return e ? ((e.closest && e.closest('.rw-offer')) ? 'OFFER' : String(e.id||e.className||e.tagName)) : 'none'; };
    /* 보이는 사각형 = 누르는 사각형. 모서리 반경을 바꾸면 «구석»이 특히 중요해진다. */
    out.hit = {
      center: hit(r.x+r.width/2, r.y+r.height/2),
      topLeftIn: hit(r.x+3, r.y+3),
      leftOutside: hit(Math.max(1, r.x-6), r.y+r.height/2),
      rightOutside: hit(Math.min(innerWidth-2, r.right+8), r.y+r.height/2),
      justBelow: hit(r.x+r.width/2, Math.min(innerHeight-2, r.bottom+10)),
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


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def main() -> int:
    dist = Path(sys.argv[1]).resolve()
    tag = sys.argv[2]
    loc = arg("--locale", "ko")
    vw = int(arg("--vw", "390"))
    vh = int(arg("--vh", "844"))
    feed = int(arg("--feed", "3"))
    only = arg("--only", "")
    only = [x for x in only.split(",") if x]
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
                # ★킬로그를 «진짜 경로»로 띄운다 — 정렬은 이웃이 있어야 보인다.
                for k, v, who in KILLS_LONG[:feed]:
                    page.evaluate("(a) => window.__coil.pushKill(a[0], a[1], a[2])", [k, v, who])
                page.evaluate("(m) => window.__coil.grow(m)", 520)
                page.wait_for_function("() => window.__coilReward.state().offer !== null",
                                       timeout=6000)
                page.wait_for_timeout(420)
                data[name] = page.evaluate(RECTS)
                page.screenshot(path=str(out / (name + "_full.png")))
                page.screenshot(path=str(out / (name + "_crop.png")),
                                clip={"x": 0, "y": 0, "width": vw, "height": 250})
                d = data[name]
                r = d["rects"][".rw-offer"]
                print("%-12s %6.1fx%-5.1f area=%5d cover=%.2f%% leftSpread=%s overlap=%s"
                      % (name, r["w"], r["h"], d["area"], d["coverAll"],
                         d["leftSpreadPx"], d["overlap"]))
                ctx.close()
            br.close()
    finally:
        srv.shutdown()

    (out / "rects.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print("\n── 좌측 열 «좌변» x 좌표(px) ─────────────────────────────")
    keys = sorted({k for d in data.values() for k in d["leftEdges"]})
    print("%-14s %s" % ("", "  ".join("%-9s" % k[:9] for k in keys)))
    for name, d in data.items():
        print("%-14s %s" % (name, "  ".join("%-9s" % str(d["leftEdges"].get(k)) for k in keys)))
    if errs:
        print("\n⚠ 콘솔/페이지 오류:", errs[:10])
    print("\nout:", out)
    return 1 if errs else 0


if __name__ == "__main__":
    raise SystemExit(main())
