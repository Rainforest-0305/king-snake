# -*- coding: utf-8 -*-
"""qa_skinsheet_diff.py — 스킨 시트(24종) 전/후 픽셀 대조.

  python tools/qa_skinsheet_diff.py <distA> <distB> <tagA> <tagB>

★ 왜 이게 좋은 회귀 검사인가
  `__coilSkinSheet()` 는 «게임과 같은 렌더 코드»(strokeTube/paintHead)로 스킨
  24종을 한 장에 그린다. 시뮬 이력이 없어 «완전히 결정론적»이다.
  ⇒ 일반 크기 뱀에서 그림이 바뀌었는지를 «픽셀 수»로 답할 수 있다.
  (미리보기 굵기에서는 비늘 배율 버킷이 1 이라, 이번 수정은 여기서 «0픽셀»
   달라야 정상이다 — 달라지면 큰 뱀 아닌 곳까지 건드린 것이다.)
★ 헤드리스 전용.
"""
from __future__ import annotations

import base64
import http.server
import io as _io
import json
import socketserver
import sys
import threading
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
from PIL import Image, ImageChops  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_render_260908"


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


def sheet(dist: Path, tag: str) -> Path:
    port, srv = serve(dist)
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(headless=True)
            ctx = b.new_context(viewport={"width": 390, "height": 844},
                                device_scale_factor=2, is_mobile=True,
                                has_touch=True, locale="ko-KR")
            page = ctx.new_page()
            page.goto("http://127.0.0.1:%d/?debug=1&quiet=1&seed=7" % port,
                      wait_until="load")
            page.wait_for_timeout(1000)
            url = page.evaluate("() => window.__coilSkinSheet(6)")
            ctx.close()
            b.close()
    finally:
        srv.shutdown()
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / ("skinsheet_%s.png" % tag)
    p.write_bytes(base64.b64decode(url.split(",", 1)[1]))
    return p


def main() -> int:
    pa = sheet(Path(sys.argv[1]).resolve(), sys.argv[3])
    pb = sheet(Path(sys.argv[2]).resolve(), sys.argv[4])
    ia = Image.open(pa).convert("RGB")
    ib = Image.open(pb).convert("RGB")
    if ia.size != ib.size:
        print("크기가 다르다:", ia.size, ib.size)
        return 1
    diff = ImageChops.difference(ia, ib)
    bbox = diff.getbbox()
    px = list(diff.convert("L").getdata())
    n = sum(1 for v in px if v > 4)
    print("== 스킨 시트 24종 전/후 픽셀 대조 (%dx%d)" % ia.size)
    print("  다른 픽셀(>4/255): %d / %d  (%.4f%%)" % (n, len(px), n / len(px) * 100))
    print("  변경 영역:", bbox if bbox else "없음")
    print("  판정:", "회귀 없음" if n == 0 else "차이 있음 — 확인 필요")
    (OUT / "skinsheet_diff.json").write_text(
        json.dumps({"diff_px": n, "total_px": len(px), "bbox": bbox},
                   ensure_ascii=False), encoding="utf-8")
    if bbox:
        diff.save(OUT / "skinsheet_diff.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
