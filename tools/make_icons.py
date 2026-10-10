# -*- coding: utf-8 -*-
"""
King Snake (뱀 키우기) - Microsoft Store / PWA icon set generator.

Deterministic, re-runnable. Regenerate with:

    python tools/make_icons.py

WHY THIS FILE EXISTS
--------------------
The game has zero raster assets (everything is drawn procedurally to canvas),
so the store icon set has to be authored in code too, same principle as the
territory-clash / prism-grid precedents this was ported from.

MOTIF (2026-08-18 재작업 — 이름/콘셉트가 Coil Rush/지렁이 → King Snake/뱀으로
확정되면서 기존 자산 전량 폐기, 아이콘도 "뱀"으로 다시 그렸다)
-----
A single coiled snake, wound ~1.6 turns as an outward Archimedean spiral from
a small inner core to a distinct head at the rim. Palette = the game's default
skin, Corn Snake (saddle pattern), pulled straight from src/game/skins.ts so
the icon and the in-game snake read as the same animal:

    src/game/skins.ts  SKINS[0] (id: 'corn')
        colors: ['#e8873f' (base), '#d0402f' (saddle spot), '#2a1409' (saddle
                 outline)], glow: '#ff9f45'

Body = base orange, dark round saddle spots down the back (NOT a striped
band — real corn-snake saddles are blotches, so this draws round patches:
a larger dark-outline disc under a smaller spot-color disc, per position).
Body outer rim = base color darkened 50% (computed in code, not hand-picked
— see darken()). Head is a wedge (narrow at the neck, widest at the jaw,
tapering to the snout), sampled from the exact bezier control points used
by the live renderer at src/render/snakeRender.ts (drawSnakeHead ->
headPath), so the icon head has the same silhouette as the head every snake
in the game actually has. Eyes are vertical-pupil (yellow iris, dark
vertical-slit pupil) using the same ratios snakeRender.ts uses for every
snake's eyes (eyeR*0.3 x eyeR*0.95). A soft orange glow halos the whole
coil. Background is a dark navy radial gradient, center -> edge, matching
the game's own background tone (src/render/background.ts).

This is an ORIGINAL composition and palette (our own corn-snake colors, our
own head geometry, ported 1:1 from our own renderer). It does not reproduce
slither.io branding, logo, or art in any form - only the generic "coiled
snake" motif.

SAFE ZONE
---------
"any" icons: content box = 82% of canvas, background bleeds full edge.
"maskable" icons: content box shrunk so every essential pixel (glow included)
sits inside the central 80% circle (radius 0.40 * size). The script MEASURES
the real content radius after rendering and hard-asserts it - see
content_radius() / the assert in main().
"""

from __future__ import annotations

import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# ─────────────────────────────────────────────────────────────────────────────
# Palette - lifted straight from src/game/skins.ts SKINS[0] ('corn', the
# game's DEFAULT_SKIN_ID) so the icon matches the snake you actually play.
# glow also matches that skin's `glow` field. Eye colors match the constants
# snakeRender.ts hardcodes for every snake ('#f7d94a' iris, '#12111c' pupil).
# ─────────────────────────────────────────────────────────────────────────────
BG_CENTER = "#141a35"
BG_EDGE = "#070a1b"

BODY_BASE = "#e8873f"       # skins.ts corn.colors[0]
SADDLE_COLOR = "#d0402f"    # skins.ts corn.colors[1]
SADDLE_OUTLINE = "#2a1409"  # skins.ts corn.colors[2]
GLOW = "#ff9f45"            # skins.ts corn.glow

EYE_IRIS = "#f7d94a"        # snakeRender.ts drawSnakeHead: '#f7d94a' (홍채)
EYE_PUPIL = "#12111c"       # snakeRender.ts drawSnakeHead: '#12111c' (동공)


def hexrgb(h: str) -> tuple[float, float, float]:
    n = int(h.lstrip("#"), 16)
    return ((n >> 16 & 255) / 255.0, (n >> 8 & 255) / 255.0, (n & 255) / 255.0)


def darken(h: str, factor: float) -> str:
    """Hex color darkened by `factor` (0..1). Used for BODY_OUTLINE so the
    outline is computed from BODY_BASE, not a second hand-picked constant."""
    r, g, b = hexrgb(h)
    r, g, b = r * (1 - factor), g * (1 - factor), b * (1 - factor)
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


BODY_OUTLINE = darken(BODY_BASE, 0.5)  # 몸통 외곽 테두리 = 바탕색 50% 어둡게

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "icons")
OUT_DIR = os.path.abspath(OUT_DIR)

# Master render resolution and mask supersampling factor (antialiasing).
M = 2048
SS = 2

SIZES_ANY = [48, 72, 96, 128, 144, 152, 192, 256, 384, 512, 600, 1024]
#                                                        ^^^
# 600 = 앱인토스 콘솔 '앱 로고' 규격(600x600 고정). Not listed in manifest.json -
# console-upload only. Pulled straight from the "any" master like the others.
SIZES_MASKABLE = [192, 512, 1024]

CONTENT_ANY = 0.82         # content box side / canvas side (matches precedent)
CONTENT_MASKABLE = 0.50    # keeps every essential pixel inside the 80% circle

# Coil geometry, in units of "content radius" (content box side * CONTENT_x / 2).
TURNS = 1.6                # 1.5~2 바퀴 규격 안
R_INNER = 0.08              # spiral start radius (near the core)
R_OUTER = 0.90               # spiral end radius (centerline reaching the head)
BODY_THICK_FRAC = 0.13      # body thickness = 13% of the ICON side (M), per spec

# Saddle spots (round back blotches, corn-snake style) along the spiral.
N_SADDLES = 9
SADDLE_OUTLINE_FRAC = 0.46   # outline disc radius, as a fraction of body thickness
SADDLE_SPOT_FRAC = 0.33      # spot disc radius (drawn on top of the outline disc)


def over(dst: np.ndarray, color, alpha) -> np.ndarray:
    a = alpha if np.isscalar(alpha) else alpha[..., None]
    c = np.asarray(color, dtype=np.float32)
    return dst * (1.0 - a) + c * a


def add(dst: np.ndarray, color, alpha) -> np.ndarray:
    a = alpha if np.isscalar(alpha) else alpha[..., None]
    c = np.asarray(color, dtype=np.float32)
    return np.clip(dst + c * a, 0.0, 1.0)


def blur(mask: np.ndarray, radius: float) -> np.ndarray:
    if radius <= 0:
        return mask
    im = Image.fromarray((np.clip(mask, 0, 1) * 255).astype(np.uint8), "L")
    im = im.filter(ImageFilter.GaussianBlur(radius))
    return np.asarray(im, np.float32) / 255.0


def spiral_points(cx: float, cy: float, r_inner: float, r_outer: float, turns: float, n: int):
    """Archimedean spiral centerline, tail at r_inner, head at r_outer."""
    pts = []
    theta_max = turns * 2.0 * math.pi
    for i in range(n + 1):
        t = i / n
        theta = t * theta_max
        r = r_inner + (r_outer - r_inner) * t
        pts.append((cx + r * math.cos(theta), cy + r * math.sin(theta)))
    return pts


def cubic_bezier(p0, c1, c2, p1, n: int):
    pts = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        x = (mt ** 3) * p0[0] + 3 * (mt ** 2) * t * c1[0] + 3 * mt * (t ** 2) * c2[0] + (t ** 3) * p1[0]
        y = (mt ** 3) * p0[1] + 3 * (mt ** 2) * t * c1[1] + 3 * mt * (t ** 2) * c2[1] + (t ** 3) * p1[1]
        pts.append((x, y))
    return pts


# Head wedge outline, in local units of R (R = 1). Copied 1:1 from the bezier
# control points in src/render/snakeRender.ts drawSnakeHead -> headPath(k):
#   moveTo(1.72, 0)
#   bezierCurveTo(1.5,-0.95, 0.45,-1.34, -0.22,-1.28)
#   bezierCurveTo(-0.86,-1.22, -1.12,-0.62, -1.12,0)
#   bezierCurveTo(-1.12,0.62, -0.86,1.22, -0.22,1.28)
#   bezierCurveTo(0.45,1.34, 1.5,0.95, 1.72,0)
# Back (neck) is narrow, jaw is the widest point, snout tapers to a point -
# this is the "쐐기" the spec calls for, not a circle.
_HEAD_SEGMENTS = [
    ((1.72, 0.0), (1.5, -0.95), (0.45, -1.34), (-0.22, -1.28)),
    ((-0.22, -1.28), (-0.86, -1.22), (-1.12, -0.62), (-1.12, 0.0)),
    ((-1.12, 0.0), (-1.12, 0.62), (-0.86, 1.22), (-0.22, 1.28)),
    ((-0.22, 1.28), (0.45, 1.34), (1.5, 0.95), (1.72, 0.0)),
]


def head_wedge_local(n_per_seg: int = 28) -> list[tuple[float, float]]:
    """Closed wedge outline in local units (R=1), forward = +x."""
    pts: list[tuple[float, float]] = []
    for p0, c1, c2, p1 in _HEAD_SEGMENTS:
        seg = cubic_bezier(p0, c1, c2, p1, n_per_seg)
        pts.extend(seg[:-1])
    return pts


def transform(pts, angle: float, scale: float, cx: float, cy: float):
    ca, sa = math.cos(angle), math.sin(angle)
    out = []
    for x, y in pts:
        x, y = x * scale, y * scale
        rx = x * ca - y * sa
        ry = x * sa + y * ca
        out.append((cx + rx, cy + ry))
    return out


class Canvas:
    """Rasterises masks at SSxSS then downsamples to M for antialiasing."""

    def _blank(self) -> tuple[Image.Image, ImageDraw.ImageDraw]:
        im = Image.new("L", (M * SS, M * SS), 0)
        return im, ImageDraw.Draw(im)

    def _fin(self, im: Image.Image) -> np.ndarray:
        return np.asarray(im.resize((M, M), Image.LANCZOS), np.float32) / 255.0

    def stroke(self, pts, width_px: float) -> np.ndarray:
        im, d = self._blank()
        w = max(1, int(round(width_px * SS)))
        xy = [(x * SS, y * SS) for x, y in pts]
        d.line(xy, fill=255, width=w, joint="curve")
        r = w / 2.0
        for (x, y) in xy:
            d.ellipse([x - r, y - r, x + r, y + r], fill=255)
        return self._fin(im)

    def disc(self, c, radius_px: float) -> np.ndarray:
        im, d = self._blank()
        x, y = c
        r = radius_px * SS
        d.ellipse([x * SS - r, y * SS - r, x * SS + r, y * SS + r], fill=255)
        return self._fin(im)

    def polygon(self, pts) -> np.ndarray:
        im, d = self._blank()
        xy = [(x * SS, y * SS) for x, y in pts]
        d.polygon(xy, fill=255)
        return self._fin(im)


def render_master(content: float) -> tuple[np.ndarray, np.ndarray]:
    """Returns (rgb float32 MxMx3, essential-content coverage mask MxM)."""
    cv_canvas = Canvas()
    cx = cy = M / 2.0
    content_l = content * M
    content_r = content_l / 2.0

    # ── background: radial gradient, center -> edge, bleeds to the full canvas
    yy, xx = np.mgrid[0:M, 0:M].astype(np.float32)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    corner = math.hypot(M / 2.0, M / 2.0)  # so the far corners hit BG_EDGE exactly
    t = np.clip(d / corner, 0.0, 1.0) ** 1.15
    c0, c1 = np.array(hexrgb(BG_CENTER), np.float32), np.array(hexrgb(BG_EDGE), np.float32)
    cv = c0[None, None, :] * (1 - t[..., None]) + c1[None, None, :] * t[..., None]

    # ── coil geometry ─────────────────────────────────────────────────────────
    r_inner_px = R_INNER * content_r
    r_outer_px = R_OUTER * content_r
    thickness = BODY_THICK_FRAC * M
    r_icon = thickness / 2.0  # analog of `s.radius` in snakeRender.ts

    pts = spiral_points(cx, cy, r_inner_px, r_outer_px, TURNS, 720)
    theta_max = TURNS * 2.0 * math.pi
    head_c = pts[-1]

    outline_mask = cv_canvas.stroke(pts, thickness * 1.34)
    body_mask = cv_canvas.stroke(pts, thickness)

    # head faces outward, tangential to the spiral at its very end - same
    # direction the original eye placement used.
    face_dx, face_dy = math.cos(theta_max + math.pi / 2), math.sin(theta_max + math.pi / 2)
    head_angle = math.atan2(face_dy, face_dx)

    head_local = head_wedge_local()
    head_rim_pts = transform(head_local, head_angle, r_icon, head_c[0], head_c[1])
    head_fill_pts = transform(head_local, head_angle, r_icon * 0.86, head_c[0], head_c[1])
    head_rim_mask = cv_canvas.polygon(head_rim_pts)
    head_fill_mask = cv_canvas.polygon(head_fill_pts)

    # saddle spots: round back blotches (NOT a striped band - real corn-snake
    # saddles are blotches). Each spot = a larger dark-outline disc with a
    # smaller spot-color disc on top, both clipped to body_mask.
    saddle_outline_mask = np.zeros((M, M), np.float32)
    saddle_spot_mask = np.zeros((M, M), np.float32)
    for i in range(1, N_SADDLES + 1):
        t = i / (N_SADDLES + 1)
        theta = t * theta_max
        r = r_inner_px + (r_outer_px - r_inner_px) * t
        px, py = cx + r * math.cos(theta), cy + r * math.sin(theta)
        saddle_outline_mask = np.maximum(
            saddle_outline_mask, cv_canvas.disc((px, py), thickness * SADDLE_OUTLINE_FRAC)
        )
        saddle_spot_mask = np.maximum(
            saddle_spot_mask, cv_canvas.disc((px, py), thickness * SADDLE_SPOT_FRAC)
        )
    saddle_outline_mask *= body_mask
    saddle_spot_mask *= body_mask

    # ── glow (drawn first, under everything) ────────────────────────────────
    coil_solid = np.clip(outline_mask + head_rim_mask, 0.0, 1.0)
    glow_soft = blur(coil_solid, M * 0.045)
    cv = add(cv, hexrgb(GLOW), glow_soft * 0.30)

    # ── outline rim, then body on top (leaves a dark rim visible) ───────────
    cv = over(cv, hexrgb(BODY_OUTLINE), outline_mask)
    cv = over(cv, hexrgb(BODY_OUTLINE), head_rim_mask)
    cv = over(cv, hexrgb(BODY_BASE), body_mask)
    cv = over(cv, hexrgb(BODY_BASE), head_fill_mask)

    # subtle inner shade on the body for volume (cheap fake-bevel, no extra mask)
    shade = blur(body_mask, thickness * 0.5) - body_mask
    cv = over(cv, (0.0, 0.0, 0.0), np.clip(-shade, 0, 1) * 0.10)

    # ── saddle spots on top of the body ──────────────────────────────────────
    cv = over(cv, hexrgb(SADDLE_OUTLINE), saddle_outline_mask)
    cv = over(cv, hexrgb(SADDLE_COLOR), saddle_spot_mask)

    # ── eyes on the head ──────────────────────────────────────────────────────
    # Local coords, same ratios as snakeRender.ts drawSnakeHead: ex=r*0.28,
    # ey=side*r*0.86, eyeR=r*0.34, pupil rx=eyeR*0.3, ry=eyeR*0.95 (vertical
    # slit - width:height ~= 0.3:0.95, the ratio the spec calls out).
    eye_ex, eye_ey = r_icon * 0.28, r_icon * 0.86
    eye_r = r_icon * 0.34
    pupil_rx, pupil_ry = eye_r * 0.3, eye_r * 0.95

    def local_to_global(lx, ly):
        gx, gy = transform([(lx, ly)], head_angle, 1.0, head_c[0], head_c[1])[0]
        return gx, gy

    eye_union = np.zeros((M, M), np.float32)
    for side in (-1, 1):
        ex, ey = local_to_global(eye_ex, side * eye_ey)
        iris_mask = cv_canvas.disc((ex, ey), eye_r)
        cv = over(cv, hexrgb(EYE_IRIS), iris_mask)

        # vertical-slit pupil: draw as a supersampled ellipse via a scaled disc
        im, dctx = cv_canvas._blank()
        bbox = [
            (ex - pupil_rx) * SS, (ey - pupil_ry) * SS,
            (ex + pupil_rx) * SS, (ey + pupil_ry) * SS,
        ]
        dctx.ellipse(bbox, fill=255)
        pupil_mask = cv_canvas._fin(im)
        cv = over(cv, hexrgb(EYE_PUPIL), pupil_mask)
        eye_union = np.maximum(eye_union, iris_mask)

    # ── essential-content coverage (for the maskable safe-zone assertion) ────
    essential = np.clip(
        outline_mask + head_rim_mask + body_mask + head_fill_mask + eye_union
        + (glow_soft > 0.08),
        0, 1,
    )
    return cv, essential


def content_radius(mask: np.ndarray, thresh: float = 0.06) -> float:
    ys, xs = np.nonzero(mask > thresh)
    if len(xs) == 0:
        return 0.0
    c = (M - 1) / 2.0
    return float(np.sqrt((xs - c) ** 2 + (ys - c) ** 2).max()) / M


def save(cv: np.ndarray, sizes, prefix: str) -> list[str]:
    master = Image.fromarray((np.clip(cv, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")
    out = []
    for s in sizes:
        im = master.resize((s, s), Image.LANCZOS)
        p = os.path.join(OUT_DIR, f"{prefix}-{s}.png")
        im.save(p, "PNG", optimize=True)
        out.append(p)
    return out


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)

    print(f"BODY_BASE={BODY_BASE} SADDLE_COLOR={SADDLE_COLOR} SADDLE_OUTLINE={SADDLE_OUTLINE}")
    print(f"BODY_OUTLINE = darken(BODY_BASE, 0.5) = {BODY_OUTLINE}")

    any_cv, _ = render_master(CONTENT_ANY)
    files = save(any_cv, SIZES_ANY, "icon")

    msk_cv, essential = render_master(CONTENT_MASKABLE)
    r = content_radius(essential)
    print(f"maskable essential-content radius = {r:.4f} x size (limit 0.4000)")
    assert r <= 0.40, f"maskable content leaves the 80% safe circle: {r:.4f}"
    files += save(msk_cv, SIZES_MASKABLE, "maskable")

    for p in files:
        print(os.path.basename(p), os.path.getsize(p))


if __name__ == "__main__":
    main()
