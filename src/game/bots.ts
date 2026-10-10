// bots.ts — 1인 모드의 «상대». 이 파일이 재미의 절반이다.
//
// ★ 설계 기준(작업지시 원문): 「멍청하면 재미없고, 완벽하면 못 이긴다」.
//   그래서 «실력을 4등급»으로 나눈다. 전부 세게 만들면 초반 30초에 죽고,
//   전부 약하게 만들면 1등이 확정돼 판이 심심해진다. 섞여 있어야
//   「이 녀석은 만만하고 저 녀석은 피해야 한다」는 판단이 생긴다.
//
// ★ 봇이 «인간처럼» 보이는 다섯 가지 장치:
//   1) 판단 주기(reaction) — 매 프레임 최적해를 내면 기계처럼 완벽해진다.
//      등급별로 0.045~0.17초 간격으로만 다시 생각한다. ⛔0 으로 만들지 마라.
//   2) 조향 잡음(noise) — 목표를 향해 «정확히» 가지 않고 미세하게 흔들린다.
//      다만 매 프레임 랜덤을 더하면 «떨림»으로 보인다. 누적 각(wander)을
//      천천히 흔들어 «부드러운 흔들림»을 만든다.
//   3) 위험이 코앞이면 주기를 무시하고 매 프레임 회피한다(3)번이 없으면
//      반응 지연 때문에 봇이 벽처럼 서서 죽는다 — 「멍청해 보인다」의 주범).
//   4) ★행선지(homeR) — 개체마다 «맵의 어디쯤을 좋아하는가»가 다르다(2026-09-03 ⑥).
//      사람은 목적 없이 제자리를 돌지 않는다. 이게 없으면 봇은 반경 몇백 유닛의
//      먹이 기울기만 따라가는 «국소 탐색기»가 되어 태어난 자리 근처에 갇힌다.
//   5) ★가두리(encircle) — 개체마다 «감아서 가두는» 성향이 있고 없다(2026-09-03 ⑧).
//      사람 플레이어의 대표 기술이고, 전원이 쓰면 게임이 불가능해지므로 «일부»만 쓴다.
//
// ★ 성능: 봇 90마리 x 초당 최대 22회 판단. 감지는 전부 공간격자 질의라
//   한 번에 수십~수백 개만 훑는다. 전수 탐색 코드를 여기에 넣지 마라.
//   ⚠2026-09-03 에 더한 것(행선지·가두리)은 «전부 O(1)»이다 — 새 루프가 없다.
//     가두리는 이미 도는 사냥 루프 «안»의 분기고, 행선지는 산술 몇 줄이다.
//     틱 비용이 상수로 유지돼야 한다는 제약을 그렇게 지켰다.
//
// ══ 2026-09-03 변경 요약 (President 지시 ④⑥⑧⑩) ═════════════════════════════
//   ④ 「전체적인 애들 실력도 더 사람 같고 잘하게」 + 「애들 실력을 대폭 상향하면 되겠네」
//   ⑥ 「맵 바깥쪽에 먹을 게 많은 거에 비해 애들이 많이 안 분포하는 것도 해결」
//   ⑧ 「가두리 같은 기술을 사용하는 플레이어들도 많으면 좋겠어」
//   ⑩ 「초거대 애들은 좀 잘해서 오래 살게 해」
//   자세한 근거는 각 상수 바로 위에 적었다. 실측은 tools/qa_arena.mjs.

import { Snake, angDiff } from './snake';
import { WORLD_R, SPEED_BASE, BOOST_MIN_MASS, R_MIN, SPAWN_MASS_TITAN } from './config';
import type { Rng } from './rng';

export type BotTier = 'rookie' | 'regular' | 'hunter' | 'elite';

interface TierParams {
  /** 몸통 위협 탐지 반경(기본값. 실제로는 자기 반지름에 비례해 늘린다). */
  look: number;
  /** 판단 간격(초). */
  reaction: number;
  /** 조향 잡음 크기. */
  noise: number;
  /** 먹이 탐색 반경. */
  foodScan: number;
  /** 사냥(가로막기) 사거리. 0 이면 사냥하지 않는다. */
  huntRange: number;
  /** 회피 가중치. */
  wAvoid: number;
  /** 먹이 가중치. */
  wFood: number;
  /** 사냥 가중치. */
  wHunt: number;
  /** 도주 부스트를 켜는 위협 문턱(0~1). 높을수록 겁이 없다. */
  fleeAt: number;
  /** ⑧ 이 등급에서 «가두리를 쓰는 개체»의 비율(0~1). */
  encircle: number;
}

/**
 * ★ 이 표가 난이도의 전부다. 「너무 쉽다/어렵다」는 여기서만 고친다.
 *   rookie  = 먹이만 보고 다니는 초보. 위협 반경이 좁아 내 몸에 잘 박힌다(=내 먹이).
 *   regular = 피할 줄 알고, 나보다 작으면 노린다. 판의 기본 밀도를 만든다.
 *   hunter  = 예측 요격 + 부스트로 «가로막기»를 시도한다. 방심하면 이쪽이 죽는다.
 *   elite   = 2026-09-03 신설(⑩). «초거대로 자란 개체»가 자동 승격되는 등급이다.
 *             President: 「초거대 애들은 좀 잘해서 오래 살게 해」.
 *
 * ══ 2026-09-03 «대폭» 상향 — 전/후 표 ════════════════════════════════════
 *   President 가 ④를 난도 확보의 주력 레버로 지정했다(맵이 커지고 마릿수는
 *   고정이라 밀도가 -17% 떨어지는데, 그 상쇄를 봇 실력으로 잡는다).
 *
 *     등급     look      reaction     noise      foodScan   huntRange
 *     rookie   105→130   0.20→0.17    0.55→0.50  340→430    0→0
 *     regular  175→215   0.11→0.095   0.30→0.28  430→560    430→560
 *     hunter   245→300   0.065→0.055  0.16→0.15  520→700    640→820
 *     elite    (신설 320)     (0.045)     (0.11)     (820)      (1000)
 *
 *     등급     wAvoid    wFood      wHunt      fleeAt
 *     rookie   2.4→2.7   1.35→1.35  0→0        0.78→0.74
 *     regular  3.1→3.3   1.15→1.15  0.85→1.05  0.58→0.55
 *     hunter   3.6→3.8   0.95→0.95  1.5→1.8    0.46→0.44
 *     elite    (4.0)     (0.90)     (2.1)      (0.38)
 *
 * ── ⛔지킨 선: 「사람 같게」가 «같이» 지시됐다 ─────────────────────────────
 *   · reaction 을 0 으로 만들지 않았다. 가장 빠른 elite 도 0.045초 = 2.7프레임
 *     간격이다. 사람의 시각 반응 하한(약 0.15~0.25초)보다는 빠르지만, «매 프레임
 *     최적해»와는 다르다 — 그 차이가 「빈틈」이고, 빈틈이 없으면 잡을 수가 없다.
 *   · noise 를 0 으로 만들지 않았다. elite 도 0.11 을 남겼다.
 *   · 등급 «편차»를 유지했다. rookie 를 없애지 않고(20%) 비중만 옮겼다 —
 *     전부 고수면 그것도 기계적이다. look 은 130~320 으로 2.5배 벌어져 있다.
 *   · foodScan 을 크게 올린 것이 「잘한다」의 절반이다. 시야가 좁으면 아무리
 *     반응이 빨라도 «가까운 것만» 먹는다 — 그게 지금까지 봇이 국소에 갇힌 이유고
 *     ⑥(바깥이 빈다)의 원인 중 하나였다.
 *
 * ── ⚠look 을 더 올리지 마라 ───────────────────────────────────────────────
 *   look 은 자기 반지름(최대 1.5배)과 부스트(1.45배)로 «곱해진다». elite 320 이면
 *   실제 질의 반경이 최대 696 이다. world.queryBody 의 후보 버퍼는 4096 이고
 *   Grid.query 는 넘치면 «조용히 자른다» — 즉 더 키우면 어느 순간부터 위협을
 *   놓치기 시작하는데 오류가 안 난다. 320 은 그 한참 아래다(실측: 시뮬 1스텝 참조).
 */
const TIERS: Record<BotTier, TierParams> = {
  rookie:  { look: 130, reaction: 0.17,  noise: 0.50, foodScan: 430, huntRange: 0,    wAvoid: 2.7, wFood: 1.35, wHunt: 0,    fleeAt: 0.74, encircle: 0 },
  regular: { look: 215, reaction: 0.095, noise: 0.28, foodScan: 560, huntRange: 560,  wAvoid: 3.3, wFood: 1.15, wHunt: 1.05, fleeAt: 0.55, encircle: 0.12 },
  hunter:  { look: 300, reaction: 0.055, noise: 0.15, foodScan: 700, huntRange: 820,  wAvoid: 3.8, wFood: 0.95, wHunt: 1.8,  fleeAt: 0.44, encircle: 0.45 },
  elite:   { look: 320, reaction: 0.045, noise: 0.11, foodScan: 820, huntRange: 1000, wAvoid: 4.0, wFood: 0.90, wHunt: 2.1,  fleeAt: 0.38, encircle: 0.70 },
};

/* ══ ⑩ 초거대 = 상위 실력 (President: 「초거대 애들은 좀 잘해서 오래 살게 해」) ══
 *
 *  ★world.ts 를 «건드리지 않고» 구현했다. 등급을 스폰 때 배정하면
 *    ① 생성자에서 질량이 «아직» 정해지기 전이라 순서를 뒤집어야 하고
 *    ② 판 «도중에» 자라서 거대해진 봇은 영원히 옛 등급으로 남는다.
 *   ⇒ 대신 판단할 때마다 질량을 보고 승격한다. 한 줄이고, 스폰 초거대와
 *     «자라서 커진» 봇을 똑같이 다룬다. 강등은 world 의 리스폰이 이미 한다
 *     (respawnBots 가 pickTier 를 다시 뽑는다 — 죽으면 작아지므로 자연 강등).
 *
 *  ★2,200 인 근거: 현행 실측에서 봇 질량 p99 가 2,180 이었다(qa_arena 12시드).
 *    즉 「상위 1%」가 승격선이다. config 의 초거대 스폰 하한(3,000)보다 낮게
 *    잡은 것은 의도적이다 — «자라서 그 근처까지 온» 개체도 상위 플레이어처럼
 *    굴어야 리더보드 상단이 실제로 경쟁된다.
 */
export const ELITE_MASS = 2200;

/* ══ ⑪ 자기 몸 엄폐 (2026-09-04, President 직접) ═══════════════════════════
 *
 *  President: 「거대 뱀은 도망칠 때 자기 몸쪽으로 방향을 틀어서 숨어도 되잖아」
 *
 *  ── 전제를 «먼저» 실측했다 (tools/probe_shelter.mjs) ──────────────────────
 *    ① 자기 트레일 위에 머리를 30스텝 강제로 올려도 죽지 않는다.
 *       양성 대조: 남의 트레일에 올리면 «죽는다»(검사기가 사망을 잡는다).
 *    ② 추격자(질량 300)를 큰 뱀 몸통 중간에 밀어 넣으면 «추격자가 죽고»
 *       큰 뱀은 산다 = 엄폐가 «무기»가 된다.
 *    ③ 최대 선회로 600스텝 말아도 살아 있다(자기 트레일까지 거리 0, 반지름 30).
 *    ⇒ 셋 다 참이다. 근거는 world.resolveCollisions 의 `owner === s.id` 제외이고,
 *      world.queryBody 도 자기 몸을 빼므로 «회피와 엄폐가 서로 싸우지 않는다».
 *
 *  ── 왜 이게 회전 반경 문제를 «우회»하나 ───────────────────────────────────
 *    넓게 도망치려면 큰 반경이 필요하다(초거대 102, 질주 시 192). 그런데
 *    «안쪽으로 마는 것»은 반경이 작아도 된다 — 목적지가 «자기 몸»이라 멀리 갈
 *    필요가 없다. TURN_MIN 을 건드리지 않고 푸는 유일한 길이다.
 *
 *  ── 왜 지금까지 안 됐나 ──────────────────────────────────────────────────
 *    앞서 시험한 손잡이 7종은 전부 «이미 있는 행동의 세기»였다(더 봐라·덜
 *    덤벼라·더 피해라·덜 질러라). 전부 시드 페어링에서 무의미했다.
 *    이건 «새 행동»이다. 「조율」과 「추가」는 다르다.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 엄폐 선회 명령 크기(라디안). 0 = 무효과(현행).
 *
 * ★「점을 쫓지 않고 «한 방향으로 계속 돈다»」가 핵심이다.
 *   1차 구현은 트레일의 한 점을 목표로 조향했는데 전부 무의미했다
 *   (45% 뒤 = 초거대에겐 1,000유닛 밖 = 똬리가 아니라 맵 횡단 U턴,
 *    5~10% 뒤 = 가까워질수록 조향이 요동). 목표점은 «내가 움직이면 같이
 *   움직이는» 표적이라 애초에 불안정하다.
 *   ⇒ 대신 «부호»를 한 번 정하고 그 방향으로 «낼 수 있는 최대»로 돈다.
 *     targetAngle = angle + side * K 로 크게 요구하면 snake.step 이
 *     turnRate 상한까지만 돌려 준다 — 즉 «도달 불가능한 각도를 요구하지
 *     않는다»는 성질이 설계상 보장된다. 나선은 자연히 만들어진다.
 * ⛔K=0 이면 단락평가로 엄폐 전체를 건너뛴다 = 비트 동일.
 */
export const SHELTER_K = 1.2;
/** 부호를 정할 때 참고할 트레일 지점(머리에서 몸길이의 이 비율만큼 뒤). */
export const SHELTER_AT = 0.12;
/**
 * 질량이 클수록 엄폐 발동 문턱을 이 비율만큼 «낮춘다»(0~1).
 * ★초거대는 감는 데 시간이 더 걸리니 더 «일찍» 시작해야 한다. fleeAt 은
 *   작은 뱀 기준으로 맞춰진 문턱이라 그대로 쓰면 초거대에겐 항상 늦다.
 */
export const SHELTER_EARLY_K = 0.5;
/**
 * 엄폐 중 «도주 질주»를 끌 것인가(1=끈다).
 * ★물리적으로 엄폐와 한 몸이다: 질주하면 회전 반경이 102 → 192 가 되어
 *   초거대 몸길이로는 «말리지가 않는다». 질주를 켠 채로는 무슨 수를 써도
 *   못 감는다. 그래서 따로 재지 않고 «같이» 켠다.
 */
export const SHELTER_NOBOOST = 1;
/** 엄폐 해제 문턱(발동 문턱 대비 비율). 히스테리시스 — 떨림 방지. */
export const SHELTER_EXIT = 0.7;

/* ══ ⑥ 행선지(homeR) — 「바깥에 애들이 안 간다」의 해법 ══════════════════════
 *
 *  ── 진단(추측이 아니라 실측이다. tools/qa_arena.mjs 12시드x180초) ─────────
 *     구간        면적%   봇 머리%   면적정규 밀도
 *     0  ~0.3R      9      9.8        1.09
 *     0.3~0.6R     27     30.1        1.12
 *     0.6~0.8R     28     39.5        1.41
 *     0.8~0.9R     17     20.3        1.20
 *     ★0.9~1.0R    19      0.2        0.01   ← 맵 면적의 19% 가 «사실상 무인지대»
 *
 *     ⚠3칸(0~.3/.3~.6/.6~1)으로 재면 1.09/1.12/0.94 = 「거의 균등, 문제 없음」으로
 *       보였다. 구간을 쪼개서야 보였다 — 지표를 만드는 것은 구간이다.
 *
 *  ── 원인 둘 ────────────────────────────────────────────────────────────────
 *     ① 경계 회피가 «0.8R 부터» 가중치 4.5 로 민다. 게다가 그 세기를 그대로
 *        threat 에 넣어서, 0.96R 근처에서는 calm 이 0 이 되어 «먹이 탐색이 꺼진다».
 *        즉 바깥 띠는 「위험하니 먹지 말고 도망쳐라」 구역이었다.
 *     ② 봇에게 «행선지»가 없다. foodScan(옛 340~520)은 WORLD_R 4,330 의 1/10 도
 *        안 된다. 국소 기울기만 따라가므로 태어난 자리 근처에 갇힌다.
 *     그런데 먹이는 spawnFood 가 «맵 전체 균일»로 뿌린다(world.ts inDisc(0.985R)).
 *     ⇒ 면적의 19% 에 먹이만 쌓인다. President 관찰과 정확히 일치한다.
 *
 *  ── 고친 방식 ──────────────────────────────────────────────────────────────
 *     ① 벽 시작을 0.8R → 0.93R 로 «밀고», 대신 그 뒤로는 더 세게 민다(4.5→6.0).
 *        늦게 시작하고 급하게 꺾는 쪽이 사용 가능 면적을 넓힌다.
 *     ② 벽 위협이 threat 에 «절반만» 실리게 했다(WALL_THREAT_K). 벽 옆에서도
 *        먹이를 먹는다 — 그게 사람이 하는 짓이다.
 *     ③ 개체마다 «좋아하는 반경»(homeR)을 주고 약하게 끌어당긴다. 면적 균등이
 *        되도록 sqrt 로 뽑는다(반경 균등으로 뽑으면 중앙이 다시 붐빈다).
 *     ★③이 ④(사람 같게)에도 기여한다 — 개체마다 노는 자리가 다른 것이
 *      「각자 다른 사람」으로 읽힌다.
 */
/** 이 반경 «비율»부터 경계 회피가 걸린다. 옛 값 0.8. */
export const BOT_WALL_START = 0.93;
/** 경계 회피 세기. 옛 값 4.5. 늦게 시작하는 대신 세게 민다. */
export const BOT_WALL_PUSH = 6.0;
/** 벽 위협이 «먹이·사냥을 끄는» 정도. 1.0 이면 옛 동작(바깥에서 아무것도 안 한다). */
export const BOT_WALL_THREAT_K = 0.5;
/** 행선지로 끌어당기는 세기. 관성(0.55)의 절반 수준 = «취향»이지 «명령»이 아니다. */
export const BOT_ROAM_W = 0.55;
/** 행선지 오차를 1.0 으로 볼 거리(맵 반지름 대비). 이보다 멀면 최대 세기. */
export const BOT_ROAM_SPAN = 0.25;

/* ══ ⑧ 가두리(encircle) ═══════════════════════════════════════════════════════
 *
 *  President: 「가두리 같은 기술을 사용하는 플레이어들도 많으면 좋겠어.」
 *             (단, Partner 경고: 「모든 봇이 가두리를 하면 게임이 불가능해진다」)
 *
 *  ── 무엇인가 ───────────────────────────────────────────────────────────────
 *   상대 «앞»을 가로막는 기존 사냥(4번 항목)은 직선 요격이다. 가두리는 상대를
 *   중심으로 «돌면서» 몸으로 원을 그려 빠져나갈 길을 지우는 기술이다.
 *   구현: 요격점 대신 «상대를 중심으로 한 원 위의, 지금 각도에서 한 걸음 앞»을 노린다.
 *   그러면 봇의 궤적이 자연히 상대를 감는다 — 특수한 경로 계획이 필요 없다.
 *
 *  ── 왜 «일부»만 쓰는가 ─────────────────────────────────────────────────────
 *   전원이 쓰면 플레이어는 첫 조우에서 갇혀 죽는다. 그래서 «개체 성향»으로 뒀다:
 *     rookie 0% / regular 12% / hunter 45% / elite 70%
 *   초거대(elite)가 가장 많이 쓰는 것이 President 의 그림과 맞는다 —
 *   「진짜 사람 같은 상위 플레이어」가 가두리를 쓴다.
 *   90마리 기준 기대값 ≈ regular 0.12x40 + hunter 0.45x32 + elite 0.70x5 ≈ 22마리(약 24%).
 *   ★단, 성향이 있어도 «조건»(상대가 충분히 작고 가깝고 내가 크다)을 만족해야
 *     실제로 감기 시작한다. 그래서 화면에서 실제로 보이는 빈도는 훨씬 낮다.
 *
 *  ── ★과하면 이 상수 하나를 내려라 ────────────────────────────────────────
 *   ENCIRCLE_K = 0 이면 «전부 꺼진다»(옛 직선 요격으로 복귀). 1 이 기본.
 *   조이려면 ENCIRCLE_STEP 을 올리고, 덜 조이려면 내린다.
 */
/* ── ★실측이 정한 값 (같은 날, 두 차례 재고 «되돌린» 기록) ────────────────
 *
 *  가두리는 «가장 강한 난도 레버»다. 누적 절제 실측(tools/arena_sweep.py, 14시드,
 *  기준 플레이어 56판):
 *      D(가두리 끔)  생존 65.1초 · 한 판 최고점 중앙 1,181 · 1등 8/56
 *      E(가두리 켬)  생존 51.7초 ·                    826 · 1등 4/56
 *
 *  ⚠그래서 「더 세게 하면 더 어려워지겠지」로 한 번 «세게» 해 봤다 —
 *    STEP .95 / PAD 58 / RATIO .72 / RANGE .72 · 성향 0/22/62/85%.
 *    결과는 «반대»였다(tools/arena_try2.py F2):  생존 51.7 → 57.8초 · 최고점 826 → 949.
 *    왜: RANGE 를 넓히면 봇이 «먼 거리에서부터 감기 시작»한다. 그런데 감는 것은
 *        «옆을 도는» 기술이라 멀리서는 그냥 헛돈다 — 그 사이 «직선 요격»(치명적인 쪽)을
 *        안 한다. 즉 강한 기술이 약한 기술을 «밀어냈다».
 *        RATIO 를 올린 것도 같은 문제다. 비슷한 덩치를 감으면 봇끼리 물고 늘어지느라
 *        플레이어를 안 본다.
 *  ⇒ 되돌렸다. 가두리는 «짧은 사거리 · 확실히 작은 상대»에서만 켜져야 값이 산다.
 *  ⛔과하면 ENCIRCLE_K 를 내려라(0 = 완전 비활성, 옛 직선 요격으로 복귀).
 *    ⛔RANGE_FRAC·MASS_RATIO 를 «올리는» 방향은 위 실측으로 이미 기각됐다.
 */
/** 가두리 전체 스위치 겸 세기. 0 = 완전 비활성(옛 동작). ★과하면 이것부터 내려라. */
export const ENCIRCLE_K = 1.0;
/** 상대 주위를 «한 번에 얼마나 돌아설지»(rad). 클수록 급하게 감는다. */
export const ENCIRCLE_STEP = 0.85;
/** 감는 반경 = 상대 반지름 x3 + 내 반지름 x2 + 이 값. 작을수록 바짝 조인다. */
export const ENCIRCLE_PAD = 70;
/** 이 «질량비»보다 상대가 작아야 감는다. ⛔올리지 마라(위 실측). */
export const ENCIRCLE_MASS_RATIO = 0.55;
/** 사거리의 이 비율 «안»에서만 감는다. ⛔올리지 마라 — 멀리서 감으면 헛돈다(위 실측). */
export const ENCIRCLE_RANGE_FRAC = 0.55;

/* ══ ② 「사람은 표적이 된다」 — 플레이어 표적 가중 ═══════════════════════════
 *
 *  ★왜 이 상수가 «유일하게 남은» 난도 레버인가 (실측 4연속 기각의 결과):
 *    President 지시 ②「난도도 더 올려」를 위해 네 가지를 재 봤는데 «전부 반대로» 갔다
 *    (기준 플레이어 20시드 x 80판, tools/arena_try2·3·4.py):
 *        먹이 총량 10,800 → 9,000   생존 56.6 → 77.3초  (쉬워짐)
 *        사망 드롭 0.76 → 0.68/0.60/0.52  생존 → 76.3 / 73.7 / 70.6초 (쉬워짐)
 *        맵 3.6 → 3.3               생존 → 62.6초        (쉬워짐)
 *        가두리 강화(사거리·질량비↑) 생존 → 57.8초        (쉬워짐)
 *    이유가 하나다 — 이 게임에서 «위협을 만드는 것은 큰 몸»이다. 세계에서 질량을
 *    빼는 레버는 전부 봇을 먼저 굶겨 판을 성기게 만들고, 그러면 플레이어가 편해진다.
 *    ⇒ 세계를 굶기지 «않으면서» 플레이어만 어렵게 하는 손잡이가 필요하다.
 *
 *  ★이것이 그 손잡이다. 사냥 «표적 선택»에서만 플레이어에게 가중을 준다.
 *    봇끼리의 관계·먹이 경제·크기 분포에 «아무 영향이 없다».
 *
 *  ★공정한가: 아레나에 뱀이 91마리인데 사람은 1명이다. 가중이 없으면 사람이
 *    표적이 될 확률은 구조적으로 1/90 이라, 「아무도 나를 노리지 않는다」가 된다.
 *    실제 slither.io 에서는 사람이 사람을 노린다 — 그 표적률을 되돌리는 보정이다.
 *  ── 값 고르기(tools/arena_try5.py, 20시드 x 기준 플레이어 80판) ────────────
 *      가중   생존(초)  한 판 최고점 중앙   1등     cross3s
 *      1.0     56.6        1,114          6/80      20
 *      1.6     56.0        1,146          6/80      20
 *      2.4     60.2        1,169          7/80      20
 *     ★3.6     57.6          958          6/80      20   ⇐ 채택
 *    ⇒ 생존·1등·cross3s 는 «움직이지 않고»(전부 잡음 범위) 점수만 -14% 내려간다.
 *      President 가 원한 방향(「프로모션 달성이 어려워지는 게 맞다」)에 정확히 맞는다.
 *    ★사망 원인도 몸통 충돌 38 / 정면 42 로 «가로막힘»이 늘었다 = 의도한 형태다.
 *
 *  ⛔1.0 = 완전 비활성(옛 동작). 「나만 미친 듯이 쫓긴다」는 신고가 오면
 *    이 상수 하나만 내려라. 다른 것을 건드릴 필요가 없다.
 */
export const PLAYER_HUNT_BIAS = 3.6;

export interface BotState {
  tier: BotTier;
  /** 다음 판단 시각(초). */
  thinkAt: number;
  /** 누적 방황각 — 부드러운 흔들림의 출처. */
  wander: number;
  /** 이 시각까지 부스트를 유지한다. */
  boostUntil: number;
  /** 사망 후 재등장 시각. alive=false 인 동안만 의미가 있다. */
  respawnAt: number;
  /** 직전 판단의 위협도(0~1). 렌더/디버그와 긴급 회피 판단에 쓴다. */
  threat: number;
  /** ⑥ 이 개체가 «좋아하는» 반경(0~1, WORLD_R 대비). */
  homeR: number;
  /** ⑧ 가두리를 쓰는 개체인가. */
  encircler: boolean;
  /** ⑧ 감는 방향(+1/-1). 개체마다 고정 — 매번 뒤집으면 제자리에서 떤다. */
  wrapSide: number;
  /** ⑧ 지금 감고 있는가(진단·계측용). */
  wrapping: boolean;
  /**
   * ⑪ 엄폐 선회 방향. 0 = 엄폐 중 아님, +1/-1 = 그 방향으로 감는 중.
   * ★한 번 정하면 «엄폐가 끝날 때까지» 유지한다. 매 프레임 다시 고르면
   *   좌우로 떨다가 결국 직진한다(그러면 아무것도 안 한 것과 같다).
   */
  shelterSide: number;
}

/* ══ 계측 훅 — tools/qa_arena.mjs 가 읽는다 ═══════════════════════════════════
 *  ★운영 로직은 이 값을 «읽지 않는다». 증가만 시킨다.
 *  ★「가두리 발생 빈도를 수치로 내라」는 지시(⑧)의 근거다. 계측이 없으면
 *    「많으면 좋겠다」의 «많다»를 판정할 수 없다.
 */
export const __botDebug = {
  /** 가두리 성향을 «가진» 개체가 만들어진 횟수. */
  encirclerBorn: 0,
  /** 가두리가 «시작»된 횟수(성향 보유 + 조건 충족). */
  wrapStart: 0,
  /** 가두리 상태로 보낸 판단 틱 수. */
  wrapTicks: 0,
  /** elite 로 승격된 횟수. */
  elitePromote: 0,
  /** ⑪ 자기 몸 엄폐가 «발동»한 판단 틱 수. 0 이면 코드가 안 도는 것이다. */
  shelterTicks: 0,
  /**
   * ⑪ 엄폐 중 «실제로 내 몸이 위협과 나 사이에» 놓인 틱 수.
   * ★발동 횟수는 「감으려고 시도했다」까지다. 이 값이 «성공» 지표다 —
   *   감았는데 몸이 엄폐물 위치에 안 들어갔으면 아무 일도 안 한 것이다.
   */
  shelterShieldTicks: 0,
  reset(): void {
    this.encirclerBorn = 0;
    this.wrapStart = 0;
    this.wrapTicks = 0;
    this.elitePromote = 0;
    this.shelterTicks = 0;
    this.shelterShieldTicks = 0;
  },
  snapshot(): Record<string, number> {
    return {
      encirclerBorn: this.encirclerBorn,
      wrapStart: this.wrapStart,
      wrapTicks: this.wrapTicks,
      elitePromote: this.elitePromote,
    };
  },
};

export function makeBotState(tier: BotTier, rng: Rng): BotState {
  const P = TIERS[tier];
  const encircler = ENCIRCLE_K > 0 && rng.next() < P.encircle;
  if (encircler) __botDebug.encirclerBorn++;
  return {
    tier,
    // ★ 첫 판단 시각을 흩뿌린다. 전부 0 이면 90마리가 «같은 프레임»에 생각해
    //   주기적으로 한 프레임만 튀는 스터터가 생긴다(프로파일러에 톱니로 보인다).
    thinkAt: rng.range(0, P.reaction),
    wander: rng.range(-Math.PI, Math.PI),
    boostUntil: 0,
    respawnAt: 0,
    threat: 0,
    /* ⑥ 면적 균등이 되도록 sqrt 로 뽑는다. u 를 그대로 쓰면 «반경 균등»이 되어
       중앙이 다시 붐빈다(면적은 반경의 제곱에 비례하므로). 0.94 를 곱해
       경계 회피 구간(0.93R~) 바로 안쪽을 상한으로 둔다 — 벽에 붙어 살라고
       보내면 그건 그냥 죽으라는 뜻이다. */
    homeR: Math.sqrt(rng.range(0.04, 1)) * 0.94,
    encircler,
    wrapSide: rng.bool() ? 1 : -1,
    wrapping: false,
    shelterSide: 0,
  };
}

/**
 * 봇이 감각기관을 통해 세상을 보는 창구. world 가 구현한다.
 * ★ 콜백/배열 반환이 아니라 «미리 잡아둔 스크래치 버퍼»에 채우는 방식이다.
 *   매 프레임 수백 번 불리는 경로라 여기서 배열을 새로 만들면 GC 가 튄다.
 */
export interface Sensors {
  /** 적 몸통 점을 bodyX/bodyY 에 채우고 개수를 돌려준다. */
  queryBody(x: number, y: number, r: number, selfId: number): number;
  readonly bodyX: Float32Array;
  readonly bodyY: Float32Array;

  /** 오브를 orbX/orbY/orbV 에 채우고 개수를 돌려준다. */
  queryOrbs(x: number, y: number, r: number): number;
  readonly orbX: Float32Array;
  readonly orbY: Float32Array;
  readonly orbV: Float32Array;

  readonly snakes: readonly Snake[];
}

const TAU = Math.PI * 2;

export function botThink(s: Snake, b: BotState, w: Sensors, time: number, rng: Rng): void {
  /* ⑩ 초거대 승격. ★여기 한 줄이 「초거대는 잘한다」의 전부다.
     판단 진입점이라 스폰 초거대와 «자라서 커진» 봇이 같은 경로를 탄다. */
  if (b.tier !== 'elite' && s.mass >= ELITE_MASS) {
    b.tier = 'elite';
    __botDebug.elitePromote++;
  }
  const P = TIERS[b.tier];

  // 위험이 코앞이면 주기를 무시한다(장치 3).
  const urgent = b.threat > 0.62;
  if (!urgent && time < b.thinkAt) {
    s.boosting = time < b.boostUntil && s.mass > BOOST_MIN_MASS;
    return;
  }
  b.thinkAt = time + (urgent ? 0 : P.reaction);

  const cos = Math.cos(s.angle);
  const sin = Math.sin(s.angle);

  // ── 1) 몸통 회피 ─────────────────────────────────────────────────────────
  // 굵을수록 «멈춰 서기»가 불가능하므로 더 멀리 봐야 한다. 부스트 중이면 더 멀리.
  /**
   * 「이 개체가 얼마나 큰가」 0~1. ⑪ 엄폐의 가중에 쓴다.
   * ★분모는 초거대 스폰 «하한»(3000)이다. TITAN_MAX(7000)로 잡으면 스폰 하한의
   *   개체가 0.17 밖에 안 돼 손잡이가 «의도의 17% 세기»로 작동한다 —
   *   2026-09-04 A/B 가 전부 「효과 없음」으로 나온 원인 중 하나였다(척도 결함).
   */
  const big = Math.min(1, Math.max(0,
    (s.mass - ELITE_MASS) / (SPAWN_MASS_TITAN - ELITE_MASS)));
  const look = P.look * (1 + (s.radius - R_MIN) / 55) * (s.boosting ? 1.45 : 1);
  let ax = 0;
  let ay = 0;
  let threat = 0;
  const bn = w.queryBody(s.x, s.y, look, s.id);
  for (let i = 0; i < bn; i++) {
    const dx = s.x - w.bodyX[i];
    const dy = s.y - w.bodyY[i];
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-6) continue;
    const d = Math.sqrt(d2);
    if (d > look) continue;
    // 진행 방향 앞에 있을수록 위험하다(뒤에 있는 몸은 부딪힐 일이 없다).
    const fwd = (-dx * cos - dy * sin) / d; // -1(뒤) ~ +1(정면)
    if (fwd < -0.35) continue;
    const near = 1 - d / look;
    const wgt = (0.25 + 0.75 * Math.max(0, fwd)) * near * near;
    ax += (dx / d) * wgt;
    ay += (dy / d) * wgt;
    if (wgt > threat) threat = wgt;
  }

  // ── 2) 경계 회피 ─────────────────────────────────────────────────────────
  // ★ 이게 없으면 봇이 벽에 줄줄이 박아 죽는다 — 「봇이 멍청하다」의 1순위 원인.
  // ★ 2026-09-03 ⑥: 시작을 0.8R → 0.93R 로 «밀었다». 대신 그 뒤로는 더 세게 민다.
  //   그리고 «위협으로는 절반만» 센다 — 벽 옆에서도 먹이를 먹게 하기 위한 것이다.
  const rc = Math.hypot(s.x, s.y);
  const wallStart = WORLD_R * BOT_WALL_START;
  if (rc > wallStart) {
    const k = Math.min(1, (rc - wallStart) / (WORLD_R - wallStart));
    // 안쪽으로 «세게» 민다. 벽은 협상 대상이 아니다.
    ax += (-s.x / rc) * k * BOT_WALL_PUSH;
    ay += (-s.y / rc) * k * BOT_WALL_PUSH;
    const wallThreat = k * BOT_WALL_THREAT_K;
    if (wallThreat > threat) threat = wallThreat;
  }

  // ── 2b) ⑥ 행선지 ─────────────────────────────────────────────────────────
  // 개체마다 «좋아하는 반경»이 다르다. 약하게 끌어당기기만 한다(취향이지 명령이 아니다).
  // ★rc 가 0 에 가까우면 방향이 정의되지 않으므로 건너뛴다(맵 정중앙).
  if (rc > 1) {
    const dr = b.homeR * WORLD_R - rc; // + 면 바깥으로 가야 한다
    let k = dr / (WORLD_R * BOT_ROAM_SPAN);
    if (k > 1) k = 1;
    else if (k < -1) k = -1;
    ax += (s.x / rc) * k * BOT_ROAM_W;
    ay += (s.y / rc) * k * BOT_ROAM_W;
  }

  // ── 3) 먹이 ──────────────────────────────────────────────────────────────
  let bestScore = 0;
  let fdx = 0;
  let fdy = 0;
  const on = w.queryOrbs(s.x, s.y, P.foodScan);
  for (let i = 0; i < on; i++) {
    const dx = w.orbX[i] - s.x;
    const dy = w.orbY[i] - s.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) continue;
    const fwd = (dx * cos + dy * sin) / d;
    // 뒤로 U턴해서 먹으러 가는 것은 대개 손해다(그 사이에 다른 게 먹는다).
    const score = (w.orbV[i] / (d + 70)) * (0.45 + 0.55 * Math.max(0, fwd));
    if (score > bestScore) {
      bestScore = score;
      fdx = dx / d;
      fdy = dy / d;
    }
  }

  // ── 4) 사냥(가로막기) + ⑧ 가두리 ─────────────────────────────────────────
  // 원작의 핵심 전술: 상대 «앞»으로 끼어들어 내 몸에 박게 만든다.
  let hdx = 0;
  let hdy = 0;
  let huntScore = 0;
  let huntClose = false;
  let wrapping = false;
  if (P.huntRange > 0 && s.mass > BOOST_MIN_MASS * 1.5) {
    const snakes = w.snakes;
    for (let i = 0; i < snakes.length; i++) {
      const o = snakes[i];
      if (o === s || !o.alive) continue;
      if (o.mass > s.mass * 0.88) continue; // 나보다 크면 사냥감이 아니다
      // ★ 갓 태어난 뱀은 «노리지 않는다». 잡아도 남는 게 거의 없는데
      //   모든 봇이 신생아에게 달려들면 판이 시작되지 않는다(벤치 실측:
      //   생존시간 최소 3초의 주범). 45 는 시작질량(12)의 약 4배 - 어느 정도
      //   자란 뒤부터 표적이 된다는 뜻이다.
      if (o.mass < 45) continue;
      const dx = o.x - s.x;
      const dy = o.y - s.y;
      const d = Math.hypot(dx, dy);
      if (d > P.huntRange || d < 1) continue;

      /* ⑧ 가두리 조건: 성향이 있고 · 충분히 가깝고 · 상대가 충분히 작다.
         셋 다여야 한다. 멀리서 감으면 헛돌고, 비슷한 덩치를 감으면 같이 죽는다. */
      const canWrap = b.encircler
        && d < P.huntRange * ENCIRCLE_RANGE_FRAC
        && o.mass < s.mass * ENCIRCLE_MASS_RATIO;

      let px: number;
      let py: number;
      if (canWrap) {
        /* 상대를 중심으로 한 원 위에서 «한 걸음 앞»을 노린다.
           ★경로 계획이 아니다 — 매 판단마다 한 걸음씩 앞을 보게 하면
             궤적이 «저절로» 상대를 감는다. 그게 사람이 하는 방식이기도 하다. */
        const wrapR = o.radius * 3 + s.radius * 2 + ENCIRCLE_PAD;
        const ang = Math.atan2(s.y - o.y, s.x - o.x);
        const na = ang + b.wrapSide * ENCIRCLE_STEP * ENCIRCLE_K;
        px = o.x + Math.cos(na) * wrapR;
        py = o.y + Math.sin(na) * wrapR;
      } else {
        // 요격: 상대가 t초 뒤 도달할 지점의 «조금 더 앞»을 노린다.
        const t = (d / SPEED_BASE) * 1.05;
        const lead = SPEED_BASE * t + o.radius * 3;
        px = o.x + Math.cos(o.angle) * lead;
        py = o.y + Math.sin(o.angle) * lead;
      }
      const idx = px - s.x;
      const idy = py - s.y;
      const idd = Math.hypot(idx, idy);
      if (idd < 1) continue;
      if (!canWrap) {
        // 내가 그 지점에 «먼저» 닿을 수 있어야 의미가 있다.
        // ★가두리에는 이 조건을 걸지 않는다 — 감기는 «따라잡는» 기술이 아니라
        //   «옆을 도는» 기술이라 도착 시간 비교가 뜻이 없다.
        const t = (d / SPEED_BASE) * 1.05;
        const myEta = idd / SPEED_BASE;
        if (myEta > t * 1.6) continue;
      }
      // ★플레이어 가중은 «표적 고르기»에만 붙는다(위 PLAYER_HUNT_BIAS 주석).
      //   회피·먹이·경계 판단은 건드리지 않으므로 봇끼리의 관계가 안 바뀐다.
      const sc = (o.mass / (d + 120)) * (1 - d / P.huntRange) * (canWrap ? 1.25 : 1)
        * (o.isPlayer ? PLAYER_HUNT_BIAS : 1);
      if (sc > huntScore) {
        huntScore = sc;
        hdx = idx / idd;
        hdy = idy / idd;
        huntClose = d < P.huntRange * 0.62;
        wrapping = canWrap;
      }
    }
  }
  if (wrapping) {
    __botDebug.wrapTicks++;
    if (!b.wrapping) __botDebug.wrapStart++;
  }
  b.wrapping = wrapping;

  // ── 5) 합성 ──────────────────────────────────────────────────────────────
  // 위협이 크면 먹이·사냥은 «꺼진다». 살아남는 게 먼저다.
  const calm = 1 - Math.min(1, threat / 0.8);
  let dx = cos * 0.55 + sin * 0; // 관성: 아무 신호가 없으면 가던 길로
  let dy = sin * 0.55;
  dx += ax * P.wAvoid;
  dy += ay * P.wAvoid;
  if (bestScore > 0) {
    dx += fdx * P.wFood * (0.25 + 0.75 * calm);
    dy += fdy * P.wFood * (0.25 + 0.75 * calm);
  }
  if (huntScore > 0) {
    dx += hdx * P.wHunt * calm;
    dy += hdy * P.wHunt * calm;
  }

  /* ══ ⑪ 자기 몸 엄폐 — 「점을 쫓지 않고 한 방향으로 돈다」 ═══════════════
   *  자기 트레일은 남에게만 벽이다(probe_shelter.mjs 로 실측: 자기 몸 위
   *  30스텝 생존 / 추격자는 그 몸에서 사망). 위협이 높으면 그 자산을 쓴다.
   *  ⛔K=0 이면 여기 전체를 건너뛴다 = 비트 동일.
   */
  let sheltering = false;
  if (SHELTER_K > 0) {
    // ③ 클수록 «더 일찍» 시작한다(초거대는 감는 데 시간이 더 걸린다).
    const onT = P.fleeAt * (1 - SHELTER_EARLY_K * big);
    // 벽 근처에서는 감지 않는다 — 경계 회피와 싸우면 벽에 박는다.
    const nearWall = rc > WORLD_R * BOT_WALL_START;
    if (b.shelterSide !== 0 && (threat < onT * SHELTER_EXIT || nearWall)) {
      b.shelterSide = 0;                       // 히스테리시스 해제
    } else if (b.shelterSide === 0 && threat > onT && !nearWall) {
      // ① 부호를 «한 번» 정한다: 내 몸이 있는 쪽으로 돈다.
      const tn = s.trail.count;
      if (tn > 4) {
        const ti = Math.min(tn - 1, Math.max(1, Math.floor(tn * SHELTER_AT)));
        const bx = s.trail.x(ti) - s.x;
        const by = s.trail.y(ti) - s.y;
        // 진행 방향 기준 외적의 부호 = 몸이 좌/우 어느 쪽인가.
        const cross = cos * by - sin * bx;
        b.shelterSide = cross >= 0 ? 1 : -1;
      }
    }
    if (b.shelterSide !== 0) {
      sheltering = true;
      __botDebug.shelterTicks++;
      /* ★성공 지표: 내 몸이 «위협과 나 사이»에 실제로 놓였는가.
         ax,ay 는 위협에서 «멀어지는» 방향이므로 위협 방향은 그 반대다. */
      const tn2 = s.trail.count;
      if (tn2 > 4 && (ax !== 0 || ay !== 0)) {
        const ti2 = Math.min(tn2 - 1, Math.max(1, Math.floor(tn2 * SHELTER_AT)));
        const bx2 = s.trail.x(ti2) - s.x;
        const by2 = s.trail.y(ti2) - s.y;
        const bl = Math.hypot(bx2, by2);
        const al = Math.hypot(ax, ay);
        if (bl > 1 && al > 1e-6 && (bx2 * -ax + by2 * -ay) / (bl * al) > 0.25) {
          __botDebug.shelterShieldTicks++;
        }
      }
    }
  }

  // 방황각: 부드러운 흔들림(장치 2).
  b.wander += (rng.next() - 0.5) * P.noise;
  if (b.wander > Math.PI) b.wander -= TAU;
  else if (b.wander < -Math.PI) b.wander += TAU;
  dx += Math.cos(b.wander) * 0.22 * calm;
  dy += Math.sin(b.wander) * 0.22 * calm;

  if (dx * dx + dy * dy > 1e-8) {
    s.targetAngle = Math.atan2(dy, dx);
  }
  /* ① 엄폐 중에는 «낼 수 있는 최대»로 그 방향으로 돈다.
     크게 요구해도 snake.step 이 turnRate 상한까지만 돌려 주므로
     「도달 불가능한 각도 요구」가 원천적으로 없다. */
  if (sheltering) {
    s.targetAngle = s.angle + b.shelterSide * SHELTER_K;
  }
  b.threat = threat;

  // ── 6) 부스트 판단 ───────────────────────────────────────────────────────
  /* ② 엄폐 중에는 질주하지 않는다. 질주하면 회전 반경이 102 → 192 가 되어
     초거대 몸길이로는 «말리지가 않는다». 엄폐와 질주는 물리적으로 양립 불가라
     따로 재면 둘 다 「효과 없음」으로 나온다. */
  const canBoost = s.mass > BOOST_MIN_MASS * 1.7
    && !(sheltering && SHELTER_NOBOOST > 0);
  if (sheltering && SHELTER_NOBOOST > 0) b.boostUntil = 0;
  if (canBoost) {
    if (threat > P.fleeAt) {
      // 도주: 위협을 등지고 있을 때만 의미가 있다. 정면으로 돌진하면 자살이다.
      const away = Math.abs(angDiff(s.targetAngle, Math.atan2(ay, ax))) < 1.1;
      if (away) b.boostUntil = time + 0.45;
    } else if (wrapping) {
      // ⑧ 감는 중에는 «질러야» 한다. 천천히 돌면 상대가 그냥 빠져나간다.
      b.boostUntil = time + 0.4;
    } else if (huntClose && huntScore > 0) {
      b.boostUntil = time + 0.35;
    } else if (bestScore > 0.09 && rng.next() < 0.03) {
      // 큰 먹이 무더기(사망 드롭)를 향한 «달려들기». 드물게만.
      b.boostUntil = time + 0.3;
    }
  }
  s.boosting = time < b.boostUntil && s.mass > BOOST_MIN_MASS;
}

/**
 * 봇 등급 분포. 합이 BOT_COUNT 가 되도록 world 가 나눠 쓴다.
 *
 * ══ 2026-09-03 «잘하는 등급»으로 비중 이동 (President ④) ═══════════════════
 *     rookie   34% → 20%
 *     regular  45% → 44%
 *     hunter   21% → 36%
 *   ★rookie 를 «없애지 않았다». 20% 를 남긴 이유가 둘 있다:
 *     ① 초보 봇은 플레이어의 «먹이»다. 전부 고수면 성장 경로가 사라져
 *        「어렵다」가 아니라 「아무것도 못 한다」가 된다(그건 실패다).
 *     ② 사람 판에도 초보가 섞여 있다. 전원이 고수면 그것도 기계적으로 보인다.
 *   ★elite 는 여기서 «안 뽑는다» — 질량으로 승격된다(ELITE_MASS 주석).
 *     여기서 뽑으면 갓 태어난 작은 뱀이 최상급 두뇌를 갖게 되어
 *     「작은데 이상하게 안 잡히는 놈」이 생긴다. 실력은 «크기와 함께» 와야 한다.
 */
export function pickTier(rng: Rng): BotTier {
  const r = rng.next();
  if (r < 0.20) return 'rookie';
  if (r < 0.64) return 'regular';
  return 'hunter';
}
