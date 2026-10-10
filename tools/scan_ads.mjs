#!/usr/bin/env node
/**
 * 광고 «지면 ID» 스캔 — 빌드 산출물(web/assets/*.js) 안의 adGroupId 리터럴을 라이브와 대조한다.
 *   node tools/scan_ads.mjs <newWebDir> <liveWebDir>
 * 양성대조: 라이브 번들 문자열에서 ID 한 글자를 바꾼 사본으로 «다름»이 검출되는지 같은 함수로 확인.
 * («0건은 부재의 증거가 아니다» — 지면 ID 패턴 ait.v2.(live|test).<hex> 이 라이브에서 «1개 이상» 잡혀야 검사가 유효하다.)
 *
 * ══ 2026-08-31 개정 (리워드 3종 신설) ═════════════════════════════════════
 *  전에는 「라이브와 «완전히 같은 집합»」이 합격 조건이었다. 그건 그래픽 레인의
 *  규칙이었고, 이 레인은 지면을 «의도적으로» 3개 늘린다. 그래서 규칙을 나눴다:
 *
 *    ① 라이브에 있던 ID 는 «개수까지 그대로» 있어야 한다.
 *       ⇒ 전면형(interstitial) 지면이 바뀌거나 사라지거나 늘어나면 FAIL.
 *    ② 새로 늘어난 ID 는 «허용 목록(ALLOWED_NEW)에 있는 것만», 그리고 «각 1회»만.
 *       ⇒ 오타·복사붙여넣기로 엉뚱한 지면이 들어가면 FAIL.
 *       ⇒ 같은 ID 가 두 곳에 박히면(정본 파일 밖으로 흩어지면) FAIL.
 *
 *  ★ ALLOWED_NEW 는 src/reward/adGroups.ts 의 정본과 «같아야» 한다.
 *    두 곳에 적는 것이 중복처럼 보이지만, 검사기가 피검사 대상에서 값을 읽어 오면
 *    「소스가 틀려도 검사가 통과하는」 죽은 검사기가 된다 — 그래서 여기 «따로» 적는다.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const RE = /ait\.v2\.(?:live|test)\.[0-9a-f]{16}/g;
function ids(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(js|html)$/.test(f.name)) {
        const s = readFileSync(p, 'utf8');
        for (const m of s.match(RE) || []) out.set(m, (out.get(m) || 0) + 1);
      }
    }
  };
  walk(dir);
  return out;
}
/** 이 레인이 «새로» 넣은 리워드 지면. src/reward/adGroups.ts 정본과 같아야 한다. */
const ALLOWED_NEW = new Map([
  ['ait.v2.live.XXXXXXXXXXXXXXXX', '리워드 부활'],
  ['ait.v2.live.XXXXXXXXXXXXXXXX', '리워드 시작 크기 부스트'],
  ['ait.v2.live.XXXXXXXXXXXXXXXX', '리워드 스킨 해금'],
  ['ait.v2.live.XXXXXXXXXXXXXXXX', '리워드 기록 돌파 보상'], // 2026-08-31 레인 5
  ['ait.v2.live.XXXXXXXXXXXXXXXX', '최고급 스킨 진행도'],     // 2026-09-02 레인 7 (REWARDED/MOMENT_VIDEO)
  ['ait.v2.live.XXXXXXXXXXXXXXXX', '리워드 결과 성장 2배'],   // 2026-09-10 레인 A (REWARDED, 2배권)
]);
/**
 * ★«없어야 하는» 지면(2026-09-10 레인 A). 시작 화면 배너(2026-09-02 레인 6)는 콘솔 노출 0회로 «코드에서 제거»했다.
 *   라이브(-48) 번들에는 아직 이 ID 가 있으므로 ①의 「라이브 지면 개수 유지」에서 «제외»하고, 새 번들에 «0회»여야 한다.
 *   ⛔이 목록에서 빼면 배너 코드가 되살아나도 검사가 조용히 통과한다 — 빼지 마라.
 */
const REMOVED = new Map([
  ['ait.v2.live.XXXXXXXXXXXXXXXX', '배너 시작 화면(제거됨)'],
]);
const [newDir, liveDir] = process.argv.slice(2);
const a = ids(newDir), b = ids(liveDir);
let fail = 0;
console.log('live :', [...b].map(([k, v]) => k + ' x' + v).join(', ') || '(none)');
console.log('new  :', [...a].map(([k, v]) => k + ' x' + v).join(', ') || '(none)');
if (b.size === 0) { console.log('live has 0 placement ids -> scanner invalid'); fail++; }
// ① 라이브 지면(전면형)은 개수까지 그대로여야 한다 — 제거 대상은 «0회»여야 한다.
for (const [k, v] of b) {
  if (REMOVED.has(k)) {
    if ((a.get(k) || 0) !== 0) { console.log('REMOVED placement still in bundle: ' + k + ' x' + a.get(k) + ' (' + REMOVED.get(k) + ')'); fail++; }
    else console.log('OK(removed) ' + k + '  ' + REMOVED.get(k) + ' — live x' + v + ' -> new x0');
    continue;
  }
  if (a.get(k) !== v) { console.log('MISMATCH(live placement changed) ' + k + ': live x' + v + ' new x' + (a.get(k) || 0)); fail++; }
}
for (const k of REMOVED.keys()) if (!b.has(k) && a.has(k)) { console.log('REMOVED placement in new: ' + k); fail++; }
// ② 새 지면은 허용 목록의 것만, 각각 «1회»만.
for (const [k, v] of a) {
  if (b.has(k)) continue;
  if (!ALLOWED_NEW.has(k)) { console.log('UNEXPECTED in new: ' + k); fail++; continue; }
  if (v !== 1) { console.log('DUPLICATED ' + k + ' x' + v + ' (' + ALLOWED_NEW.get(k) + ') - 지면 ID 는 adGroups.ts 한 곳에만 있어야 한다'); fail++; continue; }
  console.log('OK(new)  ' + k + '  ' + ALLOWED_NEW.get(k));
}
for (const k of ALLOWED_NEW.keys()) if (!a.has(k)) { console.log('MISSING(new placement not in bundle): ' + k + ' - 트리셰이킹으로 날아갔거나 배선이 안 됐다'); fail++; }
/* 양성대조 */
{
  const s = [...b.keys()][0] || 'ait.v2.live.XXXXXXXXXXXXXXXX';
  const tampered = new Map(b); tampered.delete(s); tampered.set(s.slice(0, -1) + (s.endsWith('0') ? '1' : '0'), 1);
  let det = 0; for (const [k, v] of b) if (tampered.get(k) !== v) det++;
  console.log('positive control (1 hex changed):', det ? 'DETECTED' : 'NOT DETECTED');
  if (!det) fail++;
}
console.log(fail ? 'RESULT: FAIL (' + fail + ')' : 'RESULT: PASS');
process.exit(fail ? 1 : 0);
