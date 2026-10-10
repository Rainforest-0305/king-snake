// gameEffects.ts — 리워드 보상을 «게임 상태»에 적용한다.
//
// ══ 규율: 보호 파일을 «한 바이트도» 안 고친다 ═════════════════════════════
//  game/world.ts · game/snake.ts · game/config.ts · game/orbs.ts 는 전부
//  tools/check_protected.mjs 의 보호 목록이다. 그래서 여기서는 그 클래스들의
//  «공개 API 만» 쓴다. 실제로 필요한 건 전부 이미 public 이다(실측):
//     world.player / world.playerAlive / world.time / world.snakes / world.orbs
//     snake.alive / .x / .y / .angle / .targetAngle / .mass / .ghostUntil
//     snake.spawn() / .updateDerived() / .rebuildCollisionPoints()
//     orbs.n / .xs / .ys / .cs / .colorIndex() / .removeAt()
//  ⇒ 「부활하려면 world.ts 에 revive() 를 넣어야 한다」는 «가정»이었다. 아니었다.

import { World } from '../game/world';
import { Snake } from '../game/snake';
import {
  LEN_K, LEN_MIN, LEN_POW, SPAWN_ARC_MAX_TURN, SPAWN_ARC_R_MIN,
  SPAWN_GHOST_PLAYER, START_MASS, WORLD_R,
} from '../game/config';

/* ════════════════════════════════════════════════════════════════════════
 * ① 부활 (President 요구 1: 위치·길이·점수 유지 + 짧은 무적 + 판당 1회)
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 부활 무적 시간(초). 정상 스폰과 «같은 값»을 쓴다 —
 * 부활만 특별히 길면 「부활이 유리한 스폰」이 되고, 짧으면 즉사한다.
 */
export const REVIVE_GHOST_S = SPAWN_GHOST_PLAYER;

/** 경계 사망 부활 시 머리를 이 비율 지점까지 «안쪽»으로 당긴다. */
const BORDER_PULL_R = 0.985;

export interface ReviveOptions {
  /** 사망 원인. 'border' 면 «머리를 안쪽으로 돌려» 놓지 않으면 즉시 재사망한다. */
  cause: 'body' | 'border' | 'headon';
}

/**
 * 그 자리에서 부활시킨다. @returns 회수한 «내 색» 오브 수.
 *
 * ★ 왜 이것만으로 되는가(world.step 실측):
 *   사망은 `explode(s)` → `s.alive = false` → `playerAlive = false` 세 줄이 전부다.
 *   trail(몸통 폴리라인)·x/y/angle·mass 는 «그대로 남아 있다» — 죽은 뱀은
 *   step 루프에서 `if (!s.alive) continue` 로 건너뛰어질 뿐이다.
 *   그래서 alive 를 다시 세우면 «죽은 그 프레임의 몸» 그대로 이어 달린다.
 *   길이·점수(= mass)가 보존되는 것도 그 때문이다. 따로 복원할 게 없다.
 *
 * ★ ⚠️경계(border) 사망만 다르다 — resolveCollisions 의 경계 검사는
 *   «유령에게도» 걸린다(ghostUntil 검사보다 «먼저» 나온다, world.ts 실측).
 *   머리가 밖에 있는 채로 부활시키면 다음 스텝에서 그대로 다시 죽는다.
 *   ⇒ 머리를 반지름 안쪽으로 당기고 «중심을 향해» 각도를 튼다.
 *     각도를 안 틀면 SPEED_BASE(205u/s) 로 즉시 다시 나간다 — 선회로는 못 막는다.
 *
 * ★ 무적 중에는 남을 죽이지도 못한다(유령은 충돌 색인에 안 들어간다).
 *   「부활하자마자 무적으로 상대를 잡는」 악용이 원천 차단된다.
 */
export function reviveInPlace(world: World, opts: ReviveOptions): number {
  const p = world.player;

  if (opts.cause === 'border') {
    const d = Math.hypot(p.x, p.y);
    const inward = Math.atan2(-p.y, -p.x);
    if (d > 0) {
      const k = (WORLD_R * BORDER_PULL_R) / d;
      p.x *= k;
      p.y *= k;
    }
    p.angle = inward;
    p.targetAngle = inward;
  }

  p.alive = true;
  world.playerAlive = true;
  // 질주 상태를 «끄고» 시작한다. 광고를 보는 동안 손가락은 화면에서 떨어져 있었다.
  p.boosting = false;
  p.ghostUntil = world.time + REVIVE_GHOST_S;
  p.updateDerived();
  p.rebuildCollisionPoints();
  // @returns 회수한 오브 수. ★「지웠다」가 아니라 «몇 개 지웠는가»를 돌려줘야
  //   검사기가 0 과 구분할 수 있다(0건은 부재의 증거가 아니다).
  return reclaimPlayerDeathOrbs(world);
}

/**
 * 사망 폭발로 흘린 «내 색» 오브를 회수한다.
 *
 * ★ 왜 필요한가 (밸런스 구멍):
 *   explode() 는 죽는 순간 질량의 DEATH_DROP_RATIO(0.76) 를 오브로 뿌린다.
 *   길이를 그대로 두고 부활시키면 «내 몸 위에» 내 질량의 76% 가 떠 있게 된다.
 *   그걸 다시 주우면 광고 1회로 질량이 1.76배가 된다 — 부활이 아니라 «증식»이다.
 *   판당 1회로 막혀 있어도 순위표가 왜곡될 만큼 크다.
 *   ⇒ 부활 시 내 색 오브를 «전부» 지운다. 길이는 유지, 흘린 것은 사라진다.
 *     (원래 질주로 흘려 둔 내 오브도 같이 사라진다. 그쪽으로 «불리한» 방향이라
 *      어뷰징이 되지 않는다 — 안전한 쪽으로 틀리게 만든 것이다.)
 *
 * ★ 왜 «색»으로 고르나: OrbField 는 스왑삭제라 인덱스를 프레임 너머로 못 든다
 *   (orbs.ts 머리말). 소유자 필드도 없다. 남는 식별자는 colorIndex 하나다.
 *   플레이어 스킨 12종의 대표색과 봇 팔레트 12종·먹이 10색은 «서로 겹치지 않는다»
 *   (skins.ts 실측). 따라서 이 색 = 내가 흘린 것, 이 등식이 성립한다.
 *   ⚠️이 전제가 깨지려면 skins.ts 의 대표색이 BOT_PALETTE/FOOD_COLORS 와 겹쳐야 한다.
 *     그때는 봇 오브가 지워진다(플레이어에게 «불리»한 방향이라 어뷰징은 아니다).
 */
export function reclaimPlayerDeathOrbs(world: World): number {
  const orbs = world.orbs;
  const colors = world.player.style.colors;
  if (!colors || colors.length === 0) return 0;
  // ★ colorIndex 는 «인턴»이다. 이미 등록된 색이면 기존 인덱스를 돌려준다(새로 안 만든다).
  const mine = orbs.colorIndex(colors[0]);
  let removed = 0;
  // ★ 반드시 «역순». 스왑삭제라 정순으로 돌면 방금 옮겨온 항목을 건너뛴다(orbs.ts 경고).
  for (let i = orbs.n - 1; i >= 0; i--) {
    if (orbs.cs[i] !== mine) continue;
    orbs.removeAt(i);
    removed++;
  }
  return removed;
}

/* ════════════════════════════════════════════════════════════════════════
 * ② 시작 크기 부스트 (President 요구 2: 기본 «길이»의 1.3~1.5배)
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 시작 «몸길이» 배수. President 지시 범위(1.3~1.5)의 한가운데.
 *
 * ★ 「길이」다. 「질량」이 아니다 — 둘은 선형이 아니다.
 *   bodyLen = LEN_MIN + LEN_K · mass^LEN_POW (config.ts)
 *   질량을 1.4배 하면 길이는 1.04배밖에 안 는다(눈에 «안 보인다»).
 *   유저가 「길게 시작」이라고 읽는 것은 화면에서 보이는 몸길이다.
 */
export const START_BOOST_LEN_K = 1.4;

/**
 * 목표 몸길이를 내는 질량을 «역산»한다.
 *
 * ★ 상수를 박지 않는다. config.ts 의 LEN_* 가 바뀌면 이 값도 «따라 움직여야» 한다.
 *   숫자를 박아 두면 밸런스 조정 뒤에도 테스트가 옛 값을 통과시킨다
 *   (auto-memory 「테스트가 틀린 값을 고정한다」의 실사고 형태 그대로다).
 */
export function boostedStartMass(): number {
  return boostedStartMassFrom(START_MASS);
}

/**
 * «주어진 시작 질량» 위에 부스트(길이 1.4배)를 얹은 질량.
 * ★2026-09-10(레인 A): 「이번 판 성장 이어받기」(reward/carryStore.ts)로 시작 질량이 START_MASS 가 아닐 수
 *   있게 됐다. 부스트는 «길이 배수»라 이어받기 위에 그대로 곱한다 — 두 보상이 서로를 잠식하지 않는다.
 *   boostedStartMass() 는 이 함수에 START_MASS 를 넣은 것이라 기존 검사기(R4)의 값은 그대로다.
 */
export function boostedStartMassFrom(base: number): number {
  const target = Snake.bodyLenFor(base) * START_BOOST_LEN_K;
  const raw = Math.pow(Math.max(0, target - LEN_MIN) / LEN_K, 1 / LEN_POW);
  return Math.max(base, Math.round(raw));
}

/**
 * 새로 만든 월드의 플레이어를 «길게» 다시 눕힌다. startRun 직후에만 부른다.
 *
 * ★ 왜 mass 만 올리면 안 되나: 몸통 trail 은 spawn() 이 «그때의 몸길이만큼»
 *   깔아 둔 것이다. mass 만 키우면 bodyLen 이 늘어나 몸이 «없는 구간»을 가리키고,
 *   자라는 몇 초 동안 몸이 짧게 보인다(= 유저 눈에는 부스트가 «안 걸린» 것이다).
 *   ⇒ 같은 머리 위치·각도로 spawn() 을 다시 부른다. 머리 자리는 World 생성자가
 *     이미 여유(clearance)를 보고 고른 자리라 그대로 쓴다.
 *
 * ★ 유령 시간은 정상 스폰과 «같게» 다시 준다(spawn() 이 ghostUntil 을 안 건드리므로
 *   명시로 세운다). 늘어난 몸이 남의 몸에 겹쳐도 유령이라 아무도 안 죽는다.
 *
 * @returns 적용된 질량(계측·검증용).
 */
export function applyStartBoost(world: World): number {
  return applyStartMass(world, boostedStartMass());
}

/**
 * 시작 질량을 «주어진 값»으로 다시 눕힌다(2026-09-10 — 부스트·이어받기가 «같은 경로»를 탄다).
 * ★ 스폰 규칙은 applyStartBoost 의 것 그대로다: 같은 머리 자리·각도, arcR 은 World.spawnSnake 와 같은 식,
 *   유령 시간은 정상 스폰과 같게. 부르는 쪽(main.startRun)이 질량을 «한 번» 계산해 넘긴다.
 * @returns 적용된 질량(계측·검증용).
 */
export function applyStartMass(world: World, mass: number): number {
  const p = world.player;
  // arcR/turn 은 World.spawnSnake 와 같은 규칙으로 다시 만든다(private 이라 못 부른다).
  const bodyLen = Snake.bodyLenFor(mass);
  const arcR = Math.max(SPAWN_ARC_R_MIN, bodyLen / SPAWN_ARC_MAX_TURN); // spawnArcRadius() 와 같은 식(그 함수는 module-private)
  p.spawn(p.x, p.y, p.angle, mass, arcR, 1);
  p.ghostUntil = world.time + SPAWN_GHOST_PLAYER;
  p.rebuildCollisionPoints();
  return mass;
}

/** 화면에 보여줄 배수 문구용(소수 한 자리). */
export function startBoostLabel(): string {
  return String(START_BOOST_LEN_K);
}

/* ════════════════════════════════════════════════════════════════════════
 * ③ 기록 돌파 성장 (President 2026-08-31: 「특정 지점 넘을 때마다 1.2배 커지기」)
 *
 * ══ ②와 «왜» 경로를 나눴나 ═══════════════════════════════════════════════
 *  ② applyStartBoost 는 «판이 시작되기 전»에 spawn() 을 다시 불러 몸을 새로 눕힌다.
 *    그건 머리 자리가 World 생성자가 고른 «빈 자리»라서 가능한 일이다.
 *  ③ 은 «판이 굴러가는 도중»이다. 여기서 spawn() 을 부르면 몸통 trail 이 통째로
 *    새로 깔리면서 뱀이 «순간이동»한다 — 주변 뱀 사이에 새 몸이 겹쳐 박히고,
 *    유저 눈에는 조작하던 몸이 사라졌다가 다른 모양으로 나타난다.
 *  ⇒ 그래서 ③ 은 mass 만 올린다. 몸통은 «먹었을 때와 똑같이» 앞으로 나아가며
 *    자란다(Snake.step 의 trail.trimTo(bodyPointCount()) 가 매 스텝 조금씩 늘려 준다).
 *
 * ══ 왜 「길이 배수」가 아니라 「질량 배수」인가 ════════════════════════════
 *  ② 는 President 가 「기본 «크기»의 1.3~1.5배」라고 «보이는 몸길이»를 지시했다.
 *  ③ 은 「1.2배 커지기」인데, 이 게임에서 유저가 읽는 숫자(HUD 「길이」·순위표·
 *    최종 점수)는 전부 Math.floor(mass) 다(world.ts:505 · main.ts HUD 실측).
 *    즉 유저에게 «1.2배»로 검증되는 값은 질량이다. 몸길이를 1.2배로 하면
 *    점수는 1.36배가 되어(LEN_POW 0.55 의 역함수) 지시보다 «더» 준다.
 *  ⇒ 질량 1.2배 = 점수 1.2배 = 화면 숫자 1.2배. 몸길이는 1.104배 늘어난다.
 * ══════════════════════════════════════════════════════════════════════ */

/** 기록 돌파 보상 배수. ★질량(=화면에 뜨는 점수) 기준이다. */
export const GROWTH_MASS_K = 1.2;

export interface GrowthApplied {
  /** 보상의 «기준»이 된 질량 = 광고 때문에 월드가 멈춘 순간의 질량. */
  fromMass: number;
  /**
   * 보상을 «적용하기 직전»의 실제 질량. 정상 경로에서는 fromMass 와 같다
   * (광고 중 월드가 멈춰 있으므로). 늦은 보상 경로에서만 달라질 수 있어
   * 「무엇을 기준으로 줬는가」를 검사기가 구분할 수 있게 따로 남긴다.
   */
  preMass: number;
  toMass: number;
  /** 화면에 뜨는 점수 기준 전/후. Math.floor 라 배수가 정확히 1.2 가 아닐 수 있다. */
  fromScore: number;
  toScore: number;
  fromRadius: number;
  toRadius: number;
}

/**
 * 살아 있는 플레이어를 «그 자리에서» 1.2배로 키운다.
 *
 * ★ 즉사 위험이 «없다»는 근거(수치로 확인한 것이지 느낌이 아니다):
 *   충돌은 머리 대 몸통점이고 문턱은 `내 radius + 상대 radius` 다(world.resolveCollisions).
 *   radius = R_MIN + (R_MAX-R_MIN)·m/(m+R_SCALE) = 6.2 + 27.8·m/(m+900) 이므로
 *     질량 2,000 → 2,400 일 때 25.37 → 26.42 (+1.05 유닛)
 *     질량   500 →   600 일 때 16.13 → 17.32 (+1.19 유닛)
 *   즉 판정 반경이 최대 «1.2 유닛» 넓어진다. 머리 속도가 SPEED_BASE 205 u/s 이니
 *   이건 «6ms 앞당겨진 것»과 같다 — 그 6ms 안에 있었다면 어차피 죽는 위치였다.
 *   ⇒ 그래서 이 보상에 무적(ghost)을 «주지 않는다». 무적을 주면
 *     「막히면 문턱을 일부러 넘어 3초 무적으로 빠져나가는」 경로가 새로 생긴다.
 *
 * ★ 몸통이 «즉시» 길어지지도 않는다 — trail 은 이미 옛 길이로 잘려 있고
 *   trimTo 는 늘리지 않는다. 새 길이는 앞으로 나아가며 채워진다(순간이동 0).
 *
 * ★ 질주 상태는 끈다. 손가락은 광고를 보는 동안 화면에서 떨어져 있었다.
 *
 * ★★ 기준 질량을 «인자로 받는다»(President 2026-09-01: 「광고 시청 직전의 1.2배」).
 *   현재 질량을 그냥 쓰면 안 되는 이유가 실제로 생겼다 — 제안 배너가 떠 있는 5초
 *   동안 게임이 «계속 흐르기» 때문이다. 그 사이 질량은 먹어서 늘 수도, 질주
 *   (BOOST_DRAIN)로 줄 수도 있다. 그래서 「광고가 화면을 덮어 월드가 멈추는 그
 *   순간」의 값을 호출부가 찍어 두고 여기로 넘긴다.
 *   ⇒ 이 함수는 «어느 시점의 질량인지» 판단하지 않는다. 그건 호출부의 책임이다.
 *
 * @param baseMass 광고 직전(= 월드가 멈춘 순간)의 질량. 여기에 k 를 곱한다.
 */
export function applyGrowthReward(
  world: World, baseMass: number, k: number = GROWTH_MASS_K,
): GrowthApplied {
  const p = world.player;
  const fromMass = baseMass;
  const preMass = p.mass;
  const fromRadius = p.radius;
  p.mass = fromMass * k;
  p.boosting = false;
  p.updateDerived();
  p.rebuildCollisionPoints();
  return {
    fromMass,
    preMass,
    toMass: p.mass,
    fromScore: Math.floor(fromMass),
    toScore: Math.floor(p.mass),
    fromRadius,
    toRadius: p.radius,
  };
}

/** 화면에 보여줄 배수 문구용(소수 한 자리). */
export function growthLabel(): string {
  return String(GROWTH_MASS_K);
}
