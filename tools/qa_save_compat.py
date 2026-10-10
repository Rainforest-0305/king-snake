# -*- coding: utf-8 -*-
"""qa_save_compat.py - 옛 세이브(라이브 -12 가 쓴 v1 구조)가 새 빌드에서 «그대로» 읽히는지. headless.
  python tools/qa_save_compat.py <distdir>
  검사: status=loaded · 스킨 선택 유지(albino) · 최고점/판수 유지 · 잠금 표시 · 저장 후 구조(키 집합)가 동일
  양성대조: v 를 2 로 바꾼 세이브 → version-mismatch 로 초기화되는지(검사기가 «읽지 못함»을 구분하는가).
"""
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

OLD = {"v": 1, "savedAt": 1756400000000, "bestScore": 27000, "bestRank": 3, "games": 41, "totalKills": 77,
       "playSeconds": 5400, "nick": "테스터", "skin": "albino", "control": "drag", "sound": True, "locale": "ko"}


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


def run(pw, port, save, expect_status):
    b = pw.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="ko-KR")
    ctx.add_init_script("localStorage.setItem('king-snake.save', %s)" % json.dumps(json.dumps(save, ensure_ascii=False)))
    page = ctx.new_page()
    logs = []
    page.on("console", lambda m: logs.append(m.text))
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(f"http://127.0.0.1:{port}/?debug=1&ads=off&seed=1", wait_until="load")
    page.wait_for_timeout(1200)
    status = next((l.split("=")[-1].strip() for l in logs if "save status" in l), None)
    ui = page.evaluate("""() => ({
        hero: document.querySelector('.skin-hero-name')?.textContent,
        best: [...document.querySelectorAll('.kv-v')].map(e => e.textContent),
        pressed: [...document.querySelectorAll('.skin[aria-pressed="true"]')].length,
        /* ★2026-09-02 ② 정정: 「고를 수 없다」의 «구현»이 disabled 하나가 아니게 됐다.
           특수 기능이 있는 잠긴 카드는 탭이 «설명을 연다» -> disabled 가 아니라
           .is-info 다(그래도 «고를 수는 없다»). 그래서 세는 대상은 «둘의 합»이다.
           ⛔disabled 만 세면 이 검사는 「잠긴 카드가 선택 가능해졌다」를 놓치는 게
             아니라 «정상 동작을 회귀로 신고»한다 — 실제로 그렇게 FAIL 났다.
           ★대신 검사를 «더 좁혔다»: is-info 는 «능력이 있는» 스킨에만 붙어야 한다. */
        locked: [...document.querySelectorAll('.skin[disabled], .skin.is-info')].length,
        /* ★기대값을 «박지 않는다» — 번들에서 「이 점수로 못 여는 스킨 수」를 유도한다.
           예전엔 locked==0 을 박아 뒀는데, 최고급 스킨(10만점·광고 100회)이 생기자
           «정상 동작»을 회귀로 신고했다(2026-09-02). */
        expectLocked: (window.__coilSkins
          ? window.__coilSkins.state().skins.filter((x) => !x.owned).length
          : null),
        /* 「탭이 설명을 여는 카드」가 «정말로 능력을 가진 스킨인가». 능력 없는 스킨에
           .is-info 가 붙으면 빈 설명창이 열린다 - 그건 결함이다. */
        infoIds: (window.__coilSkins ? (() => {
          const ids = window.__coilSkins.state().skins.map((x) => x.id);
          const cells = [...document.querySelectorAll('.skin-rail .skin-cell')];
          return cells.map((c, i) => [ids[i], c.querySelector('.skin')])
            .filter(([, b]) => b && b.classList.contains('is-info')).map(([id]) => id);
        })() : null),
        abilityIds: (window.__coilSkins
          ? window.__coilSkins.state().skins.filter((x) => x.ability).map((x) => x.id)
          : null),
        ctrl: document.querySelector('.seg button[aria-pressed="true"]')?.textContent,
        nick: document.querySelector('.nick')?.value,
        saved: JSON.parse(localStorage.getItem('king-snake.save') || 'null'),
    })""")
    ctx.close()
    b.close()
    ok = status == expect_status and not errs
    print(("PASS" if ok else "FAIL"), "expect", expect_status, "got", status, "errors", errs)
    return ok, ui


def main():
    dist = Path(sys.argv[1]).resolve()
    port, srv = serve(dist)
    fails = 0
    with sync_playwright() as pw:
        ok, ui = run(pw, port, OLD, "loaded")
        fails += not ok
        print("  hero:", ui["hero"], "| kv:", ui["best"], "| pressed:", ui["pressed"], "locked:", ui["locked"],
              "| ctrl:", ui["ctrl"], "| nick:", ui["nick"])
        exp = ui.get("expectLocked")
        if exp is None:
            print("  FAIL: __coilSkins 훅이 없다 - 검사기가 죽었다"); fails += 1; exp = -1
        if (ui["hero"] != "알비노비단뱀" or ui["best"][:1] != ["27,000"]
                or ui["locked"] != exp or ui["nick"] != "테스터"):
            print("  FAIL: old save values not reflected"); fails += 1
        # ★「설명이 열리는 카드」 ⊆ 「능력이 있는 스킨」. 여기가 어긋나면 빈 설명창이 뜬다.
        info = set(ui.get("infoIds") or [])
        abil = set(ui.get("abilityIds") or [])
        if not info <= abil:
            print("  FAIL: is-info on skins without ability:", sorted(info - abil)); fails += 1
        else:
            print("  is-info ⊆ ability:", sorted(info), "⊆", sorted(abil))
        saved = ui["saved"] or {}
        if set(saved.keys()) != set(OLD.keys()):
            print("  FAIL: save key set changed:", sorted(set(saved.keys()) ^ set(OLD.keys()))); fails += 1
        else:
            print("  save key set identical:", sorted(saved.keys()))
        # 양성대조
        bad = dict(OLD); bad["v"] = 2
        ok2, _ = run(pw, port, bad, "version-mismatch")
        fails += not ok2
    srv.shutdown()
    print("RESULT:", "PASS" if fails == 0 else f"FAIL ({fails})")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
