// rewardAd.ts — 리워드 광고 «로드 + 표시 + 보상 판정» 상태기계.
//
// ══════════════════════════════════════════════════════════════════════════
// ★ 이 파일은 네온 스레드 src/skinTrial.ts (-24) 의 방어를 «그대로» 이식한 것이다.
//   거기서 실제로 난 사고를 다시 내지 않으려고 옮겨 왔다. 요약:
//
//   [사고] 안드로이드 실기기에서 「광고를 끝까지 봤는데 해금이 안 된다」.
//          iOS 는 정상. 원인은 «이벤트 도착 순서»였다 —
//          브릿지가 dismissed 를 먼저 올리고 userEarnedReward 를 «그 뒤»에 올린다.
//          예전 코드는 dismissed 를 받는 즉시 판정을 끝내고(finished=true),
//          뒤늦게 온 보상 이벤트를 가드에 «버렸다».
//          게다가 show/impression 이 8초 안에 안 오면 광고가 «돌아가는 중»에도
//          open_timeout 으로 끝내 버렸다.
//
//   [대응 6종 — 아래 코드에 전부 들어 있다]
//     ① dismissed / hard_cap 은 «유예 3,000ms» 뒤에 판정한다. 유예 중 보상이 오면 즉시 ok.
//     ② 이벤트 타입 «정규화» — 소문자·영문 외 제거 후 'userearnedreward' 포함 판정.
//        e.type 뿐 아니라 e.name/e.event/e.eventType/e.eventName/e.data.type 도 읽는다.
//        (브릿지 버전마다 필드가 다르다. 「type 에 있겠지」는 가정이다.)
//     ③ open_timeout 은 «아무 이벤트도 안 왔을 때»만 8s. requested 만 온 상태면 20s 더 기다린다.
//     ④ 판정이 끝난 뒤에도 15s 안에 늦은 보상이 오면 onLateReward 로 «그때» 지급한다.
//     ⑤ 보상 이벤트가 끝내 안 와도 show/impression 뒤 12초 이상 표시된 뒤 dismissed 면
//        1회로 «인정»한다. ⛔opt-in(allowInferred) — 코스메틱(스킨)만 켠다.
//        ⛔부활·부스트처럼 «게임 결과»에 영향이 있는 경로엔 켜지 않는다. 프로모션(토스 포인트)
//          같은 실돈 경로에는 «영원히» 켜지 마라.
//     ⑥ 광고 1회마다 이벤트 시퀀스·시각·플랫폼을 남긴다(ad_seq). 이 게임엔 애널리틱스
//        파이프가 없으므로 localStorage 링버퍼(최근 8건) + window.__coilReward.seq() 로 남긴다.
//        실기기에서 「광고 봐도 안 된다」가 재발하면 «무슨 순서로 왔는지»를 그걸로 읽는다.
//
// ══════════════════════════════════════════════════════════════════════════
// ★ SDK 접근은 src/ads/adSdk.ts 를 통해서만 한다(보호 파일, 무접촉).
//   그 파일이 «동적 import» 인 이유는 MS Store 제출 서류(네트워크 요청 0건·광고 0건)
//   때문이다. static import 로 바꾸면 신고서 3종이 거짓이 된다 — adSdk.ts 머리말 참조.
//   덕분에 토스 밖(브라우저·Pages·MS Store)에서는 이 파일이 SDK 청크를 «요청조차 안 한다».
//
// ★ 절대 throw 하지 않는다. 광고 때문에 게임이 죽으면 안 된다.
//
// ══ 2026-09-10(레인 A) — 「요청 = 노출」 ═══════════════════════════════════════
//   리워드는 «버튼 뒤 로드»다. 이 파일은 그 원칙을 «그대로» 지킨다 — 프리로드를 넣지 않았다.
//   콘솔 실측(7일 09-02~08) 리워드 요청 550 → 노출 322(58.5%). 판 시작마다 부활 광고를 미리
//   받으면(프리로드) 요청은 «판 수»(전면형 노출 1,392/주 = 2판당 1회 ⇒ 판 ≥ 2,800/주)로 늘고
//   노출은 부활 «탭 수»(≈ 141/주)뿐이다 ⇒ 시청률 5% 대로 떨어진다. Codex 개선안(12_광고시청률_개선안
//   §4 「선택형 전면·리워드는 버튼 후 로드다. 10번 프리로드 권고를 수정한다」)과 같은 결론이다.
//   대신 «탭 → 노출» 손실을 줄인다: 숨김 인지 타이머(아래 HIDDEN_GRACE_MS) · 연타 잠금(inFlight + 셸 busy).

import { ensureAdSdk, peekAdSdk, type AdSdk } from '../ads/adSdk';
import { REWARD_AD_GROUPS, type RewardSurface } from './adGroups';

/* ─────────────────────── 타이밍 상수 (전부 실사고에서 나온 값) ─────────────────────── */

/** 유저가 이미 탭하고 «기다리는 중»이라 preload 상한보다 넉넉하다. */
const LOAD_TIMEOUT_MS = 8000;
/** show() 뒤 «아무 이벤트도» 안 오면 광고가 안 뜬 것 — 이때만 open_timeout. */
const SHOW_OPEN_TIMEOUT_MS = 8000;
/** requested 는 왔는데 show/impression 이 없을 때의 «추가» 대기(③). */
const SHOW_REQUESTED_TIMEOUT_MS = 20000;
/** 이 이상 갇혀 있으면 브릿지가 죽은 것으로 본다. */
const SHOW_HARD_CAP_MS = 180000;
/** dismissed / hard_cap 뒤 보상을 기다리는 유예(①). 안드로이드 브릿지 지연 대비. */
const DISMISS_GRACE_MS = 3000;
/** 보상 이벤트 없이도 «이만큼 표시된 뒤 닫힘»이면 시청으로 인정(⑤, opt-in). */
const INFER_MIN_SHOWN_MS = 12000;  // 2026-08-31 President 결정: 20000 -> 12000.
// 리워드 광고는 15~30초이고 스킵 불가 구간이 끝나야 닫기가 뜬다. 20초 문턱이면
// 「15초 광고를 끝까지 봤는데 보상 이벤트가 유실된」 안드로이드 케이스가 미지급으로 샌다.
// 악용 이득은 판 안 소프트 혜택뿐이라 12초 대기가 이득보다 크다(실돈 경로 아님).
/**
 * 판정이 끝난 뒤에도 이만큼은 늦은 보상을 받아 지급한다(④).
 * ★export 인 이유: 「보상이 무산됐을 때 «언제» 관련 상태를 버려도 되는가」가
 *   이 값에 달려 있다(main.ts 의 성장 기준 질량 스냅샷). 호출부가 15000 을
 *   손으로 베끼면, 이 값을 고쳤을 때 조용히 어긋난다.
 */
export const LATE_REWARD_WINDOW_MS = 15000;
/**
 * ★2026-09-10(레인 A · Partner 지시 「iOS 백그라운드 복귀 시 리스너 재연결」) — 숨김 유예.
 *   앱이 백그라운드로 가면 iOS WebView 는 타이머·브릿지 콜백을 미룬다. 유저가 광고를 보다 홈으로
 *   나갔다 돌아오면 «우리 타임아웃»이 먼저 깨어나 광고를 실패 처리하고, 그 «뒤에» 네이티브가
 *   userEarnedReward 를 올린다 = 「끝까지 봤는데 보상이 없다」(콘솔 실측 iOS 30.8% vs Android 45.2%).
 *   ⇒ 타임아웃이 «숨김 중»에 만기가 되면 즉시 판정하지 않고, 화면이 다시 보인 뒤 이만큼 더 기다린다.
 *     그 사이에 밀린 콜백이 도착하면 정상 경로로 판정된다(리스너는 끊긴 적이 없다 — 판정만 미룬다).
 */
const HIDDEN_GRACE_MS = 3000;

/** ad_seq 한 건에 담는 이벤트 최대 개수(무한 이벤트 폭주 방어). */
const SEQ_MAX = 24;

/* ─────────────────────── 숨김 인지 타이머 ───────────────────────
 * setTimeout 을 감싸, 만기 시점에 document.hidden 이면 «보일 때까지» 미루고 HIDDEN_GRACE_MS 뒤 발화한다.
 * clear() 는 미뤄 둔 리스너까지 함께 걷는다. 실패해도 절대 throw 하지 않는다(광고가 게임을 못 죽인다).
 */
interface DeferredTimer {
  clear(): void;
}

export function isHidden(): boolean {
  try {
    return typeof document !== 'undefined' && document.hidden === true;
  } catch {
    return false;
  }
}

function hiddenAwareTimeout(fn: () => void, ms: number): DeferredTimer {
  let t: ReturnType<typeof setTimeout> | null = null;
  let onVis: (() => void) | null = null;
  const arm = (delay: number): void => {
    t = setTimeout(() => {
      t = null;
      if (isHidden()) {
        // 숨김 중 — 판정을 «보일 때»로 미룬다.
        onVis = () => {
          if (isHidden()) return;
          document.removeEventListener('visibilitychange', onVis!);
          onVis = null;
          arm(HIDDEN_GRACE_MS);
        };
        document.addEventListener('visibilitychange', onVis);
        return;
      }
      fn();
    }, delay);
  };
  arm(ms);
  return {
    clear(): void {
      if (t !== null) clearTimeout(t);
      t = null;
      if (onVis) {
        try {
          document.removeEventListener('visibilitychange', onVis);
        } catch {
          /* noop */
        }
        onVis = null;
      }
    },
  };
}
/** localStorage 에 남기는 ad_seq 링버퍼 길이. */
const SEQ_LOG_MAX = 8;
const SEQ_LOG_KEY = 'king-snake.adseq.v1';

/* ─────────────────────── 이벤트 정규화 (②) ─────────────────────── */

/**
 * 이벤트 객체에서 «타입 문자열»을 꺼낸다.
 * ★ e.type 만 보지 않는다. 브릿지/SDK 버전마다 필드 이름이 다르고, 실제로
 *   data 안에 중첩돼 온 사례가 있다. 없으면 'unknown'.
 */
export function rawEventType(e: unknown): string {
  try {
    if (typeof e === 'string') return e;
    const o = e as Record<string, unknown> | null;
    if (!o || typeof o !== 'object') return 'unknown';
    const nested = o.data as Record<string, unknown> | undefined;
    const cands = [o.type, o.name, o.event, o.eventType, o.eventName, nested ? nested.type : undefined];
    for (const c of cands) if (typeof c === 'string' && c) return c;
  } catch {
    /* noop */
  }
  return 'unknown';
}

/** 소문자화 + 영문 외 제거: 'userEarnedReward' / 'USER_EARNED_REWARD' / 'user-earned-reward' → 'userearnedreward'. */
export function normType(raw: string): string {
  return String(raw).toLowerCase().replace(/[^a-z]/g, '');
}

export function isRewardType(n: string): boolean {
  return n.includes('userearnedreward') || n.includes('earnedreward') || n === 'rewarded' || n === 'reward';
}

/* ─────────────────────── 플랫폼 태그(계측 열거값 — 식별정보 아님) ─────────────────────── */

export function platformTag(): 'android' | 'ios' | 'other' {
  try {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  } catch {
    /* noop */
  }
  return 'other';
}

/* ─────────────────────── 계측(⑥) ───────────────────────
 * 이 게임엔 애널리틱스 파이프가 «없다»(grep 0건 실측). 그래서:
 *   1) window.__coilTrack 이 «있으면» 그리로 보낸다(나중에 파이프가 생겨도 이 파일은 안 고친다).
 *   2) 없어도 메모리 링버퍼 + localStorage 에 최근 8건을 남긴다.
 *      실기기에서 「광고 봐도 안 된다」가 재발하면 그걸 읽어 «이벤트 순서»를 본다.
 *      ⛔개인식별정보는 담지 않는다 — 이벤트 이름·경과 ms·플랫폼 열거값뿐이다.
 */

export interface AdSeqRecord {
  at: number;
  surface: string;
  result: 'ok' | 'inferred' | 'fail';
  reason: string;
  seq: string;
  ms: string;
  shownMs: number;
  platform: string;
}

const seqLog: AdSeqRecord[] = [];

function persistSeqLog(): void {
  try {
    window.localStorage.setItem(SEQ_LOG_KEY, JSON.stringify(seqLog));
  } catch {
    /* 저장 실패가 광고를 막으면 안 된다 */
  }
}

export function adSeqLog(): readonly AdSeqRecord[] {
  return seqLog;
}

function track(name: string, params: Record<string, unknown>): void {
  try {
    const w = window as unknown as { __coilTrack?: (n: string, p: Record<string, unknown>) => void };
    if (typeof w.__coilTrack === 'function') w.__coilTrack(name, params);
  } catch {
    /* 계측 실패가 기능을 막으면 안 된다 */
  }
}

function recordSeq(r: AdSeqRecord): void {
  seqLog.push(r);
  while (seqLog.length > SEQ_LOG_MAX) seqLog.shift();
  persistSeqLog();
  track('ad_seq', r as unknown as Record<string, unknown>);
}

/* ─────────────────────── 가용성 ─────────────────────── */

/**
 * 지금 «리워드 버튼을 보여도 되는가».
 * ★ 동기 판정이다 — 버튼 가시성은 매 렌더마다 결정되므로 await 할 수 없다.
 *   SDK 청크가 아직 안 왔으면 false 다. 부팅 때 warmUp() 이 한 번 당겨 두므로
 *   토스 안이면 곧 true 가 된다(그리고 셸이 다시 그릴 때 버튼이 나타난다).
 */
export function rewardAdsUsable(): boolean {
  try {
    const sdk = peekAdSdk();
    if (!sdk) return false;
    return sdk.loadFullScreenAd.isSupported() && sdk.showFullScreenAd.isSupported();
  } catch {
    return false;
  }
}

/**
 * SDK 청크를 미리 당겨 둔다(토스 밖이면 «요청조차 안 한다» — adSdk.ts 가 막는다).
 * @returns 가용해졌는가. 셸이 이 값으로 버튼을 다시 그린다.
 */
export async function warmUpRewardAds(): Promise<boolean> {
  try {
    await ensureAdSdk();
  } catch {
    /* ensureAdSdk 는 reject 하지 않지만, 미래의 변경에 대비해 감싼다 */
  }
  return rewardAdsUsable();
}

/* ─────────────────────── 결과 타입 ─────────────────────── */

export interface RewardResult {
  ok: boolean;
  /** 실패 사유 또는 성공 시 판정 계기('reward' / 'dismissed' ...). */
  reason?: string;
  /** 보상 이벤트 없이 «표시 시간»으로 인정한 경우 true (allowInferred 일 때만 가능). */
  inferred?: boolean;
  /** 받은 이벤트 순서(계측과 같은 문자열). */
  seq?: string;
}

export interface ShowRewardOptions {
  /** 어느 지면인가. 계측 surface 태그로도 쓴다. */
  surface: RewardSurface;
  /**
   * 표시 12s+ 뒤 dismissed 를 시청으로 «인정»할 것인가(⑤).
   * ⛔코스메틱 전용. 부활·부스트처럼 게임 결과를 바꾸는 보상엔 켜지 마라.
   */
  allowInferred?: boolean;
  /** 판정(실패) 뒤 15s 안에 늦은 보상이 오면 «한 번» 불린다(④). */
  onLateReward?: () => void;
}

/* ─────────────────────── 동시 실행 방지 ───────────────────────
 * 전면 광고는 화면을 통째로 덮는다. 두 개가 동시에 뜨면 브릿지 상태가 엉키고
 * 어느 쪽 보상인지 알 수 없어진다. 전역으로 «하나»만 돌린다.
 */
let inFlight = false;

export function rewardAdInFlight(): boolean {
  return inFlight;
}

/**
 * 리워드 광고 1회. ★절대 reject 하지 않는다 — 실패는 ok:false 로 표현한다.
 *
 * 멱등: 같은 시청에서 보상 이벤트가 여러 번 와도 «한 번»만 ok 다(earned 는 boolean).
 * 지급 자체의 멱등은 호출부가 책임진다(granted 가드) — 늦은 보상(④)과 정상 보상이
 * 겹칠 수 있기 때문이다.
 */
export async function showRewardAd(opts: ShowRewardOptions): Promise<RewardResult> {
  if (inFlight) return { ok: false, reason: 'busy' };
  const sdk = await ensureAdSdk();
  if (!sdk) return { ok: false, reason: 'unsupported' };
  try {
    if (!sdk.loadFullScreenAd.isSupported() || !sdk.showFullScreenAd.isSupported()) {
      return { ok: false, reason: 'unsupported' };
    }
  } catch {
    return { ok: false, reason: 'unsupported' };
  }
  inFlight = true;
  try {
    return await loadAndShow(sdk, opts);
  } finally {
    inFlight = false;
  }
}

function loadAndShow(sdk: AdSdk, opts: ShowRewardOptions): Promise<RewardResult> {
  const allowInferred = !!opts.allowInferred;
  const surface = opts.surface;
  const adGroupId = REWARD_AD_GROUPS[surface];
  const platform = platformTag();

  return new Promise<RewardResult>((resolve) => {
    const t0 = Date.now();
    const seq: string[] = [];
    const ms: number[] = [];
    const mark = (tag: string): void => {
      if (seq.length >= SEQ_MAX) return;
      seq.push(tag);
      ms.push(Date.now() - t0);
    };
    let settled = false;
    let unsubLoad: (() => void) | null = null;

    const safeUnsub = (fn: (() => void) | null): void => {
      try {
        if (typeof fn === 'function') fn();
      } catch {
        /* noop */
      }
    };

    const report = (result: 'ok' | 'inferred' | 'fail', reason: string, shownMs: number): void => {
      recordSeq({
        at: t0, surface, result, reason,
        seq: seq.join('>'), ms: ms.join(','), shownMs, platform,
      });
    };

    let loadTimer: DeferredTimer | null = hiddenAwareTimeout(
      () => finishLoad(false, 'load_timeout'),
      LOAD_TIMEOUT_MS,
    );

    function finishLoad(ok: boolean, reason?: string): void {
      if (settled) return;
      if (loadTimer) {
        loadTimer.clear();
        loadTimer = null;
      }
      if (!ok) {
        settled = true;
        mark('end:' + (reason || 'load_fail'));
        safeUnsub(unsubLoad);
        report('fail', reason || 'load_fail', 0);
        resolve({ ok: false, reason, seq: seq.join('>') });
        return;
      }
      /* ★2026-09-10(Codex 적대적 리뷰 지적 4): 탭한 뒤 로드가 끝나기 «전에» 앱이 백그라운드로 갔으면
         광고를 «띄우지 않는다». 안 보이는 화면에 띄우면 유저가 못 보는 노출이 되고(요청 = 노출 원칙 위반),
         보상 판정도 유저가 안 본 광고로 나간다. 상한은 안 깎이고 실패로 끝난다 — 다시 탭하면 된다. */
      if (isHidden()) {
        settled = true;
        mark('end:hidden_before_show');
        safeUnsub(unsubLoad);
        report('fail', 'hidden_before_show', 0);
        resolve({ ok: false, reason: 'hidden_before_show', seq: seq.join('>') });
        return;
      }
      showNow();
    }

    function showNow(): void {
      let earned = false;
      let shownAt = 0; // show/impression 이 온 시각
      let requestedAt = 0;
      let finished = false;
      let lateFired = false;
      let unsubShow: (() => void) | null = null;

      // ★전부 «숨김 인지» 타이머다(2026-09-10). 백그라운드에서 만기가 되면 보일 때까지 판정을 미룬다.
      let openTimer: DeferredTimer | null = hiddenAwareTimeout(() => settle('open_timeout'), SHOW_OPEN_TIMEOUT_MS);
      let reqTimer: DeferredTimer | null = null;
      let capTimer: DeferredTimer | null = hiddenAwareTimeout(() => deferSettle('hard_cap'), SHOW_HARD_CAP_MS);
      let graceTimer: DeferredTimer | null = null;

      const clearAll = (): void => {
        for (const timer of [openTimer, reqTimer, capTimer, graceTimer]) if (timer) timer.clear();
        openTimer = reqTimer = capTimer = graceTimer = null;
      };
      const shownMsNow = (): number => {
        const from = shownAt || requestedAt;
        return from ? Date.now() - from : 0;
      };

      /** 최종 판정. 보상이 있으면 ok, 없으면 (opt-in) 표시시간 추론, 아니면 실패. */
      function settle(reason: string): void {
        if (finished) return;
        finished = true;
        clearAll();
        settled = true;
        const shownMs = shownMsNow();
        mark('end:' + reason);
        // ★ 판정 뒤에도 잠시 «듣는다» — 늦은 보상(④) 지급 + 계측. 창이 지나면 구독 해제.
        setTimeout(() => safeUnsub(unsubShow), LATE_REWARD_WINDOW_MS);
        if (earned) {
          report('ok', reason, shownMs);
          resolve({ ok: true, reason, seq: seq.join('>') });
          return;
        }
        const closedLike = reason === 'dismissed' || reason === 'hard_cap';
        if (allowInferred && closedLike && shownMs >= INFER_MIN_SHOWN_MS) {
          report('inferred', reason, shownMs);
          resolve({ ok: true, inferred: true, reason, seq: seq.join('>') });
          return;
        }
        report('fail', reason, shownMs);
        resolve({ ok: false, reason, seq: seq.join('>') });
      }

      /** dismissed / hard_cap 은 «유예»(①) 뒤 판정 — 유예 중 보상이 오면 settle 이 먼저 불린다. */
      function deferSettle(reason: 'dismissed' | 'hard_cap'): void {
        if (finished || graceTimer) return;
        graceTimer = hiddenAwareTimeout(() => {
          graceTimer = null;
          settle(reason);
        }, DISMISS_GRACE_MS);
      }

      const onEvent = (e: unknown): void => {
        const raw = rawEventType(e);
        const n = normType(raw);
        mark(raw.slice(0, 24));
        if (openTimer) {
          openTimer.clear();
          openTimer = null;
        }
        if (isRewardType(n)) {
          if (finished) {
            // 늦은 보상(④): 판정은 끝났지만 창 안이면 «그때» 지급한다.
            if (!earned && !lateFired) {
              lateFired = true;
              earned = true;
              track('ad_late_reward', { surface, platform, delayMs: ms.length ? ms[ms.length - 1] : 0 });
              try {
                if (typeof opts.onLateReward === 'function') opts.onLateReward();
              } catch {
                /* 지급 콜백이 던져도 광고 경로는 계속 산다 */
              }
            }
            return;
          }
          earned = true; // 멱등 — 여러 번 와도 boolean 한 번만 true
          settle('reward');
          return;
        }
        if (finished) return;
        if (n === 'requested') {
          if (!requestedAt) requestedAt = Date.now();
          // ③ requested 만 온 상태 — 광고가 «준비 중»일 수 있다. 더 기다린다.
          if (!shownAt && !reqTimer) reqTimer = hiddenAwareTimeout(() => settle('open_timeout'), SHOW_REQUESTED_TIMEOUT_MS);
          return;
        }
        if (n === 'show' || n === 'impression') {
          if (!shownAt) shownAt = Date.now();
          if (reqTimer) {
            reqTimer.clear();
            reqTimer = null;
          }
          return;
        }
        if (n === 'clicked' || n === 'loaded' || n === 'unknown') return;
        if (n === 'dismissed' || n === 'closed' || n === 'dismiss') {
          deferSettle('dismissed');
          return;
        }
        if (n === 'failedtoshow' || n === 'failed' || n === 'error') settle('failedToShow');
      };

      mark('show_call');
      try {
        const ret = sdk.showFullScreenAd({
          options: { adGroupId },
          onEvent: onEvent as (d: { type: string }) => void,
          onError: () => settle('onError'),
        }) as unknown;
        if (typeof ret === 'function') unsubShow = ret as () => void;
      } catch {
        settle('failedToShow');
      }
    }

    mark('load_call');
    try {
      const ret = sdk.loadFullScreenAd({
        options: { adGroupId },
        onEvent: (e) => {
          const n = normType(rawEventType(e));
          if (n === 'loaded') {
            mark('loaded');
            safeUnsub(unsubLoad);
            unsubLoad = null;
            finishLoad(true);
          }
        },
        onError: () => finishLoad(false, 'onError'),
      }) as unknown;
      if (typeof ret === 'function') unsubLoad = ret as () => void;
    } catch {
      finishLoad(false, 'onError');
    }
  });
}

/** 실패 사유 → 유저에게 보일 문구의 «종류». 문구 자체는 rewardText.ts 가 만든다. */
export function failKind(reason: string | undefined): 'load' | 'watch' {
  const r = reason || '';
  if (r === 'load_timeout' || r === 'onError' || r === 'failedToShow' || r === 'load_fail' || r === 'unsupported'
    // ★'hidden_before_show' 는 광고가 «뜨지 않은» 실패다 — 「끝까지 봐야 받는다」가 아니라 「못 불러왔다」 쪽이고,
    //   호출부의 rewardShownOnResult 도 서면 안 된다(광고가 화면에 뜬 적이 없다).
    || r === 'hidden_before_show') {
    return 'load';
  }
  return 'watch'; // dismissed / open_timeout / hard_cap / busy / unknown
}
