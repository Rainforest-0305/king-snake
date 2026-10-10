import type { Messages } from '../messages.d';

/**
 * 한국어 — 주 시장(토스 미니앱)이다. 여기가 어색하면 게임 전체가 어색하다.
 *
 * == 이 파일이 지키는 말투 규칙 ============================================
 *  1) 설명서 말투를 쓰지 않는다. 「~한다」로 끝나는 평서문만 늘어놓으면
 *     게임 화면이 아니라 매뉴얼이 된다. 결과·대가를 같이 말한다.
 *       예) '누르면 질주 - 길이가 줄어든다'  ->  '꾹 누르면 질주. 대신 길이가 준다'
 *  2) ★ 닉네임 뒤 조사는 «계산»한다 — `{killer:가}` `{victim:을}` (i18n/josa.ts).
 *
 *     ══ 이전 규칙을 «폐기»한 이유 (2026-08-25 President 지적) ════════════
 *       전 판본은 「조사는 앞 글자 받침을 타니 아예 쓰지 말자」는 회피 규칙이었고,
 *       주격을 헤드라인체로 눌러 「{killer}, {victim} 잡았다」로 썼다.
 *       실기기에 「순대, 김밥 잡았다」로 떴고 President 가 지적했다.
 *       쉼표가 «부르는 말»(순대야, ...)로 읽혀서 주어-목적어가 뒤집힌다.
 *       스포츠 기사 제목이 성립하는 건 「제목」이라는 문맥이 따로 있어서지,
 *       흘러가는 킬 피드 한 줄에는 그 문맥이 없다. 회피가 문제를 만들었다.
 *     ⇒ 이제 받침을 유니코드로 «판정»한다. 조사를 피하지 말고 제대로 붙인다.
 *       받침에 안 흔들리는 조사(한테·의)는 그대로 써도 된다 — 계산이 불필요할 뿐이다.
 *  3) 하이픈(-)으로 문장을 잇지 않는다. 마침표나 줄바꿈으로 끊는다.
 */
export const ko: Messages = {
  tagline: '먹고, 자라고, 끝까지 살아남기',
  play: '시작',
  nickPlaceholder: '이름',

  skins: '스킨',
  skinLocked: '{n}점부터',
  skinUnlocked: '스킨 전부 열었다',
  skinNext: '다음은 {name} · {n}점',
  skinNewUnlock: '새 스킨 {name}',

  statsBest: '최고 기록',
  statsBestRank: '최고 순위',
  statsGames: '플레이',
  statsKills: '킬',

  controls: '조작',
  controlJoystick: '조이스틱',
  controlDrag: '드래그',
  sound: '소리',
  on: '켬',
  off: '끔',
  language: '언어',

  howToTitle: '플레이 방법',
  howToSteerTouch: '손가락을 끌면 그쪽으로 간다',
  howToSteerMouse: '마우스를 움직이면 그쪽으로 간다',
  howToBoost: '꾹 누르면 질주. 대신 길이가 준다',
  howToEat: '먹이를 먹을수록 길어진다',
  howToKill: '남이 내 몸에 부딪히면 내가 잡는다',
  howToBorder: '붉은 경계에 닿으면 끝이다',

  hudLength: '길이',
  hudRank: '순위',
  leaderboard: '순위표',
  boost: '질주',

  // ★ 「잡았다」는 그대로 둔다. 한국 게임에서 「한 명 잡았다」는 킬을 뜻하는
  //   굳어진 말이라 설명이 필요 없다. 어색했던 건 동사가 아니라 «조사 부재»였다.
  //   ⇒ 「순대, 김밥 잡았다」 → 「순대가 김밥을 잡았다」
  feedKill: '{killer:가} {victim:을} 잡았다',
  feedKillMine: '{victim:을} 잡았다!',
  // 한테 = 받침을 안 탄다. 계산이 필요 없으니 지정자도 붙이지 않는다.
  feedKillDied: '{killer}한테 당했다',

  paused: '일시정지',
  resume: '계속하기',
  quit: '나가기',

  died: '죽었다',
  diedBy: '{name}의 몸에 부딪혔다', // 의 = 받침 무관
  diedBorder: '붉은 경계에 닿았다',
  // 「하고」는 구어에서만 자연스럽다. 결과 화면은 «읽는» 문장이라 와/과로 바꾼다.
  //   순대 → 「순대와 정면으로」 / 김밥 → 「김밥과 정면으로」
  //   ⚠ 와/과는 다른 조사와 «반대»다 — 받침이 있으면 «과»다(josa.ts 에 못 박아 뒀다).
  diedHeadOn: '{name:와} 정면으로 부딪혔다',
  finalScore: '길이',
  finalKills: '킬',
  newBest: '신기록',
  playAgain: '다시 하기',
  toMenu: '메뉴',

  a11yCanvas: '뱀 아레나 게임 화면',
};
