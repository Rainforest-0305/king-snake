// main.ts — 부팅 + 게임 루프 + 상태기계.
//
// ★ «고정 시간간격(fixed timestep)» 을 쓴다.
//   가변 dt 로 물리를 돌리면 프레임레이트에 따라 게임이 달라진다:
//     · 저사양 폰(30fps)에서 한 스텝 이동거리가 2배가 되어 «충돌을 뛰어넘는다»
//       (부스트 속도 385 x 1/30 = 12.8 유닛. 얇은 몸을 관통할 수 있다.)
//     · 회전 각속도 상한도 프레임당으로 적용되면 고사양에서 더 잘 꺾인다(불공정).
//   1/60 고정 스텝 + 누산기로 돌리면 어느 기기에서든 «같은 게임»이 된다.
//   대신 한 프레임에 도는 스텝 수에 상한(MAX_SUB)을 둔다 — 상한이 없으면
//   느려진 기기가 더 많은 스텝을 돌려 더 느려지는 «죽음의 나선»에 빠진다.
//
// ★ 탭이 백그라운드에 갔다 오면 dt 가 수십 초로 튄다. 반드시 잘라낸다(DT_MAX).

import './ui/styles.css';
import { applyDocumentTitle, BRAND_EN, BRAND_KO } from './brand';
import { Renderer } from './render';
import { stats, totalDrawCalls } from './render/stats';
import { setBackgroundMask } from './render/background';
import { setOrbMask } from './render/orbRender';
import { drawTouchControls, stickDrawn } from './render/touchControls';
import { setTrackDrawn, drawnIds, culledIds } from './render/snakeRender';
import { DIAG as INPUT_DIAG } from './input';
import { FONT, setLayerMask, setBodyCull } from './render/snakeRender';
import { World, type DeathInfo } from './game/world';
import { Input } from './input';
import { Sfx } from './audio';
import { Shell, makeSkinPreview, type LeaderRow } from './ui/shell';
import { loadSave, writeSave, recordRun } from './save';
import { sanitizeNick, setBotNameLocale } from './game/names';
import {
  SKINS, BOT_PALETTE, isSkinUnlocked, skinName, isAdUnlockableSkin, AD_UNLOCKABLE_SKIN_IDS,
  setUnlockLedger, isUnlockLedgerBound, hasScorePath, botPremiumCount,
  BOT_PALETTE_POOL, BOT_PREMIUM_SLOTS, BOT_PREMIUM_SKIN_IDS,
  type Skin,
} from './game/skins';
import {
  seedUnlockLedger, recordUnlocks, isScoreLedgered, unlockLedgerSnapshot,
  LEGACY_UNLOCK_SCORE, LEGACY_UNLOCK_ADS,
  __resetUnlockLedgerForTest, __setUnlockLedgerForTest,
} from './skins/unlockLedger';
import { detectLocale, setLocale, getLocale, isLocale, t, type Locale } from './i18n';
import { timeSeed } from './game/rng';
import { BOOST_MIN_MASS, WORLD_R, BOT_COUNT, START_MASS } from './game/config';
import * as ads from './ads/interstitial';
import { __injectAdSdkForTest, __resetAdSdkForTest } from './ads/adSdk';
import {
  adSeqLog, failKind, LATE_REWARD_WINDOW_MS, rewardAdInFlight, rewardAdsUsable, showRewardAd, warmUpRewardAds,
} from './reward/rewardAd';
import {
  DAILY_CAP, __resetRewardStoreForTest, adUnlockedSkins, grantSkinUnlock, isSkinAdUnlocked,
  noteGranted, underDailyCap, usedToday,
} from './reward/rewardStore';
import {
  applyGrowthReward, applyStartMass, boostedStartMass, boostedStartMassFrom, growthLabel, reviveInPlace,
  GROWTH_MASS_K,
  type GrowthApplied,
} from './reward/gameEffects';
import {
  GROWTH_BEST_MIN, GROWTH_MAX_PER_RUN, GROWTH_MIN_GAP_S, GROWTH_OFFER_S,
  GROWTH_THRESHOLDS, GrowthTriggers,
  type GrowthOffer,
} from './reward/growthTriggers';
import { fmt, gt, rst, rt } from './reward/rewardText';
/* ── 「이번 판 성장 이어받기」 + 결과 화면 「2배」 (2026-09-10 레인 A) ─────────────
 * 보상의 «뜻»(다음 판 시작 질량)과 원장은 carryStore.ts 한 곳. main.ts 는 «언제» 확정·소비·되돌리는지만. */
import {
  CARRY_CAP, CARRY_DOUBLE_K, CARRY_K, __resetCarryForTest, clearCarry, commitCarry, consumeCarry, pendingCarry,
  type CarryRecord,
} from './reward/carryStore';
/* ── 토스 푸시 동의 · 머니 리그 교차추천 (2026-09-10 레인 A) ─────────────────────
 * 토스 밖(브라우저·Pages·MS Store)에서는 두 모듈 모두 SDK 청크를 «요청조차 안 하고» UI 도 안 그린다. */
import {
  PUSH_KEY, PUSH_TEMPLATE_CODE, __resetPushForTest, dismissPushNudge, enablePush, getPushState,
  hydratePushState, subscribePush,
} from './toss/pushAgreement';
import { __injectPushSdkForTest, __resetPushSdkForTest, type NotificationAgreementResult } from './toss/pushBridge';
import {
  MONEY_LEAGUE_URL, __resetCrossPromoForTest, canShowCrossPromo, crossPromoSnapshot, noteCrossPromoShown,
  openCrossPromo,
} from './toss/crossPromo';
import { __injectOpenUrlForTest, __resetOpenUrlForTest, openUrlUnknownCount } from './toss/openUrl';
/* ── 프로모션 「블랙맘바 해금하기」 500원 (2026-09-01 President) ────────────────
 * ⛔지급 «판정»은 여기 없다 — src/promo/mambaPromo.ts 한 곳이다. main.ts 는
 *   ① 「지금 보유 중인가」 규칙을 «주입»하고 ② 보유 여부가 바뀔 수 있는 지점에서 «알린다».
 *   규칙을 두 곳에 적으면 반드시 한 곳을 놓친다(부활·성장 훅에서 같은 교훈). */
import {
  initMambaPromo, notifyMambaOwnership, mambaRecordSnapshot, mambaMissionEligible, PROMO_SKIN_ID,
} from './promo/mambaPromo';
/* ── 시작 화면 배너 지면(2026-09-02) — 2026-09-10 «제거» ───────────────────────
 * 콘솔 실측 노출 0회(전 기간). Codex 전략 「0회 배너는 수리하지 않고 삭제」. src/banner/ 를 지웠고
 * 지면 ID 는 번들에 «0회»여야 한다(tools/scan_ads.mjs 가 검사). 콘솔의 지면 삭제는 Partner 몫. */
/* ── 고급 스킨: 특수 기능 + 광고 누적 진행도 (2026-09-02 President ④) ──────── */
import { createAbilityRuntime, abilityOf, abilityFactsOf } from './skins/skinAbility';
import { noteAdWatched, adWatchTotal, adWatchBySurface, __setAdWatchForTest } from './skins/adWatchStore';
import { meetsSkinRequirement, PREMIUM_SKIN_IDS } from './skins/skinUnlock';
import { initSkinPromos, notifySkinPromos, skinPromoSnapshot, SKIN_PROMO_FORCE_OWNED } from './promo/skinPromos';
import { st, sfmt } from './skins/skinText';

const STEP = 1 / 60;
const MAX_SUB = 5;
/**
 * 한 프레임이 세계를 밀 수 있는 «최대» 시간(초).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ★ 2026-09-04 — 이 값을 «내리려다 실측을 보고 되돌렸다». 기록을 남긴다.
 *
 *   동기: President 「초거대 뱀들이 끊기거나 순간이동하는 거처럼 깨질 때 있다」.
 *   snake.step 이 `x += cos(angle) * speed * dt` 라, 이 상수가 곧
 *   «한 프레임에 순간이동할 수 있는 거리»의 상한이다.
 *       0.25 : 질주 385 x 0.25 = 96 유닛 → zoom 0.65 에서 약 62 화면px
 *       1/15 : 385 x 0.0667    = 25.7 유닛 → 약 16 화면px
 *   이론상으로는 내리는 게 맞아 보였다. 그런데 실측이 반대였다.
 *
 * ★ 실측 (tools/qa_teleport.py, 부하씬 = 초거대 12마리 + CPU 3배 스로틀)
 *       DT_MAX 0.25 : fps 9.1  · 클램프 0.00%  · 화면 최대 튐 14.6px
 *       DT_MAX 1/15 : fps 15.0 · 클램프 97.60% · 화면 최대 튐 12.2px
 *   ⇒ 얻은 것은 14.6→12.2px 뿐이고 «둘 다 이미 가시 임계(25px) 아래»다.
 *     대신 프레임의 97.6% 가 클램프에 물린다 = 상시 슬로모션.
 *     정상 플레이(60fps)에서는 두 값 모두 클램프 0.00% 라 «아무 차이도 없다».
 *   ⇒ 이득은 재현하지 못한 시나리오에만 있고, 비용은 재현되는 시나리오에 있다.
 *     그래서 내리지 «않았다».
 *
 * ⛔ 다시 내리려거든 이것부터 답해라: 「고립된 250ms 히칭 한 방」을 실제로
 *   재현했는가? 지속적 저프레임(스로틀)은 그 시나리오가 «아니다» — 지속
 *   저프레임에서는 매 프레임이 균등하게 느려서 튐이 아니라 슬로모션이 된다.
 *   재현 못 한 채로 내리면 President 가 이미 보고한 「프레임이 너무 많이 깨진다」
 *   (2026-09-02, -23)를 슬로모션으로 바꿔 놓는 것이다.
 *
 * ★ 정석은 «고정 스텝 + 서브스텝»이다(0.25 를 0.05 짜리 5스텝, 상한 5회).
 *   시간 정확도·순간이동·터널링을 한 번에 해결한다. 다만 스텝 루프를 건드리면
 *   충돌·사망 판정 전체가 회귀 대상이라 출시본에서는 하지 않는다. 다음 판 후보.
 *
 * ★ 시계 소스(광고 보상 경로라 틀리면 돈 문제가 된다) — 확인해 뒀다:
 *   · tickResume 의 resumeLeft 는 «이 dt» 기반 → 히칭 시 카운트다운이 길어질
 *     수는 있어도 짧아지지 «않는다»(유저에게 불리해지지 않는 방향).
 *   · runStartedAt 과 광고 시간 보정은 전부 «벽시계»(performance.now) →
 *     DT_MAX 와 무관하다. 정산은 이 상수에 영향받지 않는다.
 *
 * ★ 탭이 백그라운드에 갔다 오면 dt 가 수십 초로 튄다. 그걸 자르는 것이
 *   이 상수의 원래 목적이고, 0.25 는 그 목적에 충분하다.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const DT_MAX = 0.25;

/**
 * 기록 돌파 제안에서 «게임으로 돌아가는» 카운트다운(초).
 *
 * ★ 왜 필요한가: 거절하든 광고를 보고 오든, 재개되는 그 순간 뱀은 이미
 *   SPEED_BASE(205 u/s)로 달리고 있다. 아무 예고 없이 흐름이 돌아오면
 *   「내가 안 죽였는데 죽었다」가 된다 — 이 기능이 막으려던 바로 그 사고다.
 * ★ 3초인 근거: 화면이 멈춘 채 3초면 머리 앞 615 유닛(= 내 몸 반지름의 24배)
 *   범위를 눈으로 훑고 방향을 정하기에 충분하다. 그리고 3-2-1 은 이 장르에서
 *   설명이 필요 없는 관용구다.
 */
const RESUME_COUNTDOWN_S = 3;

/**
 * ★ 'offer' = 「기록 돌파 광고」가 화면을 덮고 있는 동안(+ 복귀 카운트다운).
 *   'pause' 와 «같은 정도로» 월드가 멈춘다. 아래 worldFrozen() 이 유일한 판정이고,
 *   프레임 루프의 모든 정지 조건이 그 함수 하나를 본다 — 조건을 두 곳에 적으면
 *   반드시 한 곳을 놓치고, 그러면 「광고가 떠 있는데 뱀만 달리는」 최악이 난다.
 *
 * ⛔«제안 배너»는 이 모드가 «아니다»(2026-09-01 President 판정: 제안이 게임을
 *   방해하면 안 된다). 배너가 떠 있는 동안 mode 는 'play' 그대로이고 월드는
 *   정상 속도로 흐른다. 멈추는 것은 «광고를 누른 뒤»뿐이다.
 */
type Mode = 'menu' | 'play' | 'pause' | 'dead' | 'offer';

function boot(): void {
  const params = new URLSearchParams(location.search);
  const debug = params.get('debug') === '1';
  /** ?quiet=1 - debug 훅은 살리되 화면 오버레이만 끈다(증거 스크린샷용). */
  const quiet = params.get('quiet') === '1';
  const forcedSeed = params.get('seed');
  /**
   * ★ ?demo=1 - AI 가 «플레이어를 조종»하는 시연 모드.
   *   용도 두 가지:
   *     1) 스토어 스크린샷 촬영. 사람이 잘 플레이하는 순간을 기다릴 필요가 없다.
   *     2) 장시간 무인 회귀 테스트(수 분간 돌려 콘솔 에러·누수·프레임 하락 관찰).
   *   조작 입력은 무시되고, 죽으면 봇처럼 리스폰한다(촬영이 끊기지 않게).
   */
  const demo = params.get('demo') === '1';
  /* ★ 성능 진단 전용 스위치 두 개. 둘 다 «있을 때만» 동작한다.
     · ?layers=N   - 뱀 층을 골라 끄고 fps 를 잰다(tools/perf_layers.py)
     · ?fixscale=N - 적응형 해상도를 «고정»한다. 안 고정하면 해상도가 스스로
                     내려가 fps 가 60 으로 돌아와 «비용 차이가 안 보인다». */
  const layersParam = params.get('layers');
  if (layersParam !== null) {
    setLayerMask(Number(layersParam) | 0);
    setBackgroundMask(Number(layersParam) | 0);
    setOrbMask(Number(layersParam) | 0);
  }
  const fixScale = params.get('fixscale');
  /**
   * ★ 광고 강제 스위치. 「없을 때」가 운영 동작이다.
   *   ?ads=off  게이트를 통째로 끈다 — 스토어 촬영·QA 회귀에서 광고가 끼어들지 않게.
   *   ?ads=1    빚 유무와 무관하게 «준비만 되면» 띄운다 — 노출 경로 점검용.
   *   ★demo(자동 촬영)에서는 «항상» off 다. 촬영 중 광고가 뜨면 그 스크린샷이 버려진다.
   */
  const adsParam = params.get('ads');
  const adsMode: 'normal' | 'off' | 'always' =
    demo || adsParam === 'off' ? 'off' : adsParam === '1' ? 'always' : 'normal';
  ads.initAds(adsMode);

  // ── 저장본 ─────────────────────────────────────────────────────────────
  const { status, data: save } = loadSave();
  if (debug) console.info('[king-snake] save status =', status);

  /* ── ★해금 «사실» 원장 — 문턱 상향으로 스킨이 회수되는 것을 막는다 ────────
   *
   *  순서가 이 블록의 전부다:
   *    ① setUnlockLedger  — game/skins.ts 의 보유 판정에 원장을 «먼저» 꽂는다.
   *    ② seedUnlockLedger — 이 기기에서 처음이면 «옛 문턱»으로 소급 적립한다.
   *    ③ recordUnlocks    — 그다음 «새 문턱»으로 현재 보유를 적립한다.
   *  ⛔①을 ②보다 뒤에 두면, 그 사이에 화면이 보유를 물으면 «잠긴» 답이 나간다.
   *  ⛔②를 «저장본을 읽기 전»에 두면 bestScore 가 0 이라 아무것도 적립되지 않는다
   *    (= 회수 방지가 조용히 죽는다. 오류는 안 난다).
   *
   *  ★씨 뿌리기는 기기당 «한 번»뿐이다(원장의 seeded 플래그). 두 번 돌면
   *    새 문턱을 못 넘은 유저가 옛 문턱만 넘어도 열리는 뒷문이 생긴다.
   *  ★신규 유저(저장 없음 → bestScore 0)는 문턱 0 인 3종만 적립된다 = 정상.
   */
  setUnlockLedger(isScoreLedgered);
  const seedResult = seedUnlockLedger(save.bestScore, adWatchTotal());
  syncUnlockLedger();
  if (debug) console.info('[king-snake] unlock ledger =', seedResult, unlockLedgerSnapshot());

  /**
   * 지금 «현재 규칙»으로 열려 있는 것을 원장에 적립한다.
   * ★판이 끝날 때마다 부른다 — 그래야 앞으로 문턱이 또 올라가도 이번 같은
   *   소급 적립(LEGACY 표)이 다시 필요해지지 않는다. 원장이 스스로 자란다.
   * ★단조 증가라 «빼는» 일이 없다. 부활로 기록을 되돌려도(undoRunRecord)
   *   이미 적립된 것은 남는다 — 「한 번 열리면 영구」가 그 뜻이다.
   */
  function syncUnlockLedger(): void {
    const byScore: string[] = [];
    const byAds: string[] = [];
    for (const sk of SKINS) {
      if (hasScorePath(sk) && save.bestScore >= sk.unlockScore) byScore.push(sk.id);
      if (typeof sk.unlockAds === 'number' && adWatchTotal() >= sk.unlockAds) byAds.push(sk.id);
    }
    recordUnlocks(byScore, byAds);
  }

  // ── 로케일 ─────────────────────────────────────────────────────────────
  const nav = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  const initialLocale: Locale = isLocale(save.locale) ? save.locale : detectLocale(nav);
  setLocale(initialLocale);
  // 봇 이름 풀도 로케일을 따른다. game/ 은 i18n 을 모르므로 «여기» 서 주입한다.
  setBotNameLocale(initialLocale);
  applyDocumentTitle(initialLocale === 'ko');

  // ── 캔버스/렌더러 ──────────────────────────────────────────────────────
  const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('#stage 캔버스를 찾을 수 없다.');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', t('a11yCanvas'));

  const renderer = new Renderer(canvas);
  renderer.profile = debug;
  const input = new Input(canvas);
  const sfx = new Sfx();
  sfx.setEnabled(save.sound);

  const root = document.getElementById('app') ?? document.body;

  // ── 상태 ───────────────────────────────────────────────────────────────
  let mode: Mode = 'menu';
  let world = makeMenuWorld();
  let runStartedAt = 0;
  let lastDeath: DeathInfo | null = null;
  let camSnap = true;
  /** 마지막 프레임의 dt(초). ?debug=1 진단 훅 전용 — 로직은 읽지 않는다. */
  let lastDt = 0;
  /** 자르기 «전» dt. 클램프 발동률을 재는 데만 쓴다(진단 전용). */
  let lastRawDt = 0;

  /* ── 리워드 광고(2026-08-31 신설) ────────────────────────────────────────
   * 지면 3종: 부활 / 시작 크기 부스트 / 스킨 해금. ID 는 reward/adGroups.ts 하나뿐.
   * ⛔전면형(interstitial.ts)은 «건드리지 않았다» — 이 절의 코드는 ads.* 를
   *   읽지도 쓰지도 않고, 유일한 접점은 「부스트로 시작할 때 ads.gate 를 «건너뛴다»」
   *   한 줄뿐이다(그 자리에 이유를 적어 뒀다).
   *
   * ★ 광고 제안을 «띄우지 않는» 조건을 여기 한 곳에 모은다:
   *   · 토스 밖(브라우저·Pages·MS Store) → rewardAdsUsable() 이 false.
   *   · ?ads=off / ?demo=1 → rewardsEnabled 가 false. 기존 QA·촬영 스크린샷이
   *     «픽셀 단위로» 그대로 유지된다(tools/gfx_harness.py 는 전부 ads=off 다).
   */
  const rewardsEnabled = adsMode !== 'off';
  /** 이번 판에 부활을 이미 썼는가. ★판당 1회 — startRun 만 false 로 되돌린다. */
  let reviveUsedThisRun = false;
  /** 다음 판을 «길게» 시작할 권리를 받았는가(광고 시청 완료). startRun 이 «한 번» 소비한다. */
  let startBoostArmed = false;
  /** 마지막 사망 원인. 부활이 경계 사망을 «안쪽으로» 되돌리는 데 쓴다. */
  let lastDeathCause: DeathInfo['cause'] = 'body';
  /**
   * recordRun 직전의 저장본 스냅샷.
   * ★ 부활하면 그 판은 «아직 안 끝난» 것이다. 되돌리지 않으면 한 판이 두 번 세어져
   *   games 가 +2 가 되고 킬·플레이시간이 이중 가산된다(사망 화면은 연출이지만
   *   기록은 상태다 — onPlayerDied 주석의 그 구분이 여기서도 그대로 적용된다).
   */
  let runRecordSnapshot: {
    bestScore: number; bestRank: number; games: number; totalKills: number; playSeconds: number;
  } | null = null;
  /* ── 검사기용 «결정적» 계측 (tools/qa_reward.py) ────────────────────────
   * ★ 왜 필요한가: 검사기가 나중에 state().player.mass 를 읽으면 그 사이
   *   프레임이 돌아 먹이를 먹는다(실측 +1.1). 그 값으로 「시작 질량이 12 인가」를
   *   판정하면 «옳은 코드가 틀린 것으로» 나온다. 그래서 그 순간의 값을 박아 둔다.
   *   운영 로직은 이 두 변수를 읽지 않는다 — 쓰기만 한다. */
  let lastSpawnMass = 0;
  let lastRevive: {
    fromMass: number; toMass: number; cause: string; orbsReclaimed: number;
  } | null = null;

  /* ── ④ 기록 돌파 리워드 (2026-09-01 개정, President 지시) ───────────────
   * 「500·2000·5000 을 넘을 때 + 개인 최고 기록 돌파 때」 광고를 제안하고,
   * 보면 «광고 직전 질량»의 1.2배.
   *
   * ★★ 2026-09-01 President 판정으로 «설계가 뒤집혔다».
   *    옛 구현은 제안을 띄우며 월드를 완전정지시켰다 — 그게 「방해」로 판정됐다.
   *    지금은 이렇게 나뉜다:
   *      · 제안(배너)  = 게임이 «그대로 흐른다». 화면 위쪽 작은 배너가
   *                      GROWTH_OFFER_S 초 떠 있다가 스스로 사라진다.
   *                      입력을 «가로막지 않는다»(컨테이너는 pointer-events:none).
   *      · 수락(광고)  = 그때는 어쩔 수 없이 멈춘다(광고가 화면을 덮으므로).
   *                      복귀는 기존 «카운트다운»을 그대로 탄다.
   *    ⇒ 정지의 «유일한» 스위치는 여전히 mode==='offer' 이고 판정은 worldFrozen() 이다.
   *      달라진 것은 그 스위치를 «언제» 켜느냐다(배너 표시 X → 광고 진입 O).
   */
  const growth = new GrowthTriggers();
  /**
   * 판 «시작 시점»의 개인 최고 기록.
   * ★ save.bestScore 를 직접 읽지 않는다. 그 값은 recordRun 이 사망 순간에 올리고,
   *   부활하면 undoRunRecord 가 되돌린다 — 즉 «판 도중에 움직일 수 있는 값»이다.
   *   움직이는 기준으로 「돌파」를 판정하면 같은 판에서 기준이 바뀐다.
   */
  let growthBestAtRunStart = 0;
  /** 지금 떠 있는 제안 배너(없으면 null). ★게임은 이 동안에도 흐른다. */
  let pendingOffer: GrowthOffer | null = null;
  /**
   * 배너가 사라지기까지 «남은 초».
   *
   * ★ 남은 «시각»이 아니라 남은 «양»인 이유는 복귀 카운트다운(resumeLeft)과 같다:
   *   벽시계로 두면 앱이 백그라운드에 있는 동안에도 흘러, 돌아왔을 때는 기회가
   *   이미 사라져 있다. 프레임 dt 로 깎으면 rAF 가 멈춘 동안은 배너도 안 줄어든다.
   * ★ 그리고 «월드가 실제로 진행한 프레임»에서만 깎는다(일시정지·광고 중에는 정지).
   */
  let bannerLeft = 0;
  /**
   * 보상의 기준 질량 — 광고 때문에 월드가 «멈춘 그 순간»의 질량(President 2026-09-01).
   *
   * ★ 왜 「탭한 순간」이 아니라 「멈춘 순간」인가: 탭한 뒤 광고 로드가 지연되는
   *   동안에도 게임이 흐르면 질량이 또 변한다. 그래서 onGrowthAd() 는 «먼저 멈추고»
   *   그 자리에서 이 값을 찍는다 — 즉 이 구현에서 두 시점은 같은 프레임이다.
   * ★ 배너가 떠 있는 5초 동안 질량은 늘 수도(먹이) 줄 수도(질주 BOOST_DRAIN) 있다.
   *   그래서 「문턱값 × 1.2」도 「배너가 뜬 순간 × 1.2」도 아니다.
   * ★ 0 = 기준 없음(제안이 없거나 무산됐다).
   */
  let growthBaseMass = 0;
  /**
   * 스냅샷 일련번호. 「이 스냅샷이 «아직 그 스냅샷인가»」를 판정하는 데만 쓴다.
   * ★질량 값으로 비교하면 안 된다 — 다음 제안이 우연히 같은 값을 찍을 수 있다.
   */
  let growthBaseSeq = 0;
  /**
   * 복귀 카운트다운의 «남은 초». 0 이하면 카운트다운 중이 아니다.
   *
   * ★★ 「끝나는 시각」이 아니라 «남은 양»인 이유(실제 위험):
   *   시각으로 두면 performance.now() 가 «앱이 백그라운드에 있는 동안에도» 흐른다.
   *   유저가 광고를 보다 홈으로 나갔다 60초 뒤 돌아오면, 돌아온 «첫 프레임»에
   *   이미 만료된 카운트다운이 즉시 재개돼 화면을 보기도 전에 게임이 흐른다.
   *   남은 양을 «프레임 dt»(루프 상단에서 DT_MAX 0.25s 로 잘린다)로 깎으면,
   *   rAF 가 멈춘 동안은 카운트다운도 멈춘다 — 안 보이는 사이에 재개되지 않는다.
   */
  let resumeLeft = 0;
  /** 마지막으로 화면에 그린 카운트다운 숫자(중복 DOM 대입 방지). */
  let lastCountShown = -1;
  /**
   * 제안으로 «멈춘» 시각(performance.now()). 재개할 때 그만큼 runStartedAt 을 민다.
   * ★ 광고를 본 30초는 «플레이 시간»이 아니다. 안 빼면 기록(playSeconds)에
   *   광고 시간이 그대로 들어간다 — 부활 경로(doRevive 의 runStartedAt += adMs)와
   *   같은 판단이고, 여기서는 광고뿐 아니라 «읽고 고민한 시간·카운트다운»까지
   *   전부 멈춰 있던 시간이라 통째로 뺀다.
   */
  let offerFrozenAt = 0;
  /**
   * 판 일련번호. startRun 마다 +1.
   * ★ 왜 필요한가: 늦은 보상(rewardAd 방어 ④)은 최대 15초 뒤에 온다. 그 사이에
   *   유저가 죽고 «다음 판»을 시작했을 수 있다. 그때 mode 만 보면 'play' 라
   *   «엉뚱한 판의 뱀»이 커진다. 번호가 같을 때만 지급한다.
   */
  let runSeq = 0;
  /** 이번 판에 실제로 «지급»된 성장 횟수(제안 횟수가 아니다). */
  let growthGrantedThisRun = 0;
  /** 검사기 계측 — 마지막 성장의 전/후. 운영 로직은 읽지 않는다. */
  let lastGrowth: GrowthApplied | null = null;

  /* ── ⑤ 결과 화면 「이번 판 성장 2배」 + 이어받기 (2026-09-10 레인 A) ──────────────
   * 이번 판에 «키운 만큼»(최종 점수 − 시작 질량)의 일부가 다음 판 시작으로 이어진다(carryStore).
   * 광고를 보면 그 몫이 2배. 세션 1회 · 일 3회(DAILY_CAP.resultDouble).
   */
  /** 이번 판에서 2배권을 «이미 받았는가». 부활 뒤 최종 사망에서도 2배가 유지된다(광고를 두 번 시키지 않는다). startRun 이 푼다. */
  let carryDoubleEarned = false;
  /** 세션(앱 실행 1회) 동안 2배를 «한 번» 썼는가. 새로고침·재실행이 세션의 경계다. */
  let resultDoubleUsedThisSession = false;
  /**
   * ★이 결과 화면에서 리워드 광고가 «표시»됐는가. 참이면 「다시 하기·메뉴」는 전면형 게이트를 «이번만»
   *   건너뛴다(같은 화면에서 전면형 연속 노출 금지 — 토스 정책). 빚(adPending)은 그대로 남아 다음
   *   합법 지점에서 소비된다(interstitial.ts gate 주석 실측). 노출을 «잃는» 게 아니라 «미루는» 것이다.
   */
  let rewardShownOnResult = false;
  /** 마지막 판의 성장(최종 점수 − 시작 질량). 2배 지급이 «같은 판의 성장»으로 다시 확정할 때 쓴다. */
  let lastRunGrowth = 0;
  /** 검사기 계측 — 마지막으로 확정한 이어받기. 운영 로직은 읽지 않는다. */
  let lastCarry: CarryRecord | null = null;

  /**
   * 월드가 «멈춰 있는가». 프레임 루프의 모든 정지 조건이 이 함수 하나를 본다.
   * ⛔ mode !== 'pause' 를 다시 손으로 쓰지 마라 — 그게 이 함수를 만든 이유다.
   */
  function worldFrozen(): boolean {
    return mode === 'pause' || mode === 'offer';
  }

  function makeMenuWorld(): World {
    // 타이틀 뒤에서 «실제 게임»이 돌아간다. 배경 이미지가 아니다.
    const w = new World(timeSeed(), '', save.skin, true);
    return w;
  }

  function unlockedSet(bestScore: number): Set<string> {
    const s = new Set<string>();
    for (const sk of SKINS) if (isSkinUnlocked(sk, bestScore)) s.add(sk.id);
    return s;
  }

  /* ── 실기기 진단 줄(2026-09-08) ────────────────────────────────────────
   * ★ 왜 있나: iOS 프레임 저하를 헤드리스로 «세 번» 재현 실패했다(9/7~9/8).
   *   데스크톱은 모바일 GPU fill-rate 를 원리적으로 모사하지 못한다.
   *   ⇒ 기기가 스스로 말하게 한다. President 스크린샷 «한 장»이면 어느 층이
   *     무너지는지 확정된다. 켜는 법은 HUD 「길이」 1.5초 안 5연타.
   * ⛔ OFF 면 비용 0 이어야 한다:
   *     · renderer.profile 이 꺼져 있어 층별 ms 측정 자체가 «안 돈다».
   *     · 아래 프레임 링도 diagOn 일 때만 쓴다.
   *     · 셸이 diagPerf() 를 «부르지도» 않는다.
   */
  let diagOn = false;
  const diagRing = new Float32Array(180);   // 최근 프레임 간격(ms). 2초치면 충분.
  let diagRingI = 0;
  let diagRingN = 0;
  /** 마지막 «강등» [tier, 그때의 게임시각(초)]. 3초만 보여 준다. */
  let diagLastDown: [number, number] | null = null;
  let diagLastDownAt = -1e9;
  let diagPrevTier = 0;

  // ── UI ─────────────────────────────────────────────────────────────────
  const shell = new Shell(root, save, {
    onPlay(nick) {
      /* ★★ 리워드 광고가 «도는 중»이면 화면을 옮기지 않는다(2026-09-10 Codex 적대적 리뷰 지적 2).
         결과 화면에서 「성장 2배」를 누른 뒤 로드가 끝나기 전에 「다시 하기」를 누르면,
         전면형(gate)이 먼저 뜨고 그 위로 리워드 show 가 겹쳐 «서로 다른 지면의 광고 2편»이 된다
         (실측 재현: show 호출 2건). 셸도 버튼을 disabled 로 잠그지만(setRewardBusy) 상태로도 막는다 —
         가시성 잠금 하나만 믿으면 훅·키보드·검사기 경로가 그대로 통과한다. */
      if (rewardAdInFlight()) return;
      sfx.unlock();
      const clean = sanitizeNick(nick);
      save.nick = clean ?? '';
      writeSave(save);
      // ★ 합법 노출 지점 ①②: 메뉴 「시작」 · 결과 화면 「다시하기」.
      //   둘 다 «판과 판 사이»다(mode 는 menu 또는 dead). 플레이 중이 아니다.
      //   광고를 안 띄울 상황이면 gate 는 «동기»로 startRun 을 부른다 — 지연 0.
      // ★2026-09-10: 이 결과 화면에서 리워드 광고가 «방금» 표시됐으면 전면형을 건너뛴다(빚은 유지).
      if (mode === 'dead' && rewardShownOnResult) {
        startRun();
        return;
      }
      ads.gate(startRun);
    },
    onSkin(id) {
      save.skin = id;
      writeSave(save);
    },
    onControl(m) {
      save.control = m;
      input.mode = m;
      writeSave(save);
    },
    onSound(on) {
      save.sound = on;
      sfx.setEnabled(on);
      if (on) sfx.unlock();
      writeSave(save);
    },
    onLocale(l) {
      save.locale = l;
      setLocale(l);
      setBotNameLocale(l); // 다음 판부터 반영된다(진행 중인 판의 이름을 바꾸면 킬 피드가 어그러진다).
      applyDocumentTitle(l === 'ko');
      canvas.setAttribute('aria-label', t('a11yCanvas'));
      writeSave(save);
      shell.refreshTexts();
    },
    onPauseToggle() {
      if (mode === 'play') setPaused(true);
      else if (mode === 'pause') setPaused(false);
    },
    onResume() {
      setPaused(false);
    },
    onUi() {
      sfx.unlock();
      sfx.ui();
    },
    /** 진단 줄 on/off — «여기서만» 층별 계측을 켜고 끈다(꺼두면 비용 0). */
    onDiagToggle(on: boolean) {
      diagOn = on;
      renderer.profile = on || debug;
      diagRingI = 0;
      diagRingN = 0;
      diagLastDown = null;
    },
    /** 진단 줄 2행 값. 셸은 ON 일 때만 부른다. */
    diagPerf() {
      if (!diagOn) return null;
      // 최근 프레임 간격 p95 — 링을 «복사 없이» 훑어 95번째 백분위를 고른다.
      let p95 = 0;
      if (diagRingN > 0) {
        const tmp: number[] = [];
        for (let i = 0; i < diagRingN; i++) tmp.push(diagRing[i]);
        tmp.sort((a, b) => a - b);
        p95 = tmp[Math.min(tmp.length - 1, Math.floor(tmp.length * 0.95))];
      }
      // 화면 안 «굵은» 뱀 수. 카메라 사각 + 반지름 20 이상.
      const cam = renderer.camera;
      const halfW = renderer.cssW / (2 * cam.zoom);
      const halfH = renderer.cssH / (2 * cam.zoom);
      let giants = 0;
      for (const s of world.snakes) {
        if (!s.alive || s.radius < 20) continue;
        if (Math.abs(s.x - cam.x) > halfW + s.radius) continue;
        if (Math.abs(s.y - cam.y) > halfH + s.radius) continue;
        giants++;
      }
      const t = renderer.times;
      return {
        fps,
        fp95: p95,
        sim: simMs,
        rend: t.total,
        post: t.post,
        body: t.bodies,
        tier: renderer.gov.tier,
        giants,
        dpr: renderer.worldDpr,
        cw: renderer.world.width,
        ch: renderer.world.height,
        webgl: renderer.bloomSupported,
        lastDown: diagLastDown,
      };
    },
    onQuit() {
      // ★리워드 광고가 도는 중이면 화면을 옮기지 않는다(onPlay 와 같은 이유 — 광고 2편 겹침 방지).
      if (rewardAdInFlight()) return;
      // ★ 이 콜백은 «두 화면»이 공유한다 — 일시정지 「그만두기」와 결과 화면 「메뉴」.
      //   · 일시정지에서 왔으면 판이 «아직 열려 있다» → 여기서 «버린 판»으로 확정된다.
      //     ⇒ 결과 화면을 «안 거치고» 나가도 판 수가 똑같이 세어진다(요구사항 1의 함정).
      //   · 결과 화면에서 왔으면 판은 onPlayerDied() 에서 «이미» 닫혔다 → endRun 은 no-op.
      //   ★ 순서가 중요하다: 계수를 «먼저» 해야 이번 판이 만든 빚을 gate 가 본다.
      ads.endRun('abandon');
      // ★2026-09-10: 결과 화면에서 리워드 광고가 «방금» 표시됐으면 전면형을 건너뛴다(빚은 유지).
      if (mode === 'dead' && rewardShownOnResult) {
        toMenu();
        return;
      }
      // ★ 합법 노출 지점 ③④.
      ads.gate(toMenu);
    },
    onReviveAd() {
      void onReviveAd();
    },
    onResultDoubleAd() {
      void onResultDoubleAd();
    },
    onPushEnable() {
      void enablePush();
    },
    onPushDismiss() {
      dismissPushNudge();
    },
    onXpromoOpen() {
      /* ★결과는 세 갈래다(toss/openUrl.ts): 'failed' 일 때만 실패 문구를 보인다.
         'unknown'(4초 무응답)은 앱이 실제로 열려서 우리 WebView 가 멈춘 경우일 수 있어 «아무 말도 안 한다». */
      shell.setXpromoOpen(true);
      void openCrossPromo().then((outcome) => {
        shell.setXpromoOpen(false, outcome === 'failed');
      });
    },
    onXpromoClose() {
      /* 노출일은 «보인 순간»에 이미 기록됐다. 닫기는 화면만 접는다(셸이 했다). */
    },
    onStartBoostAd() {
      void onStartBoostAd();
    },
    onSkinProgressAd() {
      void onSkinProgressAd();
    },
    onSkinAdUnlock(id) {
      void onSkinAdUnlock(id);
    },
    onGrowthAd() {
      void onGrowthAd();
    },
    onGrowthSkip() {
      // 배너를 «지금» 닫는다. 게임은 이미 흐르고 있으므로 재개 절차가 없다.
      dismissGrowthBanner();
    },
  });

  /* 스킨 특수 기능 런타임. ★상태는 «판 단위»라 startRun 이 reset 한다.
     지금 어떤 스킨인지는 매 틱 «인자로» 넘긴다 — 안에 들고 있으면 메뉴에서
     스킨을 바꿨을 때 옛 능력이 남는다(상태를 두 곳에 두면 반드시 갈린다). */
  const abilities = createAbilityRuntime();

  // ── 리워드: 「지금 이 제안을 띄워도 되는가」 ────────────────────────────
  //    셸은 그릴 때마다 이 함수들에 «묻는다». 상태를 셸에 복사하지 않는다.
  function canOfferRevive(): boolean {
    return rewardsEnabled && !demo && rewardAdsUsable() && !reviveUsedThisRun && underDailyCap('revive')
      // ★2026-09-10: 이 결과 화면에서 리워드 광고가 «이미» 떴으면 두 번째 제안을 두지 않는다(아래 규율).
      && !rewardShownOnResult;
  }
  function canOfferStartBoost(): boolean {
    return rewardsEnabled && !demo && rewardAdsUsable() && underDailyCap('startBoost');
  }
  /**
   * 지금 «기록 돌파 제안을 띄워도 되는가». 게임을 멈추는 제안이므로
   * 부활·부스트보다 조건이 하나 더 많다 — 「띄웠는데 광고가 없어서 아무 일도
   * 안 일어나는」 상황이면 «멈추지도 말아야» 한다.
   */
  function canOfferGrowth(): boolean {
    return (
      rewardsEnabled && !demo && rewardAdsUsable()
      && !growth.atRunCap() && underDailyCap('growth')
    );
  }
  /**
   * 결과 화면 「이번 판 성장 2배」를 «지금 띄워도 되는가»(2026-09-10).
   * 가용 · 결과 화면 · 세션 1회 · 이번 판 미지급 · 일 3회 · «기본 몫이 있다»(0 을 2배 해 주는 버튼은 죽은 버튼이다).
   * ★요청 전 가드 — 버튼을 그릴 때와 탭했을 때 «둘 다» 이 함수에 묻는다(요청 = 노출 원칙).
   *
   * ★★「한 화면에서 리워드는 «한 번»」(2026-09-10 · 실렌더를 보고 넣은 규율).
   *   결과 화면에는 부활(REWARDED)과 이 2배(REWARDED)가 «둘 다» 설 수 있다. 둘 다 선택형이라 동시에
   *   재생되지는 않지만, 하나를 보고 나서 다른 하나를 이어 보면 «같은 화면에서 전면 광고 두 편»이 된다 —
   *   토스 정책의 「같은 화면 같은 포맷 2개 금지」에 걸릴 위험이고, 사망 직후 광고 2연타는 이탈 쪽이다.
   *   ⇒ 광고가 «실제로 뜬 뒤»(rewardShownOnResult)에는 그 화면의 다른 리워드 제안을 «감춘다».
   *     선택지 자체는 그대로다 — 유저는 둘 중 «하나»를 고른다. 로드 실패로 광고가 못 뜬 경우엔
   *     rewardShownOnResult 가 false 라 다른 쪽이 그대로 남는다(노출 기회를 잃지 않는다).
   */
  function canOfferResultDouble(): boolean {
    if (!rewardsEnabled || demo || !rewardAdsUsable()) return false;
    if (mode !== 'dead') return false;
    if (rewardShownOnResult) return false;
    if (resultDoubleUsedThisSession || carryDoubleEarned) return false;
    if (!underDailyCap('resultDouble')) return false;
    const c = pendingCarry();
    return c.base > 0 && !c.doubled;
  }

  /**
   * ★ 광고 스킨 해금의 «유일한» 관문이다. 세 곳이 전부 이 함수에 묻는다:
   *   ① 카드 버튼을 그릴 때 (ui/shell.ts:1017 adOffer)
   *   ② 카드를 탭했을 때   (ui/shell.ts:409)
   *   ③ 실제 지급 직전     (onSkinAdUnlock 첫 줄)
   *   ⇒ 그래서 여기 한 줄이면 「버튼은 감췄는데 뒷문은 열려 있다」가 구조적으로 안 생긴다.
   *     반대로 여기를 우회하는 새 호출 경로를 만들면 그 순간 이 보장이 깨진다.
   */
  function canAdUnlockSkin(id: string): boolean {
    if (!rewardsEnabled || demo || !rewardAdsUsable()) return false;
    // ★화이트리스트 밖은 «광고로 열리지 않는다»(President 2026-09-01, 프로모션 예산 보호).
    //   근거·목록·「3종으로 줄이는 법」은 game/skins.ts AD_UNLOCKABLE_SKIN_IDS 주석.
    //   ⚠️보유 판정(isSkinAdUnlocked / ownsPromoSkin)에는 손대지 않았다 — 회수 금지.
    if (!isAdUnlockableSkin(id)) return false;
    const sk = SKINS.find((x) => x.id === id);
    if (!sk) return false;
    // 이미 점수로 열렸거나 광고로 열었으면 «제안하지 않는다»(같은 걸 두 번 팔지 않는다).
    if (isSkinUnlocked(sk, save.bestScore) || isSkinAdUnlocked(id)) return false;
    return underDailyCap('skinUnlock');
  }

  shell.setRewardHost({
    /* ★ 「지금 고를 수 있는가」의 «단일» 관문. 경로가 셋이다:
         ① 점수(isSkinUnlocked — 셸이 직접 본다)
         ② 리워드 광고 해금(isSkinAdUnlocked, 하위 5종 화이트리스트)
         ③ 누적 광고 시청 100회(meetsSkinRequirement — 2026-09-02 신설)
       ③ 을 «여기 한 곳»에 더했다. 카드 그리기·카드 탭·히어로가 전부 이 함수에
       물으므로 「버튼은 열렸는데 못 고른다」가 구조적으로 안 생긴다. */
    isSkinAvailable: (id) => {
      if (isSkinAdUnlocked(id)) return true;
      const sk = SKINS.find((x) => x.id === id);
      return sk ? meetsSkinRequirement(sk, save.bestScore) : false;
    },
    canAdUnlockSkin,
    canOfferRevive,
    canOfferStartBoost,
    canOfferSkinProgress,
    skinProgress: () => {
      const t = SKINS.find((x) => typeof x.unlockAds === 'number');
      return { have: adWatchTotal(), need: t?.unlockAds ?? 0 };
    },
    isStartBoostArmed: () => startBoostArmed,
    canOfferResultDouble,
    carryPreview: () => {
      const c = pendingCarry();
      return { base: c.base, mass: c.mass, doubled: c.doubled };
    },
  });

  /* ── 프로모션: 블랙맘바 «보유» 판정 + 기준선 ──────────────────────────────
   * ★「보유」의 정의는 스킨 카드·목록이 쓰는 것과 «완전히 같은 식»이다
   *   (ui/shell.ts:402·1016·1035 — 점수 해금 ‖ 광고 해금). 여기서 새로 정의하지 않는다.
   * ★기준선: 이 빌드가 이 기기에서 «처음 실행되는 순간»의 보유 여부를 박는다.
   *   그때 이미 보유 중이었으면 이 미션은 «영구 미지급»이다(President 2026-09-01).
   * ★부팅 직후 한 번 알린다 — 지난 실행에서 해금했는데 지급이 못 끝난 경우의 복구 경로다.
   *   (기준선에 미보유 + 지금 보유 인 경우에만 지급된다. 소급 지급이 아니다.) */
  function ownsPromoSkin(): boolean {
    const sk = SKINS.find((x) => x.id === PROMO_SKIN_ID);
    if (!sk) return false;
    return isSkinUnlocked(sk, save.bestScore) || isSkinAdUnlocked(sk.id);
  }
  void initMambaPromo(ownsPromoSkin).then(() => notifyMambaOwnership());

  /* ── ③⑤ 스킨 해금 프로모션 2종 (2026-09-02) ────────────────────────────
   * ③ 킹코브라 300원 / ⑤ 특수 스킨 500원.
   * ★「보유」의 정의를 «여기»에 둔다 — mamba 와 같은 규율이다. 규칙을 프로모션
   *   모듈 안에 적으면 해금 경로가 늘 때(광고 누적 100회 같은) 한쪽을 반드시 놓친다.
   *   ⑤ 는 «최고급 2종 중 하나라도» 열리면 달성으로 본다(스킨이 둘이라 어느 쪽이든
   *   「특수 스킨을 해금했다」가 참이다).
   */
  function ownsSkinFor(promoId: string): boolean {
    if (SKIN_PROMO_FORCE_OWNED) return true; // ⛔TESTONLY 전용. 정본은 false 라 상수접기로 사라진다.
    const owned = (id: string): boolean => {
      const sk = SKINS.find((x) => x.id === id);
      if (!sk) return false;
      return isSkinUnlocked(sk, save.bestScore) || isSkinAdUnlocked(id)
        || meetsSkinRequirement(sk, save.bestScore);
    };
    if (promoId === 'kingcobra') return owned('kingcobra');
    if (promoId === 'premium') return PREMIUM_SKIN_IDS.some(owned);
    return false;
  }
  void initSkinPromos(ownsSkinFor).then(() => notifySkinPromos());

  /** 광고 가용성이 바뀌었을 수 있다 — 제안 버튼·스킨 카드를 다시 그린다. */
  function refreshRewardUi(): void {
    shell.refreshReward();
    shell.refreshSkins();
  }

  /** @param low 판이 «진행 중»이라 HUD 가 떠 있는 자리인가(shell.showToast 주석 참조). */
  function rewardFailToast(reason: string | undefined, low = false): void {
    shell.showToast(failKind(reason) === 'load' ? rt().failLoad : rt().failWatch, 2600, low);
  }

  /* ── ① 부활 ─────────────────────────────────────────────────────────────
   * ⛔allowInferred 를 «켜지 않는다». 부활은 점수·순위를 바꾸는 보상이다.
   *   「12초 이상 떠 있었으니 봤겠지」로 지급하면 그건 광고 시청이 아니라 추측이다.
   *   추론 지급은 코스메틱(스킨)에만 쓴다 — rewardAd.ts ⑤ 주석 참조.
   */
  async function onReviveAd(): Promise<void> {
    if (!canOfferRevive() || mode !== 'dead') return;
    shell.setRewardBusy('revive');
    const t0 = performance.now();
    let granted = false;
    const grant = (): void => {
      // 정상 보상과 «늦은 보상»이 겹칠 수 있다 — 지급은 한 번뿐이다.
      if (granted || reviveUsedThisRun) return;
      granted = true;
      doRevive(performance.now() - t0);
    };
    try {
      const res = await showRewardAd({
        surface: 'revive',
        onLateReward: () => {
          // 판정이 실패로 끝난 뒤 보상이 늦게 왔다(안드로이드 실사고 형태).
          // 아직 사망 화면에 있으면 «그때» 살린다. 이미 나갔으면 조용히 버린다
          // — 판이 끝난 뒤에 부활시키면 다음 판의 몸이 뒤바뀐다.
          if (mode === 'dead') grant();
        },
      });
      // ★광고가 «화면에 떴다»(보상 여부와 무관) — 같은 결과 화면의 다른 리워드 제안과 전면형을 접는다.
      if (res.ok || failKind(res.reason) === 'watch') rewardShownOnResult = true;
      if (res.ok) grant();
      else rewardFailToast(res.reason);
    } finally {
      // setRewardBusy(null) 이 제안 버튼을 다시 그린다 — 위 플래그가 섰으면 그때 2배 제안이 접힌다.
      shell.setRewardBusy(null);
    }
  }

  function doRevive(adMs: number): void {
    reviveUsedThisRun = true;
    noteGranted('revive');
    undoRunRecord();
    // ★이어받기도 되돌린다(2026-09-10) — 그 판은 아직 안 끝났다. 최종 사망에서 다시 확정된다.
    //   2배권을 이미 썼으면 carryDoubleEarned 가 남아 최종 사망의 몫이 그대로 2배다(광고를 두 번 시키지 않는다).
    clearCarry();
    lastCarry = null;
    // ★ 광고를 본 시간은 «플레이 시간»이 아니다. 기록에서 뺀다
    //   (안 빼면 30초짜리 광고가 그대로 playSeconds 에 들어간다).
    runStartedAt += adMs;
    const fromMass = world.player.mass;
    const orbsReclaimed = reviveInPlace(world, { cause: lastDeathCause });
    lastRevive = { fromMass, toMass: world.player.mass, cause: lastDeathCause, orbsReclaimed };
    mode = 'play';
    camSnap = false; // 카메라는 이미 그 자리를 보고 있다 - 튀게 하지 않는다
    input.beginRun();
    if (!demo) sfx.start();
    shell.showGame();
    shell.showToast(rt().reviveOk);
  }

  /** recordRun 이 이미 쓴 기록을 되돌린다(부활 = 그 판은 아직 안 끝났다). */
  function undoRunRecord(): void {
    const snap = runRecordSnapshot;
    if (!snap) return;
    runRecordSnapshot = null;
    save.bestScore = snap.bestScore;
    save.bestRank = snap.bestRank;
    save.games = snap.games;
    save.totalKills = snap.totalKills;
    save.playSeconds = snap.playSeconds;
    writeSave(save);
  }

  /* ── ② 시작 크기 부스트 ────────────────────────────────────────────────── */
  async function onStartBoostAd(): Promise<void> {
    if (startBoostArmed || !canOfferStartBoost()) return;
    shell.setRewardBusy('boost');
    let granted = false;
    const grant = (autoStart: boolean): void => {
      if (granted || startBoostArmed) return;
      granted = true;
      startBoostArmed = true;
      noteGranted('startBoost');
      if (autoStart && mode === 'menu') {
        // ★ 광고를 «방금» 본 유저에게 전면광고를 연달아 띄우지 않는다 —
        //   리텐션이 우리 최대 문제다. 그래서 여기서만 ads.gate 를 건너뛴다.
        //   ⛔전면형 «로직»은 그대로다: 빚(adPending)은 사라지지 않고 다음 합법
        //     지점(다시 하기·메뉴)에서 그대로 소비된다(interstitial.ts gate 주석 실측).
        //     즉 노출을 «잃는» 게 아니라 «미루는» 것이다.
        startRun();
      } else {
        // 늦은 보상이거나 이미 화면을 옮긴 경우 — 권리만 쥐어 주고 다음 시작에 쓴다.
        shell.showToast(rt().boostOk);
        refreshRewardUi();
      }
    };
    try {
      const res = await showRewardAd({
        surface: 'startBoost',
        onLateReward: () => grant(false),
      });
      if (res.ok) grant(true);
      else rewardFailToast(res.reason);
    } finally {
      shell.setRewardBusy(null);
    }
  }

  /* ── ④B 최고급 스킨 «진행도» (2026-09-02, 전용 지면) ─────────────────────
   * President: 「따로 전용 리워드 광고를 설치해」. 기존 4지면과 «합산하지 않는다».
   *
   * ★자리: 스킨 블록 «안», 레일 «아래». 근거 — 유저가 100회를 채우러 «찾아올»
   *   자리여야 한다(Partner 지시). 잠긴 최고급 카드와 그 「0/100」이 바로 위에
   *   보이는 곳이 유일하게 그 조건을 만족한다. 시작 화면 상단에 두면 「이게 왜
   *   여기 있지」가 되고, 무엇을 위한 광고인지 화면이 스스로 말하지 못한다.
   *
   * ★상한: DAILY_CAP.skinProgress(10/일) → 100회에 «최소 10일». 근거는 그 상수 주석.
   * ★단조 증가: noteAdWatched 가 «지급이 확정된 뒤»에만 오른다. 광고를 열기만
   *   하고 닫은 것은 세지 않는다 — 그걸 세면 100회가 사실상 공짜가 된다.
   */
  function canOfferSkinProgress(): boolean {
    if (!rewardsEnabled || demo || !rewardAdsUsable()) return false;
    if (!underDailyCap('skinProgress')) return false;
    // 이미 «다» 채웠으면 제안하지 않는다. 죽은 버튼을 만들지 않는다.
    const target = SKINS.find((s) => typeof s.unlockAds === 'number');
    if (!target) return false;
    return !meetsSkinRequirement(target, save.bestScore);
  }

  async function onSkinProgressAd(): Promise<void> {
    if (!canOfferSkinProgress()) return;
    shell.setRewardBusy('skin');
    let granted = false;
    const grant = (): void => {
      if (granted) return;
      granted = true;
      noteGranted('skinProgress');
      const total = noteAdWatched('skinProgress');
      const target = SKINS.find((s) => typeof s.unlockAds === 'number');
      const need = target?.unlockAds ?? 0;
      refreshRewardUi();
      if (target && total >= need) {
        // 마지막 한 편이었다 — «해금»이 곧 보상이다.
        shell.showToast(fmt(rt().skinOk, { name: skinName(target, getLocale()) }));
        sfx.unlockSkin();
        void notifyMambaOwnership();
      void notifySkinPromos();
      } else {
        shell.showToast(sfmt(st().progressOk, { have: String(total), need: String(need) }));
      }
    };
    try {
      const res = await showRewardAd({
        surface: 'skinProgress',
        // ⭐순수 코스메틱 진행도라 스킨 해금과 «같은» 판단이다(네온 -24 규율).
        allowInferred: true,
        onLateReward: () => grant(),
      });
      if (res.ok) grant();
      else rewardFailToast(res.reason);
    } finally {
      shell.setRewardBusy(null);
    }
  }

  /* ── ③ 스킨 해금 ───────────────────────────────────────────────────────
   * ⭐allowInferred 를 «여기만» 켠다. 순수 코스메틱이라 잘못 줘도 밸런스가
   *   안 흔들린다. 네온 스레드 -24 와 같은 판단이다.
   */
  async function onSkinAdUnlock(id: string): Promise<void> {
    const skin = SKINS.find((x) => x.id === id);
    if (!skin || !canAdUnlockSkin(id)) return;
    shell.setRewardBusy('skin');
    let granted = false;
    const grant = (): void => {
      if (granted) return;
      granted = true;
      if (!grantSkinUnlock(id)) return; // 멱등 — 이미 열려 있으면 상한도 안 깎는다
      save.skin = id; // 방금 연 스킨을 «바로» 입혀 준다. 한 번 더 탭하게 하지 않는다.
      writeSave(save);
      // 프로모션: 광고로 스킨이 열린 «직후». 대상 스킨이 아니면 mambaPromo 가 알아서 무시한다.
      void notifyMambaOwnership();
      void notifySkinPromos();
      refreshRewardUi();
      shell.showToast(fmt(rt().skinOk, { name: skinName(skin, getLocale()) }));
      sfx.unlockSkin();
    };
    try {
      const res = await showRewardAd({
        surface: 'skinUnlock',
        allowInferred: true,
        onLateReward: grant,
      });
      if (res.ok) grant();
      else rewardFailToast(res.reason);
    } finally {
      shell.setRewardBusy(null);
    }
  }

  /* ── ⑤ 결과 화면 「이번 판 성장 2배」 (2026-09-10 레인 A) ─────────────────────────
   * 보상 = 다음 판 시작으로 «이어받는» 몫(carryStore)을 2배로. 광고 없이도 기본 몫은 이미 확정돼 있다
   * (onPlayerDied 의 commitCarry) — 「광고를 봐야만」이 아니다.
   * ⛔allowInferred 를 «켜지 않는다» — 다음 판 시작 질량을 바꾸는 «게임 결과» 보상이다(부활과 같은 판단).
   * ★버튼 뒤 로드(요청 = 노출). 프리로드 없음. 연타는 shell.busy + rewardAd.inFlight 가 막는다.
   * ★리워드가 «표시»되면 rewardShownOnResult — 이 화면의 「다시 하기·메뉴」는 전면형을 건너뛴다.
   */
  async function onResultDoubleAd(): Promise<void> {
    if (!canOfferResultDouble()) return;
    shell.setRewardBusy('double');
    const seqAtAd = runSeq;
    let granted = false;
    const grant = (): void => {
      // 정상 보상과 늦은 보상이 겹칠 수 있다 — 지급은 한 번뿐이다.
      if (granted) return;
      granted = true;
      resultDoubleUsedThisSession = true;
      noteGranted('resultDouble');
      /* ★늦은 보상이 «다음 판이 시작된 뒤»에 오면(runSeq 가 바뀜) 이어받기는 이미 소비됐다.
         그때 새 판의 몫을 건드리면 엉뚱한 판이 2배가 된다 — 지급을 «접는다»(상한만 센다). 드문 경로다. */
      if (runSeq !== seqAtAd) return;
      carryDoubleEarned = true;
      lastCarry = commitCarry(lastRunGrowth, true, seqAtAd);
      refreshRewardUi();
      /* 토스트는 «결과 화면에 있을 때»만 위쪽에 띄운다. 메뉴로 옮긴 뒤 늦은 보상이 오면 그 화면 위에 띄운다 —
         어느 쪽이든 「무슨 일이 일어났는지 한 줄로 말한다」는 규율(네온 -23)은 지킨다. */
      shell.showToast(fmt(rst().doubleOk, { m: String(lastCarry.mass) }));
    };
    try {
      const res = await showRewardAd({
        surface: 'resultDouble',
        onLateReward: () => {
          /* ★화면이 어디든 «같은 판»이면 지급한다(2026-09-10 Codex 적대적 리뷰 지적 6).
             예전엔 `mode === 'dead'` 를 함께 걸어, 결과 화면을 떠나 메뉴로 가면 15초 안에 도착한
             늦은 보상이 «통째로 사라졌다»(실측: 추가 지급 0). 이 보상은 화면이 아니라 «다음 판 시작»에
             얹히는 값이라 결과 화면에 남아 있을 이유가 없다 — 판(runSeq)만 같으면 뜻이 성립한다.
             ⛔runSeq 가 다르면 다음 판이 이미 시작돼 이어받기가 소비된 뒤다. 그때는 지급하지 않는다
               (엉뚱한 판이 2배가 된다). 그 경우는 아래 grant() 안에서 한 번 더 막는다. */
          if (runSeq === seqAtAd) grant();
        },
      });
      // 광고가 «화면에 떴다»(보상 여부와 무관) — 같은 화면에서 전면형을 연달아 띄우지 않는다.
      if (res.ok || failKind(res.reason) === 'watch') rewardShownOnResult = true;
      if (res.ok) grant();
      else rewardFailToast(res.reason);
    } finally {
      shell.setRewardBusy(null);
    }
  }


  /* ── ④ 기록 돌파: 감시 → 제안 → 광고 → 복귀 ─────────────────────────── */

  /**
   * 매 프레임 «점수»를 보고 제안할 때가 됐는지 판단한다.
   * ★ 8Hz HUD 갱신에 얹지 않는다 — 문턱을 지나친 뒤 최대 125ms 늦게 뜨고,
   *   그 사이에 죽으면 제안이 통째로 사라진다. 정수 비교 한 번이라 매 프레임이 싸다.
   */
  function watchGrowth(): void {
    if (mode !== 'play' || pendingOffer) return;
    if (!world.playerAlive || !world.player.alive) return;
    if (!canOfferGrowth()) return;
    // ★ HUD·순위표·최종 점수와 «같은 값»이어야 한다(world.ts:505 · updateHud 실측).
    const score = Math.floor(world.player.mass);
    // ★ world.time 을 넘긴다 — «멈춰 있는 동안 안 흐르는» 시계다. 쿨다운은
    //   「광고를 보고 돌아온 뒤 실제로 조종한 시간」으로 재야 뜻이 맞는다.
    const offer = growth.evaluate(score, growthBestAtRunStart, world.time);
    if (offer) showGrowthBanner(offer);
  }

  /**
   * 제안 배너를 «띄운다». ⛔월드를 멈추지 않는다 — 그게 2026-09-01 개정의 핵심이다.
   *
   * ★ 트리거 «소비»는 여기다(광고를 봤을 때가 아니라). 안 누르고 5초가 지나
   *   사라져도 같은 문턱으로 다시 묻지 않는다 — 안 그러면 2,001·2,002 점마다
   *   계속 뜬다(President 요구 4). 쿨다운 시계도 이 순간부터 간다.
   * ★ HUD 를 «안 감춘다». 옛 모달은 감췄지만, 지금은 게임이 흐르는 중이라
   *   점수·순위·피드가 사라지면 그 자체가 방해다.
   */
  function showGrowthBanner(offer: GrowthOffer): void {
    pendingOffer = offer;
    bannerLeft = GROWTH_OFFER_S;
    growth.consume(offer, growthBestAtRunStart, world.time);
    shell.showOfferBanner(offer.kind, offer.value, 1);
  }

  /**
   * 배너를 «지금» 닫는다. 트리거는 이미 소비됐으므로 다시 뜨지 않는다.
   * ★ 재개 절차가 «없다» — 게임은 애초에 멈춘 적이 없다.
   */
  function dismissGrowthBanner(): void {
    if (!pendingOffer) return;
    pendingOffer = null;
    bannerLeft = 0;
    shell.hideOffer();
  }

  /**
   * 배너의 남은 시간을 «프레임 dt»로 깎는다. ★월드가 실제로 진행한 프레임에서만
   * 부른다(프레임 루프의 !worldFrozen() 블록 안) — 광고를 보는 동안이나 일시정지
   * 중에 배너 시간이 흐르면, 돌아왔을 때 기회가 이미 사라져 있다.
   *
   * @param dt 이번 프레임 시간(초). 루프 상단에서 DT_MAX(0.25s)로 잘려 온다 —
   *   백그라운드에서 돌아온 한 프레임이 5초를 통째로 삼키지 못한다.
   */
  function tickGrowthBanner(dt: number): void {
    if (!pendingOffer) return;
    bannerLeft -= dt;
    if (bannerLeft <= 0) {
      dismissGrowthBanner();
      return;
    }
    // 남은 시간 막대. transform 만 바꾸므로 레이아웃이 없다(게임 루프와 GPU 공유).
    shell.setOfferProgress(bannerLeft / GROWTH_OFFER_S);
  }

  /** 광고를 보고 키운다. ⛔allowInferred 를 켜지 않는다 — 점수·순위를 바꾸는 보상이다. */
  async function onGrowthAd(): Promise<void> {
    if (mode !== 'play' || !pendingOffer) return;
    if (!world.playerAlive || !world.player.alive) return;
    if (!rewardAdsUsable() || !underDailyCap('growth')) return;
    // ★★ 여기서 «먼저» 멈춘다. 광고 로드가 몇 초 걸릴 수 있고, 그동안 게임이
    //   계속 흐르면 광고를 기다리다 죽는다 — 그건 이 기능이 만든 사고가 된다.
    //   그리고 멈추는 «그 순간»의 질량이 보상 기준이다(President 2026-09-01).
    //   ⇒ 두 일이 같은 프레임에 일어나야 뜻이 맞는다. 그래서 한자리에 붙여 둔다.
    growthBaseMass = world.player.mass;
    growthBaseSeq++;
    bannerLeft = 0;
    resumeLeft = 0;
    lastCountShown = -1;
    offerFrozenAt = performance.now();
    mode = 'offer';
    input.setPaused(true);
    // 질주 소리를 끊는다. 손가락은 이제 화면에서 떨어진다.
    world.player.boosting = false;
    if (wasBoosting) {
      sfx.boost(false);
      wasBoosting = false;
    }
    shell.setRewardBusy('grow');
    const seqAtAd = runSeq;
    let granted = false;
    const grant = (): void => {
      // 정상 보상과 늦은 보상이 겹칠 수 있다 — 지급은 한 번뿐이다.
      if (granted) return;
      granted = true;
      doGrowth();
    };
    try {
      const res = await showRewardAd({
        surface: 'growth',
        onLateReward: () => {
          // 판정이 실패로 끝난 뒤 보상이 늦게 왔다(안드로이드 실사고 형태).
          //
          // ★★ 「아직 제안 판이 떠 있을 때만」으로 좁히면 «안 된다» — 실패 판정
          //   직후 finally 가 복귀 카운트다운을 걸어 pendingOffer 를 비우기 때문에,
          //   그 조건은 사실상 «절대 참이 되지 않는다». 그러면 안드로이드에서
          //   「광고를 끝까지 봤는데 아무 일도 안 일어난다」가 그대로 재발한다
          //   (네온 -23 의 사고 모양 그 자체다).
          // ⇒ 조건은 «같은 판에서 아직 살아 있는가» 하나다:
          //     · mode==='offer'  = 아직 멈춰 있다(판 또는 카운트다운 중)
          //     · mode==='play'   = 이미 복귀했다. 그래도 준다 — 질량 1.2배는
          //       판정 반경을 최대 1.2 유닛 넓힐 뿐이라 «달리는 중에 줘도 안전»하다
          //       (gameEffects.applyGrowthReward 머리말의 수치 근거).
          //   ⛔ runSeq 가 다르면 «다음 판»이다. 그때 주면 엉뚱한 뱀이 커진다.
          if (runSeq !== seqAtAd) return;
          if (mode === 'offer' || (mode === 'play' && world.playerAlive)) grant();
          // (mode==='offer' = 아직 광고/카운트다운으로 멈춰 있다.
          //  mode==='play' = 이미 복귀했다 — 그래도 준다. 기준은 아래 doGrowth 의 스냅샷.)
        },
      });
      if (res.ok) grant();
      else rewardFailToast(res.reason, true); // 판 진행 중 - 토스트를 아래로
    } finally {
      shell.setRewardBusy(null);
      // ★ 성공이든 실패든 «반드시» 복귀 절차를 탄다. 여기서 빠지면 월드가
      //   영원히 멈춘 채로 남는다(광고 실패가 게임을 죽이는 최악).
      if (mode === 'offer' && resumeLeft <= 0) beginResumeCountdown();
      // ★★ 무산된 스냅샷 폐기(President 2026-09-01 규격 4).
      //   ⛔여기서 «즉시» 버리면 안 된다 — 늦은 보상(④)이 최대 15초 뒤에 오고,
      //     그때 기준이 없으면 「광고를 끝까지 봤는데 아무 일도 안 일어난다」가
      //     그대로 재발한다(네온 -23 실사고 형태). ⇒ 그 창이 «닫힌 뒤» 버린다.
      //   ⛔질량 값이 아니라 일련번호로 대조한다. 그 사이에 새 제안이 새 스냅샷을
      //     찍었으면 그건 «다른» 스냅샷이고, 버리면 그 보상이 사라진다.
      //   ★ 벽시계(setTimeout)로 재는 것이 맞다 — 늦은 보상 창 자체가 SDK 의
      //     벽시계이기 때문이다(프레임 dt 로 재는 배너·카운트다운과 이유가 다르다).
      if (!granted) {
        const staleSeq = growthBaseSeq;
        setTimeout(() => {
          if (growthBaseSeq === staleSeq) growthBaseMass = 0;
        }, LATE_REWARD_WINDOW_MS + 1000);
      }
    }
  }

  function doGrowth(): void {
    noteGranted('growth');
    growthGrantedThisRun++;
    // ★★ 기준은 «광고 직전 스냅샷»이다(President 2026-09-01). 지금 질량이 아니다.
    //   늦은 보상(안드로이드 이벤트 역순) 경로에서는 이미 게임이 재개돼 질량이
    //   달라져 있을 수 있는데, 그때도 «스냅샷»을 쓴다.
    //   ⛔「스냅샷과 현재 중 큰 값」을 쓰지 않는 이유(어뷰징 검토 결과):
    //     늦은 보상은 특정 기기에서 «재현 가능»하게 발생한다(네온 -23 실사고).
    //     그런 기기에서는 「탭 → 광고 닫기 → 15초 더 키우기 → 늦게 도착한 보상이
    //     그 커진 질량의 1.2배」가 되어, 같은 광고 1회가 훨씬 큰 보상이 된다.
    //     즉 «기기에 따라 보상이 달라지는» 경로이고 반복 가능하다. 그래서 안 쓴다.
    //   ⇒ 스냅샷이 없으면(0) 지급하지 않는다 — 기준 없는 지급은 만들지 않는다.
    if (growthBaseMass <= 0) return;
    lastGrowth = applyGrowthReward(world, growthBaseMass);
    growthBaseMass = 0;
    shell.showToast(fmt(gt().ok, { k: growthLabel(), n: String(lastGrowth.toScore) }), 2600, true);
    // ★ 카운트다운이 «이미 돌던 중»에 늦은 보상이 들어왔다면 3초를 다시 준다.
    //   방금 몸이 커졌는데 남은 0.4초로 복귀시키면 그게 우리가 막으려던 사고다.
    if (mode === 'offer' && resumeLeft > 0) {
      resumeLeft = RESUME_COUNTDOWN_S;
      lastCountShown = -1;
    }
  }

  /**
   * 복귀 카운트다운을 «건다». 실제 재개는 프레임 루프가 한다.
   *
   * ★ setTimeout 이 아니라 프레임 루프로 세는 이유(중요):
   *   앱이 백그라운드로 가면 rAF 는 멈추지만 setTimeout 은 (느리게라도) 돈다.
   *   타이머로 세면 «화면이 안 보이는 사이에» 게임이 재개되고, 돌아왔을 때는
   *   이미 죽어 있다. rAF 로 세면 안 보이는 동안은 카운트다운도 멈춘다.
   */
  function beginResumeCountdown(): void {
    if (mode !== 'offer') return;
    pendingOffer = null;
    bannerLeft = 0;
    resumeLeft = RESUME_COUNTDOWN_S;
    lastCountShown = -1;
    shell.hideOffer();
    // HUD 를 되돌린다 — 멈춘 아레나와 내 점수를 보며 다음 수를 정하는 시간이다.
    shell.showGame();
  }

  /**
   * 프레임 루프가 매 프레임 부른다. 남은 초를 «프레임 dt 로» 깎고, 0 이 되면 재개한다.
   * ★ dt 는 루프 상단에서 DT_MAX(0.25s) 로 잘려 온다 — 백그라운드에서 돌아온
   *   한 프레임이 카운트다운을 통째로 삼키지 못한다.
   */
  function tickResume(dt: number): void {
    if (mode !== 'offer' || resumeLeft <= 0) return;
    resumeLeft -= dt;
    const left = resumeLeft;
    if (left <= 0) {
      resumeLeft = 0;
      lastCountShown = -1;
      shell.hideCountdown();
      // ★ 멈춰 있던 시간(제안 읽기 + 광고 + 카운트다운)을 «플레이 시간»에서 뺀다.
      if (offerFrozenAt) {
        runStartedAt += performance.now() - offerFrozenAt;
        offerFrozenAt = 0;
      }
      mode = 'play';
      input.setPaused(false);
      // ★ 조준 각도를 «지금 진행 방향»으로 되돌린다. 광고를 보는 동안 손가락은
      //   떨어져 있었고, 조이스틱은 마지막으로 잡혔던 각도를 들고 있을 수 있다.
      //   그대로 재개하면 카운트다운을 보며 정한 방향이 아니라 «옛 방향»으로 꺾인다.
      world.player.targetAngle = world.player.angle;
      input.beginRun();
      return;
    }
    const n = Math.ceil(left);
    if (n !== lastCountShown) {
      lastCountShown = n;
      shell.showCountdown(n);
    }
  }

  /** 판이 끝나거나(사망) 화면을 옮길 때 제안 상태를 «통째로» 접는다. */
  function cancelGrowthOffer(): void {
    // ★ 누수 차단 ② — 성장 제안(mode='offer')이 건 일시정지.
    //   진입(위 openGrowthOffer)에서 input.setPaused(true) 를 걸지만, 해제는
    //   카운트다운 «완주» 경로 하나뿐이었다. 사망·화면이동으로 «취소»되면
    //   그대로 굳는다. 배너를 더 눈에 띄게 바꾼 뒤 이 경로 노출이 늘었다.
    //   ⛔ mode==='offer' 일 때만 푼다 — 일시정지(mode='pause') 중 취소에서
    //     조작을 되살리면 멈춘 화면에서 뱀이 도는 «반대 버그»가 된다.
    if (mode === 'offer') input.setPaused(false);
    pendingOffer = null;
    bannerLeft = 0;
    // 무산된 제안의 기준 질량은 «버린다». 남겨 두면 다음 판의 지급이 옛 질량을 쓴다.
    growthBaseMass = 0;
    offerFrozenAt = 0;
    resumeLeft = 0;
    lastCountShown = -1;
    shell.hideOffer();
    shell.hideCountdown();
  }
  input.mode = save.control;
  input.onPauseRequest = () => {
    if (mode === 'play') setPaused(true);
    else if (mode === 'pause') setPaused(false);
  };

  // ── 전환 ───────────────────────────────────────────────────────────────
  function wireHooks(w: World): void {
    w.hooks = {
      onEat(x, y, color, value) {
        renderer.particles.eat(x, y, color, value);
        sfx.eat(value);
      },
      onBurst(x, y, color, radius) {
        renderer.particles.burst(x, y, color, radius);
        // 큰 뱀이 «내 화면 안»에서 터지면 화면이 살짝 흔들린다(사건의 크기가 몸으로 읽힌다).
        if (mode === 'play' && radius >= 14 && renderer.inView(x, y, 40)) renderer.shake(Math.min(6, radius * 0.25));
      },
      onKill(e) {
        if (mode !== 'play') return;
        // 문구 조립은 셸이 한다 - 로케일마다 어순이 다르다(ui/shell.ts pushKill 주석).
        shell.pushKill(e);
        if (e.killerIsPlayer) {
          sfx.kill();
          shell.punch();
          // 독(venom) — 잡은 «직후»부터 잔해 흡수 반경이 커진다(스킨 능력).
          abilities.onPlayerKill(world);
        }
      },
      onPlayerDeath(info) {
        lastDeath = info;
        sfx.boost(false);
        sfx.death();
        // 충돌 — 화면 흔들림. 렌더에만 걸린다(입력·판정 무관, 이미 죽은 뒤다).
        renderer.shake(14);
        onPlayerDied(info);
      },
    };
  }

  function startRun(): void {
    // ★ 안전망(광고 계수). 여기 도달했는데 이전 판이 «아직 열려 있다»면 그 판은
    //   위 네 경로를 «안 거치고» 버려진 것이다 — 지금 확정한다.
    //   현재 코드에서 이 줄이 실제로 세는 경로는 ?debug=1 의 __coil.startRun() 뿐이지만,
    //   나중에 「일시정지 → 다시하기」 같은 버튼이 생겨도 «자동으로» 잡힌다.
    //   ⛔ 「지금은 도달 불가니 지우자」로 지우지 마라. 네온 스레드 v1 이 판 계수를
    //     놓친 원인이 정확히 「경로마다 따로 세기」였다.
    ads.endRun('abandon');
    const seed = forcedSeed ? Number(forcedSeed) >>> 0 : timeSeed();
    const nick = save.nick || defaultNick();
    world = new World(seed, nick, save.skin, demo);
    wireHooks(world);
    // ★ 「길게 시작」 권리를 «여기서 한 번만» 소비한다.
    //   먼저 false 로 내리고 적용한다 — 적용 중 무슨 일이 나도 권리가 남아
    //   다음 판에 또 걸리는(중복 적용) 일이 없다.
    // ★2026-09-10: 시작 질량 = START_MASS + 이어받기(carryStore, «한 번» 소비) 위에 부스트(길이 1.4배)를 곱한다.
    //   부스트가 «길이 배수»라 이어받기 위에 그대로 곱해진다 — 두 보상이 서로를 잠식하지 않는다(gameEffects).
    //   데모(촬영·소크)는 둘 다 안 쓴다 — 스크린샷이 픽셀 단위로 유지된다.
    if (!demo) {
      let startMass = START_MASS + consumeCarry();
      if (startBoostArmed) {
        startBoostArmed = false;
        startMass = boostedStartMassFrom(startMass);
      }
      if (startMass !== START_MASS) applyStartMass(world, startMass);
    }
    carryDoubleEarned = false;
    rewardShownOnResult = false;
    lastSpawnMass = world.player.mass; // 검사기 계측(부스트·이어받기 적용 «직후»의 값 = 이번 판 성장의 기준)
    // 판당 상태 초기화. 부활은 «판당 1회»이므로 여기가 유일한 해제 지점이다.
    reviveUsedThisRun = false;
    abilities.reset(); // 독 지속시간은 «판을 넘기지 않는다»
    runRecordSnapshot = null;
    // ★ 기록 돌파도 «판당»이다 — 문턱 3개·최고기록 1회·판당 상한이 전부 여기서 풀린다.
    runSeq++;
    growth.reset();
    growthGrantedThisRun = 0;
    growthBestAtRunStart = save.bestScore;
    cancelGrowthOffer();
    renderer.particles.clear();
    renderer.gov.resetWindow();
    applyPendingScale('startRun'); // 아직 mode 는 menu/dead — 캔버스 크기 변경은 «여기»(판 사이)뿐
    if (!demo) sfx.start();
    mode = 'play';
    camSnap = true;
    runStartedAt = performance.now();
    input.beginRun();
    // 「판이 시작됐다」 — 광고 게이트의 최소 자격(MIN_PLAY_MS) 판정 기준점이다.
    // ★ 데모(무인 촬영·소크)는 «판으로 세지 않는다». 사람이 논 판이 아니고,
    //   수 분간 돌리면 카운터만 부풀어 저장본에 남는다. 시작을 안 알리면
    //   endRun 이 전부 no-op 이 되므로 계수 경로가 통째로 비활성된다.
    if (!demo) ads.beginRun();
    shell.showGame();
    // 첫 세 판까지만 조작 안내. 그 뒤엔 아는 사람에게 소음이다.
    if (!demo && save.games < 3) {
      // ★ 어느 조작 문구를 쓸지는 셸이 «기기 능력»으로 고른다.
      //   input.isTouch 는 첫 터치 전까지 false 라, 여기서 고르면 모바일에서
      //   게임을 켜자마자 마우스 안내가 떴다(ui/shell.ts showControlHint 주석).
      shell.showControlHint();
    }
  }

  function defaultNick(): string {
    return getLocale() === 'ko' ? '나' : 'You';
  }

  function onPlayerDied(info: DeathInfo): void {
    // ★ 판 종료 «주 신호». 결과 화면(700ms 뒤)이 아니라 «사망 그 순간»에 센다.
    //   결과 화면은 연출이지 상태가 아니다 — 그걸 안 보고 나가도 판은 끝난 것이다.
    ads.endRun('death');
    // ★ 제안 중에는 죽을 수 «없다»(월드가 멈춰 있다). 그래도 접는다 —
    //   「도달 불가라 지운다」가 네온 v1 계수 사고의 원인이었다.
    cancelGrowthOffer();
    lastDeathCause = info.cause;
    // ★ 기록 «직전» 스냅샷 — 부활을 고르면 이 판은 아직 안 끝난 것이라 되돌린다.
    runRecordSnapshot = {
      bestScore: save.bestScore, bestRank: save.bestRank, games: save.games,
      totalKills: save.totalKills, playSeconds: save.playSeconds,
    };
    const before = unlockedSet(save.bestScore);
    const seconds = (performance.now() - runStartedAt) / 1000;
    const isBest = recordRun(save, info.score, info.rank, info.kills, seconds);
    const after = unlockedSet(save.bestScore);
    /* ★적립은 before/after 를 «다 뽑은 뒤»다. 먼저 적립하면 새로 열린 스킨이
       before 에도 들어가 「새 스킨 달성」 축하가 영원히 안 뜬다. */
    syncUnlockLedger();
    // 프로모션: 최고 점수가 오르면 점수 해금이 열릴 수 있다(블랙맘바 = 12000).
    // ★recordRun «뒤»에 부른다. 부활을 고르면 undoRunRecord 가 되돌리는데, 그때는
    //   ownsPromoSkin() 이 다시 false 가 되므로 지급 조건이 서지 않는다(중복 지급 없음).
    void notifyMambaOwnership();
      void notifySkinPromos();

    let newSkin: Skin | null = null;
    for (const sk of SKINS) {
      if (!before.has(sk.id) && after.has(sk.id)) {
        // 여러 개가 한꺼번에 열리면 «가장 높은 것»을 보여준다(더 큰 보상이 인상적이다).
        if (!newSkin || sk.unlockScore > newSkin.unlockScore) newSkin = sk;
      }
    }
    mode = 'dead';
    /* ★이어받기 확정(2026-09-10 레인 A). 이번 판에 «키운 만큼»(최종 점수 − 시작 질량)의 몫이 다음 판 시작으로
       간다 — 광고 없이도 받는 «기본 몫»이다. 부활하면 doRevive 가 되돌린다(그 판은 아직 안 끝났다).
       2배권을 이 판에서 이미 썼으면(carryDoubleEarned) 그대로 2배로 확정된다. */
    lastRunGrowth = Math.max(0, Math.floor(info.score) - Math.floor(lastSpawnMass));
    lastCarry = demo ? null : commitCarry(lastRunGrowth, carryDoubleEarned, runSeq);
    rewardShownOnResult = false;
    // ★ 사망 화면을 «즉시» 띄우지 않는다. 터지는 연출을 0.7초 보여준 뒤 띄운다.
    //   바로 띄우면 무슨 일이 일어났는지 못 보고 「그냥 꺼졌다」로 느껴진다.
    window.setTimeout(() => {
      if (mode === 'dead') {
        /* 「머니 리그」 교차추천(2026-09-10) — 토스 안 + 오늘 아직 안 보였을 때만. 노출일은 «보이는 순간» 기록. */
        const xp = !demo && canShowCrossPromo();
        if (xp) noteCrossPromoShown();
        shell.setXpromo(xp);
        shell.showDeath(info, isBest, newSkin);
        if (newSkin) sfx.unlockSkin();
      }
    }, 700);
  }

  function toMenu(): void {
    // ★ 안전망(광고 계수) — startRun 의 것과 같은 이유다. 정상 경로에서는
    //   onQuit 이 «이미» 확정했으므로 no-op 이다.
    ads.endRun('abandon');
    cancelGrowthOffer();
    // ★ 누수 차단 ① — 일시정지 중 「그만두기」.
    //   setPaused(false) 는 mode==='pause' 일 때만 동작한다(아래 setPaused 참고).
    //   여기서 mode 가 'menu' 로 바뀌는 순간 «되돌릴 방법이 영영 없어진다».
    //   그러면 input.paused 가 true 로 굳어 그 뒤 «모든» 판에서 onDown/onMove 가
    //   조기반환하고 aim=null 이 된다 = 스틱도 안 뜨고 뱀도 안 돈다.
    //   실측(하네스 레인): 이 경로 warm 56/56 = 100% 조작 불능, 콜드 0.36%.
    input.setPaused(false);
    mode = 'menu';
    applyPendingScale('toMenu');
    world = makeMenuWorld();
    wireHooks(world);
    renderer.particles.clear();
    sfx.boost(false);
    camSnap = true;
    shell.showMenu();
  }

  function setPaused(p: boolean): void {
    if (p && mode === 'play') {
      mode = 'pause';
      input.setPaused(true);
      sfx.boost(false);
      shell.showPause();
    } else if (!p && mode === 'pause') {
      mode = 'play';
      input.setPaused(false);
      shell.hidePause();
    }
  }

  wireHooks(world);

  // ── 리사이즈 ───────────────────────────────────────────────────────────
  function onResize(): void {
    renderer.resize();
    const mini = renderer.minimapRectCss();
    input.resize(
      renderer.cssW, renderer.cssH,
      renderer.safe.right, renderer.safe.bottom,
      mini.y - mini.r,
      renderer.safe.left,
    );
  }
  window.addEventListener('resize', onResize);
  // ★ orientationchange 직후에는 innerWidth/Height 가 «아직 안 바뀐» 상태다.
  //   한 프레임 뒤에 다시 재는 것이 실측으로 확인된 유일하게 안정적인 방법이다.
  window.addEventListener('orientationchange', () => {
    onResize();
    window.setTimeout(onResize, 120);
    window.setTimeout(onResize, 400);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onResize);
  }
  onResize();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && mode === 'play') setPaused(true);
    // ★2026-09-10: 복귀 시 전면형 «빚이 있는데 준비가 안 된» 상태면 백오프를 풀고 한 번 다시 받는다
    //   (interstitial.onForeground — iOS 백그라운드에서 콜백이 유실된 경우의 «재연결»). 숨김에서는 요청 0.
    else if (!document.hidden) ads.onForeground();
  });

  // ── 루프 ───────────────────────────────────────────────────────────────
  const leaderRows: LeaderRow[] = [];
  let acc = 0;
  let last = performance.now() / 1000;
  let fpsAcc = 0;
  let fpsFrames = 0;
  let fps = 0;
  let wasBoosting = false;
  /** 진단 전용(__coil.stress): 부하 시험 대상 봇 id·고정 질량·강제 질주. 운영 경로에서는 비어 있다. */
  const stressIds: number[] = [];
  let stressMass = 0;
  let stressBoost = false;
  let simMs = 0;
  /** 진단 전용(__coil.freeze): 렌더 시각을 고정해 «같은 프레임»을 두 번 찍을 수 있게 한다. */
  let frozenAt = -1;

  // ── 적응형 해상도 컨트롤러 ────────────────────────────────────────────
  // ★ 규율 세 가지가 없으면 이 장치는 «깜빡임»을 만든다:
  //   1) 히스테리시스 - 내리는 문턱(52)과 올리는 문턱(58)을 벌린다.
  //   2) 지속 시간   - 순간값이 아니라 «연속으로 N초» 유지될 때만 움직인다.
  //   3) 쿨다운      - 바꾼 직후에는 한동안 다시 바꾸지 않는다(해상도 변경
  //      자체가 한 프레임을 잡아먹어, 그걸 근거로 또 내리는 되먹임이 생긴다).
  // ═══ 2026-08-30 네 번째 규율: «플레이 중엔 캔버스 크기를 안 바꾼다» ═══════════
  //   실측(_gfx_evidence_260830/bench F_*_adaptive): 플레이 중 해상도 변경을 허용한 런이 «고정 런보다 느렸다»
  //   (cpu8 n10: 42.7 → 36.3 fps, 스파이크 364 → 495). 리사이즈 = 캔버스·FBO·배경 캐시 재할당 = 그 자체가
  //   스파이크이고, 그 스파이크를 근거로 또 바꾸는 되먹임이 «깜빡임»이다(네온 -22 실기기 사고).
  //   → 플레이 중엔 «결정만» 한다(pendingStep). 적용은 판과 판 사이(startRun·toMenu)에서만.
  //   플레이 중 단계 강등은 거버너(render/quality.ts)가 «같은 캔버스 안에서» 파티클→비늘→블룸 순으로 한다.
  let lowFor = 0;
  let highFor = 0;
  let scaleCooldown = 0;
  const DOWN_FPS = 52;
  const UP_FPS = 58;
  const DOWN_HOLD = 1.2;
  const UP_HOLD = 6;
  const COOLDOWN = 2.5;
  /** 다음 판에 적용할 해상도 단계(-1 = 없음). */
  let pendingStep = -1;

  /** 판과 판 사이에서만 부른다(startRun·toMenu). 플레이 중 캔버스 크기 변경 0 의 «유일한» 적용 지점. */
  function applyPendingScale(why: string): void {
    if (pendingStep < 0) return;
    const from = renderer.renderScale;
    const step = pendingStep;
    pendingStep = -1;
    if (mode === 'play' || mode === 'pause' || mode === 'offer') return; // 방어 — 플레이 중엔 절대 안 바꾼다
    if (step < renderer.scaleStep) {
      if (renderer.gov.promotions >= 2) return;
      renderer.gov.promotions++;
    }
    if (renderer.setScaleStep(step)) {
      onResize();
      scaleCooldown = COOLDOWN;
      renderer.gov.log.push({ t: Math.round(renderer.gov.clock * 100) / 100, from: -1, to: -1,
        why: 'scale ' + from + ' -> ' + renderer.renderScale + ' @' + mode + ' (' + why + ')', now: performance.now() });
      console.info('[king-snake] 해상도 ' + from + ' -> ' + renderer.renderScale + ' (' + why + ', ' + mode + ')');
    }
  }

  function adaptResolution(dt: number): void {
    if (scaleCooldown > 0) {
      scaleCooldown -= dt;
      lowFor = 0;
      highFor = 0;
      return;
    }
    if (fixScale !== null) return; // 진단 모드: 해상도를 고정한다
    // 일시정지/메뉴에서는 판단하지 않는다(부하 조건이 다르다).
    if (mode !== 'play') return;
    if (fps <= 0) return;
    if (pendingStep >= 0) return; // 이미 결정했다 — 다음 판에 적용될 때까지 재판단 안 함

    if (fps < DOWN_FPS) {
      lowFor += dt;
      highFor = 0;
    } else if (fps > UP_FPS) {
      highFor += dt;
      lowFor = 0;
    } else {
      lowFor = 0;
      highFor = 0;
    }

    // ★ 해상도 하향은 거버너가 «이미 T2 이상»(블룸 Q1 이하)까지 내린 뒤에만 — 값싼 것부터, 해상도는 그 다음.
    if (lowFor >= DOWN_HOLD) {
      if (renderer.gov.tier >= 2 && renderer.scaleStep < 3) {
        pendingStep = renderer.scaleStep + 1;
        console.info('[king-snake] 해상도 하향 «예약» -> step ' + pendingStep + ' (fps ' + fps.toFixed(1) + ', 다음 판 적용)');
      }
      lowFor = 0;
    } else if (highFor >= UP_HOLD) {
      if (renderer.scaleStep > 0 && renderer.gov.promotions < 2) {
        pendingStep = renderer.scaleStep - 1;
        console.info('[king-snake] 해상도 상향 «예약» -> step ' + pendingStep + ' (다음 판 적용)');
      }
      highFor = 0;
    }
  }

  function frame(nowMs: number): void {
    requestAnimationFrame(frame);
    const now = nowMs / 1000;
    let dt = now - last;
    last = now;
    if (!(dt > 0)) return;
    lastRawDt = dt;  // ★ «자르기 전» 값. 클램프가 실제로 물렸는지 세려면 이게 필요하다.
    if (dt > DT_MAX) dt = DT_MAX;
    lastDt = dt;   // ★ 진단 훅이 「이 프레임의 정상 이동량」을 계산하는 데 쓴다

    // ★ 진단 줄이 «켜져 있을 때만» 프레임 간격을 링에 쌓는다. OFF 면 비교 1회가 전부다.
    if (diagOn) {
      diagRing[diagRingI] = lastRawDt * 1000;
      diagRingI = (diagRingI + 1) % diagRing.length;
      if (diagRingN < diagRing.length) diagRingN++;
      const tr = renderer.gov.tier;
      if (tr > diagPrevTier) {
        diagLastDown = [tr, Math.round(renderer.gov.clock * 10) / 10];
        diagLastDownAt = now;
      }
      diagPrevTier = tr;
      // 강등 표시는 3초만 남긴다(그 뒤엔 화면을 덜 먹는 쪽이 낫다).
      if (diagLastDown && now - diagLastDownAt > 3) diagLastDown = null;
    }

    fpsAcc += dt;
    fpsFrames++;
    if (fpsAcc >= 0.5) {
      fps = fpsFrames / fpsAcc;
      fpsAcc = 0;
      fpsFrames = 0;
    }

    adaptResolution(dt);
    input.update();
    shell.setTouchHint(input.isTouch);
    // 방향을 한 번이라도 준 순간 조작 안내를 접는다(조이스틱을 가리지 않게).
    if (input.visual.stickActive || input.aimAngle !== null) shell.dismissControlHint();

    const p = world.player;
    // 데모 모드에서는 AI 가 조종한다 - 입력을 덮어쓰면 안 된다.
    const playing = mode === 'play' && p.alive && !demo;
    if (playing) {
      if (input.aimAngle !== null) p.targetAngle = input.aimAngle;
      p.boosting = input.boosting && p.mass > BOOST_MIN_MASS;
      if (p.boosting !== wasBoosting) {
        sfx.boost(p.boosting);
        wasBoosting = p.boosting;
      }
      if (p.boosting) {
        renderer.particles.boostSpark(p.x, p.y, p.angle, p.style.glow, p.radius);
      }
    }

    // ★ 봇의 질주도 «보여야» 한다. 잔불이 없으면 상대가 달려드는지 알 수 없어
    //   회피 판단이 불가능해진다 - 연출이 아니라 게임 정보다.
    //   화면 밖은 건너뛴다(링 버퍼를 안 보이는 파티클로 채우면 보이는 게 밀린다).
    if (!worldFrozen()) {
      for (const s of world.snakes) {
        if (!s.alive || s.isPlayer || !s.boosting) continue;
        if (!renderer.inView(s.x, s.y, 80)) continue;
        if (Math.random() < 0.55) {
          renderer.particles.boostSpark(s.x, s.y, s.angle, s.style.glow, s.radius);
        }
      }
    } else if (wasBoosting) {
      sfx.boost(false);
      wasBoosting = false;
    }

    if (!worldFrozen() && frozenAt < 0) {
      acc += dt;
      let sub = 0;
      // ★ 진단(?debug=1)에서만: 시뮬 1프레임 비용을 잰다(렌더 층별 ms 와 같은 자리에 싣는다).
      // ★ 진단 줄이 켜져 있을 때도 잰다 — 그 줄의 «sim» 칸이 비면 실기기에서
      //   「렌더가 문제인가 시뮬이 문제인가」를 가를 수 없다(이 줄의 존재 이유다).
      //   꺼져 있으면 performance.now() 호출 자체가 없다 = 비용 0.
      const simMeasure = debug || diagOn;
      const simT0 = simMeasure ? performance.now() : 0;
      while (acc >= STEP && sub < MAX_SUB) {
        // ★ 부하 시험(__coil.stress) — 지정 봇을 «계속 질주·거대» 상태로 못박는다. debug 전용.
        if (stressIds.length) {
          for (const id of stressIds) {
            const s = world.snakes[id];
            if (!s || !s.alive) continue;
            if (s.mass < stressMass) { s.mass = stressMass; s.updateDerived(); }
            if (stressBoost) s.boosting = true;
          }
        }
        world.step(STEP);
        acc -= STEP;
        sub++;
      }
      if (simMeasure) simMs += ((performance.now() - simT0) - simMs) * 0.1;
      // 상한에 걸렸으면 남은 시간은 «버린다». 안 버리면 다음 프레임에 더 밀린다.
      if (sub >= MAX_SUB) acc = 0;
      renderer.particles.update(dt);
      // ★ 스텝이 «끝난 뒤»에 본다. 스텝 전에 보면 이번 프레임에 먹은 먹이가
      //   반영되기 전 점수로 판단해 한 프레임 늦는다.
      watchGrowth();
      /* 스킨 특수 기능. ★월드가 «진행한» 프레임에서만 돈다 — 광고·일시정지 중에도
         흡수가 돌면 «멈춘 사이에 질량이 는다». 성장 리워드에서 배운 규율 그대로다. */
      if (mode === 'play') abilities.tick(world, save.skin);
      // ★ 배너 시계는 «월드가 진행한» 프레임에서만 깎인다 — 이 블록 안이 그 조건이다.
      tickGrowthBanner(dt);
    }
    // 카운트다운은 월드가 멈춰 있는 동안 도는 «유일한» 시계다.
    tickResume(dt);

    // 카메라: 죽은 뒤에는 마지막 위치를 그대로 본다(시체가 흩어지는 걸 보여준다).
    const camTarget = p.alive ? p : p;
    renderer.camera.follow(
      camTarget.x, camTarget.y, camTarget.angle, camTarget.radius,
      camTarget.boosting, dt, camSnap,
    );
    camSnap = false;

    input.headSX = (p.x - renderer.camera.x) * renderer.camera.zoom + renderer.cssW / 2;
    input.headSY = (p.y - renderer.camera.y) * renderer.camera.zoom + renderer.cssH / 2;

    // 블룸 60fps 감시 — «플레이 중» 프레임 간격만 넣는다(메뉴·일시정지는 부하 조건이 다르다).
    if (mode === 'play' && frozenAt < 0) renderer.sampleFrame(dt * 1000, dt);
    renderer.render(world, frozenAt >= 0 ? frozenAt : now, frozenAt >= 0 ? 0 : dt);

    // 터치 컨트롤은 «게임 중»에만. 메뉴 위에 조이스틱이 뜨면 오작동으로 보인다.
    if (mode === 'play') {
      const ctx = renderer.screenCtx();
      drawTouchControls(ctx, input.visual, t('boost'), p.mass > BOOST_MIN_MASS, FONT,
        input.mode === 'joystick');
    }

    if (mode === 'play' || mode === 'offer') {
      leaderRows.length = 0;
      const rank = world.ranking;
      for (let i = 0; i < Math.min(10, rank.length); i++) {
        const s = world.snakes[rank[i]];
        leaderRows.push({
          name: s.name,
          score: Math.floor(s.mass),
          color: s.style.colors[0],
          isPlayer: s.isPlayer,
        });
      }
      shell.updateHud(dt, Math.floor(p.mass), world.rankOf(p.id), leaderRows);
    }

    if (debug && !quiet) drawDebug(renderer, world, fps, mode);
  }

  /**
   * ★ 자동 검증용 훅. debug 모드에서만 노출한다.
   *   스크린샷만으로는 「조이스틱이 그려졌다」는 알 수 있어도
   *   「조종이 실제로 먹혔다」는 알 수 없다. 각도/부스트/모드를 읽을 수 있어야
   *   드래그 → 진행방향 변화를 «수치로» 검증할 수 있다.
   *   운영 빌드에는 붙지 않는다(?debug=1 없이는 undefined).
   */
  if (debug) {
    // ★ 단계별 렌더 비용(ms). 「fps 가 떨어졌다」까지는 perf.py 가 알려주지만
    //   «어느 층이» 비싸졌는지는 이 값이 없으면 추측이 된다(tools/perf_stage.py).
    (window as unknown as { __coilTimes?: unknown }).__coilTimes = () => ({
      ...renderer.times, sim: simMs, scale: renderer.renderScale,
      // ★ 개수는 별도 키(orbsN/snakesN). 예전엔 orbs/snakes 가 «시간»키를 덮어써 orbs 층 ms 를 못 읽었다.
      orbsN: renderer.lastOrbsDrawn, snakesN: renderer.lastSnakesDrawn,
      orbsTotal: world.orbs.n, snakesAlive: world.ranking.length, worldR: WORLD_R,
      bloom: renderer.bloomUsed, bloomSupported: renderer.bloomSupported,
      bloomQuality: renderer.post.quality, bloomAutoOff: renderer.post.autoOff,
      tier: renderer.gov.tier, xf: renderer.gov.xf, bloomMix: renderer.post.mix, promotions: renderer.gov.promotions,
      canvasW: renderer.world.width, canvasH: renderer.world.height, pendingStep,
      stageW: renderer.canvas.width, stageH: renderer.canvas.height,
      srcW: renderer.srcW, srcH: renderer.srcH, uploadPx: renderer.post.uploadPx,
      worldDpr: renderer.worldDpr, stageDpr: renderer.dpr,
      draws: { ...stats, total: totalDrawCalls() },
    });
    /**
     * ★ 스킨 «전체 시트»(플레이어 12종 + 봇 배색 12종)를 한 장으로 그려 dataURL 로 준다.
     *   게임과 «같은 렌더 코드»(makeSkinPreview → strokeTube/paintHead)라 시트가 곧 실물이다.
     *   전/후 비교 산출물 전용(tools/cap_lane12.py). 운영 빌드에는 붙지 않는다.
     */
    (window as unknown as { __coilSkinSheet?: unknown }).__coilSkinSheet = (cols = 6) => {
      const W = 300;
      const H = 120;
      const pad = 12;
      const labelH = 22;
      const all: { name: string; skin: Skin }[] = [];
      for (const sk of SKINS) all.push({ name: sk.labelKo, skin: sk });
      BOT_PALETTE.forEach((p2, i) => all.push({
        name: 'bot ' + (i + 1) + ' (' + p2.pattern + ')',
        skin: { id: 'bot' + i, label: '', labelKo: '', pattern: p2.pattern, colors: p2.colors,
          band: p2.band, glow: p2.glow, unlockScore: 0 },
      }));
      const rows = Math.ceil(all.length / cols);
      const c = document.createElement('canvas');
      c.width = cols * (W + pad) + pad;
      c.height = rows * (H + labelH + pad) + pad;
      const g = c.getContext('2d');
      if (!g) return '';
      g.fillStyle = '#0c1130';
      g.fillRect(0, 0, c.width, c.height);
      g.font = '600 14px ' + FONT;
      g.textBaseline = 'top';
      all.forEach((e, i) => {
        const x = pad + (i % cols) * (W + pad);
        const y = pad + Math.floor(i / cols) * (H + labelH + pad);
        g.fillStyle = '#141b45';
        g.fillRect(x, y, W, H);
        g.drawImage(makeSkinPreview(e.skin, W * 2, H * 2), x, y, W, H);
        g.fillStyle = '#dfe6ff';
        g.fillText(e.name, x + 2, y + H + 4);
      });
      return c.toDataURL('image/png');
    };
    (window as unknown as { __coil?: unknown }).__coil = {
      state() {
        const q = world.player;
        return {
          mode,
          x: q.x, y: q.y,
          angle: q.angle,
          targetAngle: q.targetAngle,
          mass: q.mass,
          alive: q.alive,
          boosting: q.boosting,
          ghost: q.ghostUntil > world.time,
          aim: input.aimAngle,
          headSX: input.headSX,
          headSY: input.headSY,
          usedTouch: input.usedTouch,
          inputBoost: input.boosting,
          control: input.mode,
          stick: input.visual.stickActive,
          boostBtn: { x: input.visual.boostX, y: input.visual.boostY, r: input.visual.boostR },
          renderScale: renderer.renderScale,
          bloom: renderer.bloomUsed,
          fps,
        };
      },
      /** 하네스 전용: 블룸 강제 on/off, 거버너 감시 해제(순수 비용 측정). */
      setBloom(on: boolean, watchdog = true) {
        renderer.post.setEnabled(on);
        renderer.gov.watch = watchdog;
        renderer.gov.resetWindow();
      },
      /** 하네스 전용: 품질 전환 로그(단계·해상도). 「5초 안 2회 이상 = 0」 검증용. */
      qlog() { return renderer.gov.log.slice(); },
      /** 하네스 전용(깜빡임 프로브): 이번 프레임 블룸 에너지(a1 FBO 휘도 합). readPixels — 운영 경로 0회. */
      bloomEnergy() { return renderer.post.energy(); },
      /** 하네스 전용: 단계 강제(크로스페이드 촬영). */
      setTier(t: 0 | 1 | 2 | 3) { renderer.gov.force(t, 'harness'); },
      setControl(m: 'joystick' | 'drag') {
        input.mode = m;
        save.control = m;
      },
      startRun,
      toMenu,
      /**
       * 결과 화면을 «찍기 위한» 강제 사망. 경계 밖으로 머리를 옮기면
       * 다음 스텝에서 정상 경로로 죽는다 - 사망 처리에 특별 분기를 만들지
       * 않으려고 이렇게 한다(테스트용 분기는 그 자체가 버그의 온상이다).
       */
      kill() {
        const q = world.player;
        q.x = 99999;
        q.y = 0;
        q.ghostUntil = 0;
      },
      grow(mass: number) {
        const q = world.player;
        q.mass = mass;
        q.updateDerived();
      },
      /**
       * ★ 촬영 전용 무적(tools/shots_joystick.py). ?debug=1 에서만 붙는다.
       *   조이스틱 «시각 상태 4종»을 찍으려면 손가락을 얹은 채 수백 ms 를 버텨야
       *   하는데, 그 사이 뱀이 봇에 부딪혀 죽으면 mode 가 'dead' 로 바뀌고
       *   drawTouchControls 가 통째로 안 돌아 «빈 화면»이 찍힌다(실측: BEFORE
       *   3_max 컷이 그렇게 나왔다 — 조이스틱도 질주 버튼도 없는 컷).
       *   ⛔ 게임 규칙을 바꾸는 것이 아니라 «기존 무적 시간»을 늘릴 뿐이다.
       */
      ghost(sec: number) {
        world.player.ghostUntil = world.time + sec;
      },
      /**
       * ★ 깜빡임 추적(tools/qa_titan_flicker.py). ?debug=1 전용.
       *   프레임마다 «실제로 그린» / «컬링된» 뱀 id 와, 그 판단의 입력이 된
       *   값들을 함께 준다. 검사기가 조건을 다시 계산하지 않게 하려는 것이다.
       */
      trackDrawn(on: boolean) { setTrackDrawn(on); },
      /** 진단 스냅샷 원본(tools/qa_resting_finger.py). ?debug=1 전용. */
      diag() { return JSON.parse(JSON.stringify(INPUT_DIAG)); },
      frame() {
        const cam = renderer.camera;
        const out: Record<string, unknown> = {
          drawn: drawnIds.slice(), culled: culledIds.slice(),
          bloom: renderer.bloomUsed, tier: renderer.gov.tier,
          /* ★ 순간이동 판정용 — 「뱀이 튄 것」과 「화면이 튄 것」을 가르려면
             카메라와 시각(t), 그리고 그 프레임의 dt 가 «같이» 있어야 한다.
             renderScale 은 해상도 변경 프레임을 지목하기 위한 것(가설③). */
          zoom: cam.zoom, camX: cam.x, camY: cam.y,
          t: world.time, dt: lastDt, rawDt: lastRawDt,
          clamped: lastRawDt > DT_MAX ? 1 : 0,
          scale: renderer.renderScale, fps,
        };
        const snakes: unknown[] = [];
        for (const s of world.snakes) {
          /* ⛔살아 있는 것만 담으면 «죽었다 리스폰» 과 «순간이동» 을 못 가른다.
             alive 를 «같이» 실어서 검사기가 구분하게 한다. */
          snakes.push({ id: s.id, alive: s.alive, mine: s.isPlayer,
            mass: Math.round(s.mass), x: +s.x.toFixed(2), y: +s.y.toFixed(2),
            ang: +s.angle.toFixed(4), boost: s.boosting,
            len: Math.round(s.bodyLen), pts: s.trail.count,
            /* 꼬리 끝점 — 머리는 매끈한데 «몸통만» 튀는 경우를 잡는다. */
            tx: +s.trail.x(s.trail.count - 1).toFixed(2),
            ty: +s.trail.y(s.trail.count - 1).toFixed(2) });
        }
        out.snakes = snakes;
        return out;
      },
      /**
       * ★ 조이스틱 «정확도» 계측 창(tools/qa_joystick_accuracy.py). ?debug=1 전용.
       *   input.visual 이 아니라 «마지막으로 그린» 기하를 준다 — 계산값과
       *   화면값이 어긋나는 고장은 계산값만 봐서는 영영 안 보인다.
       */
      stick() {
        return {
          bx: stickDrawn.bx, by: stickDrawn.by,
          kx: stickDrawn.kx, ky: stickDrawn.ky, act: stickDrawn.act,
          aim: input.aimAngle, angle: world.player.angle,
          target: world.player.targetAngle,
          homeX: input.visual.hintX, homeY: input.visual.hintY,
          origin: { x: input.visual.originX, y: input.visual.originY },
          knob: { x: input.visual.knobX, y: input.visual.knobY },
          active: input.visual.stickActive,
        };
      },
      /**
       * ★ 최악 시나리오 부하(tools/qa_frametime.py). 봇 n 마리를 «화면 안» 플레이어 주변에
       *   거대 질량으로 옮겨 놓고 계속 질주시킨다. 몸은 스폰 원호(spawn)로 눕혀 즉시
       *   «전체 길이»가 화면에 걸리게 한다. 운영 빌드에는 없다(?debug=1 전용).
       */
      stress(n: number, mass: number, boost: boolean, playerMass: number, layout: 'ring' | 'grid' = 'ring', ghost = true) {
        const q = world.player;
        if (playerMass > 0) { q.mass = playerMass; q.updateDerived(); }
        stressIds.length = 0;
        stressMass = mass;
        stressBoost = boost;
        let k = 0;
        const bodyLen = 150 + 46 * Math.pow(mass, 0.55);
        // grid: 화면(현재 줌) 안에 «겹치지 않게» 격자 배치 — «뱀 n 마리가 한 화면에» 스크린샷·측정용.
        const cols = Math.max(2, Math.round(Math.sqrt(n * renderer.cssW / Math.max(1, renderer.cssH))));
        const rows = Math.ceil(n / cols);
        const vw = renderer.cssW / renderer.camera.zoom;
        const vh = renderer.cssH / renderer.camera.zoom;
        for (const s of world.snakes) {
          if (s.isPlayer || k >= n) continue;
          if (layout === 'grid') {
            const cx = q.x - vw / 2 + vw * ((k % cols) + 0.5) / cols;
            const cy = q.y - vh / 2 + vh * (Math.floor(k / cols) + 0.5) / rows;
            const a = (k * 2.399) % (Math.PI * 2);
            s.spawn(cx, cy, a, mass, Math.max(60, Math.min(220, bodyLen / 6)), k % 2 ? 1 : -1);
          } else {
            const a = (k / n) * Math.PI * 2;
            const d = 140 + (k % 3) * 90;
            s.spawn(q.x + Math.cos(a) * d, q.y + Math.sin(a) * d, a + Math.PI / 2, mass,
              Math.max(220, bodyLen / 5), k % 2 ? 1 : -1);
          }
          s.ghostUntil = ghost ? world.time + 0.5 : 0;
          stressIds.push(s.id);
          k++;
        }
        return stressIds.length;
      },
      stopStress() { stressIds.length = 0; stressBoost = false; stressMass = 0; },
      /**
       * «제자리 사망» — 봇 하나를 내 머리 바로 앞에 가로로 눕혀 다음 스텝에 «정상 경로»로 충돌해 죽는다.
       * kill() 은 머리를 맵 밖으로 옮겨 카메라가 «바깥»을 보므로 사망 연출(폭발·흔들림)이 화면에 없다.
       * 연출 스크린샷 전용(debug). 사망 처리에 특별 분기는 없다.
       */
      crash() {
        const q = world.player;
        const victim = world.snakes.find((s) => !s.isPlayer && s.alive);
        if (!victim) return false;
        // 희생 봇의 «몸 한가운데»가 내 진행선 위에 오게 놓는다. 머리 근처(목덜미)는 충돌 표본에서
        // 빠지므로(snake.ts rebuildCollisionPoints) 머리를 정면에 두면 안 죽는다 — 실측으로 확인.
        const ahead = q.radius + 24;
        const half = (150 + 46 * Math.pow(300, 0.55)) / 2;
        const nx = -Math.sin(q.angle);
        const ny = Math.cos(q.angle);
        victim.spawn(q.x + Math.cos(q.angle) * ahead + nx * half, q.y + Math.sin(q.angle) * ahead + ny * half,
          q.angle + Math.PI / 2, 300, 0, 1);
        victim.ghostUntil = 0;
        q.ghostUntil = 0;
        return true;
      },
      /** 픽셀 대조용: 월드를 멈추고(pause) 렌더 시각을 고정한다. 오브 맥동·혀·깜빡임까지 멈춘다. */
      freeze(on: boolean) {
        // 일시정지 화면(DOM 전환 애니메이션)을 쓰지 않는다 - 그게 픽셀 대조를 흐린다.
        frozenAt = on ? performance.now() / 1000 : -1;
      },
      setCull(on: boolean) { setBodyCull(on); },
      /**
       * ★ 킬 피드에 «진짜 경로»로 한 줄을 밀어 넣는다(?debug=1 전용).
       *   왜 필요한가: 「기록 돌파 배너가 킬로그를 가리지 않는가」는 킬로그가 실제로
       *   떠 있어야만 잴 수 있는데, 봇 사이의 킬은 시드·시각에 달려 재현이 안 된다.
       *   검사기가 DOM 을 «직접 조립»하면 그건 실제 마크업이 아닐 수 있다 —
       *   그래서 shell.pushKill 을 그대로 부른다(운영과 «같은» 문장 조립·조사·클래스).
       * @param who 'bot' 봇끼리 · 'mine' 내가 잡았다 · 'lost' 내가 당했다
       */
      pushKill(killer: string, victim: string, who: 'bot' | 'mine' | 'lost' = 'bot') {
        shell.pushKill({
          killerName: killer,
          victimName: victim,
          killerIsPlayer: who === 'mine',
          victimIsPlayer: who === 'lost',
        });
      },
    };

    /**
     * ★ 광고 게이트 검증 훅 — ?debug=1 에서만 붙는다.
     *
     *   왜 필요한가: 「2판마다 광고」는 «스크린샷으로 증명할 수 없다».
     *   운영 광고 ID 를 로컬에서 렌더하는 것은 계정 중단 사유라(핸드북 §2-10)
     *   실제로 띄워 볼 수도 없다. 그래서 «브릿지 경계에 스텁을 꽂고»
     *   계수·빚·노출 로직은 운영과 «완전히 같은 코드»를 돌린 뒤 상태를 읽는다.
     *   검사기: tools/qa_ads.py
     *
     *   ★양성대조를 반드시 같이 돌려라 — 스텁이 안 꽂히면 adReady 가 영영 false 라
     *     「광고 0건」이 나오는데, 그건 «게이트가 정상»이어도 나오는 값이다.
     *     즉 0 을 「부재의 증거」로 쓰면 안 된다(핸드북 §3-1·§5-1).
     */
    (window as unknown as { __coilAds?: unknown }).__coilAds = {
      state: () => ads.adsDebugState(),
      reset: () => {
        ads.__resetAdsForTest();
        __resetAdSdkForTest();
      },
      /**
       * 브릿지 스텁을 꽂는다.
       * @param b.load  'ok'|'error'|'silent'  로드 콜백 동작
       * @param b.show  'dismissed'|'failedToShow'|'error'|'throw'|'silent'
       * @param b.supported isSupported() 반환값
       * @param b.async true 면 콜백을 setTimeout(0) 으로 «비동기» 발화(실물에 가깝다)
       */
      installStub(b: {
        load?: 'ok' | 'error' | 'silent';
        /*
         * ★ 뒤 네 개는 «리워드» 검증용으로 2026-08-31 에 늘렸다(tools/qa_reward.py).
         *   기존 값(dismissed/failedToShow/error/throw/silent)은 «그대로»다 —
         *   qa_ads.py 는 손대지 않아도 계속 통과한다.
         *     reward         show -> userEarnedReward -> dismissed   (정상 보상)
         *     lateReward     show -> dismissed -> (1.2s) USER_EARNED_REWARD
         *                    ⇒ 유예(3s) «안»에 도착 — 방어 ①. 대문자·언더스코어라 정규화 ②도 함께 검증.
         *     veryLateReward show -> dismissed -> (4.2s) {name:'user-earned-reward'}
         *                    ⇒ 유예 «밖» — 실패로 판정된 뒤 onLateReward 로 지급(방어 ④).
         *                    e.type 이 아니라 e.name 에 실어 «필드 폴백»(②)까지 같이 검증한다.
         *     rewardOnly     userEarnedReward «만» (show/impression 없음)
         *     inferBoundary  show -> (dismissAfterMs) dismissed. 보상 이벤트가 «끝내 안 온다».
         *                    ⇒ 추론 지급(⑤ INFER_MIN_SHOWN_MS) 경로를 «유일하게» 밟는 계획이다.
         *                      2026-08-31 문턱을 20s->12s 로 낮추면서 추가했다(tools/qa_reward.py R9).
         *                      ★shownMs 는 show 부터 «판정 시각»까지라 유예(3s)가 포함된다 —
         *                        즉 판정 시 shownMs = dismissAfterMs + 3000 이다.
         */
        show?: 'dismissed' | 'failedToShow' | 'error' | 'throw' | 'silent'
          | 'reward' | 'lateReward' | 'veryLateReward' | 'rewardOnly' | 'inferBoundary';
        /** 'inferBoundary' 에서 show -> dismissed 사이 간격(ms). */
        dismissAfterMs?: number;
        supported?: boolean;
        async?: boolean;
      }) {
        const calls = { load: 0, show: 0, ids: [] as string[] };
        const fire = (fn: () => void): void => {
          if (b.async === false) fn();
          else window.setTimeout(fn, 0);
        };
        const mk = (kind: 'load' | 'show') => {
          const f = (args: {
            onEvent: (e: { type: string }) => void;
            onError: (e: unknown) => void;
            options?: { adGroupId: string };
          }) => {
            calls[kind]++;
            if (args.options) calls.ids.push(args.options.adGroupId);
            const beh = kind === 'load' ? (b.load ?? 'ok') : (b.show ?? 'dismissed');
            if (beh === 'throw') throw new Error('stub throw');
            if (beh === 'error') fire(() => args.onError(new Error('stub error')));
            else if (beh === 'ok') fire(() => args.onEvent({ type: 'loaded' }));
            else if (beh === 'dismissed')
              fire(() => {
                args.onEvent({ type: 'show' });
                args.onEvent({ type: 'dismissed' });
              });
            else if (beh === 'failedToShow') fire(() => args.onEvent({ type: 'failedToShow' }));
            else if (beh === 'reward')
              fire(() => {
                args.onEvent({ type: 'show' });
                args.onEvent({ type: 'userEarnedReward' });
                args.onEvent({ type: 'dismissed' });
              });
            else if (beh === 'rewardOnly') fire(() => args.onEvent({ type: 'userEarnedReward' }));
            else if (beh === 'inferBoundary') {
              // ⛔보상 이벤트를 «한 번도» 안 보낸다 — 표시시간만으로 판정하는 경로를 재현한다.
              const at = typeof b.dismissAfterMs === 'number' ? b.dismissAfterMs : 0;
              fire(() => {
                args.onEvent({ type: 'show' });
                window.setTimeout(() => args.onEvent({ type: 'dismissed' }), at);
              });
            }
            else if (beh === 'lateReward' || beh === 'veryLateReward') {
              const delayMs = beh === 'lateReward' ? 1200 : 4200;
              const late = beh === 'lateReward'
                ? { type: 'USER_EARNED_REWARD' }
                : ({ name: 'user-earned-reward' } as unknown as { type: string });
              fire(() => {
                args.onEvent({ type: 'show' });
                args.onEvent({ type: 'dismissed' });
                window.setTimeout(() => args.onEvent(late), delayMs);
              });
            }
            // 'silent' 는 아무 콜백도 안 부른다 — 타임아웃 경로 검증용
            return () => undefined;
          };
          f.isSupported = () => b.supported !== false;
          return f;
        };
        __injectAdSdkForTest({
          loadFullScreenAd: mk('load') as never,
          showFullScreenAd: mk('show') as never,
          Storage: null,
        });
        (window as unknown as { __coilAdCalls?: unknown }).__coilAdCalls = calls;
        return calls;
      },
      removeStub() {
        __injectAdSdkForTest(null);
      },
      /** 준비된 전면형 광고를 «묵게» 만든다(READY_TTL 만료 경로 재현, 2026-09-10). */
      ageReady: (ms: number) => ads.__ageReadyForTest(ms),
      /** 정책 가드의 시계를 앞으로 민다(세션 60초·10분 간격 경로 재현). */
      advanceGuard: (ms: number) => ads.__advanceGuardClockForTest(ms),
      /** 지금 가드 판정(진단). */
      guard: () => ads.adGuards(),
      /** 복귀 훅을 직접 부른다(visibilitychange 를 흉내 내지 않고 경로만 검증). */
      foreground: () => ads.onForeground(),
    };

    /**
     * ★ 리워드 광고 검증 훅 — ?debug=1 에서만 붙는다. 검사기: tools/qa_reward.py
     *
     *   광고 «지면 ID 는 운영 것»이라 로컬에서 실제로 띄울 수 없다(계정 중단 사유,
     *   광고 핸드북 §2-10). 그래서 __coilAds.installStub 으로 브릿지 경계에만
     *   스텁을 꽂고, 이벤트 순서·유예·늦은 보상·상한·판당 1회 로직은 «운영과
     *   완전히 같은 코드»를 돌린 뒤 여기서 상태를 읽는다.
     *
     *   ★양성대조를 반드시 같이 본다 — 스텁이 안 꽂히면 usable=false 라
     *     「부활 0회」가 나오는데, 그건 «로직이 정상»이어도 나오는 값이다.
     */
    (window as unknown as { __coilReward?: unknown }).__coilReward = {
      state: () => ({
        mode,
        usable: rewardAdsUsable(),
        canRevive: canOfferRevive(),
        canBoost: canOfferStartBoost(),
        reviveUsedThisRun,
        startBoostArmed,
        used: {
          revive: usedToday('revive'),
          startBoost: usedToday('startBoost'),
          skinUnlock: usedToday('skinUnlock'),
          growth: usedToday('growth'),
          resultDouble: usedToday('resultDouble'),
        },
        /* ── 결과 화면 「이번 판 성장 2배」 + 이어받기(2026-09-10) ─────────────── */
        canDouble: canOfferResultDouble(),
        /** 지금 대기 중인 이어받기(다음 판이 소비할 값). */
        carry: pendingCarry(),
        /** 상수를 «코드에서» 읽어 간다 — 검사기가 0.1·50·2 를 박지 않게. */
        carryConst: { k: CARRY_K, cap: CARRY_CAP, doubleK: CARRY_DOUBLE_K, dailyCap: DAILY_CAP.resultDouble },
        lastRunGrowth,
        lastCarry,
        doubleUsedSession: resultDoubleUsedThisSession,
        doubleEarnedRun: carryDoubleEarned,
        /** 이 결과 화면에서 리워드가 표시됐는가(= 전면형 게이트를 건너뛸 것인가). */
        rewardShownOnResult,
        /* ── 기록 돌파(2026-08-31) ──────────────────────────────────────── */
        canGrow: canOfferGrowth(),
        /** 지금 떠 있는 제안. 없으면 null. */
        offer: pendingOffer
          ? { kind: pendingOffer.kind, value: pendingOffer.value, score: pendingOffer.score }
          : null,
        /** 복귀 카운트다운이 도는 중인가. */
        counting: resumeLeft > 0,
        /** 카운트다운 남은 초. ★벽시계가 아니라 «렌더된 프레임»으로 깎인다는 증거값. */
        countLeft: resumeLeft,
        /** 지금 판이 «몇 초째» 흘렀다고 기록될 것인가(멈춘 시간이 빠진 값). */
        runSeconds: (performance.now() - runStartedAt) / 1000,
        /** 문턱별 소비 여부·최고기록 소비 여부·이번 판 제안 횟수. */
        growth: growth.debugState(),
        growthCooling: growth.coolingDown(world.time),
        growthGranted: growthGrantedThisRun,
        /** 배너가 사라지기까지 남은 초(0 = 배너 없음). */
        offerLeft: bannerLeft,
        /** 보상 기준 질량 스냅샷(0 = 없음). */
        growthBase: growthBaseMass,
        /** 늦은 보상 창(ms) — 검사기가 「언제 폐기되는가」를 코드에서 읽어 간다. */
        lateWindowMs: LATE_REWARD_WINDOW_MS,
        /** 맵 반지름. ★검사기가 3536 같은 값을 «박지 않게» 코드에서 읽어 간다
         *  (맵 배율이 바뀌면 박아 둔 검사기는 옛 값으로 통과/실패한다 — 실제로
         *   R7-a 가 MAP_SCALE 3.0 에서 그렇게 틀렸다). */
        worldR: WORLD_R,
        bestAtRunStart: growthBestAtRunStart,
        /** 마지막 성장의 전/후(질량·점수·반지름). */
        lastGrowth,
        adSkins: adUnlockedSkins().slice(),
        /**
         * 광고 해금 «자격» 화이트리스트(game/skins.ts). ★검사기가 목록을 손으로
         *   베끼지 않게 «번들에서 읽어 간다» — 베낀 미러는 소스가 바뀌어도 안 죽는
         *   「죽은 검사기」가 된다(qa_growth_dist 에서 실제로 그랬다).
         */
        adUnlockable: AD_UNLOCKABLE_SKIN_IDS.slice(),
        /** 전 스킨의 id·해금 점수. 「어느 것이 잘려야 하는가」를 검사기가 «유도»한다. */
        allSkins: SKINS.map((s) => ({ id: s.id, unlockScore: s.unlockScore })),
        skinCap: DAILY_CAP.skinUnlock,
        player: {
          alive: world.player.alive,
          mass: world.player.mass,
          x: world.player.x,
          y: world.player.y,
          ghost: world.player.ghostUntil > world.time,
          /**
           * ★ 성장이 무적을 «건드리지 않았음»을 증명하는 값.
           *   ghost(불리언)만으로는 판 시작 무적(SPAWN_GHOST_PLAYER 3초)과 구분이 안 된다 -
           *   그 3초 안에 재면 「성장이 무적을 줬다」로 잘못 읽힌다(실제로 검사기가 그렇게 틀렸다).
           */
          ghostUntil: world.player.ghostUntil,
        },
        save: {
          games: save.games, bestScore: save.bestScore,
          totalKills: save.totalKills, playSeconds: save.playSeconds,
        },
        orbs: world.orbs.n,
        /**
         * 월드 시계. ★「제안 중에 월드가 멈췄는가」를 «증명»하는 값이다.
         *   좌표만 보면 「마침 직진 중이라 안 움직인 것처럼 보인」 경우와 구분이 안 된다.
         *   world.time 은 step 이 돌 때만 증가하므로 한 틱도 안 갔다는 «직접» 증거다.
         */
        worldTime: world.time,
        /** 판이 시작된 «그 순간»의 질량(프레임이 돌기 전). 부스트 검증의 기준값. */
        spawnMass: lastSpawnMass,
        /** 마지막 부활의 전/후 질량과 회수한 오브 수. */
        revive: lastRevive,
        /**
         * 지금 필드에 떠 있는 «내 색» 오브 수.
         * ★ orbs.n 전체로는 회수를 «측정할 수 없다» — replenishFood 가 매 스텝
         *   FOOD_TARGET(6000)까지 즉시 다시 채워 총합이 늘 6000 이다(실측).
         *   내 색만 세야 「내가 흘린 것이 사라졌는가」가 보인다.
         */
        myOrbs: (() => {
          const ci = world.orbs.colorIndex(world.player.style.colors[0]);
          let k = 0;
          for (let i = 0; i < world.orbs.n; i++) if (world.orbs.cs[i] === ci) k++;
          return k;
        })(),
      }),
      /** 원장·판내 상태를 «완전히» 비운다. 시나리오 사이를 갈라놓는 데 쓴다. */
      reset() {
        __resetRewardStoreForTest();
        reviveUsedThisRun = false;
        startBoostArmed = false;
        runRecordSnapshot = null;
        growth.reset();
        growthGrantedThisRun = 0;
        lastGrowth = null;
        cancelGrowthOffer();
        // 이어받기·2배(2026-09-10)도 «완전히» 비운다 — 앞 시나리오의 사망이 남긴 몫이 다음 시작 질량을 바꾼다.
        __resetCarryForTest();
        carryDoubleEarned = false;
        resultDoubleUsedThisSession = false;
        rewardShownOnResult = false;
        lastRunGrowth = 0;
        lastCarry = null;
        refreshRewardUi();
      },
      /** 결과 화면의 「광고 보고 이번 판 성장 2배」를 누른 것과 «같다». */
      doubleAd: () => onResultDoubleAd(),
      /** 세션 1회 상한만 푼다(다른 규칙은 그대로) — 그 아래 규칙(일 3회·기본 몫)이 살아 있는지 보기 위한 것. */
      clearDoubleSession() {
        resultDoubleUsedThisSession = false;
        refreshRewardUi();
      },
      /** 스텁을 꽂은 «뒤» 부른다 — 가용성이 바뀌었으니 버튼을 다시 그린다. */
      refresh: () => refreshRewardUi(),
      revive: () => onReviveAd(),
      boost: () => onStartBoostAd(),
      progress: () => onSkinProgressAd(),
      unlockSkin: (id: string) => onSkinAdUnlock(id),
      canAdUnlockSkin: (id: string) => canAdUnlockSkin(id),
      /** 광고 1회마다의 이벤트 시퀀스(실기기 진단용과 같은 값). */
      seq: () => adSeqLog().slice(),
      /** 부스트 질량은 config.ts 에서 «역산»된다 — 검사기가 상수를 박지 않게. */
      boostMass: () => boostedStartMass(),
      /** 광고 없이 부스트 권리만 세운다(부스트 «적용»만 따로 검증할 때). */
      arm() {
        startBoostArmed = true;
        refreshRewardUi();
      },
      /**
       * 검사기 전용 사망 유도 ①: «경계» 사망.
       *
       * ★ __coil.kill() 은 머리를 x=99999 로 던진다 - 죽기는 하지만 그건
       *   「경계 밖 96,000 유닛」이라 실제로는 일어나지 않는 좌표다. 부활이
       *   경계를 어떻게 다루는지 검증하려면 «현실적인» 경계 사망이 필요하다.
       *   그래서 경계 바로 안쪽에 몸을 «제대로 눕히고»(spawn 이 trail 을 깐다)
       *   바깥을 향하게 둔다 - 1초 뒤 정상 경로로 경계 사망한다.
       */
      killByBorder() {
        const q = world.player;
        const a = Math.atan2(q.y, q.x) || 0;
        const r = WORLD_R * 0.94;
        q.spawn(Math.cos(a) * r, Math.sin(a) * r, a, q.mass, 0, 1);
        q.ghostUntil = 0;
      },
      /**
       * 검사기 전용 사망 유도 ②: «남의 몸» 사망.
       * 살아 있는 봇의 몸통 위로 머리를 옮긴다 - 다음 스텝에서 cause='body' 로 죽는다.
       * @returns 옮길 봇을 찾았는가.
       */
      killByBody() {
        const q = world.player;
        for (const sn of world.snakes) {
          if (sn.isPlayer || !sn.alive || sn.ghostUntil > world.time || sn.trail.count < 10) continue;
          const i = Math.min(sn.trail.count - 1, 6);
          q.spawn(sn.trail.x(i), sn.trail.y(i), sn.angle + Math.PI, q.mass, 0, 1);
          q.ghostUntil = 0;
          return true;
        }
        return false;
      },
      /** 검사기 전용: 조종 각도를 직접 준다(부활 뒤 «피해서 살아남는가»를 재현). */
      steer(angle: number) {
        world.player.targetAngle = angle;
      },

      /* ── 기록 돌파 리워드(2026-08-31) — 검사기: tools/qa_reward.py R10~R14 ── */
      /**
       * 상수를 «코드에서» 읽어 간다. ★검사기가 2000·1.2·2 를 직접 박으면
       *   상수를 바꿔도 옛 값을 통과시키는 죽은 검사기가 된다
       *   (auto-memory 「테스트가 틀린 값을 고정한다」의 실사고 형태).
       */
      growthConst: () => ({
        thresholds: GROWTH_THRESHOLDS.slice(),
        maxPerRun: GROWTH_MAX_PER_RUN,
        bestMin: GROWTH_BEST_MIN,
        offerS: GROWTH_OFFER_S,
        k: GROWTH_MASS_K,
        countdownS: RESUME_COUNTDOWN_S,
        dailyCap: DAILY_CAP.growth,
        minGapS: GROWTH_MIN_GAP_S,
      }),
      /** 제안 판의 「광고 보고 키우기」를 누른 것과 «같다». */
      growAd: () => onGrowthAd(),
      /** 배너를 «지금» 닫는다(5초를 기다리지 않고 자동소멸과 같은 결과를 만든다). */
      growSkip: () => dismissGrowthBanner(),
      /**
       * 검사기 전용: 개인 최고 기록을 세운다.
       * ★ 저장본과 «판 시작 스냅샷»을 둘 다 세운다. 스냅샷만 세우면 다음 판에서
       *   덮이고, 저장본만 세우면 이번 판에는 안 먹는다.
       */
      setBest(v: number) {
        save.bestScore = v;
        growthBestAtRunStart = v;
        writeSave(save);
        refreshRewardUi();
      },
      /**
       * 검사기 전용: 카운트다운을 «지금» 끝낸다.
       * ★ 실제 3초를 기다리게 하면 검사 한 건마다 3초가 붙는다(R10~R14 에서 30초+).
       *   ⛔이 훅은 카운트다운 «길이»를 검증하지 않는다 — 그건 R12 가 실시간으로 잰다.
       */
      /** 검사기 전용: 쿨다운만 푼다(다른 규칙은 그대로). */
      clearCooldown() {
        growth.__clearCooldownForTest();
      },
      finishCountdown() {
        if (mode === 'offer' && resumeLeft > 0) resumeLeft = 1e-6;
      },
    };

    /* ── 프로모션 검사기 훅(tools/verify_promo_mamba.py) — ?debug=1 전용 ──────
     * ★값을 «코드에서» 읽어 간다. 검사기가 'mamba'·12000·500 을 직접 박으면
     *   상수를 바꿔도 옛 값을 통과시키는 죽은 검사기가 된다(auto-memory
     *   「테스트가 틀린 값을 고정한다」). 운영 로직은 이 객체를 읽지 않는다. */
    (window as unknown as { __coilPromo?: unknown }).__coilPromo = {
      skinId: () => PROMO_SKIN_ID,
      unlockScore: () => SKINS.find((s) => s.id === PROMO_SKIN_ID)?.unlockScore ?? -1,
      owns: () => ownsPromoSkin(),
      record: () => mambaRecordSnapshot(),
      eligible: () => mambaMissionEligible(),
      /* ③⑤ 2026-09-02 추가분. ★코드·금액을 «번들에서» 읽어 간다 — 검사기가
         '01M1GC…'·300 을 손으로 베끼면 코드가 바뀌어도 통과하는 죽은 검사기가 된다. */
      skinPromos: () => skinPromoSnapshot(),
    };

    /* ★ 시작 화면 배너 검증 훅(__coilBanner)은 2026-09-10 에 배너와 함께 «제거»했다.
     *   tools/qa_lane_a.py B절이 「훅·컨테이너·지면 ID 가 없다」를 검사한다(부재 검사). */

    /* ★ 토스 푸시 동의 검증 훅 (2026-09-10 레인 A) — 검사기: tools/qa_lane_a.py P절
     *
     *   동의창은 네이티브 UI 라 로컬에서 띄울 수 없다. 두 층으로 본다:
     *     ① 가짜 네이티브 브릿지(하네스가 ReactNativeWebView.postMessage 를 감청) — «진짜 SDK 코드»가
     *        addEventListener 를 postMessage 로 보내는지, templateCode 가 «글자 그대로» 실리는지.
     *     ② installStub — 브릿지 경계에 스텁을 꽂아 newAgreement/alreadyAgreed/agreementRejected/
     *        onError/throw/silent 6경로에서 상태·저장·정리(cleanup 호출)를 결정적으로 본다.
     *   ★값(templateCode·저장 키)은 «코드에서» 읽어 간다 — 검사기가 문자열을 박지 않게.
     */
    (window as unknown as { __coilPush?: unknown }).__coilPush = {
      state: () => getPushState(),
      templateCode: () => PUSH_TEMPLATE_CODE,
      key: () => PUSH_KEY,
      enable: () => enablePush(),
      dismiss: () => dismissPushNudge(),
      hydrate: () => hydratePushState(),
      reset: () => {
        __resetPushForTest();
        __resetPushSdkForTest();
        shell.refreshPush(getPushState());
      },
      /**
       * 브릿지 경계 스텁. behavior 가 이벤트면 delayMs 뒤 onEvent, 'error' 면 onError, 'throw' 면 동기 throw,
       * 'silent' 면 아무 콜백도 없다(busy 가 «영원히» 참인 상태의 화면 — 타임아웃을 두지 않는 설계의 관찰용).
       */
      installStub: (
        behavior: NotificationAgreementResult | 'error' | 'throw' | 'silent',
        delayMs = 0,
      ) => {
        const calls = { requests: 0, codes: [] as string[], cleanups: 0 };
        __injectPushSdkForTest({
          requestNotificationAgreement: (p) => {
            calls.requests++;
            calls.codes.push(p.options.templateCode);
            if (behavior === 'throw') throw new Error('stub throw');
            /* ★delayMs < 0 = «반환 전에 동기로» 콜백을 부른다(Codex 지적 8 의 경로 재현).
               그 경우 호출부는 cleanup 을 아직 손에 쥐지 못한 상태로 판정을 끝낸다. */
            if (delayMs < 0) {
              if (behavior === 'error') void p.onError(new Error('UNSUPPORTED_APP_VERSION'));
              else if (behavior !== 'silent') p.onEvent({ type: behavior });
            } else {
              window.setTimeout(() => {
                if (behavior === 'error') void p.onError(new Error('UNSUPPORTED_APP_VERSION'));
                else if (behavior !== 'silent') p.onEvent({ type: behavior });
              }, delayMs);
            }
            return () => {
              calls.cleanups++;
            };
          },
          Storage: null,
        });
        (window as unknown as { __coilPushCalls?: unknown }).__coilPushCalls = calls;
        return calls;
      },
      removeStub: () => __injectPushSdkForTest(null),
    };

    /* ★ 「머니 리그」 교차추천 검증 훅 (2026-09-10 레인 A) — 검사기: tools/qa_lane_a.py X절
     *   openURL 은 앱을 «떠나는» 브릿지라 로컬에서 실제로 부를 수 없다 → installOpenStub 으로 호출 인자만 본다.
     *   실기기에서 실제로 머니 리그가 열리는지는 [미확인] — Partner 테스트 푸시 몫. */
    (window as unknown as { __coilXpromo?: unknown }).__coilXpromo = {
      state: () => crossPromoSnapshot(),
      canShow: () => canShowCrossPromo(),
      shown: () => shell.xpromoShown,
      url: () => MONEY_LEAGUE_URL,
      open: () => openCrossPromo(),
      reset: () => {
        __resetCrossPromoForTest();
        __resetOpenUrlForTest();
      },
      /**
       * openURL 브릿지 경계 스텁.
       * @param mode 'ok' resolve · 'fail' reject(= 실패 문구) · 'silent' 응답 없음(4초 뒤 'unknown' — 문구 «안» 바뀐다)
       */
      installOpenStub: (mode: 'ok' | 'fail' | 'silent' = 'ok') => {
        const calls: string[] = [];
        __injectOpenUrlForTest((url: string) => {
          calls.push(url);
          if (mode === 'fail') return Promise.reject(new Error('stub reject'));
          if (mode === 'silent') return new Promise<never>(() => undefined); // 영원히 pending
          return Promise.resolve(null);
        });
        (window as unknown as { __coilOpenCalls?: unknown }).__coilOpenCalls = calls;
        return calls;
      },
      /** 카드가 지금 실패 문구를 보이는가(검사기용). */
      failed: () => shell.xpromoFailedShown,
      /** 무응답 누적 수(리스너 누수 상한 검사용). */
      unknowns: () => openUrlUnknownCount(),
      removeOpenStub: () => __injectOpenUrlForTest(null),
    };

    /* ★ 고급 스킨 검증 훅 (2026-09-02 ④) — 검사기: tools/qa_skins.py
     *
     *   ★값을 «코드에서» 읽어 간다. 검사기가 'bluecoral'·100·13.0 을 직접 박으면
     *     상수를 바꿔도 옛 값을 통과시키는 죽은 검사기가 된다(auto-memory
     *     「테스트가 틀린 값을 고정한다」). 운영 로직은 이 객체를 읽지 않는다.
     */
    (window as unknown as { __coilSkins?: unknown }).__coilSkins = {
      state: () => ({
        equipped: save.skin,
        ability: abilityOf(save.skin),
        abilityState: abilities.state(),
        adWatch: { total: adWatchTotal(), bySurface: adWatchBySurface() },
        canOfferProgress: canOfferSkinProgress(),
        progressCap: DAILY_CAP.skinProgress,
        usedProgress: usedToday('skinProgress'),
        /** 전 스킨의 요건 — 검사기가 「무엇이 잠겨야 하는가」를 «유도»한다. */
        skins: SKINS.map((s) => ({
          id: s.id,
          unlockScore: isFinite(s.unlockScore) ? s.unlockScore : null,
          unlockAds: s.unlockAds ?? null,
          ability: abilityOf(s.id),
          /* * 「문구와 구현이 어긋나면 허위 표시다」의 검사 근거(2026-09-02 2).
             검사기는 1.28/2.6 을 <<박지 않고>> 여기서 받아 화면 문구와 대조한다.
             상수를 고치면 기대값과 화면이 <<같이>> 움직인다 = 죽은 검사기가 안 된다. */
          abilityFacts: abilityFactsOf(s.id),
          owned: isSkinUnlocked(s, save.bestScore) || isSkinAdUnlocked(s.id)
            || meetsSkinRequirement(s, save.bestScore),
        })),
      }),
      /** 누적 시청 횟수를 세운다(광고를 100번 보지 않고 해금 화면을 보기 위해). */
      setAdWatch: (n: number) => {
        __setAdWatchForTest(n);
        refreshRewardUi();
      },
      /** 능력 1틱을 «지금» 돌리고 흡수한 오브 수를 돌려준다. */
      tickAbility: () => abilities.tick(world, save.skin),
      killCredit: () => abilities.onPlayerKill(world),
    };

    /* ★ 해금 원장 검증 훅 (2026-09-03 ①) — 검사기: tools/qa_unlock_ledger.py
     *
     *   ★기대값을 검사기에 «박지 않는다». 옛 문턱(LEGACY_UNLOCK_SCORE)·새 문턱
     *     (SKINS[].unlockScore)·원장 내용·주입 여부를 전부 «여기서 읽어» 대조한다.
     *     그래야 문턱을 또 바꿔도 검사가 같이 움직인다(죽은 검사기 방지).
     *   ★운영 로직은 이 객체를 읽지 않는다. ?debug=1 에서만 만들어진다.
     */
    (window as unknown as { __coilUnlock?: unknown }).__coilUnlock = {
      state: () => ({
        bound: isUnlockLedgerBound(),
        bestScore: save.bestScore,
        adWatch: adWatchTotal(),
        ledger: unlockLedgerSnapshot(),
        legacyScore: LEGACY_UNLOCK_SCORE,
        legacyAds: LEGACY_UNLOCK_ADS,
        skins: SKINS.map((s) => ({
          id: s.id,
          unlockScore: isFinite(s.unlockScore) ? s.unlockScore : null,
          unlockAds: s.unlockAds ?? null,
          legacyScore: LEGACY_UNLOCK_SCORE[s.id] ?? null,
          ledgered: isScoreLedgered(s.id),
          // 「지금 이 스킨을 보유하는가」 = 화면이 쓰는 것과 «같은 식».
          owned: isSkinUnlocked(s, save.bestScore) || isSkinAdUnlocked(s.id)
            || meetsSkinRequirement(s, save.bestScore),
        })),
        /** ③ 봇 최고급 착용 — 검사기가 마릿수를 «유도»한다. */
        bots: {
          count: BOT_COUNT,
          paletteLen: BOT_PALETTE.length,
          poolSize: BOT_PALETTE_POOL,
          premiumSlots: BOT_PREMIUM_SLOTS,
          premiumSkinIds: BOT_PREMIUM_SKIN_IDS,
          premiumWearing: botPremiumCount(BOT_COUNT),
        },
      }),
      /** 원장을 비운다(신규 유저 재현). 씨 뿌리기 «전» 상태가 된다. */
      reset: () => { __resetUnlockLedgerForTest(); },
      /** 원장을 직접 주입한다(옛 유저 재현). */
      set: (scoreIds: string[], adIds: string[] = [], seeded = true) =>
        __setUnlockLedgerForTest(scoreIds, adIds, seeded),
      /** 씨 뿌리기를 «지금» 돌린다(부팅 순서를 재현하지 않고 검사하기 위한 것). */
      seed: (best: number, ads: number) => seedUnlockLedger(best, ads),
    };
  }

  /*
   * 리워드 SDK 를 미리 당긴다.
   * ★ 토스 밖이면 adSdk.ensureAdSdk() 가 «청크를 요청조차 안 한다» — 메인 번들의
   *   네트워크 참조 0건이라는 MS Store 신고서가 그대로 유지된다(adSdk.ts ①).
   * ★ await 하지 않는다. 광고 준비를 기다리며 게임 시작을 늦추지 않는다.
   */
  if (rewardsEnabled && !demo) {
    void warmUpRewardAds().then((ok) => {
      if (ok) refreshRewardUi();
    });
  }

  /* 푸시 동의 상태 → 셸(2026-09-10 레인 A). 토스 밖이면 refreshPush 가 행·카드를 «안 붙인다».
     구독이 저장 기록을 읽어 오고(hydrate), 읽힌 뒤에야 nudge 가 서므로 「닫았던 카드가 잠깐 뜨는」 깜빡임이 없다.
     ★ await 하지 않는다 — 첫 프레임을 늦추지 않는다. */
  subscribePush(() => shell.refreshPush(getPushState()));
  shell.refreshPush(getPushState());

  requestAnimationFrame(frame);

  if (demo) {
    // 메뉴를 건너뛰고 바로 판을 시작한다(촬영용).
    startRun();
  } else {
    // 데스크톱이면 닉 입력에 포커스를 준다(바로 타이핑 → 엔터로 시작).
    window.setTimeout(() => shell.focusNick(), 60);
  }

  // 운영 빌드는 콘솔을 더럽히지 않는다(스토어 심사에서 콘솔을 열어 본다).
  if (debug) {
    console.info(
      '[' + BRAND_EN + ' / ' + BRAND_KO + '] booted. locale=' + getLocale() + ' save=' + status,
    );
  }
  void lastDeath;
}

/** ?debug=1 진단 오버레이. 「빠르다」가 아니라 «숫자»로 말하기 위한 것. */
function drawDebug(r: Renderer, w: World, fps: number, mode: Mode): void {
  const ctx = r.screenCtx();
  const lines = [
    'fps ' + fps.toFixed(1),
    'mode ' + mode,
    'orbs ' + w.orbs.n + ' drawn ' + r.lastOrbsDrawn,
    'snakes ' + w.ranking.length + ' drawn ' + r.lastSnakesDrawn,
    'zoom ' + r.camera.zoom.toFixed(3) + ' dpr ' + r.dpr.toFixed(2) + ' scale ' + r.renderScale,
    'mass ' + w.player.mass.toFixed(1) + ' r ' + w.player.radius.toFixed(1),
    'trail ' + w.player.trail.count,
    '--- render ms ---',
    'bg   ' + r.times.bg.toFixed(2) + '  orbs ' + r.times.orbs.toFixed(2),
    'body ' + r.times.bodies.toFixed(2) + '  head ' + r.times.heads.toFixed(2),
    'lbl  ' + r.times.labels.toFixed(2) + '  vig  ' + r.times.vignette.toFixed(2),
    'mini ' + r.times.mini.toFixed(2) + '  post ' + r.times.post.toFixed(2) + '  TOTAL ' + r.times.total.toFixed(2),
    'bloom ' + (r.bloomUsed ? 'on q' + r.post.quality : r.bloomSupported ? 'off' : 'n/a') +
      '  T' + r.gov.tier + ' mix ' + r.post.mix.toFixed(2) + ' promo ' + r.gov.promotions,
  ];
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(6, r.cssH - 6 - lines.length * 14 - 8, 190, lines.length * 14 + 8);
  ctx.fillStyle = '#9fe870';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], 12, r.cssH - 6 - lines.length * 14 + i * 14);
  }
}

// ★ 부팅 실패를 «조용히» 삼키지 않는다. 흰 화면만 뜨면 원인을 못 찾는다.
try {
  boot();
} catch (e) {
  console.error('[king-snake] boot failed', e);
  const d = document.createElement('div');
  d.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'padding:24px;color:#ff8f9c;background:#05060e;font:600 14px system-ui;text-align:center;z-index:99';
  d.textContent = 'Failed to start: ' + (e instanceof Error ? e.message : String(e));
  document.body.appendChild(d);
}
