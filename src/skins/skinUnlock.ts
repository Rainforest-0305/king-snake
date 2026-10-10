// skinUnlock.ts — 「이 스킨을 어떻게 얻는가」의 «단일 답».
//
// ══ 왜 한 곳이어야 하나 ══════════════════════════════════════════════════
//  이 질문은 화면 네 군데에서 동시에 나온다:
//    ① 레일 카드의 잠금 칸   ② 카드 aria-label   ③ 히어로 아래 한 줄
//    ④ 「지금 고를 수 있는가」 판정(main.ts isSkinAvailable)
//  네 곳이 각자 조건식을 들면 반드시 하나가 어긋난다 — 그 사고는 「버튼은 열렸는데
//  설명은 잠김」처럼 보이고, 유저는 우리가 뭘 파는지 이해하지 못한다.
//  ⇒ 규칙은 여기 하나. 화면은 «묻기만» 한다.

import { Skin, hasScorePath, isSkinUnlocked } from '../game/skins';
import { adWatchTotal } from './adWatchStore';
import { isLedgered } from './unlockLedger';

/** 요건 한 줄을 그리는 데 필요한 «전부». 화면은 이 값만 보고 그린다. */
export type SkinReq =
  /** 처음부터 열려 있다. */
  | { kind: 'free' }
  /** 최고 점수 문턱. */
  | { kind: 'score'; need: number; have: number }
  /** 누적 광고 시청 문턱. */
  | { kind: 'ads'; need: number; have: number };

/**
 * 이 스킨의 «획득 요건».
 *
 * ★ 경로가 둘 이상이면 「아직 못 연 것 중 더 가까운 쪽」을 돌려준다 —
 *   유저에게 보여줄 목표는 «지금 가장 가까운 문»이어야 한다.
 *   (현재 두 경로를 동시에 가진 스킨은 없다. 생겨도 UI 가 안 깨지게 지금 정한다.)
 */
export function skinRequirement(skin: Skin, bestScore: number): SkinReq {
  const score = hasScorePath(skin)
    ? { kind: 'score' as const, need: skin.unlockScore, have: bestScore }
    : null;
  const ads = typeof skin.unlockAds === 'number'
    ? { kind: 'ads' as const, need: skin.unlockAds, have: adWatchTotal() }
    : null;

  if (score && score.need <= 0 && !ads) return { kind: 'free' };
  if (score && !ads) return score;
  if (ads && !score) return ads;
  if (score && ads) {
    // 진행률이 높은 쪽 = 더 가까운 문.
    const ps = score.need > 0 ? score.have / score.need : 1;
    const pa = ads.need > 0 ? ads.have / ads.need : 1;
    return pa > ps ? ads : score;
  }
  return { kind: 'free' };
}

/** 요건을 «충족했는가». 어떤 경로로든 하나만 넘으면 된다. */
export function meetsSkinRequirement(skin: Skin, bestScore: number): boolean {
  /* ★ 원장이 «먼저»다 (2026-09-03 문턱 상향).
     「한 번 열린 것은 다시 잠기지 않는다」는 요건 판정 «전부»에 걸려야 한다.
     여기 한 줄이 빠지면 카드는 열려 있는데(isSkinUnlocked 가 원장을 본다)
     프로모션 보유 판정·「지금 고를 수 있는가」는 잠긴 «반쪽 상태»가 된다. */
  if (isLedgered(skin.id)) return true;
  // 점수 경로의 답은 skins.ts 하나가 낸다(그쪽도 원장을 본다 — 판정을 두 벌 쓰지 않는다).
  if (isSkinUnlocked(skin, bestScore)) return true;
  if (typeof skin.unlockAds === 'number' && adWatchTotal() >= skin.unlockAds) return true;
  return false;
}

/** 요건 진행률 0~1(레일 카드의 게이지·정렬에 쓴다). */
export function skinReqProgress(req: SkinReq): number {
  if (req.kind === 'free') return 1;
  if (req.need <= 0) return 1;
  return Math.max(0, Math.min(1, req.have / req.need));
}

/**
 * 고급 스킨인가 = 「특별 취급해서 그려야 하는가」.
 * ★ 「unlockScore >= 100000」 같은 «조건식»으로 쓰지 않는다. 문턱을 조정하는
 *   순간 대상이 조용히 늘거나 준다 — AD_UNLOCKABLE_SKIN_IDS 가 id 목록인 것과
 *   정확히 같은 이유다(game/skins.ts 머리말).
 */
export const PREMIUM_SKIN_IDS: readonly string[] = ['rhinoviper', 'bluecoral'];

export function isPremiumSkin(id: string): boolean {
  return PREMIUM_SKIN_IDS.indexOf(id) >= 0;
}
