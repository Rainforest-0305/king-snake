# -*- coding: utf-8 -*-
"""King Snake — Microsoft Store 로고 아트 3종 생성.

  poster_720x1080.png   2:3  게임 «메인 로고 이미지». MS 가 strongly recommend
  boxart_1080x1080.png  1:1  박스 아트
  tile_300x300.png      1:1  앱 타일 아이콘

★ MS 공식 제약 (05_스토어_등록정보_4종.docx 에서 확인):
  "Text overlays may appear on the bottom third of this image, so don't include
   text or key imagery there."
  -> 텍스트와 핵심 이미지는 «위 2/3» 안에만 둔다. 아래 1/3 은 배경 모티프만.

★ 팔레트는 게임에서 그대로 가져왔다(src/render/background.ts · icons/icon-512.png):
  배경 심연 네이비 #05060e -> #141a33, 뱀 주황 #e08a3c, 반점 적색 #c8392b.
  새 색을 «발명하지 않는다» — 스토어 아트가 실제 게임과 달라 보이면 안 된다.
"""
import os
import sys
import math

from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
ICON = os.path.join(PROJ, "store", "_deploy", "icons", "icon-1024.png")
OUTDIRS = [
    os.path.join(PROJ, "store", "art"),
    r"C:\Users\USER\Downloads\창업 서비스\Games for MS Store\King Snake\store",
]

NAVY_TOP = (14, 18, 44)
NAVY_BOT = (4, 5, 14)
ORANGE = (224, 138, 60)
ORANGE_HI = (247, 178, 96)
INK = (245, 246, 252)
MUTED = (150, 160, 190)

F_BLACK = r"C:\Windows\Fonts\seguibl.ttf"
F_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"
F_SEMI = r"C:\Windows\Fonts\seguisb.ttf"


def vgrad(size, top, bot):
    w, h = size
    img = Image.new("RGB", (1, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        # ease-out: 위쪽 색이 더 오래 머문다
        t = 1 - (1 - t) ** 1.6
        d.point((0, y), tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    return img.resize((w, h), Image.BICUBIC)


def radial_glow(size, cx, cy, r, color, strength=1.0):
    """중심이 밝은 부드러운 광원. 오브의 발광을 재현한다."""
    w, h = size
    lay = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(lay)
    steps = 48
    for i in range(steps):
        t = i / steps
        rr = r * (1 - t)
        a = int(255 * strength * (t ** 2.2))
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=a)
    lay = lay.filter(ImageFilter.GaussianBlur(r * 0.10))
    col = Image.new("RGB", (w, h), color)
    return col, lay


def orb_field(img, seed, count, area, rmin, rmax, alpha=120):
    """게임의 발광 오브를 배경 모티프로. ★아래 1/3 전용 - 텍스트를 넣지 않는다."""
    w, h = img.size
    x0, y0, x1, y1 = area
    st = seed
    PAL = [(96, 200, 255), (255, 214, 102), (140, 255, 180),
           (255, 140, 190), (190, 160, 255), (255, 170, 90)]
    for i in range(count):
        st = (st * 1103515245 + 12345) & 0x7FFFFFFF
        fx = x0 + (st % 100000) / 100000 * (x1 - x0)
        st = (st * 1103515245 + 12345) & 0x7FFFFFFF
        fy = y0 + (st % 100000) / 100000 * (y1 - y0)
        st = (st * 1103515245 + 12345) & 0x7FFFFFFF
        r = rmin + (st % 1000) / 1000 * (rmax - rmin)
        c = PAL[i % len(PAL)]
        col, lay = radial_glow(img.size, fx, fy, r * 3.4, c, strength=alpha / 255 * 0.5)
        img.paste(col, (0, 0), lay)
        d = ImageDraw.Draw(img)
        d.ellipse([fx - r, fy - r, fx + r, fy + r], fill=c)
    return img


def rounded_icon(px, corner_ratio=0.225, shadow=True):
    """아이콘을 스퀘어클 형태로 잘라 그림자를 붙인다(머니리그 포스터와 같은 문법)."""
    ico = Image.open(ICON).convert("RGBA").resize((px, px), Image.LANCZOS)
    r = int(px * corner_ratio)
    mask = Image.new("L", (px, px), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, px - 1, px - 1], radius=r, fill=255)
    ico.putalpha(mask)
    if not shadow:
        return ico
    pad = int(px * 0.18)
    canvas = Image.new("RGBA", (px + pad * 2, px + pad * 2), (0, 0, 0, 0))
    sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(
        [pad, pad + int(px * 0.035), pad + px - 1, pad + px - 1 + int(px * 0.035)],
        radius=r, fill=(0, 0, 0, 150))
    sh = sh.filter(ImageFilter.GaussianBlur(px * 0.055))
    canvas.alpha_composite(sh)
    canvas.alpha_composite(ico, (pad, pad))
    return canvas


def fit(draw, text, font_path, target_w, start):
    """글자가 컨테이너를 넘지 않게 실제 렌더 폭을 재서 크기를 낮춘다."""
    s = start
    while s > 8:
        f = ImageFont.truetype(font_path, s)
        if draw.textlength(text, font=f) <= target_w:
            return f
        s -= 2
    return ImageFont.truetype(font_path, 8)


def tracked(draw, xy, text, font, fill, track, anchor_center_x=None):
    """자간을 넣어 그린다. PIL 에는 letter-spacing 이 없다."""
    total = sum(draw.textlength(c, font=font) for c in text) + track * (len(text) - 1)
    x = (anchor_center_x - total / 2) if anchor_center_x is not None else xy[0]
    y = xy[1]
    for c in text:
        draw.text((x, y), c, font=font, fill=fill)
        x += draw.textlength(c, font=font) + track
    return total


def make_poster(w=720, h=1080):
    img = vgrad((w, h), NAVY_TOP, NAVY_BOT).convert("RGB")

    # 상단 주황 광원 — 아이콘 뒤에서 은은하게
    col, lay = radial_glow((w, h), w * 0.5, h * 0.235, w * 0.62, ORANGE, strength=0.30)
    img.paste(col, (0, 0), lay)

    # ★ 아래 1/3 은 모티프만 (텍스트·핵심이미지 금지)
    orb_field(img, 20260818, 26, (0, h * 0.66, w, h * 1.02), 3, 8, alpha=150)

    d = ImageDraw.Draw(img)

    # 아이콘
    ip = int(w * 0.40)
    ico = rounded_icon(ip)
    img.paste(ico, (int(w / 2 - ico.width / 2), int(h * 0.105)), ico)

    # 타이틀 — 컨테이너 폭 대비 실측해서 맞춘다(오버플로 금지)
    title = "King Snake"
    ft = fit(d, title, F_BLACK, w * 0.82, 96)
    tw = d.textlength(title, font=ft)
    ty = h * 0.435
    d.text((w / 2 - tw / 2, ty), title, font=ft, fill=INK)

    # 태그라인 — 게임의 실제 동사 3개. 마케팅 과장 없음
    fs = ImageFont.truetype(F_SEMI, 27)
    tracked(d, (0, ty + ft.size * 1.28), "EAT  ·  GROW  ·  OUTLAST", fs,
            ORANGE_HI, 3.0, anchor_center_x=w / 2)

    # 서브 — 사실 진술만
    fsub = ImageFont.truetype(F_SEMI, 20)
    tracked(d, (0, ty + ft.size * 1.28 + 44), "28 AI RIVALS  ·  OFFLINE", fsub,
            MUTED, 2.0, anchor_center_x=w / 2)

    return img


def make_boxart(w=1080, h=1080):
    img = vgrad((w, h), NAVY_TOP, NAVY_BOT).convert("RGB")
    col, lay = radial_glow((w, h), w * 0.5, h * 0.40, w * 0.60, ORANGE, strength=0.30)
    img.paste(col, (0, 0), lay)
    orb_field(img, 771, 22, (0, h * 0.68, w, h * 1.02), 4, 10, alpha=150)

    d = ImageDraw.Draw(img)
    # ★ 1:1 은 세로 여유가 없다. 아이콘·타이틀·태그라인 전부를 «위 2/3»(y<720) 안에
    #   끝내야 한다 — 첫 판에서 타이틀이 2/3 선을 넘어 가드가 잡았다.
    ip = int(w * 0.34)
    ico = rounded_icon(ip)
    img.paste(ico, (int(w / 2 - ico.width / 2), int(h * 0.075)), ico)

    title = "King Snake"
    ft = fit(d, title, F_BLACK, w * 0.78, 96)
    tw = d.textlength(title, font=ft)
    ty = h * 0.495
    d.text((w / 2 - tw / 2, ty), title, font=ft, fill=INK)

    fs = ImageFont.truetype(F_SEMI, 28)
    tracked(d, (0, ty + ft.size * 1.28), "EAT  ·  GROW  ·  OUTLAST", fs,
            ORANGE_HI, 3.4, anchor_center_x=w / 2)
    return img


def make_tile(px=300):
    img = vgrad((px, px), NAVY_TOP, NAVY_BOT).convert("RGB")
    col, lay = radial_glow((px, px), px * 0.5, px * 0.5, px * 0.72, ORANGE, strength=0.26)
    img.paste(col, (0, 0), lay)
    ico = Image.open(ICON).convert("RGBA").resize((int(px * 0.84), int(px * 0.84)), Image.LANCZOS)
    img.paste(ico, (int(px / 2 - ico.width / 2), int(px / 2 - ico.height / 2)), ico)
    return img


def bottom_third_text_guard(img, name):
    """★자동 검사: 아래 1/3 에 «밝은 글자» 가 없는지 실제 픽셀로 확인한다.
       텍스트를 아래로 흘리는 실수를 코드가 잡게 한다."""
    w, h = img.size
    band = img.crop((0, int(h * 2 / 3), w, h)).convert("L")
    px = list(band.getdata())
    bright = sum(1 for v in px if v > 200)
    ratio = bright / len(px)
    verdict = "OK" if ratio < 0.010 else "★위반 의심"
    print("   [%s] %s 아래 1/3 밝은픽셀 비율 %.4f%% (기준 <1.0%%)" % (verdict, name, ratio * 100))
    return ratio < 0.010


def main():
    for d_ in OUTDIRS:
        os.makedirs(d_, exist_ok=True)
    jobs = [("poster_720x1080.png", make_poster()),
            ("boxart_1080x1080.png", make_boxart()),
            ("tile_300x300.png", make_tile())]
    print("아이콘 원본: %s" % ICON)
    ok = True
    for name, im in jobs:
        if not name.startswith("tile"):
            ok &= bottom_third_text_guard(im, name)
        for d_ in OUTDIRS:
            p = os.path.join(d_, name)
            im.save(p, "PNG", optimize=True)
            print("   %5dx%-5d %9d B  %s" % (im.size[0], im.size[1], os.path.getsize(p), p))
    print("아래 1/3 텍스트 가드: %s" % ("전부 통과" if ok else "★실패"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
