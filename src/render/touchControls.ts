// touchControls.ts — 터치 조작 UI(화면 좌표계). 캔버스에 직접 그린다.
//
// ★ DOM 이 아니라 캔버스인 이유: 조이스틱은 «손가락을 따라» 매 프레임 움직인다.
//   DOM 으로 하면 프레임마다 style.transform 을 쓰게 되고, 레이아웃/합성이
//   게임 루프와 어긋나 스틱이 손가락보다 한 박자 늦게 따라온다(체감상 「끈적함」).
//   같은 캔버스 프레임 안에서 그리면 항상 «정확히 같은 프레임»에 붙는다.
//
// ★ 조작 UI 는 «투명도»가 중요하다. 진하면 화면을 가리고, 너무 옅으면
//   어디를 눌러야 할지 모른다. 눌리는 동안만 진해지게 했다.

// ★ 대비는 «배경을 가정하지 않고» 확보한다. 이 UI 는 매 프레임 배경이 바뀌는
//   오버레이라, 밝은 먹이 무리나 남의 뱀 위에 얹히면 반투명 노란 원과 흰 글자가
//   그대로 묻힌다(실측: 390x652 첫 화면에서 「질주」 라벨이 분홍 뱀 위에 겹쳐 읽히지 않음).
//   해법은 blur 가 아니라 «불투명한 어두운 받침»이다 - backdrop-filter 는
//   게임 루프와 GPU 를 나눠 쓰므로 60fps 조건에서 쓸 수 없다. 원 한 장은 비용이 0 에 가깝다.

import { rgba } from './color';
import { STICK_MAX, KNOB_MAX, DIAG, diagMedia, type TouchVisual, DIAG_ENABLED } from '../input';

// ═══════════════════════════════════════════════════════════════════════════
// 터치 진단 오버레이 (2026-08-25)
//
// ★ 이 판은 «진단 전용»이다. 검수·출시에 올리지 않는다.
//   두 번 고쳤고 두 번 다 실기기에서 실패했다. 로컬에서 재현이 안 되는 상태로
//   또 고치면 그건 뽑기다. 그래서 «고치는 대신» 기기가 스스로 말하게 한다.
//
// ★ 조건부(?diag=1)로 만들지 않는다 — President 는 토스 미니앱에서
//   쿼리스트링을 붙일 방법이 없다. 항상 켠다.
//
// ★ DOM 을 새로 만들지 않는다. 게임 캔버스에 같은 프레임으로 그린다.
//   (DOM 오버레이는 그 자체가 터치를 가로챌 수 있어 «진단 대상을 오염»시킨다.
//    지금 의심 목록에 「무언가가 터치를 가로챈다」가 들어 있으므로 특히 금물.)
//
// ★ qa_ui.py 의 HUD 겹침·터치타깃 검사는 «DOM 노드»만 훑는다(document.querySelectorAll).
//   이 판은 캔버스 픽셀이라 그 검사에 애초에 잡히지 않는다 — 검사를 끄거나
//   예외를 넣을 필요가 없다. 확인함: tools/qa_ui.py 의 AUDIT/OVERLAP 둘 다 DOM 기반.
// ═══════════════════════════════════════════════════════════════════════════

/** getBoundingClientRect 는 레이아웃을 강제한다. 매 프레임 부르지 않는다. */
let rectCache = { t: -1e9, l: 0, y: 0, w: 0, h: 0 };

function canvasRect(cv: HTMLCanvasElement): { l: number; y: number; w: number; h: number } {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - rectCache.t > 500) {
    const r = cv.getBoundingClientRect();
    rectCache = { t: now, l: r.left, y: r.top, w: r.width, h: r.height };
  }
  return rectCache;
}

function n1(x: number): string {
  return Number.isFinite(x) ? x.toFixed(1) : '?';
}

/**
 * 「지금 무엇이 고장 났는가」를 «한 줄»로 말한다.
 *
 * ★ 숫자만 던지면 사진을 받아도 또 해석 싸움이 된다. 판정 규칙을 코드에 박아
 *   기기가 결론까지 내게 한다. 순서가 곧 «배제 순서»다 — 위쪽이 참이면
 *   아래 항목은 볼 필요가 없다.
 */
function verdict(): string {
  const el = DIAG.el;
  const wi = DIAG.win;
  const elDown = el.touchstart + el.pointerdown;
  const wiDown = wi.touchstart + wi.pointerdown;
  const elMove = el.touchmove + el.pointermove;
  const wiMove = wi.touchmove + wi.pointermove;
  const tc = el.touchcancel + el.pointercancel > 0 ? ' [CANCEL' + (el.touchcancel + el.pointercancel) + ']' : '';

  // ★ window 카운터에는 「시작」 버튼(DOM) 탭이 반드시 1~2건 섞인다.
  //   그걸 「캔버스를 우회했다」로 읽으면 매번 오진한다 - 여유를 두고 가른다.
  //   (실측으로 걸렸다: 마우스로 시작한 판이 A 가 아니라 B 로 나왔다.)
  if (elDown === 0 && wiDown <= 2) return 'A) NO INPUT EVENTS AT ALL (win' + wiDown + ')';
  if (elDown === 0) return 'B) CANVAS GETS 0, WIN d' + wiDown + ' m' + wiMove;
  if (elMove === 0 && wiMove === 0) return 'C) DOWN OK, NO MOVE EVENTS' + tc;
  if (elMove === 0) return 'D) MOVE BYPASSES CANVAS (win m' + wiMove + ')' + tc;
  if (DIAG.steerAssigns === 0) return 'E) FINGER ASSIGN FAIL (never steer)' + tc;
  if (DIAG.steerUpdates === 0) return 'F) COORD UPDATE FAIL (move!=steerId)' + tc;
  if (DIAG.steerId < 0) return 'G) STEER LOST mid-gesture' + tc;
  if (DIAG.aim === null) return 'H) DEADZONE/ANGLE d=' + n1(DIAG.dist) + tc;
  return 'OK aim=' + n1(DIAG.aim) + ' d=' + n1(DIAG.dist) + tc;
}

function drawTouchDiag(ctx: CanvasRenderingContext2D): void {
  const cv = ctx.canvas;
  // CSS 크기는 renderer 가 style 에 직접 박아 둔다 — 파싱이 레이아웃보다 싸다.
  const csw = parseFloat(cv.style.width) || window.innerWidth;
  const csh = parseFloat(cv.style.height) || window.innerHeight;
  const rc = canvasRect(cv);
  const vv = window.visualViewport;
  const el = DIAG.el;
  const wi = DIAG.win;

  // ★ 줄 순서는 «중요도 내림차순»이다. 사진이 잘리거나 무언가에 가려도
  //   맨 위 두 줄(판정·빌드ID)만 살아 있으면 최소한의 결론은 난다.
  const lines = [
    '>> ' + verdict(),
    '# ' + DIAG.build + '  path=' + DIAG.path,
    'ELt ts' + el.touchstart + ' tm' + el.touchmove + ' te' + el.touchend + ' tc' + el.touchcancel,
    'ELp d' + el.pointerdown + ' m' + el.pointermove + ' u' + el.pointerup +
      ' c' + el.pointercancel + ' lost' + el.lostpointercapture,
    'WIN ts' + wi.touchstart + ' tm' + wi.touchmove + ' te' + wi.touchend + ' tc' + wi.touchcancel +
      ' | pd' + wi.pointerdown + ' pm' + wi.pointermove,
    'cnt smv' + DIAG.steerUpdates + ' asg' + DIAG.steerAssigns + ' act' + DIAG.activeN +
      ' ex' + DIAG.extraN + ' bst' + DIAG.boostId + ' pau' + DIAG.paused,
    'stk id' + DIAG.steerId + ' O ' + n1(DIAG.steerOX) + ',' + n1(DIAG.steerOY) +
      ' C ' + n1(DIAG.steerCX) + ',' + n1(DIAG.steerCY),
    'aim ' + (DIAG.aim === null ? 'null' : n1(DIAG.aim)) + ' d' + n1(DIAG.dist) +
      ' stick' + DIAG.stickActive + ' used' + DIAG.usedTouch,
    'lst ' + DIAG.lastKind + ' cxl' + DIAG.lastCancelable +
      ' raw ' + n1(DIAG.lastX) + ',' + n1(DIAG.lastY) + ' @' + DIAG.lastTarget,
    'cvs ' + cv.width + 'x' + cv.height + ' css ' + n1(csw) + 'x' + n1(csh) +
      ' r' + n1(cv.width / Math.max(1, csw)) + '/' + n1(cv.height / Math.max(1, csh)) +
      ' mtp' + (navigator.maxTouchPoints || 0),
    'win ' + window.innerWidth + 'x' + window.innerHeight +
      ' dpr' + n1(window.devicePixelRatio || 0) +
      ' crs' + diagMedia('(pointer: coarse)') + ' hvn' + diagMedia('(hover: none)'),
    'vv  ' + (vv ? n1(vv.width) + 'x' + n1(vv.height) + '@' + n1(vv.offsetLeft) + ',' +
      n1(vv.offsetTop) + ' s' + n1(vv.scale) : 'none') +
      ' rect ' + n1(rc.l) + ',' + n1(rc.y) + ' ' + n1(rc.w) + 'x' + n1(rc.h),
  ];

  // ★ y 위치는 «측정해서» 정했다. 상단은 DOM HUD 가 캔버스 «위»에 떠 있어
  //   여기에 그리면 글씨가 통째로 가려진다(실측 390x652, tools 로 rect 조회):
  //     hud-score (8,8)-(154,45) / hud-pause (190,8)-(234,52) / hud-board (236,8)-(382,228)
  //     hud-hint  (84,366)-(305,430)  ← 5초짜리 조작 안내
  //   그래서 그 사이의 «빈 띠» y=232..364 를 쓴다. 지시의 「상단 1/3」에서
  //   조금 내려온 이유가 이것이다 — 1/3 안은 읽을 수가 없다.
  const LH = 10;
  const pad = 6;
  const TOP = 232;
  const w = Math.min(csw - 8, 384);
  const h = lines.length * LH + pad * 2;

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.fillRect(4, TOP, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(4.5, TOP + 0.5, w - 1, h - 1);

  ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (let i = 0; i < lines.length; i++) {
    // 0=자가판정(노랑) 1=빌드ID(초록) 나머지=흰색. 사진에서 눈이 갈 순서다.
    ctx.fillStyle = i === 0 ? '#ffd166' : i === 1 ? '#9fe870' : '#e6ecff';
    ctx.fillText(lines[i], 4 + pad, TOP + pad + i * LH);
  }
  ctx.restore();
}

// ── 팔레트 ─────────────────────────────────────────────────────────────────
// ★ CSS 토큰(src/ui/styles.css)과 «같은 색»이다. 캔버스와 DOM 이 서로 다른
//   색을 쓰면 한 화면이 두 제품처럼 보인다. 값을 바꿀 때는 양쪽을 같이 바꿔라.
//   PLATE  : 어떤 배경 위에서도 같은 대비를 만드는 받침(잉크 네이비).
//   EDGE   : 차가운 흰색 계열 — «방향»은 무채색이다(색은 질주에만 쓴다).
//   SIGNAL : 신호 앰버. 이 화면에서 유채색은 이것 «하나»뿐이다.
const PLATE = '#080b14';
const EDGE = '#d7e0f2';
const KNOB = '#f4f7fd';
const SIGNAL = '#ffb43c';
const OFF = '#7b8499';

/** 노브 반지름(css px). 히트 판정과 무관한 «시각» 값이다. */
const KNOB_R = 22;

// ═══════════════════════════════════════════════════════════════════════════
// 조이스틱 — 「보이는 기본 자리 + 잡은 곳으로 이동」 하이브리드 (2026-09-03)
//
// ★ 무엇이 문제였나 (President 실사용 보고)
//     「조이스틱이 안 보여서 불편해」
//   옛 설계는 «순수 플로팅»이었다 — 손가락이 닿아야 스틱이 생기고, 떼면
//   그 자리에서 즉시 사라진다. 어포던스가 화면에 «한 번도» 없는 셈이라
//   「어디를 잡아야 하는가」를 알 방법이 없었다. 유령 스틱(hint)이 있었지만
//   판마다 «첫 조종 한 번»으로 영구히 꺼져, 두 번째 판부터는 다시 빈 화면이다.
//   ⇒ 실측(BEFORE 1_rest.png): 390x844 쉴 때 화면 왼쪽 절반에 조작 UI 0개.
//
// ★ 표준은 무엇인가 — «추측이 아니라» nipplejs 1.0.4 소스를 읽고 뽑은 규격이다
//   (nipplejs = 웹 가상 조이스틱 사실상 표준. MIT · 주간 4.3만 다운로드 · 의존성 0).
//     1) 베이스는 «항상» 보인다(`restOpacity: 0.5`). 잡으면 진해진다.
//     2) 그래도 위치는 고정이 아니다 — 활성 영역 아무 데나 잡으면 베이스가
//        그 자리로 «옮겨 온다»(`semi` 모드). 고정형만 두면 엄지 위치가 강제돼
//        불편하고, 순수 플로팅은 어포던스가 사라진다. 그 중간이 표준이다.
//     3) 놓으면 노브가 중앙으로 «짧게» 돌아간다(`restJoystick: true`).
//   ⇒ 이 파일이 구현하는 것이 정확히 이 셋이다.
//
// ⛔ 라이브러리 «자체»는 쓸 수 없다 — dist/index.mjs 1행이
//   `window.PointerEvent ? {start:'pointerdown',…} : {start:'touchstart',…}`
//   이라 iOS WKWebView 에서 Pointer Events 경로를 탄다. 우리가 2026-09-03 에
//   실기기 조작 불능으로 «되돌린» 바로 그 경로다(구버전 0.10.2 도 `if (isPointer)`
//   로 같고, 옵션으로 끌 수 없다 — import 시점 모듈 상수다).
//   ⇒ 그래서 「동작 규격만 베낀다」로 갔다. 대조하면 입력 수학은 이미 같다:
//     각도 atan2 ✅ · 클램프 min(d,R) ✅ · 데드존 threshold .1×R50=5px vs 우리 4 ✅
//     · move/end 를 document 에 거는 것 = 우리 window 구조대 경로 ✅
//     부족했던 것은 «시각 규격» 셋뿐이었고, 그게 President 불만 그대로였다.
//
// ★ 한 곳만 표준과 «의도적으로» 다르다: nipplejs `semi` 는 놓아도 베이스를 그
//   자리에 남겨 둔다. 우리는 기본 자리로 되돌린다 — 우리 활성 영역은 화면
//   «전체»라(nipplejs 는 보통 좌측 zone 으로 제한한다) 남겨 두면 베이스가
//   순위표 옆이나 화면 꼭대기에 눌러앉는다. 「기본 자리」가 예측 가능해야
//   「항상 보이는 베이스」가 어포던스로 기능한다.
//
// ★ 왜 «렌더 층에만» 넣는가 (input.ts 를 안 건드리는 이유)
//   실기기 조작 불능을 세 번 고쳤고 세 번 다 실패했다. 마지막 시도(Pointer
//   Events 전면 재작성)는 헤드리스 869판을 통과하고도 iOS 에서 터치가 «아예»
//   안 먹어 통째로 되돌렸다. 즉 우리에겐 입력 경로를 검증할 수단이 없다.
//   ⇒ 시각 개선은 입력 경로를 «한 글자도» 건드리지 않고 얻어야 한다.
//     베이스 위치·복귀 애니메이션·진하기는 전부 여기 지역 상태로 끝난다.
//     input.ts 가 주는 것은 오늘과 똑같은 stickActive/origin/knob 뿐이다.
//
// ⛔ 활성 영역은 «넓히지도 좁히지도» 않았다. 지금도 질주 버튼 히트원을 뺀
//   화면 «전체»가 조종 영역이다(표준의 「좌측 절반」보다 관대하다). 좁히면
//   그건 조작감 변경이라 승인 없이 할 수 없다.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// ★★ 2026-09-04 알파 전면 상향 — President 실기기 「조이스틱은 여전히 없어」
//
//   ⛔내가 낸 「대비 10.8배·질주 버튼의 101%」는 «전부 틀린 값»이었다. 세 겹의
//     측정 오류였고, 셋 다 「헤드리스에서 보이니 됐다」로 이어졌다:
//     ① #stage 는 «투명 오버레이»다. 게임 월드는 #world·#glow 라는 «다른
//        캔버스»에 있고 브라우저가 합성한다. 그래서 #stage 에서 링 옆을 읽으면
//        배경이 «순수 검정»(0,0,0)으로 나온다 — 실측으로 확인했다.
//        ⇒ 나는 링을 «검정 위에서» 재고 있었다. 실제 배경은 아레나(#182052)와
//          밝은 뱀·먹이다.
//     ② getImageData 는 «비곱셈(unpremultiplied)» RGBA 를 준다. RGB 만 비교하면
//        알파가 통째로 빠진다 — 알파가 이 문제의 전부인데 그걸 버린 것이다.
//     ③ 「양성대조 통과(drag=1.0)」도 무의미했다. 링을 안 그리면 (0,0,0) vs
//        (0,0,0) 이라 당연히 1.0 이다. 대조군이 통과했다고 측정이 맞는 게 아니다.
//
//   ⇒ 합성을 «손으로» 계산해 다시 냈다(배경 6종 × 알파 합성):
//        현행 -29 선 대비 최악 1.13 : 1   ← 사실상 «비가시»
//        질주 버튼(쉴 때) 최악      2.96 : 1   ← President 가 한 번도 안 보인다 한 적 없음
//        ⇒ 조이스틱은 질주 버튼의 «38%» 밖에 안 보였다. 이게 원인이다.
//        (좌표·그리기 조건·그리는 순서는 전부 실측으로 기각했다 —
//         DPR 3 + safe-area 6개 기기 조건에서 베이스는 전부 화면 «안»이었다.)
//
// ★ 채택: «2톤 스트로크» — 어두운 후광 위에 밝은 선.
//   배경을 «가정하지 않는» 유일한 방법이다. 어두운 배경에서는 밝은 선이,
//   밝은 배경에서는 어두운 후광이 대비를 만든다. 같은 화면의 「질주」 라벨이
//   이미 이 기법을 쓴다(strokeText → fillText).
//   실측(합성 계산): 선 대비 최악 10.47 : 1 — 배경 6종에서 10.47~12.59 로
//   «거의 흔들리지 않는다». 질주 기준자의 354%.
//   받침은 오히려 «낮게»(.38) 둔다 — 링이 일을 하므로 아레나를 덜 가려도 된다.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 어두운 후광의 알파. 밝은 선 «아래» 한 겹 더 굵게 깔린다.
 * ★ 이 한 겹이 「밝은 뱀 위에서 흰 링이 사라지는」 고장을 원천 차단한다.
 */
const HALO_A = 0.85;
/** 후광이 밝은 선보다 이만큼 굵다(css px). */
const HALO_EXTRA = 2.8;

/** 쉴 때 베이스. 받침은 낮게, 선은 «확실히». */
const REST_PLATE_A = 0.38;
const REST_EDGE_A = 0.9;
const REST_LW = 2.2;
/** 쉴 때 중앙 표식 반지름. 노브(22)보다 «작게» — 「지금 중립」이라는 뜻이다. */
const REST_KNOB_R = 14;

/**
 * 잡았을 때. ★쉴 때→잡았을 때의 «진해짐»은 이제 «받침»이 담당한다
 *   (.38 → .58). 선은 둘 다 밝게 유지한다 — 선은 「여기 있다」를 말하는
 *   역할이고, 그건 쉴 때 «더» 중요하기 때문이다. 선을 쉴 때만 어둡게 하면
 *   정확히 지금 고치고 있는 그 버그로 되돌아간다.
 */
const ACT_PLATE_A = 0.58;
const ACT_EDGE_A = 0.95;
const ACT_LW = 2.4;

/** 최대치에 닿았을 때(=「더는 안 간다」). 밝기와 굵기를 «둘 다» 올린다. */
const MAX_EDGE_A = 1;
const MAX_LW = 3.4;

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★ 등장·소멸 모션 (2026-09-07 — 고정 원점 전환과 함께 다시 설계).
 *
 *   원점이 «고정»이 되면서 옛 복귀 애니메이션(놓은 자리에서 기본 자리로 날아감)
 *   은 말이 안 되게 됐다. 스틱은 이제 «닿은 자리에 생겼다가 그 자리에서 사라진다».
 *   날아가는 궤적은 「스틱이 돌아다닌다」는 인상을 다시 만든다 — 지금 없애려는
 *   바로 그 인상이다.
 *
 *   ⇒ 등장 120ms / 소멸 90ms. 소멸이 더 짧은 이유: 등장은 「여기 생겼다」를
 *     읽히게 해야 하지만, 소멸은 이미 끝난 조작의 잔상이라 빨리 비켜야 한다.
 *   ⇒ 바꾸는 것은 «투명도와 크기»뿐이다(캔버스에서는 globalAlpha + transform).
 *     반지름·좌표를 프레임마다 다시 계산하는 방식은 쓰지 않는다 — 그건 CSS 로
 *     치면 width/left 애니메이션이고, 이 UI 는 게임 루프와 GPU 를 나눠 쓴다.
 * ════════════════════════════════════════════════════════════════════════════
 */
const SPAWN_MS = 120;
const DESPAWN_MS = 90;
/** 등장 시작 배율. 0.92 — 「튀어나온다」가 아니라 「자리를 잡는다」로 읽히는 폭. */
const SPAWN_SCALE = 0.92;

/**
 * 「움직임을 줄여 달라」는 시스템 설정을 존중한다.
 * ★ 매 프레임 matchMedia 를 호출하지 않는다 — 호출마다 객체를 새로 만든다.
 *   설정이 세션 도중 바뀌는 경우는 무시한다(다음 판에 반영된다).
 */
let reducedMotion: boolean | null = null;
function prefersReducedMotion(): boolean {
  if (reducedMotion === null) {
    try {
      reducedMotion = typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      reducedMotion = false;
    }
  }
  return reducedMotion;
}

/**
 * 등장·소멸 애니메이션 상태. ★모듈 지역 변수다 — input.ts 로 새어 나가지 않는다.
 * 조이스틱은 화면에 «하나»뿐이므로 인스턴스가 필요 없다.
 */
const ret = {
  /** 지난 프레임에 스틱이 잡혀 있었는가. 잡는·놓는 «순간»을 잡아내는 데 쓴다. */
  was: false,
  /** 지난 프레임이 질주버튼 겸용이었는가. 그 제스처는 스틱을 안 그린다. */
  wasBoost: false,
  /** 소멸 시작 시각(ms). -1 = 소멸 중 아님. */
  t0: -1,
  /** 등장 시작 시각(ms). -1 = 등장 연출 끝. */
  s0: -1,
  /** 놓은 순간의 베이스 중심과 노브 위치 — 그 자리에서 사라진다. */
  bx: 0, by: 0, kx: 0, ky: 0,
  /** 마지막으로 «그린» 시각(ms). 그리기가 끊긴 것을 알아채는 데 쓴다. */
  seen: -1e9,
};

/**
 * 캔버스에서의 「transform + opacity」. 원점을 기준으로 배율만 걸고 알파를 곱한다.
 * ★ 레이아웃·재계산이 없다. save/restore 한 쌍과 setTransform 한 번이 비용 전부다.
 */
function withPop(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  scale: number, alpha: number, draw: () => void,
): void {
  if (scale === 1 && alpha === 1) {
    draw();
    return;
  }
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.translate(-x, -y);
  draw();
  ctx.restore();
}

/**
 * ★ 마지막으로 «실제로 그린» 조이스틱 기하. 검사기 전용 관측창이다.
 *
 *   왜 필요한가: 「정확한 조이스틱」을 감이 아니라 «숫자»로 증명해야 한다.
 *   두 가지를 이것으로만 잴 수 있다.
 *     1) 노브 추종 정확도 — 손가락 좌표와 «화면에 그려진» 노브의 어긋남(px).
 *        input.visual 을 읽으면 「계산된 값」이지 「그린 값」이 아니다.
 *     2) 복귀 애니메이션 — 160ms 는 스크린샷으로 못 잡는다(캡처 지연이 더 크다).
 *        rAF 마다 이 값을 읽으면 궤적이 그대로 나온다.
 *
 *   ⛔ 로직에 영향이 없다(쓰기 전용). 프레임당 숫자 5개 대입이 비용의 전부다.
 *   ⛔ window 에 스스로 붙지 않는다 — 노출은 main.ts 의 ?debug=1 블록에서만 한다.
 */
export const stickDrawn = {
  /** 베이스 중심(css px). */ bx: 0, by: 0,
  /** 노브 중심(css px). */   kx: 0, ky: 0,
  /** 0=쉴 때 1=잡은 상태. 복귀 중에는 그 사이 값. */ act: 0,
};

function perfNow(): number {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now() : Date.now();
}

/** ease-out cubic. 처음 빠르고 끝이 부드럽다 — 「제자리로 돌아갔다」로 읽힌다. */
function easeOut(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/**
 * 베이스 한 장. 쉴 때·잡았을 때·최대치가 «같은 함수»에서 나온다.
 *
 * ★ 같은 지오메트리를 쓰는 것이 핵심이다. 쉴 때와 잡았을 때의 크기가 다르면
 *   손가락을 대는 순간 링이 «커지거나 작아져» 위치가 어긋난 것처럼 보인다.
 *   달라지는 것은 «진하기»뿐이다 — 그래서 전환이 눈에 안 띈다.
 * ★ 값싸게 그린다: 호 2개(채움+선). 그림자·블러·backdrop 계열은 안 쓴다 —
 *   이 UI 는 게임 루프와 GPU 를 나눠 쓰고 60fps 가 절대 조건이다.
 */
function drawBase(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, plateA: number, edgeA: number, lw: number,
): void {
  ctx.beginPath();
  ctx.arc(x, y, STICK_MAX, 0, Math.PI * 2);
  ctx.fillStyle = rgba(PLATE, plateA);
  ctx.fill();
  // ★ 2톤: 어두운 후광을 «먼저» 굵게, 그 위에 밝은 선. 순서를 바꾸면 후광이
  //   선을 덮어 아무 일도 안 일어난다. 비용은 stroke() 한 번 추가가 전부다.
  ctx.lineWidth = lw + HALO_EXTRA;
  ctx.strokeStyle = rgba(PLATE, HALO_A);
  ctx.stroke();
  ctx.lineWidth = lw;
  ctx.strokeStyle = rgba(EDGE, edgeA);
  ctx.stroke();
}

/**
 * 교습 눈금 — 「이 링을 «밀어라»」.
 *
 * ★ 이제 링 자체는 항상 보이므로, 유령 스틱이 하던 「여기 있다」 역할은 끝났다.
 *   남은 역할은 「이건 누르는 게 아니라 미는 것이다」 하나뿐이라 눈금만 남긴다.
 * ★ 글자를 쓰지 않는다. 로케일 9종의 길이 차이를 감당할 자리가 없고,
 *   이 안내는 «형태»로 읽히는 편이 빠르다.
 */
function drawTeachTicks(
  ctx: CanvasRenderingContext2D, x: number, y: number, alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(EDGE, 0.7);
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 2) * i;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(x + cx * (STICK_MAX * 0.44), y + cy * (STICK_MAX * 0.44));
    ctx.lineTo(x + cx * (STICK_MAX * 0.74), y + cy * (STICK_MAX * 0.74));
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  ctx.restore();
}

/**
 * ★ 실기기 한 줄 진단 (2026-09-03 — 코디네이터 지시로 신설).
 *
 *   왜 «운영 빌드»에 넣는가:
 *   iOS 조작 불능을 세 번 고쳤고 세 번 다 실패했다. 마지막에는 헤드리스
 *   869판 전부 통과한 빌드가 실기기에서 터치가 «아예» 안 먹었다. 즉
 *   우리에게는 그 고장을 재현할 수단이 «없다». 유일한 계측기는 실기기를
 *   쥔 사람의 눈이다. 이 줄이 없으면 다음 보고도 「안 돼」 한 마디이고,
 *   또 눈감고 고치게 된다.
 *
 *   읽는 법 — 왼쪽부터가 곧 «배제 순서»다:
 *     T | P     입력 주 경로(T=터치 이벤트, P=포인터). iOS 는 T 여야 한다.
 *     12/1.2k   캔버스가 받은 touchstart / touchmove 수.
 *               0/0  → 이벤트가 아예 안 온다(무언가가 캔버스를 덮었다)
 *               5/0  → 눌리긴 하는데 move 가 안 온다
 *     s3        조종 손가락을 «배정»한 횟수. 위가 정상인데 0 이면 배정 실패.
 *     p0        일시정지 플래그. p1 이면 그 누수다(그 상태로는 전부 안 먹는다).
 *     a-45      지금 나가는 조종각(도). 위가 다 정상인데 `a--` 면 각도 계산 문제.
 *     x1        beginRun 이 «굳은» paused 를 푼 횟수. 0 이 아니면 누수가 실재했다.
 *
 *   ⛔ 옛 진단판(12줄 검은 상자)과 다르다. 한 줄·9px·알파 0.5 이고 조이스틱
 *     «아래»에 놓아 플레이 시선을 안 가린다. 고장 원인이 확정되면 아래
 *     LIVE_DIAG 를 false 로 바꾸는 «한 줄»로 제거된다.
 */
function drawLiveDiag(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const d = DIAG;
  const k = (n: number): string =>
    n < 1000 ? String(n) : (n / 1000).toFixed(1) + 'k';
  /**
   * ★ 2026-09-04 확장 — President 「조이스틱 자체는 움직이는데 그 스틱이 안 먹어」.
   *
   *   그 한 문장이 가리키는 고장은 «두 가지»이고 옛 줄로는 못 갈랐다:
   *     ㉮ 노브가 손가락을 따라간다 = 좌표 갱신은 되는데 각도가 안 나온다
   *     ㉯ 베이스 통째가 손가락으로 옮겨 다닌다 = 원점이 손가락을 따라다닌다.
   *        그러면 dx≈0 이라 영원히 데드존 안 = 각도 null. 노브는 «중앙 고정».
   *   ⇒ s(배정 횟수)와 u(좌표 갱신 횟수)를 «나란히» 놓으면 갈린다.
   *     ㉮ 는 u 가 크고 s 는 작다. ㉯ 는 s 가 touchstart 수보다 «훨씬» 크다.
   *
   *   S/A/L 은 「스틱이 그려지는데 각도가 없다」의 내부 근거를 직접 보여 준다:
   *     S = steerId (-1 이면 조종 손가락 없음)
   *     A = visual.stickActive (스틱을 «활성»으로 그리는가)
   *     L = steerLive (한 번이라도 데드존을 벗어났는가 = 히스테리시스 래치)
   *   ⛔ input.ts 를 전수 대조한 결과 A=1 인데 S=-1 인 경로는 «없다»(대입 4쌍이
   *     전부 짝이 맞는다). 그래도 찍는 이유는 그 «전제»가 틀렸을 때 한 장으로
   *     알아내기 위해서다 — 지금 남은 모순이 정확히 그 자리에 있다.
   */
  let t = (d.path === 'touch' ? 'T' : 'P')
    + ' ' + k(d.el.touchstart + d.el.pointerdown)
    + '/' + k(d.el.touchmove + d.el.pointermove)
    + ' s' + d.steerAssigns + '/u' + k(d.steerUpdates)
    + ' p' + d.paused
    + (d.joyMode ? '' : ' DRAG')
    + ' a' + (d.aim === null ? '--' : Math.round(d.aim * 180 / Math.PI))
    // ★ d(거리) — `a--` 일 때 「원점이 손가락을 따라다녀 거리가 0」인지
    //   「그냥 데드존 안」인지를 가른다. 이 둘은 완전히 다른 고장이다.
    + ' d' + (d.dist < 0 ? '-' : Math.round(d.dist))
    + ' S' + d.steerId + ' A' + d.stickActive + ' L' + d.steerLive + ' r' + d.adopts;
  if (d.pauseLeakFixed > 0) t += ' x' + d.pauseLeakFixed;

  ctx.save();
  ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  // 어두운 테두리를 둘러 «어떤 배경 위에서도» 읽히게 한다(받침판을 깔면
  // 그 자체가 눈에 띄어 목적에 어긋난다 — 작아야 운영에 남길 수 있다).
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = rgba(PLATE, 0.8);
  ctx.strokeText(t, x, y);
  ctx.fillStyle = rgba(EDGE, 0.5);
  ctx.fillText(t, x, y);
  ctx.restore();
}

/** ⛔실기기 고장 원인이 확정되면 이 한 줄을 false 로 바꾸면 사라진다. */
const LIVE_DIAG = false;

export function drawTouchControls(
  ctx: CanvasRenderingContext2D,
  v: TouchVisual,
  boostLabel: string,
  canBoost: boolean,
  font: string,
  /**
   * 지금 조작 모드가 조이스틱인가. ★drag 모드에서 베이스가 뜨면 «있지도 않은
   *   컨트롤»을 보여 주는 셈이라 반드시 받아야 한다.
   *   input.mode 를 여기서 읽지 않고 «받는» 이유: 이 파일이 input 의 상태를
   *   직접 들여다보기 시작하면 렌더와 입력의 경계가 무너진다.
   */
  stickMode: boolean,
): void {
  // ★ v.visible 검사 «앞»에 둔다. 「컨트롤이 아예 안 뜬다」도 진단 대상이므로
  //   그 경우에 진단판까지 같이 사라지면 아무것도 못 읽는다.
  if (DIAG_ENABLED) drawTouchDiag(ctx);

  if (!v.visible) return;

  // ★ 그리는 «순서»가 곧 우선순위다. 조이스틱을 «먼저», 질주 버튼을 «나중»에.
  //   조이스틱 베이스는 반지름 58 이고 활성 영역이 화면 전체라, 엄지를 질주
  //   버튼 근처에서 잡으면 베이스가 버튼 위를 덮는다. 그때 위에 와야 하는 것은
  //   «버튼»이다 — 질주는 되돌릴 수 없는 자원 소모라 무엇을 누르는지가 절대
  //   흐려지면 안 된다. (기본 자리끼리는 애초에 안 겹친다: 실측 390x844 에서
  //   링 x 26..142 / 버튼 x 288..364.)
  drawStick(ctx, v, stickMode);
  drawBoost(ctx, v, boostLabel, canBoost, font);
}

/**
 * 조이스틱. 쉴 때·잡았을 때·최대치·복귀 네 상태가 전부 여기서 나온다.
 */
function drawStick(
  ctx: CanvasRenderingContext2D, v: TouchVisual, stickMode: boolean,
): void {
  if (!stickMode) {
    ret.was = false;
    ret.t0 = -1;
    return;
  }

  const r = v.boostR;
  const now = perfNow();

  /**
   * ★ 「그리기가 «끊겼다가» 다시 시작됐는가」.
   *
   *   drawTouchControls 는 mode==='play' 일 때만 불린다. 그래서 스틱을 «잡은
   *   채로» 죽거나 일시정지하면 ret.was 가 true 로 남고, 다음 판 첫 프레임에
   *   「방금 놓았다」로 오인해 «지난 판의 좌표»에서 기본 자리로 날아오는
   *   유령 애니메이션이 뜬다.
   *   ⇒ 프레임 간격이 비정상적으로 벌어졌으면 이전 상태를 «버린다».
   *     (판 사이·일시정지·사망·탭 전환이 전부 여기에 걸린다.)
   */
  if (now - ret.seen > 250) {
    ret.was = false;
    ret.wasBoost = false;
    ret.t0 = -1;
    ret.s0 = -1;
  }
  ret.seen = now;

  // ── ① 잡고 있는 동안 ────────────────────────────────────────────────────
  if (v.stickActive) {
    const dx = v.knobX - v.originX;
    const dy = v.knobY - v.originY;
    const pushed = Math.hypot(dx, dy);

    /**
     * ★ 질주 버튼을 «겸한» 손가락일 때는 링을 따로 그리지 않는다.
     *   버튼 위에 반지름 58 짜리 고리를 겹치면 두 컨트롤이 한 덩어리로 보여
     *   「무엇을 누른 것인가」가 사라진다. 대신 버튼 «가장자리»에 방향 호를
     *   얹어 「이 버튼으로 방향도 준다」를 그림 한 장으로 말한다.
     *   (옛 코드 그대로다.)
     */
    if (v.boostSteer) {
      ret.was = true;
      ret.wasBoost = true;
      ret.t0 = -1;
      if (pushed > 1) {
        const a = Math.atan2(dy, dx);
        ctx.beginPath();
        ctx.arc(v.boostX, v.boostY, r + 7, a - 0.5, a + 0.5);
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.strokeStyle = rgba(KNOB, 0.95);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
      // 손가락이 버튼에 가 있어도 «기본 자리»는 계속 보여 준다 — 그래야
      // 「방향은 저기서도 준다」가 화면에서 사라지지 않는다.
      drawBase(ctx, v.hintX, v.hintY, REST_PLATE_A, REST_EDGE_A, REST_LW);
      drawRestKnob(ctx, v.hintX, v.hintY);
      stickDrawn.bx = v.hintX; stickDrawn.by = v.hintY;
      stickDrawn.kx = v.hintX; stickDrawn.ky = v.hintY;
      stickDrawn.act = 0;
      if (LIVE_DIAG) drawLiveDiag(ctx, v.hintX - STICK_MAX, diagY(ctx, v));
      return;
    }

    // ★ «잡는 순간»에만 등장 연출을 시작한다. 잡고 있는 내내 다시 걸면
    //   손가락을 미는 동안 스틱이 계속 부풀었다 줄어든다.
    if (!ret.was) ret.s0 = prefersReducedMotion() ? -1 : now;
    ret.was = true;
    ret.wasBoost = false;
    ret.t0 = -1;

    let sc = 1;
    let al = 1;
    if (ret.s0 >= 0) {
      const e = (now - ret.s0) / SPAWN_MS;
      if (e >= 1) {
        ret.s0 = -1;
      } else {
        const q = easeOut(e);
        sc = SPAWN_SCALE + (1 - SPAWN_SCALE) * q;
        al = q;
      }
    }

    // 최대치에 닿았는가. ★기준은 «노브가 멈추는» 반경(KNOB_MAX=46)이지
    //   링 반지름(STICK_MAX=52)이 아니다. 링으로 재면 노브가 46 에서 멈추므로
    //   이 조건이 «영원히 참이 되지 않는다»(2026-09-06 상수 분리 때 정정).
    //   두 값 다 input.ts 에서 import 하므로 한쪽만 고쳐 어긋날 수 없다.
    const atMax = pushed >= KNOB_MAX - 0.75;
    withPop(ctx, v.originX, v.originY, sc, al, () => {
      drawBase(ctx, v.originX, v.originY, ACT_PLATE_A,
        atMax ? MAX_EDGE_A : ACT_EDGE_A, atMax ? MAX_LW : ACT_LW);

      // 원점 → 노브 연결선. 「어느 방향으로 얼마나 밀었는가」가 한눈에 보인다.
      if (pushed > 1) {
        ctx.beginPath();
        ctx.moveTo(v.originX, v.originY);
        ctx.lineTo(v.knobX, v.knobY);
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.strokeStyle = rgba(EDGE, 0.55);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }

      drawKnob(ctx, v.knobX, v.knobY, atMax);
    });
    stickDrawn.bx = v.originX; stickDrawn.by = v.originY;
    stickDrawn.kx = v.knobX;   stickDrawn.ky = v.knobY;
    stickDrawn.act = 1;
    if (LIVE_DIAG) drawLiveDiag(ctx, v.hintX - STICK_MAX, diagY(ctx, v));
    return;
  }

  // ── ② 놓는 «순간» — «그 자리에서» 사라진다 ─────────────────────────────
  // ★ 옛 코드는 여기서 「기본 자리로 날아가는」 복귀를 시작했다. 고정 원점에서는
  //   그 궤적이 곧 「스틱이 돌아다닌다」는 인상이라 없앴다(SPAWN_MS 주석).
  if (ret.was) {
    ret.was = false;
    ret.s0 = -1;
    // 질주버튼 겸용 제스처는 스틱을 그린 적이 없다 — 사라질 것도 없다.
    ret.t0 = ret.wasBoost || prefersReducedMotion() ? -1 : now;
    ret.bx = v.originX;
    ret.by = v.originY;
    ret.kx = v.knobX;
    ret.ky = v.knobY;
    ret.wasBoost = false;
  }

  // ── ③ 쉴 때(+복귀 중) ───────────────────────────────────────────────────
  // ★ 여기가 이번 작업의 핵심이다. 옛 코드는 이 자리에서 «아무것도 안 그리고»
  //   빠져나갔다(= President 「조이스틱이 안 보여서 불편해」).
  /**
   * ★ 쉴 때 보이는 것은 «기본 자리의 유령 스틱» 하나다. 조작하던 스틱은
   *   방금 놓은 «그 자리»에서 90ms 동안 줄어들며 사라진다. 두 개가 잠깐
   *   같이 보이지만, 하나는 사라지는 중이고 하나는 「여기 있다」라서
   *   역할이 겹치지 않는다.
   */
  if (ret.t0 >= 0) {
    const e = (now - ret.t0) / DESPAWN_MS;
    if (e >= 1) {
      ret.t0 = -1;
    } else {
      const q = easeOut(e);
      // 사라질수록 작아지고 옅어진다. 좌표는 «움직이지 않는다».
      withPop(ctx, ret.bx, ret.by, 1 - (1 - SPAWN_SCALE) * q, 1 - q, () => {
        drawBase(ctx, ret.bx, ret.by, ACT_PLATE_A, ACT_EDGE_A, ACT_LW);
        drawKnob(ctx, ret.kx, ret.ky, false);
      });
    }
  }

  // ── ③ 쉴 때 — 기본 자리의 유령 스틱 ────────────────────────────────────
  // ★ 옛 코드는 이 자리에서 «아무것도 안 그리고» 빠져나갔다(= President
  //   「조이스틱이 안 보여서 불편해」). 항상 그린다.
  const bx = v.hintX;
  const by = v.hintY;
  drawBase(ctx, bx, by, REST_PLATE_A, REST_EDGE_A, REST_LW);
  drawRestKnob(ctx, bx, by);
  // 교습 눈금은 «첫 조종 전»에만. 이해한 순간 사라지는 것이 맞다.
  if (v.hintAlpha > 0) drawTeachTicks(ctx, bx, by, v.hintAlpha);

  stickDrawn.bx = bx; stickDrawn.by = by;
  stickDrawn.kx = bx; stickDrawn.ky = by;
  stickDrawn.act = 0;
  if (LIVE_DIAG) drawLiveDiag(ctx, v.hintX - STICK_MAX, diagY(ctx, v));
}


/**
 * 질주 버튼. ★조이스틱보다 «나중에» 그린다 — 아래 drawTouchControls 참고.
 */
function drawBoost(
  ctx: CanvasRenderingContext2D,
  v: TouchVisual,
  boostLabel: string,
  canBoost: boolean,
  font: string,
): void {
  // 어두운 받침을 먼저 깔아 «어떤 배경 위에서도» 같은 대비를 만든다.
  const r = v.boostR;
  ctx.beginPath();
  ctx.arc(v.boostX, v.boostY, r, 0, Math.PI * 2);
  ctx.fillStyle = rgba(PLATE, v.boostHeld ? 0.82 : 0.66);
  ctx.fill();

  // 눌린 동안만 채운다. 평소에는 테두리만 — 아레나를 덜 가린다.
  if (canBoost && v.boostHeld) {
    ctx.fillStyle = rgba(SIGNAL, 0.3);
    ctx.fill();
  }
  ctx.lineWidth = v.boostHeld ? 2.6 : 2;
  ctx.strokeStyle = canBoost ? rgba(SIGNAL, v.boostHeld ? 1 : 0.78) : rgba(OFF, 0.45);
  ctx.stroke();

  // 번개 아이콘 — 글자보다 먼저 읽힌다.
  ctx.beginPath();
  ctx.moveTo(v.boostX + r * 0.1, v.boostY - r * 0.46);
  ctx.lineTo(v.boostX - r * 0.26, v.boostY + r * 0.06);
  ctx.lineTo(v.boostX - r * 0.02, v.boostY + r * 0.06);
  ctx.lineTo(v.boostX - r * 0.1, v.boostY + r * 0.5);
  ctx.lineTo(v.boostX + r * 0.28, v.boostY - r * 0.08);
  ctx.lineTo(v.boostX + r * 0.03, v.boostY - r * 0.08);
  ctx.closePath();
  ctx.fillStyle = canBoost ? rgba(v.boostHeld ? '#ffffff' : SIGNAL, v.boostHeld ? 1 : 0.9) : rgba(OFF, 0.5);
  ctx.fill();

  // 라벨은 버튼 «밖»이라 받침 원이 안 깔린다. 어두운 테두리를 둘러 글자를 세운다.
  // (로케일마다 길이가 달라 고정폭 배경을 깔 수 없다 - 테두리가 유일하게 안전하다.)
  ctx.font = '700 10px ' + font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = rgba(PLATE, 0.86);
  ctx.strokeText(boostLabel, v.boostX, v.boostY + r + 13);
  ctx.fillStyle = rgba('#ffffff', canBoost ? 0.92 : 0.45);
  ctx.fillText(boostLabel, v.boostX, v.boostY + r + 13);

}

/** 쉴 때 중앙 표식. 「지금 중립이다」 — 노브보다 작고 옅다. */
function drawRestKnob(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  // ★ 알파를 낮추는 «순서»가 중요하다. 어두운 받침과 밝은 몸을 «둘 다» 옅게
  //   깔면 두 겹이 섞여 중간 회색 덩어리가 된다(첫 실렌더에서 그랬다 —
  //   노브가 아니라 「구멍」으로 읽혔다). 받침은 진하게 깔아 대비를 만들고,
  //   «밝기»만 낮춘다. 그러면 「같은 노브가 조용히 있는 것」으로 읽힌다.
  ctx.beginPath();
  ctx.arc(x, y, REST_KNOB_R, 0, Math.PI * 2);
  ctx.fillStyle = rgba(PLATE, 0.88);
  ctx.fill();
  ctx.fillStyle = rgba(KNOB, 0.86);
  ctx.fill();
  // 어두운 테 한 겹 — 밝은 배경 위에서 표식이 배경에 녹지 않게.
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = rgba(PLATE, 0.8);
  ctx.stroke();
}

/**
 * 잡았을 때 노브. 어두운 테두리 → 밝은 몸 순서라 어떤 배경에서도 윤곽이 선다.
 * @param atMax 최대치에 닿았는가. 닿으면 밝은 테를 한 겹 둘러 «한계»를 말한다.
 */
function drawKnob(
  ctx: CanvasRenderingContext2D, x: number, y: number, atMax: boolean,
): void {
  ctx.beginPath();
  ctx.arc(x, y, KNOB_R, 0, Math.PI * 2);
  ctx.fillStyle = rgba(PLATE, 0.9);
  ctx.fill();
  ctx.fillStyle = rgba(KNOB, 0.94);
  ctx.fill();
  ctx.strokeStyle = atMax ? rgba(KNOB, 1) : rgba(PLATE, 0.55);
  ctx.lineWidth = atMax ? 3 : 2;
  ctx.stroke();
}

/**
 * 한 줄 진단의 y. 조이스틱 «아래»에 두되 화면 밖으로 나가지 않게 자른다.
 * ★ 캔버스 CSS 높이는 renderer 가 style 에 박아 둔다 — 파싱이 레이아웃보다 싸다.
 */
function diagY(ctx: CanvasRenderingContext2D, v: TouchVisual): number {
  const csh = parseFloat(ctx.canvas.style.height) || window.innerHeight;
  return Math.min(csh - 6, v.hintY + STICK_MAX + 16);
}
