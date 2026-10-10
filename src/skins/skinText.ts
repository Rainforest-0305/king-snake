// skinText.ts — 스킨 요건·특수 기능 문구 «9개 로케일».
//
// ══ 왜 src/i18n/messages/*.ts 에 안 넣는가 ════════════════════════════════
//  그 9개 파일은 «보호 파일»이다(check_protected — 라이브 정본과 바이트 동일).
//  키를 추가하면 9개가 전부 DIFF 가 되어 무접촉 증명이 무너진다.
//  reward/rewardText.ts 가 같은 이유로 이미 «자기 사전»을 든다. 그 규율을 잇는다.
//
// ══ 문체 ═════════════════════════════════════════════════════════════════
//  기존 ko 사전의 문체를 그대로 잇는다. 존댓말·느낌표·「~해보세요」 금지.
//  ⭐특수 기능 설명은 «작게» 들어간다(President 지시) — 한 줄에 들어가야 하므로
//    ko 기준 20자 안쪽을 목표로 잡았다. de/ru 는 길어지니 UI 는 고정폭을
//    가정하지 않는다(줄바꿈 허용 + 말줄임).

import { getLocale } from '../i18n';
import type { AbilityId, AbilityFacts } from './skinAbility';

type Lang = 'en' | 'ko' | 'ja' | 'zh-Hans' | 'es' | 'pt-BR' | 'de' | 'fr' | 'ru';

export interface SkinStrings {
  /** 잠금 칸: 점수 문턱. {n} = 점수 */
  reqScore: string;
  /** 잠금 칸: 광고 누적. {have}/{need} */
  reqAds: string;
  /** 히어로 한 줄: 점수 문턱. {name} {n} */
  reqScoreLong: string;
  /** 히어로 한 줄: 광고 누적. {name} {have} {need} */
  reqAdsLong: string;
  /** 보유 중 */
  owned: string;
  /** 특수 기능 라벨(작은 글씨 앞머리) */
  abilityLabel: string;
  /** 능력 이름 */
  abHeatSense: string;
  abVenom: string;
  /** 능력 설명(작게) */
  abHeatSenseDesc: string;
  abVenomDesc: string;
  /* ── 「터치해서 본다」 패널 (2026-09-02 ②, President 재지시) ────────────
     위의 abilityLabel/ab*Desc 는 <<작은 한 줄>> 그대로 둔다. 아래는 그 한 줄을
     눌렀을 때 열리는 <<더 자세히>>다. 수치는 여기 박지 않는다 - 문구는
     skinAbility.abilityFactsOf() 가 준 값을 {x}/{s} 에 꽂아 만든다. */
  /** 열기 힌트(작은 꼬리표) */
  abMore: string;
  /** 여는 컨트롤의 aria-label. {name} = 종 이름 */
  abInfoAria: string;
  /** 행 라벨: 효과 */
  abEffectLabel: string;
  /** 효과 값. {x} = 기본 흡입 반경의 배수 */
  abEffect: string;
  /** 행 라벨: 언제 도는가 */
  abWhenLabel: string;
  abWhenAlways: string;
  /** {s} = 지속 초 */
  abWhenBurst: string;
  /** 행 라벨: 어떻게 얻나 */
  abGetLabel: string;
  /** 오해 차단 한 줄(수확 속도지 전투력이 아니다) */
  abFair: string;
  /** 닫기 버튼 */
  abClose: string;
  /** ④B 진행도 버튼 제목 */
  progressCta: string;
  /** ④B 버튼 아래 한 줄. {have}/{need} */
  progressSub: string;
  /** ④B 시청 완료 토스트. {have}/{need} */
  progressOk: string;
}

const DICT: Record<Lang, SkinStrings> = {
  ko: {
    reqScore: '{n}점',
    reqAds: '광고 {have}/{need}',
    reqScoreLong: '{name} · {n}점부터',
    reqAdsLong: '{name} · 광고 {have}/{need}회',
    owned: '보유 중',
    abilityLabel: '특수 기능',
    abHeatSense: '열 감지',
    abVenom: '독',
    abHeatSenseDesc: '먹이를 더 넓게 끌어당긴다',
    abVenomDesc: '잡은 직후 잔해를 빨아들인다',
    abMore: '자세히',
    abInfoAria: '{name} 특수 기능 설명',
    abEffectLabel: '효과',
    abEffect: '먹이 흡입 반경 {x}배',
    abWhenLabel: '작동',
    abWhenAlways: '언제나',
    abWhenBurst: '처치 직후 {s}초',
    abGetLabel: '획득',
    abFair: '속도·충돌 판정은 바뀌지 않는다',
    abClose: '닫기',
    progressCta: '광고 보고 진행도 쌓기',
    progressSub: '파란말레이산호뱀 · {have}/{need}',
    progressOk: '진행도 {have}/{need}',
  },
  en: {
    reqScore: '{n} pts',
    reqAds: 'Ads {have}/{need}',
    reqScoreLong: '{name} · from {n} pts',
    reqAdsLong: '{name} · {have}/{need} ads',
    owned: 'Owned',
    abilityLabel: 'Ability',
    abHeatSense: 'Heat Sense',
    abVenom: 'Venom',
    abHeatSenseDesc: 'Pulls in food from farther away',
    abVenomDesc: 'Drains the remains right after a kill',
    abMore: 'Details',
    abInfoAria: '{name} ability details',
    abEffectLabel: 'Effect',
    abEffect: '{x}x food pickup radius',
    abWhenLabel: 'When',
    abWhenAlways: 'Always on',
    abWhenBurst: '{s}s after a kill',
    abGetLabel: 'Unlock',
    abFair: 'Speed and collision are unchanged',
    abClose: 'Close',
    progressCta: 'Watch an ad for progress',
    progressSub: 'Blue Malayan Coral Snake · {have}/{need}',
    progressOk: 'Progress {have}/{need}',
  },
  ja: {
    reqScore: '{n}点',
    reqAds: '広告 {have}/{need}',
    reqScoreLong: '{name} · {n}点から',
    reqAdsLong: '{name} · 広告 {have}/{need}回',
    owned: '所持中',
    abilityLabel: '特殊能力',
    abHeatSense: '熱感知',
    abVenom: '毒',
    abHeatSenseDesc: 'エサをより広く引き寄せる',
    abVenomDesc: '仕留めた直後に残骸を吸収する',
    abMore: '詳しく',
    abInfoAria: '{name} の特殊能力の説明',
    abEffectLabel: '効果',
    abEffect: 'エサの吸引範囲 {x}倍',
    abWhenLabel: '発動',
    abWhenAlways: '常時',
    abWhenBurst: '仕留めた直後 {s}秒',
    abGetLabel: '入手',
    abFair: '速度と当たり判定は変わらない',
    abClose: '閉じる',
    progressCta: '広告を見て進行度を貯める',
    progressSub: 'アオマレーサンゴヘビ · {have}/{need}',
    progressOk: '進行度 {have}/{need}',
  },
  'zh-Hans': {
    reqScore: '{n}分',
    reqAds: '广告 {have}/{need}',
    reqScoreLong: '{name} · {n}分起',
    reqAdsLong: '{name} · 广告 {have}/{need}次',
    owned: '已拥有',
    abilityLabel: '特殊能力',
    abHeatSense: '热感应',
    abVenom: '毒液',
    abHeatSenseDesc: '更大范围吸引食物',
    abVenomDesc: '击杀后立刻吸收残骸',
    abMore: '详情',
    abInfoAria: '{name} 特殊能力说明',
    abEffectLabel: '效果',
    abEffect: '食物吸取范围 {x}倍',
    abWhenLabel: '触发',
    abWhenAlways: '始终生效',
    abWhenBurst: '击杀后 {s}秒',
    abGetLabel: '获取',
    abFair: '速度与碰撞判定不变',
    abClose: '关闭',
    progressCta: '看广告积累进度',
    progressSub: '蓝长腺珊瑚蛇 · {have}/{need}',
    progressOk: '进度 {have}/{need}',
  },
  es: {
    reqScore: '{n} pts',
    reqAds: 'Anuncios {have}/{need}',
    reqScoreLong: '{name} · desde {n} pts',
    reqAdsLong: '{name} · {have}/{need} anuncios',
    owned: 'En posesión',
    abilityLabel: 'Habilidad',
    abHeatSense: 'Termosensor',
    abVenom: 'Veneno',
    abHeatSenseDesc: 'Atrae comida desde más lejos',
    abVenomDesc: 'Absorbe los restos tras cazar',
    abMore: 'Detalles',
    abInfoAria: 'Detalles de la habilidad de {name}',
    abEffectLabel: 'Efecto',
    abEffect: 'Radio de recogida x{x}',
    abWhenLabel: 'Cuándo',
    abWhenAlways: 'Siempre activa',
    abWhenBurst: '{s} s tras cazar',
    abGetLabel: 'Desbloqueo',
    abFair: 'La velocidad y las colisiones no cambian',
    abClose: 'Cerrar',
    progressCta: 'Ver un anuncio para avanzar',
    progressSub: 'Serpiente coral azul · {have}/{need}',
    progressOk: 'Progreso {have}/{need}',
  },
  'pt-BR': {
    reqScore: '{n} pts',
    reqAds: 'Anúncios {have}/{need}',
    reqScoreLong: '{name} · a partir de {n} pts',
    reqAdsLong: '{name} · {have}/{need} anúncios',
    owned: 'Adquirida',
    abilityLabel: 'Habilidade',
    abHeatSense: 'Termossensor',
    abVenom: 'Veneno',
    abHeatSenseDesc: 'Atrai comida de mais longe',
    abVenomDesc: 'Absorve os restos após abater',
    abMore: 'Detalhes',
    abInfoAria: 'Detalhes da habilidade de {name}',
    abEffectLabel: 'Efeito',
    abEffect: 'Raio de coleta x{x}',
    abWhenLabel: 'Quando',
    abWhenAlways: 'Sempre ativa',
    abWhenBurst: '{s} s após abater',
    abGetLabel: 'Desbloqueio',
    abFair: 'Velocidade e colisão não mudam',
    abClose: 'Fechar',
    progressCta: 'Ver anúncio para avançar',
    progressSub: 'Cobra-coral azul · {have}/{need}',
    progressOk: 'Progresso {have}/{need}',
  },
  de: {
    reqScore: '{n} Pkt.',
    reqAds: 'Werbung {have}/{need}',
    reqScoreLong: '{name} · ab {n} Pkt.',
    reqAdsLong: '{name} · {have}/{need} Werbungen',
    owned: 'Im Besitz',
    abilityLabel: 'Fähigkeit',
    abHeatSense: 'Wärmesinn',
    abVenom: 'Gift',
    abHeatSenseDesc: 'Zieht Futter aus größerer Entfernung an',
    abVenomDesc: 'Saugt die Reste direkt nach dem Kill auf',
    abMore: 'Details',
    abInfoAria: 'Details zur Fähigkeit von {name}',
    abEffectLabel: 'Wirkung',
    abEffect: '{x}x Einzugsradius für Futter',
    abWhenLabel: 'Wann',
    abWhenAlways: 'Dauerhaft aktiv',
    abWhenBurst: '{s} s nach einem Kill',
    abGetLabel: 'Freischalten',
    abFair: 'Tempo und Kollision bleiben unverändert',
    abClose: 'Schließen',
    progressCta: 'Werbung ansehen für Fortschritt',
    progressSub: 'Blaue Korallenotter · {have}/{need}',
    progressOk: 'Fortschritt {have}/{need}',
  },
  fr: {
    reqScore: '{n} pts',
    reqAds: 'Pubs {have}/{need}',
    reqScoreLong: '{name} · à partir de {n} pts',
    reqAdsLong: '{name} · {have}/{need} pubs',
    owned: 'Possédé',
    abilityLabel: 'Capacité',
    abHeatSense: 'Thermosensible',
    abVenom: 'Venin',
    abHeatSenseDesc: 'Attire la nourriture de plus loin',
    abVenomDesc: 'Aspire les restes juste après un kill',
    abMore: 'Détails',
    abInfoAria: 'Détails de la capacité de {name}',
    abEffectLabel: 'Effet',
    abEffect: 'Rayon d’attraction x{x}',
    abWhenLabel: 'Quand',
    abWhenAlways: 'Toujours active',
    abWhenBurst: '{s} s après un kill',
    abGetLabel: 'Déblocage',
    abFair: 'La vitesse et les collisions ne changent pas',
    abClose: 'Fermer',
    progressCta: 'Voir une pub pour progresser',
    progressSub: 'Serpent corail bleu · {have}/{need}',
    progressOk: 'Progression {have}/{need}',
  },
  ru: {
    reqScore: '{n} очк.',
    reqAds: 'Реклама {have}/{need}',
    reqScoreLong: '{name} · от {n} очк.',
    reqAdsLong: '{name} · реклама {have}/{need}',
    owned: 'В наличии',
    abilityLabel: 'Способность',
    abHeatSense: 'Теплочувствие',
    abVenom: 'Яд',
    abHeatSenseDesc: 'Притягивает еду с большего расстояния',
    abVenomDesc: 'Поглощает останки сразу после убийства',
    abMore: 'Подробнее',
    abInfoAria: 'Описание способности: {name}',
    abEffectLabel: 'Эффект',
    abEffect: 'Радиус притяжения x{x}',
    abWhenLabel: 'Когда',
    abWhenAlways: 'Постоянно',
    abWhenBurst: '{s} с после убийства',
    abGetLabel: 'Открытие',
    abFair: 'Скорость и столкновения не меняются',
    abClose: 'Закрыть',
    progressCta: 'Смотреть рекламу для прогресса',
    progressSub: 'Синяя коралловая змея · {have}/{need}',
    progressOk: 'Прогресс {have}/{need}',
  },
};

/** 현재 로케일의 스킨 문구. */
export function st(): SkinStrings {
  const l = getLocale() as Lang;
  return DICT[l] ?? DICT.en;
}

/** {key} 치환. reward/rewardText.ts 의 fmt 와 같은 규칙이다. */
export function sfmt(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** 능력 이름. */
export function abilityName(id: AbilityId): string {
  const s = st();
  return id === 'venom' ? s.abVenom : s.abHeatSense;
}

/** 능력 설명(작게 붙는 한 줄). */
export function abilityDesc(id: AbilityId): string {
  const s = st();
  return id === 'venom' ? s.abVenomDesc : s.abHeatSenseDesc;
}

/* == 「자세히」 패널 문구 조립 ============================================
   * 수치를 여기 박지 않는다. abilityFactsOf() 가 준 <<코드에서 유도된>> 값만
     받아 로케일 문법에 꽂는다. 상수를 바꾸면 화면이 같이 바뀐다.
   * Intl 이 없는 구형 WebView 를 대비해 try/catch 로 감싼다(shell.num 과 같은 규율). */
let mulFmt: Intl.NumberFormat | null = null;
function fmtMul(n: number): string {
  if (!mulFmt) {
    try {
      mulFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
    } catch {
      return String(Math.round(n * 100) / 100);
    }
  }
  return mulFmt.format(n);
}

export interface AbilityDetail {
  effectLabel: string;
  effect: string;
  whenLabel: string;
  when: string;
  getLabel: string;
  fair: string;
  close: string;
  more: string;
}

/** 패널에 그릴 «전부». facts 는 skinAbility.abilityFactsOf() 가 준 것. */
export function abilityDetail(facts: AbilityFacts): AbilityDetail {
  const s = st();
  return {
    effectLabel: s.abEffectLabel,
    effect: sfmt(s.abEffect, { x: fmtMul(facts.radiusMul) }),
    whenLabel: s.abWhenLabel,
    when: facts.window === 'burst'
      ? sfmt(s.abWhenBurst, { s: fmtMul(facts.seconds) })
      : s.abWhenAlways,
    getLabel: s.abGetLabel,
    fair: s.abFair,
    close: s.abClose,
    more: s.abMore,
  };
}
