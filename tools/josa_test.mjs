// josa_test.mjs - 한국어 조사 규칙 단위 테스트 + 봇 이름 풀 «전수» 검증.
//
// 실행: node tools/josa_test.mjs
//
// ★ 왜 별도 러너인가: 이 저장소에는 테스트 프레임워크가 없다(package.json 확인).
//   조사 하나 때문에 vitest 를 끌어오면 번들·설치 시간이 붙는다. tsc 는 이미
//   있으니 josa.ts 만 임시 폴더로 «컴파일해서» 진짜 모듈을 그대로 돌린다.
//   ⚠ 소스를 복사하거나 다시 구현하지 않는다 - 그러면 테스트가 «다른 코드»를 본다.
//
// ★ 오라클(정답지)을 «독립»으로 둔다.
//   한글 받침은 josa.ts 가 (code-0xAC00)%28 산술로 판정한다. 테스트가 같은 산술을
//   쓰면 서로를 베끼는 셈이라 오타를 못 잡는다. 그래서 유니코드 정규화(NFD)로
//   음절을 자모로 «분해»해 종성 유무를 따로 구한다 - 구현이 완전히 다른 경로다.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

// ── josa.ts 컴파일 ────────────────────────────────────────────────────────
const OUT = path.join(os.tmpdir(), 'coilrush_josa_test');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'package.json'), '{"type":"commonjs"}');
execFileSync(
  process.execPath,
  [
    path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(ROOT, 'src', 'i18n', 'index.ts'), // josa.ts + messages/*.ts 까지 같이 끌려온다
    '--outDir', OUT,
    '--target', 'ES2019',
    '--module', 'CommonJS',  // ESM 으로 뽑으면 확장자 없는 상대 import 를 node 가 못 찾는다
    '--moduleResolution', 'Node',
    '--strict',
    '--skipLibCheck',
  ],
  { stdio: 'inherit' },
);
const require_ = createRequire(import.meta.url);
const { josa, tailOf, hasBatchim } = require_(path.join(OUT, 'josa.js'));
// * 문구 렌더는 «진짜 t()» 로 검증한다. 테스트가 치환을 흉내 내면 t() 의 버그를 못 잡는다.
const { t, setLocale } = require_(path.join(OUT, 'index.js'));
setLocale('ko');

// ── 결과 집계 ─────────────────────────────────────────────────────────────
let pass = 0;
const fails = [];
function check(label, got, want) {
  if (got === want) pass++;
  else fails.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// ══ 1. 지시서 명시 케이스 ════════════════════════════════════════════════
const SPEC_CASES = [
  ['김밥', '을', '을'],
  ['순대', '을', '를'],
  ['만두', '을', '를'],
  ['감자', '을', '를'],
  ['churro61', '을', '을'], // 1 = 일(ㄹ)
  ['Iris', '을', '를'],     // s = 에스 -> 스, 받침 없음
  ['swerve', '을', '를'],
  ['noodle', '을', '를'],
  ['무지개2', '을', '를'],  // 2 = 이
  ['끝판왜', '을', '를'],   // 왜 = 받침 없음
  ['열무', '을', '를'],
];
for (const [w, spec, want] of SPEC_CASES) check(`spec ${w}+${spec}`, josa(w, spec), want);

// ⚠ 지시서와 «다르게» 나오는 유일한 케이스. 이유는 josa.ts 의 LATIN_BATCHIM 주석.
const PIKEX = josa('PikeX', '을');
const PIKEX_NOTE = `PikeX+을 -> "${PIKEX}"  (지시서 기대 "을" / 읽기기준 결과 "를")`;

// ══ 2. 조사 5쌍 전부 ═════════════════════════════════════════════════════
const PAIR_CASES = [
  // [낱말, 이/가, 을/를, 은/는, 와/과, 로/으로]
  ['김밥', '이', '을', '은', '과', '으로'], // ㅂ 받침
  ['순대', '가', '를', '는', '와', '로'],   // 받침 없음
  ['꿈틀', '이', '을', '은', '과', '로'],   // ★ ㄹ 받침 -> 「꿈틀로」(으로 아님)
  ['한방', '이', '을', '은', '과', '으로'], // ㅇ 받침
  ['구름', '이', '을', '은', '과', '으로'], // ㅁ 받침
];
for (const [w, i, e, n, wa, ro] of PAIR_CASES) {
  check(`${w}+이/가`, josa(w, '이'), i);
  check(`${w}+을/를`, josa(w, '를'), e); // 지정자는 짝 중 아무거나 써도 같아야 한다
  check(`${w}+은/는`, josa(w, '은'), n);
  check(`${w}+와/과`, josa(w, '과'), wa);
  check(`${w}+로/으로`, josa(w, '로'), ro);
}

// ══ 3. 숫자 읽기 받침 ════════════════════════════════════════════════════
// 0 영(ㅇ) 1 일(ㄹ) 2 이 3 삼(ㅁ) 4 사 5 오 6 육(ㄱ) 7 칠(ㄹ) 8 팔(ㄹ) 9 구
const DIGIT_WANT = { 0: '을', 1: '을', 2: '를', 3: '을', 4: '를', 5: '를', 6: '을', 7: '을', 8: '을', 9: '를' };
for (const d of Object.keys(DIGIT_WANT)) check(`숫자 ${d}`, josa(`bot${d}`, '을'), DIGIT_WANT[d]);
// ㄹ 받침 숫자는 「으로」가 아니라 「로」다.
for (const d of ['1', '7', '8']) check(`숫자 ${d}+로`, josa(`bot${d}`, '로'), '로');
for (const d of ['0', '3', '6']) check(`숫자 ${d}+으로`, josa(`bot${d}`, '로'), '으로');

// ══ 4. 로마자 ════════════════════════════════════════════════════════════
for (const c of ['l', 'm', 'n', 'L', 'M', 'N']) check(`로마자 ${c}`, josa(`x${c}`, '을'), '을');
for (const c of ['a', 'e', 'o', 'r', 's', 't', 'x', 'z', 'k', 'y', 'p', 'c', 'i']) {
  check(`로마자 ${c}`, josa(`x${c}`, '를'), '를');
}
check('l 은 ㄹ 받침', josa('Quill', '로'), '로');
check('n 은 ㄹ 아님', josa('Lumen', '로'), '으로');

// ══ 5. 판정 불가 문자 건너뛰기 ═══════════════════════════════════════════
check('감자ㅋ', josa('감자ㅋ', '을'), '를');       // ㅋ 건너뛰고 자
check('김밥ㅋㅋ', josa('김밥ㅋㅋ', '을'), '을');   // ㅋㅋ 건너뛰고 밥
check('순대!!', josa('순대!!', '이'), '가');
check('이모지만', josa('🐍', '이'), '가');         // 판정 대상 없음 -> 받침 없음
check('빈문자열', josa('', '이'), '가');
check('모르는 지정자는 그대로', josa('김밥', 'zz'), 'zz');

// ══ 6. 봇 이름 풀 «전수» 검증 ════════════════════════════════════════════
// game/names.ts 는 다른 레인 소유라 «읽기만» 한다. 배열은 소스에서 뽑는다
// (export 되어 있지 않다. 테스트 편의로 소스를 고치면 그게 더 큰 사고다).
const namesSrc = fs.readFileSync(path.join(ROOT, 'src', 'game', 'names.ts'), 'utf8');
function pool(constName) {
  const m = namesSrc.match(new RegExp(`const\\s+${constName}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!m) throw new Error(`names.ts 에서 ${constName} 을 못 찾았다 - 파서가 죽었다(0건은 부재의 증거가 아니다)`);
  const items = [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1]);
  if (items.length === 0) throw new Error(`${constName} 파싱 결과 0개`);
  return items;
}
const KO_SOLO = pool('KO_SOLO');
const KO_TAIL = pool('KO_TAIL');
const FIRST = pool('FIRST');
const SECOND = pool('SECOND');
const SOLO = pool('SOLO');

const all = new Set();
for (const a of KO_SOLO) for (const b of KO_TAIL) all.add(a + b);
for (const a of FIRST) for (const b of SECOND) all.add(a + b);
for (const s of SOLO) {
  all.add(s);
  for (let n = 10; n < 100; n++) all.add(s + n); // makeBotNames: 두 자리 숫자를 붙인다
}
for (let i = 1; i <= 30; i++) all.add(`player${i}`); // 풀 고갈 시 폴백
// 플레이어 닉은 무엇이든 온다. 실제로 들어올 법한 것들을 섞는다.
const PLAYER_NICKS = ['', '나', '기훈', '김서방', 'Kim', 'x_x', '1234', '🐍🐍', '  ', 'ㅋㅋㅋ', 'ÉLAN', '뱀왕', '점보왕', 'zzz'];
for (const n of PLAYER_NICKS) all.add(n);

// 독립 오라클: NFD 로 «자모 분해»해 종성 유무를 구한다(josa.ts 의 %28 산술과 다른 경로).
function oracleHangul(ch) {
  const d = ch.normalize('NFD');
  if (d.length === 3) return { batchim: true, rieul: d.codePointAt(2) === 0x11af };
  if (d.length === 2) return { batchim: false, rieul: false };
  return null; // 한글 음절이 아니다
}
function decisiveChar(name) {
  const chars = [...name];
  for (let i = chars.length - 1; i >= 0; i--) {
    const c = chars[i];
    if (oracleHangul(c)) return { c, kind: 'hangul' };
    if (c >= '0' && c <= '9') return { c, kind: 'digit' };
    const lo = c.toLowerCase();
    if (lo >= 'a' && lo <= 'z' && lo.length === 1) return { c, kind: 'latin' };
  }
  return { c: null, kind: 'none' };
}

const buckets = { hangul: 0, digit: 0, latin: 0, none: 0 };
const noneNames = [];
for (const name of all) {
  const { c, kind } = decisiveChar(name);
  buckets[kind]++;
  if (kind === 'none') noneNames.push(JSON.stringify(name));

  // (a) 조사가 항상 «짝 안의 한 글자»로 나온다
  const eul = josa(name, '을');
  const ga = josa(name, '이');
  if (eul !== '을' && eul !== '를') fails.push(`풀 ${name}: 을/를 아님 -> ${eul}`);
  else if (ga !== '이' && ga !== '가') fails.push(`풀 ${name}: 이/가 아님 -> ${ga}`);
  else pass++;

  // (b) 짝끼리 «일관»된다. 받침이 있으면 이/을/은/과, 없으면 가/를/는/와.
  const b = hasBatchim(name);
  const want = b
    ? { 이: '이', 을: '을', 은: '은', 와: '과' }
    : { 이: '가', 을: '를', 은: '는', 와: '와' };
  for (const spec of ['이', '을', '은', '와']) {
    if (josa(name, spec) !== want[spec]) fails.push(`풀 ${name}: ${spec} 일관성 깨짐`);
  }

  // (c) 한글로 끝나면 «독립 오라클»과 대조한다
  if (kind === 'hangul') {
    const o = oracleHangul(c);
    const t = tailOf(name);
    if (t.batchim !== o.batchim) fails.push(`풀 ${name}: 받침 판정 불일치(NFD=${o.batchim}, josa=${t.batchim})`);
    if (t.rieul !== o.rieul) fails.push(`풀 ${name}: ㄹ받침 판정 불일치(NFD=${o.rieul}, josa=${t.rieul})`);
  }
}

// ══ 7. 문구 렌더 — «t()» 로 ═════════════════════════════
// * 킬 피드(feedKill*)는 화면에서 t() 가 아니라 shell 의 fillNames() 가 조립한다
//   (이름만 굵게 칠해야 해서 문자열이 아니라 DOM 조각을 만든다).
//   여기서 t() 로 돌리는 것은 «같은 토큰 문법을 t() 도 똑같이 처리하는가» 를 보기 위함이다.
//   실제 DOM 경로는 headless 실렌더로 «따로 쟀다».
let widest = { text: '', len: 0 };
const namesArr = [...all];
for (let i = 0; i < namesArr.length; i++) {
  const a = namesArr[i];
  const b = namesArr[(i + 7) % namesArr.length];
  for (const line of [
    t('feedKill', { killer: a, victim: b }),
    t('feedKillMine', { victim: a }),
    t('feedKillDied', { killer: a }),
    t('diedBy', { name: a }),
    t('diedHeadOn', { name: a }),
  ]) {
    if (line.includes('{') || line.includes('}')) fails.push(`렌더 잔여 토큰: ${line}`);
    // 조사 지정자 글자가 «날것»으로 새어 나가면 안 된다
    if (/:[가-힣]/.test(line)) fails.push(`렌더 지정자 누출: ${line}`);
    const len = [...line].reduce((s, ch) => s + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
    if (len > widest.len) widest = { text: line, len };
  }
}

// ══ 7-b. t() 회귀 ═══════════════════════════════════════
check('vars 없으면 원문 그대로', t('feedKill'), '{killer:가} {victim:을} 잡았다');
check('값 없는 토큰은 남긴다', t('feedKill', { killer: '순대' }), '순대가 {victim:을} 잡았다');
check('지정자 없는 토큰도 그대로', t('skinLocked', { n: 300 }), '300점부터');
setLocale('en');
check('en 은 조사 안 붙는다', t('feedKill', { killer: 'Nova', victim: 'Pike' }), 'Nova took out Pike');
setLocale('ko');

// ══ 8. 다른 로케일이 조사 지정자를 쓰지 않는지 ═══════════════════════════
for (const f of fs.readdirSync(path.join(ROOT, 'src', 'i18n', 'messages'))) {
  if (!f.endsWith('.ts') || f === 'ko.ts') continue;
  const src = fs.readFileSync(path.join(ROOT, 'src', 'i18n', 'messages', f), 'utf8');
  const bad = [...src.matchAll(/\{\w+:[^}\s]+\}/g)].map((m) => m[0]);
  if (bad.length) fails.push(`${f}: 한국어 전용 조사 지정자가 들어 있다 -> ${bad.join(', ')}`);
  else pass++;
}

// ── 출력 ──────────────────────────────────────────────────────────────────
console.log('== 조사 단위 테스트 ==');
console.log(`  이름 풀 전수: ${all.size}개 (한글끝 ${buckets.hangul} / 숫자끝 ${buckets.digit} / 로마자끝 ${buckets.latin} / 판정불가 ${buckets.none})`);
if (noneNames.length) console.log(`  판정불가(받침없음으로 처리): ${noneNames.join(', ')}`);
console.log(`  가장 긴 한국어 문구: "${widest.text}" (전각환산 ${widest.len})`);
console.log(`  ${PIKEX_NOTE}`);
console.log('  예시:');
for (const n of ['순대', '김밥', '만두', '구름ㅋㅋ', '꿈틀짱', 'Iris', 'Quill', 'churro61', 'PikeX', '무지개2', '끝판왜', '🐍']) {
  console.log(`    ${t('feedKill', { killer: n, victim: '김밥' })}   |   ${t('diedHeadOn', { name: n })}`);
}
console.log(`\n  통과 ${pass}건 / 실패 ${fails.length}건`);
if (fails.length) {
  console.log('\n[FAIL]');
  for (const f of fails.slice(0, 40)) console.log('  -', f);
  process.exit(1);
}
console.log('\n[PASS] 조사 규칙 + 봇 이름 풀 전수 검증 통과.');
