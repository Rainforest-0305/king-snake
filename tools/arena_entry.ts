// arena_entry.ts — 브라우저 없는 시뮬 번들의 진입점(esbuild 용, qa_arena.mjs 전용).
//
// sim_entry.ts 와 같은 목적이되 «봇 전술 계측기»(__botDebug)까지 내보낸다.
// ★sim_entry.ts 를 «고치지 않고» 새로 만든 이유: qa_spawn_dist.mjs 가 그 파일을
//   쓰고 있어서, 내보내기를 늘리면 그 검사기의 기대 표면이 조용히 바뀐다.
export { World } from '../src/game/world';
export * as __cfg from '../src/game/config';
export { __botDebug } from '../src/game/bots';
