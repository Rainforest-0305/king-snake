// world.ts — 시뮬레이션 전체. 규칙은 «여기에만» 있다.
//
// ★ 렌더/DOM 을 import 하지 않는다(단방향 규칙).
//   game/ → 아무것도 모른다 / render/ → game 을 읽는다 / ui/ → 둘 다 읽는다.
//   이 방향이 깨지면 게임 규칙을 고칠 때마다 화면이 같이 깨진다.
//
// ★ 한 프레임의 «순서»가 곧 규칙이다. 순서를 바꾸면 체감이 달라진다:
//     1 입력/AI → 2 이동 → 3 충돌·사망 → 4 먹기 → 5 보충/리스폰
//   3(충돌)이 4(먹기)보다 «먼저»인 이유: 죽으면서 흩뿌린 오브를 죽인 쪽이
//   같은 프레임에 바로 먹기 시작한다. 반대로 두면 킬 직후 한 프레임이 비어
//   「먹는 손맛」이 끊긴다.

import {
  WORLD_R, START_MASS, MASS_PER_VALUE,
  FOOD_TARGET, FOOD_VALUE_MIN, FOOD_VALUE_MAX,
  MAGNET_RADIUS_K, MAGNET_PULL, EAT_MARGIN,
  DEATH_DROP_RATIO, DEATH_ORB_VALUE, DEATH_ORB_MAX, DEATH_SCATTER_K,
  DEATH_HEAD_BIAS, DEATH_BURST_MAX, DEATH_BURST_MASS, DEATH_BURST_HEAD_K,
  BOOST_DROP_RATIO, BOT_COUNT, BOT_RESPAWN_DELAY, R_MAX,
  SPAWN_GHOST_PLAYER, SPAWN_GHOST_BOT,
  SPAWN_MASS_SMALL_K, SPAWN_MASS_RESPAWN_K,
  SPAWN_MASS_MED_FRAC, SPAWN_MASS_MED, SPAWN_MASS_BIG_FRAC, SPAWN_MASS_BIG, SPAWN_MASS_MAX,
  SPAWN_MASS_TITAN_FRAC, SPAWN_MASS_TITAN, SPAWN_MASS_TITAN_MAX,
  SPAWN_ARC_R_MIN, SPAWN_ARC_MAX_TURN, SPAWN_BODY_SAMPLE,
} from './config';
import { Snake, type SnakeStyle } from './snake';
import { OrbField } from './orbs';
import { Grid } from './spatial';
import { Rng } from './rng';
import { makeBotNames } from './names';
import { BOT_PALETTE, skinById, DEFAULT_SKIN_ID } from './skins';
import { botThink, makeBotState, pickTier, type BotState, type Sensors } from './bots';

export interface KillEvent {
  killerName: string;
  victimName: string;
  killerIsPlayer: boolean;
  victimIsPlayer: boolean;
}

/** 사망 시점의 순위표 한 줄. */
export interface StandingRow {
  rank: number;
  name: string;
  score: number;
  isPlayer: boolean;
}

export interface DeathInfo {
  score: number;
  rank: number;
  kills: number;
  killerName: string | null;
  cause: 'body' | 'border' | 'headon';
  /**
   * 사망 «직전»의 최종 순위표. 상위 3줄 + 내 줄(그 밖이면) 로 추린다.
   * ★ 사망 후에 다시 계산하면 내가 ranking 에서 이미 빠져 있어 만들 수 없다.
   *   그래서 world 가 죽이는 그 자리에서 만들어 넘긴다.
   */
  standing: StandingRow[];
}

/** 렌더/UI 가 붙잡는 훅. 시뮬은 이 훅을 «부르기만» 하고 결과를 신경쓰지 않는다. */
export interface WorldHooks {
  onKill?(e: KillEvent): void;
  onPlayerDeath?(info: DeathInfo): void;
  /** 오브를 먹은 순간(파티클용). */
  onEat?(x: number, y: number, color: string, value: number): void;
  /** 뱀이 터진 순간(파티클용). */
  onBurst?(x: number, y: number, color: string, radius: number): void;
}

/**
 * 자연 발생 오브 색.
 * ★ 파스텔 → «네온»(2026-08-29, slither.io 기준 마감). 파스텔은 흰 코어와 합쳐져
 *   화면에서 «흰 점»으로 읽혔다(실렌더 확인). 원작의 먹이는 채도가 높은 색 자체가
 *   빛난다. 색상(hue) 10종은 그대로 두고 채도만 올렸다 - 스킨 배색과는 무관하다.
 */
const FOOD_COLORS = [
  '#ff4f7d', '#ffcf2e', '#2ef0b8', '#41b4ff', '#b06bff',
  '#ff8a2e', '#7af53a', '#ff6ae6', '#3ef0ff', '#ffe23a',
];

/** [a, b] 로그 균등 분포. 질량 감각은 비율이라 «층»을 로그 공간에서 뽑아야 보인다. */
function logUniform(rng: Rng, a: number, b: number): number {
  return Math.exp(rng.range(Math.log(a), Math.log(b)));
}

/**
 * ★ 판 시작 시 봇의 시작질량. 3층 혼합(config.ts SPAWN_MASS_* 주석이 정본).
 *   대부분 작고 / 일부 중간 / 소수 거대 - «오른쪽 꼬리가 긴» 분포.
 */
export function sampleSpawnMass(rng: Rng): number {
  const u = rng.next();
  /* ⑦ 초거대 층(2026-09-03). 근거·비율·상한은 config.ts SPAWN_MASS_TITAN_* 주석.
     ★맨 «위»에서 잘라 간다 — 아래 세 층의 상대 순서와 경계를 그대로 두기 위해서다. */
  if (u < SPAWN_MASS_TITAN_FRAC) {
    return logUniform(rng, SPAWN_MASS_TITAN, SPAWN_MASS_TITAN_MAX);
  }
  if (u < SPAWN_MASS_TITAN_FRAC + SPAWN_MASS_BIG_FRAC) {
    return logUniform(rng, SPAWN_MASS_BIG * 0.7, SPAWN_MASS_MAX);
  }
  if (u < SPAWN_MASS_TITAN_FRAC + SPAWN_MASS_BIG_FRAC + SPAWN_MASS_MED_FRAC) {
    return logUniform(rng, SPAWN_MASS_MED * 0.5, SPAWN_MASS_MED * 2);
  }
  return START_MASS * rng.range(1, SPAWN_MASS_SMALL_K);
}

/** 스폰 원호 반지름. 몸이 길수록 큰 원으로 눕혀 «한 바퀴»를 넘지 않게 한다. */
function spawnArcRadius(bodyLen: number): number {
  return Math.max(SPAWN_ARC_R_MIN, bodyLen / SPAWN_ARC_MAX_TURN);
}

const CAND_CAP = 4096;
const BODY_SCRATCH = 2048;
const ORB_SCRATCH = 1024;

export class World implements Sensors {
  readonly rng: Rng;
  readonly snakes: Snake[] = [];
  readonly botStates: (BotState | null)[] = [];
  readonly orbs = new OrbField(5120);
  player: Snake;
  time = 0;
  /** 플레이어가 죽은 뒤에도 월드는 계속 돈다(사망 화면 뒤에서 살아 움직이는 배경). */
  playerAlive = true;

  hooks: WorldHooks = {};

  // ── 공간 색인 ─────────────────────────────────────────────────────────────
  // 셀 크기는 «질의 반경»과 무관하게 골라도 된다(Grid.query 가 셀 범위를 계산한다).
  // 다만 너무 작으면 셀 수가 폭증하고, 너무 크면 후보가 늘어난다. 실측으로 잡은 값.
  private readonly bodyGrid = new Grid(WORLD_R + 200, 80, 8192);
  private readonly orbGrid = new Grid(WORLD_R + 200, 150, 8192);
  private allX = new Float32Array(8192);
  private allY = new Float32Array(8192);
  private allOwner = new Int32Array(8192);
  /** 이번 프레임 충돌 색인에 들어간 몸통 점 수(진단용 — ?debug=1 에 표시). */
  bodyPointCount = 0;

  private readonly cand = new Int32Array(CAND_CAP);
  readonly bodyX = new Float32Array(BODY_SCRATCH);
  readonly bodyY = new Float32Array(BODY_SCRATCH);
  readonly orbX = new Float32Array(ORB_SCRATCH);
  readonly orbY = new Float32Array(ORB_SCRATCH);
  readonly orbV = new Float32Array(ORB_SCRATCH);

  private eaten = new Uint8Array(5120);
  private readonly deadIds: number[] = [];
  private readonly deadKiller: number[] = [];
  private readonly deadCause: DeathInfo['cause'][] = [];

  /** 리더보드용: 질량 내림차순 뱀 인덱스. */
  readonly ranking: number[] = [];

  /**
   * ★ autoPilot: 0번 뱀(=플레이어 슬롯)을 AI 가 조종한다.
   *   타이틀 화면 «뒤에서 살아 움직이는 아레나»를 그리기 위한 것이다. 정지된
   *   배경 이미지를 깔면 그 순간 프로토타입처럼 보인다 - 실제 게임이 돌아가는
   *   화면을 배경으로 쓰면 「이 게임이 어떤 게임인지」가 설명 없이 전달된다.
   *   같은 코드를 그대로 쓰므로 배경 전용 렌더 경로를 따로 만들 필요도 없다.
   */
  readonly autoPilot: boolean;

  constructor(seed: number, playerName: string, playerSkinId: string, autoPilot = false) {
    this.rng = new Rng(seed);
    this.autoPilot = autoPilot;

    const skin = skinById(playerSkinId || DEFAULT_SKIN_ID);
    const player = new Snake(0, true, playerName, {
      colors: skin.colors,
      band: skin.band,
      glow: skin.glow,
      pattern: skin.pattern,
    });
    this.snakes.push(player);
    this.botStates.push(autoPilot ? makeBotState(pickTier(this.rng), this.rng) : null);
    this.player = player;

    const names = makeBotNames(this.rng, BOT_COUNT);
    for (let i = 0; i < BOT_COUNT; i++) {
      const pal = BOT_PALETTE[i % BOT_PALETTE.length];
      const style: SnakeStyle = {
        colors: pal.colors, band: pal.band, glow: pal.glow, pattern: pal.pattern,
      };
      const s = new Snake(i + 1, false, names[i], style);
      this.snakes.push(s);
      this.botStates.push(makeBotState(pickTier(this.rng), this.rng));
    }

    // 초기 먹이. ★ 한 번에 채운다 — 게임 중에 3000개를 채우면 그 프레임이 통째로 튄다.
    for (let i = 0; i < FOOD_TARGET; i++) this.spawnFood();

    // 스폰. 플레이어는 중앙 근처(첫 30초가 편해야 한다), 봇은 흩어놓는다.
    // ★ 봇 시작질량은 «분포»에서 뽑는다(sampleSpawnMass) - 판 시작에 이미 자란
    //   뱀이 섞여 있어야 slither.io 의 「접속 순간」과 같은 인상이 난다.
    //   플레이어는 START_MASS 그대로 작게 시작한다.
    this.spawnSnake(player, WORLD_R * 0.35, START_MASS);
    for (let i = 1; i < this.snakes.length; i++) {
      this.spawnSnake(this.snakes[i], WORLD_R * 0.92, sampleSpawnMass(this.rng));
    }
    this.updateRanking();
  }

  // ────────────────────────────────────────────────────────────────────────
  // 스폰
  // ────────────────────────────────────────────────────────────────────────

  private spawnFood(): void {
    const p = this.rng.inDisc(WORLD_R * 0.985);
    // 가치 분포를 «작은 쪽으로» 기울인다(제곱). 큰 알이 흔하면 성장이 너무 빠르다.
    const t = this.rng.next() * this.rng.next();
    const v = FOOD_VALUE_MIN + t * (FOOD_VALUE_MAX - FOOD_VALUE_MIN);
    this.orbs.spawn(
      p.x, p.y, v,
      this.orbs.colorIndex(this.rng.pick(FOOD_COLORS)),
      this.rng.next() * Math.PI * 2,
    );
  }

  /**
   * 다른 뱀의 몸에서 떨어진 자리를 «찾아» 스폰한다.
   * ★ 그냥 랜덤 좌표에 넣으면 남의 몸 한가운데서 태어나 즉사한다.
   *   봇이 리스폰 직후 계속 죽으면 리더보드가 미친 듯이 요동친다(실제로 그랬다).
   */
  private readonly spawnPt = { x: 0, y: 0 };

  /**
   * 후보 자리(머리 + 눕힐 몸 경로)에서 «다른 뱀 몸까지의 최소 거리».
   * ★ 머리 한 점만 재던 것을 «몸 경로 표본점»까지 재도록 넓혔다(2026-08-29).
   *   자란 채로 태어나는 봇은 몸이 수백~수천 유닛이라, 머리만 비어 있어도
   *   몸이 남의 몸 위에 겹쳐 놓일 수 있다(그러면 그 «남»이 첫 프레임에 죽는다).
   *   맵 밖(WORLD_R*0.96 바깥)으로 나가는 몸은 -1 로 «탈락»시킨다.
   *   빈자리 문턱(want)은 예전 값 그대로다 - 새 규칙을 더한 것이 아니라
   *   같은 규칙을 «몸 전체»에 적용한 것이다.
   */
  private spawnClearance(
    s: Snake, hx: number, hy: number, angle: number, arcR: number, turn: number,
    bodyLen: number, stopBelow: number,
  ): number {
    const pt = this.spawnPt;
    const limit = WORLD_R * 0.96;
    let clear = Number.POSITIVE_INFINITY;
    for (let len = 0; ; len += SPAWN_BODY_SAMPLE) {
      const last = len >= bodyLen;
      Snake.spawnPathPoint(hx, hy, angle, arcR, turn, last ? bodyLen : len, pt);
      if (Math.hypot(pt.x, pt.y) > limit) return -1;
      for (const o of this.snakes) {
        if (o === s || !o.alive) continue;
        for (let i = 0; i < o.collN; i += 3) {
          const d = Math.hypot(pt.x - o.collX[i], pt.y - o.collY[i]);
          if (d < clear) clear = d;
        }
        const dh = Math.hypot(pt.x - o.x, pt.y - o.y);
        if (dh < clear) clear = dh;
      }
      if (last) break;
      // ★ 조기 종료는 «지금까지 본 최선보다 이미 나쁠 때»만 한다.
      //   처음엔 「문턱 아래면 바로 반환」했는데, 그 값은 몸 «앞부분만» 잰 상한이라
      //   후보끼리 비교가 안 된다. 실제로 그 부분값이 «최선»으로 뽑혀 나머지 몸이
      //   플레이어 머리 26 유닛 옆을 지나가는 스폰이 나왔다(24시드 실측).
      //   부분값 < 최선 이면 참값도 그보다 작으므로 최선이 될 수 없다 - 그때만 끊는다.
      if (clear < stopBelow) return clear;
    }
    return clear;
  }

  private spawnSnake(s: Snake, maxR: number, mass: number): void {
    // 플레이어는 «더 까다롭게» 자리를 고른다. 한 판의 시작이 걸려 있어서다.
    const want = s.isPlayer ? 380 : 260;
    const bodyLen = Snake.bodyLenFor(mass);
    const arcR = spawnArcRadius(bodyLen);
    const turn = this.rng.bool() ? 1 : -1;
    // 몸이 길수록 들어갈 자리가 드물다. 시도 횟수를 몸길이에 비례해 늘린다.
    const tries = (s.isPlayer ? 48 : 24) + Math.min(48, Math.floor(bodyLen / 100));
    let bx = 0;
    let by = 0;
    let ba = 0;
    let bestClear = -Infinity;
    for (let attempt = 0; attempt < tries; attempt++) {
      const p = this.rng.inDisc(maxR);
      // 안쪽을 향해 태어나게 한다 — 태어나자마자 벽으로 달려가는 것을 막는다.
      const inward = Math.atan2(-p.y, -p.x) + this.rng.range(-0.7, 0.7);
      const clear = this.spawnClearance(s, p.x, p.y, inward, arcR, turn, bodyLen, bestClear);
      if (clear > want) { bx = p.x; by = p.y; ba = inward; bestClear = clear; break; }
      if (clear > bestClear) { bestClear = clear; bx = p.x; by = p.y; ba = inward; }
    }
    s.spawn(bx, by, ba, mass, arcR, turn);
    s.ghostUntil = this.time + (s.isPlayer && !this.autoPilot ? SPAWN_GHOST_PLAYER : SPAWN_GHOST_BOT);
    s.rebuildCollisionPoints();
  }

  // ────────────────────────────────────────────────────────────────────────
  // Sensors 구현 (봇의 감각기관)
  // ────────────────────────────────────────────────────────────────────────

  queryBody(x: number, y: number, r: number, selfId: number): number {
    const n = this.bodyGrid.query(x, y, r, this.cand);
    const r2 = r * r;
    let k = 0;
    for (let i = 0; i < n && k < BODY_SCRATCH; i++) {
      const idx = this.cand[i];
      if (this.allOwner[idx] === selfId) continue;
      const dx = this.allX[idx] - x;
      const dy = this.allY[idx] - y;
      if (dx * dx + dy * dy > r2) continue;
      this.bodyX[k] = this.allX[idx];
      this.bodyY[k] = this.allY[idx];
      k++;
    }
    return k;
  }

  queryOrbs(x: number, y: number, r: number): number {
    const n = this.orbGrid.query(x, y, r, this.cand);
    const r2 = r * r;
    let k = 0;
    for (let i = 0; i < n && k < ORB_SCRATCH; i++) {
      const idx = this.cand[i];
      const dx = this.orbs.xs[idx] - x;
      const dy = this.orbs.ys[idx] - y;
      if (dx * dx + dy * dy > r2) continue;
      this.orbX[k] = this.orbs.xs[idx];
      this.orbY[k] = this.orbs.ys[idx];
      this.orbV[k] = this.orbs.vs[idx];
      k++;
    }
    return k;
  }

  // ────────────────────────────────────────────────────────────────────────
  // 메인 스텝
  // ────────────────────────────────────────────────────────────────────────

  step(dt: number): void {
    this.time += dt;

    // 1) AI (플레이어 입력은 main.ts 가 step 전에 player 에 써 둔다)
    //    ★ i=0 부터 돈다. botStates[0] 은 autoPilot 일 때만 존재하므로
    //      일반 플레이 중에는 null 이라 그냥 건너뛴다. 분기를 늘리지 않는다.
    for (let i = 0; i < this.snakes.length; i++) {
      const s = this.snakes[i];
      const b = this.botStates[i];
      if (!s.alive || !b) continue;
      botThink(s, b, this, this.time, this.rng);
    }

    // 2) 이동 + 부스트 배출
    for (const s of this.snakes) {
      if (!s.alive) continue;
      const drop = s.step(dt);
      if (drop > 0) this.dropBoostOrb(s, drop);
    }

    // 3) 충돌 색인 → 사망 판정
    this.rebuildBodyIndex();
    this.resolveCollisions();

    // 4) 먹기
    this.rebuildOrbIndex();
    this.resolveEating(dt);

    // 5) 보충·리스폰
    this.replenishFood();
    this.respawnBots();

    this.updateRanking();
  }

  private dropBoostOrb(s: Snake, mass: number): void {
    const i = Math.max(0, s.trail.count - 1);
    const jx = this.rng.range(-6, 6);
    const jy = this.rng.range(-6, 6);
    this.orbs.spawn(
      s.trail.x(i) + jx,
      s.trail.y(i) + jy,
      mass * BOOST_DROP_RATIO * MASS_PER_VALUE,
      this.orbs.colorIndex(s.style.colors[0]),
      this.rng.next() * Math.PI * 2,
    );
  }

  private rebuildBodyIndex(): void {
    let need = 0;
    for (const s of this.snakes) {
      if (!s.alive) continue;
      s.rebuildCollisionPoints();
      // ★ 유령은 색인에 «넣지 않는다». 넣고 나서 판정에서 거르는 방식이면
      //   봇의 회피 센서(queryBody)에도 잡혀 「보이지 않는 벽」을 피하게 된다.
      if (s.ghostUntil > this.time) continue;
      need += s.collN;
    }
    if (need > this.allX.length) {
      const cap = 1 << (32 - Math.clz32(Math.max(1, need - 1)));
      this.allX = new Float32Array(cap);
      this.allY = new Float32Array(cap);
      this.allOwner = new Int32Array(cap);
    }
    let k = 0;
    for (const s of this.snakes) {
      if (!s.alive || s.ghostUntil > this.time) continue;
      for (let i = 0; i < s.collN; i++) {
        this.allX[k] = s.collX[i];
        this.allY[k] = s.collY[i];
        this.allOwner[k] = s.id;
        k++;
      }
    }
    this.bodyPointCount = k;
    this.bodyGrid.rebuild(this.allX, this.allY, k);
  }

  private rebuildOrbIndex(): void {
    this.orbGrid.rebuild(this.orbs.xs, this.orbs.ys, this.orbs.n);
  }

  private resolveCollisions(): void {
    const dead = this.deadIds;
    const killer = this.deadKiller;
    const cause = this.deadCause;
    dead.length = 0;
    killer.length = 0;
    cause.length = 0;

    const snakes = this.snakes;

    // (a) 머리 대 몸통 / 경계
    for (const s of snakes) {
      if (!s.alive) continue;

      if (Math.hypot(s.x, s.y) > WORLD_R) {
        dead.push(s.id);
        killer.push(-1);
        cause.push('border');
        continue;
      }

      // 유령은 남의 몸에 «닿아도» 죽지 않는다(경계는 위에서 이미 처리했다).
      if (s.ghostUntil > this.time) continue;

      const qr = s.radius + R_MAX;
      const n = this.bodyGrid.query(s.x, s.y, qr, this.cand);
      let hit = -1;
      for (let i = 0; i < n; i++) {
        const idx = this.cand[i];
        const owner = this.allOwner[idx];
        if (owner === s.id) continue;
        const dx = this.allX[idx] - s.x;
        const dy = this.allY[idx] - s.y;
        const rr = s.radius + snakes[owner].radius;
        if (dx * dx + dy * dy <= rr * rr) { hit = owner; break; }
      }
      if (hit >= 0) {
        dead.push(s.id);
        killer.push(hit);
        cause.push('body');
      }
    }

    // (b) 머리 대 머리 — 양쪽 다 죽는다(원작 규칙).
    //     몸통 표본점은 «목덜미»를 제외하고 뽑으므로 정면 충돌이 (a)에서 안 잡힌다.
    //     이 루프가 없으면 두 머리가 겹친 채로 서로 통과한다.
    for (let i = 0; i < snakes.length; i++) {
      const a = snakes[i];
      if (!a.alive) continue;
      if (a.ghostUntil > this.time) continue;
      for (let j = i + 1; j < snakes.length; j++) {
        const b = snakes[j];
        if (!b.alive || b.ghostUntil > this.time) continue;
        const rr = a.radius + b.radius;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy > rr * rr) continue;
        if (!dead.includes(a.id)) { dead.push(a.id); killer.push(b.id); cause.push('headon'); }
        if (!dead.includes(b.id)) { dead.push(b.id); killer.push(a.id); cause.push('headon'); }
      }
    }

    if (dead.length === 0) return;

    // ★ 순위를 «지금» 다시 계산한다.
    //   ranking 은 직전 스텝 «끝»에 계산된 값이라, 이번 스텝에 먹은 질량이
    //   반영돼 있지 않다. 사망 화면은 「길이 2,480 인데 29위」 같은 모순을
    //   그대로 보여주게 된다(실제로 9개 로케일 검사 스크린샷에서 발견했다).
    //   여기서는 아직 아무도 죽지 않았으므로 모든 뱀이 순위에 들어 있다.
    this.updateRanking();

    // ★ 판정을 «전부 모은 뒤» 적용한다. 판정 도중에 죽이면 먼저 처리된 뱀이
    //   사라져서 동시 충돌이 한쪽만 죽는 «순서 의존» 버그가 된다.
    for (let k = 0; k < dead.length; k++) {
      const s = snakes[dead[k]];
      if (!s.alive) continue;
      const killerId = killer[k];
      const killerSnake = killerId >= 0 ? snakes[killerId] : null;

      this.explode(s);
      s.alive = false;

      if (killerSnake && killerSnake.id !== s.id) {
        // 자기 자신을 죽인 것으로 세지 않는다(머리끼리 동시 사망 시 양쪽 다 킬 인정).
        killerSnake.kills++;
        this.hooks.onKill?.({
          killerName: killerSnake.name,
          victimName: s.name,
          killerIsPlayer: killerSnake.isPlayer,
          victimIsPlayer: s.isPlayer,
        });
      }

      if (s.isPlayer && !this.autoPilot) {
        this.playerAlive = false;
        this.hooks.onPlayerDeath?.({
          score: Math.floor(s.mass),
          rank: this.rankOf(s.id),
          kills: s.kills,
          killerName: killerSnake ? killerSnake.name : null,
          cause: cause[k],
          standing: this.standingAround(s.id),
        });
      } else {
        const b = this.botStates[s.id];
        if (b) b.respawnAt = this.time + BOT_RESPAWN_DELAY + this.rng.range(0, 1.2);
      }
    }
  }

  private explode(s: Snake): void {
    const total = s.mass * DEATH_DROP_RATIO * MASS_PER_VALUE;
    const count = Math.max(6, Math.min(DEATH_ORB_MAX, Math.round(total / DEATH_ORB_VALUE)));
    const per = total / count;
    const color = this.orbs.colorIndex(s.style.colors[0]);
    const pts = Math.max(1, s.trail.count);
    const scatter = s.radius * DEATH_SCATTER_K;

    for (let k = 0; k < count; k++) {
      /**
       * ★ 몸 위에 «머리 쪽으로 쏠리게» 뿌린다(trail 인덱스 0 = 머리, count-1 = 꼬리).
       *   예전에는 몸 «전체»에 균등이었다. 그게 「죽였는데 아무것도 안 남는다」의
       *   진짜 원인이었다 — 질량 1,100 뱀의 몸은 2,300 유닛인데 폰 세로에 들어오는
       *   건 1,750 유닛뿐이라 절반이 화면 밖에 떨어졌고, 그 절반마저 3,000개짜리
       *   배경 먹이밭에 섞여 눈에 띄지 않았다.
       *   지수 가중이라 «앞쪽에 촘촘, 뒤로 갈수록 성글게» — 눈앞에 보상이 쏟아지되
       *   꼬리 쪽 몫이 남아 「따라가 먹는 재미」도 유지된다.
       */
      const f = Math.pow(k / count, DEATH_HEAD_BIAS);
      const i = Math.min(pts - 1, Math.floor(f * pts));
      this.orbs.spawn(
        s.trail.x(i) + this.rng.range(-scatter, scatter),
        s.trail.y(i) + this.rng.range(-scatter, scatter),
        per,
        color,
        this.rng.next() * Math.PI * 2,
      );
    }

    /**
     * ★ 폭발도 «몸을 따라» 연쇄로 터뜨린다.
     *   예전에는 머리 한 점에서 한 번뿐이라, 길이 2,000 이 사라지는 순간과
     *   잡뱀이 죽는 순간이 화면상 «구분되지 않았다»(실렌더 스크린샷으로 확인).
     *   ★ 꼬리 → 머리 «역순»으로 부른다. 파티클은 링버퍼라 넘치면 오래된 것부터
     *     밀려나는데, 머리 폭발이 가장 중요하므로 «마지막»에 넣어 살아남게 한다.
     */
    const bursts = Math.max(1, Math.min(DEATH_BURST_MAX, 1 + Math.round(s.mass / DEATH_BURST_MASS)));
    for (let b = bursts - 1; b >= 0; b--) {
      const f = b / bursts;
      const i = Math.min(pts - 1, Math.floor(f * f * pts));
      this.hooks.onBurst?.(
        s.trail.x(i),
        s.trail.y(i),
        s.style.colors[b % s.style.colors.length],
        s.radius * (b === 0 ? DEATH_BURST_HEAD_K : 1),
      );
    }
  }

  private resolveEating(dt: number): void {
    const orbs = this.orbs;
    if (this.eaten.length < orbs.capacity) this.eaten = new Uint8Array(orbs.capacity);
    this.eaten.fill(0, 0, orbs.n);
    let any = false;

    for (const s of this.snakes) {
      if (!s.alive) continue;
      // ★ radius 가 아니라 pickRadius 다. 「그리는 굵기」와 「먹는 규칙」은 다른 손잡이다
      //   — 얇게 그리라는 요구 때문에 먹는 범위까지 줄어들면 성장이 느려진다.
      //   (근거는 config.ts 의 PICK_R_MIN 주석. 하한 상수는 이 분리로 필요 없어져 삭제했다.)
      const magnet = s.pickRadius * MAGNET_RADIUS_K;
      const n = this.orbGrid.query(s.x, s.y, magnet, this.cand);
      for (let i = 0; i < n; i++) {
        const idx = this.cand[i];
        if (this.eaten[idx]) continue;
        let dx = s.x - orbs.xs[idx];
        let dy = s.y - orbs.ys[idx];
        let d = Math.hypot(dx, dy);
        if (d > magnet) continue;

        const eatDist = s.pickRadius + orbs.rs[idx] + EAT_MARGIN;
        if (d <= eatDist) {
          this.eaten[idx] = 1;
          any = true;
          s.mass += orbs.vs[idx] * MASS_PER_VALUE;
          s.updateDerived();
          if (s.isPlayer) {
            this.hooks.onEat?.(orbs.xs[idx], orbs.ys[idx], orbs.colorTable[orbs.cs[idx]] ?? '#fff', orbs.vs[idx]);
          }
        } else if (d > 1e-3) {
          // 흡입: 가까울수록 세게 당긴다. 이게 「먹는 손맛」의 대부분이다.
          const k = 1 - d / magnet;
          const pull = MAGNET_PULL * k * k * dt;
          const step = Math.min(pull, d - eatDist * 0.5);
          if (step > 0) {
            orbs.xs[idx] += (dx / d) * step;
            orbs.ys[idx] += (dy / d) * step;
          }
          dx = 0; dy = 0; d = 0; // 아래 재사용 방지(정적 분석용 무해 대입)
        }
      }
    }

    if (any) {
      // ★ 스왑삭제가 아니라 «안정 압축»이다. 스왑삭제를 쓰면 아직 검사하지 않은
      //   오브가 이미 지나온 슬롯으로 옮겨가 그 프레임에 조용히 사라진다.
      let w = 0;
      for (let i = 0; i < orbs.n; i++) {
        if (this.eaten[i]) continue;
        if (w !== i) {
          orbs.xs[w] = orbs.xs[i];
          orbs.ys[w] = orbs.ys[i];
          orbs.vs[w] = orbs.vs[i];
          orbs.rs[w] = orbs.rs[i];
          orbs.cs[w] = orbs.cs[i];
          orbs.ph[w] = orbs.ph[i];
        }
        w++;
      }
      orbs.n = w;
    }
  }

  private replenishFood(): void {
    // 한 프레임에 몰아서 만들면 그 프레임이 튄다. 조금씩 채운다.
    let budget = 24;
    while (this.orbs.n < FOOD_TARGET && budget-- > 0) this.spawnFood();
  }

  private respawnBots(): void {
    for (let i = 0; i < this.snakes.length; i++) {
      const s = this.snakes[i];
      const b = this.botStates[i];
      if (!b || s.alive || this.time < b.respawnAt) continue;
      // 리스폰 시 등급을 다시 뽑는다 — 판이 진행될수록 같은 성격만 남는 것을 막는다.
      b.tier = pickTier(this.rng);
      b.threat = 0;
      b.boostUntil = 0;
      // 리스폰은 «작게». 자란 채로 태어나는 것은 판 시작의 봇뿐이다(config SPAWN_MASS_* 주석).
      this.spawnSnake(s, WORLD_R * 0.95, START_MASS * this.rng.range(1, SPAWN_MASS_RESPAWN_K));
    }
  }

  private updateRanking(): void {
    const r = this.ranking;
    r.length = 0;
    for (const s of this.snakes) if (s.alive) r.push(s.id);
    r.sort((a, b) => this.snakes[b].mass - this.snakes[a].mass);
  }

  /**
   * 사망 화면용 최종 순위표: 상위 3줄 + (내가 그 밖이면) 내 줄.
   * ★ 반드시 updateRanking() 이 «다시 돌기 전»에 불러야 한다 -
   *   그 뒤에는 죽은 내가 ranking 에서 빠져 자리를 알 수 없다.
   */
  private standingAround(id: number): StandingRow[] {
    const rank = this.ranking;
    const out: StandingRow[] = [];
    const myIdx = rank.indexOf(id);
    const top = Math.min(3, rank.length);
    for (let i = 0; i < top; i++) {
      const s = this.snakes[rank[i]];
      out.push({ rank: i + 1, name: s.name, score: Math.floor(s.mass), isPlayer: s.id === id });
    }
    if (myIdx >= top) {
      const s = this.snakes[id];
      out.push({ rank: myIdx + 1, name: s.name, score: Math.floor(s.mass), isPlayer: true });
    }
    return out;
  }

  /** 1부터 시작하는 순위. 죽었으면 마지막 순위 + 1. */
  rankOf(id: number): number {
    const i = this.ranking.indexOf(id);
    return i >= 0 ? i + 1 : this.ranking.length + 1;
  }

}
