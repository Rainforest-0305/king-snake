// i18n/index.ts — 로케일 레지스트리.
//
// ★ 왜 9개인가(작업지시가 「판단하라」고 한 부분에 대한 답):
//   텍스트가 40키뿐이라 번역 비용이 낮다. 반면 MS Store·앱스인토스 노출은
//   로케일 수에 직접 좌우되고, 우리 게임 5종이 이미 9개 로케일로 나가 있어
//   스토어 계정 단위의 일관성도 있다. 「적으니까 한/영만」은 절약이 아니라
//   기존 자산을 못 쓰는 쪽이다. ⇒ 기존 5종과 «동일한 9개»로 맞춘다.
//
// ★ import.meta.glob 을 쓰지 않고 «명시 임포트» 한다.
//   glob 은 파일을 지워도 빌드가 통과해 버린다(런타임에 조용히 빈 객체).
//   명시 임포트는 파일이 사라지면 «빌드가 깨진다» — 그게 옳은 실패다.

import { en } from './messages/en';
import { ko } from './messages/ko';
import { ja } from './messages/ja';
import { zhHans } from './messages/zh-Hans';
import { es } from './messages/es';
import { ptBR } from './messages/pt-BR';
import { de } from './messages/de';
import { fr } from './messages/fr';
import { ru } from './messages/ru';
import { josa } from './josa';
import type { Messages } from './messages.d';

export const SUPPORTED_LOCALES = ['en', 'ko', 'ja', 'zh-Hans', 'es', 'pt-BR', 'de', 'fr', 'ru'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const FALLBACK_LOCALE: Locale = 'en';

/** 언어 선택 UI 에 그대로 쓰는 «자기 언어 표기». 영어로 적으면 못 찾는다. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  ko: '한국어',
  ja: '日本語',
  'zh-Hans': '简体中文',
  es: 'Español',
  'pt-BR': 'Português',
  de: 'Deutsch',
  fr: 'Français',
  ru: 'Русский',
};

const MESSAGES: Record<Locale, Messages> = {
  en, ko, ja, 'zh-Hans': zhHans, es, 'pt-BR': ptBR, de, fr, ru,
};

let current: Locale = FALLBACK_LOCALE;

export function setLocale(l: Locale): void {
  current = MESSAGES[l] ? l : FALLBACK_LOCALE;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = current === 'zh-Hans' ? 'zh-Hans' : current;
  }
}

export function getLocale(): Locale {
  return current;
}

/**
 * 문구 토큰 문법 — «단 하나의 정의»다. t() 와 ui/shell.ts 의 fillNames() 가
 * 같은 문법을 각자 파싱하므로 정규식을 두 벌 두면 반드시 어긋난다.
 *
 *   {name}      값을 그대로 꽂는다.
 *   {name:을}   값을 꽂고 «그 값의 받침에 맞는» 조사를 뒤에 붙인다(i18n/josa.ts).
 *               지정자는 대표형 하나만 쓴다: 이 가 을 를 은 는 와 과 로 으로.
 *               ⚠ 한국어 전용 문법이다. 다른 8개 로케일은 `:` 없는 형태만 쓴다.
 *
 * ★ 매번 «새 정규식»을 만든다. /g 정규식은 lastIndex 를 들고 다니는 가변 객체라
 *   모듈 상수로 공유하면 exec 루프와 replace 가 서로의 위치를 밟는다.
 */
export function tokenRe(): RegExp {
  return /\{(\w+)(?::([^}\s]+))?\}/g;
}

/** 조사 선택. shell 이 «이름 노드»와 «조사 텍스트»를 따로 만들 때 쓴다. */
export { josa } from './josa';

/**
 * 메시지 조회 + 치환.
 * @param vars {n} {name} 같은 토큰의 값. 없는 토큰은 «그대로 남긴다» —
 *             빈 문자열로 지우면 번역 실수를 눈치채지 못한다.
 */
export function t(key: keyof Messages, vars?: Record<string, string | number>): string {
  const msg = MESSAGES[current]?.[key] ?? MESSAGES[FALLBACK_LOCALE][key];
  if (!vars) return msg;
  return msg.replace(tokenRe(), (whole, name: string, spec: string | undefined) => {
    const v = vars[name];
    if (v === undefined) return whole;
    const s = String(v);
    return spec === undefined ? s : s + josa(s, spec);
  });
}

/**
 * 브라우저 언어 → 지원 로케일.
 * ★ 중국어는 지역까지 봐야 한다. zh-TW/zh-HK 는 번체라 간체(zh-Hans)로 보내면
 *   「깨진 중국어」로 읽힌다. 번체 번역이 없으므로 영어로 보내는 편이 낫다.
 */
export function detectLocale(navLangs: readonly string[]): Locale {
  for (const raw of navLangs) {
    const lang = raw.toLowerCase();
    if (lang.startsWith('ko')) return 'ko';
    if (lang.startsWith('ja')) return 'ja';
    if (lang.startsWith('zh')) {
      if (lang.includes('tw') || lang.includes('hk') || lang.includes('hant')) return 'en';
      return 'zh-Hans';
    }
    if (lang.startsWith('pt')) return 'pt-BR';
    if (lang.startsWith('es')) return 'es';
    if (lang.startsWith('de')) return 'de';
    if (lang.startsWith('fr')) return 'fr';
    if (lang.startsWith('ru')) return 'ru';
    if (lang.startsWith('en')) return 'en';
  }
  return FALLBACK_LOCALE;
}

export function isLocale(v: string | null): v is Locale {
  return v !== null && (SUPPORTED_LOCALES as readonly string[]).includes(v);
}

export type { Messages };
