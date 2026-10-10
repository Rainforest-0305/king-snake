import type { Messages } from '../messages.d';

/**
 * English — the fallback locale. Every other file is checked against this one.
 *
 * Voice: short, spoken, sentence case. No ALL-CAPS shouting on labels — the
 * primary button is already the loudest thing on screen; capitalising it too
 * is the interface raising its voice for no reason (and it can't be mirrored
 * in ko/ja/zh, which have no case, so the locales drift apart).
 */
export const en: Messages = {
  tagline: 'Eat, grow, outlast everyone',
  play: 'Play',
  nickPlaceholder: 'Your name',

  skins: 'Skins',
  skinLocked: 'Unlocks at {n}',
  skinUnlocked: 'Every skin unlocked',
  skinNext: 'Next: {name} at {n}',
  skinNewUnlock: 'New skin: {name}',

  statsBest: 'Best',
  statsBestRank: 'Best rank',
  statsGames: 'Games',
  statsKills: 'Kills',

  controls: 'Controls',
  controlJoystick: 'Joystick',
  controlDrag: 'Drag',
  sound: 'Sound',
  on: 'On',
  off: 'Off',
  language: 'Language',

  howToTitle: 'How to play',
  howToSteerTouch: 'Drag your finger and you follow it',
  howToSteerMouse: 'Move the mouse and you follow it',
  howToBoost: 'Hold to sprint. It costs you length',
  howToEat: 'The more orbs you eat, the longer you get',
  howToKill: 'Anyone who hits your body is yours',
  howToBorder: 'Touch the red ring and it is over',

  hudLength: 'Length',
  hudRank: 'Rank',
  leaderboard: 'Leaderboard',
  boost: 'Boost',

  feedKill: '{killer} took out {victim}',
  feedKillMine: 'You took out {victim}',
  feedKillDied: '{killer} took you out',

  paused: 'Paused',
  resume: 'Resume',
  quit: 'Quit',

  died: 'You died',
  diedBy: 'Crashed into {name}',
  diedBorder: 'You hit the red ring',
  diedHeadOn: 'Head-on with {name}',
  finalScore: 'Length',
  finalKills: 'Kills',
  newBest: 'New best',
  playAgain: 'Play again',
  toMenu: 'Menu',

  a11yCanvas: 'Snake arena game field',
};
