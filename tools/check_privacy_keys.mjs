#!/usr/bin/env node
/**
 * ★개인정보처리방침의 「기록하는 항목은 «다음이 전부입니다»」를 ★참인 채로 유지한다.
 *
 *   node tools/check_privacy_keys.mjs
 *   node tools/check_privacy_keys.mjs --selftest    (★양성/음성 대조 — 검사기가 살아 있는지 먼저)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ★★왜 이 검사기가 생겼나 (2026-09-10 레인 A · Partner 게이트)
 * ═══════════════════════════════════════════════════════════════════════════
 *   이 레인이 저장 키 «3개»를 새로 만들었다(carry·push·xpromo). `.ait` 내부 grep 으로
 *   「각 1회」까지 확인해 놓고, 정작 `privacy.html` 에는 그 셋이 «없는» 채로 제출 직전까지 갔다.
 *   Partner 가 잡았다. 이용자에게 고지하지 않은 저장이 생기는 것이라 나가면 안 되는 상태였다.
 *
 *   ★같은 형태의 사고가 이미 있었다: 주식투자게임(2026-08-22, 문서 9 / 코드 11 = 4개 누락),
 *     스모 레인 E(방침 선언과 실제 불일치를 08-31 부터 10일간 흘림).
 *   ★공통 원인은 하나다 — **라벨이 코드보다 늦게 따라가고, 아무도 모른다. 에러가 안 나니까.**
 *
 *   ⛔풀이를 «문구를 무르게 하는 것»으로 하지 마라. 「등이 있습니다」로 흐리면
 *     개인정보처리방침으로서 «더 나쁘다». 이 문서는 완전해야 한다.
 *   ⇒ 문구는 「전부입니다」 그대로 두고, «그게 참인지»를 빌드가 센다.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ★검사 내용
 *   ① 코드가 «실제로» 쓰는 저장소 키를 전수 수확 — 리터럴 + `GAME_ID + '.x'` + 접두 상수
 *   ② `privacy.html` 의 en / ko 표에서 `<code>` 키 목록을 파싱(경계는 `id="lang-split"`)
 *   ③ ★양쪽을 «집합 비교» — 어느 쪽에만 있어도 FAIL
 *   ④ en 표와 ko 표가 «서로» 같은지 (한쪽만 갱신하는 사고를 막는다 — 이 앱에서 실제로 났다:
 *      한글 절만 광고 문구가 갱신되고 영문 절은 「fully offline · no ad SDK」로 10일 넘게 남아 있었다)
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ⚠️★이 검사기가 «못 보는» 것 — 「게이트 통과 ≠ 그 경로가 검증됐다」
 *   1. ⛔**키 «이름»만 본다. 「무엇이 담기는지」는 안 본다.** `king-snake.save` 에 전화번호를
 *      넣어도 이 검사기는 0건이다. 그 층은 사람의 검토 몫이다.
 *   2. ⛔**동적으로 조립된 키를 못 본다.** 그래서 대조 ⑥ 이 「펼칠 수 없는 동적 조립이 «없는지»」를
 *      직접 검사한다. 있으면 FAIL — 그때는 사람이 명단(DYNAMIC_OK)에 이유와 함께 적어야 한다.
 *   3. ⛔**`sessionStorage` 는 대상이 아니다.** 브라우저를 닫으면 사라진다.
 *   4. ⛔**네이티브 미러는 개별 항목으로 세지 않는다.** 같은 값의 사본이고 방침이 문장으로 설명한다.
 *
 * 종료 코드: 0 = 통과, 1 = 실패. 순수 node, 네트워크·설치 불필요.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SRC = resolve(ROOT, 'src');
const PRIVACY = resolve(ROOT, 'public/privacy.html');
const SELFTEST = process.argv.slice(2).includes('--selftest');

/** `GAME_ID` 의 실제 값. ⛔여기에 문자열을 박지 «않는다» — brand.ts 에서 읽어 온다. */
function readGameId() {
  const src = readFileSync(resolve(SRC, 'brand.ts'), 'utf8');
  const m = src.match(/export\s+const\s+GAME_ID\s*=\s*'([^']+)'/);
  if (!m) throw new Error('brand.ts 에서 GAME_ID 를 못 읽었다 — 검사기를 고쳐라(모양이 바뀌었다)');
  return m[1];
}
const GAME_ID = readGameId();
const KEYRE = new RegExp(GAME_ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[.:][A-Za-z0-9._-]+');

/**
 * ★수확 «대상이 아닌» 것 — 이유를 적어야만 들어간다(⛔모양 규칙 금지, «명단»이다).
 * 세어볼 수 있어야 다음 사람이 「왜 빠졌지」를 물을 수 있다.
 */
const DYNAMIC_OK = new Map([
  [GAME_ID + '.promo.v1:',
    '프로모션 «코드»가 뒤에 붙는 접두사다. 프로모션마다 한 칸이라 키를 미리 셀 수 없다 — '
    + '방침은 「이 접두 + 프로모션 코드」 규칙을 «문장»으로 설명한다(방침 note 절).'],
]);

/** 코드가 실제로 쓰는 저장소 키를 전수 수확한다 */
function harvestCodeKeys(srcRoot) {
  const found = new Map();   // key -> 첫 출처
  const dynamic = [];        // ★펼칠 수 없는 동적 조립 흔적
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = resolve(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === 'messages') continue;   // i18n 문안이지 코드가 아니다
        walk(p);
        continue;
      }
      if (!['.ts', '.tsx'].includes(extname(name))) continue;
      const src = readFileSync(p, 'utf8');
      const where = relative(ROOT, p).split('\\').join('/');
      const add = (k) => { if (!found.has(k)) found.set(k, where); };

      /* ①-a 그냥 리터럴: 'king-snake.carry.v1' */
      for (const m of src.matchAll(new RegExp("'(" + KEYRE.source + ")'", 'g'))) add(m[1]);

      /* ①-b ★`GAME_ID + '.ads.v1'` 형태를 «펼친다».
         ⛔이걸 안 펼치면 `king-snake.ads.v1`·`king-snake.save` 가 통째로 안 잡힌다 —
           그 상태로 「0건」을 찍으면 그건 부재의 증거가 아니라 죽은 검사기다. */
      for (const m of src.matchAll(/GAME_ID\s*\+\s*'([.:][A-Za-z0-9._-]+)'/g)) add(GAME_ID + m[1]);

      /* ①-c ★접두 상수 + 템플릿: const NS = 'x.'; `${NS}foo` */
      const prefixes = new Map();
      for (const m of src.matchAll(new RegExp("const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*'(" + KEYRE.source + "|" + GAME_ID + "[.:])'", 'g'))) {
        prefixes.set(m[1], m[2]);
      }
      for (const m of src.matchAll(/`\$\{([A-Za-z_$][\w$]*)\}([A-Za-z0-9._-]*)`/g)) {
        const base = prefixes.get(m[1]);
        if (base !== undefined) add(base + m[2]);
      }

      /* ★펼칠 수 없는 동적 조립만 남긴다. 명단(DYNAMIC_OK)에 있으면 통과. */
      for (const m of src.matchAll(new RegExp("(" + KEYRE.source + "|" + GAME_ID + "[.:])'\\s*\\+\\s*[A-Za-z_$]", 'g'))) {
        const base = m[1];
        if ([...DYNAMIC_OK.keys()].some((k) => base.startsWith(k) || k.startsWith(base))) continue;
        dynamic.push(where + ' : ' + m[0].trim() + '  (리터럴 접두 + 런타임 값)');
      }
      for (const m of src.matchAll(/`\$\{([A-Za-z_$][\w$]*)\}[A-Za-z0-9._-]*`/g)) {
        if (prefixes.has(m[1])) continue;
        if (/KEY|NS|PREFIX|STORAGE/i.test(m[1])) {
          dynamic.push(where + ' : ' + m[0].trim() + '  (접두 상수를 이 파일에서 못 찾음)');
        }
      }
    }
  };
  walk(srcRoot);
  /* 접두사 자체는 «항목»이 아니다 — 명단에 적힌 규칙이다. */
  for (const prefix of DYNAMIC_OK.keys()) {
    for (const k of [...found.keys()]) if (k === prefix || k === prefix.replace(/:$/, '')) found.delete(k);
  }
  return { keys: new Set(found.keys()), origin: found, dynamic };
}

/**
 * `privacy.html` 의 «항목 표»에서 키를 파싱한다. ★en / ko 를 «따로» 돌려준다.
 * 경계는 «본문에만» 있는 `id="lang-split"` 로 고정한다.
 * ⛔`indexOf('divider')` 같은 걸 쓰지 마라 — 같은 낱말이 문서 맨 위 <style> 에 CSS 로 먼저 나온다.
 *   그러면 split 이 거의 0 이 되어 한쪽 표 전체가 반대쪽으로 분류된다(주식투자게임 실사고).
 *
 * ★★2026-09-10 — 이 함수가 «스스로 죽어 있었다». 처음엔 문서 «전체»의 `<code>키</code>` 를 세었는데,
 *   같은 키가 산문(알림 절·미러 설명)에도 나온다. 그래서 «표에서 행을 지워도» 산문 언급 덕분에
 *   여전히 「선언됨」으로 잡혀 종료코드 0 이 나왔다 — end-to-end 양성대조로 실측 확인했다.
 *   (내장 selftest ⑥ 은 CAUGHT 를 찍었다. 그건 «다른 키»를 골라 지웠기 때문이다 = 우연히 통과.
 *    ★교훈: 내장 대조만 믿지 마라. 실제 파일을 훼손해 «끝에서 끝까지» 돌려 봐야 안다.)
 * ⇒ 이제 ①선언은 «<table class="keys">» 안에서만 읽고, ②표 밖 산문에 나온 키가 그 언어의 표에
 *   없으면 그것도 FAIL 로 신고한다(설명만 하고 목록에 안 올린 항목을 잡는다).
 */
function harvestDocKeys(html) {
  const split = html.indexOf('id="lang-split"');
  const en = new Set();
  const ko = new Set();
  const strayEn = new Set();
  const strayKo = new Set();
  const codeRe = new RegExp('<code>(' + KEYRE.source + ')</code>', 'g');

  /* 표 «안»의 범위를 먼저 구한다 */
  const tables = [...html.matchAll(/<table class="keys">([\s\S]*?)<\/table>/g)]
    .map((m) => ({ from: m.index, to: m.index + m[0].length }));
  const inTable = (at) => tables.some((t) => at >= t.from && at < t.to);

  for (const m of html.matchAll(codeRe)) {
    const key = m[1];
    if (DYNAMIC_OK.has(key) || DYNAMIC_OK.has(key + ':')) continue;
    const isKo = split > 0 && m.index > split;
    if (inTable(m.index)) (isKo ? ko : en).add(key);
    else (isKo ? strayKo : strayEn).add(key);
  }
  return { en, ko, strayEn, strayKo, tables: tables.length, split };
}

const diff = (a, b) => [...a].filter((x) => !b.has(x)).sort();

function run(codeKeys, html) {
  const errs = [];
  const doc = harvestDocKeys(html);
  if (doc.split <= 0) errs.push('언어 경계 표식(id="lang-split")을 못 찾았다 — 문서 구조가 바뀌었으면 검사기를 고쳐라');
  if (doc.tables < 2) errs.push('항목 표(<table class="keys">)가 ' + doc.tables + '개다 — en·ko 각 1개여야 한다');
  if (doc.en.size === 0) errs.push('영문 표에서 저장소 키를 하나도 못 읽었다 — 파싱이 죽었다');
  if (doc.ko.size === 0) errs.push('한글 표에서 저장소 키를 하나도 못 읽었다 — 파싱이 죽었다');
  /* ★산문에서만 언급된 키 — 설명은 해 놓고 «목록»에는 안 올린 항목이다. 목록이 「전부」여야 한다. */
  for (const k of [...doc.strayEn].filter((k) => !doc.en.has(k))) {
    errs.push('[en 표 «밖»에서만 언급] ' + k + ' — 산문에는 있는데 항목 표에 행이 없다');
  }
  for (const k of [...doc.strayKo].filter((k) => !doc.ko.has(k))) {
    errs.push('[ko 표 «밖»에서만 언급] ' + k + ' — 산문에는 있는데 항목 표에 행이 없다');
  }

  for (const k of diff(codeKeys, doc.ko)) {
    errs.push('[ko 방침에 «없음»] ' + k + ' — 코드는 쓰는데 표에 없다. 「다음이 전부입니다」가 거짓이 된다');
  }
  for (const k of diff(doc.ko, codeKeys)) {
    errs.push('[코드에 «없음»] ' + k + ' — 방침에는 있는데 코드가 안 쓴다. 지웠으면 방침도 지워라');
  }
  for (const k of diff(doc.ko, doc.en)) errs.push('[en 표에 «없음»] ' + k + ' — 한쪽만 갱신됐다');
  for (const k of diff(doc.en, doc.ko)) errs.push('[ko 표에 «없음»] ' + k + ' — 한쪽만 갱신됐다');
  return { errs, doc };
}

/* ── 실행 ─────────────────────────────────────────────────────────────── */
const HTML = readFileSync(PRIVACY, 'utf8');
const CODE = harvestCodeKeys(SRC);

if (SELFTEST) {
  const base = run(CODE.keys, HTML);
  const results = [];

  results.push(['① 파싱이 살아 있다 — en/ko 표에서 키를 읽는다', base.doc.en.size >= 5 && base.doc.ko.size >= 5]);
  results.push(['② 코드 수확이 살아 있다 — 저장소 키를 읽는다', CODE.keys.size >= 5]);
  results.push(['③ ★`GAME_ID + \'.x\'` 형태를 «펼친다»(안 펼치면 save·ads 가 통째로 샌다)',
                CODE.keys.has(GAME_ID + '.save') && CODE.keys.has(GAME_ID + '.ads.v1')]);
  results.push(['④ ★이 레인이 새로 만든 3종을 «코드에서» 잡는다',
                [GAME_ID + '.carry.v1', GAME_ID + '.push.v1', GAME_ID + '.xpromo.v1'].every((k) => CODE.keys.has(k))]);

  /* ★양성대조 ⑤ — 코드에 «새 키»가 생기면 잡힌다 */
  results.push(['⑤ ★코드에 새 키가 생기면 잡힌다',
                run(new Set([...CODE.keys, GAME_ID + '.needleNewKey']), HTML)
                  .errs.some((e) => e.includes('needleNewKey'))]);

  /* ★양성대조 ⑥ — 방침 «표»에서 한 행이 사라지면 잡힌다.
     ⛔희생양을 아무거나 고르지 «마라». 산문에도 나오는 키(push)를 골라야 진짜 시험이다 —
       옛 판은 산문 언급 덕분에 여전히 「선언됨」으로 읽어 rc=0 을 냈다(실측). */
  const victim = GAME_ID + '.push.v1';
  const cut = HTML.replace(new RegExp('<tr><td><code>' + victim.replace(/\./g, '\\.') + '</code></td>[\\s\\S]*?</tr>', 'g'), '');
  results.push(['⑥ ★항목 «표»에서 한 행이 사라지면 잡힌다 — 산문에 남아 있어도 (' + victim + ')',
                run(CODE.keys, cut).errs.some((e) => e.includes(victim))]);

  /* ★양성대조 ⑦ — en 만 갱신하고 ko 를 안 고치면 잡힌다 */
  const enOnly = HTML.slice(0, base.doc.split).replace('</table>',
    '<tr><td><code>' + GAME_ID + '.enOnlyNeedle</code></td><td>x</td></tr></table>') + HTML.slice(base.doc.split);
  results.push(['⑦ ★en 만 갱신하면(ko 미갱신) 잡힌다',
                run(CODE.keys, enOnly).errs.some((e) => e.includes('enOnlyNeedle'))]);

  /* ★양성대조 ⑧ — 언어 경계 표식이 사라지면 «죽은 검사기»임을 스스로 신고한다 */
  results.push(['⑧ ★언어 경계 표식이 사라지면 스스로 FAIL 한다',
                run(CODE.keys, HTML.replace('id="lang-split"', 'id="x"')).errs.some((e) => e.includes('lang-split'))]);

  /* ⑨ 펼칠 수 없는 동적 조립이 «없는가» — 있으면 리터럴 수확의 0건이 거짓이다 */
  results.push(['⑨ ★명단에 없는 «동적 조립» 저장 키가 0건', CODE.dynamic.length === 0]);

  /* ⑩ 음성대조 — 손대지 않은 원본으로는 결과가 바뀌지 않는다 */
  results.push(['⑩ 음성대조 — 원본 그대로면 결과가 바뀌지 않는다',
                run(CODE.keys, HTML).errs.length === base.errs.length]);

  /* ⑪ ★선언은 «표 안»에서만 읽는다 — 표를 통째로 없애면 산문이 남아 있어도 0개가 돼야 한다 */
  const noTables = HTML.replace(/<table class="keys">[\s\S]*?<\/table>/g, '');
  const nt = harvestDocKeys(noTables);
  results.push(['⑪ ★선언은 «표 안»에서만 읽는다(표를 지우면 0개 — 산문은 선언이 아니다)',
                nt.en.size === 0 && nt.ko.size === 0 && (nt.strayEn.size + nt.strayKo.size) > 0]);

  console.log('방침 저장소 키 검사기 — 양성/음성 대조 (GAME_ID = ' + GAME_ID + ')');
  let ok = true;
  for (const r of results) {
    console.log('  ' + (r[1] ? 'CAUGHT' : '★MISSED') + '  ' + r[0]);
    if (!r[1]) ok = false;
  }
  if (CODE.dynamic.length) {
    console.log('\n  ⚠️동적 조립 흔적:');
    for (const d of CODE.dynamic) console.log('    - ' + d);
  }
  if (!ok) {
    console.error('\nFAILED: 대조 실패 — 이 검사기의 「0건」은 부재의 증거가 아니다.');
    process.exit(1);
  }
  console.log('\nOK: 대조 ' + results.length + '종 전부 통과 — 검사기가 살아 있다.');
  console.log('   (코드 ' + CODE.keys.size + '개 · en 표 ' + base.doc.en.size + '개 · ko 표 ' + base.doc.ko.size + '개'
              + ' · 동적 명단 ' + DYNAMIC_OK.size + '건)');
  if (base.errs.length) {
    console.error('\n★그리고 «본 검사»는 실패한다 — 아래를 먼저 고쳐라:');
    for (const e of base.errs) console.error('  -', e);
    process.exit(1);
  }
} else {
  const { errs, doc } = run(CODE.keys, HTML);
  console.log('방침 「기록하는 항목은 다음이 전부입니다」 대조 (GAME_ID = ' + GAME_ID + ')');
  console.log('  코드가 쓰는 키 ' + CODE.keys.size + ' · en 표 ' + doc.en.size + ' · ko 표 ' + doc.ko.size);
  console.log('');
  console.log('  en ko  키');
  for (const k of [...CODE.keys].sort()) {
    console.log('  ' + (doc.en.has(k) ? ' O' : '★X') + ' ' + (doc.ko.has(k) ? ' O' : '★X') + '  '
                + k.padEnd(24) + CODE.origin.get(k));
  }
  for (const [k, why] of DYNAMIC_OK) console.log('  (규칙) ' + k.padEnd(26) + why.slice(0, 60) + '…');
  if (errs.length) {
    console.error('\nFAILED: ' + errs.length + '건');
    for (const e of errs) console.error('  -', e);
    console.error('\n  ⇒ 방침 문구를 «무르게» 고치지 마라. 표를 실제와 맞춰라.');
    process.exit(1);
  }
  console.log('\n  0건 — 방침과 코드가 일치한다.');
}
