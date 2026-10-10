// adSdk.ts — 앱스인토스 광고 SDK 로의 «유일한» 통로.
//
// ═══ 이 파일이 존재하는 이유 세 가지 ═══════════════════════════════════════
//
// ① ★«동적 import» 다. static import 가 아니다 — 이유가 측정돼 있다.
//
//    이 게임의 dist/ 는 «세 곳»에 나간다: 앱스인토스(.ait) · GitHub Pages ·
//    MS Store(PWABuilder/MSIX). 그런데 스토어 제출 서류가 이렇게 신고돼 있다:
//      store/MSSTORE_제출메모.txt:88  「제한 없는 인터넷 접근  없음  실행 중 네트워크 요청 0건(실측)」
//      store/MSSTORE_제출메모.txt:90  「광고 표시  없음  광고 SDK·배너 0건」
//      vite.config.ts 주석            「번들에 fetch( 호출을 남겨 「네트워크 전송 코드」로
//                                       읽히는 것을 피한다」
//
//    [실측 2026-08-25, 이 프로젝트에서 직접 빌드해 grep]
//      static import 로 SDK 를 끌면  → 메인 번들 92.23 kB → 108.02 kB (+15.8 kB)
//                                      그리고 «메인 번들 안»에 fetch( 3건 +
//                                      https://static.toss.im 문자열이 박힌다.
//      dynamic import 로 끌면        → 메인 번들 92.23 kB → 93.78 kB (+1.5 kB, preload 헬퍼)
//                                      SDK 는 별도 청크(27.1 kB)로 «분리»되고
//                                      fetch( / static.toss.im 은 «전부 그 청크 안»에 있다.
//                                      메인 번들 네트워크 참조 = 0건 (baseline 과 동일).
//
//    ⇒ 토스 밖(Pages·MS Store)에서는 isInToss() 가 false 라 이 청크를 «요청조차 안 한다».
//      메인 번들은 baseline 과 같이 깨끗하다. 60fps 예산에도 유리하다(파싱 15.8kB 절약).
//
//    ⛔ 「static import 가 더 단순하니 바꾸자」로 되돌리지 마라. 되돌리는 순간
//      MS Store 신고서 3종(제출메모·manifest description·privacy.html)이 «거짓»이 된다.
//      게임 4종(네온·스모·프리즘·피고지고)이 static 인 것은 그쪽이 «AIT 전용»이라
//      스토어 신고서가 아예 없기 때문이다. 우리와 조건이 다르다.
//      ※ 땅따먹기(territory-clash)는 같은 문제를 vite 플러그인(tc-toss-web-shim)으로
//        풀었다. 여기선 못 쓴다 — vite.config.ts 는 이 레인의 소유 파일이 아니다.
//
// ② 테스트 이음매(seam). 운영 광고 ID 를 로컬에서 «렌더하는 것은 계정 중단 사유»다
//    (광고 핸드북 §2-10). 그래서 로컬 검증은 이 파일의 «주입 스텁»으로만 한다.
//    주입점을 여기 «하나»로 모아, interstitial.ts 의 로직(계수·빚·타임아웃·재시도)은
//    스텁이든 실물이든 «완전히 같은 코드»가 돈다. 이음매가 브릿지 경계에만 있다.
//
// ③ 절대 throw 하지 않는다. 광고 때문에 게임이 죽으면 안 된다.
//    bridge-core 는 브릿지가 없으면 그냥 throw 한다
//    ("ReactNativeWebView is not available in browser environment" 등).

/* ─────────────────────── 타입 — SDK 실측 시그니처 ───────────────────────
 * 출처: node_modules/@apps-in-toss/web-bridge/dist/index.d.ts L849~861
 *       node_modules/@apps-in-toss/types/dist/index.d.ts L309~352
 * ★ 두 함수의 «반환값은 구독 해지 함수»다 (`) => () => void`). 버리면 누수다.
 * ★ dist-web/index.d.ts 에서 grep 하면 «어떤 이름도 0건»이다 — 그 파일은
 *   `export * from` 두 줄짜리 «재수출 배럴»이다(87바이트). 이걸로 「웹 게임엔
 *   광고 API 가 없다」는 오보가 나 게임 4종 광고를 접을 뻔했다(핸드북 §1-4).
 *   양성대조: 같은 배럴에서 defineConfig 를 grep 해도 0건이다 — 검사기가 죽은 것이다.
 */

export interface LoadAdEvent {
  type: 'loaded';
}
/** show 쪽은 이벤트가 여러 종이다. 우리가 «끝»으로 취급하는 건 dismissed / failedToShow 둘뿐. */
export interface ShowAdEvent {
  type: 'clicked' | 'dismissed' | 'failedToShow' | 'impression' | 'show' | 'requested' | 'userEarnedReward';
}

export interface AdFn<E> {
  (args: {
    onEvent: (data: E) => void;
    onError: (err: unknown) => void;
    options?: { adGroupId: string };
  }): () => void;
  isSupported: () => boolean;
}

export interface AdSdk {
  loadFullScreenAd: AdFn<LoadAdEvent>;
  showFullScreenAd: AdFn<ShowAdEvent>;
  /** 네이티브 영속 저장소. 없으면 null — 그때는 localStorage 만 쓴다. */
  Storage: { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> } | null;
}

/* ─────────────────────────── 환경 판별 ─────────────────────────── */

interface TossNativeWindow {
  ReactNativeWebView?: { postMessage: (msg: string) => void };
  __GRANITE_NATIVE_EMITTER?: unknown;
}

/**
 * 토스 미니앱 WebView 안에서 돌고 있는가 (= 네이티브 브릿지를 쓸 수 있는가).
 *
 * ★ SDK 를 «import 하지 않고» 판정한다. 그래야 토스 밖에서 SDK 청크를
 *   «요청조차 안 하고» 끝낼 수 있다(위 ① 참조).
 * ★ 판정식은 네온 스레드/땅따먹기 src/toss/env.ts 의 검증된 것을 그대로 쓴다.
 *   두 조건을 «둘 다» 본다 — RN WebView 는 토스가 아닌 다른 앱에도 있을 수 있고,
 *   __GRANITE_NATIVE_EMITTER 가 없으면 브릿지 이벤트를 못 받는다.
 */
export function isInToss(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const w = window as unknown as TossNativeWindow;
    return typeof w.ReactNativeWebView?.postMessage === 'function' && w.__GRANITE_NATIVE_EMITTER != null;
  } catch {
    return false;
  }
}

/* ─────────────────────────── 지연 로드 ─────────────────────────── */

let injected: AdSdk | null = null;
let cached: AdSdk | null = null;
let inflight: Promise<AdSdk | null> | null = null;
/** 청크 로드가 실패했으면 «다시 시도하지 않는다». 실패한 import 는 보통 영구 실패다. */
let chunkFailed = false;

/**
 * 테스트 스텁 주입 / 해제. ★ main.ts 가 ?debug=1 일 때만 window 에 노출한다.
 *   운영 경로에서는 아무도 이 함수에 닿을 수 없다.
 */
export function __injectAdSdkForTest(sdk: AdSdk | null): void {
  injected = sdk;
  if (sdk) {
    cached = null;
    inflight = null;
    chunkFailed = false;
  }
}

/**
 * 이미 준비된 SDK 를 «동기»로 돌려준다. 없으면 null.
 * show() 는 adReady 가 true 일 때만 불리고, adReady 는 로드가 끝나야 서므로
 * 그 경로에서는 항상 non-null 이다. 그래도 null 을 «정상 값»으로 다룬다.
 */
export function peekAdSdk(): AdSdk | null {
  return injected ?? cached;
}

/**
 * SDK 를 확보한다. ★ 절대 reject 하지 않는다 — 실패는 null 로 표현한다.
 *
 * 토스 밖이면 «청크를 요청하지 않고» 즉시 null 이다. 이게 이 파일의 핵심이다.
 */
export function ensureAdSdk(): Promise<AdSdk | null> {
  if (injected) return Promise.resolve(injected);
  if (cached) return Promise.resolve(cached);
  if (chunkFailed) return Promise.resolve(null);
  if (!isInToss()) return Promise.resolve(null);
  if (inflight) return inflight;

  inflight = import('@apps-in-toss/web-framework')
    .then((m) => {
      // 청크는 왔는데 이름이 없다면 SDK 버전이 바뀐 것이다. 「있다」고 가정하지 않는다.
      const load = (m as unknown as { loadFullScreenAd?: AdFn<LoadAdEvent> }).loadFullScreenAd;
      const show = (m as unknown as { showFullScreenAd?: AdFn<ShowAdEvent> }).showFullScreenAd;
      if (typeof load !== 'function' || typeof show !== 'function') {
        chunkFailed = true;
        return null;
      }
      const store = (m as unknown as { Storage?: AdSdk['Storage'] }).Storage ?? null;
      cached = { loadFullScreenAd: load, showFullScreenAd: show, Storage: store };
      return cached;
    })
    .catch(() => {
      // 청크 404 · 네트워크 끊김 · 파싱 실패. 광고만 포기하고 게임은 계속된다.
      chunkFailed = true;
      return null;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** 테스트 전용 — 모듈 상태 초기화. */
export function __resetAdSdkForTest(): void {
  injected = null;
  cached = null;
  inflight = null;
  chunkFailed = false;
}
