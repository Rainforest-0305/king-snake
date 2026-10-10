# -*- coding: utf-8 -*-
"""pixdiff.py - 두 스크린샷의 픽셀 차이를 숫자로 낸다(«최적화가 화면을 바꾸지 않았다»의 증거).

  python tools/pixdiff.py <a.png> <b.png> [out_diff.png]
출력: 크기, 다른 픽셀 비율(%), 평균 절대차(0~255), 최대 절대차, 채널별 평균차.
"""
from __future__ import annotations
import sys
from pathlib import Path
from PIL import Image, ImageChops

sys.stdout.reconfigure(encoding="utf-8")


def main() -> int:
    a = Image.open(sys.argv[1]).convert("RGB")
    b = Image.open(sys.argv[2]).convert("RGB")
    if a.size != b.size:
        print("size mismatch", a.size, b.size)
        return 2
    d = ImageChops.difference(a, b)
    px = list(d.getdata())
    n = len(px)
    changed = sum(1 for p in px if p[0] > 8 or p[1] > 8 or p[2] > 8)
    mean = sum(sum(p) / 3 for p in px) / n
    mx = max(max(p) for p in px)
    print("%s vs %s" % (Path(sys.argv[1]).name, Path(sys.argv[2]).name))
    print("  size %dx%d  changed(>8) %.3f%%  meanAbs %.3f  max %d" % (a.width, a.height, 100 * changed / n, mean, mx))
    if len(sys.argv) > 3:
        d.point(lambda v: min(255, v * 4)).save(sys.argv[3])
        print("  diff image:", sys.argv[3])
    return 0


if __name__ == "__main__":
    sys.exit(main())
