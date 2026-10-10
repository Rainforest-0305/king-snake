// sim_entry.ts - 브라우저 없는 시뮬 번들의 진입점(esbuild 용).
// World 와 함께 config 상수를 __cfg 로 노출한다 - 검사기(qa_spawn_dist.mjs)가
// 문턱을 «상수에서 유도»하려면 번들 안의 실제 값을 읽어야 한다.
export { World } from '../src/game/world';
export * as __cfg from '../src/game/config';
