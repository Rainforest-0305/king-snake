// openUrl.ts — 다른 미니앱·URL 열기 브릿지 (2026-09-10 레인 A · 「머니 리그」 교차추천).
//
// ══ 왜 bridge-core 에서 «직접» 만드는가 (promoBridge.ts ② 와 같은 사정) ═══════════════
//  [실측 2026-09-10, 이 프로젝트 node_modules]
//    @apps-in-toss/web-bridge@2.10.8 dist/bridge.js 에는 있다:
//      export var openURL = createAsyncBridge("openURL");
//    그런데 dist/index.d.ts 1143 의 최종 export 목록에 «없다» → web-framework 배럴로도 안 나온다.
//    (index.js 안의 openUrlOpener 는 광고 클릭스루 전용 래퍼다 — 스모 src/toss/bridge.ts 실측 주석.)
//  ⇒ createAsyncBridge('openURL') 은 method 문자열을 네이티브로 postMessage 하는 얇은 래퍼라
//    SDK 가 공식 export 했든 우리가 선언했든 런타임 동작이 100% 같다.
//  시그니처(dist/openURL.d.ts): openURL(url: string): Promise<any> — react-native Linking.openURL.
//
// ══ 규율 ══════════════════════════════════════════════════════════════════
//  · 동적 import — 토스 밖이면 import 자체가 없다(MS Store 신고서 「네트워크 요청 0건」 보존).
//  · ⛔ 네이티브가 응답을 안 주면 «영원히 pending»(bridge-core 에 타임아웃 없음) → withTimeout.
//  · 절대 throw 하지 않는다. 실패는 false.

import { isInToss } from '../ads/adSdk';

type OpenUrlFn = (url: string) => Promise<unknown>;

interface BridgeCore {
  createAsyncBridge?: (method: string) => OpenUrlFn;
}

let bridge: OpenUrlFn | null = null;
let inflight: Promise<OpenUrlFn | null> | null = null;
let chunkFailed = false;
let injected: OpenUrlFn | null = null;

/** 테스트 주입점. ★ main.ts 가 ?debug=1 일 때만 노출한다. */
export function __injectOpenUrlForTest(fn: OpenUrlFn | null): void {
  injected = fn;
  if (fn) {
    bridge = null;
    inflight = null;
    chunkFailed = false;
  }
}

function ensureBridge(): Promise<OpenUrlFn | null> {
  if (injected) return Promise.resolve(injected);
  if (bridge) return Promise.resolve(bridge);
  if (chunkFailed) return Promise.resolve(null);
  if (!isInToss()) return Promise.resolve(null);
  if (inflight) return inflight;
  inflight = import('@apps-in-toss/bridge-core')
    .then((m) => {
      const make = (m as unknown as BridgeCore).createAsyncBridge;
      if (typeof make !== 'function') {
        chunkFailed = true;
        return null;
      }
      bridge = make('openURL');
      return bridge;
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

/** 열기 브릿지 응답 대기 상한. 앱 전환은 보통 즉시 resolve 되지만, 안 오면 여기서 끊는다. */
const OPEN_TIMEOUT_MS = 4000;

/**
 * 무응답으로 끝난 호출의 «누적 상한»(세션당).
 *
 * ★2026-09-10(Codex 적대적 리뷰 지적 10): bridge-core 의 createAsyncBridge 는 호출마다 리스너 2개를
 *   등록하고 resolve/reject 때만 뗀다. 우리 `Promise.race` 타임아웃은 «원래 요청을 취소하지 못한다» —
 *   무응답이 반복되면 리스너가 2개씩 쌓인다(실측: 3회 반복 → 6개). SDK 에 취소 API 가 없어
 *   구조적으로 막을 방법이 없으므로 «횟수를 닫는다»: 무응답이 이만큼 쌓이면 그 세션에서는
 *   브릿지를 더 부르지 않고 즉시 'failed' 로 답한다(리스너 상한 = 2 × 3 = 6개로 고정).
 * ★'ok'·'failed' 로 끝난 호출은 리스너가 정상 해제되므로 이 카운터를 올리지 않는다.
 */
const MAX_UNKNOWN_PER_SESSION = 3;
let unknownCount = 0;

/**
 * 열기 결과 — ★세 갈래다(2026-09-10, 땅따먹기 -28 정본 패턴 채택).
 *   'ok'      네이티브가 resolve 했다
 *   'failed'  reject·동기 throw·브릿지 없음 — UI 가 실패 문구를 보인다
 *   'unknown' 4초 무응답. ⛔«실패로 단정하지 않는다» — 앱이 실제로 열려서 우리 WebView 가 멈춘 것일 수
 *             있다(그 경우 응답이 영영 안 온다). 실패 문구를 띄우면 열린 사람에게 거짓말이 된다.
 */
export type OpenUrlOutcome = 'ok' | 'failed' | 'unknown';

/**
 * URL(딥링크)을 연다. ★절대 reject 하지 않는다.
 * 실제로 그 앱이 열렸는지는 네이티브 몫이라 여기서 알 수 없다 — [미확인], Partner 실기기 확인.
 */
export async function openUrl(url: string): Promise<OpenUrlOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // ★무응답이 쌓였으면 더 부르지 않는다(리스너 누수 상한 — 위 상수 주석).
    if (unknownCount >= MAX_UNKNOWN_PER_SESSION) return 'failed';
    const fn = await ensureBridge();
    if (!fn) return 'failed';
    const outcome = await Promise.race<OpenUrlOutcome>([
      fn(url).then((): OpenUrlOutcome => 'ok').catch((): OpenUrlOutcome => 'failed'),
      new Promise<OpenUrlOutcome>((resolve) => {
        timer = setTimeout(() => resolve('unknown'), OPEN_TIMEOUT_MS);
      }),
    ]);
    if (outcome === 'unknown') {
      unknownCount++;
      console.warn('[xpromo] openURL: no response within', OPEN_TIMEOUT_MS, 'ms (unknown x' + unknownCount + ')');
    }
    return outcome;
  } catch {
    return 'failed';
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 무응답 누적 수(검사기·진단). */
export function openUrlUnknownCount(): number {
  return unknownCount;
}

/** 테스트 전용 — 모듈 상태 초기화. */
export function __resetOpenUrlForTest(): void {
  injected = null;
  bridge = null;
  inflight = null;
  chunkFailed = false;
  unknownCount = 0;
}
