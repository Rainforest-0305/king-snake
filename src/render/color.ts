// color.ts — 색 유틸. ★ 결과를 «캐시»한다.
//
// 왜 캐시하나: 렌더 루프에서 lighten()/rgba() 를 부르면 뱀 26마리 x 패스 5개 x
// 60fps = 초당 8000번 문자열을 만든다. 만들어진 문자열은 전부 쓰레기가 되어
// GC 를 자극하고, 캔버스는 색 문자열을 파싱까지 한다. 조합 수는 수십 개뿐이라
// 캐시 한 장이면 사실상 0 이 된다.

const rgbCache = new Map<string, [number, number, number]>();

export function parseHex(hex: string): [number, number, number] {
  const hit = rgbCache.get(hex);
  if (hit) return hit;
  let h = hex.trim();
  if (h[0] === '#') h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  const out: [number, number, number] = Number.isFinite(n)
    ? [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    : [255, 255, 255];
  rgbCache.set(hex, out);
  return out;
}

const rgbaCache = new Map<string, string>();

/** hex + 알파 → 'rgba(...)'. */
export function rgba(hex: string, a: number): string {
  const key = hex + '|' + a.toFixed(3);
  const hit = rgbaCache.get(key);
  if (hit) return hit;
  const [r, g, b] = parseHex(hex);
  const s = 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  rgbaCache.set(key, s);
  return s;
}

const mixCache = new Map<string, string>();

/** hex 를 흰색 쪽으로 amt(0~1) 만큼 당긴다. */
export function lighten(hex: string, amt: number): string {
  const key = 'L' + hex + '|' + amt.toFixed(3);
  const hit = mixCache.get(key);
  if (hit) return hit;
  const [r, g, b] = parseHex(hex);
  const f = (v: number) => Math.round(v + (255 - v) * amt);
  const s = 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  mixCache.set(key, s);
  return s;
}

/** hex 를 검정 쪽으로 amt(0~1) 만큼 당긴다. */
export function darken(hex: string, amt: number): string {
  const key = 'D' + hex + '|' + amt.toFixed(3);
  const hit = mixCache.get(key);
  if (hit) return hit;
  const [r, g, b] = parseHex(hex);
  const f = (v: number) => Math.round(v * (1 - amt));
  const s = 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  mixCache.set(key, s);
  return s;
}
