// growthTriggers.ts — 「기록 돌파 리워드」를 «언제» 제안할지 정하는 순수 상태기계.
//
// ══ 왜 main.ts 가 아니라 별도 파일인가 ════════════════════════════════════
//  main.ts 의 게임 루프 안에 조건문으로 흩어 놓으면 「판당 1회」·「동시 발동 시
//  하나만」·「판당 상한」 세 규칙이 서로 다른 자리에서 각자 판정하게 된다. 그 순간
//  「5,001점·5,002점마다 계속 뜨는」 종류의 사고가 «반드시» 난다(President 요구 4가
//  경고한 바로 그것). 규칙을 한 객체 안에 가두면 그 객체만 검증하면 된다.
//  ⇒ World·DOM·광고 SDK 를 «하나도» 모른다. 숫자만 받고 결정만 돌려준다.
//
// ══ 규칙 (President 2026-09-01 지시) ══════════════════════════════════════
//  ① 점수(= Math.floor(mass)) 가 GROWTH_THRESHOLDS 를 «넘는 순간» 제안한다.
//     (500 · 2000 · 5000 — 2026-09-01 President 확정.)
//  ② 개인 최고 기록을 «돌파하는 순간»에도 제안한다.
//  ③ 각 문턱은 판당 1회. 최고 기록 돌파도 판당 1회.
//  ④ 문턱과 최고 기록이 «동시에» 걸리면 하나만 뜬다.
//     ⇒ 이건 「하나를 고른다」로는 부족하다. 고른 쪽만 소비하면 «다음 프레임에»
//       남은 쪽이 곧바로 뜬다(점수가 계속 그 조건을 만족하므로). 그래서
//       consume() 은 «그 순간 걸려 있던 트리거를 전부» 소비한다.
//  ⑤ 판당 노출 상한(GROWTH_MAX_PER_RUN).
//  ⑥ 제안과 제안 사이 «최소 플레이 시간»(GROWTH_MIN_GAP_S).
//
// ══ 제안은 게임을 «멈추지 않는다»(2026-09-01 President 판정) ══════════════
//  옛 구현은 월드를 완전정지시키고 모달을 띄웠다. President 가 그것을 «방해»로
//  판정했다. 지금은 화면 구석 배너로 GROWTH_OFFER_S 초 동안만 떠 있고, 그동안
//  게임은 그대로 흐른다. 안 누르면 조용히 사라지고 «다시 뜨지 않는다».
//  ⇒ 그래서 소비 시점은 「배너를 띄운 순간」이다(누른 순간이 아니다).
//    이 파일은 그 정책을 강제하지 않는다 — 호출부가 show 시점에 consume() 한다.
//
// ══ 문턱과 최고기록이 겹칠 때 «무엇을» 보여주나 ══════════════════════════
//  문턱이 이긴다. 근거는 실측이다(tools/qa_growth_dist.mjs, 601판):
//  실제로 뜬 제안 159건 중 문턱이 143건, 최고기록이 16건이었다.
//  문턱은 이름이 붙은 사건(「2,000 돌파」)이라 그 자리에서 더 큰 일로 읽힌다.

/**
 * 문턱 계단. ⛔이 값을 임의로 바꾸지 마라 — 변경은 President 결정이다.
 *
 * ── 이력 ─────────────────────────────────────────────────────────────────
 *  2026-08-31 최초 지시  : [2000, 5000, 10000]
 *  2026-08-31 President 승인: 앞에 500·1000 을 «추가»(5단).
 *    근거는 도달률이었다 — 2,000 도달 1.2% / 5,000·10,000 «0건»(봇 AI 대리 601판).
 *  2026-09-01 President 확정: **[500, 2000, 5000]** 세 칸.
 *    1,000 과 10,000 을 뺐다. 그 결과 「흔한 저단이 판당 상한을 다 먹어 2,000+ 이
 *    영영 안 뜬다」는 5단의 구조적 결함이 사라진다 — 500 위의 다음 칸이 곧 2,000 이라
 *    상한 2 안에서 «500 → 2,000» 이 그대로 들어간다. 그래서 고단 전용 슬롯도 폐기했다.
 */
export const GROWTH_THRESHOLDS: readonly number[] = [500, 2000, 5000];

/**
 * 한 판에 제안을 «최대 몇 번» 띄우는가.
 *
 * ★ 2 인 근거 (숫자 셋):
 *   1) 도달률 실측 — 2,000 은 1.2~2.6% / 5,000 은 0% 다(봇 AI 대리 590판).
 *      즉 문턱이 «다 걸리는» 판은 실질적으로 존재하지 않는다. 현실의 최대 동시
 *      발동은 「최고기록 + 500」 또는 「500 + 2,000」 = 2 다.
 *   2) 중단 비용 — 제안 자체는 이제 게임을 안 멈추지만, «수락»하면 리워드 광고
 *      15~30초 + 복귀 카운트다운 3초로 판이 끊긴다. 한 판 중앙값이 26초(실측)인
 *      게임에서 3회 이상은 «게임보다 광고가 긴» 판이 된다.
 *   3) 순위 영향 — 2회면 최대 1.2² = 1.44배로 «닫힌다». 3회면 1.73배가 되어
 *      광고를 본 사람과 안 본 사람이 다른 리그가 된다(랭킹 공정성 보고 참조).
 */
export const GROWTH_MAX_PER_RUN = 2;

/**
 * 최고 기록 트리거가 «살아나는» 최소 기록.
 *
 * ★ 왜 필요한가: 이게 없으면 «생애 첫 판»의 점수 13 에서 곧바로 제안이 뜬다
 *   (bestScore 0 을 넘는 순간이므로). 게임을 20초 해 본 사람에게 「기록 돌파」라고
 *   말하는 것은 거짓말이고, 첫 인상이 광고가 된다.
 * ★ 300 인 근거: 봇 AI 대리 164판의 판당 최고점 중앙값이 242 였다(실측).
 *   즉 300 은 「이미 평균보다 잘한 판을 한 번 해 본 사람」의 자리다.
 */
export const GROWTH_BEST_MIN = 300;

/**
 * 제안 배너가 «떠 있는» 시간(초). 이 시간이 지나면 스스로 사라진다.
 *
 * ★ 5 는 President 지시값이다(2026-09-01: 「5초 후에 사라지도록 해」).
 * ★ ⛔벽시계가 아니라 «프레임 dt»로 깎는다. 앱이 백그라운드로 가면 rAF 가 멈추고
 *   배너 시간도 멈춘다 — 안 보이는 사이에 5초가 흘러 기회가 사라지지 않는다.
 *   (복귀 카운트다운이 setTimeout 을 안 쓰는 것과 «같은» 이유다.)
 * ★ 사라지면 그 트리거는 «소비된» 것이다. 다시 뜨지 않는다.
 */
export const GROWTH_OFFER_S = 5;

/**
 * 제안과 제안 사이의 «최소 플레이 시간»(초).
 *
 * ★ 왜 필요한가 — 보상 자체가 다음 문턱을 즉시 넘긴다. 실측(578판, 쿨다운 0):
 *   연속 제안 간격의 «최소가 0.02초» 였고 3초 미만이 27% 였다. 그러면 배너가
 *   사라지자마자 또 배너가 뜬다 — 광고 권유가 화면에 상주하는 꼴이다.
 *
 * ★ ⛔벽시계가 아니라 «월드 시계»(world.time)로 잰다. 월드 시계는 광고를 보는
 *   동안·복귀 카운트다운 동안 «안 흐른다». 즉 이 값은 「실제로 조종한 시간」이다.
 *   벽시계로 재면 30초짜리 광고를 본 것만으로 쿨다운이 끝나 버린다.
 *
 * ★ 쿨다운은 트리거를 «버리지 않는다». evaluate() 는 아무것도 소비하지 않으므로,
 *   쿨다운 중에 넘긴 문턱은 쿨다운이 끝나는 즉시 그대로 뜬다.
 */
export const GROWTH_MIN_GAP_S = 10;

/** 어떤 사건으로 제안이 떴는가. UI 문구와 계측 태그가 이 값을 그대로 쓴다. */
export type GrowthTriggerKind = 'threshold' | 'best';

export interface GrowthOffer {
  kind: GrowthTriggerKind;
  /** threshold 면 넘은 문턱값, best 면 «깬 옛 기록». 문구에 그대로 들어간다. */
  value: number;
  /** 제안이 뜬 순간의 점수. */
  score: number;
}

/**
 * 한 판의 트리거 상태. ★startRun 마다 reset() 한다.
 *
 * 이 객체는 «시간»을 모른다. 매 프레임 evaluate(score, best) 를 물어보면
 * 지금 띄워야 할 제안을 돌려주거나 null 을 돌려준다. 실제로 띄웠으면 호출부가
 * consume() 을 불러 «같은 순간에 걸려 있던 트리거를 전부» 닫는다.
 */
export class GrowthTriggers {
  /** 문턱별 «이번 판에 이미 썼는가». GROWTH_THRESHOLDS 와 같은 길이·순서다. */
  private used: boolean[] = GROWTH_THRESHOLDS.map(() => false);
  private bestUsed = false;
  private shown = 0;
  /** 마지막 제안이 뜬 «월드 시각»(초). -Infinity = 이번 판에 아직 없다. */
  private lastOfferAt = -Infinity;

  /** 판 시작. ★startRun 에서 «반드시» 부른다 — 여기가 유일한 해제 지점이다. */
  reset(): void {
    for (let i = 0; i < this.used.length; i++) this.used[i] = false;
    this.bestUsed = false;
    this.shown = 0;
    this.lastOfferAt = -Infinity;
  }

  /** 이번 판에 제안을 몇 번 띄웠는가(계측·검사기용). */
  get shownThisRun(): number {
    return this.shown;
  }

  /** 판당 상한에 닿았는가. */
  atRunCap(): boolean {
    return this.shown >= GROWTH_MAX_PER_RUN;
  }

  /** 이번 판에 남은 제안 횟수. */
  remainingThisRun(): number {
    return Math.max(0, GROWTH_MAX_PER_RUN - this.shown);
  }

  /**
   * 지금 제안할 것이 있는가. ★«판정만» 한다 — 아무것도 소비하지 않는다.
   * 그래서 호출부가 「광고가 안 뜨는 상황」이라고 판단해 안 띄우기로 해도
   * 트리거가 «조용히 사라지지» 않는다(다음 프레임에 다시 물어보면 그대로 있다).
   *
   * @param score 지금 점수 = Math.floor(mass). HUD·순위표와 «같은 값»이어야 한다.
   * @param bestScore 판 «시작 시점»의 개인 최고 기록. 판 도중에 변하면 안 된다.
   * @param now 월드 시각(초). ⛔벽시계가 아니다 — 멈춰 있는 동안은 안 흐른다.
   */
  evaluate(score: number, bestScore: number, now: number): GrowthOffer | null {
    if (this.atRunCap()) return null;
    // 쿨다운 — 트리거를 «버리지 않는다». 조건이 유지되면 쿨다운이 끝나는 즉시 뜬다.
    if (now - this.lastOfferAt < GROWTH_MIN_GAP_S) return null;
    // ① 문턱이 우선(위 머리말의 근거).
    //
    // ★★ «가장 높은» 미소비 문턱을 고른다. 낮은 쪽부터 고르면 안 된다:
    //   점수가 한 번에 여러 문턱을 지나는 일이 실제로 있다 —
    //     · 큰 봇을 잡아 오브를 한꺼번에 흡수할 때
    //     · 보상 1.2배가 다음 문턱을 즉시 넘길 때
    //     · 쿨다운(⑥) 동안 점수가 계속 오를 때
    //   그때 낮은 쪽을 고르면 «2,100점인 사람에게 「500 돌파」»라고 말하게 된다.
    //   consume() 이 어차피 지나온 문턱을 «전부» 닫으므로, 이름은 가장 큰 사건으로 부른다.
    for (let i = GROWTH_THRESHOLDS.length - 1; i >= 0; i--) {
      if (!this.used[i] && score >= GROWTH_THRESHOLDS[i]) {
        return { kind: 'threshold', value: GROWTH_THRESHOLDS[i], score };
      }
    }
    // ② 개인 최고 기록 돌파.
    if (!this.bestUsed && bestScore >= GROWTH_BEST_MIN && score > bestScore) {
      return { kind: 'best', value: bestScore, score };
    }
    return null;
  }

  /**
   * 제안을 «실제로 띄웠다». 지금 이 점수에서 걸려 있던 트리거를 «전부» 닫는다.
   *
   * ★ 「하나만 뜨게 한다」의 유일한 올바른 구현이다. 고른 하나만 닫으면 남은
   *   트리거가 «바로 다음 프레임»에 뜬다 — 점수는 여전히 그 조건을 만족하므로.
   *   (예: 최고기록 1,900 인 사람이 2,050 을 찍으면 문턱 2000 과 최고기록이 동시에
   *    걸린다. 문턱만 닫으면 다음 프레임에 최고기록 제안이 연달아 뜬다.)
   *
   * ★ 호출 시점은 「배너를 띄운 순간」이다 — 누르지 않고 5초 뒤 사라져도 그
   *   트리거는 이미 소비된 것이다(President 2026-09-01: 「사라지면 다시 안 뜸」).
   *
   * @param offer 실제로 띄운 제안. ★점수만 받지 않는 이유는 호출부가 「이 점수면
   *   어떤 제안이었겠지」를 «다시 추론»하게 두지 않기 위해서다.
   * @returns 이번 호출로 닫힌 트리거 수(검사기가 0 과 구분할 수 있어야 한다).
   */
  consume(offer: GrowthOffer, bestScore: number, now: number): number {
    const score = offer.score;
    this.lastOfferAt = now;
    let closed = 0;
    for (let i = 0; i < GROWTH_THRESHOLDS.length; i++) {
      if (!this.used[i] && score >= GROWTH_THRESHOLDS[i]) {
        this.used[i] = true;
        closed++;
      }
    }
    if (!this.bestUsed && bestScore >= GROWTH_BEST_MIN && score > bestScore) {
      this.bestUsed = true;
      closed++;
    }
    this.shown++;
    return closed;
  }

  /**
   * 테스트 전용 — 쿨다운만 «해제»한다. ?debug=1 훅으로만 노출한다.
   * ⛔다른 규칙(판당 1회·상한)은 건드리지 않는다. 그게 이 함수의 존재 이유다:
   *   쿨다운을 걷어내야 그 아래 규칙이 «실제로» 살아 있는지 볼 수 있다.
   */
  __clearCooldownForTest(): void {
    this.lastOfferAt = -Infinity;
  }

  /** 지금 «쿨다운 중»인가(검사기·계측용). */
  coolingDown(now: number): boolean {
    return now - this.lastOfferAt < GROWTH_MIN_GAP_S;
  }

  /** 검사기용 스냅샷. 운영 로직은 읽지 않는다. */
  debugState(): { used: boolean[]; bestUsed: boolean; shown: number; lastOfferAt: number } {
    return {
      used: this.used.slice(), bestUsed: this.bestUsed, shown: this.shown,
      lastOfferAt: Number.isFinite(this.lastOfferAt) ? this.lastOfferAt : -1,
    };
  }
}
