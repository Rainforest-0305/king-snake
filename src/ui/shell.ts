// shell.ts - DOM UI 셸(타이틀 / HUD / 일시정지 / 결과).
//
// == 이 화면이 지켜야 하는 것 ==============================================
//  1) 게임 캔버스 «위»에 얹힌다. 배경색이 매 순간 바뀐다.
//     => 글자는 항상 «불투명한 표면» 위에만 놓는다. 반투명 유리 위에 글자를
//        올리면 밑에 지나가는 뱀 색에 따라 대비가 무너진다.
//  2) 60fps 를 게임과 «나눠 쓴다».
//     => DOM 을 매 프레임 건드리지 않는다. 노드를 한 번 만들고 텍스트만 갱신하며,
//        갱신 주기도 8Hz 로 제한한다(사람은 초당 8번이면 이미 실시간으로 느낀다).
//     => backdrop-filter 를 쓰지 않는다(styles.css 머리말 참조).
//  3) innerHTML 로 «사용자 입력»을 넣지 않는다. 닉네임도 봇 이름도 결국
//     문자열이다. 전부 textContent 로만 넣는다(주입 경로 원천 차단).
//
// == 의도적으로 «쓰지 않은» 흔한 패턴 ======================================
//  · 그라디언트 텍스트        - 장식일 뿐 의미가 없다. 단색 + 굵기로 위계를 만든다.
//  · 작은 대문자 넓은자간 라벨 - 섹션마다 붙는 「eyebrow」는 지금 가장 흔한 AI 문법이다.
//  · 큰 숫자 + 작은 라벨 격자 - 결과 화면의 hero-metric 템플릿. 라벨-값 «행»으로 바꿨다.
//  · 같은 크기 카드 격자      - 스킨 선택을 「큰 미리보기 + 작은 레일」로 바꿨다.
//  · 유리(glassmorphism)      - 위 1)/2) 와 정면으로 충돌한다.

import { BRAND_EN, BRAND_KO } from '../brand';
import { SKINS, skinById, isSkinUnlocked, skinName, nextLockedSkin, type Skin } from '../game/skins';
/* 스킨 요건·특수 기능 (2026-09-02 ①). 문구는 i18n 이 «보호 파일»이라 별도 사전이다. */
import { skinRequirement } from '../skins/skinUnlock';
import { st, sfmt, abilityName, abilityDesc, abilityDetail } from '../skins/skinText';
import { abilityOf, abilityFactsOf } from '../skins/skinAbility';
import { t, josa, tokenRe, getLocale, SUPPORTED_LOCALES, LOCALE_LABELS, type Locale } from '../i18n';
/* 실기기 진단 줄이 읽는 입력 계측 스냅샷(기본 OFF — toggleLiveDiag 참고). */
import { DIAG as INPUT_DIAG } from '../input';
import type { SaveData, ControlMode } from '../save';
import type { DeathInfo } from '../game/world';
import { rgba, lighten } from '../render/color';
import { renderSkinPreview } from '../render/snakeRender';
import { fmt, gt, rst, rt } from '../reward/rewardText';
import { growthLabel, startBoostLabel } from '../reward/gameEffects';
import { type GrowthTriggerKind } from '../reward/growthTriggers';
/* 토스 전용 조각(2026-09-10 레인 A): 푸시 동의 행·안내 카드, 머니 리그 교차추천. 문구는 자기 사전. */
import { tt } from '../toss/tossText';
import type { PushState } from '../toss/pushAgreement';

export interface LeaderRow {
  name: string;
  score: number;
  color: string;
  isPlayer: boolean;
}

/** 킬 피드 한 줄에 필요한 것 전부. game/world 의 KillEvent 와 같은 모양이다. */
export interface KillFeedEvent {
  killerName: string;
  victimName: string;
  killerIsPlayer: boolean;
  victimIsPlayer: boolean;
}

/**
 * 실기기 진단 줄 2행(성능)에 찍을 값. ★전부 «이미 있는» 계측에서 읽는다 —
 * renderer.times(profile 켤 때만 돌음) · gov.tier · 캔버스 크기 · fps.
 * 새 계측을 만들지 않는 것이 규칙이다(계측 자체가 프레임을 먹는다).
 */
export interface DiagPerf {
  fps: number;
  /** 최근 2초 프레임 «간격» p95(ms). 진단 ON 일 때만 링에 쌓는다. */
  fp95: number;
  sim: number;
  rend: number;
  post: number;
  body: number;
  tier: number;
  /** 화면 안 «굵은»(반지름 ≥ 20) 뱀 수. */
  giants: number;
  dpr: number;
  cw: number;
  ch: number;
  webgl: boolean;
  /** 마지막 품질 강등: [tier, 그 시각(초)]. 없으면 null. */
  lastDown: [number, number] | null;
}

export interface ShellCallbacks {
  onPlay(nick: string): void;
  onSkin(id: string): void;
  onControl(mode: ControlMode): void;
  onSound(on: boolean): void;
  onLocale(l: Locale): void;
  onPauseToggle(): void;
  onResume(): void;
  onQuit(): void;
  /** 버튼·토글을 «눌렀다»는 촉각 대체(효과음). 선택 사항. */
  onUi?(): void;

  /* -- 실기기 진단 줄(2026-09-08) ------------------------------------------
   *  ★ 왜 콜백인가: 셸은 렌더러를 «모른다». 그 경계를 지키려고 main.ts 가
   *    「켜라/꺼라」와 「지금 값 내놔라」 두 개만 넘겨준다.
   *  ★ 비용 규율: OFF 면 main.ts 가 renderer.profile 을 끄므로 층별 ms 측정
   *    자체가 «안 돈다». 켤 때만 켠다. */
  /** 진단 줄이 켜졌다/꺼졌다. main 이 renderer.profile 과 프레임 링을 여기서 켠다. */
  onDiagToggle?(on: boolean): void;
  /** 진단 줄에 찍을 성능 스냅샷. OFF 상태에서는 «부르지 않는다». */
  diagPerf?(): DiagPerf | null;

  /* -- 리워드 광고(2026-08-31 신설). 셸은 «눌렀다»만 알린다 -----------------
   *  광고 표시·보상 판정·지급은 전부 main.ts 가 한다. 셸이 광고 SDK 를 모르게
   *  두어야 UI 검사기(qa_ui/qa_i18n/shots)가 셸을 «광고 없이» 그대로 띄운다. */
  /** 사망 시트 「광고 보고 부활」을 눌렀다. */
  onReviveAd?(): void;
  /** 메뉴 「광고 보고 길게 시작」을 눌렀다. */
  onStartBoostAd?(): void;
  onSkinProgressAd?(): void;
  /** 잠긴 스킨을 «광고로» 열겠다고 눌렀다. */
  onSkinAdUnlock?(id: string): void;
  /** 기록 돌파 제안에서 「광고 보고 키우기」를 눌렀다(2026-08-31). */
  onGrowthAd?(): void;
  /** 기록 돌파 제안에서 「그냥 계속」을 눌렀다. */
  /** 배너를 «지금» 닫는다(자동소멸을 앞당길 뿐 — 재개 절차는 없다). */
  onGrowthSkip?(): void;

  /* -- 2026-09-10 레인 A ----------------------------------------------------- */
  /** 결과 화면 「광고 보고 이번 판 성장 2배」를 눌렀다. 광고·지급은 main.ts. */
  onResultDoubleAd?(): void;
  /** 「알림」 행 또는 안내 카드의 「받기」를 눌렀다(토스 동의창 호출은 main.ts). */
  onPushEnable?(): void;
  /** 안내 카드 「닫기」. */
  onPushDismiss?(): void;
  /** 교차추천 「열기」(intoss:// 딥링크는 main.ts). */
  onXpromoOpen?(): void;
  /** 교차추천 「닫기」. */
  onXpromoClose?(): void;
}

/**
 * 리워드 제안을 «띄울지 말지»를 셸이 물어보는 창구.
 *
 * ★ 상태를 셸에 «복사»하지 않는다. 복사하면 두 곳(main 의 원장 / 셸의 사본)이
 *   반드시 어긋나고, 그때 어느 쪽이 진실인지 알 수 없다. 셸은 그릴 때마다 «묻는다».
 * ★ 기본 구현은 전부 false 다 - 즉 setRewardHost 를 «안 부르면» 이 화면은
 *   2026-08-30 라이브와 같다. 토스 밖(브라우저·Pages·MS Store)에서 실제로 그렇게 된다.
 */
export interface RewardHost {
  /** 이 스킨이 «점수 또는 광고로» 열려 있는가. */
  isSkinAvailable(id: string): boolean;
  /** 이 잠긴 스킨을 지금 광고로 열 수 있는가(가용·일일 상한 포함). */
  canAdUnlockSkin(id: string): boolean;
  /** 사망 시트에 부활 제안을 띄울 수 있는가(판당 1회·일일 상한 포함). */
  canOfferRevive(): boolean;
  /** 메뉴에 시작 부스트 제안을 띄울 수 있는가. */
  canOfferStartBoost(): boolean;
  /** 다음 판 부스트가 «이미 준비됐는가»(광고를 이미 봤다). */
  isStartBoostArmed(): boolean;
  /** ④B 최고급 스킨 «진행도» 광고를 지금 제안할 수 있는가(가용·일일 상한·달성 여부). */
  canOfferSkinProgress(): boolean;
  /** ④B 진행도 현황. 버튼 아래 「{have}/{need}」에 쓴다. */
  skinProgress(): { have: number; need: number };
  /** 결과 화면 「이번 판 성장 2배」를 지금 제안할 수 있는가(가용·세션 1회·일 3회·이어받기 > 0). 2026-09-10 */
  canOfferResultDouble(): boolean;
  /** 다음 판으로 이어받는 몫(결과 화면 kv 행 + 2배 버튼 부제). base = 광고 없이, mass = 실제 적용값. */
  carryPreview(): { base: number; mass: number; doubled: boolean };
}

const NO_REWARDS: RewardHost = {
  isSkinAvailable: () => false,
  canAdUnlockSkin: () => false,
  canOfferRevive: () => false,
  canOfferStartBoost: () => false,
  isStartBoostArmed: () => false,
  canOfferSkinProgress: () => false,
  skinProgress: () => ({ have: 0, need: 0 }),
  canOfferResultDouble: () => false,
  carryPreview: () => ({ base: 0, mass: 0, doubled: false }),
};

/** 지금 광고를 띄우는 중인 자리(중복 탭 방지 + aria-busy). */
export type RewardBusy = 'revive' | 'boost' | 'skin' | 'grow' | 'double' | null;

/**
 * 인라인 SVG 아이콘 — 글리프·이모지 대신(플랫폼마다 자형이 다르고 스크린리더가 읽는다).
 * 24x24 뷰박스 · 현재 색(currentColor) · 선 두께 2 · aria-hidden. 부모 크기에 맞춰 늘어난다.
 */
function svgIcon(kind: 'bell' | 'close' | 'arrow'): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  const d = kind === 'bell'
    ? 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 20a2 2 0 0 0 4 0'
    : kind === 'close'
      ? 'M6 6l12 12M18 6L6 18'
      : 'M5 12h14M13 6l6 6-6 6';
  p.setAttribute('d', d);
  s.appendChild(p);
  return s;
}

interface RewardBtn {
  root: HTMLButtonElement;
  title: HTMLElement;
  sub: HTMLElement;
}

/**
 * 리워드 제안 버튼.
 * ★ .btn-primary / .btn-ghost 를 «쓰지 않는다» - 기존 검사기(tools/qa_ads.py,
 *   qa_render.py, probe_joystick.py 등)가 그 두 클래스를 「그 화면의 주/부 버튼」으로
 *   잡아 쓴다. 같은 클래스를 하나 더 만들면 선택자가 «다른 버튼»을 집어
 *   검사기가 조용히 엉뚱한 것을 누른다(0건이 부재의 증거가 아닌 것과 같은 함정).
 */
function rewardBtn(): RewardBtn {
  const root = el('button', 'btn-reward hidden') as HTMLButtonElement;
  root.type = 'button';
  const ico = el('span', 'rw-ico');
  ico.setAttribute('aria-hidden', 'true');
  const text = el('span', 'rw-text');
  const title = el('b', 'rw-title');
  const sub = el('i', 'rw-sub');
  text.append(title, sub);
  root.append(ico, text);
  return { root, title, sub };
}

// ★'offer' 는 «없다». 제안 배너는 화면을 «바꾸지 않는다» — 게임 화면 위에
//   5초 얹혔다 사라지는 조각이고, 그동안 게임은 그대로 흐른다(2026-09-01 개정).
type Screen = 'menu' | 'game' | 'pause' | 'death';

// 피드는 «지나가는 소식»이다. 3.4 초 뒤 사라지므로 쌓아 둘 이유가 없고,
// 390px 세로에서 4줄이면 플레이 화면의 위쪽 1/4 을 가린다.
const FEED_MAX = 3;
const HUD_HZ = 8;

/**
 * 이 기기가 «손가락으로 조작하는» 기기인가.
 *
 * ★ 왜 input.isTouch 를 못 쓰는가 (실제 결함이었다):
 *   input.isTouch 는 «첫 터치 이벤트»가 도착해야 true 가 된다. 즉 유저가
 *   화면을 아직 만지지 않은 «첫 화면»에서는 항상 false 다. 그래서 토스
 *   미니앱(모바일 전용)에서 게임을 켠 사람이 조작법에서 「마우스로...」를
 *   읽었다. 마우스가 없는 기기다.
 *
 *   기기의 «능력»은 이벤트를 기다리지 않아도 알 수 있다. pointer: coarse 는
 *   「정밀하지 않은 포인터 = 손가락」이라는 뜻이고 웹뷰에서도 첫 프레임부터
 *   참이다. maxTouchPoints 는 그 미디어쿼리를 모르는 구형 WebView 용 보조다.
 *   => 모바일이 «기본»이고, 마우스판은 예외다.
 */
function coarsePointer(): boolean {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      if (window.matchMedia('(pointer: coarse)').matches) return true;
      // 포인터가 아예 없는 기기(일부 웹뷰가 none 을 보고한다)도 터치로 본다.
      if (window.matchMedia('(pointer: none)').matches) return true;
    }
    if (typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0) return true;
  } catch {
    /* 구형 WebView 는 matchMedia 가 없을 수 있다. 그때는 아래 기본값. */
  }
  return false;
}

/** 「자세히」 패널의 id. aria-controls 가 «두 곳»에서 이 값을 가리킨다(카드·히어로). */
const SKIN_DETAIL_ID = 'skin-ability-detail';

/** 숫자는 자릿점을 찍는다. 1322 보다 1,322 가 한눈에 크기를 읽힌다. */
let numFmt: Intl.NumberFormat | null = null;
function num(n: number): string {
  if (!numFmt) {
    try {
      numFmt = new Intl.NumberFormat();
    } catch {
      return String(n);
    }
  }
  return numFmt.format(n);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/**
 * 「{killer}, {victim} 잡았다」 같은 «번역된 문장»에 이름을 꽂는다.
 *
 * i18n 의 t(key, vars) 는 문자열을 돌려준다 - 그러면 어느 부분이 이름인지
 * 알 수 없어 전부 같은 색으로 칠할 수밖에 없다. 여기서는 토큰 자리를 직접
 * 찾아 «이름만» 별도 노드로 만든다. 그래야 피드가 한 덩어리 회색 문장이
 * 아니라 「누가 / 누구를」로 즉시 스캔된다.
 *
 * ★ 전부 textContent 다. 닉네임은 유저 입력이므로 innerHTML 경로를 만들지 않는다.
 * ★ 값이 없는 토큰은 «그대로 남긴다». 빈 문자열로 지우면 번역 실수를 못 본다
 *   (i18n/index.ts 의 t() 와 같은 규칙).
 */
function fillNames(tpl: string, vars: Record<string, string>): DocumentFragment {
  const frag = document.createDocumentFragment();
  const re = tokenRe();
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tpl)) !== null) {
    if (m.index > last) frag.appendChild(document.createTextNode(tpl.slice(last, m.index)));
    const v = vars[m[1]];
    if (v === undefined) {
      frag.appendChild(document.createTextNode(m[0]));
    } else {
      frag.appendChild(el('b', 'feed-name', v));
      // 조사는 «이름 밖» 이다. 굵게 칠하지 않는다 - 이름의 일부로 읽히면 안 된다.
      if (m[2] !== undefined) frag.appendChild(document.createTextNode(josa(v, m[2])));
    }
    last = m.index + m[0].length;
  }
  if (last < tpl.length) frag.appendChild(document.createTextNode(tpl.slice(last)));
  return frag;
}

interface KvRow {
  root: HTMLElement;
  k: HTMLElement;
  v: HTMLElement;
}

function kvRow(): KvRow {
  const root = el('div', 'kv-row');
  const k = el('span', 'kv-k');
  const v = el('span', 'kv-v');
  root.append(k, v);
  return { root, k, v };
}

export class Shell {
  private cb: ShellCallbacks;
  private save: SaveData;
  private screen: Screen = 'menu';

  // 메뉴
  private menu!: HTMLElement;
  private brandMark!: HTMLElement;
  private brandTitle!: HTMLElement;
  private brandTag!: HTMLElement;
  private nickInput!: HTMLInputElement;
  private playBtn!: HTMLButtonElement;
  private skinHero!: HTMLElement;
  private skinHeroName!: HTMLElement;
  private skinHeroSub!: HTMLElement;
  private skinRail!: HTMLElement;
  private skinBtns: HTMLButtonElement[] = [];
  private statRows: KvRow[] = [];
  private statBlock!: HTMLElement;
  /* ★배너 지면(.ad-slot)은 2026-09-10 에 «제거»했다(콘솔 노출 0회 — Codex 전략 「수리하지 않고 삭제」).
     그 자리(기록 카드 ↔ 설정 카드 사이)에는 이제 «토스 안에서만» 푸시 안내 카드가 선다. */
  /** 오른쪽 열 — 안내 카드를 붙이고 떼는 기준 컨테이너. */
  private colB!: HTMLElement;
  private setBlock!: HTMLElement;
  /* -- 푸시 동의(2026-09-10) — 토스 안에서만 DOM 에 «붙는다». 밖에서는 만들어만 두고 붙이지 않는다(빈 래퍼 0). */
  private nudgeEl!: HTMLElement;
  private nudgeTitle!: HTMLElement;
  private nudgeSub!: HTMLElement;
  private nudgeCta!: HTMLButtonElement;
  private nudgeX!: HTMLButtonElement;
  private pushGroup!: HTMLElement;
  private pushLabel!: HTMLElement;
  private pushBtn!: HTMLButtonElement;
  private pushHint!: HTMLElement;
  private pushState: PushState | null = null;
  private ctrlRow!: HTMLElement;
  private ctrlBtns: Record<ControlMode, HTMLButtonElement> = {} as never;
  private soundBtns: [HTMLButtonElement, HTMLButtonElement] | null = null;
  private langSelect!: HTMLSelectElement;
  private howToBox!: HTMLElement;
  private hintNode: HTMLElement | null = null;
  private hintTimers: number[] = [];
  private rowLabels: { node: HTMLElement; key: 'controls' | 'sound' | 'language' }[] = [];
  private blockLabels: { node: HTMLElement; key: 'skins' | 'howToTitle' }[] = [];

  // HUD
  private hud!: HTMLElement;
  private hudLenVal!: HTMLElement;
  private hudLenLbl!: HTMLElement;
  /** 「길이」 연속 탭 카운터(실기기 진단 줄 토글용). 기본 OFF. */
  private diagTapN = 0;
  private diagTapT0 = 0;
  private liveDiagEl: HTMLElement | null = null;
  private liveDiagTimer = 0;
  private hudRankVal!: HTMLElement;
  private hudRankLbl!: HTMLElement;
  private boardList!: HTMLOListElement;
  private boardRows: { li: HTMLLIElement; i: HTMLElement; u: HTMLElement; s: HTMLElement }[] = [];
  private feed!: HTMLElement;
  /** 킬 피드 + 기록 돌파 배너를 «세로로 잇는» 왼쪽 열. 배너의 y 를 상수로 안 박는 근거다. */
  private hudLeft!: HTMLElement;
  private hudAcc = 0;

  // 일시정지 / 결과
  private pause!: HTMLElement;
  private pauseTitle!: HTMLElement;
  private resumeBtn!: HTMLButtonElement;
  private quitBtn!: HTMLButtonElement;
  private death!: HTMLElement;
  private deathTitle!: HTMLElement;
  private deathCause!: HTMLElement;
  private badges!: HTMLElement;
  private badgeBest!: HTMLElement;
  private badgeUnlock!: HTMLElement;
  private standing!: HTMLElement;
  private resultRows: KvRow[] = [];
  /** 「다음 판 시작 +N」 — 이어받기 행(2026-09-10). 0 이면 숨는다. */
  private carryRow!: KvRow;
  private againBtn!: HTMLButtonElement;
  private menuBtn!: HTMLButtonElement;
  /* -- 머니 리그 교차추천 카드(2026-09-10). 토스 안 + 하루 1회일 때만 보인다. */
  private xpromo!: HTMLElement;
  private xpromoLabel!: HTMLElement;
  private xpromoTitle!: HTMLElement;
  private xpromoSub!: HTMLElement;
  private xpromoOpen!: HTMLButtonElement;
  private xpromoX!: HTMLButtonElement;
  private xpromoOn = false;
  /** 「열기」가 «실패로 확인»됐다(무응답은 아니다 — toss/openUrl.ts 의 3분기). */
  private xpromoFailed = false;
  /** 「열기」를 눌러 브릿지 응답을 기다리는 중(연타 잠금). */
  private xpromoBusy = false;

  // 리워드 광고(2026-08-31)
  private rewards: RewardHost = NO_REWARDS;
  private busy: RewardBusy = null;
  private reviveBtn!: RewardBtn;
  private boostBtn!: RewardBtn;
  private progressBtn!: RewardBtn;
  /** 결과 화면 「이번 판 성장 2배」(2026-09-10). */
  private doubleBtn!: RewardBtn;
  private skinAdBadges: HTMLElement[] = [];
  /** 레일 카드 밑 «종 이름» (2026-09-02 ①). */
  private skinCaps: HTMLElement[] = [];
  /** 히어로의 «특수 기능» 한 줄. 능력이 없는 스킨에서는 통째로 숨는다.
      2026-09-02 ② 부터 «버튼»이다 — 눌러서 자세히를 연다. */
  private skinAbilityEl!: HTMLButtonElement;
  private skinAbilityText!: HTMLElement;
  private skinAbilityMore!: HTMLElement;
  /* ── 「터치해서 본다」 (2026-09-02 ②, President 재지시) ────────────────────
     ★ 여는 «경로»는 둘인데 «패널»은 하나다:
         ⓐ 못 고르는 카드(잠긴 최고급 2종)를 탭 — 원래 «아무 일도 없던» 자리다.
         ⓑ 히어로의 특수 기능 줄을 탭 — 지금 입고 있는 스킨.
       패널을 둘로 나누면 열린 게 둘일 수 있고, 그러면 어느 쪽이 진실인지 모른다.
     ★ abilityOpenFor 는 «스킨 id» 다. 열려 있는지(boolean)만 들면 무엇에 대한
       설명인지를 다른 곳에서 또 계산해야 하고, 그 둘은 반드시 갈린다. */
  private skinInfoDots: HTMLElement[] = [];
  private skinDetail!: HTMLElement;
  private skinDetailName!: HTMLElement;
  private skinDetailAb!: HTMLElement;
  private skinDetailLead!: HTMLElement;
  private skinDetailFair!: HTMLElement;
  private skinDetailX!: HTMLButtonElement;
  private skinDetailRows: KvRow[] = [];
  private abilityOpenFor: string | null = null;
  private toastEl!: HTMLElement;
  private toastTimer = 0;

  // 기록 돌파 제안 배너(2026-09-01 개정). ★.overlay 가 «아니다» — 아래 주석 참조.
  private offer!: HTMLButtonElement;
  private offerTitle!: HTMLElement;
  private offerSub!: HTMLElement;
  private offerBar!: HTMLElement;
  private offerProgress = -1;
  private countEl!: HTMLElement;
  private countNum!: HTMLElement;
  private countLbl!: HTMLElement;

  constructor(root: HTMLElement, save: SaveData, cb: ShellCallbacks) {
    this.save = save;
    this.cb = cb;
    this.buildMenu(root);
    this.buildHud(root);
    this.buildPause(root);
    this.buildDeath(root);
    // ★ root 가 아니라 «킬 피드가 있는 왼쪽 열» 안에 붙인다(2026-09-02 President
    //   「킬로그 밑에 좀더 작게」). buildHud 가 먼저 돌아 this.hudLeft 가 있다.
    this.buildOfferBanner(this.hudLeft);
    this.buildToast(root);
    this.buildCountdown(root);
    this.refreshTexts();
    this.showMenu();
  }

  // ----------------------------------------------------------------------
  // 조립
  // ----------------------------------------------------------------------

  private buildMenu(root: HTMLElement): void {
    const ov = el('div', 'overlay');
    // ★ 2단 배치는 «메뉴에만» 적용된다. panel 만으로 선택자를 쓰면 일시정지/결과
    //   패널까지 2단이 되어 버튼이 한 쪽 열에만 몰린다(라이브 배포본에서 발견).
    const p = el('div', 'panel panel-menu');

    // 브랜드: 마크 + 이름. 마크는 «게임 렌더러 그대로» 그린 코일이다.
    const brand = el('div', 'brand');
    this.brandMark = el('div');
    this.brandMark.className = 'brand-mark';
    const bt = el('div', 'brand-text');
    this.brandTitle = el('h1');
    this.brandTag = el('p');
    bt.append(this.brandTitle, this.brandTag);
    brand.append(this.brandMark, bt);

    this.nickInput = el('input', 'nick');
    this.nickInput.type = 'text';
    this.nickInput.maxLength = 14;
    this.nickInput.value = this.save.nick;
    this.nickInput.autocomplete = 'off';
    this.nickInput.spellcheck = false;
    this.nickInput.addEventListener('keydown', (e) => {
      // 엔터로 바로 시작 - 데스크톱에서 마우스를 다시 잡지 않아도 되게.
      if (e.key === 'Enter') this.playBtn.click();
    });

    this.playBtn = el('button', 'btn btn-primary p-play');
    this.playBtn.type = 'button';
    this.playBtn.addEventListener('click', () => this.cb.onPlay(this.nickInput.value));

    // 「광고 보고 길게 시작」 - 시작 버튼 «바로 아래». 강제가 아니라 «옆에 놓인 선택»이다.
    // ★ 광고를 다 보면 판이 «바로» 시작한다(main.ts). 「받아두고 따로 시작」 2단계를
    //   만들지 않았다 - 단계가 늘면 유저는 받은 걸 잊고 우리는 노출을 잃는다.
    this.boostBtn = rewardBtn();
    this.boostBtn.root.classList.add('p-boost');
    this.boostBtn.root.addEventListener('click', () => {
      if (this.busy) return;
      this.cb.onUi?.();
      this.cb.onStartBoostAd?.();
    });

    // 스킨: 큰 미리보기 + 가로 레일
    const skinBlock = el('div', 'block p-skin');
    const skinLabel = el('div', 'block-label');
    this.blockLabels.push({ node: skinLabel, key: 'skins' });

    this.skinHero = el('div', 'skin-hero');
    const heroMeta = el('div', 'skin-hero-meta');
    this.skinHeroName = el('div', 'skin-hero-name');
    this.skinHeroSub = el('div', 'skin-hero-sub');
    /* ★ 특수 기능 한 줄. 「작게」(President ①) — 능력이 없으면 hidden 이라 자리도 안 먹는다.
       2026-09-02 ②: 이 줄이 «버튼»이 됐다. 문구는 그대로 두고(지시), 뒤에
       「자세히 ›」를 붙여 «눌러서 더 볼 수 있다»를 화면이 스스로 말하게 한다.
       ⛔ 안 보이는 패딩으로 타깃만 키우지 않는다 — 받침(--surface-2)을 줘서
         «보이는 사각형 = 누르는 사각형»으로 만든다(레인 8 규율). */
    this.skinAbilityEl = el('button', 'skin-ability');
    this.skinAbilityEl.type = 'button';
    this.skinAbilityEl.hidden = true;
    this.skinAbilityEl.setAttribute('aria-controls', SKIN_DETAIL_ID);
    this.skinAbilityEl.setAttribute('aria-expanded', 'false');
    this.skinAbilityText = el('span', 'skin-ability-t');
    this.skinAbilityMore = el('span', 'skin-ability-more');
    this.skinAbilityEl.append(this.skinAbilityText, this.skinAbilityMore);
    this.skinAbilityEl.addEventListener('click', () => {
      if (this.busy) return;
      this.cb.onUi?.();
      this.toggleSkinDetail(this.save.skin);
    });
    heroMeta.append(this.skinHeroName, this.skinHeroSub, this.skinAbilityEl);
    this.skinHero.append(heroMeta); // 캔버스는 refreshSkins 가 앞에 꽂는다

    this.skinRail = el('div', 'skin-rail');
    for (const s of SKINS) {
      const b = el('button', 'skin');
      b.type = 'button';
      b.appendChild(makeSkinPreview(s, 144, 96));
      b.appendChild(el('span', 'lock'));
      // 광고 배지. 기본 hidden - 토스 밖에서는 «끝까지 나타나지 않는다».
      const adBadge = el('span', 'skin-ad');
      adBadge.setAttribute('aria-hidden', 'true');
      adBadge.hidden = true;
      b.appendChild(adBadge);
      this.skinAdBadges.push(adBadge);
      /* 「설명이 열린다」 표식. ★.skin-ad 와 «같은 규율»이다 — 이건 누르는 것이
         아니라 신호이고(pointer-events:none), 누르는 사각형은 카드 전체(72x48)다.
         15px 짜리를 따로 누르게 만들면 24px 미만 타깃이 하나 생긴다. */
      const infoDot = el('span', 'skin-info');
      infoDot.setAttribute('aria-hidden', 'true');
      infoDot.hidden = true;
      b.appendChild(infoDot);
      this.skinInfoDots.push(infoDot);
      b.addEventListener('click', () => {
        if (this.busy) return;
        if (isSkinUnlocked(s, this.save.bestScore) || this.rewards.isSkinAvailable(s.id)) {
          this.cb.onUi?.();
          this.cb.onSkin(s.id);
          /* 다른 스킨을 골랐으면 열려 있던 설명은 닫는다 — 히어로가 바뀐 뒤에도
             남아 있으면 「지금 보고 있는 것」과 「설명」이 서로 다른 뱀이 된다. */
          this.abilityOpenFor = null;
          this.refreshSkins();
          return;
        }
        // 잠겼는데 «광고로 열 수 있는» 카드.
        if (this.rewards.canAdUnlockSkin(s.id)) {
          this.cb.onUi?.();
          this.cb.onSkinAdUnlock?.(s.id);
          return;
        }
        /* ★ 여기가 「터치해서 능력 보기」(President 2026-09-02 ②)다.
           고를 수도 없고 광고로 열 수도 없는 카드 = «원래 아무 일도 없던 자리».
           그래서 선택 동작과 «충돌하지 않는다» — 뺏은 탭이 하나도 없다.
           능력이 없는 스킨은 abilityOf 가 null 이라 여기 닿아도 아무 일이 없고,
           애초에 disabled 라 이벤트가 오지도 않는다(refreshSkins 의 infoTap). */
        if (abilityOf(s.id)) {
          this.cb.onUi?.();
          this.toggleSkinDetail(s.id);
        }
      });
      this.skinBtns.push(b);
      /* ★ ① 미보유 스킨의 «이름과 획득 요건»을 카드 밑에 적는다(President 2026-09-02).
         전에는 잠긴 카드에 «숫자만»(예: 26000) 떠 있어서, 유저는 그게 무슨 뱀인지도
         무엇을 하면 열리는지도 몰랐다. 이름이 없으면 목표가 «생기지 않는다».
         ⛔ 카드를 눌러 미리보게 만들지 «않았다» — 잠긴 카드는 disabled 여야 한다
           (「죽은 버튼이 아니라 disabled」 규율 · verify_adunlock W3/W4 가 고정). */
      const cell = el('div', 'skin-cell');
      const cap = el('span', 'skin-cap');
      this.skinCaps.push(cap);
      cell.append(b, cap);
      this.skinRail.appendChild(cell);
    }
    /* ④B 최고급 스킨 «진행도» 광고 — 레일 «바로 아래»(2026-09-02).
       ★자리의 근거: 유저가 100회를 채우러 «찾아올» 곳이어야 한다. 잠긴 최고급
         카드와 그 「0/100」이 바로 위에 보이는 자리가 유일하게 그 조건을 만족한다.
         시작 버튼 옆에 두면 무엇을 위한 광고인지 화면이 스스로 말하지 못한다.
       ★기존 「광고 보고 길게 시작」(p-boost)과 «같은 부품»을 쓴다 — 리워드 제안의
         생김새가 자리마다 다르면 유저가 매번 새로 배워야 한다. */
    this.progressBtn = rewardBtn();
    this.progressBtn.root.classList.add('p-progress');
    this.progressBtn.root.addEventListener('click', () => {
      if (this.busy) return;
      this.cb.onUi?.();
      this.cb.onSkinProgressAd?.();
    });
    /* ── 「자세히」 패널 — 레일 «바로 밑» ────────────────────────────────
       ★ 왜 모달·바텀시트가 아닌가:
         ① 이 UI 는 «움직이는 캔버스 위»다. 전면 시트를 하나 더 띄우면 스크림이
            한 겹 더 깔린다 — styles.css 머리말이 금지한 방향(60fps 절대 조건).
         ② 시트는 포커스 트랩·뒤로가기·바깥탭 닫기를 «전부» 새로 만들어야 하고,
            RN 0.72.6 WebView 에서 그 셋은 전부 함정이 있는 자리다.
         ③ 점진적 공개(progressive disclosure)의 정석은 «누른 자리 옆»에서 펼치는
            것이다. 레일 바로 밑이면 어느 카드에 대한 설명인지 화면이 스스로 말한다.
       ★ 진행도 버튼 «위»에 둔다 — 파란말레이산호뱀 설명을 읽은 «직후»에
         「광고 보고 진행도 쌓기」가 눈에 들어와야 그 버튼이 뜻을 갖는다. */
    this.skinDetail = el('div', 'skin-detail');
    this.skinDetail.id = SKIN_DETAIL_ID;
    this.skinDetail.hidden = true;
    const dHead = el('div', 'skin-detail-head');
    const dNames = el('div', 'skin-detail-names');
    this.skinDetailName = el('div', 'skin-detail-name');
    this.skinDetailAb = el('div', 'skin-detail-ab');
    dNames.append(this.skinDetailName, this.skinDetailAb);
    this.skinDetailX = el('button', 'skin-detail-x');
    this.skinDetailX.type = 'button';
    this.skinDetailX.addEventListener('click', () => {
      this.cb.onUi?.();
      this.abilityOpenFor = null;
      this.refreshSkins();
    });
    dHead.append(dNames, this.skinDetailX);
    this.skinDetailLead = el('p', 'skin-detail-lead');
    const dRows = el('dl', 'skin-detail-rows');
    for (let i = 0; i < 3; i++) {
      const row = el('div', 'skin-detail-row');
      const k = el('dt', 'skin-detail-k');
      const v = el('dd', 'skin-detail-v');
      row.append(k, v);
      dRows.appendChild(row);
      this.skinDetailRows.push({ root: row, k, v });
    }
    /* ★ 「무엇을 «안» 바꾸는가」를 같이 적는다. 이 능력은 수확 속도지 전투력이
       아니고(skinAbility.ts 머리말), 최고급 스킨이라 유저는 당연히 «더 세지나»를
       먼저 생각한다. 안 적으면 우리가 팔지 않은 것을 유저가 산다. */
    this.skinDetailFair = el('p', 'skin-detail-fair');
    this.skinDetail.append(dHead, this.skinDetailLead, dRows, this.skinDetailFair);

    skinBlock.append(skinLabel, this.skinHero, this.skinRail, this.skinDetail,
      this.progressBtn.root);

    // 기록: 라벨-값 행
    const statBlock = el('div', 'block p-stats');
    const statKv = el('div', 'kv');
    for (let i = 0; i < 4; i++) {
      const r = kvRow();
      statKv.appendChild(r.root);
      this.statRows.push(r);
    }
    statBlock.appendChild(statKv);
    this.statBlock = statBlock;

    /* ── 푸시 알림 안내 카드(2026-09-10 레인 A) — 기록 카드와 설정 카드 «사이» ─────────────
       ★배너(.ad-slot)가 있던 자리다. 배너는 콘솔 노출 0회로 제거됐고(Codex 전략), 그 빈 자리에
         «토스 안에서만» 이 카드가 선다. 붙이고 떼는 판단은 refreshPush() 가 상태로 한다 —
         토스 밖·동의 뒤·거부 뒤·닫은 뒤에는 DOM 에 «존재하지 않는다»(빈 래퍼 0).
       ★한 번만 만들고 append/remove 만 한다(재생성 0). 카드는 .block 의 리듬(색·반경·테)을 그대로 쓴다.
       ★닫기는 44x44 — qa_ui 의 터치 타깃 규칙(44 미만 FAIL). CTA 도 min-height 44. */
    this.nudgeEl = el('div', 'block nudge p-nudge');
    this.nudgeEl.setAttribute('role', 'group');
    /* ★아이콘 칩을 «두지 않는다»(2026-09-10 실측 판단). 카드 한 줄에 글·「받기」·닫기가 함께 서야 하는데,
       375px 에서 36px 칩 + 간격 12 를 빼면 글 폭이 143px 이라 부제가 3줄로 접혀 카드가 95px 을 넘는다.
       제목이 이미 「매일 충전 알림 받기」라 그림이 없어도 뜻이 선다 — 공간을 글에 준다. */
    const nText = el('div', 'nudge-text');
    this.nudgeTitle = el('b', 'nudge-title');
    this.nudgeTitle.id = 'push-nudge-title';
    this.nudgeSub = el('span', 'nudge-sub');
    nText.append(this.nudgeTitle, this.nudgeSub);
    this.nudgeEl.setAttribute('aria-labelledby', this.nudgeTitle.id);
    this.nudgeCta = el('button', 'nudge-cta');
    this.nudgeCta.type = 'button';
    this.nudgeCta.addEventListener('click', () => {
      if (this.pushState?.busy) return;
      this.cb.onUi?.();
      this.cb.onPushEnable?.();
    });
    this.nudgeX = el('button', 'icon-x nudge-x');
    this.nudgeX.type = 'button';
    this.nudgeX.appendChild(svgIcon('close'));
    this.nudgeX.addEventListener('click', () => {
      this.cb.onUi?.();
      this.cb.onPushDismiss?.();
    });
    this.nudgeEl.append(nText, this.nudgeCta, this.nudgeX);

    // 설정
    const setBlock = el('div', 'block p-set');
    setBlock.append(this.makeControlRow(), this.makeSoundRow(), this.makeLangRow());
    this.setBlock = setBlock;
    /* 「알림」 행 + 힌트 — 토스 안에서만 setBlock 에 «붙는다»(refreshPush). 한 그룹으로 감싸
       .row:last-child 규칙(마지막 행 밑줄 없음)이 그룹 안에서 그대로 성립하게 한다. */
    this.pushGroup = el('div', 'push-group');
    const pushRow = el('div', 'row push-row');
    this.pushLabel = el('div', 'row-label');
    this.pushBtn = el('button', 'push-btn');
    this.pushBtn.type = 'button';
    this.pushBtn.addEventListener('click', () => {
      if (this.pushState?.busy) return;
      this.cb.onUi?.();
      this.cb.onPushEnable?.();
    });
    pushRow.append(this.pushLabel, this.pushBtn);
    this.pushHint = el('p', 'hint-line');
    this.pushGroup.append(pushRow, this.pushHint);

    // 조작법
    const howBlock = el('div', 'block p-how');
    const howLabel = el('div', 'block-label');
    this.blockLabels.push({ node: howLabel, key: 'howToTitle' });
    this.howToBox = el('ul', 'howto');
    howBlock.append(howLabel, this.howToBox);

    // ★ 두 «열»로 감싼다. 넓은 화면에서 grid 셀에 개별 배치하면 행 높이가
    //   서로를 끌어당겨 빈 틈이 생긴다(실렌더에서 이름칸-시작버튼 사이에 떴다).
    //   열 자체를 flex 스택으로 두면 각 열이 «독립적으로» 쌓여 틈이 안 생긴다.
    //   좁은 화면에서는 두 열이 그대로 세로로 이어져 지금 순서를 유지한다.
    const colA = el('div', 'col col-a');
    colA.append(this.nickInput, this.playBtn, this.boostBtn.root, skinBlock);
    const colB = el('div', 'col col-b');
    // 기록 → (토스 안: 푸시 안내 카드, refreshPush 가 setBlock 앞에 꽂는다) → 설정 → 조작법
    colB.append(statBlock, setBlock, howBlock);
    this.colB = colB;
    p.append(brand, colA, colB);
    ov.appendChild(p);
    root.appendChild(ov);
    this.menu = ov;
  }

  private makeControlRow(): HTMLElement {
    const row = el('div', 'row');
    const lbl = el('div', 'row-label');
    this.rowLabels.push({ node: lbl, key: 'controls' });
    const seg = el('div', 'seg');
    for (const m of ['joystick', 'drag'] as ControlMode[]) {
      const b = el('button');
      b.type = 'button';
      b.addEventListener('click', () => {
        this.cb.onUi?.();
        this.cb.onControl(m);
        this.refreshSettings();
      });
      this.ctrlBtns[m] = b;
      seg.appendChild(b);
    }
    row.append(lbl, seg);
    this.ctrlRow = row;
    return row;
  }

  private makeSoundRow(): HTMLElement {
    const row = el('div', 'row');
    const lbl = el('div', 'row-label');
    this.rowLabels.push({ node: lbl, key: 'sound' });
    const seg = el('div', 'seg');
    const on = el('button');
    const off = el('button');
    on.type = 'button';
    off.type = 'button';
    on.addEventListener('click', () => {
      this.cb.onSound(true);
      this.cb.onUi?.();
      this.refreshSettings();
    });
    off.addEventListener('click', () => {
      this.cb.onSound(false);
      this.refreshSettings();
    });
    seg.append(on, off);
    this.soundBtns = [on, off];
    row.append(lbl, seg);
    return row;
  }

  private makeLangRow(): HTMLElement {
    const row = el('div', 'row');
    const lbl = el('div', 'row-label');
    this.rowLabels.push({ node: lbl, key: 'language' });
    const sel = el('select', 'lang-select');
    for (const l of SUPPORTED_LOCALES) {
      const o = el('option');
      o.value = l;
      o.textContent = LOCALE_LABELS[l];
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => this.cb.onLocale(sel.value as Locale));
    this.langSelect = sel;
    row.append(lbl, sel);
    return row;
  }

  private buildHud(root: HTMLElement): void {
    const hud = el('div', 'hidden');
    hud.id = 'hud';

    // 라벨-값을 «한 줄»로. 값 아래 작은 대문자 라벨을 다는 형식을 피한다.
    const score = el('div', 'hud-score');
    const lenBox = el('div');
    this.hudLenLbl = el('span');
    this.hudLenVal = el('b', undefined, '0');
    lenBox.append(this.hudLenLbl, this.hudLenVal);
    /**
     * ════════════════════════════════════════════════════════════════════
     * ★ 실기기 진단 줄 토글 — 「길이」를 1.5초 안에 5번 탭.
     *
     *   왜 이런 «숨은 제스처»인가: 토스 미니앱에서는 유저가 URL 에 ?diag=1 을
     *   붙일 방법이 없다. 그런데 2026-09-07 실사고처럼 「아이폰에서만 조종이
     *   안 된다」가 나오면, 우리가 헤드리스로 아무리 돌려도 못 잡는다
     *   (실측: WebKit 데스크톱에서 재현 실패 — iOS 스크롤뷰가 없다).
     *   ⇒ President 스크린샷 «한 장»이면 원인이 확정되게 만든다.
     *
     *   ⛔ 기본 OFF. 꺼져 있으면 비용은 «탭 카운터 하나»가 전부다.
     *   ⛔ 화면을 가리지 않게 하단 한 줄, pointer-events:none.
     * ════════════════════════════════════════════════════════════════════
     */
    lenBox.style.pointerEvents = 'auto';
    /**
     * ⛔ `data-ui` 가 «반드시» 있어야 한다. 이게 없으면 input.ts 의 창 캡처
     *   pointerdown 이 이 탭을 「캔버스 밖에서 시작한 조종」으로 잡아, 「길이」를
     *   누를 때마다 스틱이 화면 좌상단에 생긴다(실측으로 잡은 회귀다).
     *   HUD 안에서 pointer-events 를 여는 요소는 전부 이 표시를 달아야 한다.
     */
    lenBox.setAttribute('data-ui', '1');
    lenBox.addEventListener('click', () => {
      const now = Date.now();
      if (now - this.diagTapT0 > 1500) {
        this.diagTapT0 = now;
        this.diagTapN = 0;
      }
      this.diagTapN++;
      if (this.diagTapN >= 5) {
        this.diagTapN = 0;
        this.diagTapT0 = 0;
        this.toggleLiveDiag();
      }
    });
    const rankBox = el('div');
    this.hudRankLbl = el('span');
    this.hudRankVal = el('b', undefined, '-');
    rankBox.append(this.hudRankLbl, this.hudRankVal);
    score.append(lenBox, rankBox);

    // 순위표: 제목을 «두지 않는다». 번호 + 이름 + 점수면 무엇인지 자명하고,
    // 항상 떠 있는 요소라 한 줄이라도 시야를 덜 먹는 쪽이 옳다.
    // 대신 스크린리더용 이름은 aria-label 로 준다.
    const board = el('div', 'hud-board');
    board.setAttribute('role', 'group');
    this.boardList = el('ol');
    for (let i = 0; i < 10; i++) {
      const li = el('li');
      const idx = el('i', undefined, String(i + 1));
      const nm = el('u');
      const sc = el('s');
      li.append(idx, nm, sc);
      this.boardList.appendChild(li);
      this.boardRows.push({ li, i: idx, u: nm, s: sc });
    }
    board.appendChild(this.boardList);
    this.boardEl = board;

    this.feed = el('div', 'hud-feed');

    // ★ 왼쪽 열 = 킬 피드 «다음»에 기록 돌파 배너. 배너의 y 를 상수로 «안 박는다» —
    //   피드가 몇 줄로 접히든(독일어·러시아어는 접힌다) 흐름이 배너를 그만큼
    //   아래로 밀어 준다. 상수를 박으면 로케일 하나만 길어져도 겹친다.
    //   ⇒ 「킬로그와 겹치지 않는다」가 검사로 지키는 «약속»이 아니라 «구조»가 된다.
    this.hudLeft = el('div', 'hud-left');
    this.hudLeft.appendChild(this.feed);

    const pauseBtn = el('button', 'hud-pause');
    pauseBtn.type = 'button';
    pauseBtn.setAttribute('aria-label', 'Pause');
    pauseBtn.addEventListener('click', () => {
      this.cb.onUi?.();
      this.cb.onPauseToggle();
    });

    hud.append(score, board, this.hudLeft, pauseBtn);
    root.appendChild(hud);
    this.hud = hud;
  }

  private boardEl!: HTMLElement;

  /**
   * 실기기 진단 줄을 켜고 끈다. 「길이」 5연타로만 도달한다(위 참고).
   *
   * ★ 내용은 «입력 경로 한 줄»이다. 이 줄 하나로 갈리는 것:
   *     el.pd=0 · win.pd>0  → 캔버스가 pointerdown 을 «못 받는다»(가림·캡처)
   *     pc>0                → 네이티브가 제스처를 가져갔다(팬 차단 실패)
   *     shadow=1            → 포인터가 끊겨 터치 폴백으로 조향 중
   *     steerId=-1 · aim=null → 조종이 시작조차 못 했다
   * ★ requestAnimationFrame 을 쓰지 않는다 — 게임 루프와 GPU 를 나눠 쓰는
   *   자리라 200ms 간격 갱신으로 충분하고 프레임 예산을 안 건드린다.
   */
  private toggleLiveDiag(): void {
    if (this.liveDiagEl) {
      clearInterval(this.liveDiagTimer);
      this.liveDiagTimer = 0;
      this.liveDiagEl.remove();
      this.liveDiagEl = null;
      // ★ 끌 때 «반드시» 알린다 — main 이 renderer.profile 을 도로 끈다.
      //   안 끄면 진단을 껐는데 측정 비용만 남는다(가장 나쁜 상태다).
      this.cb.onDiagToggle?.(false);
      return;
    }
    const box = el('div', 'live-diag');
    document.body.appendChild(box);
    this.liveDiagEl = box;
    this.cb.onDiagToggle?.(true);
    /**
     * ★ 갱신 주기: 200ms(= 60fps 에서 12프레임에 1번). 지시는 「4프레임에 1번」
     *   이었는데, 이 줄은 rAF 가 아니라 setInterval 로 돈다 — 게임 루프 «밖»이라
     *   프레임 예산을 직접 먹지 않고, 사람이 스크린샷으로 읽는 용도라 12프레임에
     *   한 번이면 충분하다. 더 자주 갱신하면 그 자체가 측정 대상을 흔든다.
     */
    const paint = (): void => {
      const d = INPUT_DIAG;
      let s =
        'el.pd ' + d.elPd + ' | win.pd ' + d.winPd + ' | pm ' + d.steerUpdates
        + ' | pc ' + d.pCancel + ' | wts ' + d.winTs + ' | wtm ' + d.winTm
        + '\n' + (d.lastTarget || '-')
        + ' | id ' + d.steerId + ' | ' + (d.shadow ? 'shadow' : 'ptr')
        + ' | d ' + Math.round(d.dist)
        + ' | aim ' + (d.aim === null ? 'null' : d.aim.toFixed(2));
      const p = this.cb.diagPerf?.();
      if (p) {
        const n1 = (v: number): string => v.toFixed(1);
        s += '\nfps ' + Math.round(p.fps) + ' | f p95 ' + n1(p.fp95)
          + ' | sim ' + n1(p.sim) + ' | rend ' + n1(p.rend)
          + ' | post ' + n1(p.post) + ' | body ' + n1(p.body)
          + '\ntier ' + p.tier + ' | giants ' + p.giants
          + ' | dpr ' + p.dpr.toFixed(2) + ' | ' + p.cw + 'x' + p.ch
          + ' | webgl ' + (p.webgl ? 'ok' : 'fail')
          // ★ 강등 «순간»을 3초 남긴다 — 거버너가 언제 붙었는지가 이 줄의 핵심이다.
          // ★2026-09-10: 화살표(U+2193)를 'dn' 으로 바꿨다. 이 줄은 기본 OFF 인 진단 오버레이지만
          //   «문자열은 번들에 그대로 실린다» — 제출 전 검사(실코드 글리프)가 잡아 업로드를 막았다.
          //   뜻은 그대로다(강등 = degrade down).
          + (p.lastDown ? '  dnT' + p.lastDown[0] + ' @' + p.lastDown[1].toFixed(1) + 's' : '');
      }
      box.textContent = s;
    };
    paint();
    this.liveDiagTimer = window.setInterval(paint, 200);
  }

  private buildPause(root: HTMLElement): void {
    const ov = el('div', 'overlay hidden');
    const p = el('div', 'panel');
    // ★ 인라인 style 로 색을 덮어쓰던 것을 클래스로 되돌렸다.
    //   같은 h1 이 화면에 따라 다른 색을 가지는 것은 «상태»이지 «예외»가 아니다.
    this.pauseTitle = el('h1', 'result-title is-neutral');
    this.resumeBtn = el('button', 'btn btn-primary');
    this.resumeBtn.type = 'button';
    this.resumeBtn.addEventListener('click', () => {
      this.cb.onUi?.();
      this.cb.onResume();
    });
    this.quitBtn = el('button', 'btn btn-ghost');
    this.quitBtn.type = 'button';
    this.quitBtn.addEventListener('click', () => {
      this.cb.onUi?.();
      this.cb.onQuit();
    });
    p.append(this.pauseTitle, this.resumeBtn, this.quitBtn);
    ov.appendChild(p);
    root.appendChild(ov);
    this.pause = ov;
  }

  private buildDeath(root: HTMLElement): void {
    const ov = el('div', 'overlay hidden');
    const p = el('div', 'panel');

    const head = el('div');
    this.deathTitle = el('h1', 'result-title');
    this.deathCause = el('p', 'result-cause');
    head.append(this.deathTitle, this.deathCause);

    this.badges = el('div', 'badges hidden');
    this.badgeBest = el('div', 'badge hidden');
    this.badgeUnlock = el('div', 'badge-unlock hidden');
    this.badges.append(this.badgeBest, this.badgeUnlock);

    // 최종 순위 스트립: 상위 3줄 + 내 줄. 「몇 위」가 숫자가 아니라 «자리»로 읽힌다.
    const standBlock = el('div', 'block');
    this.standing = el('div', 'standing');
    standBlock.appendChild(this.standing);

    // 기록: 라벨-값 행(큰 숫자 격자가 아니다).
    // ★ 세 줄이다. 「순위」를 뺐다 - 바로 위 스트립이 순위를 «자리»로 이미
    //   보여준다. 같은 값을 숫자로 또 적으면 읽을 것만 늘고 정보는 그대로다.
    const statBlock = el('div', 'block');
    const kv = el('div', 'kv');
    for (let i = 0; i < 3; i++) {
      const r = kvRow();
      kv.appendChild(r.root);
      this.resultRows.push(r);
    }
    /* ★「다음 판 시작 +N」(2026-09-10 레인 A) — 기록 행의 «넷째 줄». 이어받기가 0 이면 숨는다.
       이 줄이 바로 아래 「이번 판 성장 2배」 버튼의 «근거»다 — 무엇이 2배가 되는지 화면이 스스로 말한다. */
    this.carryRow = kvRow();
    this.carryRow.root.classList.add('kv-carry', 'hidden');
    kv.appendChild(this.carryRow.root);
    statBlock.appendChild(kv);

    /* 「광고 보고 이번 판 성장 2배」 — 기록 블록 «바로 아래», 부활 «위».
       ★부활과 같은 부품(rewardBtn)이다 — 리워드 제안의 생김새가 자리마다 다르면 매번 새로 배운다.
       ★.btn-primary 를 빼앗지 않는다. 광고를 안 보는 것이 여전히 기본 경로다(이어받기 기본 몫은 그대로 받는다). */
    this.doubleBtn = rewardBtn();
    this.doubleBtn.root.classList.add('p-double');
    this.doubleBtn.root.addEventListener('click', () => {
      if (this.busy) return;
      this.cb.onUi?.();
      this.cb.onResultDoubleAd?.();
    });

    const row = el('div', 'btn-row');
    this.againBtn = el('button', 'btn btn-primary');
    this.againBtn.type = 'button';
    this.againBtn.addEventListener('click', () => this.cb.onPlay(this.nickInput.value));
    this.menuBtn = el('button', 'btn btn-ghost');
    this.menuBtn.type = 'button';
    this.menuBtn.addEventListener('click', () => {
      this.cb.onUi?.();
      this.cb.onQuit();
    });
    row.append(this.againBtn, this.menuBtn);

    // 「광고 보고 부활」 - 「다시 하기」 «위»에 둔다. 이미 잃은 판을 되살리는
    // 제안이라 다시 하기보다 먼저 읽혀야 뜻이 산다. 그래도 .btn-primary 를
    // 빼앗지는 않는다 - 광고를 «안» 보는 것이 여전히 기본 경로다.
    this.reviveBtn = rewardBtn();
    this.reviveBtn.root.classList.add('p-revive');
    this.reviveBtn.root.addEventListener('click', () => {
      if (this.busy) return;
      this.cb.onUi?.();
      this.cb.onReviveAd?.();
    });

    /* ── 「머니 리그」 교차추천 카드(2026-09-10 레인 A · 2주 실험) — 다시 하기 행 «아래» ──────
       ★광고처럼 보이지 않게: 리워드 판(앰버 테)이 아니라 기록 블록과 «같은» .block 이고,
         제목 옆에 「추천」 태그가 붙는다. 제목 «위»에 라벨을 두지 않는다(eyebrow 금지).
       ★열기·닫기 둘 다 44px 이상(qa_ui 규칙). 토스 안 + 하루 1회일 때만 setXpromo(true) 로 보인다. */
    this.xpromo = el('div', 'block xpromo p-xpromo hidden');
    this.xpromo.setAttribute('role', 'group');
    const xText = el('div', 'xpromo-text');
    const xHead = el('div', 'xpromo-head');
    this.xpromoTitle = el('b', 'xpromo-title');
    this.xpromoTitle.id = 'xpromo-title';
    this.xpromoLabel = el('span', 'xpromo-tag');
    xHead.append(this.xpromoTitle, this.xpromoLabel);
    this.xpromoSub = el('span', 'xpromo-sub');
    xText.append(xHead, this.xpromoSub);
    this.xpromo.setAttribute('aria-labelledby', this.xpromoTitle.id);
    this.xpromoOpen = el('button', 'xpromo-open');
    this.xpromoOpen.type = 'button';
    const xOpenLbl = el('span', 'xpromo-open-t');
    const xArrow = el('span', 'xpromo-open-i');
    xArrow.setAttribute('aria-hidden', 'true');
    xArrow.appendChild(svgIcon('arrow'));
    this.xpromoOpen.append(xOpenLbl, xArrow);
    this.xpromoOpen.addEventListener('click', () => {
      if (this.xpromoBusy) return; // 연타 잠금 — 브릿지 호출이 두 번 나가지 않는다
      this.cb.onUi?.();
      this.cb.onXpromoOpen?.();
    });
    this.xpromoX = el('button', 'icon-x xpromo-x');
    this.xpromoX.type = 'button';
    this.xpromoX.appendChild(svgIcon('close'));
    this.xpromoX.addEventListener('click', () => {
      this.cb.onUi?.();
      this.setXpromo(false);
      this.cb.onXpromoClose?.();
    });
    this.xpromo.append(xText, this.xpromoOpen, this.xpromoX);

    /* ★순서: 부활 «먼저», 2배 «그 아래»(2026-09-10 · 실렌더를 보고 정했다).
       ① 부활은 「이 판을 이어간다」라 결과 화면에서 먼저 읽혀야 뜻이 산다(-15 규율 그대로).
       ② ★「한 화면 한 번」 규율과 «맞물린다» — 부활을 먼저 고르면 이번 판의 2배 기회가 사라지지 않는다
          (부활 → 판 계속 → 최종 사망 화면에서 2배가 다시 뜬다). 순서가 곧 유저 이득이고 노출 총량도 크다.
          반대로 2배를 먼저 고르면 그 화면의 부활은 접힌다 — 그건 유저의 선택이다. */
    p.append(head, this.badges, standBlock, statBlock, this.reviveBtn.root, this.doubleBtn.root, row, this.xpromo);
    ov.appendChild(p);
    root.appendChild(ov);
    this.death = ov;
  }

  /* ----------------------------------------------------------------------
   * 토스 전용 조각(2026-09-10) — 푸시 동의 행·안내 카드 / 교차추천
   * -------------------------------------------------------------------- */

  /**
   * 푸시 동의 상태를 반영한다. main.ts 가 상태 스토어 구독으로 부른다.
   * ★토스 밖(`available` false)이면 행·카드를 DOM 에서 «떼어» 둔다 — 빈 래퍼도 남기지 않는다.
   * ★행은 항상(토스 안) 있고, 카드는 nudge(미동의·미거부·안 닫음·기록 읽은 뒤)일 때만 있다.
   */
  refreshPush(st: PushState): void {
    this.pushState = st;
    const s = tt();
    // 행
    if (st.available) {
      if (!this.pushGroup.isConnected) this.setBlock.appendChild(this.pushGroup);
      this.pushLabel.textContent = s.pushLabel;
      const txt = st.busy ? s.pushBusy : st.enabled ? s.pushOn
        : st.availability === 'rejected' ? s.pushRetry : s.pushGet;
      if (this.pushBtn.textContent !== txt) this.pushBtn.textContent = txt;
      this.pushBtn.disabled = st.busy;
      this.pushBtn.setAttribute('aria-busy', st.busy ? 'true' : 'false');
      this.pushBtn.classList.toggle('is-on', st.enabled);
      this.pushHint.textContent = st.error ? s.pushError : s.pushHint;
      this.pushHint.classList.toggle('is-error', !!st.error);
    } else if (this.pushGroup.isConnected) {
      this.pushGroup.remove();
    }
    // 카드
    if (st.available && st.nudge) {
      if (!this.nudgeEl.isConnected) this.colB.insertBefore(this.nudgeEl, this.setBlock);
      this.nudgeTitle.textContent = s.pushNudgeTitle;
      this.nudgeSub.textContent = s.pushNudgeSub;
      this.nudgeCta.textContent = st.busy ? s.pushBusy : s.pushNudgeCta;
      this.nudgeCta.disabled = st.busy;
      this.nudgeCta.setAttribute('aria-busy', st.busy ? 'true' : 'false');
      this.nudgeX.setAttribute('aria-label', s.close);
    } else if (this.nudgeEl.isConnected) {
      this.nudgeEl.remove();
    }
  }

  /** 교차추천 카드를 보이거나 감춘다. 보일지 말지(토스 안·하루 1회)는 main.ts 가 정한다. */
  setXpromo(on: boolean): void {
    this.xpromoOn = on;
    if (on) {
      // 새로 뜨는 카드는 «깨끗한» 상태로 — 지난 판의 실패 문구를 물려받지 않는다.
      this.xpromoFailed = false;
      this.xpromoBusy = false;
      this.renderXpromo();
    }
    this.xpromo.classList.toggle('hidden', !on);
  }

  /**
   * 「열기」 결과 반영(2026-09-10 · 땅따먹기 -28 규율).
   * @param failed «실패로 확인»된 경우에만 true. ⛔무응답('unknown')에는 false 를 준다 —
   *   앱이 실제로 열려서 WebView 가 멈춘 것일 수 있어, 실패 문구를 띄우면 거짓말이 된다.
   */
  setXpromoOpen(busy: boolean, failed = this.xpromoFailed): void {
    this.xpromoBusy = busy;
    this.xpromoFailed = failed;
    this.renderXpromo();
  }

  private renderXpromo(): void {
    const s = tt();
    this.xpromoTitle.textContent = s.xpromoTitle;
    this.xpromoLabel.textContent = s.xpromoLabel;
    this.xpromoSub.textContent = this.xpromoFailed ? s.xpromoFail : s.xpromoSub;
    this.xpromoSub.classList.toggle('is-error', this.xpromoFailed);
    (this.xpromoOpen.firstElementChild as HTMLElement).textContent = s.xpromoOpen;
    this.xpromoOpen.disabled = this.xpromoBusy;
    this.xpromoOpen.setAttribute('aria-busy', this.xpromoBusy ? 'true' : 'false');
    this.xpromoX.setAttribute('aria-label', s.close);
  }

  /** 검사기용 — 카드가 지금 보이는가. */
  get xpromoShown(): boolean {
    return this.xpromoOn && !this.xpromo.classList.contains('hidden');
  }

  /** 검사기용 — 카드가 지금 «실패 문구»를 보이는가. */
  get xpromoFailedShown(): boolean {
    return this.xpromoFailed && this.xpromoSub.classList.contains('is-error');
  }


  /**
   * 기록 돌파 제안 판 (2026-08-31, 레인 5).
   *
   * ══ ⛔ .overlay 가 «아니다» (2026-09-01 개정) ═════════════════════════
   *  두 가지 이유가 있다.
   *   1) 막으면 안 된다. President 판정: 제안이 게임을 방해하면 안 된다.
   *      .overlay 는 화면 전체를 덮는 판이라 정의상 방해다.
   *   2) 인덱스 규약. 검사기 여러 개가 오버레이를 «인덱스»로 집는다
   *      (tools/qa_ads.py 61행: 0=메뉴 / 1=일시정지 / 2=결과). 판을 하나 더
   *      끼우면 검사기가 «다른 버튼»을 누르고도 초록불이 뜬다.
   *      ⇒ 배너는 .overlay 를 아예 «안 쓴다». 인덱스는 0·1·2 그대로다.
   *
   * ══ 방해하지 않기 위한 규칙 (전부 여기서 지킨다) ═══════════════════════
   *  · 위치: HUD 스크림(상단 150px) «바로 아래». 위쪽은 점수·일시정지·피드·
   *    순위표가 이미 쓰고, 화면 «중앙»은 내 뱀이 있는 자리다. 아래쪽 절반은
   *    조종하는 엄지가 사는 자리다(조이스틱은 «처음 닿은 곳»에 생긴다 —
   *    고정 구역이 없으므로 아래쪽은 통째로 피한다).
   *  · 크기: 한 손 탭 크기(48px 이상, WCAG 2.2 AA 의 24px 을 크게 넘긴다)를
   *    지키되 그 이상 키우지 않는다. 화면의 3% 미만을 5초만 쓴다.
   *  · 통과: 배너 «바깥»은 아무것도 없다. 요소 자체가 버튼 하나라서 그 사각형
   *    밖의 터치는 처음부터 게임으로 간다.
   *
   * ══ 버튼 클래스 ═══════════════════════════════════════════════════════
   *  ⛔.btn-primary 를 쓰지 않는다. tools/qa_render.py·qa_ui.py·qa_touch.py 등이
   *    `page.click("button.btn-primary")` 로 «문서 첫 번째»를 집어 메뉴 시작
   *    버튼을 누른다. ⛔.btn-ghost 도 쓰지 않는다(qa_ads.py 가 오버레이 1·2
   *    안에서 그 클래스를 집는다).
   */
  /**
   * 기록 돌파 제안 배너.
   * @param host ★#hud 안의 «왼쪽 열»(.hud-left)이다. 예전엔 셸 root 에 position:fixed
   *   로 띄우고 top 을 상수(sat+210px)로 박았는데, President 가 실기기에서 그것을
   *   「시야 방해」로 판정했다(2026-09-02). 지금은 킬 피드의 «다음 형제»라 자리가
   *   흐름에서 나온다 — 겹칠 상수 자체가 없다.
   *   ⚠#hud 는 pointer-events:none 이다. 배너만 auto 로 되돌린다(styles.css).
   */
  private buildOfferBanner(root: HTMLElement): void {
    const b = el('button', 'rw-offer p-grow hidden') as HTMLButtonElement;
    b.type = 'button';
    // 게임이 흐르는 중에 «생겼다 사라지는» 알림이다 — 스크린리더에도 그렇게 알린다.
    b.setAttribute('aria-live', 'polite');

    const ico = el('span', 'rw-offer-ico');
    ico.setAttribute('aria-hidden', 'true');
    const text = el('span', 'rw-offer-text');
    this.offerTitle = el('b', 'rw-offer-title');
    this.offerSub = el('i', 'rw-offer-sub');
    text.append(this.offerTitle, this.offerSub);

    // 남은 시간 막대. ★transform(scaleX)만 바꾼다 — 레이아웃·페인트를 유발하는
    //   width 애니메이션은 게임 루프와 GPU 를 나눠 쓰는 자리에서 쓰지 않는다.
    this.offerBar = el('span', 'rw-offer-bar');
    this.offerBar.setAttribute('aria-hidden', 'true');

    b.append(ico, text, this.offerBar);
    b.addEventListener('click', () => {
      if (this.busy) return;
      this.cb.onUi?.();
      this.cb.onGrowthAd?.();
    });
    root.appendChild(b);
    this.offer = b;
  }

  /**
   * 복귀 카운트다운. ★.overlay 가 «아니다» — 인덱스를 늘리면 안 되기 때문이고,
   * 화면을 막아서도 안 되기 때문이다(멈춘 아레나를 보면서 다음 수를 정해야 한다).
   * 그래서 pointer-events:none 인 숫자 한 장만 얹는다.
   */
  private buildCountdown(root: HTMLElement): void {
    const n = el('div', 'rw-count');
    n.setAttribute('role', 'status');
    n.setAttribute('aria-live', 'polite');
    this.countNum = el('b', 'rw-count-n');
    this.countLbl = el('span', 'rw-count-l');
    n.append(this.countNum, this.countLbl);
    root.appendChild(n);
    this.countEl = n;
  }

  /**
   * 제안 배너를 띄운다. ★셸은 그리기만 한다 — 5초를 «세는» 것은 main.ts 다
   *  (프레임 dt 로 세야 백그라운드에서 부당하게 소모되지 않는다).
   *
   * ⛔HUD 를 «감추지 않는다». 옛 모달은 감췄지만 지금은 게임이 흐르는 중이라
   *   점수·순위·피드가 사라지는 것 자체가 방해다.
   * ⛔숫자로 「지금 → 광고 뒤」를 약속하지 «않는다». 배너가 떠 있는 5초 동안
   *   질량이 계속 변하기 때문이다(먹으면 늘고 질주하면 준다). 고정된 숫자를
   *   써 두면 탭하는 순간 그 숫자는 이미 «거짓»이다. 보상 기준은 «광고 직전»
   *   질량이므로(President 2026-09-01), 실제 결과는 지급 토스트가 말한다.
   *
   * @param kind 무엇이 걸렸나(문턱 / 개인 최고 기록)
   * @param value 문턱값 또는 «깬 옛 기록»
   * @param progress 남은 시간 비율(1 = 막 떴다)
   */
  showOfferBanner(kind: GrowthTriggerKind, value: number, progress: number): void {
    const g = gt();
    this.offerTitle.textContent =
      kind === 'threshold' ? fmt(g.thresholdTitle, { n: num(value) }) : g.bestTitle;
    this.refreshOfferBtn();
    this.offerProgress = -1;
    this.setOfferProgress(progress);
    this.offer.classList.remove('hidden');
  }

  /**
   * 남은 시간 막대를 세운다. main.ts 가 프레임 루프에서 부른다.
   * ★ 값이 «눈에 보일 만큼» 바뀔 때만 쓴다. 매 프레임 스타일을 쓰면 60fps 를
   *   나눠 쓰는 자리에서 공짜가 아니다(2% 단위 = 5초에 50번).
   */
  setOfferProgress(f: number): void {
    const v = Math.max(0, Math.min(1, f));
    if (this.offerProgress >= 0 && Math.abs(v - this.offerProgress) < 0.02) return;
    this.offerProgress = v;
    this.offerBar.style.transform = `scaleX(${v})`;
  }

  /** 제안 배너를 내린다(카운트다운은 건드리지 않는다 — 그건 따로 켠다). */
  hideOffer(): void {
    this.offer.classList.add('hidden');
  }

  private refreshOfferBtn(): void {
    const g = gt();
    const busyNow = this.busy === 'grow';
    // 광고를 부르는 중에는 «그 사실»을 말한다. 이때 월드는 이미 멈춰 있다.
    this.offerSub.textContent = busyNow ? rt().loading : fmt(g.cta, { k: growthLabel() });
    this.offer.disabled = busyNow;
    this.offer.setAttribute('aria-busy', busyNow ? 'true' : 'false');
  }

  /**
   * 복귀 카운트다운 숫자를 세운다. main.ts 가 «프레임 루프»에서 부른다.
   * ★ setTimeout 이 아니라 rAF 로 세는 이유: 앱이 백그라운드로 가면 rAF 가 멈춘다.
   *   setTimeout 으로 세면 화면이 안 보이는 사이에 게임이 재개돼 그대로 죽는다.
   * @param n 남은 초(1 이상의 정수). 0 이하면 감춘다.
   */
  showCountdown(n: number): void {
    if (n <= 0) {
      this.hideCountdown();
      return;
    }
    const txt = String(n);
    // ★ 매 프레임 대입하지 않는다 — 값이 바뀔 때만. 안 그러면 aria-live 가
    //   초당 60번 읽고, 애니메이션도 매 프레임 재시작된다.
    if (this.countNum.textContent !== txt) {
      this.countNum.textContent = txt;
      this.countLbl.textContent = gt().resume;
      this.countEl.classList.remove('tick');
      void this.countEl.offsetWidth; // 애니메이션 재시작(초당 1회)
      this.countEl.classList.add('tick');
    }
    this.countEl.classList.add('show');
  }

  hideCountdown(): void {
    this.countEl.classList.remove('show', 'tick');
    this.countNum.textContent = '';
    this.countLbl.textContent = '';
  }

  /**
   * 토스트. 리워드 결과(해금·실패 사유)를 알리는 «유일한» 통로다.
   *
   * ★ 왜 필요한가: 리워드 광고는 실패 경로가 많은데(미시청·로드실패·상한),
   *   아무 말도 안 하면 유저는 「광고를 봤는데 아무 일도 안 일어났다」로 읽는다.
   *   네온 스레드 -23 의 사고가 «정확히» 그 모양이었다(실패 토스트가 없었다).
   * ★ 게임 루프를 막지 않는다 - pointer-events:none, 2.6초 뒤 스스로 사라진다.
   * ★ backdrop-filter 를 쓰지 않는다(불투명 표면 + 그림자만). 60fps 절대 조건.
   */
  private buildToast(root: HTMLElement): void {
    const n = el('div', 'rw-toast');
    n.setAttribute('role', 'status');
    n.setAttribute('aria-live', 'polite');
    root.appendChild(n);
    this.toastEl = n;
  }

  /**
   * @param low «HUD 가 떠 있는 동안» 띄우는 토스트인가.
   *
   * ★ 왜 위치가 두 개인가(실렌더에서 발견한 결함):
   *   기존 리워드 3종은 전부 메뉴·사망 시트에서 뜬다 — 그때 HUD 는 감춰져 있어
   *   화면 «위쪽»이 비어 있다. 그런데 기록 돌파는 «판이 진행 중»에 뜨고,
   *   복귀 카운트다운 동안 HUD 가 다시 보인다. 그 상태로 위쪽에 띄웠더니
   *   토스트가 「길이/순위」와 순위표 1~3위를 통째로 덮었다(실렌더 확인).
   *   ⇒ 그 경우에만 아래로 내린다. 높이는 .hud-hint 와 같은 «엄지 호 위» 대역이라
   *     조이스틱과도 겹치지 않는다.
   */
  showToast(msg: string, ms = 2600, low = false): void {
    const n = this.toastEl;
    n.textContent = msg;
    n.classList.toggle('low', low);
    n.classList.add('show');
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => n.classList.remove('show'), ms);
  }

  /** main.ts 가 부팅 시 한 번 꽂는다. 안 꽂으면 리워드 UI 는 «전부 안 뜬다». */
  setRewardHost(h: RewardHost): void {
    this.rewards = h;
    this.refreshReward();
    this.refreshSkins();
  }

  /**
   * 광고를 띄우는 중임을 표시한다(중복 탭 방지 + aria-busy).
   * ★ 스킨 카드까지 «전부» 잠근다 - 전면 광고가 뜬 사이 다른 카드를 눌러
   *   두 번째 광고를 요청하면 브릿지 상태가 엉킨다(rewardAd.ts inFlight 와 이중 방어).
   */
  setRewardBusy(b: RewardBusy): void {
    this.busy = b;
    /* ★★ 화면을 «옮기는» 버튼도 함께 잠근다(2026-09-10 Codex 적대적 리뷰 지적 2).
       리워드 광고를 부르는 중에 「다시 하기·메뉴·시작」을 누르면 전면형이 먼저 뜨고 그 위에
       리워드가 겹쳐 «광고 2편»이 된다(실측: show 2건). main.ts 도 rewardAdInFlight() 로 막지만,
       버튼이 «눌리는 것처럼 보이는데 아무 일도 안 나는» 상태를 만들지 않으려고 여기서 잠근다. */
    const lock = b !== null;
    this.againBtn.disabled = lock;
    this.menuBtn.disabled = lock;
    this.playBtn.disabled = lock;
    this.refreshReward();
    this.refreshSkins();
    this.refreshOfferBtn();
  }

  /** 리워드 제안 버튼 2종의 «가시성과 문구»를 지금 상태로 다시 맞춘다. */
  refreshReward(): void {
    const s = rt();

    // 시작 부스트(메뉴)
    const armed = this.rewards.isStartBoostArmed();
    const boostOffer = armed || this.rewards.canOfferStartBoost();
    this.boostBtn.root.classList.toggle('hidden', !boostOffer);
    this.boostBtn.root.classList.toggle('is-ready', armed);
    if (boostOffer) {
      const busyNow = this.busy === 'boost';
      this.boostBtn.title.textContent = busyNow ? s.loading : armed ? s.boostReady : s.boostCta;
      this.boostBtn.sub.textContent = fmt(s.boostSub, { k: startBoostLabel() });
      // armed = 이미 받았다. 한 번 더 눌러도 얻을 게 없으므로 «상태 칩»이 된다.
      this.boostBtn.root.disabled = armed || busyNow;
      this.boostBtn.root.setAttribute('aria-busy', busyNow ? 'true' : 'false');
    }

    /* ④B 최고급 스킨 진행도(메뉴 · 스킨 블록).
       ★안 될 때는 «통째로 숨는다». 「오늘 다 봤어요」 같은 죽은 버튼을 남기지 않는다 —
         부스트·부활과 같은 규율이고, 이유도 같다(shell.ts refreshSkins 주석). */
    const progOffer = this.rewards.canOfferSkinProgress();
    this.progressBtn.root.classList.toggle('hidden', !progOffer);
    if (progOffer) {
      const busyNow = this.busy === 'skin';
      const pg = this.rewards.skinProgress();
      const sk = st();
      this.progressBtn.title.textContent = busyNow ? s.loading : sk.progressCta;
      this.progressBtn.sub.textContent = sfmt(sk.progressSub, {
        have: num(pg.have), need: num(pg.need),
      });
      this.progressBtn.root.disabled = busyNow;
      this.progressBtn.root.setAttribute('aria-busy', busyNow ? 'true' : 'false');
    }

    // 부활(사망 시트)
    const reviveOffer = this.rewards.canOfferRevive();
    this.reviveBtn.root.classList.toggle('hidden', !reviveOffer);
    if (reviveOffer) {
      const busyNow = this.busy === 'revive';
      this.reviveBtn.title.textContent = busyNow ? s.loading : s.reviveCta;
      this.reviveBtn.sub.textContent = s.reviveSub;
      this.reviveBtn.root.disabled = busyNow;
      this.reviveBtn.root.setAttribute('aria-busy', busyNow ? 'true' : 'false');
    }

    /* 이어받기 행 + 「이번 판 성장 2배」(결과 화면, 2026-09-10).
       ★행은 «값이 있을 때만». 0 을 「+0」으로 보여 주는 것은 정보가 아니라 잡음이다.
       ★버튼은 canOfferResultDouble 이 답한다(가용·세션 1회·일 3회·기본 몫 > 0·아직 2배 아님). */
    const cp = this.rewards.carryPreview();
    const rs = rst();
    this.carryRow.root.classList.toggle('hidden', cp.mass <= 0);
    if (cp.mass > 0) {
      this.carryRow.k.textContent = rs.carryLabel;
      this.carryRow.v.textContent = '+' + num(cp.mass);
      // 2배를 받은 값은 «신호»색 — 신기록 줄(.is-best)과 같은 규칙(내가 얻은 것).
      this.carryRow.v.classList.toggle('is-best', cp.doubled);
    }
    const doubleOffer = this.rewards.canOfferResultDouble();
    this.doubleBtn.root.classList.toggle('hidden', !doubleOffer);
    if (doubleOffer) {
      const busyNow = this.busy === 'double';
      this.doubleBtn.title.textContent = busyNow ? s.loading : rs.doubleCta;
      this.doubleBtn.sub.textContent = fmt(rs.doubleSub, { n: num(cp.base), m: num(cp.base * 2) });
      this.doubleBtn.root.disabled = busyNow;
      this.doubleBtn.root.setAttribute('aria-busy', busyNow ? 'true' : 'false');
    }
  }

  // ----------------------------------------------------------------------
  // 텍스트(로케일 변경 시 전량 갱신)
  // ----------------------------------------------------------------------

  refreshTexts(): void {
    const ko = getLocale() === 'ko';
    this.brandTitle.textContent = ko ? BRAND_KO : BRAND_EN;
    this.brandTag.textContent = t('tagline');
    this.nickInput.placeholder = t('nickPlaceholder');
    this.nickInput.setAttribute('aria-label', t('nickPlaceholder'));
    this.playBtn.textContent = t('play');

    for (const b of this.blockLabels) b.node.textContent = t(b.key);
    for (const r of this.rowLabels) r.node.textContent = t(r.key);

    this.ctrlBtns.joystick.textContent = t('controlJoystick');
    this.ctrlBtns.drag.textContent = t('controlDrag');
    if (this.soundBtns) {
      this.soundBtns[0].textContent = t('on');
      this.soundBtns[1].textContent = t('off');
    }
    this.langSelect.value = getLocale();

    const statKeys = ['statsBest', 'statsBestRank', 'statsGames', 'statsKills'] as const;
    for (let i = 0; i < 4; i++) this.statRows[i].k.textContent = t(statKeys[i]);

    this.hudLenLbl.textContent = t('hudLength');
    this.hudRankLbl.textContent = t('hudRank');
    this.boardEl.setAttribute('aria-label', t('leaderboard'));

    this.pauseTitle.textContent = t('paused');
    this.resumeBtn.textContent = t('resume');
    this.quitBtn.textContent = t('quit');

    this.deathTitle.textContent = t('died');
    this.badgeBest.textContent = t('newBest');
    this.againBtn.textContent = t('playAgain');
    this.menuBtn.textContent = t('toMenu');
    const resKeys = ['finalScore', 'finalKills', 'statsBest'] as const;
    for (let i = 0; i < 3; i++) this.resultRows[i].k.textContent = t(resKeys[i]);

    this.refreshHowTo();
    this.refreshStats();
    this.refreshSkins();
    this.refreshSettings();
    this.refreshReward();
    // 제안 판이 «떠 있는 채로» 언어를 바꿀 수는 없지만(그동안 게임이 멈춰 있고
    // 설정은 메뉴에만 있다), 다음에 뜰 때를 위해 지금 맞춰 둔다.
    this.refreshOfferBtn();
    // 토스 전용 조각도 같은 로케일을 따른다(있을 때만 다시 그린다 — 실패·대기 상태는 «유지»한다).
    if (this.pushState) this.refreshPush(this.pushState);
    if (this.xpromoOn) this.renderXpromo();
  }

  /**
   * 조작 안내는 «입력 장치»에 따라 문구가 달라진다.
   * ★ 기본값이 «터치»다. 주 타깃이 토스 미니앱(모바일 세로)이고, 데스크톱은
   *   예외다. 반대로 두면 모바일 유저가 첫 화면에서 마우스 안내를 읽는다.
   */
  private readonly coarse = coarsePointer();
  private touchHint = this.coarse;

  /**
   * @param isTouch input 이 «실제 터치 이벤트»를 본 적이 있는가.
   *   ★ 단방향이다 - 터치 기기라고 한 번 판정되면 되돌리지 않는다.
   *     손가락과 마우스를 함께 쓰는 기기(터치 노트북)에서 문구가 왔다 갔다
   *     하면 그게 더 이상하다. 마우스 문구는 «터치를 못 하는 기기»에만 준다.
   */
  setTouchHint(isTouch: boolean): void {
    const next = isTouch || this.coarse;
    if (this.touchHint === next) return;
    this.touchHint = next;
    this.refreshHowTo();
    this.refreshSettings();
  }

  /**
   * 조작법 — ★ 「다섯 줄짜리 회색 목록」에서 «2단 위계»로 바꿨다.
   *
   *   처음 켠 사람이 3초 안에 알아야 하는 건 다섯 가지가 아니라 «두 가지»다:
   *     「손가락을 어떻게 하면 되나」 「빨리 가려면 뭘 하나」.
   *   나머지 셋은 규칙이고, 한 판만 해 보면 저절로 알게 된다.
   *   그래서 앞 두 줄은 본문 색·굵기로 «먼저 읽히게» 하고, 뒤 셋은 그 아래
   *   가는 선 밑에 조용히 둔다. 화면을 하나 더 끼우지 않고 위계만 준다
   *   (튜토리얼 화면을 만들지 않는 이유는 showControlHint 주석 참조).
   */
  private refreshHowTo(): void {
    const doKeys: (keyof import('../i18n').Messages)[] = [
      this.touchHint ? 'howToSteerTouch' : 'howToSteerMouse',
      'howToBoost',
    ];
    const ruleKeys: (keyof import('../i18n').Messages)[] = [
      'howToEat',
      'howToKill',
      'howToBorder',
    ];
    this.howToBox.textContent = '';
    for (const k of doKeys) this.howToBox.appendChild(el('li', 'is-do', t(k)));
    for (let i = 0; i < ruleKeys.length; i++) {
      const cls = i === 0 ? 'is-rule is-rule-first' : 'is-rule';
      this.howToBox.appendChild(el('li', cls, t(ruleKeys[i])));
    }
  }

  refreshStats(): void {
    const s = this.save;
    // ★ 한 판도 안 한 사람에게 「0 / - / 0 / 0」 네 줄은 «정보가 아니라 잡음»이다.
    //   빈 상태를 굳이 채워 보여주는 건 화면을 길게 만들 뿐이고, 모바일에서는
    //   그만큼 시작 버튼이 위로 밀린다. 기록이 생긴 다음부터 나타나게 한다.
    this.statBlock.classList.toggle('hidden', s.games === 0);
    const vals = [
      num(s.bestScore),
      s.bestRank >= 999 ? '-' : '#' + s.bestRank,
      num(s.games),
      num(s.totalKills),
    ];
    for (let i = 0; i < 4; i++) this.statRows[i].v.textContent = vals[i];
  }

  refreshSkins(): void {
    const rs = rt();
    const sk = st();
    for (let i = 0; i < SKINS.length; i++) {
      const s = SKINS[i];
      const b = this.skinBtns[i];
      // ★ 「점수로 열렸는가」와 「지금 고를 수 있는가」는 «다른 질문»이다.
      //   전자는 진행도(사망 시트의 새 스킨 배지 근거), 후자는 UI 가용성이다.
      //   둘을 한 변수로 합치면 광고 해금 스킨이 「새로 달성한 스킨」으로 축하된다.
      const available = isSkinUnlocked(s, this.save.bestScore) || this.rewards.isSkinAvailable(s.id);
      /* ★ canAdUnlockSkin 이 false 인 «세 가지 이유»가 여기서 «같은 화면»으로 접힌다:
       *   ⓐ 광고 자격 밖(화이트리스트 밖 — 블랙맘바 등, 2026-09-01)
       *   ⓑ 오늘 상한(3종)을 다 썼다
       *   ⓒ 토스 밖이라 리워드 광고 자체를 못 쓴다
       *   셋 다 결론이 같다 — 「지금 이 카드는 «점수로만» 열린다」. 그래서 배지가
       *   사라지고 disabled 가 되고 잠금 칸에 «필요 점수»가 남는다(아래 lock).
       *   ⛔ 자격 밖에만 다른 버튼·다른 문구를 다는 «친절»을 넣지 마라. 눌러도
       *     아무 일이 없는 버튼이 되거나(canAdUnlockSkin 이 여전히 false다),
       *     ⓑ·ⓒ 와 다르게 보여 「내일이면 열리나?」를 오히려 헷갈리게 만든다. */
      const adOffer = !available && !this.busy && this.rewards.canAdUnlockSkin(s.id);
      /* ★ 「이 카드를 누르면 설명이 열리는가」. 순서가 «마지막»인 것이 중요하다 —
         고를 수 있으면 고르고, 광고로 열 수 있으면 열고, «그 둘 다 아닐 때만»
         설명이다. 즉 이 경로는 기존 동작에서 탭을 하나도 «뺏지 않는다».
         능력이 없으면(abilityOf null = 기존 스킨 전부, 또는 스위치 OFF)
         false 라 카드는 예전 그대로 disabled 다. */
      const ab = abilityOf(s.id);
      const infoTap = !available && !adOffer && ab !== null;
      if (infoTap) {
        /* 이 카드는 «고르는 버튼»이 아니라 «펼치는 버튼»이다. 두 역할을 한
           요소에 겹쳐 말하면 스크린리더가 「눌림 상태」를 먼저 읽어 오해를 만든다. */
        b.removeAttribute('aria-pressed');
        b.setAttribute('aria-controls', SKIN_DETAIL_ID);
        b.setAttribute('aria-expanded', this.abilityOpenFor === s.id ? 'true' : 'false');
      } else {
        b.setAttribute('aria-pressed', this.save.skin === s.id ? 'true' : 'false');
        b.removeAttribute('aria-controls');
        b.removeAttribute('aria-expanded');
      }
      b.disabled = !available && !adOffer && !infoTap;
      b.classList.toggle('is-ad', adOffer);
      b.classList.toggle('is-info', infoTap);
      /* ★ 잠금 칸의 «숫자»는 요건에 따라 달라진다. 예전에는 unlockScore 를 그대로
         찍었는데, 점수로 열 수 없는 스킨(광고 누적 전용)에서는 그게 «Infinity» 로
         나온다. 요건은 skins/skinUnlock.ts «한 곳»이 답한다. */
      const req = skinRequirement(s, this.save.bestScore);
      const reqShort = req.kind === 'ads'
        ? sfmt(sk.reqAds, { have: num(req.have), need: num(req.need) })
        : req.kind === 'score' ? sfmt(sk.reqScore, { n: num(req.need) }) : '';
      /* ★ 카드 «안»의 잠금 칸은 그대로 «숫자»다. 바꾸지 않았다 —
         verify_adunlock W3-lock 이 「블랙맘바 카드는 필요 점수를 보여준다」를
         '12,000' 으로 «고정»하고 있고, 그 규율은 이 레인의 관심사가 아니다.
         새로 더한 것은 카드 «밑»의 이름 한 줄뿐이다(아래 .skin-cap).
         ⇒ 광고 누적 전용 스킨만 숫자가 「진행도」로 바뀐다. 그쪽은 unlockScore 가
           Infinity 라 예전 코드로는 «Infinity» 가 찍혔다. */
      const lock = b.querySelector('.lock') as HTMLElement | null;
      if (lock) {
        lock.textContent = available ? ''
          : req.kind === 'ads' ? num(req.have) + '/' + num(req.need)
            : num(s.unlockScore);
      }
      const badge = this.skinAdBadges[i];
      if (badge) badge.hidden = !adOffer;
      /* 표식은 «탭이 실제로 설명을 여는 카드»에만 뜬다. 열지 않는 카드에 붙이면
         그 표식이 거짓말이 된다(보유한 최고급 스킨은 탭이 «선택»이다 — 그쪽 경로는
         히어로의 특수 기능 줄이다). */
      const dot = this.skinInfoDots[i];
      if (dot) dot.hidden = !infoTap;
      const nm = skinName(s, getLocale());

      /* ── 카드 밑 «이름» ────────────────────────────────────────────────
         이게 ① 의 핵심이다. 전에는 잠긴 카드에 숫자만 있어서 「무슨 뱀인지」를
         알 수 없었다 — 목표가 이름 없이 숫자로만 있으면 목표가 안 된다.
         요건(숫자)은 카드 안에 이미 있으므로 여기서 «되풀이하지 않는다». */
      const cap = this.skinCaps[i];
      if (cap) {
        cap.textContent = nm;
        cap.classList.toggle('is-locked', !available);
      }

      // ── 특수 기능이 있는 스킨은 카드에 표식 (ab 는 위에서 이미 물었다) ──
      b.classList.toggle('is-premium', ab !== null);

      /* aria 는 «화면에 흩어진 것을 한 문장으로» 모은다. 스크린리더 사용자는
         카드 밑 두 줄을 따로 만나지 않는다 — 여기 다 실어야 정보가 같아진다.
         탭이 설명을 여는 카드에는 「자세히」까지 붙여야 «무엇을 할 수 있는지»가
         화면과 같아진다. */
      const abTail = ab
        ? ' - ' + sk.abilityLabel + ': ' + abilityName(ab) + ', ' + abilityDesc(ab)
          + (infoTap ? ' - ' + sk.abMore : '')
        : '';
      b.setAttribute(
        'aria-label',
        (available ? nm
          : adOffer ? nm + ' - ' + rs.skinAdCta
            : nm + ' - ' + (reqShort || t('skinLocked', { n: num(s.unlockScore) }))) + abTail,
      );
    }

    const cur = skinById(this.save.skin);
    const unlocked = isSkinUnlocked(cur, this.save.bestScore) || this.rewards.isSkinAvailable(cur.id);
    this.skinHeroName.textContent = skinName(cur, getLocale());
    if (!unlocked) {
      this.skinHeroSub.textContent = t('skinLocked', { n: num(cur.unlockScore) });
    } else {
      // ★ 「보유 중」만 쓰면 이 줄이 «아무 정보도 없는 줄»이 된다.
      //   다음에 열릴 종과 필요 점수를 보여주면 그 자리가 «목표»가 된다.
      // ★ 예전에는 「밀크스네이크 · 600점 달성」이라고만 적었다. 바로 위에
      //   지금 고른 스킨 이름이 있어서 이 줄이 «그 스킨의 설명»으로 읽혔다
      //   (실렌더에서 「옥수수뱀 / 밀크스네이크 · 600점 달성」으로 보였다).
      //   무엇에 대한 줄인지 문장이 스스로 말하게 한다.
      const next = nextLockedSkin(this.save.bestScore);
      this.skinHeroSub.textContent = next
        ? t('skinNext', { name: skinName(next, getLocale()), n: num(next.unlockScore) })
        : t('skinUnlocked');
    }

    /* ★ 특수 기능 한 줄 — 「작게」(President 2026-09-02 ①).
       능력이 없는 스킨에서는 hidden 이라 «자리도 안 먹는다». 빈 줄을 남겨
       레이아웃을 예약해 두면 12종 중 10종에서 그 자리가 «구멍»으로 보인다. */
    const curAb = abilityOf(cur.id);
    if (curAb) {
      this.skinAbilityEl.hidden = false;
      // ★ 기존 한 줄은 «그대로» 둔다(President ②: 터치는 «더 자세히»의 경로다).
      this.skinAbilityText.textContent =
        sk.abilityLabel + ' · ' + abilityName(curAb) + ' — ' + abilityDesc(curAb);
      this.skinAbilityMore.textContent = sk.abMore;
      this.skinAbilityEl.setAttribute(
        'aria-expanded', this.abilityOpenFor === cur.id ? 'true' : 'false');
      this.skinAbilityEl.setAttribute(
        'aria-label', sfmt(sk.abInfoAria, { name: skinName(cur, getLocale()) }));
    } else {
      this.skinAbilityEl.hidden = true;
      this.skinAbilityText.textContent = '';
      this.skinAbilityMore.textContent = '';
      this.skinAbilityEl.setAttribute('aria-expanded', 'false');
    }

    this.renderSkinDetail();

    // 큰 미리보기 교체. 캔버스를 매번 새로 만들되 하나뿐이라 비용이 없다.
    const old = this.skinHero.querySelector('canvas');
    if (old) old.remove();
    this.skinHero.insertBefore(makeSkinPreview(cur, 224, 152), this.skinHero.firstChild);

    // 브랜드 마크도 «지금 고른 스킨»으로 그린다. 타이틀과 플레이가 이어진다.
    this.brandMark.textContent = '';
    // 워드마크 옆 마크는 «무대 없이»(투명) — 제목 옆에 남색 상자가 하나 더 서면 워드마크가 무거워진다.
    this.brandMark.appendChild(makeSkinPreview(cur, 168, 116, false));
  }

  /**
   * 「자세히」를 연다/닫는다. 같은 스킨을 다시 누르면 닫힌다(같은 버튼 = 같은 토글).
   * ★ 여기서 «그리지» 않는다. 상태만 바꾸고 refreshSkins 가 그린다 —
   *   그리는 곳이 둘이면 둘이 어긋나고, 그때 화면과 aria 가 갈린다.
   */
  private toggleSkinDetail(id: string): void {
    this.abilityOpenFor = this.abilityOpenFor === id ? null : id;
    this.refreshSkins();
    if (this.abilityOpenFor) {
      try {
        // 'nearest' = «필요할 때만» 스크롤한다. 이미 보이면 화면이 안 튄다.
        this.skinDetail.scrollIntoView({ block: 'nearest' });
      } catch {
        /* 구형 WebView 는 옵션 객체를 모른다. 안 스크롤될 뿐 기능은 그대로다. */
      }
    }
  }

  /**
   * 패널 내용. ★수치를 «여기서 만들지 않는다» — abilityFactsOf() 가 코드 상수
   *   (HEAT_SENSE_K / VENOM_K / VENOM_S / MAGNET_RADIUS_K)에서 유도한 값을 준다.
   *   그래서 상수를 고치면 화면 숫자가 «같은 커밋에서» 따라 바뀐다.
   * ★SKIN_ABILITIES_ENABLED=false 면 abilityFactsOf 가 null 이라 패널이 «못 열린다».
   *   열려 있던 것도 여기서 닫힌다 — 「게임엔 없는데 설명은 남은」 상태가 안 생긴다.
   */
  private renderSkinDetail(): void {
    const id = this.abilityOpenFor;
    const facts = id ? abilityFactsOf(id) : null;
    const ab = id ? abilityOf(id) : null;
    if (!id || !facts || !ab) {
      this.abilityOpenFor = null;
      this.skinDetail.hidden = true;
      return;
    }
    const sk = st();
    const d = abilityDetail(facts);
    const skin = skinById(id);
    const loc = getLocale();
    const owned = isSkinUnlocked(skin, this.save.bestScore) || this.rewards.isSkinAvailable(id);
    const req = skinRequirement(skin, this.save.bestScore);

    this.skinDetailName.textContent = skinName(skin, loc);
    this.skinDetailAb.textContent = sk.abilityLabel + ' · ' + abilityName(ab);
    this.skinDetailLead.textContent = abilityDesc(ab);
    this.skinDetailX.setAttribute('aria-label', d.close);

    const vals: [string, string][] = [
      [d.effectLabel, d.effect],
      [d.whenLabel, d.when],
      [d.getLabel, owned ? sk.owned
        : req.kind === 'ads' ? sfmt(sk.reqAds, { have: num(req.have), need: num(req.need) })
          : req.kind === 'score' ? sfmt(sk.reqScore, { n: num(req.need) })
            : sk.owned],
    ];
    for (let i = 0; i < this.skinDetailRows.length; i++) {
      this.skinDetailRows[i].k.textContent = vals[i][0];
      this.skinDetailRows[i].v.textContent = vals[i][1];
    }
    this.skinDetailFair.textContent = d.fair;
    this.skinDetail.hidden = false;
  }

  refreshSettings(): void {
    this.ctrlBtns.joystick.setAttribute(
      'aria-pressed', this.save.control === 'joystick' ? 'true' : 'false');
    this.ctrlBtns.drag.setAttribute(
      'aria-pressed', this.save.control === 'drag' ? 'true' : 'false');
    if (this.soundBtns) {
      this.soundBtns[0].setAttribute('aria-pressed', this.save.sound ? 'true' : 'false');
      this.soundBtns[1].setAttribute('aria-pressed', this.save.sound ? 'false' : 'true');
    }
    this.langSelect.value = getLocale();
    // 조작 방식 설정은 «터치 기기에서만» 의미가 있다. 마우스 사용자에겐 숨긴다.
    this.ctrlRow.classList.toggle('hidden', !this.touchHint);
  }

  // ----------------------------------------------------------------------
  // 화면 전환
  // ----------------------------------------------------------------------

  showMenu(): void {
    this.screen = 'menu';
    this.menu.classList.remove('hidden');
    this.hud.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.death.classList.add('hidden');
    this.offer.classList.add('hidden');
    this.hideCountdown();
    this.refreshStats();
    this.refreshSkins();
    this.refreshReward();
  }

  showGame(): void {
    this.screen = 'game';
    this.lastLen = -1;
    this.lastRank = -1;
    this.menu.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.pause.classList.add('hidden');
    this.death.classList.add('hidden');
    this.offer.classList.add('hidden');
    this.feed.textContent = '';
    this.clearHint();
  }

  showPause(): void {
    this.screen = 'pause';
    this.offer.classList.add('hidden');
    this.hideCountdown();
    // ★ HUD 를 «같이» 감춘다.
    //   전에는 안 감췄다. 그 결과 일시정지 패널 뒤로 순위표·킬 피드·조작
    //   안내가 그대로 떠 있었고, 안내 말풍선은 패널에 «반쯤 잘린 채» 걸쳤다
    //   (390x652 실렌더에서 「르면 질주 - 길이가 줄어든다」로 보였다).
    //   사망 화면은 이미 HUD 를 감춘다 - 두 화면이 다르게 행동할 이유가 없다.
    this.hud.classList.add('hidden');
    this.pause.classList.remove('hidden');
  }

  hidePause(): void {
    this.screen = 'game';
    this.pause.classList.add('hidden');
    this.hud.classList.remove('hidden');
  }

  showDeath(info: DeathInfo, isBest: boolean, unlockedSkin: Skin | null): void {
    this.screen = 'death';
    this.hud.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.offer.classList.add('hidden');
    this.hideCountdown();

    let cause: string;
    if (info.cause === 'border') cause = t('diedBorder');
    else if (info.cause === 'headon') cause = t('diedHeadOn', { name: info.killerName ?? '?' });
    else cause = t('diedBy', { name: info.killerName ?? '?' });
    this.deathCause.textContent = cause;

    // 최종 순위 스트립
    this.standing.textContent = '';
    let prevRank = 0;
    for (const r of info.standing) {
      if (prevRank && r.rank > prevRank + 1) {
        this.standing.appendChild(el('div', 'standing-gap'));
      }
      prevRank = r.rank;
      const row = el('div', 'standing-row' + (r.isPlayer ? ' me' : ''));
      row.append(
        el('i', undefined, String(r.rank)),
        el('u', undefined, r.name),
        el('s', undefined, num(r.score)),
      );
      this.standing.appendChild(row);
    }

    const vals = [num(info.score), num(info.kills), num(this.save.bestScore)];
    for (let i = 0; i < 3; i++) this.resultRows[i].v.textContent = vals[i];
    // 최고 기록 줄만 강조한다(이번 판에 갱신했으면 그게 곧 이번 점수다).
    this.resultRows[2].v.classList.toggle('is-best', isBest);

    this.badgeBest.classList.toggle('hidden', !isBest);
    if (unlockedSkin) {
      this.badgeUnlock.textContent = t('skinNewUnlock', { name: skinName(unlockedSkin, getLocale()) });
      this.badgeUnlock.classList.remove('hidden');
    } else {
      this.badgeUnlock.classList.add('hidden');
    }
    this.badges.classList.toggle('hidden', !isBest && !unlockedSkin);

    this.refreshStats();
    this.refreshSkins();
    this.refreshReward();
    this.death.classList.remove('hidden');
  }

  get current(): Screen {
    return this.screen;
  }

  // ----------------------------------------------------------------------
  // HUD 갱신
  // ----------------------------------------------------------------------

  private lastLen = -1;

  private hudLenText = '';

  private hudRankText = '';
  private lastRank = -1;

  /**
   * 점수·순위 «펀치». 값이 한 번에 크게 뛰거나(킬·큰 먹이) 순위가 오르면 숫자가 1.18배로 튀었다가 돌아온다.
   * 작은 먹이마다 튀면 «계속 떨리는 숫자»가 되므로 문턱(+6)을 둔다.
   */
  punch(): void {
    const v = this.hudLenVal;
    v.classList.remove('is-punch');
    void v.offsetWidth; // 애니메이션 재시작(리플로우 1회, 8Hz 이하)
    v.classList.add('is-punch');
  }

  updateHud(dt: number, length: number, rank: number, rows: LeaderRow[]): void {
    this.hudAcc += dt;
    if (this.hudAcc < 1 / HUD_HZ) return;
    this.hudAcc = 0;

    if (this.lastLen >= 0 && length - this.lastLen >= 6) this.punch();
    this.lastLen = length;
    // ★ 텍스트 노드는 «값이 바뀔 때만» 쓴다 — 매 틱 textContent 대입은 같은 값이어도 레이아웃을 건드린다.
    const lenText = num(length);
    if (lenText !== this.hudLenText) { this.hudLenVal.textContent = lenText; this.hudLenText = lenText; }
    const rankText = '#' + rank;
    if (rankText !== this.hudRankText) { this.hudRankVal.textContent = rankText; this.hudRankText = rankText; }
    if (this.lastRank > 0 && rank < this.lastRank) {
      const rv = this.hudRankVal;
      rv.classList.remove('is-punch');
      void rv.offsetWidth;
      rv.classList.add('is-punch');
    }
    this.lastRank = rank;

    for (let i = 0; i < this.boardRows.length; i++) {
      const r = this.boardRows[i];
      const d = rows[i];
      if (!d) {
        r.li.classList.add('hidden');
        continue;
      }
      r.li.classList.remove('hidden');
      r.li.classList.toggle('me', d.isPlayer);
      if (r.u.textContent !== d.name) r.u.textContent = d.name;
      // 내 줄은 배경이 채워지므로 색을 덮어쓰지 않는다(대비가 무너진다).
      const col = d.isPlayer ? '' : rgba(lighten(d.color, 0.35), 0.95);
      if (r.u.style.color !== col) r.u.style.color = col;
      const sc = num(d.score);
      if (r.s.textContent !== sc) r.s.textContent = sc;
    }
  }

  /**
   * 첫 판 조작 안내.
   *
   * ★ 튜토리얼 화면을 따로 만들지 않는다 - 조작이 두 가지뿐이라 화면을 하나 더
   *   끼우면 «시작까지의 거리»만 멀어진다. 게임이 시작된 뒤 몇 초만 띄운다.
   *
   * ★ 문구를 «여기서» 고른다(전에는 main 이 골라 문자열로 넘겼다).
   *   main 은 input.isTouch 를 봤고, 그 값은 첫 터치 전까지 false 라
   *   모바일 유저가 게임을 켜자마자 「마우스로 방향을 바꾼다」를 읽었다.
   *   셸은 기기 능력(coarsePointer)을 알고 있으니 셸이 고르는 것이 옳다.
   *
   * ★ 한 줄짜리 알약이 아니라 «두 줄»이다. 방향과 질주는 서로 다른 동작이고,
   *   붙여 놓으면 좁은 화면에서 낱말 한가운데가 잘려 줄바꿈됐다
   *   (390px 실렌더: 「... 누 / 르면 질주」). 줄을 나누면 그 일이 없다.
   */
  showControlHint(seconds = 5): void {
    this.clearHint();
    const n = el('div', 'hud-hint');
    n.append(
      el('b', undefined, t(this.touchHint ? 'howToSteerTouch' : 'howToSteerMouse')),
      el('span', undefined, t('howToBoost')),
    );
    this.hud.appendChild(n);
    this.hintNode = n;
    this.hintTimers.push(
      window.setTimeout(() => {
        n.classList.add('is-out');
        this.hintTimers.push(window.setTimeout(() => this.clearHint(), 400));
      }, seconds * 1000),
    );
  }

  /**
   * 조작 안내를 «지금» 접는다.
   *
   * ★ 왜 시간이 아니라 «행동»으로 접나
   *   이 안내는 화면 아래쪽 가운데에 뜨는데, 조이스틱은 «손가락이 닿은 곳»에
   *   생긴다. 두 자리가 겹치면 안내 판이 조이스틱 노브를 덮는다 - 실제로
   *   393x852 실렌더에서 y 538~562 구간이 겹쳤다(노브가 통째로 가려졌다).
   *   「조작을 배우라」는 안내가 「조작이 안 보이게」 만드는 셈이다.
   *   방향을 한 번 준 순간 안내는 이미 할 일을 마쳤으므로 그때 접는다.
   */
  dismissControlHint(): void {
    if (!this.hintNode) return;
    this.clearHint();
  }

  private clearHint(): void {
    for (const id of this.hintTimers) window.clearTimeout(id);
    this.hintTimers.length = 0;
    if (this.hintNode) {
      this.hintNode.remove();
      this.hintNode = null;
    }
  }

  /**
   * 킬 피드 한 줄.
   *
   * ══ 왜 「A > B」를 버렸는가 (2026-08-24 President 지적) ════════════════
   *   전에는 main 이 `killer + '  >  ' + victim` 으로 «문자열을 조립»해서
   *   넘겼다. 화면에는 「lace21 > lantern89」라고 떴다. 문제가 셋이다:
   *     1) 부등호는 «말»이 아니다. 어느 언어의 문장도 아니라서 읽히지 않는다.
   *     2) 로케일을 안 탄다. 9개 언어를 번역해 놓고 이 줄만 영어권 기호였다.
   *     3) 어순이 틀린다. 한국어는 목적어가 동사 앞이라 「A가 B를」 이지
   *        「A > B」의 순서가 항상 맞는다는 보장이 없다.
   *   => 문장 세 가지(내가 잡음 / 내가 당함 / 남들끼리)를 로케일 파일에 두고,
   *      셸은 «어느 문장인지»만 고른다. 어순은 번역이 알아서 정한다.
   *
   * ★ 이름은 굵게 «칠하기만» 한다 - 문장 어디에 오든 상관없이 {killer}
   *   {victim} 토큰 자리를 찾아 노드로 만든다(길이·위치 가정 없음).
   *   innerHTML 은 쓰지 않는다. 닉네임은 유저 입력이다(셸 머리말 3번).
   */
  pushKill(e: KillFeedEvent): void {
    let key: 'feedKillMine' | 'feedKillDied' | 'feedKill';
    let cls = 'feed-item';
    if (e.killerIsPlayer) {
      key = 'feedKillMine';
      cls += ' is-mine';
    } else if (e.victimIsPlayer) {
      key = 'feedKillDied';
      cls += ' is-lost';
    } else {
      key = 'feedKill';
    }
    const n = el('div', cls);
    n.appendChild(fillNames(t(key), { killer: e.killerName, victim: e.victimName }));
    this.feed.appendChild(n);
    while (this.feed.children.length > FEED_MAX) this.feed.removeChild(this.feed.firstChild!);
    window.setTimeout(() => n.remove(), 3400);
  }

  focusNick(): void {
    // 모바일에서 자동 포커스는 «키보드가 튀어나와» 타이틀을 덮는다. 데스크톱만.
    if (!this.touchHint) this.nickInput.focus();
  }
}


/**
 * 스킨 미리보기 — ★ «게임과 같은 렌더 코드»(render/snakeRender.ts renderSkinPreview)로 그린다.
 *   미리보기를 따로 그리면 「선택한 스킨」과 「실제로 나오는 뱀」이 달라진다 - 그건 UI 가 거짓말을
 *   하는 것이다. S 자 실루엣 + 오른쪽 끝 머리 + 꼬리 테이퍼 + (한 번뿐이라) 블러 글로우.
 * @param W,H 캔버스 논리 해상도(px). CSS 로 «절반»으로 줄여 표시한다(2x 선명도).
 */
export function makeSkinPreview(skin: Skin, W: number, H: number, stage = true): HTMLCanvasElement {
  return renderSkinPreview(skin, W, H, stage);
}
