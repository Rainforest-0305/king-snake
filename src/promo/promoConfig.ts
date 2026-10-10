/**
 * 프로모션 「블랙맘바 해금하기」 500원 — 설정 정본. 2026-09-01 신설
 *
 * ══ 왜 값을 «여기 한 곳»에 모으는가 ════════════════════════════════════════
 *   TESTONLY 빌드는 이 파일 «세 줄»만 바꾸면 된다(tools/promo_testonly_patch.mjs).
 *   게임 로직·저장·광고 파일은 한 글자도 안 건드린다.
 *
 * ══ 왜 index.html data 속성이 아닌가(스모·네온과 다른 선택) ═════════════════
 *   저 게임들은 원본 게임 JS 가 «정적 public 파일»이라 모듈 그래프 밖이었고,
 *   index.html 이 유일한 공통 주입점이었다. 뱀 키우기는 전부 TS 모듈이고,
 *   ★`index.html` 은 tools/check_protected.mjs 의 «보호 파일»이다(라이브와 바이트
 *   동일해야 한다). 그래서 새 «비보호» 모듈로 뺐다.
 *   ⚠상수접기 우려: 08-11 광고 실사고는 «불리언 플래그가 호출 블록을 통째로
 *     삭제»한 건이다. 여기 문자열 상수는 인라인될 뿐 블록이 사라지지 않는다.
 *     그래도 가정하지 않고 «빌드 산출물에서 코드 문자열을 grep» 해 확인한다
 *     (tools/scan_promo.mjs — dist 에 코드 1건 이상 + grant 호출 존재).
 */

/** 앱스인토스 콘솔의 프로모션 코드(고정 500원). TESTONLY 는 `TEST_` 접두. */
export const PROMO_CODE = '__PROMOTION_CODE__';

/** 지급액(원). 카드와 «정확히» 같아야 한다 — 게임 앱은 고정 금액만 허용된다. */
export const PROMO_AMOUNT = 500;

/**
 * 지급 대상 스킨 id (game/skins.ts). 블랙맘바 = `mamba`, unlockScore 12000.
 * TESTONLY 는 `corn`(기본 스킨, 항상 보유)으로 바꿔 실기기에서 즉시 지급을 확인한다.
 */
export const PROMO_SKIN_ID = 'mamba';

/**
 * ★TESTONLY 전용 — 「기준선에서 이미 보유 중이면 영구 미지급」 규칙을 «무시»한다.
 * ⛔정본은 반드시 false. 이 값이 true 인 채로 검수에 들어가면 기존 보유자 전원에게
 *   지급되어 예산이 한 번에 소진된다.
 */
export const PROMO_IGNORE_BASELINE = false;
