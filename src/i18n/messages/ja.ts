import type { Messages } from '../messages.d';

/** 日本語 — 説明書口調を避け、ゲーム内で読まれる短い話し言葉に寄せる。 */
export const ja: Messages = {
  tagline: '食べて、育って、最後まで生き残れ',
  play: 'スタート',
  nickPlaceholder: '名前を入力',

  skins: 'スキン',
  skinLocked: '{n}で解放',
  skinUnlocked: '全スキン解放ずみ',
  skinNext: '次は{name}・{n}',
  skinNewUnlock: '新スキン {name}',

  statsBest: '最高記録',
  statsBestRank: '最高順位',
  statsGames: 'プレイ数',
  statsKills: 'キル数',

  controls: '操作',
  controlJoystick: 'スティック',
  controlDrag: 'ドラッグ',
  sound: 'サウンド',
  on: 'オン',
  off: 'オフ',
  language: '言語',

  howToTitle: '遊び方',
  howToSteerTouch: '指をドラッグした方へ進む',
  howToSteerMouse: 'マウスを動かした方へ進む',
  howToBoost: '長押しでダッシュ。長さを使う',
  howToEat: 'オーブを食べるほど長くなる',
  howToKill: '相手が自分の体に当たればキル',
  howToBorder: '赤い境界に触れたら終わり',

  hudLength: '長さ',
  hudRank: '順位',
  leaderboard: 'ランキング',
  boost: 'ダッシュ',

  feedKill: '{killer}が{victim}を撃破',
  feedKillMine: '{victim}を撃破!',
  feedKillDied: '{killer}にやられた',

  paused: '一時停止',
  resume: '再開',
  quit: 'やめる',

  died: 'やられた',
  diedBy: '{name}の体にぶつかった',
  diedBorder: '赤い境界に触れた',
  diedHeadOn: '{name}と正面衝突',
  finalScore: '長さ',
  finalKills: 'キル数',
  newBest: '新記録',
  playAgain: 'もう一度',
  toMenu: 'メニュー',

  a11yCanvas: 'スネークアリーナゲーム画面',
};
