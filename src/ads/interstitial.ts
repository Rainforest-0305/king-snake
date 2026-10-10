// interstitial.ts — 전면광고 게이트. 「2판 연속 플레이하면 전면광고」(President 지시).
//
// ══════════════════════════════════════════════════════════════════════════
// ★ 「판」의 «정의» — 이 파일의 전부다. 여기가 흔들리면 나머지는 의미가 없다
// ══════════════════════════════════════════════════════════════════════════
//
//   「판」 = main.ts 의 startRun() 이 «새 World 를 만들어» 시작한 플레이 1회가
//           «끝난» 것. 시작이 아니라 «종료»를 센다.
//
//   ★ 왜 종료를 세는가: 시작을 세면 「시작만 하고 안 논 판」이 세어진다.
//     반대로 종료를 세면 「논 판」만 세어진다. 광고는 «논 대가»에 붙는 것이다.
//
//   ── 종료 경로 «전부» (main.ts 상태기계 실측, 2026-08-25) ─────────────────
//     ① 사망            world 가 onPlayerDeath 훅 발화 → main.onPlayerDied()
//                       → endRun('death').  ★사망 화면을 «보든 말든» 여기서 세어진다.
//     ② 일시정지 → 그만두기   shell quitBtn → cb.onQuit() → endRun('abandon') → toMenu()
//     ③ 결과 화면 → 메뉴      shell menuBtn → cb.onQuit() → «이미 ①에서 닫혔다» → no-op
//     ④ 결과 화면 → 다시하기  shell againBtn → cb.onPlay() → «이미 ①에서 닫혔다» → no-op
//     ⑤ 안전망            startRun() 진입부에서 endRun('abandon').
//                       위 넷을 «안 거치고» 새 판이 시작되는 모든 경로를 여기서 잡는다
//                       (?debug=1 의 __coil.startRun(), 미래에 추가될 「일시정지→다시하기」 등).
//
//   ★★ 그래서 「결과 화면을 안 거치고 나가는 경로에서도 똑같이 세어지는가」의 답은
//      «구조적으로 예»다. 계수는 «결과 화면»이 아니라 «상태 전이»에 걸려 있고,
//      결과 화면은 onPlayerDied() 보다 700ms «뒤에» 뜨는 «연출»일 뿐이다(main.ts:220).
//      네온 스레드 v1 이 정확히 여기서 실패했다 — 결과 화면 «버튼 click» 안에서만
//      셌더니 그 버튼을 안 누르는 경로가 전부 0판이 됐다. 우리는 main.ts 를
//      «소유»하므로 DOM 을 관측할 필요 없이 상태기계에 직접 건다.
//
//   ── 멱등성 ────────────────────────────────────────────────────────────
//     runOpen 플래그 하나로 보장한다. beginRun() 이 true, endRun() 이 false.
//     endRun() 은 runOpen 이 false 면 «즉시 return». 몇 번을 불러도 한 판은 한 번.
//     ★ plays 를 증가시키는 코드는 endRun() 안의 «단 한 줄»이다(grep 로 증명 가능).
//
//   ── «세지 않는» 경우 (의도적) ──────────────────────────────────────────
//     · 앱을 그냥 죽인 판(홈 버튼·강제종료) → 못 센다. 과소 계수다.
//     · 일시정지→그만두기인데 MIN_PLAY_MS 미만 → 안 센다(아래 참조).
//     ★ 「과다 계수가 누락보다 나쁘다」(Partner 원칙). 광고가 규정보다 «자주»
//       뜨는 쪽이 유저 이탈과 정책 위반 양쪽에서 더 비싸다.
//
// ══════════════════════════════════════════════════════════════════════════
// ★ 「광고를 띄우는 자리」 — 계수와 «분리»한다
// ══════════════════════════════════════════════════════════════════════════
//   합법 노출 지점 = «플레이 중이 아닌» 순간, 즉 mode !== 'play' 인 전이 4곳.
//   main.ts 가 gate(next) 로 감싼다:
//     · 결과 화면 「다시하기」 → 광고 → startRun     ← 주 노출 지점
//     · 결과 화면 「메뉴」     → 광고 → toMenu
//     · 일시정지 「그만두기」  → 광고 → toMenu
//     · 메뉴     「시작」      → 광고 → startRun     ← 밀린 빚을 소비하는 폴백
//
//   ⛔ 일시정지 「이어하기」에는 «걸지 않는다». 그건 판 사이가 아니라 «판 도중»이다.
//   ⛔ 사망 «직후»(결과 화면이 뜨기 전)에도 걸지 않는다. 자기 점수를 보기도 전에
//      광고가 뜨면 무슨 일이 있었는지 모른 채 광고를 본다.
//
// ══════════════════════════════════════════════════════════════════════════
// ★ 「광고가 게임을 막지 않는다」의 «구조적» 보증 (요구사항 2)
// ══════════════════════════════════════════════════════════════════════════
//   1) gate(next) 는 next() 를 «반드시 정확히 한 번» 부른다. 어떤 경로로든.
//      · 빚 없음 / 미준비 / SDK 없음 → «동기»로 즉시 next()
//      · 광고 표시 → dismissed·failedToShow·onError·타임아웃 중 무엇이 와도 next()
//      · showFullScreenAd 가 «동기 throw» 해도 catch 에서 next()
//   2) «로드를 기다리지 않는다». adReady 가 이미 true 일 때만 가로챈다.
//      → 「광고 불러오는 중…」 대기 화면이 «구조적으로 존재할 수 없다».
//   3) 로드 실패는 조용히 넘어가고 «다음 유저 행동»에서 재시도한다(타이머 아님).
//      백오프 + 상한(6회)으로 무한 재시도를 막는다.
//
// ══════════════════════════════════════════════════════════════════════════
// ★ 저장 호환 (요구사항 4)
// ══════════════════════════════════════════════════════════════════════════
//   save.ts 의 SAVE_KEY('king-snake.save')·SAVE_VERSION(1) 은 «한 글자도» 안 건드린다.
//   광고 카운터는 «새 키»(king-snake.ads.v1)에 «따로» 쓴다.
//   ⛔ SaveData 에 필드를 더하지 마라 — sanitize() 를 통과해야 하고, 무엇보다
//     광고 상태가 «게임 진행도»와 같은 레코드에 섞이면 한쪽을 지울 때 다른 쪽이 죽는다.

import { GAME_ID } from '../brand';
import { ensureAdSdk, peekAdSdk, isInToss, type AdSdk } from './adSdk';

/* ─────────────────────────── 상수 ─────────────────────────── */

/**
 * ═══ ★★★ «운영(live) 지면 ID» 다 ═══
 *   지면: 뱀 키우기_전면형_260825 · adFormat INTERSTITIAL · state ENABLED
 *
 * ★★★ 절대 금지 — 이 값이 박힌 번들을 «로컬에서 렌더하지 마라».
 *   `ait dev` · 브라우저 · 헤드리스(Playwright 포함) 전부 금지.
 *   실 광고단위를 등록되지 않은 매체에서 호출하는 것은 «계정 중단 사유»다
 *   (광고 핸드북 §2-10).
 *   → 로컬 동작 검증은 adSdk.ts 의 «주입 스텁»으로만 한다. 스텁은 이 ID 를
 *     받기만 하고 네트워크를 «타지 않는다».
 *   → 부가 방어: adSdk.ensureAdSdk() 가 isInToss() 가 false 면 SDK 청크를
 *     «요청조차 하지 않는다». 즉 로컬에서는 실 SDK 코드가 메모리에 올라오지도 않는다.
 */
const AD_GROUP_ID = 'ait.v2.live.XXXXXXXXXXXXXXXX';

/** 몇 판마다 띄울지. 「두 판 연속 플레이하면」 = President 지시 원문. */
const AD_EVERY = 2;

/**
 * 광고 카운터 저장 키. ★ save.ts 의 SAVE_KEY 와 «명확히 다르다».
 * v1 = 이 파일의 JSON 스키마 버전이지 게임 SAVE_VERSION 이 아니다.
 * 스키마를 늘릴 때는 «키를 바꾸지 말고» 필드를 더해라(모르는 필드는 무시된다).
 */
const AD_STORAGE_KEY = GAME_ID + '.ads.v1';

/** load 콜백이 «아예 안 올» 때의 상한. 넘으면 실패로 친다. */
const PRELOAD_TIMEOUT_MS = 5000;

/**
 * show 타임아웃 «둘». 하나로 합치지 마라 — 네온 스레드가 합쳐서 사고가 났다.
 *   OPEN : 광고가 «열리지 않을» 때만 발동. show/impression 이 오면 즉시 해제된다.
 *          이게 없으면 유저가 검은 화면에 갇힌다.
 *   CAP  : 열린 «뒤»의 안전망. 사실상 발동하지 않는다. 이게 «없으면»
 *          네이티브가 dismissed 를 영영 안 보낼 때 버튼이 영구히 죽는다.
 */
const SHOW_OPEN_TIMEOUT_MS = 7000;
const SHOW_HARD_CAP_MS = 180000;

/**
 * preload 재시도 백오프.
 * ★2026-09-10(레인 A · Partner 지시 「실패 시 백오프 30→60→120초, 숨김 중 재시도 0」): 옛 수열
 *   [5000, 15000, 45000, 120000, 300000, 300000] 은 네온 스레드의 «임의값»이었다(근거 없음).
 *   30/60/120 도 업계 수치가 아니라 «지시값»이다 — 검증된 것은 여전히 «동작»(6회에서 멈춘다)이다.
 *   「숨김 중 재시도 0」은 별도 코드가 아니다: 재시도는 타이머가 아니라 «유저 행동»에만 걸려
 *   있으므로(kickPreload 호출처 = beginRun/endRun/gate/onForeground) 숨김 중에는 구조적으로 0 이다.
 */
const PRELOAD_BACKOFF_MS = [30000, 60000, 120000, 120000, 120000, 120000];
const MAX_PRELOAD_FAILS = 6;

/**
 * ★2026-09-10(레인 A) — 로드된 광고의 «유통기한».
 *   콘솔 실측(7일 09-02~08): 전면형 로드 3,494 → 표시 시도 1,968 → 노출 1,392. 시도 중 29% 가
 *   노출이 안 됐다. 「빚이 생기기 «전»에 미리 받아 둔 광고」는 유저가 2판을 채우기까지 몇 분씩
 *   묵고, 묵은 광고는 show 에서 failedToShow 로 떨어진다(광고 SDK 는 로드된 광고를 영원히 들고
 *   있지 않는다 — 정확한 만료 시간은 SDK 문서에 없다 [미확인], AdMob 은 1시간). 30분이면 그
 *   안쪽이다. 만료된 것은 adReady 를 내리고 «빚이 있을 때만» 다시 받는다(kickPreload).
 */
const READY_TTL_MS = 30 * 60 * 1000;

/**
 * ═══ ★ MIN_PLAY_MS — 「일시정지 → 그만두기」 경로 «전용» 최소 자격 ═══
 *
 * ── 왜 «이 경로에만» 거는가 ──────────────────────────────────────────────
 *   [실측] 사망으로 끝나는 판은 «물리적으로» 3.0초 미만일 수 없다.
 *          game/config.ts:299  SPAWN_GHOST_PLAYER = 3.0
 *          world.ts:209 이 스폰 시 ghostUntil = time + 3.0 을 걸고,
 *          world.ts:310/321/359/386/389 의 «모든» 충돌 검사가 ghostUntil 을 건너뛴다.
 *          (main.ts 의 디버그 kill() 이 ghostUntil=0 을 «명시적으로» 넣어야
 *           죽는다는 사실이 이 가드가 실재함의 반증 불가능한 증거다.)
 *   ⇒ 사망 경로에 시간 검사를 걸면 «아무것도 막지 못하면서» 실패 지점만 는다
 *     (백그라운드 스로틀링·시각 오차로 «정당한 판»을 떨어뜨릴 위험만 생긴다).
 *
 *   [실측] 반면 일시정지는 startRun 직후 «즉시» 가능하다(main.ts setPaused 는
 *          mode==='play' 만 본다). 시작→일시정지→그만두기 한 바퀴가 1초대다.
 *   ⇒ 이 경로만 놔두면 «연타로 광고를 뽑는» 것이 구조적으로 가능하다. 막을 것이 실재한다.
 *
 * ── 값의 «밴드» ───────────────────────────────────────────────────────
 *   [실측 2026-08-25, headless Chromium 390x844, tools/qa_ads.py P5]
 *     하한 = 762 ms — 「시작 → 일시정지 → 그만두기」를 «실제 입력 이벤트» 3회로
 *            최대한 빨리 돌린 한 사이클(3회 측정 762 / 809 / 907 중 최소).
 *     상한 = 3000 ms — 사망으로 끝나는 판의 «물리적 최소»(SPAWN_GHOST_PLAYER).
 *            ★이 위로 «절대» 올리지 마라. 훗날 MIN_PLAY_APPLIES_TO_DEATH 를 켰을 때
 *              «진짜로 끝난 판»이 안 세어진다.
 *   [추정] ⇒ 밴드 (762, 3000) 안에서 2000 을 골랐다. 「측정해서 나온 상수」가
 *          아니라 «판단»이다 — 하한 쪽에 2.6배 여유를 두고 상한 쪽에 1.5배를 남겼다.
 *          1500 도 밴드 안이라 «틀린 값이 아니다».
 *
 * ── ★이 상수를 «어뷰징 방어»라고 부르지 마라 ───────────────────────────
 *   [실측] 같은 한 바퀴를 «한 태스크 안»에서 element.click() 3회로 돌리면 2.4 ms 다.
 *          MIN_PLAY_MS 를 얼마로 올리든 스크립트는 사이에 «대기만 넣으면» 통과한다.
 *   ⇒ 어떤 시간 임계값도 «자동화 방어가 아니다». 이건 «사람의 연타»만 막는다.
 *     자동화까지 막으려면 시간이 아니라 «서버 검증» 같은 다른 축이 필요하고, 여긴 «없다».
 *     나중에 「자동화도 막히는 줄」 알 사람이 나온다. 그 오해를 막으려고 이 문단이 있다.
 *
 * ── President 가 정책을 바꾸라 하면 ────────────────────────────────────
 *   차등을 끄고 «모든 경로»에서 무조건 세기      → MIN_PLAY_MS = 0
 *   사망 경로에도 시간 조건을 걸기               → MIN_PLAY_APPLIES_TO_DEATH = true
 *   임계값만 조정                                → MIN_PLAY_MS 숫자만 (밴드 안에서)
 *   ⛔두 상수를 «합치지 마라». 합치면 「임계값」과 「적용 범위」가 한 노브가 된다.
 */
const MIN_PLAY_MS = 2000;
/** 사망 경로에 최소 조건을 «적용할지». 위 실측대로 기본은 false(=면제). */
const MIN_PLAY_APPLIES_TO_DEATH = false;

/* ══════════════════════════════════════════════════════════════════════════
 * ★★ 전면형 «정책 가드» 3종 (2026-09-10 신설 — 레인 A)
 *
 * ── 왜 이제 넣나 ─────────────────────────────────────────────────────────
 *   공통 지시서 §3 은 이 셋을 「기존 코드에 이미 있는 것을 «유지»한다」로 적었다. 그런데
 *   ★코드에 «없었다». 있는 것은 AD_EVERY(2)·첫 판 제외·MIN_PLAY_MS 뿐이었다.
 *   Codex 적대적 리뷰(2026-09-10)가 그것을 실측으로 확인했다 — 3.5초짜리 8판을 돌리자
 *   **7·14·21·28초에 총 4회** 표시됐다(세션 60초·10분 간격·일 3회를 «모두» 위반).
 *
 * ── 왜 «보수적인 쪽»으로 결정했나 ──────────────────────────────────────────
 *   이 값을 넣으면 전면형 노출이 줄어 수익이 준다([추정] 30~50% — 세션 2분에 2회 뜨던 것이
 *   10분 간격에 걸려 1회가 된다). 반대로 안 넣으면 정책 위반 상태가 계속된다.
 *   ⇒ 이 레포의 규율이 답을 정한다: 「계정 제한은 «비가역»이라 이쪽으로 틀리면 안 된다」
 *     (rewardStore.DAILY_CAP.skinProgress 주석, President 승인 근거). 되돌릴 수 있는 쪽을 고른다.
 *   ⇒ ★수익 영향은 President/Partner 결정 사항이다. 완화는 «아래 상수 세 개»로 끝난다:
 *       MIN_SESSION_AGE_MS 0 · MIN_GAP_MS 0 · DAILY_SHOW_CAP 0(=무제한).
 *
 * ── 「요청 전 가드」 ────────────────────────────────────────────────────────
 *   가드는 kickPreload(요청)와 wantsAd(표시) «둘 다»가 본다. 가드에 걸릴 상황이면 요청 자체를
 *   내보내지 않는다 — 그게 Partner 지시(「가드 통과가 확정된 뒤에만 요청」)이고, 요청만 나가고
 *   막히는 구조가 시청률 40.1% 의 원인이었다(콘솔 실측 로드 3,494 → 시도 1,968).
 * ══════════════════════════════════════════════════════════════════════════ */

/** 세션 시작 후 이 시간 안에는 «0회». 0 이면 규칙 없음. */
const MIN_SESSION_AGE_MS = 60_000;
/** 전면형 사이 최소 간격. 0 이면 규칙 없음. */
const MIN_GAP_MS = 600_000;
/** 하루 최대 노출 수. 0 이면 무제한. */
const DAILY_SHOW_CAP = 3;

/** 이 세션(앱 실행)이 시작된 시각. ⛔모듈 로드 시각이다 — 새로고침·재실행이 세션의 경계다. */
const sessionStartedAt = Date.now();
/** 검사기 전용 — 세션 나이를 앞으로 미는 오프셋(?debug=1 의 __advanceGuardClockForTest). 운영에서는 0 이다. */
let sessionAgeOffset = 0;
/** 마지막으로 전면형을 «띄운» 시각(ms). 저장본에서 복원한다. */
let lastShownAt = 0;
/** 노출을 센 로컬 날짜('YYYY-MM-DD')와 그날 노출 수. */
let shownDay = '';
let shownToday = 0;

/** 로컬 날짜. ★rewardStore.today() 와 «같은 규칙»이다(UTC 로 재면 한국 새벽에 날이 바뀐다). */
function todayKey(): string {
  const d = new Date();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

/** 오늘 몫이 며칠 치인지 정리한다(자정을 넘겼으면 0 으로). */
function rollDay(): void {
  const t = todayKey();
  if (shownDay !== t) {
    shownDay = t;
    shownToday = 0;
  }
}

/**
 * 정책 가드 판정. @returns ok=false 면 «요청도 표시도» 하지 않는다.
 * ⛔?ads=1(always)은 노출 경로 점검용이라 가드를 건너뛴다(운영 경로가 아니다).
 */
export function adGuards(now: number = Date.now()): { ok: boolean; why: string; sessionAgeMs: number; sinceLastMs: number; shownToday: number } {
  rollDay();
  const sessionAgeMs = now - sessionStartedAt + sessionAgeOffset;
  const sinceLastMs = lastShownAt ? now - lastShownAt : Number.POSITIVE_INFINITY;
  const base = { sessionAgeMs, sinceLastMs: lastShownAt ? sinceLastMs : -1, shownToday };
  if (forceMode === 'always') return { ok: true, why: 'forced', ...base };
  if (MIN_SESSION_AGE_MS > 0 && sessionAgeMs < MIN_SESSION_AGE_MS) return { ok: false, why: 'session_start', ...base };
  if (MIN_GAP_MS > 0 && sinceLastMs < MIN_GAP_MS) return { ok: false, why: 'interval', ...base };
  if (DAILY_SHOW_CAP > 0 && shownToday >= DAILY_SHOW_CAP) return { ok: false, why: 'daily_cap', ...base };
  return { ok: true, why: '', ...base };
}

/** 전면형을 «띄웠다»고 기록한다(간격·일 상한의 근거). */
function noteShown(): void {
  rollDay();
  lastShownAt = Date.now();
  shownToday += 1;
  persist();
}

/* ─────────────────────────── 카운터 상태 ─────────────────────────── */

/** 단조 증가하는 «판 수». ★이 값을 올리는 코드는 endRun() 안 한 줄뿐이다. */
let plays = 0;
/**
 * ★★★ «boolean» 이다. 정수 카운터로 만들지 마라.
 *   못 띄운 광고를 정수로 쌓으면 준비가 되는 순간 «매 판 광고»가 터진다
 *   (네온 스레드 DF-2, Partner 원문). 밀리는 광고는 «1개까지»다.
 */
let adPending = false;
/** 하이드레이트 완료 여부 — 완료 전 persist() 가 0 을 덮어쓰는 것을 막는다. */
let hydrated = false;
/** 진행 중인 판. null = 진행 중인 판이 «없다». */
let runActive: { startedAt: number } | null = null;
/** 광고 게이트를 통째로 끄는 스위치(?ads=off). QA·촬영용. */
let forceMode: 'normal' | 'off' | 'always' = 'normal';

/* ─────────────────────────── 저장 ─────────────────────────── */

interface Counter {
  plays: number;
  debt: boolean;
  /** ★2026-09-10 추가 — 정책 가드(간격·일 상한)의 근거. «모르는 필드는 무시된다»는 규약대로 필드만 늘렸다. */
  lastShownAt: number;
  shownDay: string;
  shownToday: number;
}

function parseCounter(raw: string | null): Counter | null {
  if (raw == null) return null;
  try {
    const o = JSON.parse(raw) as {
      plays?: unknown; debt?: unknown; lastShownAt?: unknown; shownDay?: unknown; shownToday?: unknown;
    };
    const n =
      typeof o?.plays === 'number' && Number.isFinite(o.plays) && o.plays >= 0 ? Math.floor(o.plays) : 0;
    const at = typeof o?.lastShownAt === 'number' && Number.isFinite(o.lastShownAt) && o.lastShownAt > 0
      ? Math.floor(o.lastShownAt) : 0;
    const day = typeof o?.shownDay === 'string' && o.shownDay.length <= 10 ? o.shownDay : '';
    const cnt = typeof o?.shownToday === 'number' && Number.isFinite(o.shownToday) && o.shownToday >= 0
      ? Math.min(999, Math.floor(o.shownToday)) : 0;
    return { plays: n, debt: o?.debt === 1 || o?.debt === true, lastShownAt: at, shownDay: day, shownToday: cnt };
  } catch {
    return null;
  }
}

function localRead(): string | null {
  try {
    return window.localStorage.getItem(AD_STORAGE_KEY);
  } catch {
    return null; // 사파리 프라이빗 등 — save.ts 와 같은 방침(throw 하지 않는다)
  }
}

function localWrite(v: string): void {
  try {
    window.localStorage.setItem(AD_STORAGE_KEY, v);
  } catch {
    /* quota / private mode — 광고가 덜 뜰 뿐 게임은 계속돼야 한다 */
  }
}

/**
 * 부팅 시 1회. localStorage + «네이티브 Storage» 양쪽에서 카운터를 복원한다.
 *
 * ★ 왜 네이티브까지 보는가: 미니앱 WebView 의 localStorage 는 «영속을 보장하지
 *   않는다»(토스 SDK storage 문서 원문). 세션마다 0 으로 리셋되면 「첫 판 제외」
 *   규칙 때문에 매 세션 첫 판이 항상 무광고가 되어 노출 위상이 계속 어긋난다.
 * ★ 절대 throw 하지 않는다. 실패하면 {0,false} 로 시작한다.
 * ★ plays 는 «단조 증가»다 → 둘 중 «큰 쪽»이 최신이다. 동률이면 네이티브(영속본).
 */
async function hydrate(): Promise<void> {
  try {
    const localRaw = localRead();
    let nativeRaw: string | null = null;
    // ★ 여기서 SDK 를 «부르지만» 토스 밖이면 ensureAdSdk 가 청크를 안 받아온다.
    // ★ ?ads=off 일 때도 «안 받아온다» — 광고를 끈 판(QA·스토어 촬영)에서
    //   광고 청크를 내려받을 이유가 없다. 계수는 localStorage 만으로 계속 돈다.
    if (forceMode !== 'off') {
      const sdk = await ensureAdSdk();
      if (sdk?.Storage) {
        nativeRaw = await sdk.Storage.getItem(AD_STORAGE_KEY).catch(() => null);
      }
    }
    const a = parseCounter(nativeRaw);
    const b = parseCounter(localRaw);
    const pick = a == null ? b : b == null ? a : a.plays >= b.plays ? a : b;
    if (pick) {
      // ★경합 방어 — 하이드레이트는 «단조»다. 하이드레이트가 늦게 끝나도
      //   그 사이에 센 판이 «0 으로 되감기지» 않는다.
      plays = Math.max(plays, pick.plays);
      adPending = adPending || pick.debt;
      /* 정책 가드도 «되감기지» 않게 큰 쪽을 취한다 — 이 값들이 작아지면 상한을 우회하게 된다.
         날짜가 오늘이 아니면 그날 몫은 0 이다(rollDay 가 정리한다). */
      lastShownAt = Math.max(lastShownAt, pick.lastShownAt);
      if (pick.shownDay === todayKey()) {
        shownDay = pick.shownDay;
        shownToday = Math.max(shownToday, pick.shownToday);
      }
    }
  } catch {
    /* 광고 카운터가 부팅을 막으면 안 된다 */
  } finally {
    hydrated = true;
  }
}

/** 양쪽에 쓴다. fire-and-forget — await 하지 않는다(게임 흐름을 막지 않는다). */
function persist(): void {
  if (!hydrated) return;
  const json = JSON.stringify({ plays, debt: adPending ? 1 : 0, lastShownAt, shownDay, shownToday });
  localWrite(json);
  try {
    const sdk = peekAdSdk();
    if (sdk?.Storage) void sdk.Storage.setItem(AD_STORAGE_KEY, json).catch(() => undefined);
  } catch {
    /* 삼킨다 */
  }
}

/* ─────────────────────── 노출 판정 ─────────────────────── */

/**
 * 이번 판 종료로 «빚을 질 차례»인가.
 * ★ 첫 판은 «제외»한다(요구사항 3) — plays 1 에서는 안 띄우고 2, 4, 6 … 에서 띄운다.
 *   유저가 게임을 보기도 전에 광고를 보면 그대로 이탈이다.
 */
export function shouldShow(count: number): boolean {
  if (forceMode === 'off') return false;
  if (forceMode === 'always') return true;
  if (count < AD_EVERY) return false;
  return count % AD_EVERY === 0;
}

/* ─────────────────────── 판 계수 ─────────────────────── */

/** 판이 «시작»했다고 표시한다. main.ts startRun() 끝에서 부른다. */
export function beginRun(): void {
  runActive = { startedAt: Date.now() };
  // ★2026-09-10: 빚(adPending)이 «있을 때만» 받는다(kickPreload 안에서 판정). 빚 없는 판 시작에서는
  //   요청 0 — 「요청 = 노출」. 이전 세션이 빚을 남겼으면 여기서 받아 메뉴/다음 결과에서 소비된다.
  kickPreload();
}

/**
 * ★한 판을 «정확히 한 번» 확정한다. 어디서 몇 번 불려도 안전(멱등).
 *
 * source
 *   'death'   = 플레이어 사망. 물리적으로 3.0초 이상 걸린 판이므로 «무조건 자격».
 *   'abandon' = 판을 버렸다(일시정지→그만두기, 또는 안전망 경로).
 *               MIN_PLAY_MS 미만이면 «세지 않는다».
 */
export function endRun(source: 'death' | 'abandon'): void {
  const r = runActive;
  if (!r) return; // ★멱등의 전부 — 열린 판이 없으면 아무 일도 안 한다
  runActive = null; // ★먼저 비운다. 아래에서 재진입해도 두 번 세지 않는다.

  if (source === 'abandon') {
    if (Date.now() - r.startedAt < MIN_PLAY_MS) {
      kickPreload();
      return; // 최소 자격 미달 — 판으로 안 센다
    }
  } else if (MIN_PLAY_APPLIES_TO_DEATH) {
    if (Date.now() - r.startedAt < MIN_PLAY_MS) {
      kickPreload();
      return;
    }
  }

  plays += 1; // ★★ plays 를 증가시키는 «유일한» 줄
  if (shouldShow(plays)) adPending = true;
  persist();
  kickPreload(); // 곧 띄울지 모른다 — 지금 받아 둔다
}

/* ─────────────────────── 광고 로드 ─────────────────────── */

let adReady = false;
/** adReady 가 선 시각(ms). READY_TTL_MS 가 지나면 «묵은 광고»로 보고 버린다(2026-09-10). */
let readyAt = 0;
let loading = false;
let preloadFails = 0;
let nextRetryAt = 0;
let loadTimer: ReturnType<typeof setTimeout> | null = null;
/** ★loadFullScreenAd 의 «반환값 = 구독 해지 함수». 버리면 누수 + 중복 이벤트다. */
let cancelLoad: (() => void) | null = null;
/** 늦게 온 콜백이 «다음» 시도를 오염시키지 않게 하는 토큰. */
let loadToken = 0;

function clearLoadTimer(): void {
  if (loadTimer !== null) {
    clearTimeout(loadTimer);
    loadTimer = null;
  }
}

function disposeLoad(): void {
  const c = cancelLoad;
  cancelLoad = null;
  if (typeof c === 'function') {
    try {
      c();
    } catch {
      /* 해지 실패는 무시 */
    }
  }
}

function adsUsable(sdk: AdSdk): boolean {
  try {
    return sdk.loadFullScreenAd.isSupported() && sdk.showFullScreenAd.isSupported();
  } catch {
    return false; // 판정 자체가 실패하면 «광고를 포기»한다. 게임이 우선이다.
  }
}

function onPreloadFailed(token: number): void {
  if (token !== loadToken) return; // 이전 시도의 지각 콜백 — 무시
  loadToken += 1;
  clearLoadTimer();
  disposeLoad();
  adReady = false;
  loading = false;
  preloadFails += 1;
  const i = Math.min(preloadFails - 1, PRELOAD_BACKOFF_MS.length - 1);
  nextRetryAt = Date.now() + PRELOAD_BACKOFF_MS[i];
}

/**
 * 다음 광고를 미리 로드해 둔다. 실패해도 «조용히» 넘어간다.
 *
 * ★ 재시도 트리거는 «타이머가 아니라 유저 행동»이다(판 시작·판 종료·광고 종료).
 *   앱이 놀 때 배터리를 안 먹고, 한 판이 최소 3초라 연타가 구조적으로 불가능하다.
 * ★ 네온 스레드 v1 의 치명적 결함을 여기서 막는다: 호출처가 «설치 시 1회 +
 *   광고 성공 후 1회» 뿐이면 onError 한 번에 그 세션 광고가 영구히 0 이 된다.
 */
/**
 * 지금 화면이 «안 보이는가». ★2026-09-10(Codex 적대적 리뷰 지적 4): 저장소 응답·브릿지 콜백 같은
 *   «비동기 경계 뒤»에서는 그 사이에 앱이 백그라운드로 갔을 수 있다. 그때 요청을 내보내면
 *   「요청은 나갔는데 노출은 없는」 건이 그대로 쌓인다(Partner 지시: 숨김 중 요청 0).
 */
function hiddenNow(): boolean {
  try {
    return typeof document !== 'undefined' && document.hidden === true;
  } catch {
    return false;
  }
}

export function kickPreload(): void {
  if (forceMode === 'off') return;
  // ★숨김 중에는 «요청하지 않는다». 복귀하면 onForeground() 가 다시 두드린다.
  if (hiddenNow()) return;
  /* ★★ 2026-09-10(레인 A · Partner 지시 「가드 통과가 확정된 뒤에만 요청」) — «빚이 있을 때만» 받는다.
   *
   *   전에는 판이 시작될 때마다(beginRun) 빚과 무관하게 미리 받았다. 그 결과가 콘솔 실측
   *   전면형 «요청 3,471 → 노출 1,392 (40.1%)» 다 — 1판만 하고 나가는 세션, 2판을 채우기까지
   *   묵어 버린 광고가 전부 「요청은 했는데 노출은 없는」 건으로 쌓였다(헛요청 2,307/주).
   *   선택형 지면의 원칙은 «요청 = 노출»이다. 빚(adPending)이 서는 순간은 endRun 의 사망 처리
   *   (결과 화면이 뜨기 700ms 전)이므로, 그때 받기 시작하면 「다시 하기」를 누를 때쯤 준비된다.
   *   준비가 안 됐으면 gate 는 «기다리지 않고» 다음 합법 지점으로 미룬다(빚은 그대로) — 이 파일의
   *   「대기 화면은 구조적으로 존재할 수 없다」 원칙은 그대로다. 노출은 «미뤄질» 뿐 사라지지 않는다.
   *   ⛔?ads=1(always) 는 빚 유무와 무관하게 «준비만 되면» 띄우는 점검 스위치라 예외다. */
  if (forceMode !== 'always' && !adPending) return;
  /* ★★ 정책 가드에 걸릴 상황이면 «요청 자체를 안 한다»(Partner 지시: 가드 통과가 확정된 뒤에만 요청).
     세션 60초 안·10분 간격 안·일 상한 초과에서 미리 받아 두면, 그 광고는 뜨지 못하고 묵어서
     「요청은 나갔는데 노출은 없는」 건이 된다 — 시청률 40.1% 를 만든 구조가 바로 그것이다.
     ⛔가드에 걸려도 빚(adPending)은 «그대로 남는다». 조건이 풀리는 다음 지점에서 받아 띄운다. */
  if (!adGuards().ok) return;
  // 묵은 광고는 버린다. 다음 줄들이 «지금 빚이 있으니» 새로 받는다.
  if (adReady && Date.now() - readyAt > READY_TTL_MS) {
    disposeLoad();
    adReady = false;
    readyAt = 0;
  }
  if (adReady || loading) return;
  if (preloadFails >= MAX_PRELOAD_FAILS) return; // ⛔무한 재시도 금지
  if (Date.now() < nextRetryAt) return; // 백오프 하한

  // ★ 로딩 중복 방지 플래그를 «여기서» 세운다. ensureAdSdk 가 비동기라
  //   안 세우면 유저가 빠르게 두 번 행동할 때 두 번 로드된다.
  loading = true;
  void ensureAdSdk().then((sdk) => {
    /* ★비동기 경계 — SDK 청크·저장소를 기다리는 사이에 화면이 숨겨졌거나 빚이 사라졌을 수 있다.
       그 상태로 로드를 내보내면 「요청은 나갔는데 노출은 없는」 건이 된다(Codex 지적 4). */
    if (hiddenNow() || (forceMode !== 'always' && !adPending) || !adGuards().ok) {
      loading = false;
      return;
    }
    if (!sdk || !adsUsable(sdk)) {
      // 토스 밖 · 미지원 · SDK 청크 실패. 조용히 포기한다.
      // ★preloadFails 를 «올리지 않는다» — 이건 「실패」가 아니라 「해당 없음」이다.
      //   올리면 나중에 지원 환경이 돼도 백오프에 걸려 못 뜬다.
      loading = false;
      return;
    }
    disposeLoad(); // 재시도 전 «이전 구독 해지»
    const token = loadToken;
    loadTimer = setTimeout(() => onPreloadFailed(token), PRELOAD_TIMEOUT_MS);
    try {
      const cancel = sdk.loadFullScreenAd({
        options: { adGroupId: AD_GROUP_ID },
        onEvent: (e) => {
          if (token !== loadToken) return;
          if (e?.type === 'loaded') {
            clearLoadTimer();
            adReady = true;
            readyAt = Date.now();
            loading = false;
          }
        },
        onError: () => onPreloadFailed(token),
      });
      cancelLoad = typeof cancel === 'function' ? cancel : null;
    } catch {
      onPreloadFailed(token);
    }
  });
}

/* ─────────────────────── 광고 표시 ─────────────────────── */

/**
 * 광고를 보여주고, «끝나면» done() 을 부른다.
 * 성공/실패/타임아웃 «어느 경우에도» done() 은 «정확히 한 번» 불린다 —
 * 그래야 유저가 광고에 갇히지 않는다(요구사항 2).
 */
function showAd(done: () => void): void {
  let finished = false;
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let capTimer: ReturnType<typeof setTimeout> | null = null;
  let cancelShow: (() => void) | null = null;

  const finish = (): void => {
    if (finished) return;
    finished = true;
    if (openTimer !== null) clearTimeout(openTimer);
    if (capTimer !== null) clearTimeout(capTimer);
    openTimer = null;
    capTimer = null;
    if (typeof cancelShow === 'function') {
      try {
        cancelShow();
      } catch {
        /* 해지 실패는 무시 */
      }
      cancelShow = null;
    }
    adReady = false;
    readyAt = 0;
    kickPreload(); // 「닫힌 뒤에는 다시 load 해야 한다」(SDK 문서). ★빚이 없으면 이제 안 받는다(2026-09-10).
    done();
  };

  const sdk = peekAdSdk();
  if (!sdk) {
    // 여기 오면 안 되지만(adReady 가 true 였다), «와도» 게임은 계속돼야 한다.
    finish();
    return;
  }

  openTimer = setTimeout(finish, SHOW_OPEN_TIMEOUT_MS);
  capTimer = setTimeout(finish, SHOW_HARD_CAP_MS);

  try {
    const cancel = sdk.showFullScreenAd({
      options: { adGroupId: AD_GROUP_ID },
      onEvent: (e) => {
        const type = e?.type;
        // 광고가 «열렸다» → OPEN 타임아웃 해제. 이제부터는 hard cap 만 남는다.
        if (type === 'show' || type === 'impression') {
          if (openTimer !== null) {
            clearTimeout(openTimer);
            openTimer = null;
          }
          return;
        }
        // dismissed / failedToShow 가 «끝»이다. clicked·requested 는 진행 중.
        if (type === 'dismissed' || type === 'failedToShow') finish();
      },
      onError: () => finish(),
    });
    cancelShow = typeof cancel === 'function' ? cancel : null;
  } catch {
    finish();
  }
}

/* ─────────────────────── 게이트 ─────────────────────── */

/** 지금 광고를 띄울 수 있고 띄워야 하는가. */
function wantsAd(): boolean {
  if (forceMode === 'off') return false;
  if (forceMode !== 'always' && !adPending) return false;
  // 묵은 광고는 띄우지 않는다 — failedToShow 로 떨어져 «시도만 늘리는» 경로다(2026-09-10).
  if (adReady && Date.now() - readyAt > READY_TTL_MS) return false;
  // ★정책 가드(세션 60초·10분 간격·일 3회). 걸리면 빚을 남기고 다음 지점으로 미룬다.
  if (!adGuards().ok) return false;
  return adReady && peekAdSdk() !== null;
}

/**
 * ★2026-09-10(레인 A · Partner 지시 「iOS 백그라운드 복귀 시 리스너 재연결」).
 *   앱이 백그라운드에 있는 동안 iOS WebView 는 타이머·브릿지 콜백을 미룬다. 로드 중이던 광고가
 *   복귀 시점에 PRELOAD_TIMEOUT 으로 실패 처리되고 백오프(30s)에 걸리면, 유저가 바로 이어서 한
 *   「다시 하기」에서 빚이 있어도 광고가 «못 뜬다». 복귀 순간에 «빚이 있고 준비도 로드도 아닌» 상태면
 *   백오프를 풀고 한 번 다시 받는다. main.ts 의 visibilitychange(visible) 에서만 부른다.
 *   ⛔숨김(hidden)에서는 아무것도 하지 않는다 — 「숨김 중 재시도 0」.
 *   ⛔빚이 없으면 받지 않는다(kickPreload 가 막는다) = 요청 = 노출 원칙 유지.
 */
export function onForeground(): void {
  if (forceMode === 'off') return;
  if (!adPending || adReady || loading) return;
  /* ⛔여기서 nextRetryAt 을 «0 으로 밀지 않는다»(2026-09-10 Codex 지적 5).
     밀면 30초 대기 중에 앱을 몇 번 왔다 갔다 하는 것만으로 백오프가 통째로 무력화되고
     실패 상한(6회)까지 순식간에 태운다 — 실측 재현: 대기 없이 총 6회 요청.
     복귀의 역할은 「숨김 때문에 못 나간 요청을 다시 두드리는 것」이지 백오프 해제가 아니다. */
  kickPreload();
}

/**
 * 게이트 세대 번호. ★«화면이 대기 상태로 남는» 최악을 없애는 장치다 — 아래 설명 필독.
 */
let gateSeq = 0;

/**
 * ★ 합법 노출 지점에서 «원래 동작»을 감싼다.
 *
 *   gate(startRun)  처럼 쓴다.
 *   광고를 띄울 상황이면 광고를 «먼저» 보여주고 «끝난 뒤» next() 를 부른다.
 *   아니면 «동기»로 즉시 next() 를 부른다 — 한 프레임도 안 밀린다.
 *
 * ═══ ★★ gateSeq — 왜 세대 번호가 필요한가 (요구사항 2의 «마지막» 구멍) ═══
 *   병리적 경우: showFullScreenAd 를 불렀는데 네이티브가 광고를 «열지도, 에러를
 *   주지도» 않는다. 그러면 SHOW_OPEN_TIMEOUT_MS(7초) 동안 화면에 아무 변화가 없다.
 *   광고가 «안 떴으므로» 유저는 버튼을 다시 누를 수 있다 — 그리고 눌러야 한다.
 *
 *   그때 두 번째 gate() 는 빚이 «이미 소비돼» adPending=false 이므로
 *   next() 를 «즉시» 부른다 → 게임이 바로 진행된다(= 유저는 절대 갇히지 않는다).
 *   문제는 7초 뒤 «첫 번째» gate 의 콜백이 뒤늦게 깨어나 next() 를 «또» 부르는 것이다.
 *   next 가 startRun 이면 «플레이 중인 판이 통째로 리셋»된다.
 *
 *   ⇒ 자기 세대가 최신이 아니면 «조용히 버린다». 이 세 줄이 없으면
 *     「탈출은 되는데 7초 뒤 게임이 갑자기 처음부터 다시 시작되는」 사고가 난다.
 *   ⛔ 「gateBusy 플래그로 두 번째 클릭을 «무시»」로 바꾸지 마라. 그건 정확히
 *     요구사항이 금지한 «버튼이 멈추는» 동작이다.
 *
 * ⛔ next() 에 «시점에 민감한» 코드를 넘기지 마라. 광고가 뜨면 next() 는
 *   수 초~수십 초 뒤에 실행된다. main.ts 는 startRun/toMenu 만 넘긴다
 *   (둘 다 언제 불려도 같은 결과인 «상태 전이»다).
 */
export function gate(next: () => void): void {
  const my = ++gateSeq;
  kickPreload(); // 유저가 게이트를 건드릴 때마다 로드 재시도를 두드린다

  if (!wantsAd()) {
    // ★ 빚(adPending)은 «그대로 남는다». 다음 합법 지점에서 소비된다.
    next();
    return;
  }

  adPending = false; // 빚 소비는 «실제로 띄우는» 이 순간에만
  noteShown();       // 정책 가드(간격·일 상한)의 기준 시각·횟수. persist 는 그 안에서 한다.
  preloadFails = 0; // 표시 성공 → 백오프/실패 카운터 리셋 (⛔영속화 안 함)
  nextRetryAt = 0;

  showAd(() => {
    if (my !== gateSeq) return; // 더 새 게이트가 이미 유저를 내보냈다 — 버린다
    next();
  });
}

/* ─────────────────────── 부팅 ─────────────────────── */

/**
 * 부팅 시 1회. main.ts 가 부른다.
 * ★ await 하지 않는다 — 하이드레이트를 기다리면 부팅이 브릿지 응답에 묶인다.
 *   기다리지 않아도 안전하다: persist() 가 hydrated 전에는 «쓰지 않고»,
 *   hydrate() 는 Math.max 로 «되감기지 않는다».
 */
export function initAds(mode: 'normal' | 'off' | 'always' = 'normal'): void {
  forceMode = mode;
  void hydrate().then(() => kickPreload());
}

/* ─────────────────────── 진단(?debug=1 전용) ─────────────────────── */

export function adsDebugState(): {
  plays: number;
  adPending: boolean;
  adReady: boolean;
  loading: boolean;
  preloadFails: number;
  hydrated: boolean;
  runOpen: boolean;
  inToss: boolean;
  mode: string;
  every: number;
  minPlayMs: number;
  readyTtlMs: number;
  nextRetryInMs: number;
  guard: { ok: boolean; why: string; sessionAgeMs: number; sinceLastMs: number; shownToday: number };
  guardConst: { sessionMs: number; gapMs: number; dailyCap: number };
  shownToday: number;
} {
  return {
    plays,
    adPending,
    adReady,
    loading,
    preloadFails,
    hydrated,
    runOpen: runActive !== null,
    inToss: isInToss(),
    mode: forceMode,
    every: AD_EVERY,
    minPlayMs: MIN_PLAY_MS,
    readyTtlMs: READY_TTL_MS,
    nextRetryInMs: Math.max(0, nextRetryAt - Date.now()),
    guard: adGuards(),
    guardConst: { sessionMs: MIN_SESSION_AGE_MS, gapMs: MIN_GAP_MS, dailyCap: DAILY_SHOW_CAP },
    shownToday,
  };
}

/**
 * 테스트 전용 — 정책 가드의 «시계»를 앞으로 민다(?debug=1).
 * @param ms 세션 시작 시각과 마지막 노출 시각을 이만큼 «과거로» 민다 = 그만큼 시간이 흐른 것과 같다.
 * ⛔상한 카운터(shownToday)는 건드리지 않는다 — 그건 시간이 아니라 «횟수»다.
 */
export function __advanceGuardClockForTest(ms: number): void {
  if (lastShownAt) lastShownAt -= ms;
  sessionAgeOffset += ms;
}

/** 테스트 전용 — 준비된 광고의 시각을 «과거로» 밀어 만료 경로를 재현한다(?debug=1). */
export function __ageReadyForTest(ms: number): void {
  if (adReady) readyAt -= ms;
}

/** 테스트 전용 — 모듈 상태 초기화. ?debug=1 에서만 window 로 노출된다. */
export function __resetAdsForTest(): void {
  plays = 0;
  adPending = false;
  hydrated = true; // 테스트는 하이드레이트를 기다리지 않는다
  runActive = null;
  adReady = false;
  readyAt = 0;
  loading = false;
  preloadFails = 0;
  nextRetryAt = 0;
  loadToken = 0;
  gateSeq = 0;
  /* 정책 가드도 «시나리오 사이»에서 비운다. 안 비우면 앞 시나리오의 노출이 다음 시나리오의
     간격·일 상한을 먹어 「옳은 코드가 틀린 것으로」 나온다. ★세션 나이는 «충분히 지난» 것으로 둔다 —
     검사기는 세션 60초를 따로 검증한다(그 항목만 오프셋 0 에서 잰다). */
  lastShownAt = 0;
  shownDay = '';
  shownToday = 0;
  sessionAgeOffset = MIN_SESSION_AGE_MS;
  clearLoadTimer();
  disposeLoad();
}
