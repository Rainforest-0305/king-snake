// pushBridge.ts — 토스 푸시 알림 동의 SDK 로의 «유일한» 통로 (2026-09-10 레인 A).
//
// ══ 왜 adSdk.ts 에 안 얹나 ══════════════════════════════════════════════════
//  src/ads/adSdk.ts 는 «보호 파일»이다(tools/check_protected.mjs). 거기에 requestNotificationAgreement
//  를 더하면 라이브 정본과 바이트가 달라져 무접촉 증명이 무너진다. 그래서 «같은 규율»의 통로를
//  하나 더 둔다 — 동적 import · 토스 밖이면 import 자체 안 함(MS Store 신고서 「네트워크 요청 0건」
//  보존, adSdk.ts 머리말 ①) · 절대 throw 하지 않는다.
//  ★ 같은 모듈('@apps-in-toss/web-framework')을 import 하므로 Vite 는 청크를 «하나»로 묶는다 —
//    광고 SDK 가 이미 내려왔으면 여기서 추가 요청은 없다.
//
// ══ SDK 실측 (node_modules/@apps-in-toss/web-bridge/dist/index.d.ts 1109~1135) ══════════
//  requestNotificationAgreement({ options:{ templateCode }, onEvent, onError }): () => void
//    onEvent.type = 'newAgreement' | 'alreadyAgreed' | 'agreementRejected'
//    반환값 = 브릿지 콜백 «해제» 함수. 결과가 오면 반드시 부른다(안 부르면 리스너가 쌓인다).
//  ⛔ 이 함수 «하나»뿐이다 — 동의 상태 조회·철회 API 는 없다(export 목록 실측). 그래서 「동의했는지」는
//    이 기기 저장소에 적어 두고, 잃으면 다시 눌러 'alreadyAgreed' 로 복구한다(pushAgreement.ts).
//
// ══ templateCode ═══════════════════════════════════════════════════════════
//  콘솔 «기능성 정기 발송»의 발송 코드다(동의문 id 가 아니다). 콘솔 값과 글자 하나 다르면 동의창이
//  안 뜬다. 정본은 pushAgreement.ts 의 PUSH_TEMPLATE_CODE «한 곳».

import { isInToss } from '../ads/adSdk';

export type NotificationAgreementResult = 'newAgreement' | 'alreadyAgreed' | 'agreementRejected';

export interface RequestNotificationAgreementFn {
  (params: {
    options: { templateCode: string };
    onEvent: (result: { type: NotificationAgreementResult }) => void;
    onError: (error: unknown) => void | Promise<void>;
  }): () => void;
}

export interface PushSdk {
  requestNotificationAgreement: RequestNotificationAgreementFn;
  /** 네이티브 영속 저장소. 없으면 null — 그때는 localStorage 만 쓴다. */
  Storage: { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> } | null;
}

let injected: PushSdk | null = null;
let cached: PushSdk | null = null;
let inflight: Promise<PushSdk | null> | null = null;
/** 청크 로드가 실패했으면 «다시 시도하지 않는다»(adSdk.ts 와 같은 규율). */
let chunkFailed = false;

/** 테스트 주입점. ★ main.ts 가 ?debug=1 일 때만 노출한다. */
export function __injectPushSdkForTest(sdk: PushSdk | null): void {
  injected = sdk;
  if (sdk) {
    cached = null;
    inflight = null;
    chunkFailed = false;
  }
}

/** SDK 를 확보한다. ★ 절대 reject 하지 않는다 — 실패는 null. 토스 밖이면 청크를 «요청하지 않고» null. */
export function ensurePushSdk(): Promise<PushSdk | null> {
  if (injected) return Promise.resolve(injected);
  if (cached) return Promise.resolve(cached);
  if (chunkFailed) return Promise.resolve(null);
  if (!isInToss()) return Promise.resolve(null);
  if (inflight) return inflight;

  inflight = import('@apps-in-toss/web-framework')
    .then((m) => {
      const fn = (m as unknown as { requestNotificationAgreement?: RequestNotificationAgreementFn })
        .requestNotificationAgreement;
      if (typeof fn !== 'function') {
        // 청크는 왔는데 이름이 없다 = SDK 버전이 바뀐 것이다. 「있다」고 가정하지 않는다.
        chunkFailed = true;
        return null;
      }
      const store = (m as unknown as { Storage?: PushSdk['Storage'] }).Storage ?? null;
      cached = { requestNotificationAgreement: fn, Storage: store };
      return cached;
    })
    .catch(() => {
      chunkFailed = true;
      return null;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 테스트 전용 — 모듈 상태 초기화. */
export function __resetPushSdkForTest(): void {
  injected = null;
  cached = null;
  inflight = null;
  chunkFailed = false;
}
