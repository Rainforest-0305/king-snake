// background.ts — 배경·경계.
//
// ★ .io 게임의 배경은 «세 가지 일»을 한다:
//   1) 속도감  — 격자가 흘러야 내가 움직인다는 게 보인다.
//   2) 위치감  — 중심에서 멀어질수록 어두워지는 그라데이션으로 「내가 변두리에 있다」를 색으로 알려준다.
//   3) 경고    — 경계는 «죽는 선»이다. 가까워지면 눈에 띄어야 한다.
//
// ═══ 2026-08-30 «어두운 그라데이션 + 육각 그리드 + 비네트 + 경계 글로우» ════════════
//   · 아레나 텍스처(1024, 1회 굽기): 팔레트 규율 — 남색 3단(field-center/mid/edge) + 성운은 «두 색상족»
//     (인디고·틸)만. 전엔 보라·파랑·틸이 뒤섞여 «얼룩덜룩»했다. 텍스처는 문턱(0.56) «아래»라 절대 안 번진다.
//   · 격자: 정사각 → «육각». 한 프레임에 «스트로크 한 번»(경로 하나)이다. 타일 패턴 채우기(전면 텍스처
//     샘플)보다 얇은 선 래스터가 싸다 — 이 게임의 병목이 채움률이라 «전면 합성을 늘리지 않는» 쪽을 택했다.
//     꼭짓점 점은 별밭과 같은 8단 양자화 색 캐시.
//   · 경계: 밝은 링(휘도 > 문턱) → 블룸이 «글로우»를 만든다. 블룸이 없으면 예전 가산 링 폴백.
//   · 비네트: 절반 해상도로 구워 캐시(그대로). 블룸 «앞»(scene 안)에 그려 가장자리 번짐을 함께 누른다.

import { WORLD_R, BORDER_WARN_RATIO } from '../game/config';

interface Bounds { x0: number; y0: number; x1: number; y1: number }

/** 육각 셀 «외접 반지름». 정사각 190 과 비슷한 밀도. */
const HEX_R = 118;
const HEX_H = HEX_R * Math.sqrt(3) / 2; // 육각 반높이
const OUTSIDE = '#04060d';

const TEX = 1024;
let arenaTex: HTMLCanvasElement | null = null;

/** ★ 진단 전용 마스크(?layers=N). bit4 = 별밭, bit5 = 아레나 텍스처. */
let bgMask = 0xff;
/** 폴백(가산) 경계 링 램프 0..1 — 거버너가 블룸을 끈 «뒤에» 올린다. */
let bgGlowK = 1;
export function setBgGlowK(k: number): void { bgGlowK = k < 0 ? 0 : k > 1 ? 1 : k; }

export function setBackgroundMask(m: number): void {
  bgMask = m;
}
let flatGrad: CanvasGradient | null = null;

/** 시차(parallax) 별밭 두 층 — «멀리 있는 것»을 만든다. 보이는 격자칸만 훑어 점을 찍는다. */
const STAR_LAYERS: readonly { k: number; cell: number; size: number; alpha: number }[] = [
  { k: 0.42, cell: 260, size: 1.6, alpha: 0.42 },
  { k: 0.68, cell: 340, size: 2.4, alpha: 0.30 },
];
const STAR_TONE: string[][] = STAR_LAYERS.map((L) => {
  const out: string[] = [];
  for (let i = 0; i < 8; i++) {
    out.push('rgba(196,212,255,' + (L.alpha * (0.45 + (i / 8) * 0.55)).toFixed(3) + ')');
  }
  return out;
});

/** 결정적 해시. 같은 칸은 «항상 같은 별»이어야 한다. */
function hash2(ix: number, iy: number, seed: number): number {
  let h = ix * 374761393 + iy * 668265263 + seed * 2246822519;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a.toFixed(3) + ')';
}

function buildArenaTex(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TEX;
  c.height = TEX;
  const g = c.getContext('2d');
  if (!g) return c;
  const h = TEX / 2;

  // 바탕 — 중심이 밝고 가장자리로 갈수록 잠기는 «접시». DESIGN.md field-center / mid / edge.
  const base = g.createRadialGradient(h, h, 0, h, h, h);
  base.addColorStop(0, '#182052');
  base.addColorStop(0.40, '#121846');
  base.addColorStop(0.78, '#0b0f30');
  base.addColorStop(1, '#070a20');
  g.fillStyle = base;
  g.fillRect(0, 0, TEX, TEX);

  // 성운 — «두 색상족»(인디고 / 틸)만. 채도를 낮춰 뱀·먹이와 경쟁하지 않는다.
  const blobs: [number, number, number, string, number][] = [
    [0.30, 0.26, 0.32, '#3a2f8c', 0.42],
    [0.72, 0.32, 0.26, '#124a78', 0.38],
    [0.58, 0.70, 0.32, '#113c6a', 0.36],
    [0.22, 0.66, 0.24, '#3b2a78', 0.34],
    [0.48, 0.46, 0.22, '#2a3a8c', 0.34],
    [0.82, 0.62, 0.18, '#0f4f66', 0.30],
    [0.14, 0.42, 0.16, '#2b2f78', 0.28],
    [0.40, 0.86, 0.17, '#16304f', 0.26],
  ];
  g.globalCompositeOperation = 'lighter';
  for (const [bx, by, br, col, a] of blobs) {
    const gr = g.createRadialGradient(bx * TEX, by * TEX, 0, bx * TEX, by * TEX, br * TEX);
    gr.addColorStop(0, hexA(col, a));
    gr.addColorStop(0.55, hexA(col, a * 0.35));
    gr.addColorStop(1, hexA(col, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, TEX, TEX);
  }

  // 가장자리 잠금 — 맵 끝이 «떨어지는 곳»으로 읽히게. 그 직전에 «경계 광» 띠 한 겹.
  g.globalCompositeOperation = 'source-over';
  const edge = g.createRadialGradient(h, h, h * 0.62, h, h, h);
  edge.addColorStop(0, 'rgba(4,5,14,0)');
  edge.addColorStop(1, 'rgba(4,5,14,0.85)');
  g.fillStyle = edge;
  g.fillRect(0, 0, TEX, TEX);
  g.globalCompositeOperation = 'lighter';
  const rim = g.createRadialGradient(h, h, h * 0.94, h, h, h);
  rim.addColorStop(0, 'rgba(120,160,255,0)');
  rim.addColorStop(0.82, 'rgba(120,160,255,0.10)');
  rim.addColorStop(1, 'rgba(140,180,255,0.22)');
  g.fillStyle = rim;
  g.fillRect(0, 0, TEX, TEX);
  g.globalCompositeOperation = 'source-over';
  return c;
}

export function invalidateBackgroundCache(): void {
  arenaTex = null;
  flatGrad = null;
  vigKey = '';
}

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  b: Bounds,
  playerDistFromCenter: number,
  time: number,
  bloom: boolean,
): void {
  const cx = Math.max(Math.abs(b.x0), Math.abs(b.x1));
  const cy = Math.max(Math.abs(b.y0), Math.abs(b.y1));
  const fullyInside = Math.hypot(cx, cy) < WORLD_R;

  if (!fullyInside) {
    ctx.fillStyle = OUTSIDE;
    ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  }

  ctx.save();
  if (!fullyInside) {
    ctx.beginPath();
    ctx.arc(0, 0, WORLD_R, 0, Math.PI * 2);
    ctx.clip();
  }

  if (!(bgMask & 32)) {
    if (!flatGrad) {
      flatGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, WORLD_R);
      flatGrad.addColorStop(0, '#141a35');
      flatGrad.addColorStop(0.45, '#101636');
      flatGrad.addColorStop(0.82, '#0a0e26');
      flatGrad.addColorStop(1, '#070a1b');
    }
    ctx.fillStyle = flatGrad;
    ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  } else {
    if (!arenaTex) arenaTex = buildArenaTex();
    ctx.drawImage(arenaTex, -WORLD_R, -WORLD_R, WORLD_R * 2, WORLD_R * 2);
  }

  // ── 시차 별밭 ────────────────────────────────────────────────────────
  const camX = (b.x0 + b.x1) / 2;
  const camY = (b.y0 + b.y1) / 2;
  for (let li = 0; bgMask & 16 && li < STAR_LAYERS.length; li++) {
    const L = STAR_LAYERS[li];
    const ox = camX * (1 - L.k);
    const oy = camY * (1 - L.k);
    const lx0 = Math.floor((b.x0 - ox) / L.cell);
    const lx1 = Math.ceil((b.x1 - ox) / L.cell);
    const ly0 = Math.floor((b.y0 - oy) / L.cell);
    const ly1 = Math.ceil((b.y1 - oy) / L.cell);
    for (let iy = ly0; iy <= ly1; iy++) {
      for (let ix = lx0; ix <= lx1; ix++) {
        const rx = hash2(ix, iy, li + 1);
        const ry = hash2(ix, iy, li + 41);
        const rb = hash2(ix, iy, li + 97);
        const px = (ix + rx) * L.cell + ox;
        const py = (iy + ry) * L.cell + oy;
        const sz = L.size * (0.6 + rb * 0.9);
        ctx.fillStyle = STAR_TONE[li][(rb * 8) | 0];
        ctx.fillRect(px, py, sz, sz);
      }
    }
  }

  // ── 육각 격자 — 「내가 움직이고 있다」를 만드는 고정 기준. 경로 «하나»로 긋는다. ──
  //   pointy-top 육각. 열 간격 = 2*HEX_H(=√3 R), 행 간격 = 1.5 R, 홀수 행은 반 칸 밀린다.
  //   각 셀은 «위쪽 3변 + 왼쪽 위 변» 만 긋는다 — 이웃이 나머지를 그려 중복이 없다.
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = 'rgba(150,180,255,0.075)';
  ctx.beginPath();
  const rowH = HEX_R * 1.5;
  const colW = HEX_H * 2;
  const r0 = Math.floor(b.y0 / rowH) - 1;
  const r1 = Math.ceil(b.y1 / rowH) + 1;
  const c0 = Math.floor(b.x0 / colW) - 1;
  const c1 = Math.ceil(b.x1 / colW) + 1;
  for (let row = r0; row <= r1; row++) {
    const cy0 = row * rowH;
    const shift = (row & 1) ? HEX_H : 0;
    for (let col = c0; col <= c1; col++) {
      const cx0 = col * colW + shift;
      // 꼭짓점: 위(0,-R) / 오른위(H,-R/2) / 오른아래(H,R/2) / 아래(0,R) / 왼아래(-H,R/2) / 왼위(-H,-R/2)
      ctx.moveTo(cx0 - HEX_H, cy0 + HEX_R / 2);
      ctx.lineTo(cx0 - HEX_H, cy0 - HEX_R / 2);
      ctx.lineTo(cx0, cy0 - HEX_R);
      ctx.lineTo(cx0 + HEX_H, cy0 - HEX_R / 2);
      ctx.lineTo(cx0 + HEX_H, cy0 + HEX_R / 2);
    }
  }
  ctx.stroke();
  // 꼭짓점 점 — 격자만 있으면 밋밋하다. 위 꼭짓점(0,-R) 하나만 찍어도 육각 배열이 «만들어진» 공간처럼 보인다.
  ctx.fillStyle = 'rgba(165,195,255,0.13)';
  for (let row = r0; row <= r1; row++) {
    const cy0 = row * rowH;
    const shift = (row & 1) ? HEX_H : 0;
    for (let col = c0; col <= c1; col++) {
      const cx0 = col * colW + shift;
      ctx.fillRect(cx0 - 1.4, cy0 - HEX_R - 1.4, 2.8, 2.8);
      ctx.fillRect(cx0 - HEX_H - 1.4, cy0 - HEX_R / 2 - 1.4, 2.8, 2.8);
    }
  }

  ctx.restore();

  if (fullyInside) return;

  // ── 경계 링 ────────────────────────────────────────────────────────────
  const near = playerDistFromCenter / WORLD_R;
  const warn = Math.max(0, (near - BORDER_WARN_RATIO) / (1 - BORDER_WARN_RATIO));
  const pulse = 0.5 + 0.5 * Math.sin(time * 5);

  if (!bloom && bgGlowK > 0) {
    // 폴백: 가산 «넓은» 링이 글로우를 흉내낸다.
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.arc(0, 0, WORLD_R, 0, Math.PI * 2);
    ctx.lineWidth = 26;
    ctx.strokeStyle = warn > 0
      ? 'rgba(255,' + Math.round(90 - 60 * warn) + ',110,' + ((0.1 + warn * (0.16 + pulse * 0.14)) * bgGlowK).toFixed(3) + ')'
      : 'rgba(120,150,255,' + (0.10 * bgGlowK).toFixed(3) + ')';
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  // 밝은 코어 링 — 블룸이 이 선을 «번지게» 한다(휘도 > 문턱). 경고 시 붉게 맥동.
  ctx.beginPath();
  ctx.arc(0, 0, WORLD_R, 0, Math.PI * 2);
  ctx.lineWidth = bloom ? 3 : 4;
  ctx.strokeStyle = warn > 0
    ? 'rgba(255,' + Math.round(120 - 70 * warn) + ',140,' + (0.7 + warn * 0.3).toFixed(3) + ')'
    : (bloom ? 'rgba(178,200,255,' + (0.62 + pulse * 0.1).toFixed(3) + ')' : 'rgba(150,175,255,0.42)');
  ctx.stroke();

  // 경계 «바깥쪽» 빗금 — 지나가면 안 되는 곳임을 형태로 말한다.
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, WORLD_R + 150, 0, Math.PI * 2);
  ctx.arc(0, 0, WORLD_R, 0, Math.PI * 2);
  ctx.clip('evenodd');
  ctx.strokeStyle = 'rgba(255,90,120,' + (0.05 + warn * 0.12).toFixed(3) + ')';
  ctx.lineWidth = 8;
  ctx.beginPath();
  const step = 46;
  const sx0 = Math.floor((b.x0 - 200) / step) * step;
  for (let x = sx0; x < b.x1 + 400; x += step) {
    ctx.moveTo(x, b.y0 - 200);
    ctx.lineTo(x - 400, b.y1 + 200);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * 화면 좌표계 비네트. 절반 해상도로 구워 캐시(픽셀 1/4). 경고 강도는 0.1 단위로 양자화.
 */
let vigCanvas: HTMLCanvasElement | null = null;
let vigKey = '';

/**
 * 블룸 «소스»: 경계 링(밝은 코어)만 작은 소스 캔버스에 긋는다. 뷰가 아레나 안에 «완전히» 들어오면 0회.
 */
export function drawBorderSource(ctx: CanvasRenderingContext2D, b: Bounds, playerDistFromCenter: number, time: number): void {
  const far = Math.hypot(Math.max(Math.abs(b.x0), Math.abs(b.x1)), Math.max(Math.abs(b.y0), Math.abs(b.y1)));
  if (far < WORLD_R - 4) return;
  const near = playerDistFromCenter / WORLD_R;
  const warn = Math.max(0, (near - BORDER_WARN_RATIO) / (1 - BORDER_WARN_RATIO));
  const pulse = 0.5 + 0.5 * Math.sin(time * 5);
  ctx.beginPath();
  ctx.arc(0, 0, WORLD_R, 0, Math.PI * 2);
  ctx.lineWidth = 5;
  ctx.strokeStyle = warn > 0
    ? 'rgba(255,' + Math.round(120 - 70 * warn) + ',140,' + (0.7 + warn * 0.3).toFixed(3) + ')'
    : 'rgba(178,200,255,' + (0.62 + pulse * 0.1).toFixed(3) + ')';
  ctx.stroke();
}

export function drawVignette(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  warn: number,
): void {
  const bucket = Math.round(warn * 10) / 10;
  const key = w + 'x' + h + '|' + bucket;
  if (key !== vigKey || !vigCanvas) {
    const cw = Math.max(2, Math.round(w / 2));
    const ch = Math.max(2, Math.round(h / 2));
    if (!vigCanvas) vigCanvas = document.createElement('canvas');
    vigCanvas.width = cw;
    vigCanvas.height = ch;
    const g2 = vigCanvas.getContext('2d');
    if (g2) {
      g2.clearRect(0, 0, cw, ch);
      const g = g2.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.34, cw / 2, ch / 2, Math.max(cw, ch) * 0.8);
      g.addColorStop(0, 'rgba(2,3,10,0)');
      g.addColorStop(1, 'rgba(2,3,10,0.46)');
      g2.fillStyle = g;
      g2.fillRect(0, 0, cw, ch);
      if (bucket > 0.001) {
        const r = g2.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.24, cw / 2, ch / 2, Math.max(cw, ch) * 0.7);
        r.addColorStop(0, 'rgba(255,40,80,0)');
        r.addColorStop(1, 'rgba(255,40,80,' + (bucket * 0.34).toFixed(3) + ')');
        g2.fillStyle = r;
        g2.fillRect(0, 0, cw, ch);
      }
    }
    vigKey = key;
  }
  ctx.drawImage(vigCanvas, 0, 0, w, h);
}
