# -*- coding: utf-8 -*-
"""shots_hud.py - 「기록 돌파 배너를 킬로그 밑으로·작게」 실렌더 + «좌표 실측».

  python tools/shots_hud.py <distDir> <outTag>

★ President 2026-09-02 지시: 「1.2배 광고가 시야를 좀 방해한다. 킬로그 밑에
  좀더 작게(그래도 인식할 수는 있는 크기로)」.
  ⇒ 판정 대상이 «배너 혼자 있는 화면»이 아니다. 킬로그가 «실제로 떠 있는»
    상태에서 겹치는지, 킬로그가 여러 줄로 접힐 때도 그런지가 질문이다.
    킬로그 없는 컷만 찍으면 겹침을 원천적으로 못 본다.

★ 킬 피드는 «진짜 경로»(__coil.pushKill -> shell.pushKill)로 채운다.
  DOM 을 직접 조립하면 그건 실제 마크업이 아닐 수 있다.
★ headless 고정. 창을 띄우지 않는다.
★ 운영 광고 ID 를 렌더하지 않는다 - 브릿지 스텁만 꽂는다.
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
OUTBASE = ROOT / "_hud_evidence_260902"
DPR = 2

SAVE_BASE = {
    "v": 1, "savedAt": 0, "bestScore": 1200, "bestRank": 6, "games": 9,
    "totalKills": 7, "playSeconds": 900, "nick": "", "skin": "corn",
    "control": "joystick", "sound": True, "locale": None,
}
STUB_OK = {"load": "ok", "show": "reward", "supported": True}

# 닉네임 상한은 14자다(ui/shell.ts nickInput.maxLength = 14).
# «최악»을 재려면 그 상한을 쓴다 - 짧은 이름으로 재면 접힘을 못 본다.
KILLS_LONG = [
    ("NimbusPro_2K77", "꿈틀대장님하이", "bot"),
    ("EmberCinder_HD", "lanternlantern", "mine"),
    ("ZephyrOnyx_v29", "SaberTangoX_TV", "lost"),
]

RECTS = """() => {
  const g = (s) => {
    const n = document.querySelector(s);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return null;
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1),
             h: +r.height.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) };
  };
  const sels = ['.hud-score', '.hud-board', '.hud-left', '.hud-feed', '.hud-pause',
                '.rw-offer', '#stage', '#hud'];
  const fe = document.querySelector('.hud-feed');
  const out = { rects: {}, feedItems: [], overlap: {}, vw: innerWidth, vh: innerHeight,
                feedHtml: fe ? fe.innerHTML : null,
                offerHtml: (document.querySelector('.rw-offer') || {}).outerHTML || null };
  for (const s of sels) out.rects[s] = g(s);
  for (const n of document.querySelectorAll('.feed-item')) {
    const r = n.getBoundingClientRect();
    out.feedItems.push({ h: +r.height.toFixed(1), y: +r.y.toFixed(1),
                         bottom: +r.bottom.toFixed(1), t: n.textContent });
  }
  const b = document.querySelector('.rw-offer');
  if (b && !b.classList.contains('hidden')) {
    const r = b.getBoundingClientRect();
    for (const s of ['.hud-score', '.hud-board', '.hud-feed', '.hud-pause']) {
      const e = document.querySelector(s);
      if (!e) continue;
      const q = e.getBoundingClientRect();
      if (q.width <= 0 || q.height <= 0) continue;
      const ox = Math.min(r.right, q.right) - Math.max(r.x, q.x);
      const oy = Math.min(r.bottom, q.bottom) - Math.max(r.y, q.y);
      out.overlap[s] = (ox > 0 && oy > 0) ? (Math.round(ox) + 'x' + Math.round(oy)) : 0;
    }
    /* 배너 «위/옆/아래»를 누르면 무엇이 받는가 - 코드가 아니라 좌표로 잰다. */
    const hit = (x, y) => {
      const e = document.elementFromPoint(x, y);
      if (!e) return 'none';
      const own = e.closest ? e.closest('.rw-offer') : null;
      return (own ? 'OFFER<-' : '') + String(e.id || e.className || e.tagName);
    };
    /* ⚠DOMRect 는 width/height 다(w/h 가 아니다). 처음에 w/h 로 써서 NaN 이 들어가
       elementFromPoint 가 통째로 죽었다 - 조용히 틀린 값이 아니라 «터져서» 잡혔다. */
    out.hit = {
      onBanner: hit(r.x + r.width / 2, r.y + r.height / 2),
      center: hit(innerWidth / 2, innerHeight / 2),
      lower: hit(innerWidth / 2, innerHeight * 0.8),
      justBelow: hit(r.x + r.width / 2, Math.min(innerHeight - 2, r.bottom + 12)),
      rightOfBanner: hit(Math.min(innerWidth - 4, r.right + 24), r.y + r.height / 2),
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


def shot(page, out: Path, name: str):
    out.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(out / (name + ".png")))
    print("   shot " + name + ".png")


def open_offer(page, mass: int):
    """판을 시작하고 질량을 세워 배너를 «실제로» 띄운다(5초 뒤 스스로 사라진다)."""
    page.evaluate("() => window.__coil.startRun()")
    page.wait_for_timeout(800)
    page.evaluate("(m) => window.__coil.grow(m)", mass)
    page.wait_for_function("() => window.__coilReward.state().offer !== null", timeout=6000)
    page.wait_for_timeout(260)


# ── 「전」 빌드에는 __coil.pushKill 훅이 «없다»(이번 레인에서 추가한 것이다).
#    그래서 전/후를 같은 조건으로 찍으려면 대체 경로가 필요하다. 대체 경로는
#    pushKill 이 만드는 «마크업 그대로»를 만든다(div.feed-item[.is-mine|.is-lost]
#    + b.feed-name). ★그리고 두 경로가 정말 같은지는 «추정하지 않는다» —
#    양쪽 실행에서 .hud-feed 의 innerHTML 을 덤프해 비교한다(rects json 의 feedHtml).
FALLBACK_PUSH = """(a) => {
  const [killer, victim, who] = a;
  const feed = document.querySelector('.hud-feed');
  if (!feed) return false;
  const n = document.createElement('div');
  n.className = 'feed-item' + (who === 'mine' ? ' is-mine' : who === 'lost' ? ' is-lost' : '');
  const put = (txt) => n.appendChild(document.createTextNode(txt));
  const nm = (v) => { const b = document.createElement('b'); b.className = 'feed-name';
                      b.textContent = v; n.appendChild(b); };
  const lang = document.documentElement.lang || 'ko';
  if (lang.startsWith('ko')) {
    if (who === 'mine') { nm(victim); put('을 잡았다!'); }
    else if (who === 'lost') { nm(killer); put('한테 당했다'); }
    else { nm(killer); put('가 '); nm(victim); put('을 잡았다'); }
  } else if (lang.startsWith('de')) {
    if (who === 'mine') { put('Du erwischst '); nm(victim); }
    else if (who === 'lost') { nm(killer); put(' erwischt dich'); }
    else { nm(killer); put(' erwischt '); nm(victim); }
  } else if (lang.startsWith('ru')) {
    if (who === 'mine') { put('Ты убил '); nm(victim); }
    else if (who === 'lost') { nm(killer); put(' убил тебя'); }
    else { nm(killer); put(' убил '); nm(victim); }
  } else {
    if (who === 'mine') { put('You ate '); nm(victim); }
    else if (who === 'lost') { nm(killer); put(' ate you'); }
    else { nm(killer); put(' ate '); nm(victim); }
  }
  feed.appendChild(n);
  while (feed.children.length > 3) feed.removeChild(feed.firstChild);
  return true;
}"""


def push_kills(page, kills):
    has_hook = page.evaluate(
        "() => !!(window.__coil && typeof window.__coil.pushKill === 'function')")
    for k, v, who in kills:
        if has_hook:
            page.evaluate("(a) => window.__coil.pushKill(a[0], a[1], a[2])", [k, v, who])
        else:
            page.evaluate(FALLBACK_PUSH, [k, v, who])
    page.wait_for_timeout(120)
    return has_hook


SET_FEED = """(html) => {
  const f = document.querySelector('.hud-feed');
  if (!f) return false;
  f.innerHTML = html;          /* 검사 전용 - 문자열은 이 스크립트가 만든 고정값이다 */
  return f.innerHTML === html;
}"""


def main() -> int:
    dist = Path(sys.argv[1]).resolve()
    tag = sys.argv[2]
    # ★ --feed-from <tag>: 「전」 빌드에는 __coil.pushKill 훅이 없다(이번 레인 추가분).
    #   그래서 「후」 실행이 «진짜 경로»로 만든 피드 HTML 을 그대로 꽂아 전/후를
    #   «같은 킬로그»로 맞춘다. 안 그러면 조사(을/를) 하나 때문에 줄바꿈이 달라져
    #   「배너 때문에 달라진 것」과 「글자 때문에 달라진 것」이 섞인다.
    ref = None
    if "--feed-from" in sys.argv:
        ref = json.loads(
            (OUTBASE / f"rects_{sys.argv[sys.argv.index('--feed-from') + 1]}.json")
            .read_text(encoding="utf-8"))
    out = OUTBASE / "shots" / tag
    port, srv = serve(dist)
    errs: list[str] = []
    data: dict = {}

    cases = [
        # (뷰포트, 모바일?, 로케일, lang)
        ((390, 844), True, "ko-KR", None),
        ((390, 844), True, "de-DE", "de"),
        ((390, 844), True, "ru-RU", "ru"),
        ((360, 640), True, "ko-KR", None),
        ((430, 932), True, "en-US", "en"),
        ((1280, 800), False, "ko-KR", None),
    ]

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)  # ★headless 고정 - 창 0
        for (vw, vh), mobile, locale, lang in cases:
            key = f"{vw}x{vh}_{lang or 'ko'}"
            print("== " + key)
            save = dict(SAVE_BASE)
            save["locale"] = lang
            ctx = b.new_context(viewport={"width": vw, "height": vh},
                                device_scale_factor=DPR if mobile else 1,
                                is_mobile=mobile, has_touch=mobile, locale=locale)
            ctx.add_init_script(
                "localStorage.setItem('king-snake.save', %s)"
                % json.dumps(json.dumps(save, ensure_ascii=False)))
            page = ctx.new_page()
            page.on("pageerror", lambda e: errs.append(str(e)))
            page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
            page.goto(f"http://127.0.0.1:{port}/?debug=1&quiet=1&seed=7", wait_until="load")
            page.wait_for_timeout(800)
            page.evaluate("(b) => window.__coilAds.installStub(b)", STUB_OK)
            page.evaluate("() => window.__coilReward.refresh()")
            page.evaluate("() => window.__coilReward.setBest(1200)")

            # ① 배너 + 킬로그 «없음» (기본 자리)
            open_offer(page, 520)
            data[key + "|A_nofeed"] = page.evaluate(RECTS)
            shot(page, out, key + "_A_offer_nofeed")

            def feed_case(name: str, kills):
                if ref is not None and ref.get(key + "|" + name, {}).get("feedHtml"):
                    ok = page.evaluate(SET_FEED, ref[key + "|" + name]["feedHtml"])
                    if not ok:
                        raise SystemExit("feed 주입 실패: " + key + "|" + name)
                else:
                    push_kills(page, kills)
                page.wait_for_timeout(100)

            # ② 배너 + 킬로그 «한 줄»
            feed_case("B_feed1", KILLS_LONG[:1])
            data[key + "|B_feed1"] = page.evaluate(RECTS)
            shot(page, out, key + "_B_offer_feed1")

            # ③ 배너 + 킬로그 «3줄»(상한 FEED_MAX=3, 최장 닉네임 = 최악)
            feed_case("C_feed3", KILLS_LONG[1:])
            data[key + "|C_feed3"] = page.evaluate(RECTS)
            shot(page, out, key + "_C_offer_feed3")

            # ④ 킬로그 3줄 «만»(배너 없음) - 대조군. 배너가 킬로그를 밀었는지 본다.
            page.evaluate("() => { const b = document.querySelector('.rw-offer');"
                          "        if (b) b.classList.add('hidden'); }")
            page.wait_for_timeout(80)
            data[key + "|D_feedonly"] = page.evaluate(RECTS)
            shot(page, out, key + "_D_feed3_nobanner")

            # ⑤ 킬로그 «비어 있을 때». 자리 예약(min-height)이 없으면 배너가 여기서
            #    위로 뛴다 - 그 「뛰는가」를 보는 컷이다.
            page.evaluate("() => { const f = document.querySelector('.hud-feed');"
                          "        if (f) f.textContent = '';"
                          "        const b = document.querySelector('.rw-offer');"
                          "        if (b) b.classList.remove('hidden'); }")
            page.wait_for_timeout(120)
            data[key + "|E_emptyfeed"] = page.evaluate(RECTS)
            shot(page, out, key + "_E_offer_emptyfeed")

            ctx.close()
        b.close()
    srv.shutdown()

    OUTBASE.mkdir(parents=True, exist_ok=True)
    (OUTBASE / ("rects_" + tag + ".json")).write_text(
        json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print("console/page errors:", len(errs), errs[:4])
    print("rects -> " + str(OUTBASE / ("rects_" + tag + ".json")))
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
