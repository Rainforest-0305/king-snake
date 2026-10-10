// carryStore.ts — 「이번 판 성장 이어받기」 원장 (2026-09-10 레인 A · 결과 화면 「이번 판 성장 2배」의 «뜻»).
//
// ══ 왜 이 보상이 필요했나 ═══════════════════════════════════════════════════
//  Codex 전략(2026-09-10): 「라운드 결과에서 "이번 판 성장분 2배 받기"를 선택형 리워드로 제공한다」.
//  그런데 이 게임에는 판을 넘어가는 «통화»가 없었다 — 판이 끝나면 질량은 START_MASS 로 돌아가고,
//  남는 것은 최고 기록·스킨 해금·광고 누적 횟수뿐이다. 「2배」가 거짓이 되지 않으려면 «배가 될
//  기본값»이 먼저 있어야 한다(Partner: 「가짜 보상 금지 · 광고 없이도 기본 보상」).
//  ⇒ 그래서 «이어받기»를 신설한다: 판이 «최종 사망»으로 끝나면 이번 판에 «키운 만큼»의 일부가
//    다음 판의 «시작 길이»로 이어진다(광고 없이, 누구나). 광고를 보면 그 몫이 «2배»가 된다.
//    보상이 실제로 게임을 바꾸는 값(다음 판 스폰 질량)이라 가짜가 아니고, 배가 될 기본값이 있어
//    「2배」라는 말이 참이다.
//
// ══ 규칙 ═══════════════════════════════════════════════════════════════════
//  growth = max(0, floor(마지막 질량) − floor(시작 질량))    ← 시작 질량은 부스트·이어받기를 «반영한 뒤» 값
//  base   = min(CARRY_CAP, floor(growth × CARRY_K))         ← 광고 없이 받는 몫
//  carry  = base × (2배권을 썼으면 2, 아니면 1)              ← 상한도 함께 2배(CARRY_CAP × 2)
//  다음 판 startRun: 스폰 질량 = START_MASS + carry. 시작 부스트(1.4배 «길이»)가 있으면 «그 위에» 곱한다.
//  이어받기는 «한 번» 소비된다(다음 판 시작). 소비되기 전에 판이 또 끝나면(있을 수 없지만) 덮어쓴다.
//
// ══ 상수의 근거 (2026-09-10, ★밸런스 상수는 [추정] — President 결정 대상) ═════════
//  START_MASS = 12 (config.ts). 시작 부스트 리워드는 질량 33(= 길이 1.4배, gameEffects.boostedStartMass).
//  봇 대리 실측(_PROGRESS.md 레인 5): 판 최고점 중앙값 ≈ 307 · p90 721 · p99 2039.
//    CARRY_K 0.10 · CARRY_CAP 50 → 중앙값 판(성장 ≈ 295) 이어받기 +29 → 시작 41(길이 ×1.53)
//                                  상한 판(성장 ≥ 500)  이어받기 +50 → 시작 62(길이 ×1.81)
//                                  2배(상한 100)          → 시작 112(길이 ×2.36) · 부스트까지 겹치면 ≈ 질량 235
//  ★기록 인플레이션은 «가산»이다(곱이 아니다): 최고 기록에 최대 +100 정도가 얹힐 뿐이라
//    스킨 문턱(600 … 70,000)·순위 공정성(레인 5 의 ×1.44 상한 논의)에 미치는 영향이 «상한 100 질량»으로 닫힌다.
//  ★시작 부스트(질량 33)를 잠식하지 않는다 — 부스트는 «길이 배수»라 이어받기 위에 그대로 곱해진다.
//
// ══ 저장 ═══════════════════════════════════════════════════════════════════
//  새 키 `king-snake.carry.v1` 하나. save.ts(보호)·king-snake.reward.v1 무접촉. 유실되면 «다음 판을 기본
//  질량으로 시작»할 뿐이라 localStorage 만 쓴다(광고 원장과 같은 판단 — 실돈 아님).
//  ⛔ 절대 throw 하지 않는다.

const KEY = 'king-snake.carry.v1';
const VERSION = 1;

/** 성장 중 다음 판으로 이어지는 비율. ★[추정] 밸런스 상수 — 위 머리말. */
export const CARRY_K = 0.1;
/** 광고 없이 받는 이어받기의 상한(질량). 2배권은 이 값의 2배까지. ★[추정]. */
export const CARRY_CAP = 50;
/** 2배권 배수. 「이번 판 성장 2배」의 그 2. */
export const CARRY_DOUBLE_K = 2;

export interface CarryRecord {
  v: number;
  /** 다음 판 시작에 얹을 질량. 0 = 없음. */
  mass: number;
  /** 광고 없이의 몫(2배 전). 화면이 「+N → +2N」을 그릴 때 쓴다. */
  base: number;
  /** 2배권을 썼는가. */
  doubled: boolean;
  /** 확정된 판의 일련번호(main.ts runSeq). 같은 판에서 두 번 확정되면 덮어쓴다. */
  runSeq: number;
  /** 확정 시각(ms). 진단용. */
  at: number;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clampMass(v: unknown, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.min(max, Math.max(0, Math.floor(v)));
}

let cache: CarryRecord | null = null;

function empty(): CarryRecord {
  return { v: VERSION, mass: 0, base: 0, doubled: false, runSeq: 0, at: 0 };
}

/** 저장본을 읽는다. 깨졌으면 «없음»으로 본다(게임을 막지 않는다). */
function read(): CarryRecord {
  if (cache) return cache;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    cache = empty();
    return cache;
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
    const doubled = parsed.doubled === true;
    // 상한을 «위로» 접는다 — 저장소를 손으로 고쳐도 상한 밖의 시작 질량은 나오지 않는다.
    d.base = clampMass(parsed.base, CARRY_CAP);
    d.mass = clampMass(parsed.mass, CARRY_CAP * (doubled ? CARRY_DOUBLE_K : 1));
    d.doubled = doubled;
    d.runSeq = clampMass(parsed.runSeq, 1e9);
    d.at = clampMass(parsed.at, Number.MAX_SAFE_INTEGER);
  }
  cache = d;
  return d;
}

function write(): void {
  if (!cache) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* quota / private mode — 이번 세션에서는 메모리 캐시가 값을 든다 */
  }
}

/** 이번 판에 키운 만큼에서 «광고 없이» 이어받는 몫. 순수 함수(검사기가 그대로 대조한다). */
export function carryBaseFor(growth: number): number {
  if (!Number.isFinite(growth) || growth <= 0) return 0;
  return Math.min(CARRY_CAP, Math.floor(growth * CARRY_K));
}

/** 판이 «최종» 사망으로 끝났다 — 이어받기를 확정한다. @returns 저장된 기록. */
export function commitCarry(growth: number, doubled: boolean, runSeq: number): CarryRecord {
  const base = carryBaseFor(growth);
  const mass = doubled ? Math.min(CARRY_CAP * CARRY_DOUBLE_K, base * CARRY_DOUBLE_K) : base;
  cache = { v: VERSION, mass, base, doubled, runSeq, at: Date.now() };
  write();
  return cache;
}

/** 지금 대기 중인 이어받기(다음 판이 소비할 값). 없으면 mass 0. */
export function pendingCarry(): CarryRecord {
  return read();
}

/**
 * 다음 판 시작이 «한 번» 소비한다. @returns 얹을 질량(0 이면 없음).
 * ★ 먼저 비우고 값을 돌려준다 — 적용 중 무슨 일이 나도 다음 판에 또 걸리지 않는다(부스트와 같은 규율).
 */
export function consumeCarry(): number {
  const d = read();
  const mass = d.mass;
  if (mass > 0 || d.base > 0) {
    cache = empty();
    write();
  }
  return mass;
}

/** 부활 등으로 «그 판이 아직 안 끝난» 것이 됐다 — 확정을 되돌린다(undoRunRecord 와 같은 규율). */
export function clearCarry(): void {
  const d = read();
  if (d.mass === 0 && d.base === 0) return;
  cache = empty();
  write();
}

/** 테스트 전용 — 모듈 상태와 저장본을 «둘 다» 비운다. ?debug=1 에서만 노출한다. */
export function __resetCarryForTest(): void {
  cache = null;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
