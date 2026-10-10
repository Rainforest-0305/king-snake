// adGroups.ts — 리워드 지면 ID «단일 정본».
//
// ⛔ 이 파일 밖에 지면 ID 문자열을 «절대» 적지 마라.
//    지면이 바뀌었을 때 grep 으로 한 곳만 고치면 끝나야 한다. 흩어져 있으면
//    반드시 하나를 놓치고, 그러면 「광고는 뜨는데 보상이 다른 지면으로 잡히는」
//    조용한 사고가 난다(콘솔 통계로만 뒤늦게 드러난다).
//
// ★ 전면형(인터스티셜) 지면은 여기 «없다». 그건 src/ads/interstitial.ts 가
//   자기 상수로 들고 있고, 이 레인은 그 파일을 «바이트 단위로» 건드리지 않았다.
//   tools/check_protected.mjs 가 그 사실을 증명한다.
//
// 콘솔 등록값(Partner 2026-08-31 실측, state=ENABLED):
//   부활 1회        REWARDED / 보상 단위 「부활권」×1
//   시작 크기 부스트 REWARDED / 보상 단위 「부스트권」×1
//   스킨 해금       REWARDED / 보상 단위 「해금권」×1
//   기록 돌파 보상   REWARDED / 보상 단위 「성장권」×1   ← 2026-08-31 추가(레인 5)
//   결과 성장 2배    REWARDED / 보상 단위 「2배권」×1     ← 2026-09-10 추가(레인 A) — 콘솔 이름 「뱀 키우기_결과 성장 2배」
//
// ★ SDK 파라미터명은 adGroupId 다(adUnitId·placementId 아님).
//   @apps-in-toss/web-bridge 2.10.8 의 loadFullScreenAd/showFullScreenAd 시그니처 실측.
//
// ★ 시작 화면 «배너» 지면(ID 앞 8자리 XXXXXXXX… · src/banner/)은 2026-09-10 에
//   «코드에서 제거»했다(콘솔 실측 노출 0회 — Codex 전략 「수리하지 않고 삭제」). 콘솔의 지면
//   삭제는 Partner 몫이다. 이 파일에 그 ID 를 다시 적지 마라 — scan_ads.mjs 가 「없어야 한다」로 검사한다.
//   ⛔전체 ID 를 «주석에도» 적지 않는다(2026-09-10 정정). 주석은 번들에서 지워지지만 «소스»는 남고,
//     공용 감사기(_shared/check_game_privacy_sdk.mjs)는 src 를 훑어 지면 ID 를 센다 — 그래서 이
//     한 줄 때문에 감사표에 「지면 8개」로 잡혔다(실제 배선은 7개). 기계가 읽는 자리에 죽은 토큰을
//     남기지 마라. 필요하면 앞 8자리만 적어 추적성만 남긴다.

/** 리워드 지면의 «용도» 이름. 계측 surface 태그로도 그대로 쓴다. */
export type RewardSurface = 'revive' | 'startBoost' | 'skinUnlock' | 'growth' | 'skinProgress' | 'resultDouble';

export const REWARD_AD_GROUPS: Readonly<Record<RewardSurface, string>> = {
  revive: 'ait.v2.live.XXXXXXXXXXXXXXXX',
  startBoost: 'ait.v2.live.XXXXXXXXXXXXXXXX',
  skinUnlock: 'ait.v2.live.XXXXXXXXXXXXXXXX',
  growth: 'ait.v2.live.XXXXXXXXXXXXXXXX',
  /* ★ 최고급 스킨 진행도 «전용» 지면 (2026-09-02 President: 「따로 전용 리워드 광고를
     설치해」). ⇒ 이 지면의 시청«만» 100회로 센다. 기존 4종은 세지 않는다.
     그 규칙의 정본은 skins/adWatchStore.ts 의 AD_COUNT_SOURCES 다. */
  skinProgress: 'ait.v2.live.XXXXXXXXXXXXXXXX',
  /* ★ 결과 화면 「이번 판 성장 2배」(2026-09-10 레인 A). 보상의 «뜻»은 reward/carryStore.ts 가 정한다
     (판이 끝날 때 다음 판으로 «이어받는» 시작 길이를 2배로). 세션 1회 · 일 3회 상한. */
  resultDouble: 'ait.v2.live.XXXXXXXXXXXXXXXX',
};

/** 전면형 지면 ID 는 «여기 없다» — 번들에 그 문자열이 두 번 나오면 안 된다(오염 검사기가 중복을 실패로 본다). */
