// orbs.ts — 오브(먹이) 필드.
//
// ★ 구조 선택: 객체 배열({x,y,...}[]) 이 아니라 «병렬 타입배열»이다.
//   오브는 3000개가 상시 존재하고, 사망 폭발 때 순간적으로 수백 개가 더 생긴다.
//   객체로 두면 매 프레임 GC 가 이들을 훑고, 생성/파괴가 스터터로 나타난다.
//   타입배열 + 스왑삭제면 «할당이 사실상 0»이고 캐시 지역성도 좋다.
//
// ★ 스왑삭제(swap-remove) 의 대가: 인덱스가 «프레임을 넘어 유지되지 않는다».
//   그래서 오브 인덱스를 어디에도 저장하지 마라. 참조가 필요하면 좌표로 다시 찾아라.
//   (현재 코드에서 오브 인덱스를 프레임 너머로 들고 있는 곳은 없다 — 그렇게 유지할 것.)

import { ORB_R_BASE, ORB_R_K } from './config';

export class OrbField {
  xs: Float32Array;
  ys: Float32Array;
  /** 가치(= 먹었을 때 얻는 질량). */
  vs: Float32Array;
  rs: Float32Array;
  /** colorTable 인덱스. */
  cs: Uint8Array;
  /** 반짝임 위상 — 렌더가 쓴다. 같은 화면의 오브가 «동시에» 깜빡이면 가짜로 보인다. */
  ph: Float32Array;
  n = 0;

  /** 실제 색 문자열. 인덱스는 Uint8 이라 255색까지. */
  readonly colorTable: string[] = [];
  private readonly colorMap = new Map<string, number>();

  constructor(capacity = 4096) {
    const c = Math.max(64, capacity);
    this.xs = new Float32Array(c);
    this.ys = new Float32Array(c);
    this.vs = new Float32Array(c);
    this.rs = new Float32Array(c);
    this.cs = new Uint8Array(c);
    this.ph = new Float32Array(c);
  }

  get capacity(): number {
    return this.xs.length;
  }

  /** 색 문자열을 인덱스로 «인턴»한다. 255개를 넘으면 0번으로 접는다(색만 틀리고 동작은 유지). */
  colorIndex(hex: string): number {
    const hit = this.colorMap.get(hex);
    if (hit !== undefined) return hit;
    if (this.colorTable.length >= 255) return 0;
    const idx = this.colorTable.length;
    this.colorTable.push(hex);
    this.colorMap.set(hex, idx);
    return idx;
  }

  private grow(min: number): void {
    let c = this.capacity;
    while (c < min) c *= 2;
    const nx = new Float32Array(c); nx.set(this.xs);
    const ny = new Float32Array(c); ny.set(this.ys);
    const nv = new Float32Array(c); nv.set(this.vs);
    const nr = new Float32Array(c); nr.set(this.rs);
    const nc = new Uint8Array(c); nc.set(this.cs);
    const np = new Float32Array(c); np.set(this.ph);
    this.xs = nx; this.ys = ny; this.vs = nv; this.rs = nr; this.cs = nc; this.ph = np;
  }

  static radiusFor(value: number): number {
    return ORB_R_BASE + Math.sqrt(value) * ORB_R_K;
  }

  spawn(x: number, y: number, value: number, colorIdx: number, phase: number): void {
    if (this.n === this.capacity) this.grow(this.n + 1);
    const i = this.n++;
    this.xs[i] = x;
    this.ys[i] = y;
    this.vs[i] = value;
    this.rs[i] = OrbField.radiusFor(value);
    this.cs[i] = colorIdx;
    this.ph[i] = phase;
  }

  /** ★ 스왑삭제. 호출한 루프가 «역순»이 아니면 방금 옮겨온 항목을 건너뛴다 — 주의. */
  removeAt(i: number): void {
    const last = --this.n;
    if (i !== last) {
      this.xs[i] = this.xs[last];
      this.ys[i] = this.ys[last];
      this.vs[i] = this.vs[last];
      this.rs[i] = this.rs[last];
      this.cs[i] = this.cs[last];
      this.ph[i] = this.ph[last];
    }
  }

  clear(): void {
    this.n = 0;
  }
}
