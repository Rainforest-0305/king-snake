// contrast.mjs - UI 대비 실측.
//
// ★ 왜 필요한가: 이 UI 는 «게임 캔버스 위»에 얹힌다. 배경이 매 순간 바뀌고
//   그 밑으로 어떤 색의 뱀이든 지나간다. 「어두운 배경이니 괜찮겠지」는
//   근거가 아니다. 실제로 계산해야 한다.
//
// ★ 두 가지를 «따로» 잰다:
//   1) 패널 위     - 텍스트가 불투명 표면 위에 있는 경우(대부분).
//   2) 스크림 위   - 워드마크/결과 제목처럼 «스크림 + 게임 화면» 위에 직접
//                    놓인 경우. 이때는 «최악의 배경»(순백)을 가정해 계산한다.
//                    화면에 큰 오브 블룸이 몰리면 실제로 밝아진다.
//
// 기준(WCAG 2.1 AA): 본문 4.5:1, 큰 글자(>=18px 또는 굵은 >=14px) 3:1.
// 여기서는 «본문 기준 4.5» 를 기본으로 잡고, 큰 글자만 별도 표기한다.
//
// 실행: node tools/contrast.mjs

import fs from 'node:fs';

const css = fs.readFileSync('src/ui/styles.css', 'utf8');

/** :root 의 «sRGB 기본값» 블록만 읽는다(@supports OKLCH 블록은 근사치라 제외). */
function readTokens() {
  const start = css.indexOf(':root {');
  const end = css.indexOf('}', start);
  const block = css.slice(start, end);
  const out = {};
  for (const m of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

function parse(c) {
  c = c.trim();
  if (c.startsWith('#')) {
    let h = c.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(',').map((s) => parseFloat(s));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  throw new Error('파싱 불가: ' + c);
}

function lum([r, g, b]) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(fg, bg) {
  const a = lum(fg);
  const b = lum(bg);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/** src(알파 포함)를 dst 위에 합성. */
function over(src, dst) {
  const a = src[3];
  return [
    src[0] * a + dst[0] * (1 - a),
    src[1] * a + dst[1] * (1 - a),
    src[2] * a + dst[2] * (1 - a),
    1,
  ];
}

const T = readTokens();
const c = (name) => parse(T[name]);

// 게임 화면의 «최악의 배경» = 순백(오브 블룸이 몰린 자리).
const WORST = [255, 255, 255, 1];
// 게임 화면의 «전형적» 배경 = 아레나 중간톤.
const TYPICAL = parse('#101636');

const scrimOnWorst = over(c('scrim'), WORST);
const scrimOnTypical = over(c('scrim'), TYPICAL);

const checks = [
  // [설명, 전경, 배경, 최소요구]
  ['본문 ink / 패널', c('ink'), c('surface'), 4.5],
  ['보조 muted / 패널', c('muted'), c('surface'), 4.5],
  ['희미 faint / 패널', c('faint'), c('surface'), 4.5],
  ['플레이스홀더 faint / 패널', c('faint'), c('surface'), 4.5],
  ['본문 ink / 패널2', c('ink'), c('surface-2'), 4.5],
  ['보조 muted / 패널2', c('muted'), c('surface-2'), 4.5],
  ['세그먼트 muted / 패널2', c('muted'), c('surface-2'), 4.5],
  ['세그먼트 선택 ink / 패널3', c('ink'), c('surface-3'), 4.5],
  ['CTA 글자 on-primary / primary', c('on-primary'), c('primary'), 4.5],
  ['CTA hover on-primary / primary-hi', c('on-primary'), c('primary-hi'), 4.5],
  // 2026-08-28: 강조 역할이 --primary 에서 --signal 로 갈라졌다.
  // ★ 검사 대상을 같이 안 바꾸면 «쓰지도 않는 조합»을 계속 통과시킨다.
  ['내 순위줄 on-signal / signal', c('on-signal'), c('signal'), 4.5],
  ['킬피드 내 줄 on-signal / signal', c('on-signal'), c('signal'), 4.5],
  ['신기록 뱃지 on-signal / signal', c('on-signal'), c('signal'), 4.5],
  ['최고기록 signal / 패널', c('signal'), c('surface'), 4.5],
  ['결과 내 줄 점수 signal / 패널2', c('signal'), c('surface-2'), 4.5],
  ['스킨 선택테 signal / 패널2 (비텍스트 3:1)', c('signal'), c('surface-2'), 3.0],
  ['해금뱃지 accent / 패널2', c('accent'), c('surface-2'), 4.5],
  /* 리워드 광고 제안(2026-08-31 신설). 판은 --surface-2, 아이콘 칩은 --signal / --accent. */
  ['리워드 제목 ink / 리워드판(패널2)', c('ink'), c('surface-2'), 4.5],
  ['리워드 부제 muted / 리워드판(패널2)', c('muted'), c('surface-2'), 4.5],
  ['리워드 아이콘 삼각형 on-signal / signal', c('on-signal'), c('signal'), 3.0],
  ['리워드 준비됨 체크 on-signal / accent', c('on-signal'), c('accent'), 3.0],
  ['리워드 토스트 ink / 패널2', c('ink'), c('surface-2'), 4.5],
  ['스킨 광고배지 on-signal / signal (비텍스트 3:1)', c('on-signal'), c('signal'), 3.0],
  /* 기록 돌파 «배너»(2026-09-01 개정). 판이 사라지고 아레나 위 알약 하나가 됐다.
     ★그래서 배경이 «패널»(--surface)로 바뀌었다 — 아레나 색을 가정하지 않으려고
       불투명 표면을 깔았기 때문이다. 옛 계기판(패널2 위 숫자)·거절 버튼 쌍은
       요소 자체가 없어져 이 자리에서 «갈아 끼웠다». */
  ['배너 제목 signal / 배너판(패널)', c('signal'), c('surface'), 4.5],
  ['배너 부제 muted / 배너판(패널)', c('muted'), c('surface'), 4.5],
  ['배너 아이콘 signal / 배너판(비텍스트 3:1)', c('signal'), c('surface'), 3.0],
  ['배너 남은시간 막대 signal / 배너판(비텍스트 3:1)', c('signal'), c('surface'), 3.0],
  ['배너 테두리 reward-edge / 배너판(비텍스트)', over(c('reward-edge'), c('surface')), c('surface'), 1.2],
  // ── 2026-09-02 ② 스킨 「자세히」 패널 ─────────────────────────────────
  ['능력줄 accent / 능력칩(패널2)', c('accent'), c('surface-2'), 4.5],
  ['능력줄 「자세히」 ink / 능력칩(패널2)', c('ink'), c('surface-2'), 4.5],
  ['자세히 제목 ink / 자세히판(패널2)', c('ink'), c('surface-2'), 4.5],
  ['자세히 능력이름 accent / 자세히판(패널2)', c('accent'), c('surface-2'), 4.5],
  ['자세히 리드 muted / 자세히판(패널2)', c('muted'), c('surface-2'), 4.5],
  ['자세히 행라벨 faint / 자세히판(패널2)', c('faint'), c('surface-2'), 4.5],
  ['자세히 행값 ink / 자세히판(패널2)', c('ink'), c('surface-2'), 4.5],
  ['자세히 오해차단줄 faint / 자세히판(패널2)', c('faint'), c('surface-2'), 4.5],
  ['자세히 닫기X muted / 패널3(비텍스트 3:1)', c('muted'), c('surface-3'), 3.0],
  ['카드 표식 i on-accent / accent', c('on-accent'), c('accent'), 4.5],
  ['카드 표식 테 accent / 패널2(비텍스트 3:1)', c('accent'), c('surface-2'), 3.0],
  // ── 2026-09-02 ② 배너 재개정(크게·다듬기) ────────────────────────────
  ['배너 제목 signal / 배너 그라디언트 상단(패널2)', c('signal'), c('surface-2'), 4.5],
  ['배너 부제 muted / 배너 그라디언트 상단(패널2)', c('muted'), c('surface-2'), 4.5],
  ['배너 아이콘 꺾쇠 on-signal / signal (비텍스트 3:1)', c('on-signal'), c('signal'), 3.0],
  ['배너 오른쪽 꺾쇠 signal / 배너판(비텍스트 3:1)', c('signal'), c('surface'), 3.0],
  ['배너 테두리 reward-edge-hi / 배너판(비텍스트)', over(c('reward-edge-hi'), c('surface')), c('surface'), 1.2],
  /* ── 2026-09-03 ③ 배너를 «HUD 판»으로 (President: 정렬·생김새 재작업) ──────
     판이 --surface(불투명 카드) → --hud-plate-solid(rgba(4,6,13,.93) 반투명)로 바뀌었다.
     ★반투명이므로 «아레나 색을 가정하면 안 된다» — 최악(순백 아레나) 위에 합성한
       실제 배경으로 잰다. 그게 이 판의 알파를 .74(일시정지) 가 아니라 .93 으로 정한 근거다.
     ★테두리·앰버 글로우는 «없앴다»(앰버를 한 구역으로 모음) — 그래서 테두리 쌍이 없다. */
  ['배너 제목 signal / HUD판(최악=순백 아레나 위)', c('signal'), over(c('hud-plate-solid'), WORST), 4.5],
  ['배너 부제 muted / HUD판(최악)', c('muted'), over(c('hud-plate-solid'), WORST), 4.5],
  ['배너 아이콘 signal / HUD판(비텍스트 3:1, 최악)', c('signal'), over(c('hud-plate-solid'), WORST), 3.0],
  ['배너 꺾쇠 muted / HUD판(비텍스트 3:1, 최악)', c('muted'), over(c('hud-plate-solid'), WORST), 3.0],
  ['배너 남은시간 막대 / HUD판(비텍스트, 상태표시)',
    over([244, 246, 250, 0.26], over(c('hud-plate-solid'), WORST)), over(c('hud-plate-solid'), WORST), 1.2],
  ['카운트다운 숫자 ink / 패널(아레나 위 불투명 원반)', c('ink'), c('surface'), 4.5],
  ['카운트다운 라벨 muted / 패널(아레나 위 불투명 칩)', c('muted'), c('surface'), 4.5],
  ['카운트다운 테두리 reward-edge / 패널(비텍스트)', over(c('reward-edge'), c('surface')), c('surface'), 1.2],
  ['사망제목 danger / 스크림(최악=순백 배경)', c('danger'), scrimOnWorst, 3.0],
  ['사망제목 danger / 스크림(전형)', c('danger'), scrimOnTypical, 3.0],
  ['워드마크 ink / 스크림(최악)', c('ink'), scrimOnWorst, 3.0],
  ['태그라인 muted / 스크림(최악)', c('muted'), scrimOnWorst, 4.5],
  ['결과 사유 muted / 스크림(최악)', c('muted'), scrimOnWorst, 4.5],
  ['구분선 line-soft / 패널(비텍스트 3:1)', c('line-soft'), c('surface'), 1.4],
  ['포커스링 primary / 패널', c('primary'), c('surface'), 3.0],
  // 2026-08-29: HUD 가 «판 없는 글자»가 됐다(slither.io 기준). 글자의 배경은
  // 아레나가 아니라 «글자에 두른 1px 윤곽»(--hud-edge)이다 - 밑에 무엇이
  // 지나가도 글자-윤곽 대비는 변하지 않는다. 그래서 윤곽색을 배경으로 잰다.
  ['HUD 길이 숫자 ink / 윤곽', c('ink'), c('hud-edge'), 4.5],
  ['HUD 라벨·순위표 muted / 윤곽', c('muted'), c('hud-edge'), 4.5],
  ['HUD 순위·점수 faint / 윤곽', c('faint'), c('hud-edge'), 4.5],
  ['HUD 내 순위줄 signal / 윤곽', c('signal'), c('hud-edge'), 4.5],
  ['HUD 킬피드 당함 danger / 윤곽', c('danger'), c('hud-edge'), 4.5],
  ['HUD 일시정지 아이콘 muted / 받침(최악=순백 위)', c('muted'), over(c('hud-plate'), WORST), 3.0],
  /* ── 2026-09-10 레인 A: 토스 전용 조각(푸시 안내 카드 · 「알림」 행 · 머니 리그 카드) + 결과 「다음 판 시작」 행 ── */
  ['안내카드 제목 ink / 카드(패널)', c('ink'), c('surface'), 4.5],
  ['안내카드 부제 muted / 카드(패널)', c('muted'), c('surface'), 4.5],
  ['안내카드 종 아이콘 signal / 아이콘칩(패널2, 비텍스트 3:1)', c('signal'), c('surface-2'), 3.0],
  ['안내카드 「받기」 ink / 알약(패널2)', c('ink'), c('surface-2'), 4.5],
  ['닫기 X muted / 카드(패널, 비텍스트 3:1)', c('muted'), c('surface'), 3.0],
  ['알림 행 버튼 ink / 알약(패널2)', c('ink'), c('surface-2'), 4.5],
  ['알림 행 켜짐 accent / 알약(패널2)', c('accent'), c('surface-2'), 4.5],
  ['알림 힌트 muted / 설정 블록(패널)', c('muted'), c('surface'), 4.5],
  ['알림 오류 힌트 danger / 설정 블록(패널)', c('danger'), c('surface'), 4.5],
  ['교차추천 제목 ink / 카드(패널)', c('ink'), c('surface'), 4.5],
  ['교차추천 부제 muted / 카드(패널)', c('muted'), c('surface'), 4.5],
  ['교차추천 「추천」 태그 faint / 카드(패널)', c('faint'), c('surface'), 4.5],
  ['교차추천 태그 테 line / 카드(비텍스트)', c('line'), c('surface'), 1.4],
  ['교차추천 「열기」 ink / 알약(패널2)', c('ink'), c('surface-2'), 4.5],
  ['교차추천 열기 화살 muted / 알약(패널2, 비텍스트 3:1)', c('muted'), c('surface-2'), 3.0],
  ['결과 「다음 판 시작」 2배 값 signal / 기록 블록(패널)', c('signal'), c('surface'), 4.5],
];

let fail = 0;
console.log('== King Snake UI 대비 실측 (WCAG 2.1) ==\n');
for (const [label, fg, bg, min] of checks) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) fail++;
  console.log(
    (ok ? '  OK  ' : ' FAIL ') +
      r.toFixed(2).padStart(6) + ':1  (>= ' + min.toFixed(1) + ')  ' + label,
  );
}
console.log('\n스크림 합성 결과 - 최악(순백 위): rgb(' +
  scrimOnWorst.slice(0, 3).map((v) => Math.round(v)).join(',') + ')');
console.log('             - 전형(아레나 위): rgb(' +
  scrimOnTypical.slice(0, 3).map((v) => Math.round(v)).join(',') + ')');

if (fail) {
  console.log('\n★ ' + fail + '건 미달. 토큰을 고쳐라 - 「어두우니 괜찮겠지」는 근거가 아니다.');
  process.exit(1);
}
console.log('\n전 항목 통과.');
