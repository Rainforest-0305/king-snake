// spatial.ts — 균일 격자 공간분할.
//
// ★ 이 파일이 60fps 의 근거다.
//   봇 25마리 + 오브 3000개를 매 프레임 «전수 비교»하면 머리 하나당 수천 번,
//   26개 머리면 10만 번이 넘는 거리 계산이 나온다. 폰에서 즉사한다.
//   격자로 나누면 머리 주변 3x3 칸만 보면 되고, 실측 후보 수가 수십 개로 떨어진다.
//
// ★ 왜 쿼드트리가 아니라 균일 격자인가:
//   이 게임의 점 분포는 «맵 전체에 고르게» 퍼진다(오브는 균일 생성, 뱀은 돌아다닌다).
//   편중이 없으면 쿼드트리의 이점(적응적 분할)이 없고, 노드 할당·포인터 추적 비용만
//   남는다. 균일 격자는 계수정렬로 «할당 0회»에 매 프레임 재구축이 가능하다.
//
// ★ 할당 0회 재구축(계수정렬):
//   1) cellCount[] 를 0으로 → 각 점의 셀 카운트 증가
//   2) 접두합으로 cellStart[] 계산
//   3) 다시 훑으며 items[] 에 배치
//   프레임마다 new/push 가 전혀 없다 → GC 스파이크가 없다. 이게 스터터의 주범이다.

export class Grid {
  readonly cell: number;
  readonly dim: number;
  private readonly origin: number;

  /** 셀별 시작 오프셋(길이 dim*dim + 1). 접두합 결과. */
  private readonly cellStart: Int32Array;
  /** 채우기용 커서(cellStart 의 복사본을 소모한다). */
  private readonly cursor: Int32Array;
  /** 셀 순으로 정렬된 «항목 인덱스». */
  private items: Int32Array;

  private count = 0;

  /**
   * @param worldR 맵 반지름. 격자는 [-worldR, worldR] 정사각형을 덮는다.
   * @param cell   셀 한 변 길이. ★ 최대 질의 반경보다 «커야» 3x3 조회로 충분하다.
   *               작게 잡으면 조회 범위를 벗어난 이웃을 놓쳐 «충돌이 조용히 안 난다».
   * @param capacity 예상 최대 항목 수(넘으면 자동 확장).
   */
  constructor(worldR: number, cell: number, capacity: number) {
    this.cell = cell;
    this.origin = -worldR;
    this.dim = Math.ceil((worldR * 2) / cell) + 1;
    const cells = this.dim * this.dim;
    this.cellStart = new Int32Array(cells + 1);
    this.cursor = new Int32Array(cells + 1);
    this.items = new Int32Array(Math.max(64, capacity));
  }

  private cellIndex(x: number, y: number): number {
    let cx = ((x - this.origin) / this.cell) | 0;
    let cy = ((y - this.origin) / this.cell) | 0;
    // 맵 밖 좌표(경계를 막 넘어 죽는 중인 머리 등)도 조용히 흡수한다.
    if (cx < 0) cx = 0;
    else if (cx >= this.dim) cx = this.dim - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.dim) cy = this.dim - 1;
    return cy * this.dim + cx;
  }

  /**
   * xs/ys 의 앞 n개를 격자에 담는다. 매 프레임 통째로 다시 부른다.
   * @param n 항목 수
   */
  rebuild(xs: Float32Array, ys: Float32Array, n: number): void {
    if (n > this.items.length) {
      this.items = new Int32Array(1 << (32 - Math.clz32(n - 1))); // 다음 2의 거듭제곱
    }
    this.count = n;
    const cs = this.cellStart;
    cs.fill(0);

    // 1) 카운트 (cs[i+1] 자리에 세어두면 접두합이 곧 시작 오프셋이 된다)
    for (let i = 0; i < n; i++) {
      cs[this.cellIndex(xs[i], ys[i]) + 1]++;
    }
    // 2) 접두합
    for (let c = 1; c < cs.length; c++) cs[c] += cs[c - 1];
    // 3) 배치
    this.cursor.set(cs);
    const items = this.items;
    for (let i = 0; i < n; i++) {
      items[this.cursor[this.cellIndex(xs[i], ys[i])]++] = i;
    }
  }

  /**
   * (x,y) 반경 r 안에 «있을 수 있는» 항목 인덱스를 out 에 채우고 개수를 돌려준다.
   * ★ 정확한 거리 판정은 호출자가 한다(격자는 후보만 줄인다).
   * @returns 채운 개수. out 이 모자라면 거기서 «자른다» — 자르면 충돌을 놓치므로
   *          out 은 넉넉히 잡아라(호출부에서 1024 사용).
   */
  query(x: number, y: number, r: number, out: Int32Array): number {
    if (this.count === 0) return 0;
    const dim = this.dim;
    let cx0 = ((x - r - this.origin) / this.cell) | 0;
    let cx1 = ((x + r - this.origin) / this.cell) | 0;
    let cy0 = ((y - r - this.origin) / this.cell) | 0;
    let cy1 = ((y + r - this.origin) / this.cell) | 0;
    if (cx0 < 0) cx0 = 0;
    if (cy0 < 0) cy0 = 0;
    if (cx1 >= dim) cx1 = dim - 1;
    if (cy1 >= dim) cy1 = dim - 1;
    if (cx1 < cx0 || cy1 < cy0) return 0;

    const cs = this.cellStart;
    const items = this.items;
    const cap = out.length;
    let k = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      const rowBase = cy * dim;
      const from = cs[rowBase + cx0];
      const to = cs[rowBase + cx1 + 1];
      // ★ 한 행의 [cx0..cx1] 셀은 items 안에서 «연속»이다(계수정렬이 셀 순서를
      //   보장하므로). 그래서 셀마다 도는 대신 행 단위로 한 번에 훑는다.
      for (let i = from; i < to; i++) {
        if (k >= cap) return k;
        out[k++] = items[i];
      }
    }
    return k;
  }
}
