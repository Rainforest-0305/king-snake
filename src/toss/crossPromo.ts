// crossPromo.ts — 「머니 리그」 교차추천 카드의 «하루 1회» 원장 (2026-09-10 레인 A · 2주 실험).
//
// ══ 규칙 (공통 지시서 §5) ═══════════════════════════════════════════════════
//  · 결과(사망) 화면에 하루 1회. 닫기 가능. 그날 이미 보였으면 안 보인다.
//  · 「하루」의 기준은 **KST 날짜**다(아래 kstDayKey — 기기 시간대와 무관). 근거는 그 함수 주석.
//  · 노출일은 «보인 순간»에 기록한다(닫았는지와 무관). 클릭은 횟수만 남긴다(개인정보 0).
//  · 열기 = openUrl('intoss://moneyleague') (toss/openUrl.ts). 토스 밖에서는 카드를 그리지 않는다.
//  · 계측 파이프가 없으므로 로컬 기록만(노출일·클릭 수). 「순사용자 증가」라고 쓰지 않는다.
//
// 저장: 새 키 `king-snake.xpromo.v1`. save.ts 무접촉. 절대 throw 하지 않는다.

import { isInToss } from '../ads/adSdk';
import { openUrl, type OpenUrlOutcome } from './openUrl';

/**
 * 「하루」의 기준 = **KST 날짜**(2026-09-10 Codex 적대적 리뷰 지적 9로 정정).
 *
 * ⛔`rewardStore.localDayKey()`(기기 현지 날짜)를 쓰면 안 된다. 기기 시간대를 미국으로 둔 사용자는
 *   KST 9월 11일 00:30 에도 현지 날짜가 9월 10일이라, KST 자정 갱신을 놓치고 같은 KST 날짜 안에
 *   카드가 다시 뜰 수 있다(실측 재현). 리워드 «일일 상한»은 기존대로 현지 날짜다 — 그건 라이브에서
 *   이미 그렇게 돌고 있는 값이라 이 레인이 바꾸지 않는다. 여기서만 KST 로 못 박는다.
 * ★UTC 기준으로 9시간을 더해 «시간대 라이브러리 없이» 계산한다(웹폰트·외부 의존 0 규율과 같은 이유).
 */
export function kstDayKey(nowMs: number = Date.now()): string {
  const d = new Date(nowMs + 9 * 60 * 60 * 1000);
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return d.getUTCFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

/** 머니 리그 미니앱 딥링크(Partner 확정값 — 글자 그대로). */
export const MONEY_LEAGUE_URL = 'intoss://moneyleague';

const KEY = 'king-snake.xpromo.v1';

interface XpromoRecord {
  /** 마지막으로 카드가 «보인» 날. */
  shownDay?: string;
  /** 누적 노출 수(진단). */
  shows?: number;
  /** 누적 열기 탭 수(진단). */
  clicks?: number;
}

let cache: XpromoRecord | null = null;

function read(): XpromoRecord {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw) as XpromoRecord;
      if (o && typeof o === 'object') {
        cache = o;
        return cache;
      }
    }
  } catch {
    /* 깨진 기록 = 없는 것 */
  }
  cache = {};
  return cache;
}

function write(): void {
  if (!cache) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* quota / private mode */
  }
}

/** 오늘 결과 화면에 카드를 «띄워도 되는가». 토스 안 + 오늘 아직 안 보임. */
export function canShowCrossPromo(): boolean {
  if (!isInToss()) return false;
  return read().shownDay !== kstDayKey();
}

/** 카드를 «띄웠다» — 오늘 날짜를 기록한다(닫기·열기와 무관). */
export function noteCrossPromoShown(): void {
  const d = read();
  d.shownDay = kstDayKey();
  d.shows = (typeof d.shows === 'number' && Number.isFinite(d.shows) ? d.shows : 0) + 1;
  write();
}

/**
 * 「열기」 — 클릭 수를 남기고 딥링크를 연다.
 * @returns 'ok' | 'failed' | 'unknown'. ★'unknown'(4초 무응답)은 실패가 «아니다» — 앱이 열려서
 *   우리 WebView 가 멈춘 것일 수 있다. UI 는 'failed' 일 때만 실패 문구를 보인다(openUrl.ts 주석).
 */
export async function openCrossPromo(): Promise<OpenUrlOutcome> {
  const d = read();
  d.clicks = (typeof d.clicks === 'number' && Number.isFinite(d.clicks) ? d.clicks : 0) + 1;
  write();
  return openUrl(MONEY_LEAGUE_URL);
}

/** 진단 스냅샷(?debug=1). */
export function crossPromoSnapshot(): { shownDay: string | null; shows: number; clicks: number; today: string } {
  const d = read();
  return {
    shownDay: d.shownDay ?? null,
    shows: d.shows ?? 0,
    clicks: d.clicks ?? 0,
    today: kstDayKey(),
  };
}

/** 테스트 전용. */
export function __resetCrossPromoForTest(): void {
  cache = null;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
