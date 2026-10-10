// rewardText.ts — 리워드 UI 문구 «9개 로케일».
//
// ══ 왜 src/i18n/messages/*.ts 에 안 넣는가 ════════════════════════════════
//  그 9개 파일은 전부 «보호 파일»이다(tools/check_protected.mjs) — 라이브 정본과
//  바이트 단위로 같아야 한다. 여기에 키를 추가하면 9개 파일 전부가 DIFF 가 되고,
//  이 레인이 «i18n 을 건드렸다»는 뜻이 되어 무접촉 증명이 통째로 무너진다.
//  ⇒ 리워드 문구만 여기 별도 사전으로 든다. 로케일 «선택»은 i18n/index.ts 의
//    getLocale() 을 그대로 쓰므로 언어 전환은 자동으로 따라온다.
//
// ══ 문체 ═════════════════════════════════════════════════════════════════
//  기존 ko 사전의 문체(「죽었다」·「다시 하기」·「스킨 전부 열었다」)를 그대로 잇는다.
//  존댓말·느낌표 남발·「~해보세요」 금지 — 이 게임의 목소리가 아니다.
//
// ══ 길이 규율 ════════════════════════════════════════════════════════════
//  ⭐로케일마다 문자열이 길어진다(de/ru 는 ko 의 2배가 흔하다). 버튼은 고정폭을
//    «가정하지 않는다» — styles.css 에서 줄바꿈을 허용하고 min-height 로만 잡는다.
//    가장 긴 후보를 기준으로 삼되, 문구 자체를 짧게 유지하는 게 먼저다.

import { getLocale } from '../i18n';

export interface RewardStrings {
  /** 사망 시트 부활 버튼 */
  reviveCta: string;
  /** 부활 버튼 아래 한 줄(제약을 «먼저» 알린다 — 눌러 보고 알게 하지 않는다) */
  reviveSub: string;
  reviveOk: string;
  /** 메뉴 시작 부스트 버튼 */
  boostCta: string;
  boostReady: string;
  /** {k} = 길이 배수 */
  boostSub: string;
  boostOk: string;
  /** 잠긴 스킨 카드의 광고 배지 라벨(aria) */
  skinAdCta: string;
  /** {name} = 스킨 이름 */
  skinOk: string;
  failWatch: string;
  failLoad: string;
  capDay: string;
  loading: string;
}

type Lang = 'en' | 'ko' | 'ja' | 'zh-Hans' | 'es' | 'pt-BR' | 'de' | 'fr' | 'ru';

const DICT: Record<Lang, RewardStrings> = {
  ko: {
    reviveCta: '광고 보고 부활',
    reviveSub: '이 자리에서 · 판당 1회',
    reviveOk: '부활 · 잠깐 무적',
    boostCta: '광고 보고 길게 시작',
    boostReady: '길게 시작 준비됨',
    boostSub: '길이 {k}배로 시작',
    boostOk: '다음 판은 길게 시작',
    skinAdCta: '광고 보고 해금',
    skinOk: '{name} 해금',
    failWatch: '끝까지 봐야 보상을 받는다',
    failLoad: '광고를 못 불러왔다',
    capDay: '오늘 몫을 다 썼다',
    loading: '불러오는 중',
  },
  en: {
    reviveCta: 'Watch ad, revive',
    reviveSub: 'Right here · once per run',
    reviveOk: 'Revived · briefly invincible',
    boostCta: 'Watch ad, start longer',
    boostReady: 'Long start ready',
    boostSub: 'Start {k}x longer',
    boostOk: 'Next run starts longer',
    skinAdCta: 'Watch ad to unlock',
    skinOk: '{name} unlocked',
    failWatch: 'Watch the whole ad to get it',
    failLoad: "Couldn't load the ad",
    capDay: "That's all for today",
    loading: 'Loading',
  },
  ja: {
    reviveCta: '広告を見て復活',
    reviveSub: 'この場で・1ゲーム1回',
    reviveOk: '復活・少しの間無敵',
    boostCta: '広告を見て長く開始',
    boostReady: '長く開始の準備完了',
    boostSub: '長さ{k}倍で開始',
    boostOk: '次は長く始まる',
    skinAdCta: '広告を見て解放',
    skinOk: '{name} 解放',
    failWatch: '最後まで見ると受け取れる',
    failLoad: '広告を読み込めなかった',
    capDay: '今日の分は終わり',
    loading: '読み込み中',
  },
  'zh-Hans': {
    reviveCta: '看广告复活',
    reviveSub: '原地复活 · 每局一次',
    reviveOk: '复活 · 短暂无敌',
    boostCta: '看广告变长开局',
    boostReady: '加长开局已就绪',
    boostSub: '以{k}倍长度开局',
    boostOk: '下一局会更长',
    skinAdCta: '看广告解锁',
    skinOk: '已解锁 {name}',
    failWatch: '看完广告才能拿到奖励',
    failLoad: '广告加载失败',
    capDay: '今天的次数用完了',
    loading: '加载中',
  },
  es: {
    reviveCta: 'Ver anuncio y revivir',
    reviveSub: 'Aquí mismo · una vez por partida',
    reviveOk: 'Revivido · invencible un momento',
    boostCta: 'Ver anuncio, empezar más largo',
    boostReady: 'Inicio largo listo',
    boostSub: 'Empieza {k}x más largo',
    boostOk: 'La próxima empieza más larga',
    skinAdCta: 'Ver anuncio para desbloquear',
    skinOk: '{name} desbloqueada',
    failWatch: 'Mira el anuncio entero para recibirlo',
    failLoad: 'No se pudo cargar el anuncio',
    capDay: 'Por hoy ya está',
    loading: 'Cargando',
  },
  'pt-BR': {
    reviveCta: 'Ver anúncio e reviver',
    reviveSub: 'Aqui mesmo · uma vez por partida',
    reviveOk: 'Revivido · invencível por pouco',
    boostCta: 'Ver anúncio, começar maior',
    boostReady: 'Início longo pronto',
    boostSub: 'Comece {k}x maior',
    boostOk: 'A próxima começa maior',
    skinAdCta: 'Ver anúncio para desbloquear',
    skinOk: '{name} desbloqueada',
    failWatch: 'Assista ao anúncio inteiro para receber',
    failLoad: 'Não deu para carregar o anúncio',
    capDay: 'Por hoje chega',
    loading: 'Carregando',
  },
  de: {
    reviveCta: 'Werbung ansehen, weiter',
    reviveSub: 'Genau hier · einmal pro Runde',
    reviveOk: 'Wiederbelebt · kurz unverwundbar',
    boostCta: 'Werbung ansehen, länger starten',
    boostReady: 'Langer Start bereit',
    boostSub: '{k}x länger starten',
    boostOk: 'Nächste Runde startet länger',
    skinAdCta: 'Werbung ansehen zum Freischalten',
    skinOk: '{name} freigeschaltet',
    failWatch: 'Werbung ganz ansehen, dann gibt es die Belohnung',
    failLoad: 'Werbung konnte nicht geladen werden',
    capDay: 'Für heute reicht es',
    loading: 'Wird geladen',
  },
  fr: {
    reviveCta: 'Voir une pub, revivre',
    reviveSub: 'Ici même · une fois par partie',
    reviveOk: 'Ressuscité · invincible un instant',
    boostCta: 'Voir une pub, démarrer plus long',
    boostReady: 'Départ long prêt',
    boostSub: 'Démarrer {k}x plus long',
    boostOk: 'La prochaine démarre plus longue',
    skinAdCta: 'Voir une pub pour débloquer',
    skinOk: '{name} débloqué',
    failWatch: "Regarde la pub en entier pour l'obtenir",
    failLoad: "La pub n'a pas pu être chargée",
    capDay: "C'est tout pour aujourd'hui",
    loading: 'Chargement',
  },
  ru: {
    reviveCta: 'Реклама и возрождение',
    reviveSub: 'Здесь же · раз за игру',
    reviveOk: 'Возрождение · короткая неуязвимость',
    boostCta: 'Реклама и длинный старт',
    boostReady: 'Длинный старт готов',
    boostSub: 'Старт длиннее в {k}х',
    boostOk: 'Следующая игра начнётся длиннее',
    skinAdCta: 'Реклама, чтобы открыть',
    skinOk: '{name} открыт',
    failWatch: 'Досмотри рекламу до конца',
    failLoad: 'Не удалось загрузить рекламу',
    capDay: 'На сегодня хватит',
    loading: 'Загрузка',
  },
};

/**
 * 지금 로케일의 리워드 문구.
 * ★ 매 호출마다 getLocale() 을 다시 읽는다 — 언어를 바꾸면 다음 렌더에 반영된다.
 *   모듈 상수로 캐시하면 언어 전환이 안 먹는다(같은 실수가 게임 4종에 있었다).
 */
export function rt(): RewardStrings {
  const l = getLocale() as Lang;
  return DICT[l] ?? DICT.en;
}

/** {name} / {k} 같은 토큰을 채운다. ★값이 없는 토큰은 «그대로 남긴다» — 지우면 번역 실수를 못 본다. */
export function fmt(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = vars[key];
    return v === undefined ? whole : String(v);
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 기록 돌파 리워드 문구 (2026-08-31 레인 5 신설)
 *
 * ★ 위 DICT 에 «키를 더하지 않고» 사전을 따로 뒀다. 이유 둘:
 *   1) 위 DICT 는 이미 검수에 실려 나간 3종(부활·부스트·스킨)의 정본이다.
 *      9개 로케일 객체를 전부 열어 키를 끼우면 그 3종의 문자열까지 diff 가 되고,
 *      「이 레인이 기존 문구를 안 건드렸다」를 diff 로 증명할 수 없게 된다.
 *   2) 성격이 다르다. 저쪽은 «버튼 라벨»이고 이쪽은 «게임을 멈추고 띄우는 판»이다.
 *
 * ★ 문체는 같다 — 존댓말·느낌표·「~해보세요」 금지. 기존 ko 사전의 평서형을 잇는다.
 * ★ 용어를 새로 만들지 않는다: 「길이」는 i18n hudLength, 「신기록」은 newBest 와
 *   «같은 낱말»을 쓴다. HUD 에서 「길이」라고 읽던 숫자를 여기서 「점수」라고
 *   부르면 같은 값이 두 이름을 갖는다.
 * ══════════════════════════════════════════════════════════════════════════ */

export interface GrowthStrings {
  /** 제안 판 제목 — 문턱 돌파. {n} = 넘은 문턱값 */
  thresholdTitle: string;
  /** 제안 판 제목 — 개인 최고 기록 돌파 */
  bestTitle: string;
  /** 배너 둘째 줄 = 「광고 보고 {k}배 키우기」. {k} = 배수 */
  cta: string;
  /** 지급 토스트. {k} = 배수, {n} = 커진 뒤 길이 */
  ok: string;
  /** 복귀 카운트다운 밑에 붙는 한 낱말 */
  resume: string;
}

const GROWTH_DICT: Record<Lang, GrowthStrings> = {
  ko: {
    thresholdTitle: '{n} 돌파',
    bestTitle: '신기록',
    cta: '광고 보고 {k}배 키우기',
    ok: '{k}배 · 길이 {n}',
    resume: '이어서',
  },
  en: {
    thresholdTitle: '{n} passed',
    bestTitle: 'New best',
    cta: 'Watch ad, grow {k}x',
    ok: '{k}x · length {n}',
    resume: 'Resuming',
  },
  ja: {
    thresholdTitle: '{n} 突破',
    bestTitle: '新記録',
    cta: '広告を見て{k}倍',
    ok: '{k}倍・長さ {n}',
    resume: '再開',
  },
  'zh-Hans': {
    thresholdTitle: '突破 {n}',
    bestTitle: '新纪录',
    cta: '看广告变 {k} 倍',
    ok: '{k} 倍 · 长度 {n}',
    resume: '继续',
  },
  es: {
    thresholdTitle: '{n} superado',
    bestTitle: 'Récord',
    cta: 'Ver anuncio, crecer {k}x',
    ok: '{k}x · longitud {n}',
    resume: 'Reanudando',
  },
  'pt-BR': {
    thresholdTitle: '{n} passado',
    bestTitle: 'Recorde',
    cta: 'Ver anúncio, crescer {k}x',
    ok: '{k}x · tamanho {n}',
    resume: 'Voltando',
  },
  de: {
    thresholdTitle: '{n} geknackt',
    bestTitle: 'Neuer Rekord',
    cta: 'Werbung ansehen, {k}x wachsen',
    ok: '{k}x · Länge {n}',
    resume: 'Weiter',
  },
  fr: {
    thresholdTitle: '{n} dépassé',
    bestTitle: 'Nouveau record',
    cta: 'Voir une pub, grandir {k}x',
    ok: '{k}x · longueur {n}',
    resume: 'Reprise',
  },
  ru: {
    thresholdTitle: '{n} пройдено',
    bestTitle: 'Новый рекорд',
    cta: 'Реклама и рост в {k}х',
    ok: '{k}х · длина {n}',
    resume: 'Продолжаем',
  },
};

/** 지금 로케일의 기록 돌파 문구. ★rt() 와 같은 이유로 매번 다시 읽는다. */
export function gt(): GrowthStrings {
  const l = getLocale() as Lang;
  return GROWTH_DICT[l] ?? GROWTH_DICT.en;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 결과 화면 「이번 판 성장 2배」 + 「다음 판 시작」 이어받기 문구 (2026-09-10 레인 A 신설)
 *
 * ★ GROWTH_DICT 와 같은 이유로 사전을 «따로» 뒀다 — 검수에 실려 나간 문구를 diff 로 건드리지 않는다.
 * ★ 용어: 「길이」는 hudLength 와 같은 낱말. 보상은 «다음 판 시작 길이»에 얹히므로 「다음 판 시작」이라
 *   부른다 — 「보너스」·「코인」처럼 게임에 없는 통화를 만들지 않는다.
 * ★ 숫자는 UI 가 채운다({n}·{m}). 문구가 값을 «들고 있지 않는다».
 * ★ 2026-09-10 정정 — doubleSub 에서 화살표(→)를 뺐다. 제출 전 검사(preflight_ait.py 실코드 글리프)가
 *   U+2190~21FF 를 «유저에게 보이는 글자»로 잡아 「업로드 금지」를 냈다(실측 9건 = 9개 로케일).
 *   면제 파일(PREFLIGHT_ALLOW_GLYPH.txt)로 검사를 끄지 않고 «문장으로» 고쳤다 — 화살표는 스크린리더가
 *   읽지 못하고 기기·폰트에 따라 두부(tofu)로 빠질 수 있어, 어차피 낱말이 옳다.
 * ══════════════════════════════════════════════════════════════════════════ */

export interface ResultStrings {
  /** 결과 화면 kv 행 라벨 — 값은 「+{n}」 */
  carryLabel: string;
  /** 2배 버튼 제목 */
  doubleCta: string;
  /** 2배 버튼 부제. {n} = 지금 몫, {m} = 2배 몫 */
  doubleSub: string;
  /** 지급 토스트. {m} = 2배 몫 */
  doubleOk: string;
}

const RESULT_DICT: Record<Lang, ResultStrings> = {
  ko: {
    carryLabel: '다음 판 시작',
    doubleCta: '광고 보고 이번 판 성장 2배',
    doubleSub: '다음 판 시작 +{n}에서 +{m}으로',
    doubleOk: '다음 판 시작 +{m}',
  },
  en: {
    carryLabel: 'Next run starts at',
    doubleCta: 'Watch ad, double this run\'s growth',
    doubleSub: 'Next run +{n} becomes +{m}',
    doubleOk: 'Next run starts +{m}',
  },
  ja: {
    carryLabel: '次のゲーム開始',
    doubleCta: '広告を見て今回の成長を2倍',
    doubleSub: '次の開始 +{n} が +{m} に',
    doubleOk: '次の開始 +{m}',
  },
  'zh-Hans': {
    carryLabel: '下一局开局',
    doubleCta: '看广告把本局成长翻倍',
    doubleSub: '下一局开局 +{n} 变 +{m}',
    doubleOk: '下一局开局 +{m}',
  },
  es: {
    carryLabel: 'Próxima partida',
    doubleCta: 'Ver anuncio, doblar lo crecido',
    doubleSub: 'Próxima partida +{n} pasa a +{m}',
    doubleOk: 'Próxima partida +{m}',
  },
  'pt-BR': {
    carryLabel: 'Próxima partida',
    doubleCta: 'Ver anúncio e dobrar o que cresceu',
    doubleSub: 'Próxima partida +{n} vira +{m}',
    doubleOk: 'Próxima partida +{m}',
  },
  de: {
    carryLabel: 'Nächste Runde startet',
    doubleCta: 'Werbung ansehen, Wachstum verdoppeln',
    doubleSub: 'Nächste Runde +{n} wird +{m}',
    doubleOk: 'Nächste Runde +{m}',
  },
  fr: {
    carryLabel: 'Prochaine partie',
    doubleCta: 'Voir une pub, doubler la croissance',
    doubleSub: 'Prochaine partie +{n} devient +{m}',
    doubleOk: 'Prochaine partie +{m}',
  },
  ru: {
    carryLabel: 'Старт следующей игры',
    doubleCta: 'Реклама и удвоить рост',
    doubleSub: 'Следующая игра +{n} станет +{m}',
    doubleOk: 'Следующая игра +{m}',
  },
};

/** 지금 로케일의 결과 화면 문구. ★rt() 와 같은 이유로 매번 다시 읽는다. */
export function rst(): ResultStrings {
  const l = getLocale() as Lang;
  return RESULT_DICT[l] ?? RESULT_DICT.en;
}
