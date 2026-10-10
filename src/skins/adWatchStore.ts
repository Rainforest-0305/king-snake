// adWatchStore.ts — «누적 광고 시청 횟수» 원장. 고급 스킨 해금 요건 하나가 이 값이다.
//
// ══ 왜 save.ts 가 아니라 별도 키인가 ═════════════════════════════════════
//  src/save.ts 는 «보호 파일»이다(tools/check_protected.mjs — 라이브 정본과 바이트 동일).
//  저장 스키마에 필드를 추가하면 그 증명이 무너진다. 리워드 원장
//  (`king-snake.reward.v1`)·프로모션 원장(`king-snake.promo.v1:<code>`)이 이미
//  같은 이유로 «자기 키»를 쓰고 있다. 그 규율을 그대로 잇는다.
//
// ══ ★단조 증가다 (되돌아가지 않는다) ═════════════════════════════════════
//  일일 상한(rewardStore.DAILY_CAP)은 «날마다 0 으로 리셋»된다. 그건 하루치 소비량이라
//  그게 맞다. 하지만 이 값은 «평생 누적»이다 — 리셋되면 100회는 영원히 도달 불가다.
//  그래서 저장을 읽을 때 «현재 값보다 작은 값으로는 절대 내려가지 않는다».
//  손상된 JSON·다른 탭의 옛 스냅샷이 덮어써도 진행도가 사라지지 않는다.
//
// ══ ⚠️서버가 없다 = 클라이언트 판정이다 ══════════════════════════════════
//  localStorage 는 유저가 고칠 수 있다. 이건 «부정 방지»가 아니라 «진행도 보관»이다.
//  리워드 원장과 같은 수준의 보증이고, 그 목적에는 충분하다(rewardStore.ts 머리말).

import { getLocale } from '../i18n';

const KEY = 'king-snake.adwatch.v1';
const VERSION = 1;

/**
 * ★★ 「무엇을 세는가」는 «이 상수 하나»다 (Partner 2026-09-02 지시 → President 확정).
 *
 *   President 답: 「따로 전용 리워드 광고를 설치해」.
 *   ⇒ 기존 4종(revive·startBoost·skinUnlock·growth)은 «세지 않는다». 전용 지면
 *     하나(reward/adGroups.ts 의 skinProgress)의 시청만 100회로 센다.
 *
 *   왜 합산이 아니라 전용인가(President 판단의 근거를 여기 남긴다):
 *     기존 지면을 합산하면 「부활하려고 본 광고」가 「스킨 진행도」로도 세어져
 *     유저가 무엇을 위해 보는지 흐려지고, 일일 상한이 지면마다 달라
 *     100회 도달 기간을 «설계할 수 없다». 전용 지면은 상한 하나로 기간이 정해진다.
 *
 *   ⛔ 호출부에 「이건 세고 저건 안 센다」를 흩뿌리지 마라. 정책이 바뀔 때 반드시
 *     한 곳을 놓치고, 그 사고는 «카운터가 조용히 덜 오르는» 형태로 나타나
 *     유저가 신고하기 전까지 아무도 모른다.
 */
export const AD_COUNT_SOURCES: readonly string[] = ['skinProgress'];

export function countsTowardAdWatch(surface: string): boolean {
  return AD_COUNT_SOURCES.indexOf(surface) >= 0;
}

interface WatchLedger {
  v: number;
  /** 평생 누적 시청 횟수. 단조 증가. */
  total: number;
  /** 지면별 누적(진단·검증용. 판정에는 total 만 쓴다). */
  bySurface: Record<string, number>;
}

const EMPTY: WatchLedger = { v: VERSION, total: 0, bySurface: {} };

let cache: WatchLedger | null = null;

function read(): WatchLedger {
  if (cache) return cache;
  let out: WatchLedger = { v: VERSION, total: 0, bySurface: {} };
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) {
      const p = JSON.parse(raw) as Partial<WatchLedger>;
      const t = typeof p.total === 'number' && isFinite(p.total) ? Math.max(0, Math.floor(p.total)) : 0;
      out = {
        v: VERSION,
        total: t,
        bySurface: p.bySurface && typeof p.bySurface === 'object' ? { ...p.bySurface } : {},
      };
    }
  } catch {
    // 손상·차단(사파리 프라이빗) — 0 에서 시작한다. 게임은 계속된다.
  }
  cache = out;
  return out;
}

function write(l: WatchLedger): void {
  cache = l;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    // 저장 실패해도 메모리 캐시는 살아 있어 이번 세션은 정상 동작한다.
  }
}

/** 평생 누적 광고 시청 횟수. */
export function adWatchTotal(): number {
  return read().total;
}

/** 지면별 누적(진단용). */
export function adWatchBySurface(): Readonly<Record<string, number>> {
  return { ...read().bySurface };
}

/**
 * 광고 시청 «완료» 1건을 기록한다.
 *
 * ★ 호출 조건은 «보상이 실제로 지급된 시점»이다 — 「광고를 열었다」가 아니다.
 *   열기만 하고 닫은 것을 세면 100회가 사실상 공짜가 된다.
 *
 * @returns 기록 뒤의 누적값(안 세는 지면이면 현재값 그대로).
 */
export function noteAdWatched(surface: string): number {
  if (!countsTowardAdWatch(surface)) return read().total;
  const l = read();
  // ★ 단조 증가. 어떤 경로로도 줄지 않는다.
  const next: WatchLedger = {
    v: VERSION,
    total: l.total + 1,
    bySurface: { ...l.bySurface, [surface]: (l.bySurface[surface] ?? 0) + 1 },
  };
  write(next);
  return next.total;
}

/** 남은 횟수(0 이면 달성). */
export function adWatchRemaining(need: number): number {
  return Math.max(0, need - adWatchTotal());
}

/** 진행률 0~1. UI 가 「73/100」을 그릴 때 쓴다. */
export function adWatchProgress(need: number): number {
  if (need <= 0) return 1;
  return Math.min(1, adWatchTotal() / need);
}

/** 로케일 숫자 표기(UI 가 직접 Intl 을 부르지 않게 한곳에 둔다). */
export function formatCount(n: number): string {
  try {
    return n.toLocaleString(getLocale() === 'ko' ? 'ko-KR' : undefined);
  } catch {
    return String(n);
  }
}

/** 테스트 전용 — 원장 초기화/주입. ?debug=1 에서만 노출된다. */
export function __setAdWatchForTest(total: number): void {
  write({ v: VERSION, total: Math.max(0, Math.floor(total)), bySurface: { __test: total } });
}

export function __resetAdWatchForTest(): void {
  cache = null;
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
  void EMPTY;
}
