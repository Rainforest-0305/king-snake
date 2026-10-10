# -*- coding: utf-8 -*-
"""lane12_sheet.py - 레인 -12 전/후 비교 시트(PIL). 산출물: qa/lane12/COMPARE_*.png"""
from __future__ import annotations
import sys
from pathlib import Path
from PIL import Image, ImageDraw

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
L = ROOT / "qa" / "lane12"
PAD, LABEL = 16, 30


def pair(name: str, key: str, maxw: int = 900) -> Image.Image:
    a = Image.open(L / "before" / key).convert("RGB")
    b = Image.open(L / "after" / key).convert("RGB")
    k = min(1.0, maxw / a.width)
    a = a.resize((round(a.width * k), round(a.height * k)), Image.LANCZOS)
    b = b.resize((round(b.width * k), round(b.height * k)), Image.LANCZOS)
    w = a.width + b.width + PAD * 3
    h = max(a.height, b.height) + LABEL + PAD * 2
    im = Image.new("RGB", (w, h), (14, 14, 18))
    d = ImageDraw.Draw(im)
    d.text((PAD, PAD), name + "    [ BEFORE (-11) | AFTER (-12) ]", fill=(235, 235, 240))
    im.paste(a, (PAD, PAD + LABEL))
    im.paste(b, (PAD * 2 + a.width, PAD + LABEL))
    d.rectangle([PAD, PAD + LABEL, PAD + a.width, PAD + LABEL + a.height], outline=(90, 90, 96))
    d.rectangle([PAD * 2 + a.width, PAD + LABEL, PAD * 2 + a.width + b.width, PAD + LABEL + b.height], outline=(210, 150, 80))
    return im


def stack(rows: list[Image.Image]) -> Image.Image:
    w = max(r.width for r in rows)
    h = sum(r.height for r in rows)
    im = Image.new("RGB", (w, h), (14, 14, 18))
    y = 0
    for r in rows:
        im.paste(r, (0, y))
        y += r.height
    return im


def main() -> int:
    stack([pair("snake zoom x3 (player head + body)", "zoom_x3.png"),
           pair("snake zoom x3 (demo t=30, bot in view)", "zoom_bot_x3.png")]).save(L / "COMPARE_snake_zoom.png")
    stack([pair("skin sheet: 12 player skins + 12 bot palettes (same render code as game)", "skins_sheet.png", 1500)]).save(L / "COMPARE_skins_sheet.png")
    stack([pair("play t=3s 393x852 dpr2 (map 1.0x -> 2.0x)", "play_t3.png", 500),
           pair("demo t=3s", "demo_t3.png", 500),
           pair("demo t=30s", "demo_t30.png", 500)]).save(L / "COMPARE_map_screens.png")
    stack([pair("minimap x3 (map 1.0x -> 2.0x)", "minimap_x3.png", 600)]).save(L / "COMPARE_minimap.png")
    # 꼬리 확인용 크롭(after demo_t30, 화면 중앙 위쪽)
    im = Image.open(L / "after" / "demo_t30.png")
    c = im.crop((560, 1040, 1000, 1500))
    c.resize((c.width * 2, c.height * 2), Image.LANCZOS).save(L / "after" / "tail_check_x2.png")
    print("saved COMPARE_*.png + after/tail_check_x2.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
