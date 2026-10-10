/**
 * 스킨 해금 프로모션 «2종 추가» — ③킹코브라(300원) · ⑤특수 스킨(500원). 2026-09-02
 *
 * ══ 왜 mambaPromo.ts 를 «건드리지 않고» 새 파일인가 ═══════════════════════
 *   mambaPromo 는 «지금 라이브에서 실돈을 지급 중»이고 전용 검사기
 *   (tools/verify_promo_mamba.py · scan_promo.mjs)가 그 동작을 고정하고 있다.
 *   거기에 다중 코드를 끼워 넣는 리팩터는 «돈 나가는 경로»를 통째로 다시 검증해야
 *   하는 일이다. 이득이 없다 — 코어(promoCore)가 이미 «코드별»로 설계돼 있어서
 *   같은 규칙을 그대로 재사용할 수 있다.
 *   ⇒ 이 파일은 mamba 와 «완전히 같은 규칙»을 파라미터화해서 돌린다.
 *     병합 규칙(mergeRecords)·키 규칙(recordKeyFor)은 mambaPromo 에서 «가져다» 쓴다 —
 *     복사하면 두 규칙이 갈라지고, 갈라지는 순간 한쪽이 이중 지급을 낸다.
 *
 * ══ 사양은 mamba 와 동일(President 2026-09-01 전 프로모션 공통) ════════════
 *   「프로모션 개설 전에 이미 달성한 사람에게는 지급하지 않는다」
 *     기준선 = 이 코드가 든 빌드의 «첫 실행» 시점
 *     · 기준선에 이미 보유 → ★영구 미지급
 *     · 기준선에 미보유 → 보유로 «전이»할 때 1회 지급
 *   모르면 «덜 주는» 쪽으로 넘어진다(실패 시 ownedAtBaseline = true).
 *
 * ⛔ 이 파일은 «절대 throw 하지 않는다».
 * ⛔ 코드 문자열은 여기 «한 곳»에만 있다(tools/scan_promo.mjs 가 개수를 센다).
 */
import { callGrant, isInToss, promoStorage } from './promoBridge';
import { createPromoClaimer, type PromoOutcome } from './promoCore';
import { mergeRecords, recordKeyFor, type MambaRecord } from './mambaPromo';

/** 한 프로모션의 «전부». 새 프로모션은 이 배열에 한 줄 더하는 일이 된다. */
export interface SkinPromoDef {
  /** 앱스인토스 콘솔 프로모션 코드. */
  readonly code: string;
  /** 지급액(원). 카드와 «정확히» 같아야 한다 — 게임 앱은 고정 금액만 허용된다. */
  readonly amount: number;
  /** 내부 식별자(로그·검사기용). */
  readonly id: string;
}

/**
 * ③ 킹코브라 300원 / ⑤ 특수 스킨 500원.
 * ★「보유」의 «정의»는 여기 없다 — main.ts 가 콜백으로 주입한다.
 *   규칙을 두 곳에 적으면 반드시 갈린다(mambaPromo 가 같은 이유로 그렇게 한다).
 */
export const SKIN_PROMOS: readonly SkinPromoDef[] = [
  { id: 'kingcobra', code: '__PROMOTION_CODE__', amount: 300 },
  { id: 'premium', code: '__PROMOTION_CODE__', amount: 500 },
];

/* ══ ⛔TESTONLY 전용 스위치 2개 — 정본은 «반드시» 둘 다 false ═══════════════
 *
 *  왜 필요한가: 콘솔 프로모션의 `isTested` 는 앱이 «실제로» TEST_ 코드로 지급 API 를
 *  부를 때만 켜지고, 그게 RUNNING 의 전제조건이다(promo_testonly_patch.mjs 머리말).
 *  그런데 이 두 미션의 달성 조건은 「킹코브라(18,000점)」·「최고급 스킨」이라
 *  실기기에서 «부팅 즉시» 태울 수가 없다. 그래서 테스트 빌드에서만 우회한다.
 *
 *  ⛔이 값이 true 인 채로 정본이 검수·출시에 나가면 «기존 보유자 전원»에게 지급되어
 *    예산이 한 번에 소진된다. mamba 의 PROMO_IGNORE_BASELINE 과 «똑같이 위험»하다.
 *    tools/promo_testonly_patch.mjs 의 `status` 가 canon 인지 반드시 확인하고 빌드한다.
 */
/** true 면 「지금 보유 중」 판정을 건너뛴다(main.ts ownsSkinFor). */
export const SKIN_PROMO_FORCE_OWNED = false;
/** true 면 「기준선에 이미 보유 → 영구 미지급」 규칙을 무시한다. */
export const SKIN_PROMO_IGNORE_BASELINE = false;

export type SkinPromoOutcome =
  | PromoOutcome
  | 'baseline-owned'
  | 'not-owned'
  | 'no-baseline';

type OwnsFn = () => boolean;

function parse(raw: string | null): MambaRecord {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as MambaRecord;
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

interface Runner {
  def: SkinPromoDef;
  init(owns: OwnsFn): Promise<MambaRecord>;
  notify(): Promise<SkinPromoOutcome>;
  eligible(): Promise<boolean>;
  snapshot(): Promise<MambaRecord>;
  bridgeCalls(): number;
}

function makeRunner(def: SkinPromoDef): Runner {
  async function loadRecord(code: string): Promise<MambaRecord> {
    try {
      const { local, native } = await promoStorage.readBoth(recordKeyFor(code));
      // ★병합 규칙은 «가져다» 쓴다. 복사하면 두 규칙이 갈라진다.
      return mergeRecords(parse(local), parse(native));
    } catch {
      return {};
    }
  }

  /** 쓰기는 항상 «기존 레코드에 병합» — 기준선을 지급 기록이 덮어쓰면 안 된다. */
  async function saveRecord(code: string, patch: MambaRecord): Promise<void> {
    const cur = await loadRecord(code);
    await promoStorage.write(recordKeyFor(code), JSON.stringify({ ...cur, ...patch, code }));
  }

  const claimer = createPromoClaimer({
    inToss: isInToss,
    readConfig: () => ({ code: def.code, amount: def.amount }),
    loadRecord,
    saveRecord,
    callBridge: (method, params) => callGrant(method, params),
    now: () => Date.now(),
  });

  let owns: OwnsFn = () => false;
  let baseline: Promise<MambaRecord> | null = null;

  const safeOwns = (): boolean => {
    try {
      return owns() === true;
    } catch {
      return false;
    }
  };

  return {
    def,
    init(fn: OwnsFn): Promise<MambaRecord> {
      owns = fn;
      if (baseline) return baseline;
      baseline = (async (): Promise<MambaRecord> => {
        try {
          const rec = await loadRecord(def.code);
          if (typeof rec.baselineAt === 'number' && typeof rec.ownedAtBaseline === 'boolean') return rec;
          const fresh: MambaRecord = {
            ...rec,
            code: def.code,
            baselineAt: Date.now(),
            ownedAtBaseline: safeOwns(), // ★「이미 달성한 사람 제외」의 유일한 판정 지점
          };
          await saveRecord(def.code, fresh);
          console.log(`[promo] 기준선 확정 id=${def.id} ownedAtBaseline=${fresh.ownedAtBaseline}`);
          return fresh;
        } catch (e) {
          console.error(`[promo] 기준선 확정 실패(${def.id}) — 이번 실행은 미지급: ${String(e)}`);
          return { ownedAtBaseline: true }; // 모르면 «덜 주는» 쪽
        }
      })();
      return baseline;
    },

    async notify(): Promise<SkinPromoOutcome> {
      try {
        if (!baseline) return 'no-baseline';
        const rec = await baseline;
        if (!SKIN_PROMO_IGNORE_BASELINE && rec.ownedAtBaseline === true) return 'baseline-owned';
        if (!safeOwns()) return 'not-owned';
        return await claimer.claim();
      } catch (e) {
        console.error(`[promo] 지급 판정 예외(${def.id}) — 게임은 계속: ${String(e)}`);
        return 'failed';
      }
    },

    async eligible(): Promise<boolean> {
      try {
        if (!baseline) return true;
        if (SKIN_PROMO_IGNORE_BASELINE) return true;
        return (await baseline).ownedAtBaseline !== true;
      } catch {
        return true;
      }
    },

    snapshot: () => loadRecord(def.code),
    bridgeCalls: () => claimer.bridgeCalls(),
  };
}

const RUNNERS: Runner[] = SKIN_PROMOS.map(makeRunner);

/** 부팅 시 1회. @param ownsFor 프로모션 id → 「지금 보유 중인가」 */
export function initSkinPromos(ownsFor: (id: string) => boolean): Promise<unknown> {
  return Promise.all(RUNNERS.map((r) => r.init(() => ownsFor(r.def.id))));
}

/** 보유 여부가 바뀔 수 있는 «모든» 지점에서 부른다. fire-and-forget. */
export function notifySkinPromos(): Promise<SkinPromoOutcome[]> {
  return Promise.all(RUNNERS.map((r) => r.notify()));
}

/** 검사기 전용 — 전 프로모션 상태 스냅샷. */
export async function skinPromoSnapshot(): Promise<
  Array<{ id: string; code: string; amount: number; calls: number; eligible: boolean; rec: MambaRecord }>
> {
  return Promise.all(
    RUNNERS.map(async (r) => ({
      id: r.def.id,
      code: r.def.code,
      amount: r.def.amount,
      calls: r.bridgeCalls(),
      eligible: await r.eligible(),
      rec: await r.snapshot(),
    })),
  );
}
