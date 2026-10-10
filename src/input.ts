// input.ts — 조작. 포인터 하나로 뱀을 몬다.
//
// ★ 출력은 두 개뿐이다: aimAngle(라디안 또는 null) 과 boosting(불리언).
//   게임 로직은 입력 장치를 «모른다». 새 조작계를 붙여도 world 는 손대지 않는다.
//
// ════════════════════════════════════════════════════════════════════════════
// ★★ 2026-09-06 — «수정»이 아니라 «교체»다 (President 지시).
//
//   이 파일은 1,375줄이었다. 그 줄 수의 대부분은 조이스틱을 «고치려고» 쌓은
//   층이었다: 터치 이벤트 경로 + 포인터 경로(이중), 창 캡처 단계 구조대
//   리스너, 역할 없는 손가락 채택(adopt), 유령 흡수, 매 프레임 불변식
//   자가치유, 캡처 유실 유예, 질주/조종 겸직과 승격, 판 시작 시점 원점 못박기…
//   2026-08-25 이후 이 층들에서만 고장이 났고, 고칠 때마다 «다른 자리»에
//   새 고장이 났다(실측 이력: -31, -34, -39).
//
//   같은 회사의 「땅따먹기」(territory-clash) 조이스틱은 45줄이고 멀쩡하다.
//   그 코드에는 위 층이 «하나도» 없다. 그래서 그 모델로 갈아탄다.
//
//   땅따먹기 모델의 핵심 두 가지:
//     ① 조종 포인터는 «하나»다. 이미 잡고 있으면 두 번째 손가락은 조종을
//        건드리지 않는다. 재배정·승격·채택이 «구조적으로» 존재하지 않는다.
//     ② 원점이 손가락을 «따라온다»(drag-along). 손가락이 원점에서 STICK_MAX
//        보다 멀어지면 원점을 그만큼 끌어당긴다.
//        ⇒ 「스틱이 손가락에서 멀리 떨어져 안 먹는」 상태가 만들어질 수 없다.
//        ⇒ 무한 드래그가 되므로 화면 끝에서 조작이 막히지도 않는다.
//
//   ⚠ 이 교체로 «의도적으로» 사라지는 것들(고장이 아니라 설계다):
//     · 일시정지·blur 로 상태가 비워진 뒤 «닿아 있던» 손가락을 되살리는 복구.
//       그 손가락은 뗐다 다시 대면 새 원점으로 살아난다(땅따먹기와 같다).
//     · 질주 버튼을 잡은 손가락이 조종을 «겸하는» 기능.
//     · 메뉴에서 얹은 손가락이 판 시작과 함께 조종을 이어받는 기능.
//
//   ⚠ 왜 포인터 이벤트로 돌아가는가: 2026-08-25 에 터치 이벤트로 옮긴 이유는
//     「iOS 웹뷰에서 pointermove 가 사라진다」는 가설이었다. 그 가설은 끝내
//     실측으로 확인되지 못했고, 옮긴 뒤 오히려 이중 경로가 고장의 원인이 됐다.
//     같은 플랫폼(토스 미니앱)에 나가 있는 땅따먹기가 포인터 경로로 동작한다는
//     것이 지금 우리가 가진 «유일한 실증»이다. ★그래도 실기기 확인은 필요하다.
// ════════════════════════════════════════════════════════════════════════════

export type ControlMode = 'joystick' | 'drag';

/**
 * 조이스틱 데드존(css px). 원점 기준 이만큼 밀기 전에는 방향을 만들지 않는다.
 * ★ 링 반지름의 12%(52 × 0.12 ≈ 6). 온스크린 스틱의 통상 범위(10~15%) 안이고,
 *   원점이 «고정»이라 손가락이 원점에서 멀어질수록 각도가 안정되므로 크게 잡을
 *   이유가 없다. 엄지를 얹고 가만히 있으려는 떨림(±2~3px)만 걸러 내면 된다.
 */
const DEADZONE = 6;

/**
 * drag 모드 데드존. 기준이 «머리와 손가락의 거리»라 성격이 완전히 다르다
 * (손가락이 머리 «위»에 있을 때 각도가 요동치는 걸 막는 용도).
 */
const DRAG_DEADZONE = 12;

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★ 원점은 «움직이지 않는다» — 고정 원점(static origin) 모델.
 *    (2026-09-07 President 지시: 「조이스틱이 통째로 따라오는 게 너무 불편하다」)
 *
 *    온스크린 스틱은 크게 두 갈래다(Unity Input System 의 분류가 그대로다):
 *      · dynamic origin — 손가락이 멀어지면 원점을 «끌어온다».
 *        무한 조향은 공짜로 얻지만, 스틱이 화면을 돌아다닌다.
 *        ⇒ 2026-09-06 판(-42)이 이것이었고, President 가 불편하다고 한 그 동작이다.
 *      · static origin  — 원점은 «처음 닿은 자리»에 못 박히고 노브만 링 안에서
 *        멈춘다. Brawl Stars·slither.io 조이스틱 모드가 쓰는 방식이다.
 *
 *    ⇒ static 을 쓴다. 그리고 dynamic 이 공짜로 주던 «무한 조향»은 따로 챙긴다:
 *      각도를 «거리와 무관하게» 계산한다. 손가락이 링 밖 200px 에 있어도
 *      atan2 는 멀쩡히 나온다. 「멀어지면 안 먹는다」는 예전 버그는 거리 때문이
 *      아니라 상태기계(재배정·유령흡수) 때문이었고, 그 층은 -42 에서 사라졌다.
 *
 *    ⛔ drag-along(DRAG_START) 을 «다시 넣지 마라». 그게 불편함의 원인이다.
 * ════════════════════════════════════════════════════════════════════════════
 */

/**
 * 노브가 «시각적으로» 멈추는 반경. 조향 각도에는 쓰지 않는다(표시 전용).
 * ★ 링(52) 안쪽이다 — 노브가 링 밖으로 나가는 순간이 없다.
 */
export const KNOB_MAX = 46;

/**
 * 스틱 «링»의 반지름(시각). 가장자리 보정도 이 값을 기준으로 한다.
 * ★ 이름을 STICK_MAX 로 유지하는 이유: touchControls.ts 가 이 이름으로 링을
 *   그리고 유령 스틱 위치를 잡는다. 이름을 바꾸면 그쪽을 여러 곳 고쳐야 한다.
 */
export const STICK_MAX = 52;

/**
 * 가장자리 보정이 남기는 여백(css px).
 *
 * ★ 26 은 이 프로젝트가 이미 쓰는 값이다 — 질주 버튼이 오른쪽 가장자리와
 *   두는 거리, 그리고 유령 스틱의 왼쪽 여백이 둘 다 26 이다(resize 참고).
 *   가장자리에 «딱 붙은» 링은 잘린 것처럼 읽히고, 하필 iOS 의 화면 끝 시스템
 *   제스처 구역과도 겹친다. 같은 26 을 쓰면 어디에 생기든 한 화면처럼 보인다.
 * ★ 위쪽도 같은 값을 쓴다. safe-area top 은 resize 로 받지 못하지만, 점수·
 *   순위표가 있는 쪽이라 여백이 더 필요하면 필요했지 덜 필요하지 않다.
 */
const EDGE_PAD = 26;

/** 질주 버튼 히트 반경 배수. ★이제 «표시»에만 쓴다(아래 boostHeld). */
const BOOST_HIT_SCALE = 1.25;

/**
 * 「이 기기는 손가락으로 쓰는 기기인가」.
 *
 * ★ 추측하지 말고 실측된 것만 쓴다(Chromium 149 headless, 2026-08-25):
 *     모바일 에뮬레이션 : pointer:coarse=true  hover:none=true  maxTouchPoints=1
 *     데스크톱          : pointer:coarse=false hover:none=false maxTouchPoints=10
 *   ⚠ `navigator.maxTouchPoints > 0` 은 «틀린» 판정이다. 터치 없는 데스크톱에서도
 *     10 이 나온다 — 이걸 쓰면 마우스 사용자에게 조이스틱이 뜬다.
 *   ⚠ `any-pointer: coarse` 도 틀렸다. 터치 노트북에서 마우스를 쓸 때도 true 다.
 */
function isCoarsePointerDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return (
      window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(hover: none)').matches
    );
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 진단 계측 — 필드 이름은 예전 판과 «그대로» 유지한다.
// touchControls.ts 의 진단 오버레이와 tools/qa_*.py 계측기들이 이 이름으로
// 읽는다. 이름을 줄이면 그 검사기들이 조용히 0 을 읽는다(죽은 검사기).
//
// ★ 예전에는 「우리 필터를 통과하기 전」을 세려고 캡처 단계 리스너를 따로
//   18개 달았다. 이제 경로가 «하나»라 그 구분이 필요 없다 — 핸들러 첫 줄에서 센다.
//   그래서 win[] 은 항상 0 이다(경로가 하나뿐이라는 사실 자체가 값이다).
// ═══════════════════════════════════════════════════════════════════════════

export const DIAG_BUILD = 'PTR 260906';

/**
 * 진단 오버레이 스위치.
 * ★ ⛔출시판은 반드시 false 다. `?diag=1` 로도 켜진다(데스크톱·로컬 재현용).
 */
const DIAG_BUILD_ENABLED = false;
export const DIAG_ENABLED: boolean =
  DIAG_BUILD_ENABLED && typeof location !== 'undefined' && location.search.indexOf('diag=1') >= 0;

export interface TouchDiag {
  build: string;
  /** 손가락 입력의 «주 경로». 이제 언제나 'pointer' 다. */
  path: 'touch' | 'pointer';
  el: Record<string, number>;
  /** 경로가 하나뿐이라 항상 0. 필드는 검사기 호환을 위해 남긴다. */
  win: Record<string, number>;
  lastKind: string;
  lastX: number;
  lastY: number;
  lastTarget: string;
  lastCancelable: number;
  /** 조종 포인터의 좌표를 실제로 갱신한 횟수. */
  steerUpdates: number;
  /** 조종 포인터를 «배정»한 횟수. 한 제스처당 정확히 1 이어야 한다. */
  steerAssigns: number;
  steerId: number;
  boostId: number;
  activeN: number;
  extraN: number;
  stickActive: number;
  steerOX: number;
  steerOY: number;
  steerCX: number;
  steerCY: number;
  aim: number | null;
  dist: number;
  paused: number;
  usedTouch: number;
  pauseLeakFixed: number;
  steerLive: number;
  joyMode: number;
  /** 채택 경로가 «없어졌으므로» 항상 0. 필드는 검사기 호환을 위해 남긴다. */
  adopts: number;
  // ── 2026-09-07 실기기 진단용(화면 진단 줄이 읽는다) ──
  /** 캔버스가 받은 pointerdown 수. 0 인데 winPd>0 이면 «캔버스가 못 받는다». */
  elPd: number;
  /** 창 캡처 단계가 받은 pointerdown 수. */
  winPd: number;
  /** pointercancel 수. 0 이 아니면 네이티브가 제스처를 가져갔다는 신호다. */
  pCancel: number;
  /** 창 캡처 touchstart / touchmove 수. */
  winTs: number;
  winTm: number;
  /** 지금 조향 좌표를 어디서 받고 있는가. 0=포인터 1=그림자(터치 폴백). */
  shadow: number;
}

function zeroCounts(): Record<string, number> {
  return {
    touchstart: 0, touchmove: 0, touchend: 0, touchcancel: 0,
    pointerdown: 0, pointermove: 0, pointerup: 0, pointercancel: 0,
    lostpointercapture: 0,
  };
}

export const DIAG: TouchDiag = {
  build: DIAG_BUILD,
  path: 'pointer',
  el: zeroCounts(),
  win: zeroCounts(),
  lastKind: '-',
  lastX: 0,
  lastY: 0,
  lastTarget: '-',
  lastCancelable: -1,
  steerUpdates: 0,
  steerAssigns: 0,
  steerId: -1,
  boostId: -1,
  activeN: 0,
  extraN: 0,
  stickActive: 0,
  steerOX: 0,
  steerOY: 0,
  steerCX: 0,
  steerCY: 0,
  aim: null,
  dist: 0,
  paused: 0,
  usedTouch: 0,
  pauseLeakFixed: 0,
  steerLive: 0,
  joyMode: 1,
  adopts: 0,
  elPd: 0,
  winPd: 0,
  pCancel: 0,
  winTs: 0,
  winTm: 0,
  shadow: 0,
};

/**
 * matchMedia 결과를 진단판에 그대로 싣기 위한 것(1/0/-1=조회불가).
 * ★ 캐시한다 — 매 프레임 호출되는데 matchMedia 는 호출마다 객체를 새로 만든다.
 */
const mediaCache = new Map<string, number>();
export function diagMedia(q: string): number {
  const hit = mediaCache.get(q);
  if (hit !== undefined) return hit;
  let r: number;
  try {
    r = window.matchMedia(q).matches ? 1 : 0;
  } catch {
    r = -1;
  }
  mediaCache.set(q, r);
  return r;
}

function targetName(t: EventTarget | null): string {
  if (!t) return 'null';
  if (t === window) return 'window';
  const el = t as HTMLElement;
  if (!el.tagName) return 'other';
  return el.tagName + (el.id ? '#' + el.id : '');
}

export interface TouchVisual {
  stickActive: boolean;
  originX: number;
  originY: number;
  knobX: number;
  knobY: number;
  boostX: number;
  boostY: number;
  boostR: number;
  boostHeld: boolean;
  visible: boolean;
  /** 질주 버튼을 잡은 «그 손가락»이 동시에 조종 중인가. ★겸직이 없어져 항상 false. */
  boostSteer: boolean;
  /**
   * 「여기를 밀면 된다」 유령 스틱의 위치와 진하기(0=안 그림).
   * 이 게임의 조이스틱은 «손가락이 닿은 곳에» 생겨서, 손을 대기 «전»에는
   * 화면 어디에도 조종 어포던스가 없다. 한 판에 한 번, 조용히 알려준다.
   */
  hintX: number;
  hintY: number;
  hintAlpha: number;
}

export class Input {
  mode: ControlMode = 'joystick';
  /** 조종 목표 각도. null 이면 «지금 방향을 유지». */
  aimAngle: number | null = null;
  boosting = false;

  /**
   * 손가락으로 하는 기기인가 — 조작 안내와 터치 컨트롤 표시를 고르는 데 쓴다.
   * ★ 기기 특성으로 «먼저» 판정한다. 토스 미니앱은 모바일 전용이라 첫 터치를
   *   기다렸다 켜면 첫 판에서 컨트롤이 아예 안 보인다.
   */
  usedTouch = isCoarsePointerDevice();

  /** 머리의 «화면» 좌표(css px). main 이 매 프레임 채운다. drag 모드가 이걸 쓴다. */
  headSX = 0;
  headSY = 0;

  onPauseRequest: (() => void) | null = null;

  readonly visual: TouchVisual = {
    stickActive: false, originX: 0, originY: 0, knobX: 0, knobY: 0,
    boostX: 0, boostY: 0, boostR: 44, boostHeld: false, visible: false,
    boostSteer: false, hintX: 0, hintY: 0, hintAlpha: 0,
  };

  private el: HTMLElement;

  // 화면·안전영역(resize 가 채운다). 가장자리 보정에만 쓴다.
  private scrW = 0;
  private scrH = 0;
  private safeL = 0;
  private safeR = 0;
  private safeB = 0;
  /** 미니맵 위쪽 경계 y(css px). 0 = 정보 없음. 우하단 HUD 회피에만 쓴다. */
  private minimapTop = 0;

  // ── 조종 포인터 «하나» ────────────────────────────────────────────────────
  // 땅따먹기의 `pointer = { id, ox, oy, x, y, down }` 과 같은 구조다.
  private steerId = -1;
  private steerOX = 0;   // 스틱 원점(따라온다)
  private steerOY = 0;
  private steerCX = 0;   // 손가락 현재 위치
  private steerCY = 0;
  /** 이 제스처에서 «한 번이라도» 데드존을 벗어났는가(히스테리시스). */
  private steerLive = false;
  /** 마지막으로 확정된 조종각. 데드존 안으로 되돌아와도 이 값을 유지한다. */
  private steerAngle = 0;

  // ── 질주 포인터 «하나» ────────────────────────────────────────────────────
  /**
   * ★ 조종이 아닌 «아무» 포인터나 질주다(버튼 위든 아니든).
   *   질주 손가락은 조종에 «절대» 관여하지 않는다 — 겸직·전환·승격 없음.
   *   그 겸직이 예전 판에서 조작 불능 구역과 「두 엄지 중 하나를 떼면 조종이
   *   죽는」 고장을 만든 자리다(2026-09-05 실측 ⑤ 6/6).
   */
  private boostId = -1;

  /**
   * ════════════════════════════════════════════════════════════════════════
   * ★★ 2026-09-07 실사고 대응 — 「아이폰에서 조종스틱이 안 먹는다」.
   *
   *   증상: 게임 중인데 스틱이 «쉬는 유령 힌트»로만 그려지고 뱀은 직진.
   *   = steerId 가 -1 이라는 뜻이다. 포인터가 시작조차 못 했거나, 시작한 뒤
   *     pointercancel 로 즉시 끊겼거나 둘 중 하나다.
   *
   *   iOS WKWebView(+ RN 호스트 스크롤뷰)에서는 CSS touch-action 만으로
   *   제스처를 못 지키는 경우가 있다. 몇 px 팬이 먹히는 순간 네이티브가
   *   제스처를 «가져가고» 브라우저는 pointercancel 을 준다.
   *   ⇒ 방어 셋을 «상태를 늘리지 않고» 넣는다:
   *      ① window 캡처 touchmove(passive:false) 로 네이티브 팬을 막는다
   *         — 좌표 계산에는 쓰지 않는다. «차단 전용»이다.
   *      ② window 캡처 pointerdown — 캔버스가 pointerdown 을 못 받는 경로가
   *         실기기에 실재한다(8/25 실측: EL touchstart=0 / WIN touchstart=1).
   *      ③ pointercancel 을 «즉시 놓음»으로 쓰지 않는다. 손가락이 정말
   *         떨어졌는지는 touchend/touchcancel 이 알려 준다. 그 사이는
   *         window touchmove 의 좌표로 조향을 «이어간다»(그림자 좌표).
   *
   *   ⛔ 이건 B2 의 «구조대»가 아니다. 역할 재배정·채택·자가치유를 만들지
   *     않는다. 좌표 공급원이 하나 늘어날 뿐이고, 조종 포인터는 여전히 하나다.
   * ════════════════════════════════════════════════════════════════════════
   */
  /** pointercancel 이 왔지만 «손가락은 아직 붙어 있다»고 보는 상태. */
  private steerShadow = false;
  /** 질주 손가락의 현재 위치. ★버튼을 «눌린 것처럼» 그릴지 정하는 데만 쓴다. */
  private boostPX = 0;
  private boostPY = 0;

  // ── 마우스(데스크톱) ──────────────────────────────────────────────────────
  private mouseX = 0;
  private mouseY = 0;
  private mouseIn = false;
  private mouseDown = false;

  // ── 키보드 ────────────────────────────────────────────────────────────────
  private keyBoost = false;

  private paused = false;

  /** 이 판에서 «한 번이라도» 방향을 준 적이 있는가. 유령 스틱을 끄는 조건. */
  private steeredThisRun = false;

  constructor(el: HTMLElement) {
    this.el = el;
    this.attach();
  }

  /** 조작 방식이 «터치»로 판정되는가(안내 문구·컨트롤 표시용). */
  get isTouch(): boolean {
    return this.usedTouch;
  }

  /**
   * @param minimapTop 미니맵 상단 y(css px). 부스트 버튼은 «그 위»에 놓는다.
   *
   * ★ 처음엔 화면 높이의 비율(0.21)로 띄웠는데, 390x844 실기기 스크린샷에서
   *   버튼 아래 「질주」 라벨이 미니맵을 덮었다. 비율은 «두 요소의 실제 크기»를
   *   모른다 - 미니맵 위치를 «받아서» 계산해야 어떤 화면비에서도 안 겹친다.
   */
  resize(
    w: number, h: number, safeR: number, safeB: number, minimapTop: number,
    safeL = 0,
  ): void {
    // ★ 가장자리 보정(placeOrigin)이 쓸 화면·안전영역을 기억한다.
    this.scrW = w;
    this.scrH = h;
    this.safeL = safeL;
    this.safeR = safeR;
    this.safeB = safeB;
    this.minimapTop = minimapTop;
    const r = Math.max(38, Math.min(56, Math.min(w, h) * 0.075));
    this.visual.boostR = r;
    this.visual.boostX = w - r - 26 - safeR;
    const above = minimapTop - r - 30;
    const fallback = h - r - 26 - safeB - Math.min(w, h) * 0.21;
    this.visual.boostY = minimapTop > 0 ? Math.max(r + 20, above) : fallback;
    /**
     * 조이스틱의 «기본 자리»(안내용). 질주 버튼의 좌우 대칭 위치다.
     * ★ 좌하단인 이유: 오른손 엄지 자리는 이미 질주 버튼이 쓴다.
     *   조종 자체는 여전히 «화면 어디서나» 된다 - 이건 기본 자리이지 제약이 아니다.
     * ⛔ 시각 전용 값이다. 조종 활성 영역·각도·데드존과는 무관하다.
     */
    this.visual.hintX = 26 + STICK_MAX + safeL;
    this.visual.hintY = this.visual.boostY;
  }

  /**
   * 새 판이 시작됐다.
   *
   * ★ 하는 일은 «상태 리셋»뿐이다(땅따먹기와 같다).
   *   얹혀 있던 손가락을 이어받거나, 유예를 걸거나, 원점을 못박지 «않는다».
   *   그 손가락은 다음 pointerdown 에서 새 원점으로 살아난다.
   *
   * ★ paused 를 여기서 «무조건» 푸는 것만은 유지한다.
   *   main.ts 는 여러 곳에서 setPaused(true) 를 거는데 해제 지점은 한 곳뿐이라,
   *   「일시정지 → 그만두기 → 메뉴」로 빠지면 input.paused 가 true 로 «굳었다».
   *   그러면 그 뒤 «모든» 판에서 조작이 죽는다(실측 260903: warm 경로 56/56 실패).
   *   「판이 시작됐다」와 「조작이 살아 있다」는 예외 없이 같은 뜻이므로 여기서 푼다.
   */
  beginRun(): void {
    this.steeredThisRun = false;
    if (this.paused) DIAG.pauseLeakFixed++;
    this.paused = false;
    this.release();
  }

  /**
   * @param p 일시정지 진입/해제.
   * ★ 해제할 때 «아무것도 되살리지 않는다». 닿아 있던 손가락은 뗐다 다시 대면
   *   새 원점으로 잡힌다. 되살리는 층이 바로 이 파일이 1,375줄이 된 이유다.
   */
  setPaused(p: boolean): void {
    this.paused = p;
    if (p) this.release();
  }

  /** 모든 조작 상태를 놓는다. */
  private release(): void {
    this.steerId = -1;
    this.steerLive = false;
    this.steerShadow = false;
    this.boostId = -1;
    this.mouseDown = false;
    this.keyBoost = false;
    this.boosting = false;
    this.visual.stickActive = false;
    this.visual.boostHeld = false;
  }

  /**
   * 스틱 원점을 «놓을 자리»를 정한다 — 가장자리 보정(border case).
   *
   *   ═══════════════════════════════════════════════════════════════════
   *   ★ 왜 필요한가: 원점이 «고정»이 되는 순간 「링이 화면 밖으로 잘리는」
   *     경우가 생긴다. 예전에는 원점이 손가락을 따라오면서 저절로 안쪽으로
   *     들어왔지만, 이제는 닿은 자리에 그대로 못 박히기 때문이다.
   *     화면 모서리를 잡은 사람에게 «반쪽짜리 링»을 보여 주면, 어디까지
   *     밀 수 있는지가 화면에서 사라진다.
   *
   *   ★ 순서가 중요하다:
   *     ① 질주 버튼 밖으로 밀어낸다 — 두 컨트롤이 겹치면 「무엇을 누른
   *        것인가」가 사라진다. 질주는 되돌릴 수 없는 자원 소모라 절대
   *        흐려지면 안 된다.
   *     ② 화면(안전영역) 안으로 당긴다 — 링 «전체»가 들어와야 한다.
   *     ③ ②가 다시 버튼 위로 밀어 넣었으면 «가로»로만 비켜난다.
   *        세로는 위에 순위표, 아래에 미니맵이 있어 여유가 없다.
   *   ★ 밀린 원점은 손가락과 떨어져 있으므로 «즉시» 방향이 나온다.
   *     그게 맞다 — 모서리를 잡은 손가락은 이미 「안쪽으로 밀고 싶다」는 뜻이다.
   *   ═══════════════════════════════════════════════════════════════════
   */
  private placeOrigin(x: number, y: number): { x: number; y: number } {
    const v = this.visual;
    const minX = STICK_MAX + EDGE_PAD + this.safeL;
    const maxX = this.scrW - STICK_MAX - EDGE_PAD - this.safeR;
    const minY = STICK_MAX + EDGE_PAD;
    const maxY = this.scrH - STICK_MAX - EDGE_PAD - this.safeB;
    // 화면이 링보다 좁으면(이론상) 가운데로 — 클램프가 뒤집히는 것을 막는다.
    const roomX = maxX >= minX;
    const roomY = maxY >= minY;
    const clampX = (n: number) =>
      roomX ? Math.min(maxX, Math.max(minX, n)) : this.scrW / 2;
    const clampY = (n: number) =>
      roomY ? Math.min(maxY, Math.max(minY, n)) : this.scrH / 2;

    let ox = clampX(x);
    let oy = clampY(y);

    /** 질주 버튼과 «링이» 겹치지 않을 최소 중심거리. */
    const need = v.boostR + STICK_MAX;

    /**
     * ★ 두 회피 규칙(미니맵·질주 버튼)은 서로를 되밀 수 있다. 한 번씩만
     *   적용하면 나중 규칙이 앞 규칙을 무효화한다(실측: 우하단 모서리에서
     *   버튼 회피가 원점을 미니맵 위로 되돌려 놨다).
     *   ⇒ 두 규칙을 «수렴할 때까지» 돌린다. 3회면 충분하고, 3회로 끊어도
     *     최악은 「조금 덜 비켜난 자리」라 조작이 죽지 않는다(무한루프 없음).
     */
    for (let pass = 0; pass < 3; pass++) {
      /**
       * ① 미니맵 위에는 올리지 않는다.
       *   미니맵은 «우하단»에만 있고, 우리가 받은 정보는 그 위쪽 경계 하나뿐
       *   이다(minimapTop). 그래서 「화면 오른쪽 절반」에서만 건다 — 왼쪽
       *   아래는 미니맵이 없으므로 화면 끝까지 쓸 수 있어야 한다.
       */
      if (this.minimapTop > 0 && ox > this.scrW / 2) {
        oy = clampY(Math.min(oy, this.minimapTop - STICK_MAX));
      }

      /**
       * ② 질주 버튼 밖으로 밀어낸다. 두 컨트롤이 겹치면 「무엇을 누른
       *   것인가」가 사라진다 — 질주는 되돌릴 수 없는 자원 소모라 절대
       *   흐려지면 안 된다.
       */
      let dx = ox - v.boostX;
      let dy = oy - v.boostY;
      let d = Math.hypot(dx, dy);
      if (d >= need) break;                 // 둘 다 만족 — 끝.
      if (d < 0.001) {
        // 버튼 정중앙을 눌렀다 — 화면 안쪽(왼쪽)으로 내보낸다.
        dx = -1;
        dy = 0;
        d = 1;
      }
      ox = clampX(v.boostX + (dx / d) * need);
      oy = clampY(v.boostY + (dy / d) * need);

      /**
       * ③ 클램프가 다시 버튼 위로 밀어 넣었으면 «가로»로만 피한다.
       *   세로는 위에 순위표, 아래에 미니맵이 있어 여유가 없다.
       */
      if (roomX && Math.hypot(ox - v.boostX, oy - v.boostY) < need) {
        ox = clampX(v.boostX - need);
      }
    }
    return { x: ox, y: oy };
  }

  /** 질주 버튼 «표시»용 판정. 조작 분기에는 쓰지 않는다. */
  private inBoostButton(x: number, y: number): boolean {
    const v = this.visual;
    const dx = x - v.boostX;
    const dy = y - v.boostY;
    const r = v.boostR * BOOST_HIT_SCALE;
    return dx * dx + dy * dy <= r * r;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 이벤트 — 포인터 4종 «만». 캔버스에만 단다.
  //
  // ⛔ window 리스너·터치 이벤트 리스너·구조대 경로를 «다시 만들지 마라».
  //   창 단계에서 손가락을 관찰하기 시작한 순간부터 「이 손가락은 누구 것인가」를
  //   매 프레임 판단해야 했고, 그 판단이 틀리는 방식으로만 고장이 났다.
  //   캔버스 밖에서 시작한 제스처는 «우리 것이 아니다». 그게 이 모델의 계약이다.
  // ══════════════════════════════════════════════════════════════════════════
  private attach(): void {
    const el = this.el;

    for (const k of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) {
      el.addEventListener(k, (e) => {
        const pe = e as PointerEvent;
        if (pe.pointerType !== 'mouse') {
          if (k === 'pointerdown') DIAG.elPd++;
          else if (k === 'pointercancel') DIAG.pCancel++;
        }
        this.onPointer(pe);
      }, { passive: false });
    }

    /**
     * ①' window 캡처 pointerdown — «캔버스가 못 받는 경우»의 보험.
     *   실기기 실측(2026-08-25)에서 캔버스에는 한 건도 안 오고 창에는 오는
     *   경로가 확인됐다. 캔버스 리스너가 정상이면 여기서 시작된 것과 같은
     *   pointerId 라 onPointer 가 «중복 시작하지 않는다»(steerId 검사).
     *   ⛔ 버튼·링크·열린 오버레이 위에서 시작한 손가락은 조종이 아니다.
     */
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      DIAG.winPd++;
      if (e.target === el) return;              // 정규 경로가 처리한다
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === 'function'
        && t.closest('button, a, input, select, textarea, label, [role="button"], [data-ui], .overlay:not(.hidden)')) {
        return;
      }
      this.onPointer(e);
    }, { capture: true });

    /**
     * ①'' window 캡처 touchmove — «네이티브 팬 차단 전용».
     *   조종/질주 포인터가 살아 있는 동안에는 브라우저·네이티브가 이 제스처를
     *   스크롤로 가져가지 못하게 막는다. 이게 없으면 몇 px 팬 뒤 제스처를
     *   빼앗기고 pointercancel 이 온다 = 조종이 끊긴다.
     *   ★ 그리고 «그림자 좌표»의 유일한 공급원이다(아래 pointercancel 처리).
     *   ⛔ 여기서 역할을 배정하지 않는다. 좌표만 흘려보낸다.
     */
    window.addEventListener('touchmove', (ev: Event) => {
      DIAG.winTm++;
      if (this.paused) return;
      if (this.steerId < 0 && this.boostId < 0) return;
      const e = ev as TouchEvent;
      if (this.steerShadow && e.touches && e.touches.length > 0) {
        // 포인터 스트림이 끊긴 동안에만 좌표를 여기서 받는다.
        const t = e.touches[0];
        this.steerCX = t.clientX;
        this.steerCY = t.clientY;
        DIAG.steerUpdates++;
      }
      if (e.cancelable) e.preventDefault();
    }, { passive: false, capture: true });

    /**
     * ①''' 손가락이 «정말» 떨어졌는지는 터치 이벤트가 알려 준다.
     *   pointercancel 뒤 보류 중인 조종을 여기서만 놓는다.
     */
    window.addEventListener('touchstart', () => { DIAG.winTs++; },
      { passive: true, capture: true });

    const endShadow = (ev: Event): void => {
      const e = ev as TouchEvent;
      if (!e.touches || e.touches.length > 0) return;   // 아직 남은 손가락이 있다
      if (this.steerShadow) {
        this.steerShadow = false;
        this.steerId = -1;
        this.steerLive = false;
        this.visual.stickActive = false;
      }
      this.boostId = -1;
    };
    window.addEventListener('touchend', endShadow, { passive: true, capture: true });
    window.addEventListener('touchcancel', endShadow, { passive: true, capture: true });

    /**
     * ★ 마우스는 «창» 기준으로 따라간다. 캔버스에만 붙이면 커서가 HUD 요소
     *   (pointer-events:auto 인 일시정지 버튼) 위로 갈 때 조준이 멎는다.
     *   ⚠ 이 두 개는 «마우스 전용»이다. 손가락은 절대 여기로 들어오지 않는다.
     */
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouseIn = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
    // 캔버스 밖에서 버튼을 떼도 질주가 풀리게 한다(안 하면 눌린 채 굳는다).
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse') this.mouseDown = false;
    });
    window.addEventListener('pointercancel', (e) => {
      if (e.pointerType === 'mouse') this.mouseDown = false;
    });

    // ★ 컨텍스트 메뉴를 막지 않으면 데스크톱에서 «우클릭 부스트»가 메뉴를 띄운다.
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'ShiftLeft') {
        this.keyBoost = true;
        e.preventDefault();
      } else if (e.code === 'Escape' || e.code === 'KeyP') {
        this.onPauseRequest?.();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'ShiftLeft') {
        this.keyBoost = false;
        e.preventDefault();
      }
    });

    /**
     * ⛔ `window blur → releaseAll` 을 «다시 넣지 마라». 실측으로 뺐다.
     *
     *   예전 판에는 있었다(질주가 눌린 채 굳는 것을 막으려고). 그런데 이 모델은
     *   되살리는 층이 «없으므로», blur 로 상태를 놓으면 그 손가락은 뗐다 다시
     *   댈 때까지 «영영» 조종을 못 한다.
     *   실측(2026-09-06, tools/qa_joystick_reassign.py, 6회씩):
     *     blur 리스너 «있을 때»  ⑥ blur 1회 6/6 조종불능 · ⑦ blur 폭풍 6/6 조종불능
     *     blur 리스너 «없을 때»  ⑥ 0/6 · ⑦ 0/6                (아래 표 참고)
     *   ⇒ blur 는 「손가락이 떨어졌다」가 아니다. 손가락이 떨어지면 브라우저가
     *     pointerup/pointercancel 을 «준다». 그걸 믿는다.
     *   ★ 땅따먹기도 이 리스너가 없다. 같은 플랫폼에서 문제 없이 돌고 있다.
     */
  }

  /**
   * 포인터 하나로 전부 처리한다. 땅따먹기 `onPointer` 와 같은 뼈대.
   */
  private onPointer(e: PointerEvent): void {
    DIAG.el[e.type] = (DIAG.el[e.type] || 0) + 1;
    DIAG.lastKind = e.type;
    DIAG.lastX = e.clientX;
    DIAG.lastY = e.clientY;
    DIAG.lastTarget = targetName(e.target);
    DIAG.lastCancelable = e.cancelable ? 1 : 0;

    // ── 마우스는 «조준»으로만 쓴다(조이스틱을 만들지 않는다) ──
    if (e.pointerType === 'mouse') {
      this.mouseIn = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (e.type === 'pointerdown') this.mouseDown = true;
      if (e.type === 'pointerup' || e.type === 'pointercancel') this.mouseDown = false;
      e.preventDefault();
      return;
    }

    if (this.paused) return;
    this.usedTouch = true;

    const x = e.clientX;
    const y = e.clientY;

    if (e.type === 'pointerdown') {
      /**
       * ★ 보류(그림자) 중에 «새 손가락»이 닿으면 그 보류는 끝난 것이다.
       *   안 그러면 그림자가 안 풀리는 환경에서 조종이 영영 막힌다 —
       *   지금 고치고 있는 고장과 «같은 종류»의 고장을 새로 만드는 셈이다.
       */
      if (this.steerShadow) {
        this.steerShadow = false;
        this.steerId = -1;
        this.steerLive = false;
        this.visual.stickActive = false;
      }
      if (this.steerId === -1) {
        /**
         * 첫 손가락 = 조종. 닿은 그 자리가 원점이고, 놓을 때까지 «안 움직인다».
         * 가장자리·질주 버튼에 걸리면 placeOrigin 이 안쪽으로 밀어 준다.
         */
        const o = this.placeOrigin(x, y);
        this.steerId = e.pointerId;
        this.steerOX = o.x;
        this.steerOY = o.y;
        this.steerCX = x;
        this.steerCY = y;
        this.steerLive = false;
        DIAG.steerAssigns++;
        try {
          this.el.setPointerCapture(e.pointerId);
        } catch {
          // 캡처를 못 잡아도 게임은 굴러가야 한다.
        }
      } else if (this.boostId === -1) {
        /**
         * ★ 두 번째 손가락 = 질주. «어디를 눌렀든» 상관없다.
         *   버튼 위를 정확히 짚어야만 질주가 되면, 엄지가 조금 빗나갔을 때
         *   「눌렀는데 아무 일도 안 일어나는」 구역이 생긴다. 예전 판이 그
         *   구역을 없애려고 겸직을 넣었다가 다른 고장을 만들었다.
         *   두 번째 손가락은 질주 말고 할 일이 없으므로 이게 가장 단순하다.
         */
        this.boostId = e.pointerId;
        this.boostPX = x;
        this.boostPY = y;
        try {
          this.el.setPointerCapture(e.pointerId);
        } catch {
          /* 무시 */
        }
      }
      // 세 번째 이후 손가락은 «아무 일도 하지 않는다». 상태를 늘리지 않는다.
      e.preventDefault();
      return;
    }

    if (e.type === 'pointermove') {
      if (e.pointerId === this.boostId) {
        // ★ 질주 손가락의 이동은 조종에 «아무 영향도 없다». 버튼을 눌린 것처럼
        //   그릴지만 정한다(끌어내면 불이 꺼지되 질주는 계속된다 - 정직하다).
        this.boostPX = x;
        this.boostPY = y;
        return;
      }
      if (e.pointerId !== this.steerId) return;
      this.steerCX = x;
      this.steerCY = y;
      DIAG.steerUpdates++;
      e.preventDefault();
      return;
    }

    // pointerup / pointercancel
    if (e.pointerId === this.steerId) {
      /**
       * ★★ pointercancel 은 「손가락이 떨어졌다」가 «아니다».
       *   iOS 에서는 네이티브가 제스처를 가져갈 때도 온다. 그걸 놓음으로
       *   처리하면 조종이 즉시 죽는다 — 그게 이번 실사고의 증상과 같다.
       *   ⇒ 보류하고, window touchmove 의 좌표로 조향을 «이어간다».
       *     진짜 놓음은 touchend/touchcancel(손가락 0개)이 확정한다.
       *   ★ touch 이벤트가 아예 없는 환경(포인터만 오는 브라우저)에서는
       *     보류가 영영 안 풀릴 수 있다 — 그래서 «터치가 있는 기기»에서만
       *     보류한다. 없으면 예전처럼 즉시 놓는다.
       */
      const hasTouch = typeof window !== 'undefined' && 'ontouchstart' in window;
      if (e.type === 'pointercancel' && hasTouch) {
        this.steerShadow = true;
      } else {
        this.steerShadow = false;
        this.steerId = -1;
        this.steerLive = false;
        this.visual.stickActive = false;
      }
    } else if (e.pointerId === this.boostId) {
      this.boostId = -1;
    }
    e.preventDefault();
  }

  /** 진단판이 읽을 내부 상태를 노출한다. 읽기 전용 복사 — 로직에 영향 없다. */
  private snapshotDiag(): void {
    DIAG.steerId = this.steerId;
    DIAG.boostId = this.boostId;
    DIAG.activeN = (this.steerId >= 0 ? 1 : 0) + (this.boostId >= 0 ? 1 : 0);
    DIAG.extraN = 0;
    DIAG.stickActive = this.visual.stickActive ? 1 : 0;
    DIAG.steerOX = this.steerOX;
    DIAG.steerOY = this.steerOY;
    DIAG.steerCX = this.steerCX;
    DIAG.steerCY = this.steerCY;
    DIAG.paused = this.paused ? 1 : 0;
    DIAG.usedTouch = this.usedTouch ? 1 : 0;
    DIAG.steerLive = this.steerLive ? 1 : 0;
    DIAG.joyMode = this.mode === 'joystick' ? 1 : 0;
    DIAG.shadow = this.steerShadow ? 1 : 0;
  }

  /** 매 프레임 호출. aimAngle/boosting 을 갱신한다. */
  update(): void {
    this.snapshotDiag();
    if (this.paused) {
      this.boosting = false;
      this.aimAngle = null;
      DIAG.aim = null;
      DIAG.dist = -1;
      return;
    }

    let angle: number | null = null;

    if (this.steerId >= 0) {
      if (this.mode === 'joystick') {
        const dx = this.steerCX - this.steerOX;
        const dy = this.steerCY - this.steerOY;
        const len = Math.hypot(dx, dy);
        DIAG.dist = len;

        /**
         * ★★ 무한 조향 — 각도는 «거리와 무관하게» 낸다.
         *   손가락이 링 밖 200px 에 있어도 atan2 는 멀쩡하다. 고정 원점의
         *   유일한 약점(「끝까지 밀면 더 못 민다」)이 이 한 줄로 사라진다.
         *   ⛔ len 을 클램프한 «뒤»의 벡터로 각도를 내지 마라. 클램프는 노브를
         *     그리기 위한 것이지 방향을 정하는 것이 아니다.
         */
        if (len > DEADZONE) {
          this.steerLive = true;
          this.steerAngle = Math.atan2(dy, dx);
        }
        /**
         * 히스테리시스: 한 번 «의도»가 잡히면 손가락이 원점 근처로 돌아와도
         * 마지막 방향을 유지한다. 안 하면 원점 부근을 오갈 때 조종이 뚝뚝
         * 끊겨(angle=null → 직진) 「밀었는데 안 먹는다」로 느껴진다.
         */
        if (this.steerLive) angle = this.steerAngle;

        this.visual.stickActive = true;
        this.visual.originX = this.steerOX;
        this.visual.originY = this.steerOY;
        /**
         * ★ 노브 표시 — 데드존 «경계»에서 0 으로 시작해 KNOB_MAX(46) 까지
         *   선형으로 늘어난다.
         *   ⛔ 데드존을 그냥 무시하고 len 을 그대로 쓰면, 데드존을 넘는 순간
         *     노브가 0 에서 6px 로 «튄다». 눈에 보이는 점프다.
         *   그래서 (len - DEADZONE) 을 (KNOB_MAX - DEADZONE) 으로 정규화한다.
         *   ⇒ len = DEADZONE 에서 0, len ≥ KNOB_MAX 에서 46, 그 사이는 연속.
         */
        const t = len <= DEADZONE
          ? 0
          : Math.min(1, (len - DEADZONE) / (KNOB_MAX - DEADZONE));
        const kr = t * KNOB_MAX;
        const ux = len > 0 ? dx / len : 0;
        const uy = len > 0 ? dy / len : 0;
        this.visual.knobX = this.steerOX + ux * kr;
        this.visual.knobY = this.steerOY + uy * kr;
      } else {
        // drag 모드: 손가락이 «가리키는 지점»으로 머리가 향한다.
        const dx = this.steerCX - this.headSX;
        const dy = this.steerCY - this.headSY;
        const len = Math.hypot(dx, dy);
        DIAG.dist = len;
        if (len > DRAG_DEADZONE) angle = Math.atan2(dy, dx);
        this.visual.stickActive = false;
      }
    } else {
      DIAG.dist = -1;
      this.visual.stickActive = false;
      if (this.mouseIn) {
        // ★ 머리 «화면 위치» 기준으로 겨눈다. 화면 중앙 기준으로 하면 부스트 중
        //   카메라가 앞을 볼 때 커서 방향과 실제 진행 방향이 어긋난다.
        const dx = this.mouseX - this.headSX;
        const dy = this.mouseY - this.headSY;
        if (Math.hypot(dx, dy) > 6) angle = Math.atan2(dy, dx);
      }
    }

    this.aimAngle = angle;
    DIAG.aim = angle;

    this.boosting = this.keyBoost || this.mouseDown || this.boostId >= 0;

    // 버튼이 «눌린 것처럼» 보이는 조건 — 표시 전용이다(조작 분기 아님).
    this.visual.boostHeld =
      this.boostId >= 0 && this.inBoostButton(this.boostPX, this.boostPY);
    this.visual.boostSteer = false;
    this.visual.visible = this.usedTouch;

    if (angle !== null) this.steeredThisRun = true;
    /**
     * 유령 스틱: 「아직 한 번도 방향을 안 줬고, 지금 조종 중이 아닐 때」만 뜬다.
     * ★ 시간 타이머를 쓰지 않는다. 실력이 아니라 «이해»의 문제라, 이해한 순간
     *   (=처음 방향을 준 순간) 사라지는 것이 맞다.
     */
    this.visual.hintAlpha =
      !this.steeredThisRun && !this.visual.stickActive && this.usedTouch ? 1 : 0;
  }
}
