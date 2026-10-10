// messages.d.ts — 로케일 메시지 «계약».
//
// ★ 키를 추가하면 9개 로케일 «전부»가 컴파일 에러로 막힌다. 그게 의도다.
//   번역 누락은 배포 후에야 「영어가 그대로 뜬다」로 드러나는데, 그때는 이미
//   스토어에 나가 있다. 타입으로 «빌드 시점»에 잡는다.
//
// ★ 치환 규칙: {n} {name} {score} 같은 중괄호 토큰만 쓴다.
//   HTML 을 넣지 마라 — 캔버스에도 그리고 DOM 에도 넣기 때문에 태그가 그대로 보인다.
//
// ★ 한국어 전용 확장: {name:을} — 값 뒤에 «받침에 맞는 조사»를 붙인다.
//   지정자로 쓸 수 있는 대표형: 이 가 / 을 를 / 은 는 / 와 과 / 로 으로.
//   정의는 i18n/index.ts 의 tokenRe(), 계산은 i18n/josa.ts 에 있다.
//   ⚠ 다른 8개 로케일은 조사가 없다. `:` 를 «쓰지 마라» — 한국어 글자가 새어 나간다.

export interface Messages {
  /** 타이틀 화면 한 줄 소개. */
  tagline: string;
  play: string;
  nickPlaceholder: string;

  skins: string;
  /** {n} = 필요 점수. 「아직 못 여는 스킨」에 붙는다. */
  skinLocked: string;
  /** ★ 「보유 중」이 아니라 «전부 열었다»는 뜻이다. 잠긴 스킨이 하나도 없을 때만 뜬다. */
  skinUnlocked: string;
  /** 다음에 열릴 스킨 안내. {name} = 스킨 이름, {n} = 필요 점수 */
  skinNext: string;
  /** {name} = 스킨 이름 */
  skinNewUnlock: string;

  statsBest: string;
  statsBestRank: string;
  statsGames: string;
  statsKills: string;

  controls: string;
  controlJoystick: string;
  controlDrag: string;
  sound: string;
  on: string;
  off: string;
  language: string;

  howToTitle: string;
  /**
   * ★ 조작 안내의 «기본»은 터치다. 마우스판은 예외다.
   *   주 타깃이 토스 미니앱(모바일 세로)이라 손가락 기준으로 먼저 쓰고,
   *   데스크톱(MS Store) 에서만 howToSteerMouse 로 갈아끼운다.
   *   ⚠ 어느 쪽을 쓸지는 «기기 능력»(pointer: coarse)으로 고른다 —
   *     첫 터치 이벤트를 기다리면 첫 화면에서 마우스 문구가 뜬다(실제 결함이었다).
   */
  howToSteerTouch: string;
  howToSteerMouse: string;
  howToBoost: string;
  howToEat: string;
  howToKill: string;
  howToBorder: string;

  hudLength: string;
  hudRank: string;
  leaderboard: string;
  boost: string;

  /**
   * 킬 피드 — «문장»이다. 「A > B」 같은 기호 나열을 쓰지 않는다.
   *   부등호는 어느 언어에서도 읽히는 말이 아니고, 어순이 다른 언어에서는
   *   아예 틀린 순서가 된다(한국어는 목적어가 동사 앞이다).
   * ★ 로케일마다 «어순»이 다르므로 이름 토큰의 위치를 자유롭게 옮겨도 된다.
   *   UI 는 {killer}/{victim} 자리를 찾아 이름만 굵게 칠한다 — 길이 가정 없음.
   * ★ 한국어 조사: 이/가·을/를·와/과 는 앞 글자 받침에 따라 달라진다.
   *   피하지 말고 «지정자»로 계산시킨다 — 「{killer:가} {victim:을} 잡았다」.
   *   (2026-08-25 이전 판은 조사를 피해 「{killer}, {victim} 잡았다」로 썼고,
   *    쉼표가 부르는 말로 읽혀 주어-목적어가 뒤집혔다. messages/ko.ts 머리말 2번)
   */
  feedKill: string;
  /** 내가 잡았을 때. {victim} 만 쓴다. */
  feedKillMine: string;
  /** 내가 당했을 때. {killer} 만 쓴다. */
  feedKillDied: string;

  paused: string;
  resume: string;
  quit: string;

  died: string;
  /** {name} = 상대 이름 */
  diedBy: string;
  diedBorder: string;
  diedHeadOn: string;
  finalScore: string;
  finalKills: string;
  newBest: string;
  playAgain: string;
  toMenu: string;

  /** 접근성 라벨(스크린리더). 화면에는 보이지 않는다. */
  a11yCanvas: string;
}
