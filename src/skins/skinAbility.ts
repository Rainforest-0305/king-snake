// skinAbility.ts — 고급 스킨의 «특수 기능». 뱀의 실제 특성에서 가져왔다.
//
// ══ 규율: 보호 파일을 «한 바이트도» 안 고친다 ═════════════════════════════
//  game/world.ts · snake.ts · config.ts · orbs.ts 는 전부 보호 파일이다.
//  그래서 여기서는 그 클래스들의 «공개 API 만» 쓴다 — reward/gameEffects.ts 가
//  부활·부스트로 이미 증명한 방식 그대로다.
//    world.player / world.time / world.orbs / world.hooks
//    orbs.n / .xs / .ys / .vs / .cs / .colorTable / .removeAt()
//    snake.mass / .x / .y / .pickRadius / .updateDerived()
//
// ══ 왜 «흡수 반경» 하나로 두 능력을 만드는가 ══════════════════════════════
//  능력마다 다른 원시동작을 만들면 밸런스를 각각 재야 하고, 그중 하나가
//  판정·저장·순위에 손대는 순간 보호 파일을 건드려야 한다. 원시동작을 «하나»로
//  두면 능력 차이는 «반경과 지속시간»이라는 숫자 두 개로 환원된다 —
//  측정할 수 있고, 되돌릴 수 있고, 서로 비교할 수 있다.
//
// ══ ⚠️밸런스: 이건 «수확 속도»지 «전투력»이 아니다 ═══════════════════════
//  무적·속도·충돌 판정은 «절대» 건드리지 않는다. 그쪽을 건드리면 스킨이
//  「이겨서 얻는 상」이 아니라 「이기게 해 주는 도구」가 된다(pay/grind-to-win).
//  흡수 반경은 «내가 이미 만든 잔해를 더 잘 줍는» 능력이라 상대에게서 빼앗지 않는다.

import { World } from '../game/world';
import { MASS_PER_VALUE, MAGNET_RADIUS_K } from '../game/config';

/* ══ ⚠️랭킹 유불리 — 명시 (President 2026-09-02 지시) ══════════════════════
 *
 *  이 능력들은 «순위에 유리하다». 숨기지 않고 여기 적는다.
 *
 *    무엇을 바꾸나  : «수확 속도»만. 이미 바닥에 있는 오브를 더 넓게 줍는다.
 *    무엇을 안 바꾸나: 속도·선회·충돌 반경·무적·상대 판정 — 전부 무접촉이다.
 *                     즉 «상대에게서 빼앗지 않는다». PvP 전투력이 아니다.
 *    유리한 정도    : 열 감지 = 흡입 반경 5.0 → 6.4 배(면적 기준 ×1.64)
 *                     독      = 킬 직후 3초만 13.0 배(면적 ×6.8) — 짧고 굵다
 *    ⇒ 순위표는 «질량» 기준이므로 수확이 빠르면 순위가 오른다. 유리하다.
 *
 *  ★이 유불리를 받아들일지는 President 결정이다. 그래서 «끌 수 있게» 만들었다 —
 *    아래 SKIN_ABILITIES_ENABLED 를 false 로 두면 능력이 전부 죽는다.
 *    스킨·UI·해금은 그대로 살아 있고(코스메틱으로만 남는다), 게임 규칙만 원래대로다.
 *    ⛔호출부에 조건을 흩뿌리지 마라 — 스위치는 이 상수 «하나»다.
 */
export const SKIN_ABILITIES_ENABLED = true;

/** 능력 식별자. ★스킨 id 가 아니라 «능력» id 다 — 여러 스킨이 같은 능력을 가질 수 있다. */
export type AbilityId = 'heatSense' | 'venom';

/**
 * ★ 스킨 → 능력 «단일 정본». UI 설명(skinText)·런타임(아래)·검사기가 전부 여기를 본다.
 *   여기 없는 스킨은 능력이 «없다». 새 스킨은 기본이 무능력이다(조용히 안 생긴다).
 */
export const SKIN_ABILITIES: Readonly<Record<string, AbilityId>> = {
  // 살무사과의 «피트 기관» — 눈과 코 사이로 온혈 동물의 체온을 본다.
  rhinoviper: 'heatSense',
  // 이 종의 독은 신경독이라 «즉시» 듣는다. 잡은 자리를 바로 흡수한다.
  bluecoral: 'venom',
};

/**
 * 이 스킨의 능력. ★스위치가 꺼져 있으면 «항상 null» —
 *   UI(설명 줄·카드 표식)와 런타임이 «같은 함수»에 물으므로, 끄면 화면에서도
 *   능력이 사라진다. 「게임에선 안 도는데 설명은 남아 있는」 상태가 안 생긴다.
 */
export function abilityOf(skinId: string): AbilityId | null {
  if (!SKIN_ABILITIES_ENABLED) return null;
  return SKIN_ABILITIES[skinId] ?? null;
}

export function hasAbility(skinId: string): boolean {
  return abilityOf(skinId) !== null;
}

/* ─────────────────────────── 밸런스 상수 ───────────────────────────
 * 전부 «머리 먹기 반지름(pickRadius)»의 배수다. 절대값(유닛)으로 박으면
 * 몸이 커질 때 능력이 «상대적으로 약해진다» — config 의 MAGNET_RADIUS_K(5.0)와
 * 같은 기준을 써야 크기와 무관하게 같은 체감이 난다.
 */

/** 열 감지: 상시. 기본 흡입(5.0)보다 조금 넓다 — «상시»라 크게 주면 안 된다. */
export const HEAT_SENSE_K = 6.4;

/** 독: 킬 직후에만. 짧고 굵다. */
export const VENOM_K = 13.0;
/** 독이 도는 시간(초). */
export const VENOM_S = 3.0;

/* == 능력의 <<사실>> - 화면 문구가 여기서 <<유도>>된다 =======================
 *
 *  * 문구와 구현이 어긋나면 그건 허위 표시다. 그래서 UI 는 "1.28배" 라는
 *    숫자를 <<들고 있지 않는다>> - 아래 배수를 그때그때 계산해 받아 간다.
 *    HEAT_SENSE_K 를 만지면 화면 숫자가 <<같은 커밋에서>> 따라 바뀐다.
 *
 *  * 기준이 왜 MAGNET_RADIUS_K 인가: 능력이 없는 뱀도 이미 pickRadius x 5.0
 *    안의 오브를 빨아들인다(world.ts:579 s.pickRadius * MAGNET_RADIUS_K).
 *    유저가 체감하는 것은 "기본 흡입의 몇 배까지 닿느냐" 하나다. 절대 유닛으로
 *    적으면("반경 61") 유저에게 아무 뜻이 없고, 몸이 커지면 틀린 말이 된다.
 */
export interface AbilityFacts {
  /** 흡입 반경이 <<기본(MAGNET_RADIUS_K)의 몇 배>>인가. */
  readonly radiusMul: number;
  /** 'always' = 상시 / 'burst' = 처치 직후 seconds 초 동안만. */
  readonly window: 'always' | 'burst';
  /** window==='burst' 일 때만 의미가 있다(초). */
  readonly seconds: number;
}

/**
 * 이 능력의 실제 수치. * 스위치가 꺼져 있으면 <<null>> - 설명이 능력과 함께 사라진다.
 *   능력 식별자가 아니라 스킨 id 를 받는다: 호출부(UI)가 스위치를 두 번 묻지 않게.
 */
export function abilityFactsOf(skinId: string): AbilityFacts | null {
  const a = abilityOf(skinId);
  if (!a) return null;
  return a === 'venom'
    ? { radiusMul: VENOM_K / MAGNET_RADIUS_K, window: 'burst', seconds: VENOM_S }
    : { radiusMul: HEAT_SENSE_K / MAGNET_RADIUS_K, window: 'always', seconds: 0 };
}

export interface AbilityRuntime {
  /** 판 시작마다 부른다. */
  reset(): void;
  /** 내가 누군가를 잡았다. */
  onPlayerKill(world: World): void;
  /** 매 프레임. @returns 이번 프레임에 흡수한 오브 수(계측·검증용). */
  tick(world: World, skinId: string): number;
  /** ?debug=1 진단. */
  state(): { venomUntil: number; absorbed: number };
}

/**
 * 능력 런타임.
 *
 * ★ 「지금 어떤 스킨인가」를 «매 프레임 인자로» 받는다. 내부에 들고 있으면
 *   메뉴에서 스킨을 바꿨을 때 옛 능력이 남는다(상태를 두 곳에 두면 반드시 갈린다).
 */
export function createAbilityRuntime(): AbilityRuntime {
  let venomUntil = 0;
  let absorbed = 0;

  return {
    reset(): void {
      venomUntil = 0;
      absorbed = 0;
    },

    onPlayerKill(world: World): void {
      venomUntil = world.time + VENOM_S;
    },

    tick(world: World, skinId: string): number {
      const ability = abilityOf(skinId);
      if (!ability) return 0;
      const p = world.player;
      if (!p.alive) return 0;

      let k = 0;
      if (ability === 'heatSense') k = HEAT_SENSE_K;
      else if (ability === 'venom') k = world.time < venomUntil ? VENOM_K : 0;
      if (k <= 0) return 0;

      const r = p.pickRadius * k;
      const r2 = r * r;
      const orbs = world.orbs;
      let got = 0;
      let gained = 0;
      /* ★ 반드시 «역순». OrbField 는 스왑삭제라 정순으로 돌면 방금 옮겨온 항목을
         건너뛴다(orbs.ts 경고 · gameEffects.reclaimPlayerDeathOrbs 와 같은 이유). */
      for (let i = orbs.n - 1; i >= 0; i--) {
        const dx = orbs.xs[i] - p.x;
        const dy = orbs.ys[i] - p.y;
        if (dx * dx + dy * dy > r2) continue;
        gained += orbs.vs[i] * MASS_PER_VALUE;
        // 먹은 «자리»를 알려 준다 — 흡수 파티클·효과음이 평소 먹기와 같아야
        // 유저가 「능력이 돌고 있다」를 화면에서 읽는다.
        world.hooks.onEat?.(orbs.xs[i], orbs.ys[i], orbs.colorTable[orbs.cs[i]] ?? '#fff', orbs.vs[i]);
        orbs.removeAt(i);
        got++;
      }
      if (got > 0) {
        // world.ts 의 먹기 경로와 «같은 순서»다: mass 더하고 → 파생값 갱신.
        p.mass += gained;
        p.updateDerived();
        absorbed += got;
      }
      return got;
    },

    state() {
      return { venomUntil, absorbed };
    },
  };
}
