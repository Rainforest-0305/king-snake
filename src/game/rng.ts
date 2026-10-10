// rng.ts — 결정적 난수(mulberry32).
//
// ★ Math.random() 을 직접 쓰지 않는 이유: 버그를 재현하려면 씨앗을 고정할 수 있어야 한다.
//   「봇이 특정 상황에서 벽에 박는다」 같은 문제는 같은 씨앗으로 다시 돌려야 잡힌다.
//   ?seed=12345 쿼리로 판을 그대로 재현할 수 있게 해 뒀다(main.ts).

export class Rng {
  private s: number;

  constructor(seed: number) {
    // 0 은 mulberry32 를 죽은 수열로 만든다. 0 이 오면 임의의 상수로 대체.
    this.s = (seed >>> 0) || 0x9e3779b9;
  }

  /** [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** [min, max] 정수 */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1 - 1e-9));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }

  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  /** 원판 내부 균일 분포. sqrt 를 빼먹으면 중앙에 몰린다(흔한 실수라 헬퍼로 못 박는다). */
  inDisc(radius: number): { x: number; y: number } {
    const a = this.next() * Math.PI * 2;
    const r = Math.sqrt(this.next()) * radius;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }
}

/** 시계 기반 씨앗(?seed= 가 없을 때). */
export function timeSeed(): number {
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}
