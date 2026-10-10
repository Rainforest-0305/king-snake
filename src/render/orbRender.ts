// orbRender.ts — 오브 그리기.
//
// ★ 핵심 최적화: «색마다 스프라이트 한 장»을 미리 구워 두고 drawImage 만 한다.
//   화면에 오브가 200~400개 보인다. 오브마다 createRadialGradient 를 부르면 60fps 가 깨진다.
//
// ═══ 2026-08-30 «작은 광점 + 블룸» ═══════════════════════════════════════════
//   블룸이 켜져 있으면 스프라이트는 «코어만» 굽는다(할로 없음). 번짐은 후처리가 만든다.
//   → 그리는 사각형이 4.44r → 2.6r 로 줄어 오브 층의 채움률이 «66% 감소»한다(이 게임의 병목).
//   블룸이 없을 때(구형 WebView·컨텍스트 손실)만 예전처럼 할로가 구워진 스프라이트를 쓴다.
//   ⚠ 먹기 판정(orbs.rs)은 건드리지 않았다. 바뀐 것은 «그리는 크기»뿐이다.

import type { OrbField } from '../game/orbs';
import { rgba, lighten } from './color';
import { stats } from './stats';

interface Bounds { x0: number; y0: number; x1: number; y1: number }

const SPR = 128;
/** 폴백(블룸 off) 스프라이트: 코어 비율·그리기 배수는 라이브 -12 그대로. */
const CORE_RATIO = 0.36;
const CORE_DRAW_K = 0.8;
/** 블룸 스프라이트: 사각형 안에서 코어가 차지하는 비율(할로는 아주 얇게만). */
const BLOOM_CORE_RATIO = 0.62;

const halo = new Map<string, HTMLCanvasElement>();
const bright = new Map<string, HTMLCanvasElement>();

function spriteHalo(color: string): HTMLCanvasElement {
  const hit = halo.get(color);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = SPR;
  c.height = SPR;
  const g = c.getContext('2d');
  if (g) {
    const h = SPR / 2;
    const grad = g.createRadialGradient(h, h, 0, h, h, h);
    const hot = lighten(color, 0.55);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.06, hot);
    grad.addColorStop(0.16, color);
    grad.addColorStop(CORE_RATIO, color);
    grad.addColorStop(CORE_RATIO + 0.02, rgba(color, 0.55));
    grad.addColorStop(0.60, rgba(color, 0.26));
    grad.addColorStop(0.85, rgba(color, 0.07));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, SPR, SPR);
  }
  halo.set(color, c);
  return c;
}

/** 블룸용: 흰 심 + 밝은 색 코어 + 아주 얇은 색 테. 휘도가 문턱을 넘어 후처리가 «번지게» 한다. */
function spriteBright(color: string): HTMLCanvasElement {
  const hit = bright.get(color);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = SPR;
  c.height = SPR;
  const g = c.getContext('2d');
  if (g) {
    const h = SPR / 2;
    const grad = g.createRadialGradient(h, h, 0, h, h, h);
    const hot = lighten(color, 0.62);
    // 중심은 «거의 흰» 색이지 순백이 아니다 — 사망 드롭처럼 수백 개가 겹치면 순백은 블룸과 합쳐져 «하얀 덩어리»가 된다.
    grad.addColorStop(0, lighten(color, 0.86));
    grad.addColorStop(0.18, hot);
    grad.addColorStop(0.42, lighten(color, 0.18));
    grad.addColorStop(BLOOM_CORE_RATIO, color);
    grad.addColorStop(BLOOM_CORE_RATIO + 0.08, rgba(color, 0.35));
    grad.addColorStop(0.85, rgba(color, 0.08));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, SPR, SPR);
  }
  bright.set(color, c);
  return c;
}

export function invalidateOrbSprites(): void {
  halo.clear();
  bright.clear();
}

/** ★ 진단 전용 마스크(?layers=N). bit6 = 오브 층. */
let orbMask = 0xff;
export function setOrbMask(m: number): void {
  orbMask = m;
}

export function drawOrbs(
  ctx: CanvasRenderingContext2D,
  orbs: OrbField,
  b: Bounds,
  time: number,
  bloom: boolean,
): number {
  if (!(orbMask & 64)) return 0;
  ctx.globalCompositeOperation = 'lighter';
  let drawn = 0;
  const n = orbs.n;
  const table = orbs.colorTable;
  const k = bloom ? CORE_DRAW_K / BLOOM_CORE_RATIO : CORE_DRAW_K / CORE_RATIO;
  const pick = bloom ? spriteBright : spriteHalo;
  const cull = bloom ? 2 : 4;

  for (let i = 0; i < n; i++) {
    const x = orbs.xs[i];
    const y = orbs.ys[i];
    const r = orbs.rs[i];
    if (x < b.x0 - r * cull || x > b.x1 + r * cull || y < b.y0 - r * cull || y > b.y1 + r * cull) continue;
    // 맥동. 위상이 오브마다 달라 «동시에 깜빡이는» 가짜 느낌을 피한다.
    const pulse = 1 + 0.14 * Math.sin(time * 3.1 + orbs.ph[i]);
    const half = r * k * pulse;
    const img = pick(table[orbs.cs[i]] ?? '#ffffff');
    ctx.drawImage(img, x - half, y - half, half * 2, half * 2);
    drawn++;
  }
  stats.orbImages += drawn;

  ctx.globalCompositeOperation = 'source-over';
  return drawn;
}

/* ── 블룸 소스 ─────────────────────────────────────────────────────────────
 * 작은 소스 캔버스(월드 1/2)에 «먹이 코어»를 «색별로 한 경로»에 모아 fill 한다 — 색 10종 = fill ≤ 10회.
 * drawImage x N 이 아니다. 화면 밖은 건너뛴다(뷰포트+마진). 같은 프레임 안(지연 0).
 */
const srcIdx = new Int32Array(4096);
const srcColors: string[] = [];
function srcColor(table: string[], c: number): string {
  let v = srcColors[c];
  if (v === undefined || (table[c] !== undefined && !v.startsWith(table[c].slice(0, 0)))) {
    v = lighten(table[c] ?? '#ffffff', 0.55);
    srcColors[c] = v;
  }
  return v;
}

export function drawOrbCores(ctx: CanvasRenderingContext2D, orbs: OrbField, b: Bounds, time: number): void {
  const n = orbs.n;
  const xs = orbs.xs;
  const ys = orbs.ys;
  const rs = orbs.rs;
  let m = 0;
  let maxC = -1;
  for (let i = 0; i < n && m < srcIdx.length; i++) {
    const r = rs[i];
    const x = xs[i];
    const y = ys[i];
    if (x < b.x0 - r * 2 || x > b.x1 + r * 2 || y < b.y0 - r * 2 || y > b.y1 + r * 2) continue;
    srcIdx[m++] = i;
    if (orbs.cs[i] > maxC) maxC = orbs.cs[i];
  }
  if (m === 0) return;
  const table = orbs.colorTable;
  const cs = orbs.cs;
  const ph = orbs.ph;
  ctx.globalCompositeOperation = 'source-over';
  for (let c = 0; c <= maxC; c++) {
    let any = false;
    ctx.beginPath();
    for (let k = 0; k < m; k++) {
      const i = srcIdx[k];
      if (cs[i] !== c) continue;
      const x = xs[i];
      const pulse = 1 + 0.14 * Math.sin(time * 3.1 + ph[i]);
      const rr = rs[i] * 0.95 * pulse;
      ctx.moveTo(x + rr, ys[i]);
      ctx.arc(x, ys[i], rr, 0, Math.PI * 2);
      any = true;
    }
    if (!any) continue;
    ctx.fillStyle = srcColor(table, c);
    ctx.fill();
    stats.srcFills++;
  }
}
