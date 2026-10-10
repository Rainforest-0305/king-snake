// quality.ts — 동적 품질 «거버너». 2026-08-30.
//
// ★ 왜 따로 있나: 네온 스레드 -22 실기기 사고(「장애물이 계속 깜빡거려」)의 원인은 «동적 품질 토글»이었다.
//   품질 단계가 프레임 잡음을 따라 오르내리면 화면이 그 자체로 깜빡인다. 이 파일이 규칙 여섯 개를 «한 곳»에서 지킨다:
//     1) 히스테리시스 — 단계 전환 뒤 최소 체류 MIN_DWELL(8s). 승격은 «좋은 프레임» RECOVER(15s) 연속 뒤에만.
//        세션당 승격 MAX_PROMO(2)회. (한 번 흔들린 기기는 다시 올려 봐야 또 내려온다.)
//     2) 전환은 FADE(0.4s) 크로스페이드 — 비늘·하이라이트는 알파로, 블룸은 강도(mix)로 «섞어» 넘긴다.
//     3) DPR·캔버스 크기는 플레이 중 «절대» 안 바꾼다(main.ts 적응형 해상도는 판과 판 사이에서만 적용).
//        여기 단계는 전부 «같은 캔버스 크기 안에서» 그리는 양만 바꾼다.
//     4) 같은 오브젝트를 두 층에 그리지 않는다 — 블룸 → 폴백 글로우 전환은 «순차»다(블룸 0 이 된 «뒤에» 폴백이 켜진다).
//     5) bright-pass soft-knee 는 post.ts(BLOOM.knee).
//     6) T3(블룸 off)는 «불가역». 폴백은 세션 끝까지.
//
// ★ 강등 순서 — 뱀은 세그먼트가 많아 강등이 잦을 수 있다. 값싼 것부터 뺀다, 블룸은 «마지막»:
//     T0 전부(블룸 Q0·비늘·하이라이트 2단·파티클 100%)
//     T1 파티클 50%·비늘 off·하이라이트 1단      (블룸 Q0 유지)
//     T2 파티클 25%·블룸 Q1(1/4 직행)
//     T3 블룸 off(불가역)·폴백 글로우
//
// ★ 판정 창: 90프레임(≈1.5s)에서 22ms 초과가 25% 를 넘으면 «나쁜 창». 나쁜 창이 오면 (체류가 끝났을 때) 한 단 내린다.
//   좋은 창(22ms 초과 ≤ 5%)이 RECOVER 초 연속이면 (체류가 끝났고, 승격 잔여가 있고, T3 가 아니면) 한 단 올린다.
//   게임 로직·판정과 무관하다. 렌더에만 걸린다.

export type Tier = 0 | 1 | 2 | 3;

export interface QLogEntry {
  /** 세션 플레이 시각(초, 거버너가 sample 로 받은 dt 의 누적). */
  t: number;
  from: number;
  to: number;
  why: string;
  /** 기록 시 performance.now()(ms) — 하네스가 «5초 창 안 전환 횟수»를 셀 때 쓴다. */
  now: number;
}

export const GOV = {
  MIN_DWELL: 8,
  RECOVER: 15,
  MAX_PROMO: 2,
  FADE: 0.4,
  WIN: 90,
  BAD_MS: 22,
  /** 나쁜 창: 창 안 BAD_MS 초과 비율 > 이 값 */
  BAD_FRAC: 0.25,
  /** 좋은 창: 창 안 BAD_MS 초과 비율 ≤ 이 값 */
  GOOD_FRAC: 0.05,
} as const;

const PARTICLE_BUDGET: readonly number[] = [1, 0.5, 0.25, 0.25];

export class Governor {
  tier: Tier = 0;
  prevTier: Tier = 0;
  readonly log: QLogEntry[] = [];
  promotions = 0;
  /** false 면 판정하지 않는다(하네스가 «순수 비용»을 잴 때). 크로스페이드·조회는 그대로 동작. */
  watch = true;
  /** 누적 플레이 시각(초). */
  clock = 0;
  /** 마지막 전환 뒤 경과(초). 시작값 0 = 판 시작도 «체류»로 센다(첫 강등도 MIN_DWELL 뒤에만). */
  sinceChange = 0;
  private goodFor = 0;
  private win = new Float32Array(GOV.WIN);
  private wi = 0;
  private wn = 0;

  /** 새 판: 창·회복 누적만 비운다. 단계·승격 횟수·로그는 «세션» 것이라 유지한다. */
  resetWindow(): void {
    this.wi = 0;
    this.wn = 0;
    this.goodFor = 0;
  }

  /** 하네스 전용: 단계를 강제로 놓는다(로그에 남긴다). */
  force(t: Tier, why = 'force'): void {
    this.transition(t, why);
  }

  private transition(to: Tier, why: string): void {
    if (to === this.tier) return;
    const from = this.tier;
    this.prevTier = from;
    this.tier = to;
    this.sinceChange = 0;
    this.goodFor = 0;
    this.wn = 0;
    this.wi = 0;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    this.log.push({ t: Math.round(this.clock * 100) / 100, from, to, why, now });
    try { console.info('[king-snake/quality] T' + from + ' -> T' + to + ' (' + why + ')'); } catch { /* noop */ }
  }

  /**
   * «플레이 중» 프레임마다 한 번. ms = 프레임 간격, dt = 초.
   * 전환은 여기서만 일어난다(렌더 루프 안, 동기).
   */
  sample(ms: number, dt: number): void {
    this.clock += dt;
    this.sinceChange += dt;
    if (!this.watch) return;
    this.win[this.wi] = ms;
    this.wi = (this.wi + 1) % GOV.WIN;
    if (this.wn < GOV.WIN) this.wn++;
    if (this.wn < GOV.WIN) return;
    // 창이 찼다 — 판정하고 창을 비운다(겹치는 창은 같은 잡음을 두 번 센다).
    this.wn = 0;
    this.wi = 0;
    let bad = 0;
    for (let i = 0; i < GOV.WIN; i++) if (this.win[i] > GOV.BAD_MS) bad++;
    const frac = bad / GOV.WIN;
    let sum = 0;
    for (let i = 0; i < GOV.WIN; i++) sum += this.win[i];
    const winSec = sum / 1000;

    if (frac > GOV.BAD_FRAC) {
      this.goodFor = 0;
      if (this.sinceChange < GOV.MIN_DWELL) return; // 체류 중 — 참는다
      if (this.tier < 3) this.transition((this.tier + 1) as Tier, 'bad ' + bad + '/' + GOV.WIN + ' >' + GOV.BAD_MS + 'ms');
      return;
    }
    if (frac <= GOV.GOOD_FRAC) {
      this.goodFor += winSec;
    } else {
      this.goodFor = 0;
      return;
    }
    if (this.tier === 0 || this.tier === 3) return; // 올릴 데 없음 / 불가역
    if (this.goodFor < GOV.RECOVER) return;
    if (this.sinceChange < GOV.MIN_DWELL) return;
    if (this.promotions >= GOV.MAX_PROMO) return;
    this.promotions++;
    this.transition((this.tier - 1) as Tier, 'good ' + Math.round(this.goodFor) + 's (promo ' + this.promotions + '/' + GOV.MAX_PROMO + ')');
  }

  /** 크로스페이드 진행 0→1 (FADE 초). */
  get xf(): number {
    if (this.tier === this.prevTier) return 1; // 전환 이력 없음(세션 시작) — 페이드 없음
    const x = this.sinceChange / GOV.FADE;
    return x >= 1 ? 1 : x <= 0 ? 0 : x;
  }

  /** 비늘·하이라이트 2단 알파(T0 에서만 1, 전환 중엔 섞인다). */
  detailAlpha(): number {
    const x = this.xf;
    if (this.tier === 0) return this.prevTier === 0 ? 1 : x;
    return this.prevTier === 0 ? 1 - x : 0;
  }

  particleBudget(): number {
    return PARTICLE_BUDGET[this.tier];
  }

  /** 블룸 파이프라인 단계 — 크로스페이드 중간(xf ≥ .5)에서 바꾼다. T3 는 off(-1). */
  private static q(t: Tier): 0 | 1 | -1 {
    return t <= 1 ? 0 : t === 2 ? 1 : -1;
  }

  /** 지금 프레임의 블룸 파이프라인(0/1) 또는 -1(off). */
  bloomQuality(): 0 | 1 | -1 {
    const cur = Governor.q(this.tier);
    const prev = Governor.q(this.prevTier);
    if (cur === prev) return cur;
    if (cur === -1) return this.xf >= 1 ? -1 : prev; // off 로 갈 땐 «강도 0» 이 된 뒤에 끈다
    return this.xf >= 0.5 ? cur : prev;
  }

  /** 블룸 강도 배율 0..1 — Q0↔Q1 전환은 30% 딥, off 전환은 1→0 램프. */
  bloomMix(): number {
    const cur = Governor.q(this.tier);
    const prev = Governor.q(this.prevTier);
    if (cur === prev) return 1;
    const x = this.xf;
    if (cur === -1) return 1 - x;
    if (prev === -1) return x; // (불가역이라 실제론 안 온다 — force 용)
    return 1 - 0.3 * Math.sin(Math.PI * x);
  }

  /** 폴백(가산) 글로우 램프 0..1 — 블룸이 완전히 꺼진 «뒤에» FADE 동안 올라온다(같은 오브젝트 두 층 금지). */
  glowK(): number {
    if (this.tier !== 3) return 0;
    const k = (this.sinceChange - GOV.FADE) / GOV.FADE;
    return k >= 1 ? 1 : k <= 0 ? 0 : k;
  }
}
