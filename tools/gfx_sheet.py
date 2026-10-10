"""gfx_sheet.py - «전/후» 비교 시트를 한 장으로 만든다.

President 가 본 화면과 «같은 각도»로 나란히 놓는다. 「적용했다」가 아니라
이 장이 산출물이다.

실행: python tools/gfx_sheet.py --before before --after after
산출물: qa/gfx/COMPARE_<쌍>.png
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
GFX = ROOT / "qa" / "gfx"

PAIRS = [
    ("title_desktop", "타이틀 데스크톱 1920x1080"),
    ("play_t055", "플레이 중 1600x900 (같은 시드 / 같은 시각)"),
    ("skins", "스킨 스와치"),
    ("title_mobile", "타이틀 모바일 390x844"),
    ("play_mobile", "플레이 모바일 390x844"),
]

W = 1600  # 시트 한 칸 최대 폭
PAD = 18
LABEL_H = 34


def load(tag: str, key: str) -> Image.Image | None:
    p = GFX / f"{tag}_{key}.png"
    return Image.open(p).convert("RGB") if p.exists() else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--before", default="before")
    ap.add_argument("--after", default="after")
    args = ap.parse_args()

    rows: list[tuple[str, Image.Image, Image.Image]] = []
    for key, label in PAIRS:
        a = load(args.before, key)
        b = load(args.after, key)
        if not a or not b:
            print(f"  건너뜀(없음): {key}")
            continue
        # 두 장을 같은 높이로 맞춘다(칸 폭의 절반씩).
        half = (W - PAD * 3) // 2
        for im in (a, b):
            pass
        sa = a.resize((half, round(a.height * half / a.width)), Image.LANCZOS)
        sb = b.resize((half, round(b.height * half / b.width)), Image.LANCZOS)
        rows.append((label, sa, sb))

    if not rows:
        print("비교할 쌍이 없다.")
        return 2

    height = sum(max(a.height, b.height) + LABEL_H + PAD for _, a, b in rows) + PAD
    sheet = Image.new("RGB", (W, height), (16, 16, 18))
    d = ImageDraw.Draw(sheet)
    y = PAD
    for label, a, b in rows:
        d.text((PAD, y + 8), f"{label}    [ WAS   |   NOW ]", fill=(235, 235, 240))
        y += LABEL_H
        sheet.paste(a, (PAD, y))
        sheet.paste(b, (PAD * 2 + a.width, y))
        d.rectangle([PAD, y, PAD + a.width, y + a.height], outline=(90, 90, 96))
        d.rectangle([PAD * 2 + a.width, y, PAD * 2 + a.width + b.width, y + b.height],
                    outline=(210, 150, 80))
        y += max(a.height, b.height) + PAD

    out = GFX / f"COMPARE_{args.before}_vs_{args.after}.png"
    sheet.save(out)
    print("저장:", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
