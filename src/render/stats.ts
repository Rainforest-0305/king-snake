// stats.ts — 프레임당 드로우 콜 계수(진단). 운영 경로 비용 = 정수 증가뿐.
//   뱀 60마리 x 세그먼트 수백 = 「총 드로우 콜」을 표로 내기 위한 계수기. __coilTimes 가 읽는다.

export const stats = {
  /** 몸통 스트로크(strokeTube 안 ctx.stroke 호출) */
  bodyStrokes: 0,
  /** 꼬리 폴리곤 fill */
  taperFills: 0,
  /** 머리(fill 묶음 1회로 센다) + LOD 로 생략한 머리 */
  heads: 0,
  headsLod: 0,
  /** 먹이 drawImage */
  orbImages: 0,
  /** 블룸 소스: 먹이 배치 fill(색당 1) / 부스트 스트로크 / 경계 */
  srcFills: 0,
  /** 파티클 도형 */
  particles: 0,
  /** 이름표 text 호출(stroke+fill) */
  labelTexts: 0,
  /** 이름표 font 변경 횟수 */
  fontSets: 0,
  /** 화면 밖이라 건너뛴 뱀·머리 */
  culledSnakes: 0,
  culledHeads: 0,
};

export function resetStats(): void {
  stats.bodyStrokes = 0;
  stats.taperFills = 0;
  stats.heads = 0;
  stats.headsLod = 0;
  stats.orbImages = 0;
  stats.srcFills = 0;
  stats.particles = 0;
  stats.labelTexts = 0;
  stats.fontSets = 0;
  stats.culledSnakes = 0;
  stats.culledHeads = 0;
}

export function totalDrawCalls(): number {
  return stats.bodyStrokes + stats.taperFills + stats.heads * 12 + stats.headsLod * 3 + stats.orbImages +
    stats.srcFills + stats.particles + stats.labelTexts;
}
