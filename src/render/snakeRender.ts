// snakeRender.ts — 뱀 그리기. 이 파일이 「기성 게임처럼 보이는가」를 결정한다.
//
// ═══ 2026-08-30 전면 재설계 (President: 「옥수수 뱀 못 생겼다. 뱀 디자인이랑 그래픽 무조건 개선」) ═══
//   기준은 slither.io 급 몸체 + 네온 스레드 파일럿에서 검증된 렌더 기법(블룸·팔레트 규율·주스).
//
//   1) 몸통 = «폭이 머리→꼬리로 자연스럽게 줄어드는 튜브».
//      · 앞 70% 는 일정 폭 «스트로크 한 줄»(round join = 관절 없는 튜브. 원 나열 ⛔).
//      · 뒤 30%(최대 120점)는 «폴리곤 한 장»으로, 폭이 1 → 0.28 로 f^1.6 곡선으로 준다.
//        시작 기울기가 0 이라 스트로크와 이음매가 «안 보인다». 끝은 반원.
//        (전에는 꼬리 22점 = 132유닛만 줄어 길이 2,800 뱀에선 «토막 난 끝»처럼 보였다.)
//   2) 원통 셰이딩(위가 밝고 아래가 어둡다) — 폭이 다른 층을 «위로 밀어» 겹친다. 비용 0.
//      외곽(가장 어두운 색, full) → 중간(0.86w, 위로 0.07w) → 코어(0.66w, 위로 0.11w) → 하이라이트 2단.
//   3) 비늘 — «오프스크린 타일 1장»을 createPattern 으로 코어 위에 «한 번» 긋는다(Q0 에서만).
//      세그먼트마다 그리지 않는다. 타일은 머리 위치에 앵커돼 몸과 «함께» 움직인다.
//   4) 무늬(rings / saddle) — 몸통은 «대시 스트로크»(호길이 위상 고정), 꼬리는 폭이 줄므로
//      «띠 단위» 짧은 스트로크(≤ 15개/마리)로 같은 위상을 잇는다. 세그먼트 단위가 아니다.
//   5) 머리 — 둥근 삼각 + 눈 2개(테·흰자·홍채·세로 동공·반사점) + 콧구멍 + 혀(날름).
//      머리 색은 몸과 «분리»한다(skins.ts head). 진행 방향으로 회전, 동공은 가려는 쪽을 본다.
//   6) 부스트 — 코어가 «밝게» 맥동한다(휘도가 블룸 문턱을 넘어 «번진다»). 파티클 트레일은 effects.ts.
//   7) 글로우 — 블룸이 켜져 있으면 캔버스 가산 글로우 스트로크를 «생략»한다(블룸이 대신한다 =
//      모바일에서 가장 비싼 가산 채우기가 사라진다). 블룸이 없을 때만 예전 가산 글로우로 폴백.
//
//   ★ 렌더 비용이 절대 조건이다(봇 56마리 x 세그먼트 수백). shadowBlur ⛔, 매 프레임 그라디언트 ⛔,
//     런타임 할당 0(스크래치 typed array). 층 수는 라이브(-12)와 같고, 블룸 on 에서는 오히려 1층 적다.
//
// ═══ 띠(대시) 위상 고정 ════════════════════════════════════════════════════
//   경로를 «머리부터» 긋고 lineDashOffset 을 머리 기준 호길이로 잡는다. 무늬가 머리에 고정된 채
//   몸을 따라 흘러간다. 화면 밖을 잘라낸 구간(run)은 그 구간의 «시작 호길이»만큼 오프셋을 민다.

// ═══ 2026-08-30 2차 패스(-14) — 「옥수수 뱀 못 생겼다. 뱀 디자인 무조건 개선」 재지시 ═══════════
//   -13 확대컷은 «가는 단색 튜브 + 얇은 줄무늬 + 몸통 굵기의 원에 점 두 개»였다. 이번 규격:
//   · 시각 반경 VIS_K(1.4) — s.radius(충돌·성장·먹기, 보호 파일)는 그대로, «그리기만» 굵다.
//   · 외곽선 OUTLINE_PX(1.5, 어둡게) + 바깥 RIM_PX(0.5, 밝게) — 화면 px 기준(viewZoom 으로 나눈다).
//   · 3층 셰이딩을 «보이게»(외곽 .55 / 중간 .22 / 하이라이트 .13·.16).
//   · 비늘 타일: 어긋난 반원 «두 줄», 진행 방향(머리 각도)으로 회전한 패턴 1회.
//   · 무늬: saddle = «둥근 얼룩»(round cap 대시, 진한 테 + 속) / rings = 띠 + (근거리) 진한 테.
//   · 머리: 몸 폭 1.42배 «달걀»(앞이 좁다) + 큰 눈(테·흰자·홍채·동공·반사점, 좌우 벌어짐) + 입선 + 콧구멍 + 혀.
//     머리 색 = 몸 바탕에서 한 단 진하게(darken .14) — 스킨별 별도 머리색 폐지(12종 같은 규칙).

import type { Snake, SnakeStyle } from '../game/snake';
import { PATH_STEP } from '../game/config';
import { rgba, lighten, darken } from './color';
import { stats } from './stats';
import { lookFor } from '../game/skins';

interface Bounds { x0: number; y0: number; x1: number; y1: number }

/** ★ 시각 반경 배수. 충돌·성장·먹기·선회는 s.radius 그대로(game/*, 보호). 그리기·이름표 오프셋만 이 배수. */
export const VIS_K = 1.4;
/** 어두운 외곽선 굵기(화면 px). 몸·꼬리·머리 전부. */
export const OUTLINE_PX = 1.5;
/** 외곽선 바깥 밝은 림(화면 px). 배경(남색)에서 몸을 «떼어낸다». */
export const RIM_PX = 0.5;
const RIM_COLOR = 'rgba(232,238,255,0.38)';
/** 외곽선 색 = 바탕을 이만큼 검게. */
const OUTLINE_DARK = 0.80;
/** 머리 색 = 바탕을 이만큼 검게(«한 단» 진하게). */
const HEAD_DARK = 0.14;
/** 코어(본색) 폭·위 오프셋. -14: 중간층을 없앴다(3층 = 아랫면 그림자 / 본색 / 하이라이트). 0.10+0.38 < 0.5 → 외곽 안. */
const CORE_W = 0.76;
const CORE_OFF = 0.10;
/** 무늬(rings) 띠 폭. */
const MID_W = 0.86;
/** 광원 오프셋(폭 대비). 중간층을 이만큼 «위»로 민다. 코어는 1.6배. 0.07*1.6+0.33 < 0.5 → 코어가 외곽 밖으로 안 나간다. */
const LIGHT_OFF = 0.07;
const EDGE_DARK = 0.55;
/** 하이라이트 [폭비율, 위 오프셋, 알파]. 둘 다 외곽 안에 머문다(0.21+0.15 / 0.09+0.21 < 0.5). */
const SPEC: readonly (readonly [number, number, number])[] = [
  [0.42, 0.15, 0.13], [0.18, 0.21, 0.16],
];
/** saddle 얼룩: 대시 길이 = band*SADDLE_FILL, 여기에 round cap(폭/2 씩)이 붙어 «둥근 얼룩»이 된다. */
const SADDLE_FILL = 0.50;
/** 얼룩 폭(몸 폭 대비). 중간층(0.86w) 안에 든다. */
const SADDLE_W = 0.78;
/** 얼룩·띠의 «진한 테» 두께(몸 폭 대비, 화면 px 하한은 코드에서). */
const PAT_INSET = 0.085;
const RING_FILL = 0.58;
/** 머리 크기 배수(시각 반지름 대비). 머리 폭 = 2·1.42·HEAD_K·r = 몸 폭의 1.42배. 충돌 판정은 s.radius 라 «규칙은 그대로». */
const HEAD_K = 1.0;
/** 꼬리 테이퍼가 차지하는 «점 비율»과 상한. */
const TAPER_FRAC = 0.30;
const TAPER_PTS = 120;
/** 꼬리 끝 폭 = 1 - TAPER_MAX. 0.28 배까지 줄인다. */
const TAPER_MAX = 0.72;
const TAPER_POW = 1.6;

/** ★ 층 마스크 — «진단 전용»(?layers=N). bit0 글로우 / bit1 (폐지: 중간층, -14) / bit2 하이라이트 / bit7 비늘 */
let layerMask = 0xff;
export function setLayerMask(m: number): void { layerMask = m; }
/** ★ 진단 전용: 몸통 O(1) 컬링 스위치. */
let bodyCull = true;
export function setBodyCull(on: boolean): void { bodyCull = on; }

/**
 * ★ 「이번 프레임에 이 뱀 몸통을 «정말로» 그렸는가」 기록 (2026-09-04, 검사 전용).
 *
 *   깜빡임은 «시간축» 현상이라 정지 스크린샷으로는 못 잡는다. 그리고 컬링
 *   조건을 검사기가 «다시 계산»해서 맞춰 보는 방식은 틀린다 — 그건 「코드가
 *   이렇게 판단했을 것이다」라는 추정이지 사실이 아니다. 그래서 실제 그리기
 *   경로 안에서 «사실»을 남긴다.
 *   기록되는 두 가지를 반드시 구분한다:
 *     drawnIds  : strokeTube 까지 간 뱀 (진짜로 픽셀이 나갔다)
 *     culledIds : bodyCull 로 조기반환된 뱀 (사라진 «이유»가 컬링임을 특정)
 *   ⇒ 프레임 N 에 drawnIds 에 있고 N+1 에 culledIds 로 옮겨갔다면 컬링이 범인이고,
 *     둘 «어디에도» 없다면 애초에 alive 가 아니거나 루프에 안 들어온 것이다.
 *
 *   ⛔운영 비용 0: track 이 false 면 push 자체를 안 한다. 켜는 곳은
 *     main.ts 의 ?debug=1 훅뿐이다.
 */
let track = false;
export const drawnIds: number[] = [];
export const culledIds: number[] = [];
export function setTrackDrawn(on: boolean): void {
  track = on;
  drawnIds.length = 0;
  culledIds.length = 0;
}
export function trackFrameBegin(): void {
  if (!track) return;
  drawnIds.length = 0;
  culledIds.length = 0;
}

/**
 * 효과 단계(렌더러의 적응형 해상도 단계와 같이 움직인다).
 *   0 = 비늘 타일 + 하이라이트 2단   1 = 하이라이트 1단   2 = 하이라이트 1단(블룸 off 는 post 가 담당)
 */
let fxLevel = 0;
export function setFxLevel(l: number): void { fxLevel = Math.max(0, Math.min(2, l | 0)); }
/** 비늘·하이라이트 2단 알파(거버너 크로스페이드 0..1). fxLevel 0 일 때만 의미 있다. */
let detailAlpha = 1;
export function setDetailAlpha(a: number): void { detailAlpha = a < 0 ? 0 : a > 1 ? 1 : a; }
/** 폴백(가산) 글로우 램프 0..1 — 블룸이 꺼진 «뒤에» 올라온다. 0 이면 글로우 스트로크를 «안 긋는다». */
let glowK = 1;
export function setGlowK(k: number): void { glowK = k < 0 ? 0 : k > 1 ? 1 : k; }
/** 블룸이 «이 프레임» 살아 있는가. 살아 있으면 가산 글로우 스트로크를 생략한다. */
let bloomActive = false;
export function setBloomActive(v: boolean): void { bloomActive = v; }
/** 현재 카메라 줌(비늘 타일을 «화면에서 보일 만큼 굵은 뱀»에만 긋는 판단용). */
let viewZoom = 1;
export function setViewZoom(z: number): void { viewZoom = z; }
/** 화면 반지름(px) 이 이 값보다 작으면 비늘을 안 긋는다 — 어차피 안 보이고 패턴 스트로크 비용만 든다. */
const SCALE_MIN_PX = 9;

const runStart: number[] = [];
const runEnd: number[] = [];
const runArc: number[] = [];

function buildRuns(s: Snake, b: Bounds, margin: number, limit: number): number {
  runStart.length = 0;
  runEnd.length = 0;
  runArc.length = 0;
  const n = Math.min(limit, s.trail.count);
  if (n < 2) return 0;
  const x0 = b.x0 - margin;
  const x1 = b.x1 + margin;
  const y0 = b.y0 - margin;
  const y1 = b.y1 + margin;
  let open = -1;
  for (let i = 0; i < n; i++) {
    const px = s.trail.x(i);
    const py = s.trail.y(i);
    const vis = px >= x0 && px <= x1 && py >= y0 && py <= y1;
    if (vis) {
      if (open < 0) open = i > 0 ? i - 1 : 0;
    } else if (open >= 0) {
      runStart.push(open);
      runEnd.push(i);
      open = -1;
    }
  }
  if (open >= 0) {
    runStart.push(open);
    runEnd.push(n - 1);
  }
  const frac = Math.hypot(s.x - s.trail.x(0), s.y - s.trail.y(0));
  for (let k = 0; k < runStart.length; k++) runArc.push(frac + runStart[k] * PATH_STEP);
  return runStart.length;
}

function pathFor(s: Snake, from: number, to: number, includeHead: boolean): Path2D {
  const p = new Path2D();
  if (includeHead) {
    p.moveTo(s.x, s.y);
    for (let i = from; i <= to; i++) p.lineTo(s.trail.x(i), s.trail.y(i));
  } else {
    p.moveTo(s.trail.x(from), s.trail.y(from));
    for (let i = from + 1; i <= to; i++) p.lineTo(s.trail.x(i), s.trail.y(i));
  }
  return p;
}

const NO_DASH: number[] = [];

/* 테이퍼 폴리곤 스크래치(할당 0회). 점 좌표 + 법선 + 폭. 미리보기도 같이 쓴다. */
export const TAPER_SCRATCH = 200;
export const tpX = new Float32Array(TAPER_SCRATCH);
export const tpY = new Float32Array(TAPER_SCRATCH);
const tpNX = new Float32Array(TAPER_SCRATCH);
const tpNY = new Float32Array(TAPER_SCRATCH);
const tpW = new Float32Array(TAPER_SCRATCH);

/** [폭비율, 위 오프셋 비율] — 몸통 층과 «같은 값»이어야 꼬리에서 색이 튀지 않는다. 0 외곽 / 1 코어 / 2·3 하이라이트 */
const TAPER_PASS: readonly (readonly [number, number])[] = [
  [1, 0], [CORE_W, CORE_OFF],
  [SPEC[0][0], SPEC[0][1]], [SPEC[1][0], SPEC[1][1]],
];
const TAPER_HL: readonly string[] = [rgba('#ffffff', SPEC[0][2]), rgba('#ffffff', SPEC[1][2])];

/** 꼬리 폭 곡선. f=0 몸통 쪽(폭 1), f=1 끝. 시작 기울기 0 → 스트로크와 매끈하게 이어진다. */
function taperProfile(f: number): number {
  return 1 - TAPER_MAX * Math.pow(f, TAPER_POW);
}

/** tpX/tpY[0..n) 의 법선·폭을 채운다. */
function prepTaper(n: number, r: number): void {
  const span = n - 1;
  for (let k = 0; k < n; k++) tpW[k] = r * taperProfile(k / span);
  for (let k = 0; k < n; k++) {
    const a = k === 0 ? 0 : k - 1;
    const c = k === n - 1 ? n - 1 : k + 1;
    let dx = tpX[c] - tpX[a];
    let dy = tpY[c] - tpY[a];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    tpNX[k] = -dy;
    tpNY[k] = dx;
  }
}

/** 폴리곤 한 장: 왼쪽 윤곽(몸통→꼬리) + 끝 반원 + 오른쪽 윤곽(꼬리→몸통). */
function taperPolygon(ctx: CanvasRenderingContext2D, n: number, wk: number, oy: number, k0: number, add = 0): void {
  const last = n - 1;
  const endAng = Math.atan2(-tpNX[last], tpNY[last]);
  ctx.beginPath();
  for (let k = k0; k < n; k++) {
    const hw = tpW[k] * wk + add;
    const x = tpX[k] + tpNX[k] * hw;
    const y = tpY[k] + tpNY[k] * hw - oy;
    if (k === k0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.arc(tpX[last], tpY[last] - oy, tpW[last] * wk + add, endAng + Math.PI / 2, endAng - Math.PI / 2, true);
  for (let k = n - 1; k >= k0; k--) {
    const hw = tpW[k] * wk + add;
    ctx.lineTo(tpX[k] - tpNX[k] * hw, tpY[k] - tpNY[k] * hw - oy);
  }
  ctx.closePath();
}

/**
 * ★ 테이퍼 본체. tpX/tpY[0..n) 에 «몸통 쪽 → 꼬리 끝» 순서로 점이 들어 있어야 한다.
 *   게임(drawSnakeBody)과 스킨 미리보기(renderSkinPreview)가 «같은 함수»를 쓴다.
 * @param tones   [외곽선, 외곽(아랫면 그림자), 바탕]
 * @param pattern 코어 위·하이라이트 아래에 무늬를 그릴 콜백(꼬리 띠).
 * @param px      화면 1px 의 월드 길이(외곽선·림 굵기용).
 * @param level   0 먼 봇(림·하이라이트 2단 생략) / 1 가까운 봇 / 2 내 뱀(전부)
 */
export function paintTaper(
  ctx: CanvasRenderingContext2D, n: number, r: number, tones: readonly string[],
  pattern?: (ctx: CanvasRenderingContext2D) => void, scales?: CanvasPattern | null, px = 1, level = 2,
): void {
  if (n < 3) return;
  const w = r * 2;
  prepTaper(n, r);
  const hlPasses = layerMask & 4 ? (level === 2 && fxLevel === 0 ? 2 : 1) : 0;
  // 림(밝음, 내 뱀만) → 외곽선(어두움): 몸통 스트로크와 같은 굵기 규칙(화면 px).
  if (level === 2) {
    ctx.fillStyle = RIM_COLOR;
    taperPolygon(ctx, n, 1, 0, 1, (OUTLINE_PX + RIM_PX) * px);
    ctx.fill();
    stats.taperFills++;
  }
  ctx.fillStyle = tones[0];
  taperPolygon(ctx, n, 1, 0, 1, OUTLINE_PX * px);
  ctx.fill();
  // 코어(1)만 k=0 에서 시작하고 나머지는 한 점 늦게 시작한다(앞 패스 시작선의 안티앨리어싱이
  // 뒤 패스 아래로 반 픽셀 비치던 문제 — 코어 시작선은 몸통 스트로크 같은 색 위라 안 보인다).
  for (let pi = 0; pi < 2; pi++) {
    const [wk, off] = TAPER_PASS[pi];
    ctx.fillStyle = tones[pi + 1];
    taperPolygon(ctx, n, wk, w * off, pi === 1 ? 0 : 1);
    ctx.fill();
  }
  stats.taperFills += 3;
  const ga = ctx.globalAlpha;
  if (scales) {
    ctx.fillStyle = scales;
    if (detailAlpha < 1) ctx.globalAlpha = ga * detailAlpha;
    taperPolygon(ctx, n, CORE_W, w * CORE_OFF, 0);
    ctx.fill();
    ctx.globalAlpha = ga;
    stats.taperFills++;
  }
  if (pattern) pattern(ctx);
  for (let pi = 2; pi < 2 + hlPasses; pi++) {
    const [wk, off] = TAPER_PASS[pi];
    ctx.fillStyle = TAPER_HL[pi - 2];
    if (pi === 3 && detailAlpha < 1) ctx.globalAlpha = ga * detailAlpha;
    taperPolygon(ctx, n, wk, w * off, 1);
    ctx.fill();
    ctx.globalAlpha = ga;
  }
  stats.taperFills += hlPasses;
}

/* ── 꼬리 «띠 단위» 무늬 ──────────────────────────────────────────────────── */

/** 호길이 s(테이퍼 시작 기준 0..)의 점을 스크래치 위에서 보간해 out 에 쓴다. */
const bp = { x: 0, y: 0, w: 0 };
function taperPointAt(sArc: number, n: number, out: { x: number; y: number; w: number }, step: number): void {
  let k = sArc / step;
  if (k <= 0) { out.x = tpX[0]; out.y = tpY[0]; out.w = tpW[0]; return; }
  if (k >= n - 1) { out.x = tpX[n - 1]; out.y = tpY[n - 1]; out.w = tpW[n - 1]; return; }
  const i = k | 0;
  k -= i;
  out.x = tpX[i] + (tpX[i + 1] - tpX[i]) * k;
  out.y = tpY[i] + (tpY[i + 1] - tpY[i]) * k;
  out.w = tpW[i] + (tpW[i + 1] - tpW[i]) * k;
}

/** 테이퍼 위 [a0, a1) 호길이 구간에 색 띠 하나. 폭은 띠의 «꼬리 쪽 끝» 몸 폭(밖으로 안 삐져나오게). */
function taperBand(
  ctx: CanvasRenderingContext2D, n: number, a0: number, a1: number, color: string, wk: number, oy: number, step: number,
  addW = 0,
): void {
  const total = (n - 1) * step;
  if (a1 <= 0 || a0 >= total) return;
  if (a0 < 0) a0 = 0;
  if (a1 > total) a1 = total;
  if (a1 - a0 < 0.5) return;
  taperPointAt(a1, n, bp, step);
  ctx.lineWidth = Math.max(0.5, bp.w * 2 * wk + addW);
  ctx.strokeStyle = color;
  ctx.beginPath();
  taperPointAt(a0, n, bp, step);
  ctx.moveTo(bp.x, bp.y - oy);
  const i0 = Math.floor(a0 / step) + 1;
  const i1 = Math.floor(a1 / step);
  for (let i = i0; i <= i1 && i < n; i++) ctx.lineTo(tpX[i], tpY[i] - oy);
  taperPointAt(a1, n, bp, step);
  ctx.lineTo(bp.x, bp.y - oy);
  ctx.stroke();
}

/**
 * 꼬리 구간의 무늬. 몸통 대시(strokeTube)와 «같은 위상 규칙»으로 띠 위치를 계산해 짧은 스트로크로 잇는다.
 * @param arcStart 테이퍼 첫 점의 «머리 기준 호길이»
 */
function taperPattern(
  ctx: CanvasRenderingContext2D, n: number, w: number, style: SnakeStyle, arcStart: number, step = PATH_STEP,
  px = 1, detail = true,
): void {
  const colors = style.colors;
  const band = Math.max(6, w * style.band);
  const total = (n - 1) * step;
  const oy = w * LIGHT_OFF;
  const ins = patInset(w, px);
  ctx.lineJoin = 'round';
  if (style.pattern === 'rings') {
    ctx.lineCap = 'butt';
    const k = colors.length;
    const period = band * k;
    const on = band * RING_FILL;
    for (let ci = 1; ci < k; ci++) {
      const base = band * ci;
      const m0 = Math.floor((arcStart - base - on) / period);
      const m1 = Math.ceil((arcStart + total - base) / period);
      const dark = detail ? darken(colors[ci], 0.55) : '';
      for (let m = m0; m <= m1; m++) {
        const s0 = base + m * period - arcStart;
        if (detail) taperBand(ctx, n, s0 - ins, s0 + on + ins, dark, MID_W, oy, step);
        taperBand(ctx, n, s0, s0 + on, colors[ci], MID_W, oy, step);
      }
    }
  } else if (style.pattern === 'saddle' && colors.length >= 3) {
    ctx.lineCap = 'round';
    const period = band * 2;
    const onB = band * SADDLE_FILL;
    const m0 = Math.floor((arcStart - onB - w) / period);
    const m1 = Math.ceil((arcStart + total) / period);
    for (let m = m0; m <= m1; m++) {
      const s0 = m * period - arcStart;
      if (detail) {
        taperBand(ctx, n, s0, s0 + onB, colors[2], SADDLE_W, oy, step);
        taperBand(ctx, n, s0, s0 + onB, colors[1], SADDLE_W, oy, step, -2 * ins);
      } else {
        taperBand(ctx, n, s0, s0 + onB, colors[1], SADDLE_W, oy, step);
      }
    }
  }
  ctx.lineCap = 'round';
}

/** 무늬 «테» 두께(월드 단위): 몸 폭 비례, 화면 1.2px 하한. */
function patInset(w: number, px: number): number {
  return Math.max(1.2 * px, w * PAT_INSET);
}

/* ── 비늘 타일 ─────────────────────────────────────────────────────────────── */

const TILE_W = 24;
const TILE_H = 20;
/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★ 2026-09-08 — 「거대 뱀 비늘이 깨진다」(President 실기기 보고)의 정체.
 *
 *   비늘은 24x20 «비트맵 한 장»이었고, 패턴 행렬로 k = r/9 배 «확대»해서 썼다.
 *   그런데 이 게임의 최대 반지름은 R_MAX = 34 다:
 *       질량 5450 → r 30.1 → k 3.35   (질량 7000 이면 k ≈ 3.5)
 *   즉 24px 짜리 원본을 3.4배로 늘려 쓴다. 1.6px 로 그은 비늘 선이 5.4px 짜리
 *   «뭉갠 띠»가 되고, 타일 주기가 80px 이라 지름 60px 몸통에 비늘이 한 줄도
 *   안 들어간다. 실측 스크린샷(_render_260908/scale_BEFORE_2_zoom.png)에서
 *   몸통을 가로지르는 «흐릿한 큰 호»로 보이는 것이 이것이다.
 *
 *   ⇒ 고치는 것은 «크기»가 아니라 «원본 해상도»다. 보이는 크기는 그대로 두고
 *     (그대로 두어야 한다 — 큰 뱀은 큰 비늘이 맞다), 그 크기에 맞는 해상도로
 *     «원본을 새로 그린다». 배율 버킷 1/2/3/4 를 미리 만들어 두고 가장 가까운
 *     것을 골라 쓰면 잔여 확대율이 1.0~1.15 로 떨어져 선이 다시 «선»이 된다.
 *
 *   ⛔ 비늘을 «없애서» 고치지 않는다. 큰 뱀에서 비늘이 사라지면 그건 수정이
 *     아니라 다른 고장이다.
 *   ★ 비용: 오프스크린 4장(24x20 … 96x80 = 합 12,320px). 만드는 건 최초 1회다.
 * ════════════════════════════════════════════════════════════════════════════
 */
const SCALE_BUCKETS = [1, 2, 3, 4] as const;
const scaleTiles = new Map<number, HTMLCanvasElement>();
const scalePatterns = new WeakMap<CanvasRenderingContext2D, Map<number, CanvasPattern | null>>();
let scaleMatrix: DOMMatrix | null = null;

/**
 * 비늘 타일. 두 줄로 엇갈린 «U 자» — 어두운 밑선 + 밝은 윗선 = 겹친 비늘.
 * @param b 해상도 배율. 기하와 선 굵기를 «둘 다» b 배로 그린다 —
 *          그래야 패턴을 1배로 깔았을 때 예전(24px 타일을 b 배 확대)과
 *          «같은 그림»이 나오고, 다른 것은 선명함뿐이다.
 */
function buildScaleTile(b: number): HTMLCanvasElement {
  const W = TILE_W * b;
  const H = TILE_H * b;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) return c;
  // 패턴은 머리 각도로 회전하므로(scalePatternFor) 반원의 볼록한 쪽(+x)이 «진행 방향»이다.
  g.lineWidth = 1.6 * b;
  g.lineCap = 'round';
  const rows: [number, number][] = [[0, 0], [W / 2, H / 2]];
  for (const [ox, oy] of rows) {
    for (let x = -W; x <= W * 2; x += W) {
      for (let y = -H; y <= H * 2; y += H) {
        const cx = x + ox + W / 4;
        const cy = y + oy;
        g.beginPath();
        g.arc(cx, cy, W * 0.30, -Math.PI * 0.42, Math.PI * 0.42);
        g.strokeStyle = 'rgba(0,0,0,0.34)';
        g.stroke();
        g.beginPath();
        g.arc(cx - 1.5 * b, cy, W * 0.30, -Math.PI * 0.36, Math.PI * 0.36);
        g.strokeStyle = 'rgba(255,255,255,0.17)';
        g.stroke();
      }
    }
  }
  return c;
}

/** 필요한 배율에 가장 가까운 버킷. 잔여 확대율을 1 근처로 유지한다. */
function scaleBucketFor(k: number): number {
  let best: number = SCALE_BUCKETS[0];
  let bestErr = Infinity;
  for (const b of SCALE_BUCKETS) {
    const err = Math.abs(Math.log(k / b));
    if (err < bestErr) {
      bestErr = err;
      best = b;
    }
  }
  return best;
}

/** ctx 별 패턴(버킷마다 하나, 캐시). 앵커·회전은 setTransform 으로 갱신(할당 0). */
function scalePatternFor(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, angle = 0): CanvasPattern | null {
  if (fxLevel !== 0 || !(layerMask & 128)) return null;
  // 타일 24px 이 반지름 9 의 몸에 «비늘 3개 폭». 이 배율은 «보이는 크기»라 유지한다.
  const k = Math.max(0.35, r / 9);
  const b = scaleBucketFor(k);
  let byBucket = scalePatterns.get(ctx);
  if (!byBucket) {
    byBucket = new Map();
    scalePatterns.set(ctx, byBucket);
  }
  let p = byBucket.get(b);
  if (p === undefined) {
    try {
      let tile = scaleTiles.get(b);
      if (!tile) {
        tile = buildScaleTile(b);
        scaleTiles.set(b, tile);
      }
      p = ctx.createPattern(tile, 'repeat');
      if (p && typeof DOMMatrix !== 'undefined' && typeof p.setTransform === 'function') {
        if (!scaleMatrix) scaleMatrix = new DOMMatrix();
      } else {
        p = null; // setTransform 없는 런타임에선 비늘을 «안 그린다»(스케일이 맞지 않는 텍스처는 노이즈다)
      }
    } catch {
      p = null;
    }
    byBucket.set(b, p);
  }
  if (!p || !scaleMatrix) return null;
  // 잔여 확대율. 버킷 덕에 0.87~1.15 사이라 «선이 선으로» 남는다(예전엔 최대 3.5).
  const s = k / b;
  const ca = Math.cos(angle) * s;
  const sa = Math.sin(angle) * s;
  scaleMatrix.a = ca; scaleMatrix.b = sa; scaleMatrix.c = -sa; scaleMatrix.d = ca;
  scaleMatrix.e = x; scaleMatrix.f = y;
  p.setTransform(scaleMatrix);
  return p;
}

/**
 * ★ 튜브 한 줄. «게임과 타이틀 미리보기가 공유하는 단일 소스»다.
 * @param w     몸통 굵기(= 지름).
 * @param arc0  경로 시작점의 «머리 기준 호길이». 무늬 위상을 머리에 고정한다.
 * @param scales 비늘 패턴(있으면 코어 위에 한 번 긋는다).
 * @param px     화면 1px 의 월드 길이(외곽선·림·무늬 테 굵기용).
 * @param level  0 먼 봇(림·무늬 테·하이라이트 2단 생략) / 1 가까운 봇(림·무늬 테) / 2 내 뱀(전부).
 *               먼 봇에서 안 읽히는 스트로크를 아낀다 — 봇 56마리 x 세그먼트 수백이 이 게임의 비용이다.
 */
export function strokeTube(
  ctx: CanvasRenderingContext2D, path: Path2D, w: number,
  style: SnakeStyle, arc0: number, boost: boolean, scales: CanvasPattern | null = null,
  px = 1, level = 2,
): void {
  const detail = level >= 1;
  const colors = style.colors;
  const base = colors[0];
  const outline = darken(base, OUTLINE_DARK);
  const edge = darken(base, EDGE_DARK);
  const band = Math.max(6, w * style.band);
  const oy = w * LIGHT_OFF;
  const ins = patInset(w, px);

  ctx.setLineDash(NO_DASH);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 1 글로우(가산) — 블룸이 없을 때만. 블룸이 있으면 밝은 코어가 알아서 번진다.
  if (layerMask & 1 && (bloomActive ? boost : glowK > 0)) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = w + (boost ? 18 : 10);
    ctx.strokeStyle = rgba(style.glow, bloomActive ? 0.16 : (boost ? 0.28 : 0.10) * glowK);
    ctx.stroke(path);
  }

  // 1b 림(밝음, 바깥 0.5px, 내 뱀만) → 1c 외곽선(어두움, 1.5px). 화면 px 기준이라 줌과 무관하게 «선»으로 남는다.
  ctx.globalCompositeOperation = 'source-over';
  if (level === 2) {
    ctx.lineWidth = w + 2 * (OUTLINE_PX + RIM_PX) * px;
    ctx.strokeStyle = RIM_COLOR;
    ctx.stroke(path);
  }
  ctx.lineWidth = w + 2 * OUTLINE_PX * px;
  ctx.strokeStyle = outline;
  ctx.stroke(path);

  // 2 외곽 — 어두운 색을 full width 로. 튜브의 아랫면(그림자). (-14: 중간층은 없앴다 — 3층 = 그림자/본색/하이라이트)
  ctx.lineWidth = w;
  ctx.strokeStyle = edge;
  ctx.stroke(path);
  stats.bodyStrokes += 3 + (level === 2 ? 1 : 0) + (scales ? 1 : 0)
    + (style.pattern === 'solid' ? 0 : style.pattern === 'rings' ? (colors.length - 1) * (detail ? 2 : 1) : (detail ? 2 : 1));

  // 4 코어 — «위로» 민다. 아래쪽 어두운 테가 두꺼워진다 = 원통. 본색.
  const coreOy = w * CORE_OFF;
  ctx.translate(0, -coreOy);
  ctx.lineWidth = w * CORE_W;
  ctx.strokeStyle = base;
  ctx.stroke(path);
  // 4b 비늘 — 같은 코어 폭으로 타일 패턴을 «한 번» 긋는다.
  if (scales) {
    ctx.strokeStyle = scales;
    if (detailAlpha < 1) {
      const ga = ctx.globalAlpha;
      ctx.globalAlpha = ga * detailAlpha;
      ctx.stroke(path);
      ctx.globalAlpha = ga;
    } else {
      ctx.stroke(path);
    }
  }

  // 5 무늬 — 종마다 «구조»가 다르다. 중간층 오프셋(등 위)에서 그린다.
  //   rings  : butt 캡 = 몸을 «두르는 띠». 근거리엔 띠 앞뒤로 진한 테(같은 대시를 조금 길게, 어둡게).
  //   saddle : round 캡 = «둥근 얼룩». 진한 테(넓게) 위에 속(좁게) — 얼룩 둘레 전체에 테가 남는다.
  if (style.pattern === 'rings') {
    ctx.lineCap = 'butt';
    const k = colors.length;
    const on = band * RING_FILL;
    const off = band * (k - RING_FILL);
    ctx.translate(0, coreOy - oy);
    ctx.lineWidth = w * MID_W;
    for (let ci = 1; ci < k; ci++) {
      if (detail) {
        ctx.setLineDash([on + 2 * ins, Math.max(2, off - 2 * ins)]);
        ctx.lineDashOffset = -(arc0 + band * ci - ins);
        ctx.strokeStyle = darken(colors[ci], 0.55);
        ctx.stroke(path);
      }
      ctx.setLineDash([on, off]);
      ctx.lineDashOffset = -(arc0 + band * ci);
      ctx.strokeStyle = colors[ci];
      ctx.stroke(path);
    }
    ctx.translate(0, oy - coreOy);
  } else if (style.pattern === 'saddle' && colors.length >= 3) {
    ctx.lineCap = 'round';
    const period = band * 2;
    const onB = band * SADDLE_FILL;
    ctx.translate(0, coreOy - oy);
    ctx.setLineDash([onB, Math.max(2, period - onB)]);
    ctx.lineDashOffset = -arc0;
    ctx.lineWidth = w * SADDLE_W;
    if (detail) {
      ctx.strokeStyle = colors[2];
      ctx.stroke(path);
      ctx.lineWidth = Math.max(0.5, w * SADDLE_W - 2 * ins);
    }
    ctx.strokeStyle = colors[1];
    ctx.stroke(path);
    ctx.translate(0, oy - coreOy);
  }
  ctx.translate(0, coreOy);

  ctx.setLineDash(NO_DASH);
  ctx.lineDashOffset = 0;
  ctx.lineCap = 'round';

  // 6 하이라이트 — «무늬 위», «위쪽으로» 얹는다. 광원이 위에 있다는 신호. source-over(가산 아님 —
  //   소프트웨어 래스터에서 가산 스트로크가 측정된 병목이었다). 부스트 중엔 한 단계 더 밝힌다.
  ctx.globalCompositeOperation = 'source-over';
  const gain = boost ? 1.8 : 1;
  const hl = layerMask & 4 ? (level === 2 && fxLevel === 0 ? SPEC.length : 1) : 0;
  for (let k = 0; k < hl; k++) {
    const dy = w * SPEC[k][1];
    ctx.translate(0, -dy);
    ctx.lineWidth = w * SPEC[k][0];
    ctx.strokeStyle = rgba('#ffffff', SPEC[k][2] * gain * (k > 0 ? detailAlpha : 1));
    ctx.stroke(path);
    ctx.translate(0, dy);
  }
  stats.bodyStrokes += hl;
}

export function drawSnakeBody(
  ctx: CanvasRenderingContext2D, s: Snake, b: Bounds, time: number,
): void {
  const r = s.radius * VIS_K;
  const w = r * 2;
  const total = s.trail.count;
  if (total < 3) return;
  const px = 1 / viewZoom;
  // 2 내 뱀(전부) / 1 가까운 봇(림·무늬 테, 화면 반지름 ≥ SCALE_MIN_PX — 비늘과 같은 문턱) / 0 먼 봇(생략).
  const level = s.isPlayer ? 2 : r * viewZoom >= SCALE_MIN_PX ? 1 : 0;

  // ★ O(1) 컬링: 몸은 머리에서 bodyLen 안에 있다. 머리가 뷰포트에서 bodyLen 보다 멀면 «한 점도» 안 보인다.
  const pad = r + 14;
  const ddx = s.x < b.x0 - pad ? b.x0 - pad - s.x : s.x > b.x1 + pad ? s.x - b.x1 - pad : 0;
  const ddy = s.y < b.y0 - pad ? b.y0 - pad - s.y : s.y > b.y1 + pad ? s.y - b.y1 - pad : 0;
  if (bodyCull && ddx * ddx + ddy * ddy > (s.bodyLen + pad) * (s.bodyLen + pad)) {
    if (track) culledIds.push(s.id);
    return;
  }
  if (track) drawnIds.push(s.id);

  const base = s.style.colors[0];
  const outline = darken(base, OUTLINE_DARK);
  const edge = darken(base, EDGE_DARK);
  const boost = s.boosting;

  const taper = Math.max(3, Math.min(TAPER_PTS, Math.floor(total * TAPER_FRAC)));
  const bodyEnd = total - taper;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';

  // 꼬리 글로우(블룸 없을 때만) — 테이퍼 «아래»에 깐다.
  if (layerMask & 1 && !bloomActive && glowK > 0 && total - bodyEnd >= 3) {
    const t0 = Math.max(0, bodyEnd - 1);
    const tx = s.trail.x(t0);
    const ty = s.trail.y(t0);
    if (tx > b.x0 - s.bodyLen && tx < b.x1 + s.bodyLen && ty > b.y0 - s.bodyLen && ty < b.y1 + s.bodyLen) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = w + (boost ? 18 : 10);
      ctx.strokeStyle = rgba(s.style.glow, (boost ? 0.28 : 0.10) * glowK);
      ctx.stroke(pathFor(s, t0, total - 1, false));
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  const scales = r * viewZoom >= SCALE_MIN_PX ? scalePatternFor(ctx, s.x, s.y, r, s.angle) : null;
  const nRuns = buildRuns(s, b, r + 12, bodyEnd);
  for (let ri = 0; ri < nRuns; ri++) {
    const from = runStart[ri];
    const to = runEnd[ri];
    if (to <= from) continue;
    const includeHead = from === 0;
    strokeTube(ctx, pathFor(s, from, to, includeHead), w, s.style,
      includeHead ? 0 : runArc[ri], boost, scales, px, level);
  }
  ctx.setLineDash(NO_DASH);

  // ★ 테이퍼는 몸통 스트로크 «뒤에»(위에) 그린다 — 폴리곤 시작폭 = 캡 반지름이라 캡이 그대로 덮인다.
  {
    const from = Math.max(0, bodyEnd - 1);
    const n = total - from;
    if (n >= 3 && n <= TAPER_SCRATCH) {
      let anyVis = false;
      for (let k = 0; k < n; k++) {
        const i = from + k;
        const px = s.trail.x(i);
        const py = s.trail.y(i);
        tpX[k] = px;
        tpY[k] = py;
        if (!anyVis && px >= b.x0 - r && px <= b.x1 + r && py >= b.y0 - r && py <= b.y1 + r) anyVis = true;
      }
      if (anyVis) {
        const frac = Math.hypot(s.x - s.trail.x(0), s.y - s.trail.y(0));
        const arcStart = frac + from * PATH_STEP;
        const style = s.style;
        // 꼬리엔 비늘 패턴을 «안» 얹는다(폴리곤 채우기 1회 절약 — 꼬리는 가늘어 어차피 안 읽힌다).
        paintTaper(ctx, n, r, [outline, edge, base],
          style.pattern === 'solid' ? undefined : (g) => taperPattern(g, n, w, style, arcStart, PATH_STEP, px, level === 2),
          null, px, level);
      }
    }
  }
  if (nRuns === 0) return;

  // 부스트 — 머리 쪽 코어가 «밝게» 맥동한다. 블룸 문턱(0.56)을 넘는 흰빛이라 «번진다».
  if (boost) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 26 + s.id);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = w * (bloomActive ? 0.55 : 0.8);
    ctx.strokeStyle = rgba(lighten(base, bloomActive ? 0.7 : 0.5), bloomActive ? 0.30 + pulse * 0.25 : 0.08 + pulse * 0.1);
    for (let ri = 0; ri < nRuns; ri++) {
      const from = runStart[ri];
      const to = Math.min(runEnd[ri], from + 30);
      if (to <= from) continue;
      ctx.stroke(pathFor(s, from, to, from === 0));
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

/**
 * 머리 윤곽 — «달걀». 뒤(목·눈 자리)가 넓고(±1.42R) 앞(주둥이)이 살짝 좁다. 뾰족한 쐐기는 «화살촉»으로 읽히니
 * 주둥이 끝은 둥글게 남긴다. 로컬 좌표: +x = 진행 방향. 길이 -1.18R ~ +1.70R.
 */
function headPath(R: number): Path2D {
  const p = new Path2D();
  p.moveTo(R * 1.70, 0);
  p.bezierCurveTo(R * 1.70, -R * 0.64, R * 0.92, -R * 1.42, -R * 0.20, -R * 1.42);
  p.bezierCurveTo(-R * 0.86, -R * 1.42, -R * 1.18, -R * 0.80, -R * 1.18, 0);
  p.bezierCurveTo(-R * 1.18, R * 0.80, -R * 0.86, R * 1.42, -R * 0.20, R * 1.42);
  p.bezierCurveTo(R * 0.92, R * 1.42, R * 1.70, R * 0.64, R * 1.70, 0);
  p.closePath();
  return p;
}

/** 봇 눈 스프라이트(64px, 1회). 앞(+x)을 보는 동공 + 반사점. 회전은 머리 변환이 한다. */
let eyeSpriteC: HTMLCanvasElement | null = null;
function eyeSprite(): HTMLCanvasElement {
  if (eyeSpriteC) return eyeSpriteC;
  const c = document.createElement('canvas');
  const S = 64;
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  eyeSpriteC = c;
  if (!g) return c;
  const cx = S / 2;
  const R1 = S / 2 - 1;        // 테(= eyeR * 1.12)
  const R0 = R1 / 1.12;        // 흰자
  g.beginPath(); g.arc(cx, cx, R1, 0, Math.PI * 2); g.fillStyle = '#1b1420'; g.fill();
  g.beginPath(); g.arc(cx, cx, R0, 0, Math.PI * 2); g.fillStyle = '#fbf8f1'; g.fill();
  const qx = cx + R0 * 0.20;
  g.beginPath(); g.ellipse(qx, cx, R0 * 0.46, R0 * 0.52, 0, 0, Math.PI * 2); g.fillStyle = '#15131d'; g.fill();
  g.beginPath(); g.arc(qx - R0 * 0.20, cx - R0 * 0.24, R0 * 0.22, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.95)'; g.fill();
  return c;
}

const headPaths = new Map<number, Path2D>();
function headPathFor(R: number): Path2D {
  // 반지름을 0.25 단위로 양자화해 캐시한다(매 프레임 Path2D 4개 x 뱀 수 할당 방지).
  const q = Math.round(R * 4) / 4;
  let p = headPaths.get(q);
  if (!p) {
    p = headPath(q);
    if (headPaths.size > 256) headPaths.clear();
    headPaths.set(q, p);
  }
  return p;
}

/**
 * ★ 머리 + 눈 + 혀. 몸통과 마찬가지로 «게임과 미리보기가 공유»한다.
 * @param look   동공 쏠림(-1..1). 가려는 쪽을 본다.
 * @param blink  1 = 뜬 눈, 0.12 = 감은 눈.
 * @param tongue 0 = 안 나옴, 0..1 = 혀 내민 정도.
 */
export function paintHead(
  ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, r: number,
  style: SnakeStyle, look: number, blink: number, tongue: number, time = 0, lod = 0, px = 1, level = 2,
): void {
  const lk = lookFor(style.colors);
  const body = style.colors[0];
  // 머리 색 = 몸 바탕에서 «한 단» 진하게. 외곽선은 몸과 같은 색(목에서 끊기지 않게).
  const base = darken(body, HEAD_DARK);
  const outline = darken(body, OUTLINE_DARK);
  const edge = darken(base, EDGE_DARK);
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const R = r * HEAD_K;

  ctx.globalCompositeOperation = 'source-over';
  ctx.setLineDash(NO_DASH);

  // ── 혀 ── 머리보다 «먼저» 그린다(뿌리가 입 안에서 나오게 머리로 덮는다). LOD 1(먼 뱀)은 생략.
  if (tongue > 0 && lod === 0) {
    const ext = Math.sin(tongue * Math.PI); // 0→1→0 : 내밀었다 거둔다
    const len = R * (1.7 + 1.5 * ext);
    const nx = -sa;
    const ny = ca;
    const bx = x + ca * R * 1.5;
    const by = y + sa * R * 1.5;
    const forkX = x + ca * len;
    const forkY = y + sa * len;
    const wig = Math.sin(time * 42) * 0.18 * ext;
    ctx.strokeStyle = '#e0475f';
    ctx.lineWidth = Math.max(1.2, r * 0.13);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(forkX, forkY);
    const fl = r * 0.5;
    ctx.moveTo(forkX, forkY);
    ctx.lineTo(forkX + ca * fl + nx * (r * 0.34 + wig * r), forkY + sa * fl + ny * (r * 0.34 + wig * r));
    ctx.moveTo(forkX, forkY);
    ctx.lineTo(forkX + ca * fl - nx * (r * 0.34 - wig * r), forkY + sa * fl - ny * (r * 0.34 - wig * r));
    ctx.stroke();
  }

  // ── 머리 ── 림(내 뱀) → 외곽선(스트로크, 화면 px) → 몸통과 «같은 2단(그림자/본색) + 같은 광원 오프셋».
  const w = r * 2;
  const hp = headPathFor(R);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.lineJoin = 'round';
  if (lod === 0 && level === 2) {
    ctx.lineWidth = 2 * (OUTLINE_PX + RIM_PX) * px;
    ctx.strokeStyle = RIM_COLOR;
    ctx.stroke(hp);
  }
  ctx.lineWidth = 2 * OUTLINE_PX * px;
  ctx.strokeStyle = outline;
  ctx.stroke(hp);
  ctx.fillStyle = edge;
  ctx.fill(hp);
  ctx.restore();
  ctx.save();
  ctx.translate(x, y - w * CORE_OFF * 0.8);
  ctx.rotate(angle);
  ctx.fillStyle = base;
  ctx.fill(headPathFor(R * 0.88));
  // ★ LOD 1 — 화면 반지름이 작은(먼) 머리: 외곽선 + 2단 채움까지만. 눈·입·광택은 어차피 픽셀 몇 개라 안 읽힌다.
  if (lod > 0) {
    ctx.restore();
    stats.headsLod++;
    return;
  }
  stats.heads++;

  // 이마 광택·입선 — 화면 반지름 9px 미만 봇은 생략(픽셀 1~2개라 안 읽힌다. 내 뱀은 항상).
  if (level === 2 || r >= 9 * px) {
    ctx.beginPath();
    ctx.ellipse(-r * 0.05, -r * 0.30, r * 0.80, r * 0.34, -0.10, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.fill();
    // 입선 — 주둥이 끝을 «두르는» 짧은 호. 이 한 줄이 «앞»을 만든다(전엔 원에 점 두 개였다).
    ctx.strokeStyle = rgba('#1a0f0c', 0.62);
    ctx.lineWidth = Math.max(1 * px, r * 0.075);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(R * 0.98, 0, R * 0.60, -0.82, 0.82);
    ctx.stroke();
  }

  const eyeR = r * 0.55;
  // ── 봇 눈 = 스프라이트 1장 x2 (테·흰자·동공·반사점 구운 것). 시선·깜빡임 없음 — 봇 33마리 x 눈 2 x 채움 6 을
  //   drawImage 2회로. 내 뱀(level 2)만 아래 벡터 눈(시선·깜빡임·홍채).
  if (level < 2) {
    const sp = eyeSprite();
    const er = eyeR * 1.12;
    ctx.drawImage(sp, r * 0.45 - er, -r * 0.80 - er, er * 2, er * 2);
    ctx.drawImage(sp, r * 0.45 - er, r * 0.80 - er, er * 2, er * 2);
    ctx.restore();
    return;
  }

  // 콧구멍 2개 — 작은 점. 입선 «위»(앞쪽).
  ctx.fillStyle = rgba('#1a0f0c', 0.55);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(R * 1.38, side * R * 0.20, Math.max(0.6, r * 0.075), 0, Math.PI * 2);
    ctx.fill();
  }

  // ── 눈 ── «어두운 테 → 흰자 → 동공 → 반사점». 크고, 좌우로 벌어져 머리 옆면에 앉는다(slither 식 — 홍채 없음:
  //   판 시작 크기(r≈9px)에서 홍채는 «색 점»으로 뭉개져 눈이 탁해졌다). 로컬 좌표(앞 = +x, 옆 = ±y). 눈 지름 ≈ 몸 폭 .55.
  for (const side of [-1, 1]) {
    const ex = r * 0.45;
    const ey = side * r * 0.80;
    ctx.beginPath();
    ctx.ellipse(ex, ey, eyeR * 1.12, eyeR * 1.12 * blink, 0, 0, Math.PI * 2);
    ctx.fillStyle = outline;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(ex, ey, eyeR, eyeR * blink, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#fbf8f1';
    ctx.fill();
    if (blink > 0.5) {
      const qx = ex + eyeR * 0.20;
      const qy = ey + look * eyeR * 0.22;
      // 동공 — 크고 둥글게(캐릭터). 세로 타원의 파충류 흔적은 «살짝»만. 알비노만 붉은 동공(종 식별).
      ctx.beginPath();
      ctx.ellipse(qx, qy, eyeR * 0.50, eyeR * 0.56, 0, 0, Math.PI * 2);
      ctx.fillStyle = lk.eye === '#ff8fa4' ? '#7a1f3a' : '#15131d';
      ctx.fill();
      // 반사점 2개(큰 것 + 작은 것). 이 점이 눈을 «젖은 것»으로 만든다.
      ctx.beginPath();
      ctx.arc(qx - eyeR * 0.20, qy - eyeR * 0.24, eyeR * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(qx + eyeR * 0.18, qy + eyeR * 0.22, eyeR * 0.09, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * 머리 + 눈 + 혀. 몸을 «전부» 그린 뒤에 부른다 — 난전에서 머리가 남의 몸에 묻히지 않게.
 */
export function drawSnakeHead(ctx: CanvasRenderingContext2D, s: Snake, time: number): void {
  // 혀는 «가끔만» 나온다. 주기가 뱀마다 다르도록 id 로 위상을 흩뿌린다.
  const flick = Math.sin(time * 1.35 + s.id * 2.7);
  const tongue = flick > 0.9 ? (flick - 0.9) / 0.1 : 0;
  let steer = s.targetAngle - s.angle;
  while (steer > Math.PI) steer -= Math.PI * 2;
  while (steer < -Math.PI) steer += Math.PI * 2;
  const look = Math.max(-1, Math.min(1, steer * 1.6));
  // 아주 가끔만 깜빡인다. 자주 깜빡이면 「고장난 애니메이션」으로 보인다.
  const blink = Math.sin(time * 0.9 + s.id * 3.1) > 0.988 ? 0.12 : 1;
  // LOD: 화면 반지름 < HEAD_LOD_PX 면 눈·혀·콧구멍 생략(먼 뱀·작은 뱀).
  //   ★ 내 뱀은 «항상» 풀 디테일 — 판 시작 직후 작을 때도 얼굴이 있어야 한다(옥수수뱀 지적의 핵심).
  const r = s.radius * VIS_K;
  paintHead(ctx, s.x, s.y, s.angle, r, s.style, look, blink, tongue, time,
    !s.isPlayer && r * viewZoom < HEAD_LOD_PX ? 1 : 0, 1 / viewZoom, s.isPlayer ? 2 : 1);
}

/** 이 «시각» 화면 반지름(px) 아래의 머리는 눈·혀를 생략한다. 봇 눈은 스프라이트 2장이라 싸다 — -13 과 같은 5.5px. */
const HEAD_LOD_PX = 5.5;

/**
 * 블룸 «소스»: 부스트 중인 뱀의 머리 쪽 30점을 밝게 한 번 긋는다(작은 소스 캔버스, 같은 프레임).
 * 세계 캔버스의 부스트 맥동과 같은 위상 — 층 간 지연 0.
 */
export function drawBoostSource(ctx: CanvasRenderingContext2D, s: Snake, time: number): void {
  const total = s.trail.count;
  if (total < 2) return;
  const pulse = 0.5 + 0.5 * Math.sin(time * 26 + s.id);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = s.radius * VIS_K * 2 * 0.62;
  ctx.strokeStyle = rgba(lighten(s.style.colors[0], 0.72), 0.55 + pulse * 0.4);
  ctx.stroke(pathFor(s, 0, Math.min(30, total - 1), true));
  stats.srcFills++;
}

/** 이름표 폰트 캐시 — 프레임마다 index.ts 가 비운다(같은 폰트면 setter 를 안 부른다: 파싱 비용 0). */
let lastFont = '';
export function resetLabelFont(): void { lastFont = ''; }

/**
 * 이름표. ★ 월드 변환이 «풀린» 상태에서(화면 좌표계) 부른다.
 */
export function drawSnakeLabel(
  ctx: CanvasRenderingContext2D, sx: number, sy: number,
  name: string, color: string, isPlayer: boolean, scale: number,
): void {
  const size = Math.max(10, Math.min(17, 13 * scale));
  const f = (isPlayer ? '700 ' : '600 ') + size + 'px ' + FONT;
  if (f !== lastFont) {
    ctx.font = f;
    lastFont = f;
    stats.fontSets++;
  }
  stats.labelTexts += 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3.5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.66)';
  ctx.strokeText(name, sx, sy);
  ctx.fillStyle = isPlayer ? '#ffffff' : rgba(lighten(color, 0.55), 0.92);
  ctx.fillText(name, sx, sy);
}

/**
 * 스킨 미리보기 — ★ «게임과 같은 렌더 코드»(strokeTube / paintTaper / paintHead)로 그린다.
 *   S 자 곡선 + 오른쪽 끝 머리(방향·종이 즉시 읽힌다) + 꼬리 테이퍼. 어두운 무대 위에 «한 번»
 *   그리므로 여기서는 블러 글로우(ctx.filter)를 써도 된다 — 매 프레임이 아니다.
 * @param W,H 캔버스 논리 해상도(px). CSS 로 «절반»으로 줄여 표시한다(2x 선명도).
 */
export function renderSkinPreview(skin: SnakeStyle, W: number, H: number, stage = true): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) return c;
  if (stage) {
    // 무대: 아레나와 같은 남색 계열, 가운데가 살짝 밝다.
    const bg = g.createRadialGradient(W * 0.5, H * 0.5, H * 0.1, W * 0.5, H * 0.5, W * 0.7);
    bg.addColorStop(0, '#182052');
    bg.addColorStop(1, '#0b0f2c');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
  }

  const w = H * 0.24; // 몸 굵기
  const xHead = W - w * 1.2;
  const xTail = w * 0.5;
  const amp = H * 0.17;
  const N = 60;
  const px: number[] = [];
  const py: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    px.push(xHead - (xHead - xTail) * t);
    py.push(H / 2 + amp * Math.sin(-0.55 + t * Math.PI * 2.7));
  }
  const style = { colors: skin.colors, glow: skin.glow, pattern: skin.pattern, band: skin.band * 0.6 };
  const bodyEnd = Math.floor(N * 0.70);

  const draw = (ctx: CanvasRenderingContext2D): void => {
    const savedBloom = bloomActive;
    const savedFx = fxLevel;
    bloomActive = true; // 가산 글로우 대신 아래 블러 글로우를 쓴다
    fxLevel = 0;
    const path = new Path2D();
    path.moveTo(px[0], py[0]);
    for (let i = 1; i <= bodyEnd; i++) path.lineTo(px[i], py[i]);
    const dir = Math.atan2(py[0] - py[1], px[0] - px[1]);
    const scales = scalePatternFor(ctx, px[0], py[0], w / 2, dir);
    // 무늬 주기를 «미리보기에서만» 0.6배로 압축(몸이 굵기의 5배 남짓이라 같은 주기면 무늬가 한 번 나온다).
    // arc0 로 반 주기 밀어 «목덜미에 무늬가 걸리는 것»을 피한다.
    const arc0 = w * style.band * 0.55;
    // 캔버스는 CSS 의 2배 해상도 → 화면 1px = 캔버스 2px.
    const ppx = 2;
    strokeTube(ctx, path, w, style, arc0, false, scales, ppx, 2);
    const base = skin.colors[0];
    const tones = [darken(base, OUTLINE_DARK), darken(base, EDGE_DARK), base];
    let tn = 0;
    for (let i = bodyEnd; i <= N && tn < TAPER_SCRATCH; i++) {
      tpX[tn] = px[i];
      tpY[tn] = py[i];
      tn++;
    }
    // 미리보기 경로는 점 간격이 PATH_STEP 이 아니다 → 띠 계산에 «실제 간격» 을 쓰도록 호길이를 맞춘다.
    const step = Math.hypot(px[1] - px[0], py[1] - py[0]);
    const arcStart = arc0 + bodyEnd * step;
    const n = tn;
    paintTaper(ctx, n, w / 2, tones,
      style.pattern === 'solid' ? undefined : (gg) => taperPattern(gg, n, w, style, arcStart, step, ppx, true),
      scales, ppx, 2);
    paintHead(ctx, px[0], py[0], dir, w / 2, skin, 0.25, 1, H >= 120 ? 0.35 : 0, 0, 0, ppx, 2);
    bloomActive = savedBloom;
    fxLevel = savedFx;
  };

  // 글로우: 뱀을 작은 오프스크린에 그려 블러한 뒤 가산. 한 번뿐이라 filter 비용이 무관하다.
  try {
    const gc = document.createElement('canvas');
    gc.width = W;
    gc.height = H;
    const gg = gc.getContext('2d');
    if (gg && 'filter' in gg) {
      draw(gg);
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.filter = 'blur(' + Math.max(3, H * 0.05).toFixed(1) + 'px)';
      g.globalAlpha = 0.55;
      g.drawImage(gc, 0, 0);
      g.restore();
    }
  } catch { /* 글로우는 장식이다 — 실패해도 본체는 그린다 */ }
  draw(g);
  return c;
}

/**
 * ★ 웹폰트를 «쓰지 않는다». 외부 네트워크 요청 0건이 스토어 제출 요건이라
 *   폰트 파일을 받아오면 그 자체로 위반이다. 시스템 폰트 스택만 쓴다.
 */
export const FONT =
  'system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo","Noto Sans JP","Hiragino Sans","Yu Gothic",Meiryo,Arial,sans-serif';
