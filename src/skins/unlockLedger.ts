// unlockLedger.ts — «한 번 열린 스킨은 다시 잠기지 않는다»를 보장하는 원장.
//
// ══ 왜 이 파일이 필요한가 (2026-09-03, President 지시 ①) ═══════════════════
//  President 가 해금 문턱을 올리라고 했다:
//      블랙맘바 12,000 → 30,000 / 킹코브라 18,000 → 50,000 / 알비노 26,000 → 70,000
//
//  그런데 `src/save.ts` 머리말에 이렇게 적혀 있다:
//      「해금 스킨 목록은 «저장하지 않는다» — bestScore 에서 유도된다(skins.ts).」
//  즉 보유 판정이 «매 프레임 재계산»이다. 문턱만 올리면
//      최고점 20,847 로 블랙맘바를 딴 라이브 유저 → 20,847 < 30,000 → «회수»
//  가 실제로 일어난다. 우려가 아니라 코드가 그렇게 돼 있다(실측 확인).
//
//  ⇒ 그래서 「이미 열렸다」는 «사실»을 저장한다. 유도값이 아니라 사실이므로
//    문턱이 앞으로 몇 번 더 바뀌어도 회수가 구조적으로 불가능해진다.
//
// ══ 왜 save.ts 가 아니라 별도 키인가 ═════════════════════════════════════
//  save.ts 는 «보호 파일»이다(tools/check_protected.mjs — 라이브 정본과 바이트 동일).
//  스키마에 필드를 더하면 그 증명이 무너지고, 더 나쁜 것은 `loadSave()` 가
//  `parsed.v !== SAVE_VERSION` 이면 «저장본을 통째로 지운다»는 점이다.
//  버전을 올리는 순간 라이브 유저의 최고점·통계·닉네임이 전멸한다.
//  리워드 원장(`king-snake.reward.v1`)·광고시청 원장(`king-snake.adwatch.v1`)·
//  프로모션 원장(`king-snake.promo.v1:<code>`)이 이미 같은 이유로 자기 키를 쓴다.
//
// ══ ★씨 뿌리기(seed) — 이게 회수 방지의 «전부»다 ══════════════════════════
//  「새 문턱 ‖ 원장」만으로는 «못 막는다». 원장이 비어 있으면 20,847 유저는
//  그대로 잠긴다. 그래서 이 빌드가 그 기기에서 «처음 실행되는 순간» 딱 한 번,
//  «옛 문턱»(LEGACY_UNLOCK_SCORE — -23 라이브 값)으로 bestScore 를 평가해
//  그때 열려 있던 스킨을 원장에 적립한다. 그 뒤부터는 새 문턱으로 판정한다.
//
//      최종 보유 = 원장에 적립됨  OR  현재 문턱 충족
//
//  ⚠씨는 «한 번만» 뿌린다(seeded 플래그). 두 번 뿌리면 새 문턱을 못 넘은
//  유저가 나중에 옛 문턱만 넘어도 열리는 «뒷문»이 생긴다.
//
// ══ ★단조 증가 ═══════════════════════════════════════════════════════════
//  어떤 경로로도 항목이 «빠지지 않는다». 저장본이 손상돼 파싱에 실패하면
//  빈 원장이 아니라 «메모리 캐시»를 유지한다. 다른 탭의 옛 스냅샷이 덮어써도
//  read 가 합집합을 취하므로 되돌아가지 않는다.
//
// ══ ⚠️서버가 없다 = 클라이언트 판정이다 ══════════════════════════════════
//  localStorage 는 유저가 고칠 수 있다. 이건 «부정 방지»가 아니라 «진행도 보관»이다
//  (adWatchStore.ts 머리말과 같은 수준의 보증이고, 그 목적에는 충분하다).

const KEY = 'king-snake.unlock.v1';
const VERSION = 1;

/**
 * ★★ «옛 문턱» 스냅샷 — 2026-09-02 라이브(-23)의 game/skins.ts 값 그대로.
 *
 *  ⛔ 이 표를 SKINS 에서 «유도하지 마라». 유도하면 문턱을 올리는 순간 이 표도
 *    같이 올라가서 씨 뿌리기가 «아무것도 적립하지 않는다» — 즉 회수 방지가
 *    조용히 죽는다. 죽어도 아무 오류가 안 난다는 점에서 최악의 형태다.
 *    (이것이 이 파일에서 유일하게 «손으로 박은» 숫자인 이유다.)
 *
 *  ⛔ 앞으로 문턱을 또 올릴 때 이 표를 갱신하지 «마라». 이건 -23 시점의 화석이고,
 *    -24 이후에 새로 딴 스킨은 recordUnlocks() 가 그때그때 원장에 적립한다.
 *    (씨 뿌리기는 «-23 에서 -24 로 넘어오는 그 한 번»만을 위한 것이다.)
 */
export const LEGACY_UNLOCK_SCORE: Readonly<Record<string, number>> = {
  corn: 0,
  greentree: 0,
  ballpython: 0,
  milk: 600,
  kingsnake: 1200,
  emerald: 2200,
  coral: 3600,
  sidewinder: 5500,
  rattlesnake: 8000,
  mamba: 12000,      // → 30,000 (President 2026-09-03)
  kingcobra: 18000,  // → 50,000
  albino: 26000,     // → 70,000
  rhinoviper: 100000, // 변경 없음(최고급). 판정 경로를 하나로 두려고 같은 원장에 넣는다.
  // bluecoral 은 «점수 경로가 없다»(unlockScore = Infinity). 아래 LEGACY_UNLOCK_ADS 가 본다.
};

/**
 * 옛 «광고 누적» 문턱 스냅샷. 최고급 2종 중 파란말레이산호뱀의 유일한 경로다.
 * 변경 계획은 없지만 원장 경로를 하나로 두라는 지시(2026-09-03)에 따라 함께 적립한다.
 */
export const LEGACY_UNLOCK_ADS: Readonly<Record<string, number>> = {
  bluecoral: 100,
};

/**
 * 적립 사유. 「점수로 열렸는가」와 「어떻게든 보유하는가」는 «다른 질문»이라
 * (game/skins.ts isSkinUnlocked 주석) 사유를 분리해 둔다. 섞으면 광고로 연 스킨이
 * 사망 시트에서 「점수로 새로 달성한 스킨」으로 축하된다.
 */
export type UnlockReason = 'score' | 'ads';

interface Ledger {
  v: number;
  /** 씨를 이미 뿌렸는가. 한 번 true 가 되면 되돌아가지 않는다. */
  seeded: boolean;
  seededAt: number;
  /** 점수 경로로 열린 스킨 id. */
  score: string[];
  /** 광고 누적 경로로 열린 스킨 id. */
  ads: string[];
}

function emptyLedger(): Ledger {
  return { v: VERSION, seeded: false, seededAt: 0, score: [], ads: [] };
}

let cache: Ledger | null = null;

function ids(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === 'string' && x.length > 0 && x.length <= 24 && out.indexOf(x) < 0) out.push(x);
  }
  return out;
}

/** 합집합. ★여기가 «단조 증가»의 구현이다 — 어느 쪽에서도 빼지 않는다. */
function union(a: readonly string[], b: readonly string[]): string[] {
  const out = a.slice();
  for (const x of b) if (out.indexOf(x) < 0) out.push(x);
  return out;
}

function read(): Ledger {
  let disk = emptyLedger();
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) {
      const p = JSON.parse(raw) as Partial<Ledger>;
      disk = {
        v: VERSION,
        seeded: p.seeded === true,
        seededAt: typeof p.seededAt === 'number' && isFinite(p.seededAt) ? p.seededAt : 0,
        score: ids(p.score),
        ads: ids(p.ads),
      };
    }
  } catch {
    // 손상·차단(사파리 프라이빗). ★빈 원장으로 «덮지 않는다» — 아래에서
    //   메모리 캐시와 합쳐지므로 이번 세션의 보유는 살아남는다.
    disk = cache ? { ...cache, score: cache.score.slice(), ads: cache.ads.slice() } : emptyLedger();
  }
  if (cache) {
    // 다른 탭이 옛 스냅샷을 덮어썼어도 되돌아가지 않는다.
    disk = {
      v: VERSION,
      seeded: disk.seeded || cache.seeded,
      seededAt: disk.seededAt || cache.seededAt,
      score: union(cache.score, disk.score),
      ads: union(cache.ads, disk.ads),
    };
  }
  cache = disk;
  return disk;
}

function write(l: Ledger): void {
  cache = l;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    // 저장 실패해도 메모리 캐시는 살아 있어 이번 세션은 정상 동작한다.
  }
}

/** 「점수 경로로 이미 열렸던 스킨인가」. game/skins.ts 가 이 함수를 주입받아 쓴다. */
export function isScoreLedgered(id: string): boolean {
  return read().score.indexOf(id) >= 0;
}

/** 「어떤 경로로든 원장에 적립돼 있는가」. */
export function isLedgered(id: string): boolean {
  const l = read();
  return l.score.indexOf(id) >= 0 || l.ads.indexOf(id) >= 0;
}

/** 진단·검증용 스냅샷(?debug=1). */
export function unlockLedgerSnapshot(): Readonly<Ledger> {
  const l = read();
  return { v: l.v, seeded: l.seeded, seededAt: l.seededAt, score: l.score.slice(), ads: l.ads.slice() };
}

/**
 * 해금 «사실»을 적립한다. 이미 있으면 아무 일도 하지 않는다(디스크 쓰기도 없다).
 * @returns 새로 적립된 id 목록.
 */
export function recordUnlocks(scoreIds: readonly string[], adIds: readonly string[] = []): string[] {
  const l = read();
  const nextScore = union(l.score, scoreIds);
  const nextAds = union(l.ads, adIds);
  if (nextScore.length === l.score.length && nextAds.length === l.ads.length) return [];
  const added: string[] = [];
  for (const x of nextScore) if (l.score.indexOf(x) < 0) added.push(x);
  for (const x of nextAds) if (l.ads.indexOf(x) < 0) added.push(x);
  write({ v: VERSION, seeded: l.seeded, seededAt: l.seededAt, score: nextScore, ads: nextAds });
  return added;
}

/**
 * ★★ 씨 뿌리기 — «옛 문턱»으로 이 기기의 보유 상태를 한 번 소급 적립한다.
 *
 * 호출 시점: 부팅 직후, 화면이 보유 여부를 «묻기 전». main.ts 가 부른다.
 * 두 번째 호출부터는 아무 일도 하지 않는다(seeded 플래그).
 *
 * @param bestScore 저장본의 최고 점수. 저장이 없으면 0 이 들어온다(신규 유저 → 문턱 0 인 3종만).
 * @param adTotal   누적 광고 시청 횟수.
 * @returns 무엇을 했는지(검증용).
 */
export function seedUnlockLedger(bestScore: number, adTotal: number): {
  ran: boolean; score: string[]; ads: string[];
} {
  const l = read();
  if (l.seeded) return { ran: false, score: [], ads: [] };

  const best = typeof bestScore === 'number' && isFinite(bestScore) ? Math.max(0, bestScore) : 0;
  const watched = typeof adTotal === 'number' && isFinite(adTotal) ? Math.max(0, adTotal) : 0;

  const score: string[] = [];
  for (const id of Object.keys(LEGACY_UNLOCK_SCORE)) {
    if (best >= LEGACY_UNLOCK_SCORE[id]) score.push(id);
  }
  const ads: string[] = [];
  for (const id of Object.keys(LEGACY_UNLOCK_ADS)) {
    if (watched >= LEGACY_UNLOCK_ADS[id]) ads.push(id);
  }

  write({
    v: VERSION,
    seeded: true,
    seededAt: Date.now(),
    score: union(l.score, score),
    ads: union(l.ads, ads),
  });
  return { ran: true, score, ads };
}

/** 테스트 전용 — 원장 초기화(?debug=1 에서만 노출). */
export function __resetUnlockLedgerForTest(): void {
  cache = null;
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

/** 테스트 전용 — 원장 주입(?debug=1 에서만 노출). */
export function __setUnlockLedgerForTest(
  scoreIds: readonly string[], adIds: readonly string[] = [], seeded = true,
): void {
  cache = null;
  write({ v: VERSION, seeded, seededAt: seeded ? Date.now() : 0, score: ids(scoreIds), ads: ids(adIds) });
}
