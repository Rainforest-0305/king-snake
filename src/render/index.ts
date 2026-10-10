// render/index.ts — 렌더 오케스트레이션.
//
// ★ 그리는 «순서»가 곧 화면의 위계다:
//     [#world] 배경 → 오브 → 남의 몸 → 파티클 → 내 몸 → 모든 머리 → 비네트
//     [#glow ] 블룸 소스(먹이 코어·부스트 맥동·경계 링)만 «작은 캔버스»에 다시 그려 → 할로 가산
//     [#stage] 이름표 → 미니맵 → (터치 컨트롤·디버그는 main 이 screenCtx 로)
//   내 몸을 남의 몸보다 «나중에» 그린다. 머리는 전부 «맨 위».
//
// ═══ 2026-08-30 세 캔버스(iOS 최적화 2판) ═══════════════════════════════════════
//   #world  : 불투명 2D. «월드 DPR 상한 1.5»(WORLD_MAX_DPR) x 적응형 단계. 세계 전부. 업로드 0.
//   #glow   : 투명 WebGL(post.ts). 백킹 = 월드의 1/2. #world «위», #stage «아래», pointer-events:none.
//             블룸 대상만 담은 «작은 소스»(월드 1/2)를 같은 프레임에 그려 업로드(풀프레임 대비 1/7 이하).
//   #stage  : 입력 캔버스(«무접촉» — 크기·이벤트·레이어 라이브와 같다). 투명. 글자·미니맵·조이스틱. DPR 상한 2(글자 선명).
//   ★ DPR·캔버스 크기는 «플레이 중 절대 안 바뀐다»(main.ts 가 판 사이에서만 setScaleStep). 플레이 중 품질은
//     거버너(quality.ts)가 같은 캔버스 안에서 그리는 양만 바꾼다: T0 전부 → T1 파티클 50%·비늘/HL2 off →
//     T2 블룸 와이드 off → T3 블룸 off(불가역, 폴백 글로우). 체류 8s·회복 15s·승격 ≤2/세션·400ms 크로스페이드.

import type { World } from '../game/world';
import { Camera } from './camera';
import { drawBackground, drawVignette, invalidateBackgroundCache, setBgGlowK, drawBorderSource } from './background';
import { drawOrbs, drawOrbCores, invalidateOrbSprites } from './orbRender';
import {
  drawSnakeBody, drawSnakeHead, drawSnakeLabel, drawBoostSource, resetLabelFont, VIS_K,
  setFxLevel, setDetailAlpha, setGlowK, setBloomActive, setViewZoom, trackFrameBegin,
} from './snakeRender';
import { Particles } from './effects';
import { drawMinimap, minimapRect, type MinimapRect } from './minimap';
import { Post } from './post';
import { Governor } from './quality';
import { stats, resetStats } from './stats';
import { WORLD_R, BORDER_WARN_RATIO } from '../game/config';

/** #stage(글자·미니맵·조이스틱) DPR 상한 — 라이브와 같다. */
const MAX_DPR = 2;
/** #world(세계) DPR 상한 — iPhone DPR3 에서 백킹 1170x2532 → 585x1266 (픽셀 −75%). 글자는 #stage 라 선명하다. */
export const WORLD_MAX_DPR = 1.5;
const SCALE_STEPS = [1, 0.82, 0.68, 0.56];

export interface SafeArea { top: number; right: number; bottom: number; left: number }

function readSafeArea(): SafeArea {
  const zero: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof document === 'undefined' || !document.body) return zero;
  try {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding-top:env(safe-area-inset-top,0px);' +
      'padding-right:env(safe-area-inset-right,0px);' +
      'padding-bottom:env(safe-area-inset-bottom,0px);' +
      'padding-left:env(safe-area-inset-left,0px);';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const num = (v: string): number => {
      const n = parseFloat(v);
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const out: SafeArea = {
      top: num(cs.paddingTop),
      right: num(cs.paddingRight),
      bottom: num(cs.paddingBottom),
      left: num(cs.paddingLeft),
    };
    probe.remove();
    return out;
  } catch {
    return zero;
  }
}

export class Renderer {
  /** 입력 캔버스(#stage). 무접촉. */
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** 세계 캔버스(#world). #stage «아래». */
  readonly world: HTMLCanvasElement;
  private wctx: CanvasRenderingContext2D;
  readonly camera = new Camera();
  readonly particles = new Particles();
  readonly post = new Post();
  /** 동적 품질 거버너(히스테리시스·크로스페이드·불가역 off). 플레이 중 프레임마다 sampleFrame 으로 먹인다. */
  readonly gov = new Governor();

  /** #stage 픽셀/CSS */
  dpr = 1;
  /** #world 픽셀/CSS (≤ 1.5 x 적응형 단계) */
  worldDpr = 1;
  cssW = 1;
  cssH = 1;
  scaleStep = 0;
  safe: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };

  lastOrbsDrawn = 0;
  lastSnakesDrawn = 0;
  /** 이번 프레임에 블룸이 실제로 쓰였는가(진단·하네스). */
  bloomUsed = false;
  /** 진단: 블룸 소스·GL 캔버스 백킹 크기 */
  srcW = 0;
  srcH = 0;

  /** 화면 흔들림(충돌·사망). 렌더에만 걸린다 — 입력·판정 좌표와 무관. */
  private shakeAmp = 0;
  private shakeT = 0;

  profile = false;
  readonly times: Record<string, number> = {
    bg: 0, orbs: 0, bodies: 0, heads: 0, labels: 0, vignette: 0, mini: 0, post: 0, total: 0,
  };
  private t0 = 0;
  private mark(key: string): void {
    if (!this.profile) return;
    const now = performance.now();
    this.times[key] += ((now - this.t0) - this.times[key]) * 0.1;
    this.t0 = now;
  }

  private readonly b = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private mini: MinimapRect = { x: 0, y: 0, r: 1 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // #world — 세계 전부(불투명, desynchronized). #stage 바로 «앞»(DOM) = 화면상 «아래».
    const world = document.createElement('canvas');
    world.id = 'world';
    world.setAttribute('aria-hidden', 'true');
    world.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:0';
    const parent = canvas.parentNode;
    if (!parent) throw new Error('#stage 의 부모가 없다.');
    parent.insertBefore(world, canvas);
    const wctx = world.getContext('2d', { alpha: false, desynchronized: true });
    if (!wctx) throw new Error('2D 컨텍스트를 만들 수 없다 - 캔버스를 지원하지 않는 환경.');
    this.world = world;
    this.wctx = wctx;
    // #glow — #world 와 #stage 사이(post.init 이 #stage 앞에 끼운다 = #world 뒤).
    this.post.init(canvas);
    // #stage 는 이제 «항상 투명»(글자·미니맵·조이스틱만).
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('2D 컨텍스트를 만들 수 없다 - 캔버스를 지원하지 않는 환경.');
    this.ctx = ctx;
  }

  get bloomSupported(): boolean {
    return this.post.supported;
  }

  setScaleStep(step: number): boolean {
    const s = Math.max(0, Math.min(SCALE_STEPS.length - 1, step));
    if (s === this.scaleStep) return false;
    this.scaleStep = s;
    this.resize();
    return true;
  }

  get renderScale(): number {
    return SCALE_STEPS[this.scaleStep];
  }

  /** 플레이 중 프레임 간격(ms, dt 초) — 거버너에 넘긴다. 전환은 다음 render() 에서 동기 적용. */
  sampleFrame(ms: number, dt: number): void {
    this.gov.sample(ms, dt);
  }

  /** 거버너 상태 → 렌더 스위치(프레임마다, render() 첫머리). 캔버스 크기는 여기서 «절대» 안 건드린다. */
  private applyQuality(): void {
    const g = this.gov;
    const post = this.post;
    if (post.supported) {
      const q = g.bloomQuality();
      if (q === -1) {
        if (post.on) {
          post.autoOff = true; // T3 — 불가역
          post.setEnabled(false);
        }
      } else if (post.on) {
        post.quality = q;
        post.mix = g.bloomMix();
      }
    }
    // 폴백(가산) 글로우는 «WebGL 이 없는 기기»에만. 거버너가 부하로 끈 T3 에서는 가산 글로우·할로도 «안 그린다»
    //   (실측: 8x 스로틀에서 T3 폴백이 블룸보다 무거워 p99 가 라이브 수준으로 되돌아갔다 — 강등이 강등이 아니었다).
    const gk = post.on ? 0 : (post.supported && post.autoOff ? 0 : 1);
    setGlowK(gk);
    setBgGlowK(gk);
    const da = g.detailAlpha();
    setFxLevel(da > 0 ? 0 : 1);
    setDetailAlpha(da);
    this.particles.budget = g.particleBudget();
  }

  /** 충돌·사망 흔들림. amp = css px. */
  shake(amp: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = 0;
  }

  /**
   * 크기 갱신 — 창 크기 변화(OS) 또는 판 사이 해상도 단계 적용(main.ts)에서만 불린다.
   * CSS 크기(style)와 백킹(width/height)은 분리돼 있다: #stage 백킹 = css x min(2,DPR), #world = css x min(1.5,DPR) x 단계.
   */
  resize(): void {
    const raw = window.devicePixelRatio || 1;
    const dpr = Math.min(MAX_DPR, raw);
    const wdpr = Math.min(WORLD_MAX_DPR, raw) * SCALE_STEPS[this.scaleStep];
    const w = Math.max(1, Math.floor(window.innerWidth));
    const h = Math.max(1, Math.floor(window.innerHeight));
    const pw = Math.floor(w * dpr);
    const ph = Math.floor(h * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    const ww = Math.floor(w * wdpr);
    const wh = Math.floor(h * wdpr);
    if (this.world.width !== ww || this.world.height !== wh) {
      this.world.width = ww;
      this.world.height = wh;
      invalidateBackgroundCache();
      invalidateOrbSprites();
    }
    this.dpr = dpr;
    this.worldDpr = wdpr;
    this.srcW = Math.max(1, Math.ceil(ww / 2));
    this.srcH = Math.max(1, Math.ceil(wh / 2));
    this.cssW = w;
    this.cssH = h;
    this.camera.resize(w, h);
    this.safe = readSafeArea();
    this.mini = minimapRect(w, h, this.safe.right, this.safe.bottom);
  }

  minimapRectCss(): MinimapRect {
    return this.mini;
  }

  render(world: World, time: number, dt: number): void {
    const stage = this.ctx;
    const ctx = this.wctx;
    const cam = this.camera;
    const dpr = this.dpr;
    const wdpr = this.worldDpr;

    const tStart = this.profile ? performance.now() : 0;
    this.t0 = tStart;
    if (this.profile) resetStats();

    trackFrameBegin();
    this.applyQuality();
    const bloom = this.post.on && !this.post.lost;
    this.bloomUsed = bloom;
    // lean = «가산 할로 없이» 그린다: 블룸 on(후처리가 번짐) 또는 T3(부하 강등 — 번짐 자체를 포기). 폴백 할로는 WebGL 부재일 때만.
    const lean = bloom || this.post.autoOff;
    setBloomActive(lean);
    setViewZoom(cam.zoom);

    // 세계 캔버스 초기화(불투명 채움 = clear)
    ctx.setTransform(wdpr, 0, 0, wdpr, 0, 0);
    ctx.fillStyle = '#04060d';
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    stage.setTransform(dpr, 0, 0, dpr, 0, 0);
    stage.clearRect(0, 0, this.cssW, this.cssH);

    // 흔들림 — 감쇠하는 사인 두 개(무작위가 아니라 결정적: 픽셀 대조가 가능하다).
    let shx = 0;
    let shy = 0;
    if (this.shakeAmp > 0.2) {
      this.shakeT += dt;
      const k = this.shakeAmp * Math.exp(-this.shakeT * 7);
      shx = Math.sin(this.shakeT * 71) * k;
      shy = Math.cos(this.shakeT * 53) * k;
      if (k < 0.2) this.shakeAmp = 0;
    }

    // 월드 변환
    ctx.save();
    ctx.translate(this.cssW / 2 + shx, this.cssH / 2 + shy);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    cam.bounds(0, this.b);
    const p = world.player;
    const distC = Math.hypot(p.x, p.y);
    drawBackground(ctx, this.b, distC, time, lean);

    this.mark('bg');
    this.lastOrbsDrawn = drawOrbs(ctx, world.orbs, this.b, time, lean);
    this.mark('orbs');

    const ghostAlpha = 0.34 + 0.22 * (0.5 + 0.5 * Math.sin(time * 11));
    let drawn = 0;
    for (const s of world.snakes) {
      if (!s.alive || s.isPlayer) continue;
      const ghost = s.ghostUntil > world.time;
      if (ghost) ctx.globalAlpha = ghostAlpha;
      drawSnakeBody(ctx, s, this.b, time);
      if (ghost) ctx.globalAlpha = 1;
      drawn++;
    }
    this.particles.draw(ctx, this.b);
    if (p.alive) {
      const ghost = p.ghostUntil > world.time;
      if (ghost) ctx.globalAlpha = ghostAlpha;
      drawSnakeBody(ctx, p, this.b, time);
      if (ghost) ctx.globalAlpha = 1;
      drawn++;
    }
    this.lastSnakesDrawn = drawn;
    this.mark('bodies');

    for (const s of world.snakes) {
      if (!s.alive || s.isPlayer) continue;
      if (!this.headVisible(s.x, s.y, s.radius * VIS_K * 2.5)) { stats.culledHeads++; continue; }
      const ghost = s.ghostUntil > world.time;
      if (ghost) ctx.globalAlpha = ghostAlpha;
      drawSnakeHead(ctx, s, time);
      if (ghost) ctx.globalAlpha = 1;
    }
    if (p.alive) {
      const ghost = p.ghostUntil > world.time;
      if (ghost) ctx.globalAlpha = ghostAlpha;
      drawSnakeHead(ctx, p, time);
      if (ghost) ctx.globalAlpha = 1;
    }
    this.mark('heads');
    ctx.restore();

    // 비네트 — 세계 위(어두운 그림, 블룸과 무관).
    const warn = Math.max(0, (distC / WORLD_R - BORDER_WARN_RATIO) / (1 - BORDER_WARN_RATIO));
    drawVignette(ctx, this.cssW, this.cssH, Math.min(1, warn));
    this.mark('vignette');

    // ── 블룸 소스(작은 캔버스, «같은 프레임» — 층 간 지연 0) ─────────────────
    if (bloom) {
      const k = this.srcW / this.cssW;
      const sctx = this.post.begin(this.srcW, this.srcH, this.srcW, this.srcH, k);
      if (sctx) {
        sctx.save();
        sctx.translate(this.cssW / 2 + shx, this.cssH / 2 + shy);
        sctx.scale(cam.zoom, cam.zoom);
        sctx.translate(-cam.x, -cam.y);
        drawBorderSource(sctx, this.b, distC, time);
        drawOrbCores(sctx, world.orbs, this.b, time);
        for (const s of world.snakes) {
          if (!s.alive || !s.boosting) continue;
          if (!this.headVisible(s.x, s.y, s.radius + 60)) continue;
          drawBoostSource(sctx, s, time);
        }
        sctx.restore();
        this.post.end();
      }
      this.mark('post');
    }

    // ── 화면 좌표계(#stage) ──────────────────────────────────────────────
    const scale = Math.min(1.35, Math.max(0.8, cam.zoom * 1.15));
    resetLabelFont();
    for (const s of world.snakes) {
      if (!s.alive) continue;
      if (!this.headVisible(s.x, s.y, s.radius + 60)) continue;
      const sx = (s.x - cam.x) * cam.zoom + this.cssW / 2 + shx;
      const sy = (s.y - cam.y) * cam.zoom + this.cssH / 2 + shy - (s.radius * VIS_K * 1.5 * cam.zoom + 17);
      drawSnakeLabel(stage, sx, sy, s.name, s.style.colors[0], s.isPlayer, scale);
    }
    this.mark('labels');

    drawMinimap(stage, world, this.mini, time);
    this.mark('mini');
    if (this.profile) {
      const total = performance.now() - tStart;
      this.times.total += (total - this.times.total) * 0.1;
    }
  }

  inView(x: number, y: number, pad: number): boolean {
    return this.headVisible(x, y, pad);
  }

  private headVisible(x: number, y: number, pad: number): boolean {
    return x > this.b.x0 - pad && x < this.b.x1 + pad && y > this.b.y0 - pad && y < this.b.y1 + pad;
  }

  /** HUD/UI 가 캔버스 위에 겹쳐 그릴 수 있도록 컨텍스트를 넘긴다(화면 좌표계 보장). */
  screenCtx(): CanvasRenderingContext2D {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return this.ctx;
  }
}

export { Camera } from './camera';
