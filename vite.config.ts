import { defineConfig } from 'vite';

/**
 * Coil Rush — 빌드 설정.
 *
 * ★ base: './' 반드시 상대경로.
 *   1) GitHub Pages 는 rainforest-0305.github.io/coil-rush/ 처럼 «서브패스»에 올라간다.
 *      절대경로('/')면 /assets/... 를 찾다가 404 → 흰 화면.
 *   2) .ait(앱스인토스) 는 웹 산출물을 web/ 하위로 zip 해 임의 origin 에서 연다.
 *      역시 절대경로면 자산 404.
 *   3) PWABuilder 가 만드는 MSIX 도 로컬 origin 이라 상대경로가 안전하다.
 *   세 경로 전부 상대경로를 요구하므로 './' 가 유일한 정답이다.
 *   (선례: territory-clash/vite.config.ts 의 base 주석 — 같은 결론)
 *
 * ★ target es2019
 *   앱스인토스는 RN 0.72.6 런타임(구형 안드로이드 WebView)에서도 떠야 한다.
 *   최신 문법을 그대로 내보내면 구형 WebView 가 SyntaxError 로 흰 화면이 된다.
 *
 * ★ 외부 네트워크 요청 0건이 스토어 요건이다.
 *   폰트는 system-ui 스택만 쓰고(웹폰트 로드 없음), 이미지는 전부 코드 생성이다.
 *   modulePreload 폴리필도 끈다 — 하는 일이 없는데 번들에 fetch( 호출을
 *   남겨 「네트워크 전송 코드」로 읽히는 것을 피한다(territory-clash 선례).
 */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2019',
    sourcemap: false,
    modulePreload: { polyfill: false },
    cssCodeSplit: false,
    assetsInlineLimit: 8192,
    rollupOptions: {
      output: { manualChunks: undefined },
    },
  },
  server: {
    port: 5190,
    host: 'localhost',
  },
  preview: {
    port: 4190,
    host: 'localhost',
  },
});
