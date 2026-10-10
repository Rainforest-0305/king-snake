// post.ts — 블룸 후처리 레이어(WebGL). 2026-08-30 그래픽 개선 · 같은 날 iOS 최적화 2판.
//
// ═══ 2판(iOS) 구조 ═══════════════════════════════════════════════════════════════
//   1판은 «세계 전체»를 오프스크린 2D 캔버스에 그리고 그 비트맵(780x1688)을 매 프레임 텍스처로 올려
//   GL 캔버스가 세계를 «보여줬다». iOS WebKit 에서 풀프레임 texSubImage2D 는 가장 비싼 경로다
//   (President 실기기: 뱀 키우기 iOS 프레임 저하). 2판은 업로드 픽셀을 1/7 이하로 줄인다:
//     · 세계는 «#world 2D 캔버스»(불투명, 월드 DPR ≤ 1.5)에 그대로 그린다 — 업로드 0.
//     · 블룸 «대상»(먹이 코어·부스트 맥동·경계 링)만 «작은 오프스크린»(월드 해상도의 1/2)에 «같은 프레임 안에서»
//       한 번 더 그린다(지연 0) → 그 작은 캔버스만 업로드 → bright-pass(soft-knee) → 1/2 → 1/4 블러 2겹 →
//       투명 GL 캔버스(#glow, #world «위»·#stage «아래», pointer-events:none)에 «가산»(mix-blend-mode: plus-lighter,
//       미지원 브라우저는 premultiplied source-over ≈ screen)으로 합성한다.
//   #stage(입력 캔버스)는 크기·이벤트·레이어 «무접촉». 이름표·미니맵·조이스틱만 담는다 — 글자는 번지지 않는다.
//
// ★ 네온 스레드 2차 교훈(iPhone DPR3) 그대로: 블룸 소스는 «1/2 해상도부터»(작은 광점 깜빡임 방지),
//   동적 품질은 거버너(quality.ts) 한 곳(히스테리시스·크로스페이드 mix·불가역 off). 여기엔 판정이 없다.
//   Q1 은 와이드(1/8) 단계를 «건너뛴다»(k2=0) — 캔버스·FBO 크기는 플레이 중 안 바뀐다.
//
// ★ WebGL 이 없거나(구형 WebView) 컨텍스트를 잃으면 init() 이 false 를 돌려주고 렌더러는
//   폴백(가산 글로우·할로 스프라이트)으로 그린다. 어느 쪽도 게임 판정과 무관하다.

/* iOS(fp16) 방어: highp 가 되는 곳에선 highp. 텍스처 좌표 오차가 텍셀 경계를 넘나들면 그 자체가 깜빡임이다. */
const PREC = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
const VS = 'attribute vec2 a;varying vec2 v;void main(){v=a*.5+.5;gl_Position=vec4(a,0.,1.);}';
/*
 * bright pass(soft-knee) — ★ 네온 깜빡임 원인 확정(2026-08-30 실측)의 수정 규격:
 *   문턱은 «다운샘플 전 텍셀 각각»에 건다. 평균 뒤에 문턱을 걸면 얇은 테두리(2~4텍셀)가 블록 경계에 걸리는
 *   위상마다 블록 휘도가 문턱을 넘나들어 스크롤 시 블룸이 켜졌다 꺼졌다 한다(8프레임 max/min 54x).
 *   여기서는 소스(월드 1/2)와 h FBO 가 «1:1» 이라 탭 1개 = 텍셀 1개(NEAREST). 그 뒤 FS_DOWN 이 «문턱을 지난 값»을
 *   평균한다 = 면적 비례·위상 무관. 캔버스 업로드는 위가 0행, GL 프레임버퍼는 아래가 0행이라 (v.x, 1-v.y) 로 한 번만 뒤집는다.
 */
const FS_BRIGHT = PREC +
  'varying vec2 v;uniform sampler2D s;uniform float thr;uniform float knee;' +
  'void main(){vec2 u=vec2(v.x,1.-v.y);vec3 c=texture2D(s,u).rgb;' +
  'float l=dot(c,vec3(.2126,.7152,.0722));float k=clamp((l-thr)/knee,0.,1.);k=k*k*(3.-2.*k);gl_FragColor=vec4(c*k,1.);}';
/* ★ 진단 전용(?bright=legacy): 1판 «평균 뒤 문턱» — 깜빡임 A/B 대조군. 운영 경로에서 안 쓴다. */
const FS_BRIGHT_LEGACY = PREC +
  'varying vec2 v;uniform sampler2D s;uniform vec2 px;uniform float thr;uniform float knee;' +
  'void main(){vec2 u=vec2(v.x,1.-v.y);vec3 c=(texture2D(s,u+px*vec2(-.5,-.5)).rgb+texture2D(s,u+px*vec2(.5,-.5)).rgb+texture2D(s,u+px*vec2(-.5,.5)).rgb+texture2D(s,u+px*vec2(.5,.5)).rgb)*.25;' +
  'float l=dot(c,vec3(.2126,.7152,.0722));float k=clamp((l-thr)/knee,0.,1.);k=k*k*(3.-2.*k);gl_FragColor=vec4(c*k,1.);}';
/* 2x2 bilinear downsample */
const FS_DOWN = PREC +
  'varying vec2 v;uniform sampler2D s;uniform vec2 px;' +
  'void main(){vec3 c=(texture2D(s,v+px*vec2(-.5,-.5)).rgb+texture2D(s,v+px*vec2(.5,-.5)).rgb+texture2D(s,v+px*vec2(-.5,.5)).rgb+texture2D(s,v+px*vec2(.5,.5)).rgb)*.25;gl_FragColor=vec4(c,1.);}';
/* separable gaussian, 5 linear taps (= 9 texel) */
const FS_BLUR = PREC +
  'varying vec2 v;uniform sampler2D s;uniform vec2 d;' +
  'void main(){vec3 c=texture2D(s,v).rgb*.2270270270;' +
  'c+=(texture2D(s,v+d*1.3846153846).rgb+texture2D(s,v-d*1.3846153846).rgb)*.3162162162;' +
  'c+=(texture2D(s,v+d*3.2307692308).rgb+texture2D(s,v-d*3.2307692308).rgb)*.0702702703;gl_FragColor=vec4(c,1.);}';
/* 합성: 할로만 출력. premultiplied(alpha = max 채널) — plus-lighter 면 가산, 아니면 source-over ≈ screen. */
const FS_COMP = PREC +
  'varying vec2 v;uniform sampler2D b1;uniform sampler2D b2;uniform float k1;uniform float k2;uniform float mx;' +
  'void main(){vec3 c=min((texture2D(b1,v).rgb*k1+texture2D(b2,v).rgb*k2)*mx,1.);gl_FragColor=vec4(c,max(c.r,max(c.g,c.b)));}';

interface Prog { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }
interface Fbo { f: WebGLFramebuffer; t: WebGLTexture; w: number; h: number }

/** 블룸 강도 — DESIGN.md «글로우 규칙»의 단일 소스. */
export const BLOOM = {
  /** 소스 캔버스엔 «블룸 대상만» 있다 — 문턱은 색 코어(비백색)도 잡을 만큼 낮추되 soft-knee 로 부드럽게. */
  threshold: 0.50,
  knee: 0.30,
  /** 1/4 해상도(타이트, 뜨거운 가장자리) */
  tight: 0.50,
  /** 1/8 해상도(와이드, 헤일로) */
  wide: 0.38,
};

export class Post {
  supported = false;
  on = false;
  /** 0 = 1/2 → 1/4 → 1/8, 1 = 1/8(와이드) 생략. 거버너(quality.ts)가 프레임마다 놓는다. */
  quality: 0 | 1 = 0;
  /** 블룸 강도 배율 0..1 — 거버너의 크로스페이드(단계 전환 시 30% 딥 / off 전환 시 1→0 램프). */
  mix = 1;
  /** 거버너가 T3(불가역 off)로 껐다. */
  autoOff = false;
  lost = false;
  /** 컨텍스트를 잃은 총 횟수(진단용). */
  lostCount = 0;
  /** «직전 복구 직후» 또 잃은 횟수 = 반복 고장의 지표. */
  churn = 0;
  /** 마지막 복구 시각(ms). 0 = 아직 복구된 적 없음. */
  private lastRestore = 0;
  /** 이 시간 안에 또 잃으면 「반복」으로 센다(ms). */
  private static readonly CHURN_MS = 20000;
  /** 반복이 이만큼 쌓이면 블룸을 영구히 끈다. */
  private static readonly CHURN_MAX = 2;
  frames = 0;
  /** 진단: 마지막 프레임 업로드 픽셀 수(소스 캔버스). */
  uploadPx = 0;
  /** 진단 전용(?bright=legacy): 1판 bright-pass(평균 뒤 문턱) — 깜빡임 A/B. */
  legacyBright = false;
  private energyBuf: Uint8Array | null = null;
  readonly glc: HTMLCanvasElement | null = null;

  private gl: WebGLRenderingContext | null = null;
  private src: HTMLCanvasElement | null = null;
  private sctx: CanvasRenderingContext2D | null = null;
  private prog: Record<string, Prog> = {};
  private fbo: Record<string, Fbo | undefined> = {};
  private srcTex: WebGLTexture | null = null;
  private SW = 0;
  private SH = 0;
  private uploaded = false;

  /**
   * @param stage 입력 캔버스(#stage). 이 «앞»(DOM 순서상 이전 = 화면상 아래)에 GL 캔버스를 끼운다. stage 자체는 건드리지 않는다.
   * @returns 블룸 사용 가능 여부. false 면 호출자는 폴백 경로로 간다.
   */
  init(stage: HTMLCanvasElement): boolean {
    try {
      if (typeof window === 'undefined' || !('WebGLRenderingContext' in window)) return false;
      if (/[?&]bloom=off\b/.test(location.search)) return false;
      this.legacyBright = /[?&]bright=legacy\b/.test(location.search);
      const glc = document.createElement('canvas');
      glc.id = 'glow';
      glc.setAttribute('aria-hidden', 'true');
      glc.style.cssText =
        'position:fixed;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:0;' +
        'mix-blend-mode:plus-lighter';
      const attrs: WebGLContextAttributes = {
        alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
        preserveDrawingBuffer: false, powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: false,
      };
      const gl = (glc.getContext('webgl', attrs) ||
        glc.getContext('experimental-webgl', attrs)) as WebGLRenderingContext | null;
      if (!gl) return false;
      this.gl = gl;
      (this as { glc: HTMLCanvasElement | null }).glc = glc;
      this.buildPrograms();
      this.src = document.createElement('canvas');
      this.sctx = this.src.getContext('2d', { alpha: false });
      if (!this.sctx) return false;
      const parent = stage.parentNode;
      if (!parent) return false;
      parent.insertBefore(glc, stage);
      /**
       * ═══════════════════════════════════════════════════════════════════
       * ★ 2026-09-04 — 「초거대 뱀이 사라졌다 나타났다」의 유력 기전 차단.
       *
       *   President 실기기 보고: 「초거대 뱀은 사라졌다 나타났다 그러고」.
       *   컬링은 무죄다(코드 3경로 전부 확인):
       *     · 몸통 컬링은 «실제» bodyLen 을 쓰고, trail 은 trimTo(bodyPointCount)
       *       로 그 길이에 맞춰 잘린다 — 둘이 어긋날 수 없다.
       *     · 머리 컬링은 머리 스프라이트에만 걸린다.
       *     · 봇 despawn/sleep 시스템은 «없다»(죽어야 리스폰).
       *
       *   대신 여기가 문제다. 컨텍스트를 잃으면 이 글로우 캔버스가 통째로
       *   `visibility:hidden` 이 되고, 복구되면 다시 보인다. 그리고
       *   index.ts 의 `lean = bloom || autoOff` 가 뒤집히면서 snakeRender 의
       *   그리기 방식이 «크게» 바뀐다(할로 조건·꼬리 글로우 on/off·
       *   테이퍼 알파 0.08 ↔ 0.30 = 약 3배). 그 차이는 «몸이 가장 긴 뱀»에서
       *   가장 크게 보인다 = 초거대 뱀이 깜빡이는 것으로 읽힌다.
       *
       *   ⛔옛 코드에는 이 사이클에 «상한이 없었다». 기기가 계속 컨텍스트를
       *     떨구면(iOS 메모리 압박 — 맵 3.6배 확장으로 더 쉬워졌다) 영원히
       *     껐다 켰다를 반복한다.
       *
       * ★ 그래서 «잦은» 손실만 센다. 앱 전환처럼 «드문» 손실 한두 번으로
       *   블룸을 영구히 끄면 멀쩡한 기기의 화질을 공짜로 버리는 셈이다.
       *   직전 복구로부터 CHURN_MS 안에 또 잃으면 그때만 「churn」으로 세고,
       *   CHURN_MAX 번이면 autoOff 로 «한 방향» 확정한다.
       *   autoOff 는 이미 있는 개념이다(T3 강등 — 불가역). 그 상태로 가면
       *   lean 이 true 로 «고정»되므로 더는 뒤집히지 않는다 = 깜빡임 종료.
       * ═══════════════════════════════════════════════════════════════════
       */
      glc.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (this.lastRestore > 0 && now - this.lastRestore < Post.CHURN_MS) {
          this.churn++;
        }
        this.lostCount++;
        this.lost = true;
        this.on = false;
        glc.style.visibility = 'hidden';
      }, false);
      glc.addEventListener('webglcontextrestored', () => {
        try {
          this.prog = {};
          this.fbo = {};
          this.srcTex = null;
          this.buildPrograms();
          this.SW = 0;
          this.lost = false;
          this.lastRestore =
            typeof performance !== 'undefined' ? performance.now() : Date.now();
          // ★ 반복이 확인되면 되살리지 «않는다». 깜빡임보다 「계속 꺼짐」이 낫다.
          if (this.churn >= Post.CHURN_MAX) this.autoOff = true;
          this.setEnabled(!this.autoOff);
        } catch {
          this.lost = true;
        }
      }, false);
      this.supported = true;
      this.on = true;
      return true;
    } catch (e) {
      try { console.warn('[king-snake/post] disabled:', e instanceof Error ? e.message : e); } catch { /* noop */ }
      this.supported = false;
      this.on = false;
      return false;
    }
  }

  private buildPrograms(): void {
    const gl = this.gl!;
    this.prog.bright = this.link(this.legacyBright ? FS_BRIGHT_LEGACY : FS_BRIGHT);
    this.prog.down = this.link(FS_DOWN);
    this.prog.blur = this.link(FS_BLUR);
    this.prog.comp = this.link(FS_COMP);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    // 소스는 불투명(alpha:false)이라 premultiply 여부가 결과를 바꾸지 않는다. true = Chrome 의 캔버스→텍스처 GPU 복사 경로 조건.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl!;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(sh));
    return sh;
  }

  private link(fs: string): Prog {
    const gl = this.gl!;
    const p = gl.createProgram()!;
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'a');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u: Record<string, WebGLUniformLocation | null> = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const inf = gl.getActiveUniform(p, i);
      if (inf) u[inf.name] = gl.getUniformLocation(p, inf.name);
    }
    return { p, u };
  }

  private makeTex(w: number, h: number): WebGLTexture {
    const gl = this.gl!;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (w) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }

  private makeFbo(w: number, h: number): Fbo {
    const gl = this.gl!;
    const t = this.makeTex(w, h);
    const f = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) throw new Error('fbo incomplete');
    return { f, t, w, h };
  }

  private delFbo(o: Fbo | undefined): void {
    if (!o) return;
    this.gl!.deleteFramebuffer(o.f);
    this.gl!.deleteTexture(o.t);
  }

  /** 소스(=1/2 월드) 크기로 피라미드를 잡는다: h = 소스, a1/b1 = 1/2 소스(=1/4 월드), a2/b2 = 1/4 소스(=1/8 월드). */
  private alloc(SW: number, SH: number): void {
    const gl = this.gl!;
    const d = (k: number) => Math.max(1, Math.ceil(SW / k));
    const e = (k: number) => Math.max(1, Math.ceil(SH / k));
    for (const k of ['h', 'a1', 'b1', 'a2', 'b2']) this.delFbo(this.fbo[k]);
    this.fbo.h = this.makeFbo(d(1), e(1));
    this.fbo.a1 = this.makeFbo(d(2), e(2));
    this.fbo.b1 = this.makeFbo(d(2), e(2));
    this.fbo.a2 = this.makeFbo(d(4), e(4));
    this.fbo.b2 = this.makeFbo(d(4), e(4));
    if (this.srcTex) gl.deleteTexture(this.srcTex);
    this.srcTex = this.makeTex(0, 0);
    // 소스는 h FBO 와 1:1 — 탭 1개가 정확히 텍셀 1개를 읽어야 «텍셀마다 문턱»이 성립한다.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.uploaded = false;
    this.SW = SW;
    this.SH = SH;
  }

  private pass(pr: Prog, target: Fbo | null, bind: (u: Record<string, WebGLUniformLocation | null>) => void): void {
    const gl = this.gl!;
    gl.useProgram(pr.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.f : null);
    gl.viewport(0, 0, target ? target.w : this.glc!.width, target ? target.h : this.glc!.height);
    bind(pr.u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private tex(unit: number, t: WebGLTexture): void {
    const gl = this.gl!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
  }

  /**
   * 프레임: 블룸 «소스» 2D 컨텍스트를 돌려준다(검게 지워진 상태, 변환 = 소스px/CSSpx). 꺼져 있으면 null.
   * @param sw,sh 소스 백킹 픽셀(월드의 1/2)  @param gw,gh GL 캔버스 백킹 픽셀  @param k 소스 픽셀 / CSS 픽셀
   * 크기는 판 사이에서만 바뀐다(main.ts 적응형 해상도 규율) — 플레이 중 재할당 0.
   */
  begin(sw: number, sh: number, gw: number, gh: number, k: number): CanvasRenderingContext2D | null {
    if (!this.supported || !this.on || this.lost || !this.src || !this.sctx || !this.glc) return null;
    const SW = Math.max(1, sw);
    const SH = Math.max(1, sh);
    if (this.src.width !== SW || this.src.height !== SH) {
      this.src.width = SW;
      this.src.height = SH;
    }
    if (this.glc.width !== gw || this.glc.height !== gh) {
      this.glc.width = gw;
      this.glc.height = gh;
    }
    if (this.SW !== SW || this.SH !== SH) this.alloc(SW, SH);
    const c = this.sctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#000';
    c.fillRect(0, 0, SW, SH);
    c.setTransform(k, 0, 0, k, 0, 0);
    return c;
  }

  /** 프레임 끝: 소스 업로드 → bright → 1/2·1/4 블러 → 할로 합성. 게임 루프 안에서 «동기» 호출. */
  end(): void {
    if (!this.supported || !this.on || this.lost || !this.gl || !this.srcTex) return;
    const gl = this.gl;
    const SW = this.SW;
    const SH = this.SH;
    this.tex(0, this.srcTex);
    if (!this.uploaded) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.src!);
      this.uploaded = true;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.src!);
    }
    this.uploadPx = SW * SH;
    const h = this.fbo.h!;
    const a1 = this.fbo.a1!;
    const b1 = this.fbo.b1!;
    const a2 = this.fbo.a2!;
    const b2 = this.fbo.b2!;
    const st = this.srcTex;
    this.pass(this.prog.bright, h, (u) => {
      this.tex(0, st); gl.uniform1i(u.s, 0);
      if (u.px) gl.uniform2f(u.px, 1 / SW, 1 / SH);
      gl.uniform1f(u.thr, BLOOM.threshold); gl.uniform1f(u.knee, BLOOM.knee);
    });
    this.pass(this.prog.down, a1, (u) => { this.tex(0, h.t); gl.uniform1i(u.s, 0); gl.uniform2f(u.px, 1 / h.w, 1 / h.h); });
    this.pass(this.prog.blur, b1, (u) => { this.tex(0, a1.t); gl.uniform1i(u.s, 0); gl.uniform2f(u.d, 1 / a1.w, 0); });
    this.pass(this.prog.blur, a1, (u) => { this.tex(0, b1.t); gl.uniform1i(u.s, 0); gl.uniform2f(u.d, 0, 1 / a1.h); });
    const wide = this.quality === 0;
    if (wide) {
      this.pass(this.prog.down, a2, (u) => { this.tex(0, a1.t); gl.uniform1i(u.s, 0); gl.uniform2f(u.px, 1 / a1.w, 1 / a1.h); });
      this.pass(this.prog.blur, b2, (u) => { this.tex(0, a2.t); gl.uniform1i(u.s, 0); gl.uniform2f(u.d, 1 / a2.w, 0); });
      this.pass(this.prog.blur, a2, (u) => { this.tex(0, b2.t); gl.uniform1i(u.s, 0); gl.uniform2f(u.d, 0, 1 / a2.h); });
    }
    this.pass(this.prog.comp, null, (u) => {
      this.tex(1, a1.t); this.tex(2, a2.t);
      gl.uniform1i(u.b1, 1); gl.uniform1i(u.b2, 2);
      // Q1: 와이드 층을 빼되 타이트를 조금 키워 «총 밝기»를 비슷하게(전환은 거버너 mix 딥이 가린다).
      gl.uniform1f(u.k1, wide ? BLOOM.tight : BLOOM.tight * 1.35); gl.uniform1f(u.k2, wide ? BLOOM.wide : 0);
      gl.uniform1f(u.mx, this.mix);
    });
    this.frames++;
  }

  /**
   * 진단 전용(깜빡임 프로브): 타이트 블러(a1, 1/4 월드) FBO 의 휘도 합. readPixels = GPU 동기화 — 운영 경로에서 절대 안 부른다.
   */
  energy(): number {
    if (!this.gl || !this.fbo.a1 || !this.on) return -1;
    const gl = this.gl;
    const a1 = this.fbo.a1;
    const n = a1.w * a1.h * 4;
    if (!this.energyBuf || this.energyBuf.length !== n) this.energyBuf = new Uint8Array(n);
    gl.bindFramebuffer(gl.FRAMEBUFFER, a1.f);
    gl.readPixels(0, 0, a1.w, a1.h, gl.RGBA, gl.UNSIGNED_BYTE, this.energyBuf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let sum = 0;
    const b = this.energyBuf;
    for (let i = 0; i < n; i += 4) sum += b[i] * 0.2126 + b[i + 1] * 0.7152 + b[i + 2] * 0.0722;
    return sum;
  }

  setEnabled(v: boolean): void {
    if (!this.supported) return;
    this.on = v && !this.lost;
    if (this.glc) this.glc.style.visibility = this.on ? 'visible' : 'hidden';
  }
}
