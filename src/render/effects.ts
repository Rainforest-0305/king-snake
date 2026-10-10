// effects.ts — 파티클(주스).
//
// ★ 파티클은 «타입배열 링 버퍼»다. 객체 배열로 두면 초당 수천 개가 생겼다 사라지며
//   GC 가 주기적으로 프레임을 잡아먹는다. 배열을 한 번 잡고 «가장 오래된 것을 덮어쓴다» — 할당 0회.
//
// ═══ 2026-08-30 종류 3가지 ═══════════════════════════════════════════════════
//   0 점(dot)   : 원. 먹기·사망 잔해. 가산 합성 — 겹치면 밝아진다(블룸 문턱을 넘어 «번진다»).
//   1 스파크    : 속도 방향으로 «늘어진 선». 길이 = 속도 x 0.035s. 사망 폭발·부스트 트레일.
//   2 링(리플)  : 커지며 옅어지는 원 테. 먹기(흡수)·사망 지점.
//   흡수(absorb): 먹는 지점 «주변»에서 «안쪽으로» 모이는 점. 가치가 클수록 많다.
//   ★ 크기·개수 상한은 PARTICLE_MAX(config, 보호 파일) 그대로. 상한을 넘으면 오래된 것부터 밀린다.

import { PARTICLE_MAX } from '../game/config';
import { rgba, lighten } from './color';
import { stats } from './stats';

interface Bounds { x0: number; y0: number; x1: number; y1: number }

const KIND_DOT = 0;
const KIND_SPARK = 1;
const KIND_RING = 2;

export class Particles {
  private x = new Float32Array(PARTICLE_MAX);
  private y = new Float32Array(PARTICLE_MAX);
  private vx = new Float32Array(PARTICLE_MAX);
  private vy = new Float32Array(PARTICLE_MAX);
  private life = new Float32Array(PARTICLE_MAX);
  private maxLife = new Float32Array(PARTICLE_MAX);
  private size = new Float32Array(PARTICLE_MAX);
  private kind = new Uint8Array(PARTICLE_MAX);
  /** 감쇠 계수(초당). 흡수 파티클은 감쇠 없이 «빨려 들어간다». */
  private damp = new Float32Array(PARTICLE_MAX);
  private color: string[] = new Array(PARTICLE_MAX).fill('#fff');
  private head = 0;
  /** 발생량 배율 0..1 — 거버너 단계(T0 1 / T1 .5 / T2·T3 .25). 살아 있는 파티클은 그대로 수명을 다한다(«팝» 없음). */
  budget = 1;
  /** 활성 링 상한 — 모바일(터치) 200, 데스크톱 PARTICLE_MAX. 배열은 PARTICLE_MAX 로 잡되 «앞 cap 칸»만 쓴다(할당 0). */
  readonly cap: number = (typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0)
    ? Math.min(PARTICLE_MAX, 200) : PARTICLE_MAX;

  private emit(
    x: number, y: number, vx: number, vy: number, life: number, size: number, color: string,
    kind: number, damp: number,
  ): void {
    const i = this.head;
    this.head = this.head + 1 >= this.cap ? 0 : this.head + 1;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.color[i] = color;
    this.kind[i] = kind;
    this.damp[i] = damp;
  }

  /**
   * 오브를 먹었을 때 — «흡수». 먹는 지점 주변 링에서 안쪽으로 모이는 점 + 작은 리플.
   * 과하면 화면이 지저분해진다: 가치 1 → 3개, 가치 8 → 6개.
   */
  eat(x: number, y: number, color: string, value: number): void {
    const n = Math.round(Math.min(6, 2 + Math.floor(value / 2)) * this.budget);
    const hot = lighten(color, 0.35);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = 18 + Math.random() * 26;
      const life = 0.16 + Math.random() * 0.1;
      // 시작점에서 중심까지 life 안에 «정확히» 도착하는 속도(감쇠 0).
      const sp = d / life;
      this.emit(x + Math.cos(a) * d, y + Math.sin(a) * d, -Math.cos(a) * sp, -Math.sin(a) * sp,
        life, 1.6 + Math.random() * 1.6, hot, KIND_DOT, 0);
    }
    if (value >= 3 && this.budget >= 0.5) this.emit(x, y, 0, 0, 0.22, 6 + value * 1.2, color, KIND_RING, 0);
  }

  /** 뱀이 터졌을 때 — 점 + 스파크(스트릭) 혼합, 사방으로. 「죽였다」는 신호는 커야 한다. */
  burst(x: number, y: number, color: string, radius: number): void {
    const n = Math.round(Math.min(64, 18 + Math.round(radius * 1.3)) * this.budget);
    const hot = lighten(color, 0.55);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const spark = k % 3 === 0;
      const sp = spark ? 220 + Math.random() * 420 : 90 + Math.random() * 340;
      this.emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        spark ? 0.22 + Math.random() * 0.28 : 0.5 + Math.random() * 0.55,
        spark ? Math.max(1.2, radius * 0.12) : radius * (0.16 + Math.random() * 0.3),
        spark ? hot : color, spark ? KIND_SPARK : KIND_DOT, spark ? 2.4 : 3.2);
    }
    this.emit(x, y, 0, 0, 0.42, radius * 1.4, hot, KIND_RING, 0);
  }

  /** 부스트 잔불 — 스파크. 매 프레임 조금씩. 뒤로 «흘러 늘어진다». */
  boostSpark(x: number, y: number, angle: number, color: string, radius: number): void {
    if (this.budget < 1 && Math.random() >= this.budget) return;
    const a = angle + Math.PI + (Math.random() - 0.5) * 0.9;
    const sp = 90 + Math.random() * 160;
    const spark = Math.random() < 0.5;
    this.emit(x - Math.cos(angle) * radius * 0.6, y - Math.sin(angle) * radius * 0.6,
      Math.cos(a) * sp, Math.sin(a) * sp, 0.2 + Math.random() * 0.18,
      spark ? Math.max(1, radius * 0.14) : radius * (0.18 + Math.random() * 0.22),
      spark ? lighten(color, 0.4) : color, spark ? KIND_SPARK : KIND_DOT, 3.4);
  }

  update(dt: number): void {
    const cap = this.cap;
    for (let i = 0; i < cap; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      const d = this.damp[i];
      if (d > 0) {
        // 지수 감쇠 - 프레임레이트 무관.
        const k = Math.exp(-d * dt);
        this.vx[i] *= k;
        this.vy[i] *= k;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, b: Bounds): void {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const cap = this.cap;
    let drawn = 0;
    for (let i = 0; i < cap; i++) {
      const l = this.life[i];
      if (l <= 0) continue;
      const x = this.x[i];
      const y = this.y[i];
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
      drawn++;
      const t = l / this.maxLife[i];
      const kind = this.kind[i];
      if (kind === KIND_DOT) {
        ctx.beginPath();
        ctx.arc(x, y, this.size[i] * (0.4 + t * 0.6), 0, Math.PI * 2);
        ctx.fillStyle = rgba(this.color[i], t * 0.85);
        ctx.fill();
      } else if (kind === KIND_SPARK) {
        // 속도 방향으로 늘어진 선. 빠를수록 길다(모션 블러의 값싼 대체).
        const vx = this.vx[i];
        const vy = this.vy[i];
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - vx * 0.035, y - vy * 0.035);
        ctx.lineWidth = this.size[i] * (0.5 + t * 0.5);
        ctx.strokeStyle = rgba(this.color[i], t * 0.9);
        ctx.stroke();
      } else {
        const R = this.size[i] * (1.6 - t);
        ctx.beginPath();
        ctx.arc(x, y, R, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(1, R * 0.16);
        ctx.strokeStyle = rgba(this.color[i], t * 0.55);
        ctx.stroke();
      }
    }
    stats.particles += drawn;
    ctx.globalCompositeOperation = 'source-over';
  }

  clear(): void {
    this.life.fill(0);
  }
}
