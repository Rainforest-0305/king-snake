// skins.ts — 스킨 = «실존하는 뱀 종».
//
// ★ President 지시(2026-08-18): 「스킨 이름도 실제 존재하는 뱀 이름으로」.
//   그래서 이름만 갈아끼우지 않았다 — 각 종의 «실제 무늬 방식»을 세 가지 유형으로
//   나누고, 색도 그 종의 실제 배색에서 가져왔다. 이름과 그림이 이어져야 이름이 산다.
//
// ══ 2026-08-30 배색 재정리 (President: 「기본 캐릭터인 옥수수 뱀 못 생겼다」) ═══════
//   전 스킨의 색을 «세 단계 명도 규율»로 다시 잡았다:
//     바탕(base)  L 0.62~0.78  — 몸의 대부분. 채도는 중간(과포화 금지).
//     무늬(spot)  L 0.40~0.55  — 바탕보다 «한 단» 어둡고 «같은 색상족 안»에서 붉거나 깊게.
//     테(border)  L 0.20~0.28  — 무늬를 «가두는» 어두운 선. 바탕/무늬가 서로 싸우지 않게 한다.
//   옥수수뱀은 전에 바탕 #e5843f(주황) + 반점 #b93d2f(벽돌) 이 «비슷한 명도로 부딪혀» 촌스러웠다.
//   바탕을 살구빛으로 올리고(L↑, C↓) 반점을 더 붉고 어둡게 내려(L↓) 두 색이 «층»이 되게 했다.
//   머리는 몸과 «다른 색»(반점색 계열)으로 분리한다 — 실제 옥수수뱀 머리의 창 무늬가 그 색이다.
//
// ══ 무늬 유형 세 가지 ══════════════════════════════════════════════════════
//   solid  : 단색 계열. 블랙맘바처럼 «무늬가 없는» 종.
//   rings  : 몸을 «감는 띠». 산호뱀·밀크스네이크·킹스네이크가 이 방식이다.
//   saddle : 등에 얹힌 «반점(안장무늬)». 옥수수뱀·볼파이톤·방울뱀이 이 방식이다.
//            테두리가 어두운 것이 특징이라 색을 3개 쓴다(바탕 / 반점 / 테두리).
//   ⇒ 왜 유형을 나눴나: 전부 같은 띠로 그리면 12종이 «색만 다른 같은 뱀»이 된다.
//     무늬 «구조»가 달라야 멀리서도 종이 구분된다 — 이건 장식이 아니라 식별 정보다.
//
// ══ 저작권 ═════════════════════════════════════════════════════════════════
//   종 이름과 실제 동물의 배색은 저작물이 아니다. 원작 게임의 «고유 스킨 디자인»은
//   복제하지 않았고, 여기 있는 것은 전부 색값 + 대시 간격뿐이라 이미지 에셋이 0개다.
//
// ══ 저장 구조 ══════════════════════════════════════════════════════════════
//   저장본은 스킨 «id» 만 든다(save.ts). 여기서 색을 바꿔도 마이그레이션이 필요 없다.
//   스킨 수(12)·id·해금 점수는 «그대로»다.

/** 무늬 구조. render/snakeRender.ts 가 이 값으로 그리는 방식을 바꾼다. */
export type SnakePattern = 'solid' | 'rings' | 'saddle';

export interface Skin {
  readonly id: string;
  /** 영문 종명. 고유명사라 그대로 쓴다. */
  readonly label: string;
  /** 한국어 종명. i18n 은 ko 에서만 이 값을 쓴다(다른 로케일은 영문 고정). */
  readonly labelKo: string;
  readonly pattern: SnakePattern;
  /**
   * solid  : [바탕]
   * rings  : [바탕, 띠1, (띠2)]
   * saddle : [바탕, 반점, 반점테두리]
   * ★ 첫 색이 «대표색»이다 — 미니맵 점·리더보드 색·사망 파티클이 이걸 쓴다.
   */
  readonly colors: readonly string[];
  /** 무늬 한 칸의 길이 = radius * band. 종마다 무늬 간격이 다르다. */
  readonly band: number;
  /** 외곽 글로우 색. */
  readonly glow: string;
  /**
   * 해금에 필요한 «최고 점수». 0 이면 처음부터 열려 있다.
   * ★ `Number.POSITIVE_INFINITY` = «점수로는 못 연다»(다른 경로 전용 스킨).
   *   숫자를 크게(9999999) 박지 않는 이유: 그러면 UI 가 「9,999,999점」이라는
   *   «거짓 목표»를 그리고, 다음 해금 안내가 그 값을 가리킨다. 무한대는
   *   isFinite() 한 번으로 「점수 경로 없음」이라고 말할 수 있다.
   */
  readonly unlockScore: number;
  /**
   * 누적 광고 시청 «횟수»로 여는 문턱(선택). 없으면 이 경로가 없다.
   * 세는 대상은 skins/adWatchStore.ts 의 AD_COUNT_SOURCES 하나가 정한다.
   */
  readonly unlockAds?: number;
  /** 홍채 색. (머리 색은 2026-08-30 -14 부터 «바탕에서 한 단 진하게» 규칙으로 렌더러가 만든다 — 필드 폐지.) */
  readonly eye?: string;
}

/**
 * ★ 해금 곡선: 0점 3종으로 시작해 600 → 70,000 까지 9단계.
 *
 * ══ 2026-09-03 상위 3종 문턱 상향 (President 지시) ═══════════════════════
 *     블랙맘바      12,000 → 30,000
 *     킹코브라      18,000 → 50,000
 *     알비노비단뱀   26,000 → 70,000
 *   최고급 2종(점수 100,000 / 광고 100회)은 «그대로»다.
 *
 *   ★★ 이 값을 올리는 것만으로는 «라이브 유저의 스킨을 회수한다».
 *      save.ts 가 해금 목록을 저장하지 않고 bestScore 에서 매번 «유도»하기 때문이다
 *      (save.ts 머리말). 최고점 20,847 로 블랙맘바를 딴 유저가 20,847 < 30,000 이 되어
 *      그대로 잠긴다. ⇒ 회수를 막는 것은 이 파일이 아니라
 *      `src/skins/unlockLedger.ts`(해금 «사실» 원장 + 예날 문턱 소급 적립)다.
 *      아래 setUnlockLedger() 로 그 원장이 이 파일에 «주입»된다.
 *   ⛔ 문턱을 또 올릴 일이 생기면 unlockLedger.ts 를 «먼저» 읽어라.
 */
export const SKINS: readonly Skin[] = [
  {
    id: 'corn', label: 'Corn Snake', labelKo: '옥수수뱀',
    pattern: 'saddle', colors: ['#ef9a52', '#c6432c', '#3a1810'],
    band: 1.5, glow: '#ff9a45', unlockScore: 0,
    eye: '#ffc857',
  },
  {
    id: 'greentree', label: 'Green Tree Python', labelKo: '초록나무비단뱀',
    pattern: 'rings', colors: ['#44c25c', '#eefff3'],
    band: 3.4, glow: '#5cf07a', unlockScore: 0,
    eye: '#ffe27a',
  },
  {
    id: 'ballpython', label: 'Ball Python', labelKo: '볼파이톤',
    pattern: 'saddle', colors: ['#cba463', '#4a3520', '#241a0d'],
    band: 1.9, glow: '#d8b070', unlockScore: 0,
    eye: '#e2b45f',
  },
  {
    id: 'milk', label: 'Milk Snake', labelKo: '밀크스네이크',
    pattern: 'rings', colors: ['#d43f34', '#f3e6c8', '#1e1c24'],
    band: 1.1, glow: '#ff5a4a', unlockScore: 600,
    eye: '#ffd27a',
  },
  {
    id: 'kingsnake', label: 'California Kingsnake', labelKo: '캘리포니아킹스네이크',
    pattern: 'rings', colors: ['#2a2a31', '#f4ecd6'],
    band: 1.3, glow: '#9aa0b5', unlockScore: 1200,
    eye: '#d6ccb4',
  },
  {
    id: 'emerald', label: 'Emerald Tree Boa', labelKo: '에메랄드나무보아',
    pattern: 'rings', colors: ['#12a878', '#f4fffb'],
    band: 2.2, glow: '#2fe3a0', unlockScore: 2200,
    eye: '#ffe27a',
  },
  {
    id: 'coral', label: 'Coral Snake', labelKo: '산호뱀',
    pattern: 'rings', colors: ['#d83d31', '#f2d24f', '#1c1b22'],
    band: 1.0, glow: '#ff6b4a', unlockScore: 3600,
    eye: '#ffd27a',
  },
  {
    id: 'sidewinder', label: 'Sidewinder', labelKo: '사이드와인더',
    pattern: 'saddle', colors: ['#dcc292', '#8b7048', '#4c3b23'],
    band: 1.6, glow: '#e8d0a0', unlockScore: 5500,
    eye: '#e8d0a0',
  },
  {
    id: 'rattlesnake', label: 'Diamondback Rattlesnake', labelKo: '다이아몬드방울뱀',
    pattern: 'saddle', colors: ['#b9925f', '#5a4326', '#e6d3ae'],
    band: 1.4, glow: '#d0a870', unlockScore: 8000,
    eye: '#e3c98a',
  },
  {
    id: 'mamba', label: 'Black Mamba', labelKo: '블랙맘바',
    pattern: 'solid', colors: ['#5f676c'],
    band: 1.0, glow: '#8fa0a8', unlockScore: 30000,
    eye: '#d3dbe0',
  },
  {
    id: 'kingcobra', label: 'King Cobra', labelKo: '킹코브라',
    pattern: 'rings', colors: ['#8d7743', '#e6d6a3', '#3a2e18'],
    band: 1.7, glow: '#d8bd6a', unlockScore: 50000,
    eye: '#f0d27a',
  },
  {
    id: 'albino', label: 'Albino Python', labelKo: '알비노비단뱀',
    pattern: 'saddle', colors: ['#f9f1e1', '#f2cb5e', '#dba640'],
    band: 2.0, glow: '#ffe9a8', unlockScore: 70000,
    eye: '#ff8fa4',
  },

  /* ══ 고급 스킨 2종 (2026-09-02 President) ═══════════════════════════════
   *  요건: 「점수 10만 / 광고 100회」. 종 선택 기준은 두 가지다 —
   *   ① «실존 종»일 것(2026-08-18 President 지시, 이 파일의 대전제)
   *   ② 「모두가 갖고 싶게」 = 실제로 세상에서 가장 화려한 뱀일 것.
   *      코뿔소북살무사는 «살아 있는 뱀 중 가장 화려하다»고 불리는 종이고
   *      (보라·청록·황금 기하 무늬), 파란말레이산호뱀은 «전기빛 파랑 옆줄 +
   *      네온 붉은 머리·꼬리»라는 자연계에서 드문 배색을 가졌다.
   *      색을 지어내지 않았다 — 둘 다 실제 배색에서 가져왔다.
   *  ★ 무늬 «유형»도 기존 3종(solid/rings/saddle) 안에서만 고른다. 새 유형을
   *    만들면 렌더러(보호 파일 아님이지만 12종 규칙을 공유)가 갈라진다.
   */
  {
    // 세계에서 가장 화려한 뱀. 보라-청록-황금 삼색 기하 무늬 + 코 위의 «뿔».
    id: 'rhinoviper', label: 'Rhinoceros Viper', labelKo: '코뿔소북살무사',
    /* ★ 배색은 이 파일의 «세 단계 명도 규율»을 따른다(바탕 L .62~.78 / 무늬 L .40~.55
       / 테 L .20~.28). 처음엔 바탕을 청록 #3f7f8c(L≈.48)로 뒀는데 «규율 위반»이라
       실렌더에서 몸이 배경(남색)에 먹혀 탁하게 보였다 — 최고급 스킨이 기본 스킨보다
       못생겨 보였다. 바탕을 금빛으로 올리고 무늬를 보라로 내려 «층»을 만들었다.
       실제 종도 금빛 등줄 + 보라·남색 삼각 무늬 + 검은 테가 특징이다. */
    pattern: 'saddle', colors: ['#cdb46c', '#6d3f9c', '#20143a'],
    band: 1.15, glow: '#a678f0', unlockScore: 100000,
    eye: '#ffd166',
  },
  {
    // 전기빛 파랑 옆줄 + 네온 붉은 머리·꼬리. 독이 «즉시» 듣는 것으로 유명하다.
    id: 'bluecoral', label: 'Blue Malayan Coral Snake', labelKo: '파란말레이산호뱀',
    /* ★ 같은 이유로 바탕을 «전기빛 파랑»으로 올렸다. 처음엔 바탕 #1b2a6b(남색,
       L≈.22)에 하늘색 띠였는데, 그건 «테 색을 바탕에 쓴 것»이라 몸이 어두운
       아레나에 파묻혔다(실렌더 확인). 실제 종도 «밝은 파란 옆줄»이 주인공이고
       남색은 그 사이를 가르는 선, 붉은색은 머리·꼬리의 강조다. */
    pattern: 'rings', colors: ['#5fc9f3', '#1f3a8a', '#ff3b5c'],
    band: 2.6, glow: '#4fd6ff',
    // ★ 점수로는 «못 연다». 이 스킨의 경로는 광고 누적 하나뿐이다.
    unlockScore: Number.POSITIVE_INFINITY,
    unlockAds: 100,
    eye: '#ff2d55',
  },
];

export const DEFAULT_SKIN_ID = 'corn';

/* ══ 광고로 «해금을 제안할» 스킨 — 화이트리스트 (President 2026-09-01) ══════
 *
 *   ★지시: 「블랙맘바도 광고로 얻을 수 있으면 손해가 너무 크다.
 *           하위 등급 스킨 3종에서 5종만 광고로 얻을 수 있게 해라.」
 *
 * ── 왜 «조건식»이 아니라 «id 목록»인가 ────────────────────────────────────
 *   「unlockScore <= 5500」 같은 조건식으로 쓰면 스킨을 하나 추가하거나 문턱을
 *   조정하는 순간 «대상이 조용히 늘어난다». 그 방향이 돈이 나가는 방향이다(아래 ②).
 *   id 를 박아 두면 새 스킨은 «기본 차단»이고, 늘리려면 이 배열을 손대야 한다 —
 *   그 편집은 diff 에 보인다. 이게 이 상수의 존재 이유이고, 이 규율은 자동 검사기가
 *   아니라 «형태»가 지킨다.
 *
 * ── 왜 이 5종인가 ────────────────────────────────────────────────────────
 *   ① 문턱 0 인 기본 3종(corn·greentree·ballpython)은 처음부터 열려 있어 광고가
 *      필요 없다. 그래서 «광고 대상» = 문턱이 있는 9종 중 가장 낮은 5개다.
 *   ② 프로모션 「블랙맘바 해금하기」(500원 고정 · 예산 5,000원 = «10건이면 소진»)가
 *      RUNNING 이다. mamba(12000)를 광고 1편으로 열 수 있으면 혜택탭에서 들어온
 *      유저가 광고 한 번에 500원을 가져간다 → 출시 하루이틀에 예산이 빈다.
 *      ⇒ mamba 와 그 언저리를 «전부» 잘라 블랙맘바는 점수 12,000 경로만 남긴다:
 *        rattlesnake 8000 · mamba 12000 · kingcobra 18000 · albino 26000 = 광고 불가.
 *        (mamba 바로 아래 rattlesnake 까지 자른 것은 여유분이다 — 문턱 한 단이
 *         바뀌어도 mamba 가 목록에 «닿지 않게» 두 칸을 띄웠다.)
 *
 * ── 3종으로 줄이려면 ─────────────────────────────────────────────────────
 *   이 배열에서 뒤 2개(coral·sidewinder)를 지운다. «이 상수 하나»만 고치면
 *   제안 판정(main.ts canAdUnlockSkin)·카드 버튼(ui/shell.ts refreshSkins)·
 *   지급(main.ts onSkinAdUnlock)이 전부 따라온다 — 셋 다 같은 한 함수에 묻는다.
 *
 * ── ⚠️회수는 «없다» ──────────────────────────────────────────────────────
 *   이건 「앞으로 새로 제안하지 않는다」일 뿐이다. 보유 판정은 여기가 아니라
 *   rewardStore.isSkinAdUnlocked 가 하고, 그쪽은 «손대지 않았다». 이 목록에서
 *   빠진 mamba 를 예전에 광고로 연 유저는 계속 보유·착용한다(검증 M0b·W5).
 *   프로모션 「보유」 정의(main.ts ownsPromoSkin)도 그대로다.
 */
export const AD_UNLOCKABLE_SKIN_IDS: readonly string[] = [
  'milk',        //   600점
  'kingsnake',   //  1200점
  'emerald',     //  2200점
  'coral',       //  3600점
  'sidewinder',  //  5500점
];

/** 이 스킨에 «광고 해금을 제안해도 되는가». 보유 여부·상한과는 무관한 «자격»만 본다. */
export function isAdUnlockableSkin(id: string): boolean {
  return AD_UNLOCKABLE_SKIN_IDS.indexOf(id) >= 0;
}

export function skinById(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

/* ══ 해금 «사실» 원장 주입 (2026-09-03) ═════════════════════════════
 *
 *  ★왜 여기서 localStorage 를 직접 읽지 않는가:
 *    이 폴더(game/)는 «아무것도 모른다»가 규칙이다(world.ts 머리말의 단방향 규칙).
 *    저장소를 import 하는 순간 시뮬레이션 코드가 브라우저에 묶여
 *    헤드리스 밸런스 스윈(tools/qa_early.mjs — node 에서 world.ts 를 그대로 돌린다)이
 *    죽는다. 그래서 «판정 함수 하나»만 주입받는다.
 *
 *  ★기본값이 «항상 false» 인 것이 중요하다. 주입을 잊거나(시뮬·테스트) 원장이
 *    비어 있으면 판정은 정확히 «예전 그대로»가 된다 — 이 훅은 무언가를 «열어주는»
 *    방향으로만 작동하고, 잠그는 방향으로는 절대 작동하지 않는다.
 *
 *  ★관문이 «하나»다: 보유 판정은 화면 여러 곳(레일 카드·히어로·사망 시트·
 *    프로모션 보유 판정·광고 제안 차단)에서 나오지만 전부 isSkinUnlocked() 에 묻는다.
 *    그래서 여기 한 줄이면 「카드는 열렸는데 프로모션은 미보유」 같은 어긋남이
 *    구조적으로 안 생긴다.
 */
const NO_LEDGER = (_id: string): boolean => false;
let scoreLedgerHas: (id: string) => boolean = NO_LEDGER;

/** main.ts 가 부팅 시 skins/unlockLedger.ts 의 isScoreLedgered 를 넣어 준다. */
export function setUnlockLedger(has: (id: string) => boolean): void {
  scoreLedgerHas = has;
}

/** 진단용 — 주입 여부를 볼 수 있어야 「안 불렸다」를 검사기가 잡는다. */
export function isUnlockLedgerBound(): boolean {
  return scoreLedgerHas !== NO_LEDGER;
}

/** 로케일에 맞는 종 이름. 한국어만 번역하고 나머지는 영문 종명을 그대로 쓴다. */
export function skinName(skin: Skin, locale: string): string {
  return locale === 'ko' ? skin.labelKo : skin.label;
}

/**
 * «점수로» 열렸는가.
 * ★ 의미를 넓히지 않았다 — 광고 누적 경로는 여기가 아니라
 *   skins/skinUnlock.ts 가 본다. 이 함수는 이미 사망 시트의 「새 스킨 달성」
 *   축하 판정에 쓰이고 있어서(shell.ts refreshSkins 주석), 여기에 다른 경로를
 *   섞으면 광고로 연 스킨이 «점수로 달성한 것»으로 축하된다.
 */
export function isSkinUnlocked(skin: Skin, bestScore: number): boolean {
  // ★ «이미 열렸던» 것은 문턱이 올라가도 다시 잠기지 않는다(2026-09-03).
  //   순서가 «먼저»인 것이 중요하다 — 아래 isFinite 가드보다 앞에 있어야
  //   점수 경로가 사라진 스킨(있다면)도 보유가 유지된다.
  if (scoreLedgerHas(skin.id)) return true;
  if (!isFinite(skin.unlockScore)) return false; // 점수 경로가 «없는» 스킨
  return bestScore >= skin.unlockScore;
}

/** 점수로 열 수 있는 스킨인가(= 문턱이 유한한가). */
export function hasScorePath(skin: Skin): boolean {
  return isFinite(skin.unlockScore);
}

/**
 * 다음에 «점수로» 열릴 스킨(없으면 null).
 * ★ 점수 경로가 없는 스킨은 후보에서 뺀다 — 안 그러면 「다음은 파란말레이산호뱀 ·
 *   Infinity점」이 뜬다(실제로 그렇게 나왔다).
 */
export function nextLockedSkin(bestScore: number): Skin | null {
  let best: Skin | null = null;
  for (const s of SKINS) {
    if (!hasScorePath(s)) continue;
    // ★ 이미 보유한 것을 «목표»로 그리면 안 된다. 문턱 상향 뒤 소급 보유자에게
    //   「다음은 블랙맘바 · 30,000점」이 뜼는데 그는 이미 그걸 입고 있다.
    if (scoreLedgerHas(s.id)) continue;
    if (s.unlockScore > bestScore && (!best || s.unlockScore < best.unlockScore)) best = s;
  }
  return best;
}

/** 봇 외형 한 벌. world.ts 가 `BOT_PALETTE[i % length]` 로 집어 간다. */
export interface BotLook {
  colors: readonly string[];
  band: number;
  glow: string;
  pattern: SnakePattern;
  eye?: string;
}

/**
 * 봇 «기본» 배색 12종. 플레이어 해금 스킨과 «겹치지 않는» 실존 종에서 가져왔다
 * (garter / rat snake / hognose / bush viper / gopher / racer 등).
 * ★ 해금 스킨을 봇이 흔하게 입으면 해금의 가치가 사라진다 — 그래서 분리한다.
 *   예외는 «최고급 2종»뿐이고, 그 이유와 비율은 바로 아래 BOT_PREMIUM_* 에 있다.
 */
const BOT_PALETTE_BASE: readonly BotLook[] = [
  { colors: ['#5cabd9', '#e0f1fb'], band: 2.0, glow: '#5ec8ff', pattern: 'rings' },
  { colors: ['#c47d4d', '#3a2414', '#1c1109'], band: 1.6, glow: '#e09a6a', pattern: 'saddle' },
  { colors: ['#82c15c'], band: 1.0, glow: '#8ef07a', pattern: 'solid' },
  { colors: ['#d4af45', '#4d3d16', '#28200a'], band: 1.4, glow: '#f7d154', pattern: 'saddle' },
  { colors: ['#aa72d2', '#2c1440'], band: 1.5, glow: '#c084fc', pattern: 'rings' },
  { colors: ['#4fbab2', '#0d3b38'], band: 2.4, glow: '#67e8f9', pattern: 'rings' },
  { colors: ['#d16c74', '#f4d9db'], band: 1.2, glow: '#fb7185', pattern: 'rings' },
  { colors: ['#909c5c'], band: 1.0, glow: '#a3e635', pattern: 'solid' },
  { colors: ['#bb91d2', '#f0ddf8', '#3a2448'], band: 1.8, glow: '#c084fc', pattern: 'saddle' },
  { colors: ['#4b91d2', '#0b2c4a'], band: 1.3, glow: '#38bdf8', pattern: 'rings' },
  { colors: ['#d2945c', '#5a3a1c', '#2a1a0c'], band: 1.7, glow: '#fdba74', pattern: 'saddle' },
  { colors: ['#41ba98'], band: 1.0, glow: '#2dd4bf', pattern: 'solid' },
];

/* ══ ③ 봇이 «최고급 스킨»을 입는다 (President 2026-09-03) ═══════════════════
 *
 *  지시 원문: 「플레이어 중에 최고급 스킨 보유자도 늘려.」
 *  = 화면에 나오는 봇들 중 최고급 스킨(점수 100,000 / 광고 100회)을 입은 개체를 늘려라.
 *  ★의도는 「갖고 싶게 만드는 것」이다. 지금은 «0마리»라 유저는 그 스킨이 무엇인지
 *    평생 볼 일이 없다 — 팔 물건을 진열도 안 한 상태였다.
 *
 * ── 왜 «흔하게» 만들지 않는가 ──────────────────────────────────────────────
 *  너무 흔하면 희소성이 죽어 역효과다. 목표는 「가끔 보이는데 눈에 확 띈다」.
 *  화면 안에 동시에 보이는 뱀 기대값은 2~3마리다(config.ts WORLD_R 주석의 실측).
 *  착용률 p 면 한 마리 마주칠 때마다 p 확률로 최고급이 보인다.
 *    p=20% → 판마다 여러 번 = 흔한 것 = 안 갖고 싶다
 *    p=4%  → 한 판(2~3분)에 1~2회 = 「어? 저건 뭐지」 ⇐ 채택
 *    p=1%  → 몇 판을 해도 못 본다 = 지금과 다를 바 없다
 *
 * ── 왜 «풀 크기»로 비율을 만드는가 ────────────────────────────────────────
 *  world.ts 는 `BOT_PALETTE[i % BOT_PALETTE.length]` 로 외형을 집어 간다(보호 파일이라
 *  그 줄은 «건드리지 않는다»). 그러면 착용률은 정확히 «풀 안의 최고급 자리 비율»이다.
 *  ⇒ 기본 12종을 4번 늘어놓아 48칸을 만들고, 그중 2칸을 최고급으로 «바꾼다».
 *    2/48 = 4.17%. 두 칸을 7·31 로 멀리 띄운 이유는 봇 index 가 스폰 순서라
 *    붙여 두면 최고급 둘이 «같이» 태어나 한 번에 보이기 때문이다.
 *  ★난수를 쓰지 않는다 — 시드가 같으면 결과가 같아야 밸런스 스윕이 비교 가능해진다.
 *
 * ── ⚠렌더 비용은 «늘지 않는다» (실측 확인) ────────────────────────────────
 *  「최고급은 발광 효과가 있으니 착용 봇이 늘면 GPU 가 곱해진다」는 사실이 아니었다.
 *  render/snakeRender.ts 의 글로우는 «모든 뱀»이 style.glow 로 같은 경로를 탄다
 *  (snakeRender.ts:465·601 — 스킨 종류를 안 본다). 특수 능력(skinAbility)도
 *  main.ts 가 save.skin 으로만 만든다 = «플레이어 전용»이라 봇에는 붙지 않는다.
 *  무늬 유형도 saddle(3색)·rings(3색)으로 기본 팔레트에 이미 있는 조합이다.
 *  ⇒ 비용 차이 0. 그래도 10·30·60마리 프레임은 실측한다(추측을 남기지 않는다).
 */

/** 풀 크기. 착용률 = BOT_PREMIUM_SLOTS.length / BOT_PALETTE_POOL. */
export const BOT_PALETTE_POOL = 48;
/** 풀 안에서 «최고급»이 들어가는 자리. 서로 멀리 띄운다(위 주석). */
export const BOT_PREMIUM_SLOTS: readonly number[] = [7, 31];
/** 그 자리에 넣을 스킨. skins 목록에서 «그대로» 가져온다 — 색을 두 벌 관리하지 않는다. */
export const BOT_PREMIUM_SKIN_IDS: readonly string[] = ['rhinoviper', 'bluecoral'];

function buildBotPalette(): readonly BotLook[] {
  const pool: BotLook[] = [];
  for (let i = 0; i < BOT_PALETTE_POOL; i++) {
    pool.push(BOT_PALETTE_BASE[i % BOT_PALETTE_BASE.length]);
  }
  for (let k = 0; k < BOT_PREMIUM_SLOTS.length; k++) {
    const slot = BOT_PREMIUM_SLOTS[k];
    const id = BOT_PREMIUM_SKIN_IDS[k % BOT_PREMIUM_SKIN_IDS.length];
    const sk = SKINS.find((x) => x.id === id);
    // ★못 찾으면 «조용히 기본 외형으로 둔다». 스킨 id 오타로 게임이 안 켜지는 쪽이 더 나쁘다.
    if (!sk || slot < 0 || slot >= pool.length) continue;
    // ★colors 배열을 «그대로» 넘긴다(사본 아님). LOOKS WeakMap 이 배열 동일성으로
    //   홍채색을 되찾으므로, 사본을 만들면 눈 색만 기본값으로 어긋난다.
    pool[slot] = { colors: sk.colors, band: sk.band, glow: sk.glow, pattern: sk.pattern, eye: sk.eye };
  }
  return pool;
}

export const BOT_PALETTE: readonly BotLook[] = buildBotPalette();

/**
 * 봇 n 마리 중 «최고급을 입는» 마릿수. world 의 `i % length` 배정을 그대로 계산한다.
 * ★검사기가 기대값을 박지 않고 «여기서 유도»하도록 내보낸다.
 */
export function botPremiumCount(botCount: number): number {
  let n = 0;
  for (let i = 0; i < botCount; i++) {
    if (BOT_PREMIUM_SLOTS.indexOf(i % BOT_PALETTE_POOL) >= 0) n++;
  }
  return n;
}

/**
 * ★ 렌더 전용 «외형» 조회. game/snake.ts 의 SnakeStyle(보호 파일)은 colors/band/glow/pattern
 *   네 필드뿐이라 머리·홍채 색을 실을 자리가 없다. world 는 스킨의 colors «배열 그 자체»를
 *   style.colors 로 넘기므로, 배열 «동일성»으로 스킨/봇 배색을 되찾는다. 보호 파일 무접촉.
 */
export interface SkinLook { eye: string }
const LOOKS = new WeakMap<readonly string[], SkinLook>();
for (const s of SKINS) LOOKS.set(s.colors, { eye: s.eye ?? '#ffd27a' });
for (const b of BOT_PALETTE) LOOKS.set(b.colors, { eye: b.eye ?? '#ffd27a' });
const DEFAULT_LOOK: SkinLook = { eye: '#ffd27a' };
export function lookFor(colors: readonly string[]): SkinLook {
  return LOOKS.get(colors) ?? DEFAULT_LOOK;
}
