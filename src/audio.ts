// audio.ts — 효과음. ★ 오디오 «파일»을 쓰지 않는다.
//
// 이유 두 가지:
//   1) 외부 네트워크 요청 0건이 스토어 제출 요건이다. 파일을 동봉하면 번들이 커지고,
//      라이선스 출처를 증명해야 한다. 합성음은 그 문제가 통째로 없다.
//   2) 이 게임의 소리는 짧은 «신호음»이면 충분하다.
//
// ═══ 2026-08-30 ZzFX 보강 ═══════════════════════════════════════════════════
//   기존 오실레이터 음(먹기·킬·사망·부스트 지속음)은 «유지»하고, 시작·버튼·충돌·해금 등
//   «형태가 있는» 소리는 ZzFX(Frank Force, MIT) 알고리즘을 인라인해 «버퍼로 한 번 합성»해 캐시한다.
//   생성기 한 함수(≈40줄)뿐이라 파일 0, 의존성 0. 키별 버퍼는 첫 재생 때 만들어 재사용한다.
//
// ★ AudioContext 는 «사용자 제스처» 뒤에만 재생된다. 첫 입력 때 unlock() 을 부른다.
// ★ 소리는 «게임을 막지 않는다». 어떤 실패도 조용히 삼킨다(try/catch).

/** ZzFX 파라미터(원본 순서). 값은 zzfx.3d.tools 규격 그대로. */
type Zz = [
  volume?: number, randomness?: number, frequency?: number, attack?: number, sustain?: number,
  release?: number, shape?: number, shapeCurve?: number, slide?: number, deltaSlide?: number,
  pitchJump?: number, pitchJumpTime?: number, repeatTime?: number, noise?: number, modulation?: number,
  bitCrush?: number, delay?: number, sustainVolume?: number, decay?: number, tremolo?: number,
];

/** ZzFX 샘플 생성기(MIT, Frank Force 2019) — 원본 알고리즘을 TypeScript 로 옮긴 것. */
function zzfxBuild(sr: number, p: Zz): Float32Array {
  let [volume = 1, randomness = 0.05, frequency = 220, attack = 0, sustain = 0, release = 0.1,
    shape = 0, shapeCurve = 1, slide = 0, deltaSlide = 0, pitchJump = 0, pitchJumpTime = 0,
    repeatTime = 0, noise = 0, modulation = 0, bitCrush = 0, delay = 0, sustainVolume = 1,
    decay = 0, tremolo = 0] = p;
  const PI2 = Math.PI * 2;
  const sign = (v: number): number => (v > 0 ? 1 : -1);
  const startSlide = (slide *= 500 * PI2 / sr / sr);
  let startFrequency = (frequency *= (1 + randomness * 2 * Math.random() - randomness) * PI2 / sr);
  let b: number[] = [];
  let t = 0;
  let tm = 0;
  let i = 0;
  let j = 1;
  let r = 0;
  let c = 0;
  let s = 0;
  let f: number;
  let length: number;
  attack = attack * sr + 9;
  decay *= sr;
  sustain *= sr;
  release *= sr;
  delay *= sr;
  deltaSlide *= 500 * PI2 / sr ** 3;
  modulation *= PI2 / sr;
  pitchJump *= PI2 / sr;
  pitchJumpTime *= sr;
  repeatTime = (repeatTime * sr) | 0;
  length = (attack + decay + sustain + release + delay) | 0;
  for (; i < length; b[i++] = s) {
    if (!(++c % ((bitCrush * 100) | 0))) {
      s = shape ? shape > 1 ? shape > 2 ? shape > 3
        ? Math.sin(t * t)
        : Math.max(Math.min(Math.tan(t), 1), -1)
        : 1 - (((2 * t / PI2) % 2 + 2) % 2)
        : 1 - 4 * Math.abs(Math.round(t / PI2) - t / PI2)
        : Math.sin(t);
      s = (repeatTime ? 1 - tremolo + tremolo * Math.sin(PI2 * i / repeatTime) : 1) *
        sign(s) * Math.abs(s) ** shapeCurve *
        volume * (i < attack ? i / attack
          : i < attack + decay ? 1 - ((i - attack) / decay) * (1 - sustainVolume)
            : i < attack + decay + sustain ? sustainVolume
              : i < length - delay ? (length - i - delay) / release * sustainVolume
                : 0);
      s = delay ? s / 2 + (delay > i ? 0 : (i < length - delay ? 1 : (length - i) / delay) *
        b[(i - delay) | 0] / 2) : s;
    }
    f = (frequency += slide += deltaSlide) * Math.cos(modulation * tm++);
    t += f - f * noise * (1 - (((Math.sin(i) + 1) * 1e9) % 2));
    if (j && ++j > pitchJumpTime) {
      frequency += pitchJump;
      startFrequency += pitchJump;
      j = 0;
    }
    if (repeatTime && !(++r % repeatTime)) {
      frequency = startFrequency;
      slide = startSlide;
      j = j || 1;
    }
  }
  return Float32Array.from(b);
}

/** 소리 사전. 이름 → ZzFX 파라미터. 값은 zzfx 툴에서 «귀로» 잡은 것. */
const ZZ: Record<string, Zz> = {
  start: [0.9, 0, 440, 0.01, 0.12, 0.22, 0, 1.6, 0, 0, 220, 0.06, 0, 0, 0, 0, 0, 0.7, 0.02],
  ui: [0.5, 0, 1200, 0, 0.02, 0.05, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.9, 0.01],
  crash: [1.2, 0.1, 90, 0.01, 0.12, 0.34, 3, 1.4, -6, 0, 0, 0, 0, 0.6, 0, 0.6, 0.02, 0.8, 0.04],
  unlock: [0.8, 0, 523, 0.01, 0.1, 0.3, 0, 1.2, 0, 0, 262, 0.08, 0.14, 0, 0, 0, 0, 0.8, 0.03],
  boostOn: [0.55, 0, 180, 0.02, 0.06, 0.18, 2, 1.8, 14, 0, 0, 0, 0, 0.2, 0, 0, 0, 0.6, 0.02],
};

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private boostOsc: OscillatorNode | null = null;
  private boostGain: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  enabled = true;

  /** 첫 사용자 제스처에서 호출. 두 번 이상 불려도 안전하다. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.35 : 0;
      this.master.connect(this.ctx.destination);
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.boost(false);
    if (this.master) this.master.gain.value = on ? 0.35 : 0;
  }

  private blip(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    try {
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch {
      /* 소리는 게임을 막지 않는다 */
    }
  }

  /** ZzFX 버퍼 재생(키별 캐시). */
  private zz(key: string, vol = 1): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    try {
      let buf = this.buffers.get(key);
      if (!buf) {
        const p = ZZ[key];
        if (!p) return;
        const data = zzfxBuild(this.ctx.sampleRate, p);
        buf = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
        buf.getChannelData(0).set(data);
        this.buffers.set(key, buf);
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = vol;
      src.connect(g).connect(this.master);
      src.start();
    } catch {
      /* noop */
    }
  }

  /** 오브 섭취. 가치가 클수록 높고 길게. */
  eat(value: number): void {
    const v = Math.min(1, value / 12);
    this.blip(520 + v * 460, 0.055 + v * 0.05, 'triangle', 0.06 + v * 0.08);
  }

  /** 킬. 상승 후 툭 끊기는 소리 — 「해냈다」. */
  kill(): void {
    this.blip(300, 0.16, 'square', 0.13, 900);
    window.setTimeout(() => this.blip(880, 0.1, 'triangle', 0.1, 1320), 70);
  }

  /** 사망. «충돌음»(노이즈 크래시) + 낮게 떨어지는 음. */
  death(): void {
    this.zz('crash', 0.9);
    this.blip(380, 0.5, 'sawtooth', 0.14, 60);
  }

  /** 판 시작. */
  start(): void {
    this.zz('start', 0.8);
  }

  /** 버튼·토글. 아주 짧다. */
  ui(): void {
    this.zz('ui', 0.5);
  }

  /** 스킨 해금(결과 화면). */
  unlockSkin(): void {
    this.zz('unlock', 0.8);
  }

  /** 부스트 지속음. on/off 를 반복해도 오실레이터는 하나만 유지한다. */
  boost(on: boolean): void {
    if (!this.ctx || !this.master) return;
    try {
      if (on) {
        if (!this.enabled || this.boostOsc) return;
        this.zz('boostOn', 0.5);
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(88, t);
        o.frequency.linearRampToValueAtTime(132, t + 0.35);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05, t + 0.05);
        o.connect(g).connect(this.master);
        o.start(t);
        this.boostOsc = o;
        this.boostGain = g;
      } else if (this.boostOsc && this.boostGain) {
        const t = this.ctx.currentTime;
        const o = this.boostOsc;
        this.boostGain.gain.cancelScheduledValues(t);
        this.boostGain.gain.setValueAtTime(Math.max(0.0001, this.boostGain.gain.value), t);
        this.boostGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
        o.stop(t + 0.1);
        this.boostOsc = null;
        this.boostGain = null;
      }
    } catch {
      this.boostOsc = null;
      this.boostGain = null;
    }
  }
}
