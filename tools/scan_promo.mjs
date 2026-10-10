#!/usr/bin/env node
/**
 * .ait / dist 정적 검사 — 프로모션 「블랙맘바 해금하기」가 «산출물에 실렸는가». (2026-09-01)
 *
 *   node tools/scan_promo.mjs <file.ait|dir> [--mode canon|testonly]
 *
 * 왜 필요한가: 소스가 맞아도 «번들러가 지워버리면» 아무 일도 안 일어난다
 * (08-11 광고 실사고: 상수접기로 호출 블록이 통째로 삭제됐다). 그래서 소스가 아니라
 * «출고물»에서 코드 문자열·브릿지 이름·판정 로직 흔적을 «직접» 센다.
 *
 * ★2층 양성대조 — 「0건은 부재의 증거가 아니다」
 *   L2 는 산출물 사본을 «일부러 망가뜨려» 이 검사기가 잡는지 먼저 증명한다.
 *   (코드 문자열 제거 / 접두 변조 / grant 호출 제거 / 기준선 필드 제거)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CODE = '__PROMOTION_CODE__';
const AMOUNT = '500';

const target = process.argv[2];
const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'canon';
if (!target) {
  console.error('usage: scan_promo.mjs <file.ait|dir> [--mode canon|testonly]');
  process.exit(2);
}

/** .ait 는 zip 이다. Node 기본 모듈에 unzip 이 없어 python 으로 web/ 만 뽑는다. */
function readAitWeb(ait) {
  const py = `
import zipfile,sys,json
z=zipfile.ZipFile(sys.argv[1])
out={}
for n in z.namelist():
    if n.startswith('web/') and (n.endswith('.js') or n.endswith('.html')):
        out[n]=z.read(n).decode('utf-8','replace')
sys.stdout.write(json.dumps(out))
`;
  const raw = execFileSync('python', ['-c', py, ait], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8');
  return JSON.parse(raw);
}

function readDir(dir) {
  const out = {};
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js') || p.endsWith('.html')) out[p] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

const files = statSync(target).isDirectory() ? readDir(target) : readAitWeb(target);
const n = (s, a) => s.split(a).length - 1;

/** 산출물 전체에서 세어야 할 지표. */
function measure(fs) {
  let bare = 0, test = 0, grant = 0, legacy = 0, baseline = 0, owned = 0, amount = 0, key = 0;
  for (const [, s] of Object.entries(fs)) {
    // ★bare = TEST_ 접두가 «붙지 않은» 코드. 단순히 CODE 를 세면 TEST_CODE 도 잡힌다(함정).
    bare += n(s, CODE) - n(s, 'TEST_' + CODE);
    test += n(s, 'TEST_' + CODE);
    grant += n(s, 'grantPromotionReward');
    legacy += n(s, 'grantPromotionRewardForGame');
    baseline += n(s, 'baselineAt');
    owned += n(s, 'ownedAtBaseline');
    amount += n(s, AMOUNT);
    key += n(s, 'king-snake.promo.v1:');
  }
  return { bare, test, grant, legacy, baseline, owned, amount, key };
}

const errs = [];
function check(m, label) {
  const e = [];
  if (mode === 'canon') {
    if (m.bare < 1) e.push('정본인데 bare 코드 0건 — 번들에서 사라졌다');
    if (m.test !== 0) e.push(`정본에 TEST_ 코드 ${m.test}건 — 검수 사고`);
  } else {
    if (m.test < 1) e.push('TESTONLY 인데 TEST_ 코드 0건');
    if (m.bare !== 0) e.push(`TESTONLY 에 bare 코드 ${m.bare}건`);
  }
  if (m.grant < 1) e.push('grantPromotionReward 호출 흔적 0건');
  if (m.legacy < 1) e.push('레거시 폴백(grantPromotionRewardForGame) 흔적 0건');
  if (m.baseline < 1) e.push('★기준선 필드(baselineAt) 0건 — 「이미 달성자 제외」가 사라졌다');
  if (m.owned < 1) e.push('★기준선 필드(ownedAtBaseline) 0건');
  if (m.key < 1) e.push('코드별 기록 키 접두 0건');
  if (label) return e;
  errs.push(...e);
  return e;
}

const m = measure(files);
console.log(`[scan_promo] ${target} mode=${mode} files=${Object.keys(files).length}`);
console.log(`  bare=${m.bare} test=${m.test} grant=${m.grant} legacy=${m.legacy} baselineAt=${m.baseline} ownedAtBaseline=${m.owned} recordKey=${m.key}`);
check(m);

/* ── L2 양성대조: 망가뜨린 사본을 «잡는가» ─────────────────────────────── */
function variant(mut) {
  const copy = {};
  for (const [k, v] of Object.entries(files)) copy[k] = mut(v);
  return check(measure(copy), 'variant').length > 0;
}
const controls = [
  ['코드 문자열 제거', variant((s) => s.split(CODE).join('XXX'))],
  // ★모드에 따라 «반대 방향»으로 변조해야 의미가 있다:
  //   canon    → TEST_ 를 «붙인다»(정본에 TEST_ 가 새면 검수 사고)
  //   testonly → TEST_ 를 «떼낸다»(테스트 빌드가 실코드로 지급하면 예산이 나간다)
  ['코드 접두 변조', mode === 'canon'
    ? variant((s) => s.split(CODE).join('TEST_' + CODE))
    : variant((s) => s.split('TEST_' + CODE).join(CODE))],
  ['grant 호출 제거', variant((s) => s.split('grantPromotionReward').join('nope'))],
  ['기준선 필드 제거', variant((s) => s.split('ownedAtBaseline').join('zzz'))],
];
for (const [name, caught] of controls) {
  console.log(`  L2 양성대조 ${name}: ${caught ? '잡음' : '★못 잡음'}`);
  if (!caught) errs.push(`L2 양성대조 실패: ${name}`);
}

/* ── ③⑤ 스킨 프로모션 2종 (2026-09-02) ────────────────────────────────────
 *  ★코드를 «여기 따로» 적는다. 피검사 대상(src/promo/skinPromos.ts)에서 읽어 오면
 *    소스가 틀려도 검사가 통과하는 «죽은 검사기»가 된다(scan_ads.mjs 와 같은 규율).
 *  ★각 코드는 번들에 «정확히 1회». 두 번 나오면 정본 파일 밖으로 흩어진 것이다.
 */
const NEW_PROMOS = [
  ['__PROMOTION_CODE__', '③ 킹코브라 300원'],
  ['__PROMOTION_CODE__', '⑤ 특수 스킨 500원'],
];
{
  const all = Object.values(files).join('\n');
  for (const [code, label] of NEW_PROMOS) {
    /* ★「TEST_ 가 몇 번 나오나」로 세지 «마라». 토스 광고 SDK 에 TEST_MODE 라는
       결과코드 상수가 있어서 정본에도 항상 2건이 잡힌다(라이브 정본에도 있다).
       세야 하는 것은 «TEST_ + 이 코드»다. 그걸로 세야 벤더 문자열과 안 섞인다. */
    const test = all.split('TEST_' + code).length - 1;
    const bare = (all.split(code).length - 1) - test; // TEST_ 붙은 것은 빼고 센다
    const wantBare = mode === 'canon' ? 1 : 0;
    const wantTest = mode === 'canon' ? 0 : 1;
    if (bare === wantBare && test === wantTest) {
      console.log(`  OK(new promo) ${code}  ${label}  bare=${bare} test=${test}`);
    } else {
      console.log(`  ★${code} (${label}) bare=${bare}(기대 ${wantBare}) test=${test}(기대 ${wantTest})`);
      errs.push(`신규 프로모션 ${label}: bare=${bare} test=${test} (${mode} 기대 ${wantBare}/${wantTest})`);
    }
  }
  // 양성대조: 코드를 지운 사본에서 «반드시» 0회로 검출돼야 한다(검사기 생존 확인).
  const wiped = all.split(NEW_PROMOS[0][0]).join('YYY');
  const caught = (wiped.split(NEW_PROMOS[0][0]).length - 1) === 0;
  console.log(`  L2 양성대조 신규 코드 제거: ${caught ? '잡음' : '★못 잡음'}`);
  if (!caught) errs.push('L2 양성대조 실패: 신규 프로모션 코드 제거');
}

if (errs.length) {
  console.error(`[scan_promo] FAIL ${errs.length} (${mode})`);
  for (const e of errs) console.error('  - ' + e);
  process.exit(1);
}
console.log(`[scan_promo] PASS (${mode})`);
void ROOT;
