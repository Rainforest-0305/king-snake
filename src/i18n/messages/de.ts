import type { Messages } from '../messages.d';

/**
 * Deutsch — kurz gesprochen, keine Anleitungssprache.
 * ⚠ Deutsch ist rund 30 % länger als Englisch. Die Zeilen hier sind bewusst
 *   knapp gehalten, damit sie im Kill-Feed und in der Hinweiszeile passen.
 */
export const de: Messages = {
  tagline: 'Iss, wachse und überlebe alle',
  play: 'Start',
  nickPlaceholder: 'Dein Name',

  skins: 'Skins',
  skinLocked: 'Ab {n}',
  skinUnlocked: 'Alle Skins frei',
  skinNext: 'Als Nächstes: {name} ab {n}',
  skinNewUnlock: 'Neuer Skin: {name}',

  statsBest: 'Rekord',
  statsBestRank: 'Beste Platzierung',
  statsGames: 'Spiele',
  statsKills: 'Kills',

  controls: 'Steuerung',
  controlJoystick: 'Joystick',
  controlDrag: 'Ziehen',
  sound: 'Sound',
  on: 'An',
  off: 'Aus',
  language: 'Sprache',

  howToTitle: 'So wird gespielt',
  howToSteerTouch: 'Finger ziehen, du folgst ihm',
  howToSteerMouse: 'Maus bewegen, du folgst ihr',
  howToBoost: 'Halten für Sprint. Das kostet Länge',
  howToEat: 'Je mehr Orbs, desto länger wirst du',
  howToKill: 'Wer in deinen Körper kracht, gehört dir',
  howToBorder: 'Roter Rand berührt, vorbei',

  hudLength: 'Länge',
  hudRank: 'Rang',
  leaderboard: 'Bestenliste',
  boost: 'Sprint',

  feedKill: '{killer} erwischt {victim}',
  feedKillMine: 'Du erwischst {victim}',
  feedKillDied: '{killer} erwischt dich',

  paused: 'Pause',
  resume: 'Weiter',
  quit: 'Beenden',

  died: 'Du bist gestorben',
  diedBy: 'In {name} gekracht',
  diedBorder: 'Du hast den roten Rand berührt',
  diedHeadOn: 'Frontal mit {name} kollidiert',
  finalScore: 'Länge',
  finalKills: 'Kills',
  newBest: 'Neuer Rekord',
  playAgain: 'Nochmal spielen',
  toMenu: 'Menü',

  a11yCanvas: 'Schlangen-Arena-Spielfeld',
};
