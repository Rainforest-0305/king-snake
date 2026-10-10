// camera.ts — 시점.
//
// ★ 카메라는 머리에 «고정»한다(부드러운 추종을 쓰지 않는다).
//   추종 카메라는 예쁘지만 이 장르에서는 조작 정밀도를 깎는다 — 마우스로 겨눈
//   방향과 화면에 보이는 방향이 미세하게 어긋나면 좁은 틈을 통과하지 못한다.
//   대신 «부스트 중에만» 진행 방향으로 살짝 앞을 본다(속도감 + 시야 확보).
//
// ★ 줌은 두 요소의 곱이다:
//   1) 성장 줌  — 굵어질수록 넓게 본다. 안 하면 후반에 내 몸만 화면을 채운다.
//   2) 화면 줌  — 폰 세로처럼 화면이 작으면 «보이는 월드 면적»이 줄어 일방적으로
//                당한다. 화면이 작을수록 더 줌아웃해 시야를 벌충한다.
//   화면 줌을 선형으로 걸면 폰에서 모든 게 너무 작아지므로 제곱근으로 완화한다.

import { R_MIN, R_MAX, PICK_R_MIN, ZOOM_K, ZOOM_POW, ZOOM_MIN, ZOOM_MAX, ZOOM_LERP } from '../game/config';

/** 화면 줌의 기준 짧은 변(px). 이 값에서 화면 줌 = 1.0. */
const REF_SHORT_SIDE = 760;
const SCREEN_ZOOM_MIN = 0.6;
const SCREEN_ZOOM_MAX = 1.3;

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  /** CSS 픽셀 기준 뷰포트. DPR 은 렌더러가 별도로 곱한다. */
  viewW = 1;
  viewH = 1;

  private zoomTarget = 1;

  resize(w: number, h: number): void {
    this.viewW = Math.max(1, w);
    this.viewH = Math.max(1, h);
  }

  private screenZoom(): number {
    const ref = Math.min(this.viewW, this.viewH);
    const z = Math.sqrt(ref / REF_SHORT_SIDE);
    return Math.min(SCREEN_ZOOM_MAX, Math.max(SCREEN_ZOOM_MIN, z));
  }

  /**
   * @param snap true 면 보간 없이 즉시 맞춘다(게임 시작·리스폰 시).
   *             이걸 빼먹으면 새 판이 시작될 때 카메라가 «날아온다».
   */
  follow(hx: number, hy: number, angle: number, radius: number, boosting: boolean, dt: number, snap: boolean): void {
    /**
     * ★ 줌은 «그리는 굵기»(radius) 가 아니라 «판정 굵기»(pickRadius) 를 기준으로 잡는다.
     *
     *   왜: R_MIN 을 9.5→6.2 로 내린 것은 「뱀을 얇게 그려라」는 요구였다. 그런데 줌까지
     *   같은 radius 를 보고 있어서 뱀이 얇아진 만큼 «화면이 같이 당겨졌다» — 아무도
     *   요구하지 않은 부작용이고, 사람이 먹이를 늦게 발견하게 만든다.
     *   ZOOM_K 를 (9.5/6.2)^0.42 로 상쇄하려 했지만 그건 «상수의 비»일 뿐 «반지름의 비»가
     *   아니다. 실제로는 전 구간에서 3.4~7.5% 더 당겨졌고(면적 7~14% 손실), 시작 구간은
     *   ZOOM_MAX 에 걸려 잘렸다.
     *
     *   pickRadius 는 병합 전 반지름 곡선 그 자체이므로, 이 기준으로 재면 시야가
     *   «병합 전과 정확히 같아진다». 손으로 계산한 상쇄 상수가 필요 없어진다(ZOOM_K=1.0).
     *   결과: 시야는 그대로, 뱀만 얇게 — 요구했던 것이 정확히 그거다.
     *
     *   ⚠️ main.ts 는 snake.radius 를 넘긴다(확정본이라 시그니처를 바꾸지 않는다).
     *      그래서 여기서 곡선을 되돌려 pickRadius 를 «복원»한다. 두 곡선은 R_MAX 를
     *      공유하고 하한만 다르므로 t = (r-R_MIN)/(R_MAX-R_MIN) 하나로 오간다.
     */
    const t = Math.min(1, Math.max(0, (radius - R_MIN) / (R_MAX - R_MIN)));
    const pickR = PICK_R_MIN + (R_MAX - PICK_R_MIN) * t;
    const grow = Math.pow(PICK_R_MIN / Math.max(PICK_R_MIN, pickR), ZOOM_POW) * ZOOM_K;
    this.zoomTarget = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, grow)) * this.screenZoom();

    if (snap) {
      this.zoom = this.zoomTarget;
    } else {
      // 지수 보간 — 프레임레이트가 달라져도 «같은 속도»로 수렴한다.
      const k = 1 - Math.exp(-ZOOM_LERP * dt);
      this.zoom += (this.zoomTarget - this.zoom) * k;
    }

    const lead = boosting ? Math.min(120, 34 + radius * 1.6) : 0;
    const tx = hx + Math.cos(angle) * lead;
    const ty = hy + Math.sin(angle) * lead;
    if (snap) {
      this.x = tx;
      this.y = ty;
    } else {
      // 앞보기만 부드럽게. 머리 위치 자체는 즉시 따라간다(정밀도 우선).
      const k = 1 - Math.exp(-6 * dt);
      this.x += (tx - this.x) * k;
      this.y += (ty - this.y) * k;
    }
  }

  /** 화면 좌표 → 월드 좌표. 입력(마우스/터치) 해석에 쓴다. */
  screenToWorld(sx: number, sy: number, out: { x: number; y: number }): void {
    out.x = (sx - this.viewW / 2) / this.zoom + this.x;
    out.y = (sy - this.viewH / 2) / this.zoom + this.y;
  }

  /** 컬링용 월드 경계. margin 은 월드 단위. */
  bounds(margin: number, out: { x0: number; y0: number; x1: number; y1: number }): void {
    const hw = this.viewW / 2 / this.zoom + margin;
    const hh = this.viewH / 2 / this.zoom + margin;
    out.x0 = this.x - hw;
    out.x1 = this.x + hw;
    out.y0 = this.y - hh;
    out.y1 = this.y + hh;
  }
}
