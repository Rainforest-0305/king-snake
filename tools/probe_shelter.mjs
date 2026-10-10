// probe_shelter.mjs — «자기 몸 엄폐»의 전제를 실측으로 검증한다.
//
// ★ 착수 «전»에 확인해야 하는 것 두 가지 (거짓이면 전술 자체가 성립 안 함)
//   ① 자기 트레일 위를 지나가도 «안 죽는다»
//      + 양성 대조: 남의 트레일 위에 놓으면 «죽는다»
//   ② 추격자가 그 몸에 «실제로 죽는다»
//
// ⛔코드 독해로는 부족하다. resolveCollisions 의 `owner === s.id` 를 읽어서
//   「안전할 것이다」로 넘어가면 그건 추정이다. 세계를 실제로 굴려서 본다.
//
// 사용: node tools/probe_shelter.mjs <bundle.mjs>
import { pathToFileURL } from 'node:url';

const [, , bundle] = process.argv;
const { World } = await import(pathToFileURL(bundle).href);
const DT = 1 / 60;

function fresh(seed = 20260818) {
  return new World(seed, 'QA', 'default', true);
}

/** 뱀 하나만 남기고 전부 치운다 — 다른 개체가 끼어들면 판정이 오염된다. */
function isolate(w, keepId) {
  for (const s of w.snakes) {
    if (s.id !== keepId) s.alive = false;
  }
}

/** 머리를 트레일의 i 번째 점 «바로 위»로 옮긴다. */
function headOnto(target, trailOwner, i) {
  target.x = trailOwner.trail.x(i);
  target.y = trailOwner.trail.y(i);
  target.ghostUntil = -1;          // 무적을 확실히 끈다
}

const out = {};

// ── ① 자기 트레일 위 — 죽지 «않아야» 한다 ─────────────────────────────────
{
  const w = fresh();
  const s = w.snakes.find((x) => !x.isPlayer);
  isolate(w, s.id);
  s.mass = 5000;
  s.updateDerived();
  // 트레일을 충분히 쌓는다.
  for (let i = 0; i < 240; i++) w.step(DT);
  const n = s.trail.count;
  const idx = Math.floor(n * 0.6);            // 머리에서 한참 뒤쪽
  const before = s.alive;
  const survived = [];
  for (let k = 0; k < 30; k++) {
    headOnto(s, s, idx);
    w.step(DT);
    survived.push(s.alive);
  }
  out.selfTrail = {
    trailPoints: n, testedIndex: idx, aliveBefore: before,
    aliveAfterAll: survived.every(Boolean),
    diedAtStep: survived.indexOf(false),
  };
}

// ── ①-대조 남의 트레일 위 — 죽어«야» 한다 ────────────────────────────────
{
  const w = fresh();
  const bots = w.snakes.filter((x) => !x.isPlayer);
  const a = bots[0];
  const b = bots[1];
  for (const s of w.snakes) if (s.id !== a.id && s.id !== b.id) s.alive = false;
  a.mass = 5000; a.updateDerived();
  b.mass = 5000; b.updateDerived();
  for (let i = 0; i < 240; i++) w.step(DT);
  const idx = Math.floor(b.trail.count * 0.6);
  headOnto(a, b, idx);
  w.step(DT);
  out.otherTrail = {
    victimAliveAfter: a.alive,
    expectDead: true,
    verdict: a.alive ? 'FAIL 남의 몸에 넣었는데 안 죽었다 = 검사기가 고장' : 'OK 죽었다',
  };
}

// ── ② 추격자가 그 몸에 죽는가 ────────────────────────────────────────────
//   큰 뱀의 «몸통 중간»으로 작은 추격자를 밀어 넣는다. 실제 추격 상황의 핵심이다.
{
  const w = fresh();
  const bots = w.snakes.filter((x) => !x.isPlayer);
  const big = bots[0];
  const chaser = bots[1];
  for (const s of w.snakes) if (s.id !== big.id && s.id !== chaser.id) s.alive = false;
  big.mass = 6000; big.updateDerived();
  chaser.mass = 300; chaser.updateDerived();
  for (let i = 0; i < 240; i++) w.step(DT);
  const idx = Math.floor(big.trail.count * 0.5);
  headOnto(chaser, big, idx);
  w.step(DT);
  out.chaserDies = {
    chaserAliveAfter: chaser.alive,
    bigAliveAfter: big.alive,
    verdict: chaser.alive ? 'FAIL 추격자가 안 죽는다 = 엄폐에 효과가 없다'
      : 'OK 추격자가 죽는다 = 엄폐가 무기가 된다',
  };
}

// ── ③ 「똬리」가 물리적으로 가능한가 — 최소 회전 반경 안에서 자기 몸에 닿는가 ─
//   회전 반경 102 짜리가 실제로 자기 트레일 근처까지 말 수 있는지 본다.
{
  const w = fresh();
  const s = w.snakes.find((x) => !x.isPlayer);
  isolate(w, s.id);
  s.mass = 5000;
  s.updateDerived();
  for (let i = 0; i < 120; i++) w.step(DT);
  let minSelfDist = Infinity;
  // 한쪽으로 «계속» 꺾게 만든다 = 최대 선회.
  for (let i = 0; i < 600; i++) {
    s.targetAngle = s.angle + 1.2;
    w.step(DT);
    if (!s.alive) break;
    const n = s.trail.count;
    for (let k = Math.floor(n * 0.25); k < n; k++) {
      const dx = s.trail.x(k) - s.x;
      const dy = s.trail.y(k) - s.y;
      const d = Math.hypot(dx, dy);
      if (d < minSelfDist) minSelfDist = d;
    }
  }
  out.coil = {
    aliveAfterCoiling: s.alive,
    minDistToOwnTrail: Math.round(minSelfDist),
    bodyRadius: Math.round(s.radius),
    verdict: s.alive ? 'OK 자기 몸으로 말아도 안 죽는다' : 'FAIL 똬리를 틀다 죽었다',
  };
}

console.log(JSON.stringify(out, null, 1));
