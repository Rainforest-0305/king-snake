// brand.ts — 브랜드 문자열 «단일 소스».
//
// ★ 이 파일 밖의 코드에 게임 이름 리터럴을 쓰지 마라. 이름이 바뀌면 여기만 고친다.
//   예외는 «의도된 사본» 3곳뿐이다 — 고칠 때 반드시 같이 고쳐라:
//     1) index.html <title>       - 크롤러/링크 카드는 JS 를 실행하지 않는다.
//        런타임 주입만 믿으면 배포 후에야 옛 이름이 노출된다(2026-08-05 실사고).
//     2) public/manifest.json     - name/short_name.
//     3) granite.config.ts        - brand.displayName (앱스인토스).
//
// ══ 이름 (2026-08-18 President 확정) ═══════════════════════════════════════
//   영어      King Snake
//   한국어    뱀 키우기      ← 앱 내부 표기 · 앱스인토스. «띄어쓰기 O»
//   MS Store  뱀키우기       ← MS Store 한국어 예약명만 «붙여쓰기»
//
//   ★ 두 플랫폼의 한글명이 «한 칸» 다르다. 오타가 아니다.
//     실측(Partner Center, 2026-08-18): 「뱀 키우기」(띄어쓰기)는
//     "The name is not available" — 이미 «다른 계정»이 선점했다.
//     「뱀키우기」(붙여쓰기)로 예약을 마쳤다.
//     ⇒ 누가 나중에 이 불일치를 「버그」로 보고 통일하려 들 것이다. 하지 마라.
//
//   ★ manifest 의 name 은 MS Store 예약명 「King Snake」와 «정확히» 일치해야 한다.
//     대소문자·공백 포함. 어긋나면 재배포 + 재패키징이다(머니리그 실측 함정).
//
// ★ 폴더명이 아직 coil-rush 인 것은 «내부 식별자»라 그대로 둔 것이다
//   (President 승인). 사용자에게 보이는 문자열은 전부 아래 값에서 나온다.
export const BRAND_EN = 'King Snake';
export const BRAND_KO = '뱀 키우기';

/** MS Store 한국어 «예약명». 스토어 리스팅 외에는 쓰지 마라. */
export const BRAND_KO_STORE = '뱀키우기';

/** manifest.json 의 short_name 과 «반드시» 같아야 한다. */
export const BRAND_SHORT = 'King Snake';

/** GitHub Pages 경로·저장키·manifest id 의 근거가 되는 게임 id. */
export const GAME_ID = 'king-snake';

/** MS Store Partner Center 실측값(2026-08-18). ★추측 금지 — 오타 1글자면 패키지가 거부된다. */
export const MS_STORE = {
  identityName: 'RIMI0305.KingSnake',
  publisher: 'CN=294BF0A2-B592-45E6-B466-B04A68809903',
  publisherDisplayName: 'RIMI_0305',
  pfn: 'RIMI0305.KingSnake_x03wxh91hsxre',
  storeId: '9NX62KXV5Q6W',
  storeUrl: 'https://apps.microsoft.com/detail/9NX62KXV5Q6W',
  /** ★ 이름 예약 만료. 이때까지 제출하지 않으면 이름을 잃는다. */
  nameReservationExpires: '2026-11-18',
} as const;

export function applyDocumentTitle(localeIsKo: boolean): void {
  if (typeof document === 'undefined') return;
  document.title = localeIsKo ? `${BRAND_KO} · ${BRAND_EN}` : BRAND_EN;
}
