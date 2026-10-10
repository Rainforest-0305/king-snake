/**
 * 프로모션 「블랙맘바 해금하기」 500원 — 판정·지급. 2026-09-01 신설
 *
 * ══ 사양(President 2026-09-01 — 전 프로모션 공통 지시) ═════════════════════
 *   「모든 프로모션을, 프로모션 개설 전에 이미 달성한 사람에게는 지급하지 않도록 해.」
 *
 *   ⇒ 이 미션은 «상태 보유형»이라 다음과 같이 판정한다:
 *        기준선(baseline) = 이 코드가 든 빌드가 그 기기에서 «처음 실행되는 순간»
 *        · 기준선에 «이미 블랙맘바 보유»  → ★영구 미지급. 다시는 지급 대상이 되지 않는다.
 *        · 기준선에 «미보유» → 이후 «보유로 전이»하는 순간 1회 지급.
 *   ⛔ 「지금 보유 중이면 준다」로 만들면 안 된다 — 그 순간 기존 최상위 유저 전원에게
 *      500원 × 10건(예산 5,000원)이 한꺼번에 나간다.
 *
 * ══ 블랙맘바 «보유»의 정의(실측, game/skins.ts · main.ts) ══════════════════
 *   보유 = `isSkinUnlocked(mamba, save.bestScore)`  (최고점수 ≥ 12000)
 *        ‖ `isSkinAdUnlocked('mamba')`             (리워드 광고로 영구 해금)
 *   두 경로 중 어느 쪽으로 열려도 «해금»이다. 그래서 판정을 main.ts 의
 *   ownsTargetSkin 콜백 하나로 주입받는다 — 규칙을 두 곳에 적지 않기 위해서다.
 *
 *   ★2026-09-01 President 지시로 «광고 경로가 신규 차단»됐다 — mamba 는
 *     game/skins.ts `AD_UNLOCKABLE_SKIN_IDS`(하위 5종) «밖»이라 이제 광고로 열리지
 *     않는다. 지금 이 미션의 유일한 경로는 «최고점수 12,000»이다(검증 M2).
 *     ⚠️그래도 위 «보유» 정의는 그대로 둔다 — 차단 «전에» 광고로 연 유저가 실재하고,
 *       그 사람에게서 스킨을 뺏지 않기 위해서다(회수 금지, 검증 M0b·M2b).
 *
 * ══ 저장 — ★프로모션 «코드별» 단일 레코드 ═════════════════════════════════
 *        king-snake.promo.v1:<promotionCode>
 *   레코드 하나에 기준선과 지급 기록을 «같이» 둔다(President 지시: 코드별 기록과 같은 레코드).
 *     { baselineAt, ownedAtBaseline, code, grantedAt?, key?, viaAlreadyGranted? }
 *   ⛔단일 키(코드 무관) 금지 — 08-29 3앱 실결함(코드 교체 시 옛 기록이 새 지급을 영구 차단).
 *   ⛔`king-snake.save`(save.ts) · `king-snake.reward.v1`(rewardStore.ts) 무접촉.
 *
 * ══ 로컬·네이티브 병합 규칙(중요) ══════════════════════════════════════════
 *   저장을 두 곳(localStorage + 네이티브 Storage)에 쓴다. 읽을 때 한쪽이 비어 있을 수
 *   있는데(네이티브 지연·WebView 초기화), 그때 «없는 쪽»을 믿고 기준선을 새로 잡으면
 *   ① 지급 기록이 날아가 이중 지급이 되거나 ② 기준선이 뒤집힌다.
 *   ⇒ 병합은 «보수적»으로 한다:
 *        grantedAt        : 어느 쪽에든 있으면 «받은 것»
 *        ownedAtBaseline  : 어느 쪽이든 true 면 true (지급을 «덜» 하는 쪽)
 *        baselineAt       : 더 «이른» 값
 *
 * ⛔ 이 파일은 «절대 throw 하지 않는다». 게임 루프·결과 화면을 막으면 안 된다.
 */
import { PROMO_AMOUNT, PROMO_CODE, PROMO_IGNORE_BASELINE, PROMO_SKIN_ID } from './promoConfig';
import { callGrant, isInToss, promoStorage } from './promoBridge';
import { createPromoClaimer, type PromoOutcome, type PromoRecord } from './promoCore';

const KEY_PREFIX = 'king-snake.promo.v1:';
export function recordKeyFor(code: string): string {
  return KEY_PREFIX + code;
}

export interface MambaRecord extends PromoRecord {
  /** 이 빌드가 이 기기에서 처음 실행된 시각(ms). 없으면 기준선 미설정. */
  baselineAt?: number;
  /** ★기준선 시점에 이미 대상 스킨을 보유하고 있었는가. true 면 영구 미지급. */
  ownedAtBaseline?: boolean;
}

export type MambaOutcome =
  | PromoOutcome
  | 'baseline-owned' // 기준선에 이미 보유 → 영구 미지급
  | 'not-owned' // 아직 해금 전
  | 'no-baseline'; // 기준선을 아직 못 잡았다(부팅 직후 아주 짧은 구간)

function parse(raw: string | null): MambaRecord {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as MambaRecord;
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

/** ★보수적 병합 — 위 주석의 세 규칙. */
export function mergeRecords(a: MambaRecord, b: MambaRecord): MambaRecord {
  const out: MambaRecord = {};
  const granted = a.grantedAt ? a : b.grantedAt ? b : null;
  if (granted) {
    out.grantedAt = granted.grantedAt;
    if (granted.key !== undefined) out.key = granted.key;
    if (granted.viaAlreadyGranted !== undefined) out.viaAlreadyGranted = granted.viaAlreadyGranted;
  }
  const codes = [a.code, b.code].filter((c): c is string => typeof c === 'string' && c.length > 0);
  if (codes.length) out.code = codes[0];
  const times = [a.baselineAt, b.baselineAt].filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  if (times.length) out.baselineAt = Math.min(...times);
  if (a.ownedAtBaseline === true || b.ownedAtBaseline === true) out.ownedAtBaseline = true;
  else if (a.ownedAtBaseline === false || b.ownedAtBaseline === false) out.ownedAtBaseline = false;
  return out;
}

async function loadRecord(code: string): Promise<MambaRecord> {
  try {
    const { local, native } = await promoStorage.readBoth(recordKeyFor(code));
    return mergeRecords(parse(local), parse(native));
  } catch {
    return {};
  }
}

/** ★쓰기는 항상 «기존 레코드에 병합»한다 — 기준선을 지급 기록이 덮어쓰면 안 된다. */
async function saveRecord(code: string, patch: MambaRecord): Promise<void> {
  const cur = await loadRecord(code);
  const next: MambaRecord = { ...cur, ...patch, code };
  await promoStorage.write(recordKeyFor(code), JSON.stringify(next));
}

const claimer = createPromoClaimer({
  inToss: isInToss,
  readConfig: () => ({ code: PROMO_CODE, amount: PROMO_AMOUNT }),
  loadRecord,
  saveRecord,
  callBridge: (method, params) => callGrant(method, params),
  now: () => Date.now(),
});

/* ─────────────────────── 기준선 ─────────────────────── */

type OwnsFn = () => boolean;

let ownsTargetSkin: OwnsFn = () => false;
/** 기준선 확정 promise. ★모든 지급 판정은 이걸 «먼저» 기다린다. */
let baseline: Promise<MambaRecord> | null = null;

/**
 * 부팅 시 1회. 기준선이 없으면 «지금의 보유 여부»를 기준선으로 박는다.
 * @param owns 대상 스킨을 지금 보유 중인가(main.ts 의 판정 규칙을 그대로 주입).
 */
export function initMambaPromo(owns: OwnsFn): Promise<MambaRecord> {
  ownsTargetSkin = owns;
  if (baseline) return baseline;
  baseline = (async (): Promise<MambaRecord> => {
    try {
      const rec = await loadRecord(PROMO_CODE);
      if (typeof rec.baselineAt === 'number' && typeof rec.ownedAtBaseline === 'boolean') return rec;
      const fresh: MambaRecord = {
        ...rec,
        code: PROMO_CODE,
        baselineAt: Date.now(),
        // ★여기가 「이미 달성한 사람 제외」의 유일한 판정 지점이다.
        ownedAtBaseline: safeOwns(),
      };
      await saveRecord(PROMO_CODE, fresh);
      console.log(
        `[promo] 기준선 확정 code=${PROMO_CODE} skin=${PROMO_SKIN_ID} ownedAtBaseline=${fresh.ownedAtBaseline}`
      );
      return fresh;
    } catch (e) {
      console.error(`[promo] 기준선 확정 실패 — 이번 실행에서는 지급하지 않는다: ${String(e)}`);
      // ★실패하면 «보유했다»로 본다 = 지급하지 않는다. 모르면 «덜 주는» 쪽으로 넘어진다.
      return { ownedAtBaseline: true };
    }
  })();
  return baseline;
}

function safeOwns(): boolean {
  try {
    return ownsTargetSkin() === true;
  } catch {
    return false;
  }
}

/**
 * 「블랙맘바를 지금 보유 중인가」가 바뀌었을 수 있는 «모든» 지점에서 부른다.
 *   · 부팅(기준선 확정 직후) — 지난 실행에서 해금했는데 지급이 못 끝난 경우의 복구
 *   · 리워드 광고로 스킨을 연 직후
 *   · 판이 끝나 최고 점수가 갱신된 직후(12000 돌파)
 * fire-and-forget. 절대 throw 하지 않는다.
 */
export async function notifyMambaOwnership(): Promise<MambaOutcome> {
  try {
    if (!baseline) return 'no-baseline';
    const rec = await baseline;
    if (!PROMO_IGNORE_BASELINE && rec.ownedAtBaseline === true) return 'baseline-owned';
    if (!safeOwns()) return 'not-owned';
    return await claimer.claim();
  } catch (e) {
    console.error(`[promo] 지급 판정 예외 — 게임은 계속: ${String(e)}`);
    return 'failed';
  }
}

/**
 * 「이 기기는 이 미션을 달성할 수 «있는가»」. 기준선에 이미 보유했으면 false.
 * ★UI 문구는 «만들지 않았다» — President 결정 대기(설계안만 보고).
 */
export async function mambaMissionEligible(): Promise<boolean> {
  try {
    if (!baseline) return true;
    const rec = await baseline;
    if (PROMO_IGNORE_BASELINE) return true;
    return rec.ownedAtBaseline !== true;
  } catch {
    return true;
  }
}

export async function mambaAlreadyRewarded(): Promise<boolean> {
  return claimer.alreadyRewarded();
}

/** 검사기 전용 — 지금까지의 브릿지 실호출 횟수. 운영 로직은 읽지 않는다. */
export function mambaBridgeCalls(): number {
  return claimer.bridgeCalls();
}

/** 검사기 전용 — 현재 레코드 스냅샷. */
export function mambaRecordSnapshot(): Promise<MambaRecord> {
  return loadRecord(PROMO_CODE);
}

export { PROMO_CODE, PROMO_AMOUNT, PROMO_SKIN_ID };
