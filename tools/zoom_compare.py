# -*- coding: utf-8 -*-
"""zoom_compare.py - 옥수수 뱀 확대컷 x3 «-12 / -13 / -14» 나란히 1장.
   python tools/zoom_compare.py <label12> <label13> <label14> <out.png> [viewport=390x844]
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
S = ROOT / "_gfx_evidence_260830" / "shots"
l12, l13, l14, out = sys.argv[1:5]
vp = sys.argv[5] if len(sys.argv) > 5 else "390x844"

srcs = []
for lab, name in ((l12, "-12 (라이브)"), (l13, "-13 (1차)"), (l14, "-14 (2차, 이번)")):
    f = S / lab / f"{vp}_zoom_corn_x3.png"
    if not f.exists():
        f = S / lab / "375x812_zoom_corn_x3.png"
    srcs.append((name, Image.open(f).convert("RGB")))

pad = 16
label_h = 44
w = max(im.width for _, im in srcs)
h = max(im.height for _, im in srcs)
canvas = Image.new("RGB", (w * 3 + pad * 4, h + label_h + pad * 2), (12, 14, 24))
d = ImageDraw.Draw(canvas)
try:
    font = ImageFont.truetype("C:/Windows/Fonts/malgunbd.ttf", 26)
except Exception:
    font = ImageFont.load_default()
x = pad
for name, im in srcs:
    canvas.paste(im, (x, pad + label_h))
    d.text((x + 8, pad + 6), name, fill=(240, 244, 255), font=font)
    x += w + pad
canvas.save(out)
print("saved", out, canvas.size)
