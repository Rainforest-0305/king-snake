/**
 * 프로모션 지급 브릿지 + 저장소 — 앱스인토스 SDK 로의 «유일한» 통로(광고의 adSdk.ts 와 같은 역할).
 *
 * ══ ① 왜 «동적 import» 인가 — adSdk.ts ① 과 «같은 이유» ═══════════════════
 *   이 게임의 dist/ 는 세 곳에 나간다: 앱스인토스(.ait) · GitHub Pages · MS Store(MSIX).
 *   MS Store 제출 서류에 「실행 중 네트워크 요청 0건」이 신고돼 있어서, SDK 를 static
 *   import 하면 메인 번들에 fetch( 와 static.toss.im 이 박힌다(adSdk.ts 실측 주석).
 *   ⇒ 여기서도 `isInToss()` 가 true 일 때만 청크를 «요청»한다. 토스 밖에서는
 *     import 자체가 일어나지 않는다.
 *
 * ══ ② 왜 bridge-core 에서 «직접» 만드는가 ═════════════════════════════════
 *   [실측 2026-09-01, 이 프로젝트 node_modules grep]
 *     @apps-in-toss/web-bridge@2.10.8 `dist/bridge.js` 에는 있다:
 *       export var grantPromotionReward        = createAsyncBridge("grantPromotionReward");
 *       export var grantPromotionRewardForGame = createAsyncBridge("grantPromotionRewardForGame");
 *     그런데 `dist/index.js`(최종 export 목록)에는 «0건»이다 → web-framework 배럴로도 안 나온다.
 *   ⇒ getAnonymousKey·openURL 과 «같은 사정»이다(스모/네온 src/toss/bridge.ts 선례).
 *     createAsyncBridge(method) 는 method 문자열을 네이티브로 postMessage 하는 얇은 래퍼라
 *     SDK 가 공식 export 했든 우리가 선언했든 런타임 동작이 100% 같다.
 *
 * ══ ③ 파라미터·반환 실측 ══════════════════════════════════════════════════
 *   호출: grantPromotionReward({ params: { promotionCode, amount } })   ← «중첩»이다
 *   반환: { key } | { errorCode, message } | 'ERROR' | undefined(구버전 앱)
 *   ⛔ 네이티브가 응답을 안 주면 «영원히 pending» 이다(bridge-core 에 타임아웃 없음).
 *     반드시 아래 withTimeout 으로 감싼다.
 *
 * ⛔ 이 파일은 «절대 throw 하지 않는다». 광고와 같은 규율이다.
 */
import { isInToss, ensureAdSdk } from '../ads/adSdk';

export interface GrantPromotionSuccess {
  key: string;
}
export interface GrantPromotionFailure {
  errorCode: string;
  message: string;
}
export type GrantPromotionResult = GrantPromotionSuccess | GrantPromotionFailure | 'ERROR' | undefined;

export type BridgeMethod = 'grantPromotionReward' | 'grantPromotionRewardForGame';

type AsyncBridge = (args: { params: { promotionCode: string; amount: number } }) => Promise<GrantPromotionResult>;

interface BridgeCore {
  createAsyncBridge?: (method: string) => AsyncBridge;
}

let bridges: Record<BridgeMethod, AsyncBridge> | null = null;
let inflight: Promise<Record<BridgeMethod, AsyncBridge> | null> | null = null;
/** 청크 로드가 실패했으면 «다시 시도하지 않는다»(adSdk.ts 와 같은 규율). */
let chunkFailed = false;

/** 테스트 주입점. ★ main.ts 가 ?debug=1 일 때만 노출한다. */
let injected: Record<BridgeMethod, AsyncBridge> | null = null;
export function __injectPromoBridgeForTest(b: Record<BridgeMethod, AsyncBridge> | null): void {
  injected = b;
  if (b) {
    bridges = null;
    inflight = null;
    chunkFailed = false;
  }
}

function ensureBridges(): Promise<Record<BridgeMethod, AsyncBridge> | null> {
  if (injected) return Promise.resolve(injected);
  if (bridges) return Promise.resolve(bridges);
  if (chunkFailed) return Promise.resolve(null);
  if (!isInToss()) return Promise.resolve(null);
  if (inflight) return inflight;

  inflight = import('@apps-in-toss/bridge-core')
    .then((m) => {
      const make = (m as unknown as BridgeCore).createAsyncBridge;
      if (typeof make !== 'function') {
        // 청크는 왔는데 이름이 없다 = SDK 버전이 바뀐 것이다. 「있다」고 가정하지 않는다.
        chunkFailed = true;
        return null;
      }
      bridges = {
        grantPromotionReward: make('grantPromotionReward'),
        grantPromotionRewardForGame: make('grantPromotionRewardForGame'),
      };
      return bridges;
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

/** 지급 브릿지 타임아웃 — 서버 왕복이 있어 광고 기본값보다 넉넉히 둔다(스모와 같은 8s). */
const GRANT_TIMEOUT_MS = 8000;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** ★절대 reject 하지 않는다. 실패는 undefined('미지원'과 같은 취급)로 표현한다. */
export async function callGrant(
  method: BridgeMethod,
  params: { promotionCode: string; amount: number }
): Promise<GrantPromotionResult> {
  try {
    const b = await ensureBridges();
    if (!b) return undefined;
    return await withTimeout(b[method]({ params }), GRANT_TIMEOUT_MS, undefined);
  } catch {
    return undefined;
  }
}

/* ─────────────────────── 저장소 ───────────────────────
 * 광고 원장(reward/rewardStore.ts)은 localStorage 만 쓴다 — 유실돼도 「광고를 더 볼 수 있다」뿐이라
 * 그걸로 충분했다. ★프로모션은 «실돈»이라 판단이 다르다. 네이티브 Storage 에도 같이 써서
 * WebView 저장소가 비워져도 「이미 받았다」가 살아남게 한다(스모 src/toss/storage.ts 와 같은 이유).
 * 네이티브가 없거나 실패하면 조용히 localStorage 만 쓴다 — 절대 throw 하지 않는다.
 */
function localGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function localSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* quota / private mode */
  }
}

/** 네이티브 Storage 값을 «있으면» 돌려준다. 없으면 null. */
export async function nativeGet(key: string): Promise<string | null> {
  if (!isInToss()) return null;
  try {
    const sdk = await ensureAdSdk();
    if (!sdk?.Storage) return null;
    return await withTimeout(sdk.Storage.getItem(key), 3000, null);
  } catch {
    return null;
  }
}

export async function nativeSet(key: string, value: string): Promise<void> {
  if (!isInToss()) return;
  try {
    const sdk = await ensureAdSdk();
    if (!sdk?.Storage) return;
    await withTimeout(sdk.Storage.setItem(key, value), 3000, undefined);
  } catch {
    /* 로컬에는 이미 썼다 */
  }
}

export const promoStorage = {
  /** ★로컬·네이티브 «둘 다» 읽는다. 병합은 부르는 쪽이 한다(어느 쪽이 최신인지 모른다). */
  async readBoth(key: string): Promise<{ local: string | null; native: string | null }> {
    const local = localGet(key);
    const native = await nativeGet(key);
    return { local, native };
  },
  async write(key: string, value: string): Promise<void> {
    localSet(key, value);
    await nativeSet(key, value);
  },
};

export { isInToss };
