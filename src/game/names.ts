// names.ts — 봇 닉네임 풀.
//
// ★ 원작에서 가져온 이름이 아니다. 짧고(리더보드 폭 제한) 어느 로케일에서도
//   읽히는 라틴 문자 위주로 직접 구성했다.
// ★ 이전 판은 「닉네임은 번역하지 않는다」는 이유로 전부 라틴 문자였다.
//   그 논리 자체는 맞지만, 결과가 틀렸다 — 한국 유저의 로비가
//   「Cobalt / Kite / lantern89」로만 채워지면 그것이야말로 「가짜」로 읽힌다.
//   실제 한국 게임 로비는 한글·영문이 «섞여» 있다. 그걸 재현한다.
// ★ 그래도 «번역» 은 아니다. 같은 봇의 이름을 언어별로 바꾸는 게 아니라,
//   «어느 로비에 들어왔느냐» 에 따라 봇 구성이 달라지는 것이다.

const FIRST = [
  'Nova', 'Echo', 'Zephyr', 'Onyx', 'Vega', 'Quill', 'Rusty', 'Pixel',
  'Cobalt', 'Juno', 'Kilo', 'Mocha', 'Saber', 'Tango', 'Wisp', 'Zinc',
  'Astro', 'Bolt', 'Cinder', 'Drift', 'Ember', 'Flux', 'Glide', 'Husk',
  'Iris', 'Jolt', 'Kite', 'Lumen', 'Moss', 'Nimbus', 'Orbit', 'Pike',
];

const SECOND = [
  '', '', '', '', '', // 상당수는 «성 없이» 한 단어 — 실제 로비의 닉네임 분포에 가깝다
  'X', '77', '_v2', '99', 'HD', 'GG', '01', 'zz', 'Pro', 'TV', '2K',
];

const SOLO = [
  'noodle', 'wiggle', 'slinky', 'loop', 'spiral', 'twist', 'ribbon', 'lace',
  'ramen', 'udon', 'soba', 'linguine', 'fusilli', 'churro',
  'viper', 'helix', 'curl', 'swerve', 'python', 'lantern',
];

/**
 * 한국 로비용 풀. «번역본» 이 아니라 따로 구성한 별도의 무리다.
 *
 * ★ 짧게 가져간다. 한글은 라틴보다 글자가 넓어서(거의 2배) 4자를 넘기면
 *   순위표와 킬 피드에서 잘린다. 이름이 잘리면 남는 정보가 없다.
 * ★ 귀여운 말장난을 피한다. 「꿈놓지않는소녀」 같은 건 길기도 하고
 *   «사람이 직접 지은 이름» 보다 «생성된 이름» 쪽으로 읽힌다.
 *   실제 로비에서 흔한 건 음식·사물 한 단어다.
 */
const KO_SOLO = [
  '감자', '고구마', '만두', '김밥', '라면', '떡볶이', '순대', '단무지',
  '초코', '모찌', '누둥지', '육수', '사이다', '버터', '연어', '열무',
  '구름', '번개', '자선', '모래사장', '돌고래', '백상어', '살모살모', '꿈틀',
  '기다린다', '눈치게임', '무지개', '끝판왜', '한방', '고수', '뉴비', '백수',
];

/** ⛔'봇' 은 넣지 마라 — 봇이 스스로 봇이라고 이름표를 단다(「만두봇」 실측 발견, 2026-08-25).
 *  뒤에 붙는 꼬리. 상당수는 «없음» — 실제 닉네임 분포가 그렇다. */
const KO_TAIL = [
  '', '', '', '', '', '', 'ㅋ', 'ㅋㅋ', '님', '씨', '이', '2', '77', '99', '짱',
];

export interface NameSource {
  next(): number; // [0,1)
}

/**
 * 로비 구성을 정한다. i18n 이 로케일을 확정한 뒤 한 번 부른다.
 *
 * ★ game/ 은 i18n 을 import 하지 «않는다» — 게임 로직은 표시 계층을 모른다는
 *   이 프로젝트의 규칙이다(input.ts 도 같은 이유로 장치를 모른다).
 *   그래서 «밖에서 주입» 하는 모양으로 둔다.
 */
let koreanLobby = false;
export function setBotNameLocale(locale: string): void {
  koreanLobby = locale === 'ko';
}

/** 중복 없는 닉네임을 n개 만든다. 중복이 리더보드에 뜨면 즉시 「가짜」로 읽힌다. */
export function makeBotNames(rng: NameSource, n: number): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 40) {
    let name: string;
    // 한국 로비면 절반조금 넘게 한글로 채운다. «전부» 한글로 하지 않는 이유는
    // 실제 로비가 섞여 있기 때문이다 — 깔끔히 한 쪽으로만 맞추면 그게 다시 «만든 티»가 난다.
    if (koreanLobby && rng.next() < 0.62) {
      const a = KO_SOLO[Math.floor(rng.next() * KO_SOLO.length)];
      const b = KO_TAIL[Math.floor(rng.next() * KO_TAIL.length)];
      name = a + b;
    } else if (rng.next() < 0.45) {
      name = SOLO[Math.floor(rng.next() * SOLO.length)];
      if (rng.next() < 0.35) name += Math.floor(rng.next() * 90 + 10);
    } else {
      const a = FIRST[Math.floor(rng.next() * FIRST.length)];
      const b = SECOND[Math.floor(rng.next() * SECOND.length)];
      name = a + b;
    }
    if (used.has(name)) continue;
    used.add(name);
    out.push(name);
  }
  // 가드에 걸려 모자라면(풀이 작을 때) 번호를 붙여 채운다 — 여기서 멈추면 봇이 덜 뜬다.
  let i = 1;
  while (out.length < n) out.push(`player${i++}`);
  return out;
}

/** 플레이어 닉 입력 정규화. 빈 값이면 null 을 돌려 호출부가 기본값을 쓰게 한다. */
export const NICK_MAX = 14;
export function sanitizeNick(raw: string): string | null {
  // 제어문자(C0 + DEL)를 코드포인트로 걸러낸다.
  // 정규식 문자클래스에 «날것의» 제어문자를 넣던 첫 판본이 파일 인코딩을 거치며
  // 실제로 깨졌다(2026-08-18). 이스케이프가 필요 없는 형태로 아예 바꿨다.
  const cleaned = Array.from(raw)
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c >= 0x20 && c !== 0x7f;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return Array.from(cleaned).slice(0, NICK_MAX).join('');
}
