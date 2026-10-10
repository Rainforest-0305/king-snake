// snake.ts — 뱀 한 마리의 «모델». 렌더·AI·월드 규칙은 여기 들어오지 않는다.
//
// ★ 몸통 표현 방식이 이 게임의 핵심 설계다.
//   흔한 오답: 세그먼트를 객체 배열로 두고 앞 세그먼트를 «따라가게» 한다(스프링/추종).
//     → 마디마다 지연이 누적돼 몸이 출렁이고, 빠르게 꺾으면 몸이 끊긴다.
//       무엇보다 마디 수가 곧 연산량이라 길이가 늘면 프레임이 무너진다.
//   여기서 쓰는 방식: «머리가 지나간 경로»를 일정 간격(PATH_STEP)으로 기록하고,
//     몸은 그 경로 위 구간을 그대로 점유한다. 몸은 언제나 머리 궤적과 정확히 일치하고
//     (원작의 그 느낌이 여기서 나온다), 길이 변화는 «점 개수 자르기» 한 줄이다.

import {
  R_MIN, PICK_R_MIN, R_MAX, R_SCALE, LEN_MIN, LEN_K, LEN_POW,
  TURN_BASE, TURN_R_SOFT, TURN_MIN, PATH_STEP,
  SPEED_BASE, SPEED_BOOST, START_MASS,
  BOOST_MIN_MASS, BOOST_DRAIN, BOOST_DROP_CHUNK,
} from './config';
import { Trail } from './trail';

/** [-PI, PI] 로 감싼 각도 차(to - from). */
export function angDiff(to: number, from: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export interface SnakeStyle {
  colors: readonly string[];
  band: number;
  glow: string;
  /** 무늬 구조. game/skins.ts 의 SnakePattern 과 같은 값. */
  pattern: 'solid' | 'rings' | 'saddle';
}

export class Snake {
  readonly id: number;
  readonly isPlayer: boolean;
  name: string;
  style: SnakeStyle;

  alive = true;
  x = 0;
  y = 0;
  angle = 0;
  /** 조종 목표 각도. 플레이어는 입력이, 봇은 AI 가 채운다. */
  targetAngle = 0;

  mass = START_MASS;
  /** mass 에서 유도 — updateDerived() 가 갱신한다. 직접 쓰지 마라. */
  radius = R_MIN;
  /**
   * «먹기 판정»용 반지름. radius 와 같은 모양의 곡선인데 하한만 PICK_R_MIN 이다.
   * ★ 충돌·사망에는 쓰지 마라 — 보이는 것보다 넓게 죽는 판정이 된다.
   *   (왜 둘로 쪼갰는지는 config.ts 의 PICK_R_MIN 주석에 전부 적혀 있다.)
   */
  pickRadius = PICK_R_MIN;
  bodyLen = LEN_MIN;

  boosting = false;
  /**
   * 이 «월드 시각»까지는 유령이다(충돌 색인에서 제외 - 죽지도 죽이지도 않는다).
   * world.spawnSnake 가 세팅한다. 렌더는 이 값으로 깜빡임 연출을 낸다.
   */
  ghostUntil = 0;
  /** 부스트로 소모한 질량 누적. BOOST_DROP_CHUNK 를 넘으면 오브를 떨군다. */
  boostAccum = 0;
  kills = 0;

  readonly trail = new Trail(256);
  /** 경로에 마지막으로 «찍은» 점. 머리와 이 점 사이가 PATH_STEP 이상 벌어지면 찍는다. */
  private lastPX = 0;
  private lastPY = 0;

  /**
   * 충돌 판정용 표본점(월드 좌표). world.ts 가 매 프레임 채운다.
   * ★ 몸통 점을 «전부» 충돌에 쓰지 않는다 — 굵은 뱀은 점 간격 6 이 과잉이라
   *   반지름에 비례해 성기게 뽑는다(반지름의 0.7배 간격이면 틈이 생기지 않는다).
   */
  collX = new Float32Array(256);
  collY = new Float32Array(256);
  collN = 0;

  constructor(id: number, isPlayer: boolean, name: string, style: SnakeStyle) {
    this.id = id;
    this.isPlayer = isPlayer;
    this.name = name;
    this.style = style;
  }

  /** mass 가 바뀔 때마다 부른다. */
  updateDerived(): void {
    const m = this.mass;
    const t = m / (m + R_SCALE);
    this.radius = R_MIN + (R_MAX - R_MIN) * t;
    this.pickRadius = PICK_R_MIN + (R_MAX - PICK_R_MIN) * t;
    this.bodyLen = LEN_MIN + LEN_K * Math.pow(m, LEN_POW);
  }

  /** 현재 최대 각속도(rad/s). 굵을수록 둔하다. */
  turnRate(): number {
    return Math.max(TURN_MIN, TURN_BASE / (1 + this.radius / TURN_R_SOFT));
  }

  speed(): number {
    return this.boosting ? SPEED_BOOST : SPEED_BASE;
  }

  /** 몸이 차지하는 경로 점 개수. */
  bodyPointCount(): number {
    return Math.max(2, Math.ceil(this.bodyLen / PATH_STEP));
  }

  /** 질량 → 몸길이. updateDerived 와 같은 식이다(스폰 전 자리 고르기에 쓴다). */
  static bodyLenFor(mass: number): number {
    return LEN_MIN + LEN_K * Math.pow(mass, LEN_POW);
  }

  /**
   * 스폰 시 몸이 놓일 «경로 위의 한 점». 머리에서 호길이 len 만큼 뒤.
   *
   * ★ 왜 곧은 선이 아니라 «호»인가 (2026-08-29, 시작 시점 크기 분포 도입):
   *   t=0 에 «이미 자란» 봇을 섞어 스폰한다. 질량 1,600 이면 몸이 2,800 유닛인데
   *   곧게 펴면 맵 반지름(2,500)보다 길어 «태어나자마자 몸이 맵 밖»이다.
   *   그래서 반지름 arcR 인 원호를 따라 눕힌다. 원호는 한 바퀴를 넘지 않는 한
   *   «스스로 겹치지 않는다» - 자기 몸을 가로지르는 모양이 안 나온다.
   *   arcR=0 이면 예전처럼 곧게 편다(작은 뱀·기존 호출부 호환).
   *
   *   turn = +1/-1 : 어느 쪽으로 감을지. 원 중심 = 머리 + turn * arcR * 법선.
   *   진행 방향의 접선이 정확히 heading 과 일치하도록 φ0 = angle - turn*π/2 로 잡는다
   *   (앞으로 갈 때 φ 가 turn 방향으로 증가 ⇒ 뒤쪽은 φ0 - turn*len/arcR).
   */
  static spawnPathPoint(
    x: number, y: number, angle: number, arcR: number, turn: number, len: number,
    out: { x: number; y: number },
  ): void {
    if (arcR <= 0) {
      out.x = x - Math.cos(angle) * len;
      out.y = y - Math.sin(angle) * len;
      return;
    }
    const cx = x + turn * arcR * -Math.sin(angle);
    const cy = y + turn * arcR * Math.cos(angle);
    const phi = angle - turn * Math.PI / 2 - turn * (len / arcR);
    out.x = cx + Math.cos(phi) * arcR;
    out.y = cy + Math.sin(phi) * arcR;
  }

  private static readonly spawnPt = { x: 0, y: 0 };

  /**
   * @param arcR  몸을 눕힐 원호 반지름(월드 유닛). 0 = 곧게(기본값).
   * @param turn  +1 / -1. 감는 방향.
   */
  spawn(x: number, y: number, angle: number, mass: number, arcR = 0, turn = 1): void {
    this.alive = true;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.targetAngle = angle;
    this.mass = mass;
    this.boosting = false;
    this.boostAccum = 0;
    this.kills = 0;
    this.updateDerived();
    // ★ 스폰 직후 몸이 «한 점»에 뭉쳐 있으면 첫 프레임에 몸통이 원 하나로 보인다.
    //   머리 뒤쪽으로 몸길이만큼 펴서 시작한다(곧게 또는 원호 - spawnPathPoint 참조).
    const n = this.bodyPointCount();
    this.trail.ensure(n + 8);
    this.trail.reset(x, y, 0);
    const pt = Snake.spawnPt;
    for (let i = 0; i < n; i++) {
      Snake.spawnPathPoint(x, y, angle, arcR, turn, i * PATH_STEP, pt);
      this.trail.push(pt.x, pt.y);
    }
    this.lastPX = x;
    this.lastPY = y;
    this.collN = 0;
  }

  /**
   * 한 스텝 전진. 회전 → 이동 → 경로 기록 순서.
   * @returns 이번 스텝에 부스트로 «떨궈야 할» 질량(0 이면 없음). 오브 생성은 world 담당.
   */
  step(dt: number): number {
    // ── 회전: 각속도 상한을 넘지 못한다 ─────────────────────────────────────
    const maxTurn = this.turnRate() * dt;
    const d = angDiff(this.targetAngle, this.angle);
    this.angle += d > maxTurn ? maxTurn : d < -maxTurn ? -maxTurn : d;

    // ── 부스트 소모 ────────────────────────────────────────────────────────
    let drop = 0;
    if (this.boosting) {
      if (this.mass <= BOOST_MIN_MASS) {
        // 여기서 끄지 않으면 질량이 음수로 빠지며 반지름/길이가 NaN 이 된다.
        this.boosting = false;
      } else {
        const used = Math.min(BOOST_DRAIN * dt, this.mass - BOOST_MIN_MASS);
        this.mass -= used;
        this.boostAccum += used;
        while (this.boostAccum >= BOOST_DROP_CHUNK) {
          this.boostAccum -= BOOST_DROP_CHUNK;
          drop += BOOST_DROP_CHUNK;
        }
        this.updateDerived();
      }
    }

    // ── 이동 ───────────────────────────────────────────────────────────────
    const sp = this.speed();
    this.x += Math.cos(this.angle) * sp * dt;
    this.y += Math.sin(this.angle) * sp * dt;

    // ── 경로 기록 ──────────────────────────────────────────────────────────
    // ★ 반드시 «머리를 향해 PATH_STEP 씩 걸어가며» 찍는다. 프레임마다 머리 위치를
    //   그대로 밀어넣으면 점 간격이 dt 와 속도에 따라 들쭉날쭉해져서, 몸통 길이가
    //   프레임레이트에 따라 달라진다(느린 기기에서 몸이 짧아지는 버그).
    this.trail.ensure(this.bodyPointCount() + 8);
    let dx = this.x - this.lastPX;
    let dy = this.y - this.lastPY;
    let dist = Math.hypot(dx, dy);
    let guard = 0;
    while (dist >= PATH_STEP && guard++ < 64) {
      const k = PATH_STEP / dist;
      this.lastPX += dx * k;
      this.lastPY += dy * k;
      this.trail.push(this.lastPX, this.lastPY);
      dx = this.x - this.lastPX;
      dy = this.y - this.lastPY;
      dist = Math.hypot(dx, dy);
    }
    this.trail.trimTo(this.bodyPointCount());

    return drop;
  }

  /**
   * 충돌 표본점을 다시 뽑는다. world 가 매 프레임 부른다.
   *
   * ★ 머리 근처 몇 점은 «일부러 뺀다».
   *   상대 머리가 내 목덜미를 스치기만 해도 죽는다면 정면 교차가 전부 즉사가 되어
   *   플레이가 소극적으로 굳는다. 원작도 머리끼리 부딪힐 때만 양쪽이 죽는다.
   *   머리 판정은 world 가 «머리 대 머리»로 따로 본다.
   */
  rebuildCollisionPoints(): void {
    const stride = Math.max(1, Math.round((this.radius * 0.7) / PATH_STEP));
    const total = this.trail.count;
    const skip = Math.max(1, Math.round(this.radius / PATH_STEP)); // 목덜미 제외 구간
    const n = total <= skip ? 0 : Math.floor((total - skip - 1) / stride) + 1;
    if (n > this.collX.length) {
      const cap = 1 << (32 - Math.clz32(Math.max(1, n - 1)));
      this.collX = new Float32Array(cap);
      this.collY = new Float32Array(cap);
    }
    let k = 0;
    for (let i = skip; i < total; i += stride) {
      this.collX[k] = this.trail.x(i);
      this.collY[k] = this.trail.y(i);
      k++;
    }
    this.collN = k;
  }
}
