// trail.ts — 몸통 폴리라인 저장소(링 버퍼).
//
// ★ 왜 배열 + shift() 가 아닌가:
//   몸이 자라면 점이 2000개까지 간다. 매 프레임 앞에서 shift() 하면 O(n) 이동이
//   26마리분 발생한다. 게다가 배열이 커졌다 작아졌다 하며 GC 스파이크를 만든다.
//   링 버퍼는 push/drop 이 O(1) 이고 «매 프레임 할당이 0»이다.
//
// ★ 인덱스 규약: get(0) 이 «가장 최근» 점이다(머리 쪽). 인덱스가 커질수록 꼬리 쪽.
//   몸길이를 줄일 때 꼬리를 자르는 게 곧 count 를 줄이는 일이 되어 코드가 단순해진다.

export class Trail {
  private xs: Float32Array;
  private ys: Float32Array;
  private cap: number;
  private head = 0; // 가장 최근 점의 물리 인덱스
  private n = 0;

  constructor(cap = 256) {
    this.cap = Math.max(16, cap);
    this.xs = new Float32Array(this.cap);
    this.ys = new Float32Array(this.cap);
  }

  get count(): number {
    return this.n;
  }

  /** i번째로 최근인 점의 물리 인덱스. */
  private idx(i: number): number {
    const c = this.cap;
    let k = this.head - i;
    if (k < 0) k += c;
    return k;
  }

  x(i: number): number {
    return this.xs[this.idx(i)];
  }

  y(i: number): number {
    return this.ys[this.idx(i)];
  }

  /**
   * 용량을 확보한다. ★ push 전에 반드시 부를 것 —
   * 용량이 모자란 채로 push 하면 «가장 오래된 점이 조용히 사라져» 꼬리가 잘린다.
   * 눈에 잘 안 띄는 버그라 호출부(snake.ts)에서 매 프레임 보증한다.
   */
  ensure(min: number): void {
    if (min <= this.cap) return;
    let cap = this.cap;
    while (cap < min) cap *= 2;
    const xs = new Float32Array(cap);
    const ys = new Float32Array(cap);
    // 논리 순서(오래된 것 → 최근)로 펴서 옮긴다. 옮긴 뒤 head 는 n-1.
    for (let i = 0; i < this.n; i++) {
      const src = this.idx(this.n - 1 - i);
      xs[i] = this.xs[src];
      ys[i] = this.ys[src];
    }
    this.xs = xs;
    this.ys = ys;
    this.cap = cap;
    this.head = this.n === 0 ? 0 : this.n - 1;
  }

  push(x: number, y: number): void {
    if (this.n === 0) {
      this.head = 0;
    } else {
      this.head = this.head + 1 === this.cap ? 0 : this.head + 1;
    }
    this.xs[this.head] = x;
    this.ys[this.head] = y;
    if (this.n < this.cap) this.n++;
  }

  /** 꼬리를 잘라 점 개수를 max 이하로 만든다. */
  trimTo(max: number): void {
    if (max < 0) max = 0;
    if (this.n > max) this.n = max;
  }

  reset(x: number, y: number, seed: number): void {
    this.n = 0;
    this.head = 0;
    for (let i = 0; i < seed; i++) this.push(x, y);
  }
}
