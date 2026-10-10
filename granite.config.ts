/**
 * granite.config.ts — Apps In Toss `.ait` 빌드 정본 (트랙 — 뱀 키우기 / King Snake (코드명 coil-rush, 폴더는 유지))
 *
 * territory-clash/granite.config.ts, prism-grid/granite.config.ts 를 레시피로
 * 그대로 따르고 값만 이 게임에 맞게 바꿨다. 두 선례 모두 §7 함정표(트랙 C
 * ait_스캐폴딩_전략.md)의 실측을 반영한 결과물이라 구조를 새로 고안하지 않았다.
 *
 * ============================================================================
 * 이 파일이 어떤 빌드 전략을 타는지 (중요 — 오해 금지)
 * ============================================================================
 * @apps-in-toss/cli 의 buildArtifact() 는 전략을 소스 문자열로 고른다.
 *   node_modules/@apps-in-toss/cli/dist/index.js  WebBuildStrategy.match():
 *     return graniteConfigSource.includes('@apps-in-toss/web-framework');
 * 즉 이 파일에 '@apps-in-toss/web-framework' 문자열이 있으면 **Web 전략**,
 * 없으면 RN(Granite) 전략이다. ★ 아래 import 문자열을 지우거나 바꾸면
 * 전략이 통째로 RN 으로 떨어져 빌드가 깨진다. 절대 건드리지 마라.
 *
 * ============================================================================
 * appName — ★★★ 콘솔 미등록 상태. 반드시 등록 후 재빌드할 것 ★★★
 * ============================================================================
 * 'kingsnake' 는 **잠정값이자 «희망값»**이다. 콘솔에 미니앱이 아직 생성되지
 * 않았고, 이 이름을 «확보한 것도 아니다».
 *
 * ★★ appName 은 «미니앱 생성 시점에만» 정할 수 있고 그 뒤로는 «영원히 못 바꾼다».
 *    그래서 이 값은 확정이 아니라 신청값이다.
 * ★★ 그리고 선점은 «가정이 아니라 실측된 현실»이다 — 2026-08-18 MS Store 에서
 *    「뱀 키우기」(띄어쓰기)가 이미 «다른 계정»에 선점돼 있었다.
 *    kingsnake 도 남이 가져갔을 수 있다. 확보 통보를 받기 «전»에는
 *    이 값을 확정된 것처럼 취급하지 마라.
 * 불일치 상태로 업로드하면 업로드 자체는 되지만 서버 컴파일 단계에서
 * BUILD_FAILED 로 떨어진다(MIRI 실사고 원문: "콘솔에 등록된 앱 ID와
 * granite.config.ts의 appName이 일치하지 않아요").
 * ▶ President/Partner 가 콘솔에 앱을 만든 뒤:
 *     1) 실제 콘솔 appName 으로 아래 값을 교체
 *     2) .granite/app.json 의 appName 도 동일하게 교체
 *     3) **반드시 재빌드**(값이 4종 플랫폼 번들에 인라인되므로 config만
 *        고치고 기존 .ait 를 재업로드하면 옛 값이 그대로 나간다 — 함정 #6)
 */
import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'kingsnake',

  /**
   * web.commands
   *   dev   — `ait dev` 가 띄우는 로컬 개발 서버 명령
   *   build — `ait build` 가 .ait 만들기 전에 실행하는 명령
   *
   * ★ 함정 #11(§7): 이 명령들은 npm run 이 아니라 npx 로 실행된다
   *   (@apps-in-toss/cli/dist/index.js -> web-config/dist/index.js,
   *   npm 환경에서 packageManager 가 "npx" 로 치환됨). 'run build' 처럼
   *   쓰면 `npx run build` 가 되어 실패한다. 반드시 **실행 파일명만** 쓴다
   *   (예: 'vite', 'vite build' — 'npm run build:web' 아님).
   */
  web: {
    host: 'localhost',
    port: 5190, // vite.config.ts server.port 와 반드시 같아야 한다.
    commands: {
      dev: 'vite',
      build: 'vite build',
    },
  },

  /**
   * outdir — vite.config.ts 의 build.outDir(dist)와 같아야 한다.
   *
   * ★★ 치명적 함정(§7 #9) — clean 없이 재빌드하면 옛 게임이 담긴 .ait 가
   *   조용히 나온다.
   *   WebBuildStrategy.ensurePrepared() 는 이렇게 시작한다(cli 실측):
   *       const files = await fs.readdir(webDistDir);
   *       if (files.includes('index.html')) { ...; this.prepared = true; return config; }
   *   즉 `dist/web/index.html` 이 이미 있으면 **vite 빌드를 통째로 건너뛴다.**
   *   그런데 직전 `ait build` 가 바로 그 파일을 남긴다. 게임 코드를 고치고
   *   `npx ait build` 만 다시 치면 에러도 경고도 없이 **옛날 게임이 담긴
   *   .ait 가 나온다.**
   *   => package.json 의 "build:ait" 스크립트가 clean 을 먼저 돌게 박아뒀다
   *      ("npm run clean && ait build"). clean 스크립트는 dist/ 를 rmSync
   *      로 지운다(node -e, 별도 패키지 불요). 우회하지 마라.
   */
  outdir: 'dist',

  brand: {
    displayName: '뱀 키우기',
    /**
     * ★★ 콘솔에 등록할 미니앱 이름과 «글자 그대로»(공백 포함) 일치해야
     *   한다. 네온 스레드가 이 값과 콘솔 등록명 사이 공백 하나 차이로
     *   실제로 반려된 이력이 있다(선례 주석 인용, territory-clash 계열
     *   프로젝트군 공통 교훈). 콘솔 등록 시 이 문자열을 그대로 복사해 넣을 것.
     *
     * ★★ 오타로 착각해 "고치지" 마라 — 플랫폼별 한글 표기가 «의도적으로»
     *   한 칸 다르다:
     *     앱스인토스(AIT)/앱 내부 표기: "뱀 키우기" (띄어쓰기 있음, 이 값)
     *     MS Store 한국어 예약명:        "뱀키우기"  (붙여쓰기)
     *   이 파일은 AIT 전용이므로 띄어쓰기 있는 쪽이 맞다. 영문명은 공통으로
     *   "King Snake"(캐릭터가 지렁이 -> 뱀으로 전면 개편되며 확정된 이름 —
     *   이전 잠정명 "Coil Rush / 코일 러시"는 폐기. 폴더/코드 식별자
     *   `coil-rush` 만 하위호환으로 유지).
     */
    /**
     * primaryColor — 게임 브랜드 앰버.
     *
     * ★ 2026-08-28 변경: #ffc98d → #ffb43c
     *   근거: src/ui/styles.css 의 강조색 토큰이 --primary(=이제 차가운 흰색)와
     *   --signal(=신호 앰버)로 갈라졌고, «브랜드의 유채색»은 --signal 쪽이다.
     *   President 지적("그 특유의 갈색 컬러가 안 이뻐")의 대상이 바로 옛 값이다.
     *   저채도 고명도 웜톤(#ffc98d)은 큰 면적에서 베이지/갈색으로 읽히고,
     *   채도를 올린 같은 계열(#ffb43c)은 금색으로 읽힌다. 색상(hue)은 그대로라
     *   이미 콘솔에 등록된 아이콘(주황 옥수수뱀)과 어긋나지 않는다.
     *
     * ⚠ 이 값은 «번들 내부» 브랜드 색이다 — 콘솔에 따로 등록하는 값이 아니다
     *   (등록 대상은 아이콘/스크린샷 URL 이고 그건 건드리지 않았다).
     *   그래도 되돌리고 싶으면 이 한 줄만 '#ffc98d' 로 되돌리고 재빌드하면 된다.
     * ⚠ 빌드타임 인라인이라 config 만 고치고 기존 .ait 를 재업로드하면
     *   옛 값이 그대로 나간다(§7 함정 #6). 반드시 재빌드할 것.
     */
    primaryColor: '#ffb43c',
    /**
     * ★ 정정(2026-08-18): 「미니앱이 없어서 아이콘 URL 을 못 받는다」는 **틀렸다**.
     *   image_upload_url 은 workspaceId 만 받는다 — miniAppId 를 «안 받는다».
     *   즉 미니앱 생성 «전»에도 지금 바로 발급받을 수 있다.
     *   ⇒ 우리는 파일까지만 만들고(public/icons/icon-600.png),
     *     발급·업로드와 publicUrl 회신은 Partner 가 맡는다.
     * ★ 규격은 1px 이라도 다르면 «거부»된다. 리사이즈·압축·포맷변환 금지:
     *     앱 로고        600 x 600    PNG
     *     가로 썸네일    1932 x 828   PNG  (게임은 images «와» gameInfo 양쪽에 같은 주소)
     *     세로 스크린샷  636 x 1048   PNG  (최소 3장. 가로와 섞을 수 없다)
     * TODO(publicUrl 회신 후 필수): 아래 값에 그대로 붙여넣고 **반드시 재빌드**
     *   (§7 함정 #6 — icon/brand 는 빌드타임 인라인이라 config 만 고치고 기존
     *   .ait 를 재업로드하면 옛 아이콘이 그대로 나간다).
     * (§7 함정 #5: icon URL 이 콘솔 등록본과 불일치하면 반려된 실적이 있다.)
     */
    icon: 'https://static.toss.im/appsintoss/63105/d13cc6ca-259e-40f2-a4f0-6885e4a34d17.png',
  },

  /**
   * permissions — 이 게임이 쓰는 네이티브 권한.
   *   뱀 키우기는 위치·카메라·마이크·연락처·사진 어느 것도 쓰지 않는다.
   *   Storage(네이티브 저장소)나 사용자 식별키는 이 permissions 배열이
   *   아니라 별도 브릿지 경로라 빈 배열이 정답.
   *
   * ★ 2026-08-25 정정 — 전면광고(IAA)를 붙였지만 permissions 는 «그대로 빈 배열»이다.
   *   광고는 권한 항목이 아니다. 실측 근거: 이미 광고로 «수익이 나고 있는» 게임 4종
   *   (네온 스레드·스모 바운스·프리즘 그리드·피고지고)의 granite.config.ts 가
   *   전부 permissions: [] 다. 지면 등록은 코드가 아니라 «콘솔»에서 한다
   *   (광고 핸드북 §1-5 — placement 가 null 이면 코드가 완벽해도 안 뜬다).
   *
   * ★ 옛 주석에 있던 「src/ 전체에 네트워크 요청이 0건」은 «더 이상 사실이 아니다».
   *   src/ads/ 가 앱스인토스 광고 브릿지를 쓴다. 다만 그 SDK 는 «동적 import» 라
   *   별도 청크로 분리되고, isInToss() 가 false 인 환경(GitHub Pages · MS Store PWA)
   *   에서는 «청크를 요청조차 하지 않는다» — 자세한 근거는 src/ads/adSdk.ts 머리말.
   *   ⇒ 스토어 신고서(store/MSSTORE_제출메모.txt · store/pwa/privacy.html ·
   *     index.html meta description)의 「광고 없음」 문구는 «AIT 판에 한해» 어긋난다.
   *     그 문서들은 이 레인의 소유가 아니라 «손대지 않았다». Partner 판단 대기 항목이다.
   */
  permissions: [],

  /**
   * webViewProps — ★ 게임 판정의 전부다.
   *
   *   type: 'game'
   *     CLI 가 `config.webViewProps?.type === 'game'` 로 isGame 을 판정하고
   *     그 값이 .ait 아티팩트 메타에 들어간다. 이게 없으면 게임 프레임으로
   *     안 뜬다.
   *
   *   나머지 값은 전부 "기본값이 게임에 해로운" 것들이라 명시적으로 끈다.
   *   ★ 이 게임은 **드래그(조이스틱/터치 포인터)로 뱀 머리를 조종**한다
   *     (src/input.ts — joystick/drag 두 방식 모두 포인터 이벤트 기반).
   *     가로 스와이프가 브라우저 뒤로가기/앞으로가기 제스처로 먹히면
   *     조작 중 화면이 이탈해버려 조종 불능 상태로 죽는다 — 다른 게임보다
   *     이 옵션이 더 치명적이다.
   *
   *     allowsInlineMediaPlayback: true       BGM/효과음이 전체화면으로 안 튀게
   *     mediaPlaybackRequiresUserAction: false  자동재생 차단 방지(입력 즉시 사운드)
   *     bounces: false                          iOS 고무줄 스크롤 차단(캔버스 튐 방지)
   *     pullToRefreshEnabled: false              당겨서 새로고침 차단(플레이 중 오작동)
   *     overScrollMode: 'never'                  Android 오버스크롤 글로우 차단
   *     allowsBackForwardNavigationGestures: false
   *       ★ 가장 중요 — 드래그 조종 게임에서 가로 스와이프가 이 제스처로
   *       해석되면 즉시 화면 이탈. 반드시 false.
   */
  webViewProps: {
    type: 'game',
    allowsInlineMediaPlayback: true,
    mediaPlaybackRequiresUserAction: false,
    bounces: false,
    pullToRefreshEnabled: false,
    overScrollMode: 'never',
    allowsBackForwardNavigationGestures: false,
  },

  /**
   * navigationBar — 빌드타임 고정값(런타임 API 없음). babelBuild 가
   *   JSON.stringify 해서 Ait.navigationBar 자리에 통째로 주입한다.
   *
   * theme — ★ 이 세션에서 직접 대비비를 계산해 정했다(임의값 아님).
   *   게임 배경 실측: src/ui/styles.css `html, body { background: #06070c; }`
   *   (스크림 등 다른 색이 아니라 body 배경 그 자체 — 게임 캔버스가 항상
   *   이 배경 위에서 시작·종료된다).
   *   후보 두 아이콘 색(@apps-in-toss/framework 문서 실측):
   *     light 테마 아이콘 = #191F28 (어두운 아이콘)
   *     dark  테마 아이콘 = #FFFFFF (흰 아이콘)
   *   WCAG 2.x 상대휘도 공식으로 이 세션에서 직접 계산한 대비비(배경 #06070c 기준):
   *     #FFFFFF on #06070c → L_bg ≈ 0.00217, 대비비 = (1.0+0.05)/(0.00217+0.05)
   *                           ≈ **20.13 : 1**  → PASS (WCAG AA 4.5:1, AAA 7:1 모두 통과)
   *     #191F28 on #06070c → L_fg ≈ 0.01341, 대비비 = (0.01341+0.05)/(0.00217+0.05)
   *                           ≈ **1.22 : 1**   → FAIL (일반 텍스트 기준 4.5:1에 크게 미달)
   *   결론: theme: 'dark'(흰 아이콘) 채택. light 테마는 사실상 아이콘이
   *   안 보이는 수준이라 선택지가 아니다. 배경이 라이트 톤으로 바뀌면
   *   이 값도 재계산해서 같이 뒤집어야 한다.
   *
   * withBackButton: true   — allowsBackForwardNavigationGestures:false 로
   *   시스템 스와이프 뒤로가기를 껐으므로, 이 버튼이 유일한 탈출구다.
   * withTitle: false       — 게임 자체 타이틀 화면(#app 안 .brand h1, 메뉴
   *   오버레이)이 있어 제목이 두 번 나오는 것 방지.
   * transparentBackground: false — 배경이 거의 완전한 근접-검정 단색
   *   (#06070c)이라 네비바와 자연스럽게 이어지고, 굳이 투명 처리로 얻는
   *   이득이 없다(투명 처리는 배경이 그라디언트/밝은 톤일 때 더 유효).
   *   실기기에서 끊김이 확인되면 재판단.
   */
  navigationBar: {
    withBackButton: true,
    withTitle: false,
    transparentBackground: false,
    theme: 'dark',
  },
});
