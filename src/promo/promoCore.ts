/**
 * 프로모션 지급 «코어» — 의존성 주입형(저장·브릿지·설정을 밖에서 꽂는다). 2026-08-29 신설
 *
 * 왜 분리하는가: 락·기록·폴백 규칙을 «실행으로» 세기 위해서다(scripts/check_promo_hooks.mjs 가
 * 가짜 저장·가짜 브릿지를 꽂아 이 파일을 «그대로» 돌리고 브릿지 호출 «횟수»를 센다).
 * 스모 바운스 src/toss/promoCore.ts(2026-08-29 검증본)를 뱀 키우기로 «그대로» 옮긴 것 — 재작성 금지 규율.
 *
 * ── 방어 4중 ────────────────────────────────────────────────────────────────
 *   ① 로컬 기록 — ★«프로모션 코드별» 키. 콘솔에서 코드를 바꾸면 옛 기록이 새 지급을 막지
 *      않는다(08-29 해오름·미리 실결함: 단일 키라 코드 교체 시 영구 차단). 기록 안에도 code 를
 *      적어 두고 «키와 code 둘 다» 맞을 때만 「이미 받음」으로 본다.
 *   ② in-flight 락 — 저장 왕복이 비동기라 그 사이 두 번 불리면 둘 다 "아직 안 받았다"로 읽는다.
 *   ③ 세션 락 — 이 실행(페이지 수명)에서 한 코드는 «한 번만» 처리한다. 기록 저장이 실패해도
 *      같은 세션에서 두 번 못 부른다(08-26 머니 리그 알림 2회 의심 건의 방어).
 *   ④ 토스 4113(이미 지급) — 서버가 막으면 그 사실을 로컬에 «복원» 기록한다.
 *
 * ── ⛔ 한계(숨기지 마라) ─────────────────────────────────────────────────────
 *   서버 없음. 저장을 지우거나 재설치하면 같은 사람이 다시 받을 수 있다. 토스도 지급 내역
 *   조회 API 를 주지 않는다. 최종 방어선은 콘솔 예산 하나다 — 소진 시 4112 로 닫힌다.
 *
 * ⛔ 이 파일은 «절대 throw 하지 않는다». 결과 화면을 막으면 안 된다.
 */
import type { GrantPromotionResult } from './promoBridge';

export type BridgeMethod = 'grantPromotionReward' | 'grantPromotionRewardForGame';

export type PromoOutcome =
  | 'granted' // 실제로 지급됐다
  | 'already' // 이미 받았다(로컬 기록 또는 토스 4113)
  | 'locked' // 이 세션에서 이미 한 번 처리했다 — 저장도 브릿지도 «안 탄다»
  | 'unconfigured' // 프로모션 코드가 안 꽂혔다(src/promo/promoConfig.ts)
  | 'unsupported' // 토스 밖이거나 앱 버전 미달
  | 'failed'; // 지급 시도했으나 실패(다음 «실행»에서 재시도 가능)

export interface PromoRecord {
  grantedAt?: number;
  key?: string;
  code?: string;
  viaAlreadyGranted?: boolean;
}

export interface PromoConfig {
  code: string;
  amount: number;
}

export interface PromoDeps {
  inToss(): boolean;
  readConfig(): PromoConfig;
  /** ★code 별로 «다른 키»를 읽어야 한다(구현은 promotion.ts). */
  loadRecord(code: string): Promise<PromoRecord>;
  saveRecord(code: string, rec: PromoRecord): Promise<void>;
  callBridge(method: BridgeMethod, params: { promotionCode: string; amount: number }): Promise<GrantPromotionResult>;
  now(): number;
  log?: (level: 'log' | 'warn' | 'error', msg: string) => void;
}

export interface PromoClaimer {
  claim(): Promise<PromoOutcome>;
  /** 이 세션에서 이미 처리됐는가(코드 기준). */
  settled(): boolean;
  alreadyRewarded(): Promise<boolean>;
  /** 검사용 — 브릿지 실호출 횟수. */
  bridgeCalls(): number;
}

function isSuccess(r: GrantPromotionResult): r is { key: string } {
  return !!r && r !== 'ERROR' && typeof (r as { key?: unknown }).key === 'string';
}
function isFailure(r: GrantPromotionResult): r is { errorCode: string; message: string } {
  return !!r && r !== 'ERROR' && typeof (r as { errorCode?: unknown }).errorCode === 'string';
}

export function createPromoClaimer(deps: PromoDeps): PromoClaimer {
  const log = deps.log ?? ((level, msg) => console[level](msg));
  /** 세션 락·in-flight 락은 «코드별»이다(코드가 바뀌면 새 프로모션). */
  const sessionDone = new Set<string>();
  const inFlight = new Map<string, Promise<PromoOutcome>>();
  let calls = 0;

  function safeConfig(): PromoConfig {
    try {
      const c = deps.readConfig();
      return { code: (c?.code ?? '').trim(), amount: c?.amount > 0 ? c.amount : 0 };
    } catch {
      return { code: '', amount: 0 };
    }
  }

  async function run(code: string, amount: number): Promise<PromoOutcome> {
    let rec: PromoRecord = {};
    try {
      rec = (await deps.loadRecord(code)) ?? {};
    } catch {
      rec = {};
    }
    // ★「이미 받음」= 기록의 code 가 현재 code 와 같을 때만. code 없는 옛 기록은 다른 프로모션 것.
    if (rec.grantedAt && rec.code === code) return 'already';

    if (!deps.inToss()) return 'unsupported';

    log('log', `[promo] 지급 요청 code=${code} amount=${amount}`);
    const params = { promotionCode: code, amount };

    let res: GrantPromotionResult;
    try {
      calls += 1;
      res = await deps.callBridge('grantPromotionReward', params);
      if (res === undefined || res === 'ERROR') {
        log('warn', '[promo] grantPromotionReward 미응답/오류 — 레거시(ForGame)로 폴백');
        calls += 1;
        res = await deps.callBridge('grantPromotionRewardForGame', params);
      }
    } catch (e) {
      log('error', `[promo] 브릿지 예외: ${String(e)}`);
      return 'failed';
    }

    if (isSuccess(res)) {
      try {
        await deps.saveRecord(code, { grantedAt: deps.now(), key: res.key, code });
      } catch (e) {
        log('error', `[promo] 지급 기록 저장 실패 — 세션 락이 이번 세션을 막고, 다음 실행은 4113 이 막는다: ${String(e)}`);
      }
      log('log', `[promo] 지급 성공 key=${res.key}`);
      return 'granted';
    }

    if (isFailure(res)) {
      log('error', `[promo] 지급 실패 code=${res.errorCode} msg=${res.message}`);
      if (res.errorCode === '4113') {
        try {
          await deps.saveRecord(code, { grantedAt: deps.now(), viaAlreadyGranted: true, code });
        } catch {
          /* 다음 실행에서 또 4113 으로 닫힌다 */
        }
        return 'already';
      }
      if (res.errorCode === '4112') log('warn', '[promo] 프로모션 예산 소진 — 더 지급하지 않는다');
      return 'failed';
    }

    if (res === undefined) {
      log('warn', '[promo] 토스 앱 버전이 낮아 프로모션 미지원 — 건너뛴다');
      return 'unsupported';
    }
    log('error', '[promo] 알 수 없는 오류(ERROR) — 지급되지 않았다');
    return 'failed';
  }

  function claim(): Promise<PromoOutcome> {
    const { code, amount } = safeConfig();
    if (!code || !(amount > 0)) {
      log('warn', '[promo] 프로모션 코드/금액 미설정 — 지급 요청 생략. src/promo/promoConfig.ts 확인');
      return Promise.resolve('unconfigured');
    }
    if (sessionDone.has(code)) return Promise.resolve('locked'); // ③
    const busy = inFlight.get(code);
    if (busy) return busy; // ②
    const p = run(code, amount)
      .catch((e) => {
        log('error', `[promo] 예상 밖 예외 — 게임은 계속: ${String(e)}`);
        return 'failed' as PromoOutcome;
      })
      .then((out) => {
        sessionDone.add(code);
        inFlight.delete(code);
        return out;
      });
    inFlight.set(code, p);
    return p;
  }

  return {
    claim,
    settled: () => sessionDone.has(safeConfig().code),
    async alreadyRewarded() {
      try {
        const { code } = safeConfig();
        if (!code) return false;
        const rec = await deps.loadRecord(code);
        return !!rec?.grantedAt && rec.code === code;
      } catch {
        return false;
      }
    },
    bridgeCalls: () => calls,
  };
}
