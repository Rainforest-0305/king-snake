// rewardStore.ts — 리워드 «지급 원장». 게임 세이브 «밖»의 별도 키.
//
// ══ 왜 save.ts 에 안 넣는가 ═══════════════════════════════════════════════
//  1) src/save.ts 는 «보호 파일»이다(tools/check_protected.mjs). 라이브 정본과
//     바이트 단위로 같아야 하고, qa_save_compat.py 가 「저장 키 집합이 그대로인가」를
//     검사한다. 필드를 하나 늘리면 그 검사가 실패하고, 구버전 저장본과의
//     호환(v 불일치 → 전량 초기화)도 깨진다.
//  2) 성격이 다르다. save.ts 는 «유저의 기록»이고 여기는 «광고 지급 원장»이다.
//     유실됐을 때의 옳은 동작도 다르다 — 기록은 지켜야 하고, 지급 원장은
//     유실되면 다시 광고를 보면 된다(우리 손해가 아니라 유저 손해도 아니다).
//
// ══ ⛔ 한계: 클라이언트 판정이다 (President 요구사항 4) ═══════════════════
//  서버가 «없다». 보상 지급 여부·상한 소진 여부를 전부 이 브라우저가 판정한다.
//  따라서 다음이 «구조적으로» 가능하다. 숨기지 않고 적어 둔다:
//    · localStorage 를 지우면 일일 상한이 초기화된다 → 광고를 더 볼 수 있다.
//      (우리에게 손해가 아니다 — 노출이 늘 뿐 지급은 코스메틱·판내 혜택이다.)
//    · localStorage 를 직접 편집하면 광고 «없이» 스킨을 해금할 수 있다.
//      (bestScore 를 조작하면 지금도 가능하다 — 새로 생긴 구멍이 아니다.)
//    · 기기 시계를 바꾸면 「하루」가 바뀌어 일일 상한이 초기화된다.
//  ⇒ 그래서 이 원장으로는 «실돈»을 지급하지 않는다. 실돈(토스 포인트 프로모션)
//    경로는 이 파일과 «무관»하며, 이 레인은 거기 손대지 않았다.
//  ⇒ 상한의 목적은 어뷰징 «차단»이 아니라, 정상 유저의 광고 피로와 게임 밸런스
//    보호다. 그 목적에는 클라이언트 판정으로 충분하다.

const KEY = 'king-snake.reward.v1';
const VERSION = 1;

/** 일일 상한. «판당» 상한은 각 기능이 따로 든다(부활 = 판당 1회, revive.ts). */
export const DAILY_CAP = {
  /** 부활: 하루 5회. 한 판에 1회 제한이 이미 있으므로 5판까지 살려 준다. */
  revive: 5,
  /** 시작 부스트: 하루 5회. */
  startBoost: 5,
  /**
   * 스킨 해금: 하루 3종.
   *
   * ★ 2026-09-01 정정 — 예전 주석은 「광고로 열 수 있는 스킨은 총 9종이라 3일이면
   *   전부 열린다」였다. 그 «9종»이 틀렸다. President 지시로 광고 대상이
   *   game/skins.ts `AD_UNLOCKABLE_SKIN_IDS` 5종으로 줄었다(프로모션 예산 보호).
   *   ⇒ 5종 ÷ 3종/일 = **2일**(1일차 3종 + 2일차 2종)이면 전부 열린다.
   *     2일차에는 상한 3 중 «1회가 남는다» — 즉 상한이 병목이 아니라 «목록 크기»가
   *     병목이다. 3종으로 더 줄이면 하루 만에 끝난다(그때는 상한 3 이 딱 맞는다).
   *   ⛔ 이 값을 여기서 «올리지» 마라. 상한은 광고 피로 손잡이지 해금 속도 손잡이가
   *     아니다. 해금 속도는 목록으로 조절한다.
   */
  skinUnlock: 3,
  /**
   * 기록 돌파 성장(질량 1.2배): 하루 6회.
   *
   * ★ 왜 6인가 — 이 값은 «어뷰징 상한»이 아니라 «판 사이의 상한»이다.
   *   한 판 안의 상한은 growthTriggers.GROWTH_MAX_PER_RUN(2) 이 따로 든다.
   *   그쪽이 순위표를 지키는 진짜 손잡이고(한 판 최대 1.44배로 고정), 이 값은
   *   「하루에 몇 판이나 보정된 점수로 기록될 수 있는가」만 정한다. 6 = 3판분이다.
   *   ⛔ 6 을 근거로 「하루 최대 2.99배」를 계산하면 «틀린다» — 배율은 판을 넘어
   *     누적되지 않는다. 판이 끝나면 질량은 START_MASS 로 되돌아간다.
   */
  growth: 6,
  /**
   * 최고급 스킨 진행도(전용 지면): 하루 **10회**.
   *
   * ★ 이 숫자 «하나»가 해금까지 걸리는 날을 정한다 — 100회 ÷ 10회/일 = **최소 10일**.
   *
   * 다른 후보를 버린 이유(Partner 판단용 근거):
   *   20회/일 → 5일.  짧지만 «한 사람이 하루 20편»은 리워드 광고에서 무효 트래픽으로
   *                  읽히기 쉬운 밀도다. 계정 제한은 «비가역»이라 이쪽으로 틀리면 안 된다.
   *    5회/일 → 20일. 안전하지만 중도 이탈이 커서 100회가 사실상 도달 불가가 된다.
   *   10회/일 → 10일. 기존 4지면 합(5+5+3+6 = 19)의 절반 수준이라 «하루 총 광고량»이
   *                  기존 대비 1.5배를 안 넘는다. 이 비율이 채택 근거다.
   * ★2026-09-02 Partner **승인·확정**: 10. 바꿀 때는 이 숫자 하나만 고친다.
   *   승인 근거로 「20회/일은 무효 트래픽 판정 위험(계정 제한은 비가역)」이 명시됐다.
   *   ⛔올릴 때는 반드시 그 위험을 다시 판단하고 올려라.
   */
  skinProgress: 10,
  /**
   * 결과 화면 「이번 판 성장 2배」(2026-09-10 레인 A): 하루 **3회**.
   *
   * ★ 3 은 Codex 전략 원문(「한 세션 1회, 일 3회 상한」)을 Partner 가 그대로 확정한 값이다.
   *   세션 1회는 여기가 아니라 main.ts 의 판 상태(세션 = 앱 실행 1회)가 든다 — 이 원장은
   *   «하루»만 안다. 두 상한이 «둘 다» 참일 때만 버튼이 뜬다(canOfferResultDouble).
   * ★ 보상의 뜻(다음 판 시작 길이로 이어받는 «성장분» ×2)은 reward/carryStore.ts 가 정한다.
   */
  resultDouble: 3,
} as const;

export type RewardKind = keyof typeof DAILY_CAP;

/**
 * 로컬 날짜 키 'YYYY-MM-DD' — 이 원장이 «하루»를 가르는 정본. 다른 모듈(교차추천 하루 1회 등)도
 * 이 함수를 «가져다» 쓴다. 두 벌 만들면 자정 판정이 어긋난다(한쪽은 UTC 로 새는 사고가 흔하다).
 */
export function localDayKey(): string {
  return today();
}

interface Ledger {
  v: number;
  /** 로컬 날짜 'YYYY-MM-DD'. 이 값이 오늘과 다르면 used 를 전부 0 으로 되돌린다. */
  day: string;
  used: Record<RewardKind, number>;
  /** 광고로 «영구» 해금된 스킨 id 목록. */
  skins: string[];
}

/** 로컬 날짜. ★ toISOString() 을 쓰지 않는다 — 그건 UTC 라 한국 새벽 9시에 날이 바뀐다. */
function today(): string {
  const d = new Date();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

/**
 * 「전 지면 0회」 상태.
 * ★ 지면 목록을 «손으로 두 번 적지 않는다» — DAILY_CAP 의 키에서 «유도»한다.
 *   전에는 { revive:0, startBoost:0, ... } 를 두 곳에 박아 뒀는데, 지면을 하나
 *   추가하는 순간 두 곳 다 고쳐야 하고 한 곳을 빠뜨리면 「상한이 없는 지면」이
 *   조용히 생긴다(auto-memory 「테스트가 틀린 값을 고정한다」와 같은 형태의 사고).
 */
function zeroUsed(): Record<RewardKind, number> {
  const out = {} as Record<RewardKind, number>;
  for (const k of Object.keys(DAILY_CAP) as RewardKind[]) out[k] = 0;
  return out;
}

function empty(): Ledger {
  return { v: VERSION, day: today(), used: zeroUsed(), skins: [] };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function count(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  // 음수·소수·터무니없는 값은 접는다. 상한을 «위로» 접어 두면 조작해도 상한이 늘지 않는다.
  return Math.min(999, Math.max(0, Math.floor(v)));
}

let cache: Ledger | null = null;

/** ★ 절대 throw 하지 않는다. 저장소를 못 쓰는 환경(사파리 프라이빗 등)이 실재한다. */
function read(): Ledger {
  if (cache) {
    // 날짜가 넘어갔으면 «읽는 그 순간» 초기화한다(앱을 켜 둔 채 자정을 넘긴 경우).
    if (cache.day !== today()) {
      cache.day = today();
      cache.used = zeroUsed();
      write();
    }
    return cache;
  }
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    cache = empty();
    return cache; // 저장소 자체를 못 쓴다 — 메모리에만 들고 간다(세션 안에서는 상한이 산다)
  }
  if (!raw) {
    cache = empty();
    return cache;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    cache = empty();
    return cache;
  }
  const d = empty();
  if (isObj(parsed) && parsed.v === VERSION) {
    if (typeof parsed.day === 'string' && parsed.day === today() && isObj(parsed.used)) {
      /* ★ 키를 손으로 나열하지 «않는다». 나열하면 지면을 추가했을 때 이 줄을
         빠뜨리기 쉬운데, 그 사고는 «조용하다» — 새 지면의 오늘 사용량이 새로고침마다
         0 으로 돌아가 일일 상한이 사실상 «무제한»이 된다(화면엔 아무 이상이 없다).
         DAILY_CAP 의 키에서 유도하면 지면 추가가 자동으로 따라온다. */
      const used = parsed.used as Record<string, unknown>;
      for (const k of Object.keys(DAILY_CAP) as RewardKind[]) d.used[k] = count(used[k]);
    }
    if (Array.isArray(parsed.skins)) {
      // 스킨 id 는 문자열만·길이 제한·중복 제거. 개수 상한은 스킨 수(12)보다 넉넉히.
      const seen = new Set<string>();
      for (const s of parsed.skins) {
        if (typeof s !== 'string' || s.length === 0 || s.length > 24) continue;
        if (seen.has(s)) continue;
        seen.add(s);
        if (seen.size >= 64) break;
      }
      d.skins = Array.from(seen);
    }
  }
  cache = d;
  return d;
}

function write(): void {
  if (!cache) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* quota / private mode — 이번 세션에서는 메모리 캐시가 상한을 지킨다 */
  }
}

/* ─────────────────────── 일일 상한 ─────────────────────── */

export function usedToday(kind: RewardKind): number {
  return read().used[kind];
}

export function remainingToday(kind: RewardKind): number {
  return Math.max(0, DAILY_CAP[kind] - usedToday(kind));
}

export function underDailyCap(kind: RewardKind): boolean {
  return remainingToday(kind) > 0;
}

/**
 * 지급을 «기록»한다. ★보상이 확정된 뒤에만 부른다(광고를 띄우기 전이 아니라).
 * 광고를 띄우기 전에 세면, 로드 실패로 광고를 못 본 유저의 상한이 깎인다.
 */
export function noteGranted(kind: RewardKind): void {
  const d = read();
  d.used[kind] = count(d.used[kind] + 1);
  write();
}

/* ─────────────────────── 스킨 영구 해금 ─────────────────────── */

export function adUnlockedSkins(): readonly string[] {
  return read().skins;
}

export function isSkinAdUnlocked(id: string): boolean {
  return read().skins.indexOf(id) >= 0;
}

/** @returns 이번 호출로 «새로» 해금됐는가(멱등 — 이미 있으면 false). */
export function grantSkinUnlock(id: string): boolean {
  const d = read();
  if (d.skins.indexOf(id) >= 0) return false;
  d.skins.push(id);
  noteGranted('skinUnlock'); // read() 가 같은 캐시를 돌려주므로 write 는 여기서 한 번 난다
  return true;
}

/** 테스트 전용 — 모듈 상태와 저장본을 «둘 다» 비운다. ?debug=1 에서만 노출한다. */
export function __resetRewardStoreForTest(): void {
  cache = null;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
