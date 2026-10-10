// save.ts — 진행도 영속화(localStorage).
//
// ★ 원칙(애니멀 라이더 save.ts 계승):
//   1) 어떤 입력이 와도 «throw 하지 않는다». 저장본이 깨졌다고 게임이 안 켜지면
//      유저는 앱이 고장난 줄 안다. 깨졌으면 조용히 초기화하고 게임을 띄운다.
//   2) localStorage 접근 자체가 막힌 환경(사파리 프라이빗·일부 웹뷰)이 실재한다.
//      getItem 이 throw 하는 경우까지 try/catch 로 감싼다.
//   3) 스키마 버전은 «값 안»의 v 필드가 든다. 키에 박으면 낡은 본을 못 본다.
//
// ★ 저장 «대상»은 실제로 존재하는 상태만 넣는다(없는 걸 지어내지 않는다):
//   bestScore/bestRank/games/totalKills/playSeconds — 사망 화면과 스킨 해금의 근거
//   nick/skin/control/sound/locale                 — 유저가 «실제로 고른» 설정
//   해금 스킨 목록은 «저장하지 않는다» — bestScore 에서 유도된다(skins.ts).
//   따로 저장하면 두 값이 어긋날 수 있고, 그때 어느 쪽이 진실인지 알 수 없다.

import { GAME_ID } from './brand';
import { DEFAULT_SKIN_ID, skinById } from './game/skins';

export const SAVE_KEY = GAME_ID + '.save';
export const SAVE_VERSION = 1;

export type ControlMode = 'joystick' | 'drag';

export interface SaveData {
  v: number;
  savedAt: number;
  bestScore: number;
  bestRank: number;
  games: number;
  totalKills: number;
  playSeconds: number;
  nick: string;
  skin: string;
  control: ControlMode;
  sound: boolean;
  /** 사용자가 «직접 고른» 언어. 고른 적이 없으면 null → 브라우저 언어를 따른다. */
  locale: string | null;
}

/*
 * ★ seenHowTo 필드를 «두지 않는다».
 *   처음엔 「안내를 봤는가」를 따로 저장하려 했는데, 실제 판단 기준은 games 다
 *   (첫 세 판까지만 안내한다 - main.ts). 같은 사실을 두 곳에 저장하면 언젠가
 *   어긋나고, 그때 어느 쪽이 진실인지 알 수 없다. 유도할 수 있으면 저장하지 않는다.
 */

const LOG = '[' + GAME_ID + '/save]';

export function defaultSave(): SaveData {
  return {
    v: SAVE_VERSION,
    savedAt: 0,
    bestScore: 0,
    // ★ 0 이 아니라 999 가 «기록 없음»이다. 순위는 작을수록 좋으므로 0 으로 두면
    //   첫 판에서 절대 갱신되지 않는다(부호 실수로 기록이 영원히 안 남는 버그).
    bestRank: 999,
    games: 0,
    totalKills: 0,
    playSeconds: 0,
    nick: '',
    skin: DEFAULT_SKIN_ID,
    control: 'joystick',
    sound: true,
    locale: null,
  };
}

function rawGet(key: string): string | null | undefined {
  try {
    return localStorage.getItem(key);
  } catch {
    return undefined; // 저장소 자체를 못 쓴다
  }
}

function rawSet(key: string, val: string): boolean {
  try {
    localStorage.setItem(key, val);
    return true;
  } catch {
    return false;
  }
}

function rawRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

function str(v: unknown, max: number, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  return Array.from(v).slice(0, max).join('');
}

const BIG = 1e12;

function sanitize(raw: unknown): SaveData {
  const d = defaultSave();
  if (!isObj(raw)) return d;
  d.savedAt = num(raw.savedAt, 0, Number.MAX_SAFE_INTEGER, 0);
  d.bestScore = num(raw.bestScore, 0, BIG, 0);
  d.bestRank = num(raw.bestRank, 1, 999, 999);
  d.games = num(raw.games, 0, BIG, 0);
  d.totalKills = num(raw.totalKills, 0, BIG, 0);
  d.playSeconds = num(raw.playSeconds, 0, BIG, 0);
  d.nick = str(raw.nick, 14, '');
  // 모르는 스킨 id 는 기본값으로 접는다(스킨 목록이 바뀐 경우).
  d.skin = skinById(str(raw.skin, 24, DEFAULT_SKIN_ID)).id;
  d.control = raw.control === 'drag' ? 'drag' : 'joystick';
  d.sound = raw.sound !== false;
  d.locale = typeof raw.locale === 'string' && raw.locale.length <= 12 ? raw.locale : null;
  return d;
}

export type LoadStatus = 'empty' | 'loaded' | 'version-mismatch' | 'corrupt' | 'unavailable';

export function loadSave(): { status: LoadStatus; data: SaveData } {
  const raw = rawGet(SAVE_KEY);
  if (raw === undefined) {
    console.warn(LOG + ' localStorage 사용 불가 - 기록이 남지 않는다(게임은 정상 진행).');
    return { status: 'unavailable', data: defaultSave() };
  }
  if (raw === null) return { status: 'empty', data: defaultSave() };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn(LOG + ' 저장본 파싱 실패 - 초기화한다.', e);
    rawRemove(SAVE_KEY);
    return { status: 'corrupt', data: defaultSave() };
  }
  if (!isObj(parsed)) {
    rawRemove(SAVE_KEY);
    return { status: 'corrupt', data: defaultSave() };
  }
  if (parsed.v !== SAVE_VERSION) {
    console.warn(LOG + ' 스키마 버전 불일치(저장본 v=' + String(parsed.v) + ') - 안전 초기화.');
    rawRemove(SAVE_KEY);
    return { status: 'version-mismatch', data: defaultSave() };
  }
  return { status: 'loaded', data: sanitize(parsed) };
}

export function writeSave(d: SaveData): boolean {
  let json: string;
  try {
    d.v = SAVE_VERSION;
    d.savedAt = Date.now();
    json = JSON.stringify(d);
  } catch (e) {
    console.warn(LOG + ' 직렬화 실패 - 이번 저장을 건너뛴다.', e);
    return false;
  }
  return rawSet(SAVE_KEY, json);
}

export function clearSave(): void {
  rawRemove(SAVE_KEY);
}

/**
 * 한 판이 끝났을 때 기록을 «갱신»한다.
 * @returns 최고 점수를 갱신했는가(사망 화면의 NEW BEST 연출 근거).
 */
export function recordRun(
  d: SaveData,
  score: number,
  rank: number,
  kills: number,
  seconds: number,
): boolean {
  const isBest = score > d.bestScore;
  if (isBest) d.bestScore = score;
  if (rank > 0 && rank < d.bestRank) d.bestRank = rank;
  d.games += 1;
  d.totalKills += kills;
  d.playSeconds += Math.max(0, Math.round(seconds));
  writeSave(d);
  return isBest;
}
