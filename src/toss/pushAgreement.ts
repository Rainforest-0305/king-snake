// pushAgreement.ts — 토스 푸시 알림 동의 «배선» (2026-09-10 레인 A · President 「푸시 개통」).
//
// ══ 정본 = 머니 리그 -32 src/toss/pushAgreement.ts 를 «그대로 이식» ══════════════════════
//  다른 것은 셋뿐이다: ① React 훅이 없다(이 게임은 DOM 셸) → 리스너 집합 + 스냅샷 함수
//  ② 저장 키 `king-snake.push.v1` ③ SDK 통로가 toss/pushBridge.ts(adSdk.ts 가 보호 파일이라).
//
// ══ 구조 ══════════════════════════════════════════════════════════════════
//  requestNotificationAgreement 하나로 동의창을 «띄우는 것»까지만 한다. 무엇을 언제 보내는지는
//  콘솔의 기능성 정기 발송(templateCode = 아래 상수)이 정본이다 — 매일 20:30 「일일 충전」.
//  ⛔ SDK 에 동의 «철회»·«상태 조회» API 가 없다 → 앱 안에 끄기 스위치를 두지 않는다(거짓 스위치).
//    끄는 길은 토스 앱 알림 설정이고, 그 사실을 문구(tossText.pushHint)로 그대로 말한다.
//    켜기 재탭은 'alreadyAgreed' 로 복구된다(저장소를 잃어도 다시 누르면 «켜짐»).
//
// ══ 저장 규율 ══════════════════════════════════════════════════════════════
//  새 키 하나만 «추가». king-snake.save(보호)·king-snake.reward.v1 무접촉.
//  localStorage 에 즉시 쓰고 네이티브 Storage 에 미러(interstitial.ts 의 카운터와 같은 이유 —
//  미니앱 WebView 의 localStorage 는 영속을 보장하지 않는다). 부팅 때 둘을 읽어 «더 최신»을 쓴다.
//
// ══ 토스 밖 ════════════════════════════════════════════════════════════════
//  itch.io·GitHub Pages·MS Store 경로에서는 브릿지가 없다 ⇒ availability='unavailable' 이고
//  설정 행·안내 카드가 «통째로» 그려지지 않는다(빈 자리 0 — 리워드 버튼과 같은 규칙).

import { isInToss } from '../ads/adSdk';
import { ensurePushSdk, type NotificationAgreementResult } from './pushBridge';

/** 콘솔 기능성 정기 발송의 «발송 코드». 콘솔 값과 반드시 같아야 한다(글자 하나 다르면 동의창이 안 뜬다). */
export const PUSH_TEMPLATE_CODE = '__PUSH_TEMPLATE_CODE__';

/** 이 기기의 동의 기록 + 안내 카드 닫음 기록. 세이브 «밖». */
export const PUSH_KEY = 'king-snake.push.v1';

interface PushRecord {
  /** 동의 완료('newAgreement' | 'alreadyAgreed')를 이 기기에서 확인한 시각(ms) */
  agreedAt?: number;
  /** 안내 카드를 닫은 시각(ms). 닫으면 다시 띄우지 않는다(설정 행에서 언제든 켤 수 있다) */
  dismissedAt?: number;
  /** 동의창에서 거부한 시각(ms). 안내는 접고, 설정 행은 「다시 켜기」 */
  rejectedAt?: number;
}

export type PushAvailability =
  /** 토스 밖 — 행 자체를 그리지 않는다 */
  | 'unavailable'
  /** 동의 가능(아직 안 함 또는 상태 모름) */
  | 'ready'
  /** 이 기기에서 동의 완료로 기록됨 */
  | 'agreed'
  /** 동의창에서 거부. 다시 시도 가능 */
  | 'rejected';

export interface PushState {
  availability: PushAvailability;
  /** 설정 행·안내 카드를 그릴지. 토스 안에서만 true */
  available: boolean;
  enabled: boolean;
  /** 동의창 호출 진행 중(중복 호출 방지) */
  busy: boolean;
  /** 안내 카드를 보일지: 토스 안 + 미동의 + 미거부 + 안 닫음 */
  nudge: boolean;
  /** 마지막 오류(있으면). 조용히 삼키지 않는다 */
  error: string;
  /** 저장 기록을 읽었는가(첫 그리기 전 깜빡임 방지용 — 안 읽었으면 안내를 아직 안 띄운다) */
  hydrated: boolean;
}

let record: PushRecord = {};
let hydrated = false;
let hydrating: Promise<void> | null = null;
let busy = false;
let error = '';

const listeners = new Set<() => void>();

function localGet(): PushRecord | null {
  try {
    const raw = window.localStorage.getItem(PUSH_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as PushRecord;
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

function localSet(r: PushRecord): void {
  try {
    window.localStorage.setItem(PUSH_KEY, JSON.stringify(r));
  } catch {
    /* quota / private mode */
  }
}

function persist(): void {
  localSet(record);
  // 네이티브 미러 — fire-and-forget. 실패해도 localStorage 는 이미 썼다.
  void ensurePushSdk().then((sdk) => {
    if (!sdk?.Storage) return;
    return sdk.Storage.setItem(PUSH_KEY, JSON.stringify(record)).catch(() => undefined);
  }).catch(() => undefined);
}

function emit(): void {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* 한 리스너의 예외가 다른 리스너를 막지 않는다 */
    }
  });
}

/**
 * 기록 병합 — «필드별로 더 최신»을 고른다.
 *
 * ★2026-09-10(Codex 적대적 리뷰 지적 7)로 «통째로 고르기»에서 바꿨다.
 *   옛 구현은 두 기록 중 «객체 하나»를 골랐다. 그래서 이런 순서에서 사고가 났다(실측 재현):
 *     ① 부팅 — 네이티브 저장소 읽기가 느리게 진행 중
 *     ② 유저가 「받기」를 눌러 동의 완료 → 메모리 record.agreedAt 이 «지금»으로 섬
 *     ③ ①의 «빈 응답»이 뒤늦게 도착 → record 를 그걸로 «덮어씀» → enabled true→false, 안내 카드 부활
 *   필드별 최대값으로 합치면 늦게 도착한 옛 응답이 새 사실을 지우지 못한다.
 * ⛔거부(rejectedAt)와 동의(agreedAt)는 «서로를 지우는» 값이라 그대로 두면 둘 다 남을 수 있다 —
 *   그때는 「더 나중에 일어난 쪽」이 이긴다(아래 마지막 줄).
 */
function mergeRecords(...list: (PushRecord | null | undefined)[]): PushRecord {
  const out: PushRecord = {};
  const max = (a: number | undefined, b: number | undefined): number | undefined => {
    if (typeof a !== 'number' || !Number.isFinite(a)) return typeof b === 'number' && Number.isFinite(b) ? b : undefined;
    if (typeof b !== 'number' || !Number.isFinite(b)) return a;
    return Math.max(a, b);
  };
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    out.agreedAt = max(out.agreedAt, r.agreedAt);
    out.dismissedAt = max(out.dismissedAt, r.dismissedAt);
    out.rejectedAt = max(out.rejectedAt, r.rejectedAt);
  }
  // 동의·거부가 둘 다 있으면 «나중 것»만 남긴다. 상태가 둘일 수는 없다.
  if (out.agreedAt && out.rejectedAt) {
    if (out.agreedAt >= out.rejectedAt) out.rejectedAt = undefined;
    else out.agreedAt = undefined;
  }
  return out;
}

/** 부팅 후 1회. 저장된 기록을 읽는다(실패해도 무해 — 다시 누르면 'alreadyAgreed' 로 복구). */
export function hydratePushState(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydrating) return hydrating;
  hydrating = (async () => {
    try {
      const local = localGet();
      let native: PushRecord | null = null;
      if (isInToss()) {
        const sdk = await ensurePushSdk();
        if (sdk?.Storage) {
          const raw = await sdk.Storage.getItem(PUSH_KEY).catch(() => null);
          if (raw) {
            try {
              const o = JSON.parse(raw) as PushRecord;
              if (o && typeof o === 'object') native = o;
            } catch {
              /* 깨진 미러는 없는 것으로 */
            }
          }
        }
      }
      /* ★«현재 메모리 기록»도 함께 합친다 — 읽는 동안 유저가 동의했을 수 있다(위 mergeRecords 주석). */
      record = mergeRecords(local, native, record);
    } catch {
      /* 읽기 실패 = 미동의로 보인다. 켜면 복구된다 */
    } finally {
      hydrated = true;
      emit();
    }
  })();
  return hydrating;
}

export function getPushState(): PushState {
  const available = isInToss();
  const availability: PushAvailability = !available
    ? 'unavailable'
    : record.agreedAt
      ? 'agreed'
      : record.rejectedAt
        ? 'rejected'
        : 'ready';
  return {
    availability,
    available,
    enabled: availability === 'agreed',
    busy,
    nudge: available && hydrated && availability === 'ready' && !record.dismissedAt,
    error,
    hydrated,
  };
}

/** 상태가 바뀔 때 알림을 받는다. 첫 구독에서 저장 기록을 읽어 온다. @returns 해제 함수 */
export function subscribePush(listener: () => void): () => void {
  listeners.add(listener);
  void hydratePushState();
  return () => {
    listeners.delete(listener);
  };
}

function describeError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`.slice(0, 120);
  if (typeof e === 'string') return e.slice(0, 120);
  try {
    return JSON.stringify(e).slice(0, 120);
  } catch {
    return String(e).slice(0, 120);
  }
}

/**
 * 알림 켜기 = 토스 알림 동의창 호출.
 * 절대 throw 하지 않는다. 결과가 어느 쪽이든 브릿지 콜백을 해제한다.
 * ⛔타임아웃을 두지 않는다 — 동의창은 «사용자가 읽고 누르는» UI 라 몇 분이 걸려도 정상이다.
 *   대신 busy 로 중복 호출만 막는다.
 */
export function enablePush(): Promise<PushState> {
  if (!isInToss()) {
    error = 'not in toss';
    emit();
    return Promise.resolve(getPushState());
  }
  if (busy) return Promise.resolve(getPushState());
  busy = true;
  error = '';
  emit();

  return new Promise<PushState>((resolve) => {
    let settled = false;
    let cleanup: (() => void) | undefined;
    const finish = (patch: PushRecord | null, err = ''): void => {
      if (settled) return;
      settled = true;
      /* ★cleanup 이 «아직 없을» 수 있다 — SDK 가 반환 «전»에 onEvent 를 동기로 부르는 경우다
         (2026-09-10 Codex 적대적 리뷰 지적 8: 그때 해제가 0회였다). 그 경로는 아래 호출부에서
         「반환값을 받은 직후 이미 끝났으면 즉시 해제」로 마저 막는다. */
      try {
        cleanup?.();
      } catch {
        /* 해제 실패는 결과와 무관 */
      }
      if (patch) {
        record = { ...record, ...patch };
        persist();
      }
      busy = false;
      error = err;
      emit();
      resolve(getPushState());
    };
    void ensurePushSdk().then((sdk) => {
      if (settled) return;
      if (!sdk) {
        finish(null, 'sdk unavailable');
        return;
      }
      try {
        cleanup = sdk.requestNotificationAgreement({
          options: { templateCode: PUSH_TEMPLATE_CODE },
          onEvent: (result: { type: NotificationAgreementResult }) => {
            if (result?.type === 'agreementRejected') {
              finish({ rejectedAt: Date.now(), agreedAt: undefined });
              return;
            }
            /* 'newAgreement' | 'alreadyAgreed' — 둘 다 켜짐 */
            finish({ agreedAt: Date.now(), rejectedAt: undefined });
          },
          onError: (e: unknown) => {
            console.warn('[push] requestNotificationAgreement failed:', e);
            finish(null, describeError(e));
          },
        });
        /* ★동기 콜백 경로 — 위 onEvent 가 «반환 전»에 불렸으면 finish 는 cleanup 을 못 봤다.
           지금 받은 해제 함수를 그 자리에서 부른다(리스너를 남기지 않는다). */
        if (settled) {
          try {
            cleanup?.();
          } catch {
            /* 해제 실패는 결과와 무관 */
          }
          cleanup = undefined;
        }
      } catch (e) {
        console.warn('[push] requestNotificationAgreement threw:', e);
        finish(null, describeError(e));
      }
    }).catch((e) => finish(null, describeError(e)));
  });
}

/** 안내 카드 닫기. 설정 행은 그대로 남는다. */
export function dismissPushNudge(): void {
  record = { ...record, dismissedAt: Date.now() };
  persist();
  emit();
}

/** 테스트 전용 — 기록·상태를 비운다. ?debug=1 에서만 노출한다. */
export function __resetPushForTest(): void {
  record = {};
  hydrated = false;
  hydrating = null;
  busy = false;
  error = '';
  try {
    window.localStorage.removeItem(PUSH_KEY);
  } catch {
    /* noop */
  }
  emit();
}

/*
 * ★끄기 버튼은 «없다». 토스 SDK 에 동의 철회 API 가 없다(export 목록 실측 · 켜기 하나뿐).
 *   앱 안에 「끄기」를 두면 로컬 표시만 바뀌고 알림은 계속 온다 = 약속을 안 지키는 스위치다.
 *   ⇒ 끄는 길은 토스 앱 알림 설정이고, 그 사실을 문구로 그대로 말한다.
 */
