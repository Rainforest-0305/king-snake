// minimap.ts — 우하단 미니맵. 화면 좌표계에서 그린다(월드 변환 푼 뒤).
//
// ★ 미니맵에 «전부» 그리면 정보가 아니라 소음이다.
//   그리는 것: 내 위치(항상) + 상위 8마리(위협/기회) + 경계.
//   그리지 않는 것: 오브(수천 개라 점만 가득 찬다), 하위 봇.
//
// ★ 큰 뱀일수록 점을 크게 그린다 — 「저기 큰 놈이 있다」가 한눈에 보여야
//   피할지 노릴지 판단이 선다. 이게 미니맵의 존재 이유다.

import type { World } from '../game/world';
import { WORLD_R } from '../game/config';
import { rgba, lighten } from './color';

export interface MinimapRect { x: number; y: number; r: number }

export function minimapRect(viewW: number, viewH: number, safeR: number, safeB: number): MinimapRect {
  const r = Math.max(46, Math.min(78, Math.min(viewW, viewH) * 0.105));
  const pad = 14;
  return { x: viewW - r - pad - safeR, y: viewH - r - pad - safeB, r };
}

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  world: World,
  rect: MinimapRect,
  time: number,
): void {
  const { x: cx, y: cy, r } = rect;
  const k = r / WORLD_R;

  ctx.save();

  // 판. ★ slither.io 기준 마감(2026-08-29): 「거의 없는 HUD」.
  //   0.72 로 눌린 검은 원판 + 십자선 + 안쪽 링을 «전부 뺐다». 미니맵의 정보는
  //   점(누가 어디)과 경계(원)뿐이고, 십자선·안쪽 링은 정보가 아니라 장식이었다.
  //   원판은 점이 밝은 먹이 위에서도 읽히도록 «옅게만» 남긴다.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(4,6,13,0.34)';
  ctx.fill();

  ctx.save();
  ctx.clip();

  // 상위 8마리
  const rank = world.ranking;
  const top = Math.min(8, rank.length);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = top - 1; i >= 0; i--) {
    const s = world.snakes[rank[i]];
    if (!s.alive || s.isPlayer) continue;
    const px = cx + s.x * k;
    const py = cy + s.y * k;
    const dot = 1.6 + Math.min(3.4, s.radius * 0.1);
    ctx.beginPath();
    ctx.arc(px, py, dot, 0, Math.PI * 2);
    ctx.fillStyle = rgba(s.style.colors[0], 0.9);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // 나 — 흰 점 + 맥동 링. 어떤 색 위에서도 즉시 찾을 수 있어야 한다.
  const p = world.player;
  if (p.alive) {
    const px = cx + p.x * k;
    const py = cy + p.y * k;
    const pulse = 3.4 + 1.6 * (0.5 + 0.5 * Math.sin(time * 3.4));
    ctx.beginPath();
    ctx.arc(px, py, pulse, 0, Math.PI * 2);
    ctx.strokeStyle = rgba('#ffffff', 0.5);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    // 진행 방향
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(p.angle) * 8, py + Math.sin(p.angle) * 8);
    ctx.strokeStyle = rgba(lighten(p.style.colors[0], 0.4), 0.9);
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  ctx.restore();

  // 테두리 = 맵 경계. 가늘고 옅게 - 「여기가 끝」만 말하면 된다.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(190,210,255,0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}
