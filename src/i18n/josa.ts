// josa.ts — 한국어 조사(助詞) 자동 선택.
//
// ══ 왜 만들었나 (2026-08-25 President 지적) ═══════════════════════════════
//   킬 피드가 「순대, 김밥 잡았다」로 떴다. 조사가 없으니 쉼표가 «부르는 말»로
//   읽혀서 「순대야, 김밥 잡았다」가 된다 — 누가 누구를 잡았는지가 뒤집힌다.
//   이전 판(messages/ko.ts 머리말 2번)은 「닉네임 뒤에 조사를 붙이지 않는다」는
//   회피 규칙으로 이 문제를 만들었다. 회피가 아니라 «계산»으로 푼다.
//
//   한국어 조사는 앞말의 «받침(종성)»에 따라 갈린다:
//     받침 있음: 김밥«이» 김밥«을» 김밥«은» 김밥«과»
//     받침 없음: 순대«가» 순대«를» 순대«는» 순대«와»
//   ★ 와/과 는 «뒤집혀» 있다(받침 있으면 과). 실수하기 쉬운 자리라 표로 못 박는다.
//   ★ 으로/로 는 ㄹ 받침이 예외다: 서울«로», 김밥«으로», 순대«로».
//      그래서 「받침 있냐」만으로는 부족하고 «ㄹ 받침이냐»를 따로 들고 다닌다.
//
// ══ 판정 대상 ════════════════════════════════════════════════════════════
//   닉네임은 무엇이든 온다(한글·영문·숫자·이모지 혼재, sanitizeNick 은 제어문자만 뺀다).
//   1) 한글 음절(가~힣): 유니코드 산술로 «정확히» 판정된다. 추측이 아니다.
//   2) 숫자: 마지막 숫자의 «한글 읽기» 받침. 1(일)·7(칠)·8(팔)은 ㄹ 받침이다.
//   3) 로마자: 마지막 알파벳의 «한글 읽기» 받침. → 아래 LATIN_BATCHIM 주석 참조.
//   4) 그 외(이모지·기호·낱자 ㅋㅎㅠ 등): 판정 불가 → «건너뛰고» 앞 글자를 본다.
//
// ══ 4)를 「건너뛴다」로 정한 근거 ═════════════════════════════════════════
//   봇 이름 꼬리에 'ㅋ'·'ㅋㅋ'가 있다(game/names.ts KO_TAIL). 'ㅋ'는 U+314B —
//   한글 «음절»이 아니라 호환 낱자라 종성 산술이 통하지 않는다. 두 선택지가 있다:
//     (a) 자음이니 받침으로 친다 → 「감자ㅋ이 잡았다」  ← 아무도 이렇게 안 읽는다
//     (b) 웃음 표기로 보고 건너뛴다 → 「감자ㅋ가 잡았다」 ← 실제 채팅에서 읽는 대로
//   (b)를 쓴다. 이모지·문장부호도 같다(「🐍」 뒤에는 받침을 붙일 근거가 없다).
//   판정할 글자가 «하나도» 없으면(전부 이모지) 받침 없음으로 떨어뜨린다 —
//   「🐍가」가 「🐍이」보다 안전하다(받침 없음 쪽이 어떤 소리 뒤에도 덜 어색하다).
//
// ══ 한계(고칠 수 없어서 아는 채로 둔다) ══════════════════════════════════
//   한국인은 영어 «단어 전체의 한글 표기»에 조사를 붙인다: Chrome → 크롬 → 「크롬을」.
//   마지막 «글자»만 보는 이 모듈은 「Chrome를」을 낸다. 제대로 하려면 영한 음차
//   변환기가 필요한데, 게임 번들에 넣을 크기가 아니다(닉네임 하나에 수백 KB).
//   ⇒ 마지막 글자 규칙은 «틀릴 때가 있는» 근사다. 다만 봇 이름 풀 전수 검증에서
//     어색한 출력이 나오지 않는 것은 확인했다(tools/josa_test.mjs).

/** 조사 지정자. 문구 파일에서 `{victim:을}` 처럼 «대표형» 하나만 쓴다. */
export type JosaSpec = '이' | '가' | '을' | '를' | '은' | '는' | '와' | '과' | '로' | '으로';

/** 앞말의 끝소리 성질. */
export interface Tail {
  /** 받침(종성)이 있는가. */
  batchim: boolean;
  /** 그 받침이 ㄹ 인가. 으로/로 판정에만 쓴다. */
  rieul: boolean;
}

const NO_BATCHIM: Tail = { batchim: false, rieul: false };
const HAS_BATCHIM: Tail = { batchim: true, rieul: false };
const RIEUL: Tail = { batchim: true, rieul: true };

const HANGUL_FIRST = 0xac00; // '가'
const HANGUL_LAST = 0xd7a3; // '힣'
const JONG_COUNT = 28; // 종성 27개 + 없음
const JONG_RIEUL = 8; // 종성 인덱스 8 = ㄹ

/**
 * 숫자의 한글 읽기 받침.
 *   0 영/공(ㅇ)  1 일(ㄹ)  2 이(-)  3 삼(ㅁ)  4 사(-)
 *   5 오(-)      6 육(ㄱ)  7 칠(ㄹ)  8 팔(ㄹ)  9 구(-)
 * ★ 0 은 「영」이든 「공」이든 둘 다 ㅇ 받침이라 갈릴 일이 없다.
 */
const DIGIT_TAIL: Record<string, Tail> = {
  '0': HAS_BATCHIM,
  '1': RIEUL,
  '2': NO_BATCHIM,
  '3': HAS_BATCHIM,
  '4': NO_BATCHIM,
  '5': NO_BATCHIM,
  '6': HAS_BATCHIM,
  '7': RIEUL,
  '8': RIEUL,
  '9': NO_BATCHIM,
};

/**
 * 받침으로 끝나는 «알파벳 이름»만 모은 것. 대소문자 구분 없음.
 *
 * ★ 판정 기준은 한 가지다 — 그 letter 의 한글 읽기 «마지막 음절»에 받침이 있나.
 *     l 엘(ㄹ)  m 엠(ㅁ)  n 엔(ㄴ)          → 받침 있음
 *     s 에스(스) x 엑스(스) z 제트(트) r 아르(르) f 에프(프) h 에이치(치) → 받침 «없음»
 *
 * ⚠ 작업지시서에는 받침 있는 것으로 l·m·n·s·x·z 가 적혀 있었으나 그대로 쓸 수 없었다.
 *   같은 지시서의 기대 출력이 「Iris → 를(받침 없음)」인데 s 를 받침으로 넣으면
 *   「Iris을」이 나온다 — 지시서 안에서 모순이다. 읽기 기준으로 통일하면
 *   Iris→를 는 맞고 PikeX 만 지시서 기대(을)와 달라진다(→ 를).
 *   실사용 근거도 읽기 기준 쪽이다: 「넷플릭스를」「리눅스를」「엑셀을」「줌을」.
 *   ⇒ 그래도 s·x·z 를 받침으로 치고 싶으면 이 문자열만 'lmnsxz' 로 바꾸면 된다.
 *      (그 경우 LATIN_RIEUL 은 그대로 'l')
 */
const LATIN_BATCHIM = 'lmn';
/** 그중 ㄹ 받침. 엘 뿐이다. */
const LATIN_RIEUL = 'l';

/** 글자 하나의 끝소리를 판정한다. 판정할 수 없으면 null. */
function classify(ch: string): Tail | null {
  const code = ch.codePointAt(0);
  if (code === undefined) return null;

  if (code >= HANGUL_FIRST && code <= HANGUL_LAST) {
    const jong = (code - HANGUL_FIRST) % JONG_COUNT;
    if (jong === 0) return NO_BATCHIM;
    return jong === JONG_RIEUL ? RIEUL : HAS_BATCHIM;
  }

  const d = DIGIT_TAIL[ch];
  if (d) return d;

  // 로마자는 ASCII 만 본다. 전각·악센트 문자는 판정 대상이 아니다(건너뛴다).
  const lower = ch.toLowerCase();
  if (lower >= 'a' && lower <= 'z' && lower.length === 1) {
    if (LATIN_RIEUL.includes(lower)) return RIEUL;
    return LATIN_BATCHIM.includes(lower) ? HAS_BATCHIM : NO_BATCHIM;
  }

  return null;
}

/**
 * 낱말의 끝소리. 뒤에서부터 «판정 가능한 첫 글자»를 찾는다(머리말 4번 근거).
 * 판정 가능한 글자가 없으면 받침 없음.
 */
export function tailOf(word: string): Tail {
  const chars = Array.from(word); // 서로게이트 페어(이모지)를 쪼개지 않는다
  for (let i = chars.length - 1; i >= 0; i--) {
    const t = classify(chars[i]);
    if (t) return t;
  }
  return NO_BATCHIM;
}

/** 받침이 있는가. 바깥에서 직접 쓸 일은 드물지만 테스트가 이걸 본다. */
export function hasBatchim(word: string): boolean {
  return tailOf(word).batchim;
}

/**
 * 낱말에 맞는 조사를 «고른다»(낱말은 붙이지 않는다).
 * 모르는 지정자면 지정자를 그대로 돌려준다 — 화면에 그대로 뜨게 두는 것이
 * 조용히 지우는 것보다 낫다(i18n/index.ts 의 t() 와 같은 규칙).
 */
export function josa(word: string, spec: string): string {
  const { batchim, rieul } = tailOf(word);
  switch (spec) {
    case '이':
    case '가':
      return batchim ? '이' : '가';
    case '을':
    case '를':
      return batchim ? '을' : '를';
    case '은':
    case '는':
      return batchim ? '은' : '는';
    case '와':
    case '과':
      // ★ 뒤집혀 있다: 받침 있으면 «과».
      return batchim ? '과' : '와';
    case '로':
    case '으로':
      // ★ ㄹ 받침은 예외 — 「서울로」이지 「서울으로」가 아니다.
      return !batchim || rieul ? '로' : '으로';
    default:
      return spec;
  }
}

/** 낱말 + 조사. */
export function withJosa(word: string, spec: string): string {
  return word + josa(word, spec);
}
