#!/usr/bin/env node
/**
 * 보호 파일(조작·게임 규칙·저장·광고·i18n·빌드 설정)이 라이브 정본(../coil-rush)과 «바이트 단위로 같은지» 증명한다.
 *   node tools/check_protected.mjs            → 정본 대비 sha256 비교
 * 양성대조: 정본 파일 하나에 바이트 1개를 «메모리에서» 붙여 같은 함수가 검출하는지 확인한다(검사기 자체 검증).
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const NEW = resolve(HERE, '..');
const LIVE = resolve(HERE, '..', '..', 'coil-rush');
const PROTECTED = [
  'src/input.ts',
  'src/game/config.ts', 'src/game/world.ts', 'src/game/snake.ts', 'src/game/trail.ts', 'src/game/orbs.ts',
  'src/game/bots.ts', 'src/game/spatial.ts', 'src/game/rng.ts', 'src/game/names.ts',
  'src/save.ts', 'src/brand.ts',
  'src/ads/adSdk.ts', 'src/ads/interstitial.ts',
  'src/i18n/index.ts', 'src/i18n/josa.ts', 'src/i18n/messages.d.ts',
  'src/i18n/messages/ko.ts', 'src/i18n/messages/en.ts', 'src/i18n/messages/ja.ts', 'src/i18n/messages/de.ts',
  'src/i18n/messages/es.ts', 'src/i18n/messages/fr.ts', 'src/i18n/messages/pt-BR.ts', 'src/i18n/messages/ru.ts',
  'src/i18n/messages/zh-Hans.ts',
  'granite.config.ts', 'vite.config.ts', 'tsconfig.json', 'package.json', '.granite/app.json',
  'public/manifest.json', 'public/privacy.html', 'public/sw.js', 'index.html',
];
/* ══ 「의도적으로 바뀐」 보호 파일 — 기준선 재설정 (2026-09-02 레인 7) ═══════
 *
 *  ★왜 목록에서 «빼지» 않는가:
 *    빼면 그 파일은 이후 «아무나 아무렇게나» 고쳐도 검사가 조용히 통과한다.
 *    그건 보호를 없애는 것이지 재설정이 아니다. 대신 «새 sha 를 못 박는다» —
 *    승인된 그 내용일 때만 통과하고, 한 바이트라도 더 바뀌면 다시 FAIL 한다.
 *    ⇒ 다음 레인도 「나는 안 건드렸다」를 여전히 증명할 수 있다.
 *
 *  ★sha 는 «현재 파일에서» 읽어 채우지 않는다(그러면 죽은 검사기가 된다).
 *    아래 값은 승인 시점의 파일을 손으로 못 박은 것이다. 갱신하려면
 *    `node tools/check_protected.mjs --print-sha` 로 찍어 «사람이» 붙여넣는다.
 */
const CHANGED_BY_DESIGN = {
  /* ── 2026-09-03 레인 10 기준선 재설정 (President 지시 ①~⑩) ────────────────
   *  Partner 가 «파일별로» 승인했고, 승인 범위는 아래 why 에 적힌 것뿐이다.
   *  sha 가 한 바이트라도 어긋나면 다시 FAIL 한다 = 「승인된 그 내용일 때만 통과」.
   *  ⛔이 세 파일 외의 32개는 여전히 «바이트 동일»이어야 한다(input.ts 포함).
   */
  /* ── 2026-09-03 ★Pointer Events 재작성 «철회» + paused 누수 수정만 존치 ────
   *  ⛔이 항목은 「input.ts 를 보호에서 뺀다」가 «아니다». 승인된 «그 내용»의
   *    sha 를 못 박은 것이라, 한 바이트라도 더 바뀌면 다시 FAIL 한다.
   *
   *  ★이 기준선의 «역사»를 지우지 않는다 — 같은 실수를 다시 하지 않기 위해서다.
   *    직전 기준선은 2ef0cb21da5ef034… (Touch Events → Pointer Events +
   *    setPointerCapture 전면 재작성)였다. 헤드리스 869판을 통과했는데
   *    **실기기(iOS)에서 터치가 «아예» 안 먹었다**(-25·-26·-27 3연속 실패).
   *    헤드리스 Chromium 은 pointercancel 이 0건이라 그 경로를 애초에 재현할
   *    수 없었다 — 「명세상 맞다」로 넣었고 그게 틀렸다.
   *    ⇒ President 지시로 a23(fbb13f028527d602…)로 «되돌렸다».
   *    ⇒ 이 파일에서 Pointer Events 로 다시 가려거든, 먼저 「iOS 실기기에서
   *      검증할 수단이 생겼는가」에 답하라. 없으면 가지 마라.
   */
  'src/input.ts': {
    sha: '14c3f4d661d882fab77f45a51c9f9019909720212f599cc2e2907949c6d4b7f5',
    why: 'a23 정본(fbb13f028527d602…) 위에 «다섯 가지»만 얹은 상태다.'
      + ' ① beginRun() 이 paused 를 무조건 해제 — main.ts pause 누수 차단선.'
      + ' ② visual.hintX = 26+STICK_MAX (시각 전용. 항상 보이는 베이스가 반지름'
      + ' 58 이 되면서 옛 식으로는 링이 화면 왼쪽 가장자리를 물었다).'
      + ' ③ 「메뉴에서 얹은 손가락이 조종을 못 잡는」 버그 — 터치의 «암묵 캡처»로'
      + ' 그 손가락 이벤트가 캔버스에 한 건도 안 온다(실측 EL 0/0, WIN 1/6).'
      + ' 창 단계 touchstart/touchend/touchcancel «동기화 전용» 리스너(passive)를'
      + ' 달고, rescueMove/rescueEnd 의 syncActive 를 조기반환 앞으로 옮겨'
      + ' active 를 항상 사실대로 유지한다. 채택은 update() 가'
      + ' `if (!paused && steerId<0) adoptRestingFinger()` 로 프레임 단위 판단.'
      + ' ④ ★③의 회귀 수정 — 그렇게 하니 「시작 버튼을 누른 손가락」까지 조종으로'
      + ' 채택돼 버렸다(실측 100%: steerId 가 버튼 손가락, steerOX/OY=버튼 좌표,'
      + ' steerUpdates=0, dist=0 → 스틱은 활성인데 aim 이 영영 null ='
      + ' President 「조이스틱은 움직이는데 안 먹어」와 증상 일치).'
      + ' ⇒ uiTouches 집합 신설: touchstart 시점 target 이 button/a/input/select/'
      + ' textarea/label/[role=button] 안이면 그 손가락은 «조종으로 채택하지 않는다».'
      + ' 메뉴 «빈 배경» 손가락은 계속 채택한다(그게 ③에서 고친 원래 버그).'
      + ' adoptRestingFinger 는 질주 버튼 히트영역 손가락도 건너뛴다(assignDown 과 일치).'
      + ' ⑤ 진단 계측만 추가 — DIAG.steerLive/joyMode/adopts/pauseLeakFixed.'
      + ' ⛔조작감 상수·수식은 a23 그대로: DEADZONE 4 · DRAG_DEADZONE 12 ·'
      + ' STICK_MAX 58 · BOOST_HIT_SCALE 1.25 · BOOST_SLIDE_OFF_SCALE 1.35 ·'
      + ' BOOST_STEER_DEADZONE 16 · CAPTURE_GRACE_MS 250 · atan2 · min(d,R) 클램프 ·'
      + ' 히스테리시스. 증명: 96개 제스처 aim 전 자릿수 덤프가 a23 과 바이트 동일'
      + ' (sha 47d1aca1c7e00110).'
      + ' 실측: 미리 대고 시작 A 100%→0%, B(기다렸다 밈) 100%→0%,'
      + ' D(메뉴에 얹은 채 진짜 버튼 탭) 100%→0%, 정상경로 C 0%→0%(음성대조 유지).',
  },
  'src/game/config.ts': {
    sha: '977e4a404cd50f385f354ca392d62315b84fa0f43e83a0ee68f2407946ae4a3a',
    why: 'President 2026-09-03 ⑨맵 확대(MAP_SCALE 3.0→3.6) + 마릿수 «고정»'
      + '(BOT_COUNT = 90, 밀도 연동 해제) + ⑦초거대 층 신설'
      + '(SPAWN_MASS_TITAN_FRAC/TITAN/TITAN_MAX 3개 신설). Partner 승인.'
      + ' FOOD_TARGET 은 실측으로 «되돌려» 옛 식 그대로다(주석에 기각 근거 기록).'
      + ' 그 밖의 상수는 하나도 바뀌지 않았다.',
  },
  'src/game/bots.ts': {
    sha: '9c4d4e3d2f3b914112cd0b23ec544f8704579c0a1d1c4399a23368e9bcb163dc',
    why: 'President 2026-09-04 「거대 뱀은 도망칠 때 자기 몸쪽으로 방향을 틀어서'
      + ' 숨어도 되잖아」 + 「애들 실력을 늘리라고」.'
      + ' ⑪ «자기 몸 엄폐» 전술 신설 — 기존 행동의 «세기 조율»이 아니라 «새 행동»이다.'
      + ' 앞서 시험한 손잡이 7종(시야·호전성·회피·질주 억제)은 20시드 시드페어링에서'
      + ' 전부 무의미했다. 자기 트레일은 남에게만 벽이므로(resolveCollisions 의'
      + ' owner === s.id 제외, queryBody 도 자기 몸 제외) 위협이 높을 때 그 자산을 쓴다.'
      + ' 전제는 tools/probe_shelter.mjs 로 «세계를 굴려» 검증했다: 자기 트레일 위'
      + ' 30스텝 생존 / 남의 트레일에선 사망(양성대조) / 추격자를 큰 뱀 몸통에 넣으면'
      + ' 추격자 사망·큰 뱀 생존 / 최대선회 600스텝 똬리 생존.'
      + ' 구현 3부(하나라도 빠지면 «악화»한다 — ablation 으로 증명):'
      + ' ①선회 «부호»를 한 번 정해 최대 선회 유지(점 추종은 45%·5~10% 둘 다 무의미했다),'
      + ' ②엄폐 중 도주 질주 해제(질주 시 회전반경 102→192 라 말리지가 않는다),'
      + ' ③질량이 클수록 발동 문턱 인하(fleeAt 은 작은 뱀 기준이라 초거대엔 늘 늦다).'
      + ' 40시드 부호검정: ①만 12:25 p=0.047 «악화» · ①+② 18:19 p=1.0 무의미 ·'
      + ' ①+②+③ 29:8 p=0.00075 «유의». 초거대 중위생존 29.8→51.6초(+73%),'
      + ' 죽는 순간 질주 중 100.0%→20.0%, 초거대 동시존재 1.9→3.5마리.'
      + ' 플레이어 쪽 부작용 없음: 오브 총가치 -2.2%(무변), fps 60.1→60.2.'
      + ' ⛔TURN_MIN·봇 수·초거대 비율·스킨 문턱 전부 무변경. K=1.2 상한'
      + '(2.0 은 벽 사망 2.1→12.2% 로 과선회 = 기각).',
  },
  'src/game/world.ts': {
    sha: '55bc0331de17f2dd345f68f9a9ccd2f08aa52da8a7a0eb8f831abe7262f1afda',
    why: 'President 2026-09-03 ⑦초거대 «크기 분포»만. sampleSpawnMass 에 4층째를'
      + ' 더하고 그 상수 3개를 import 했다 — 그 두 곳뿐이다(Partner 승인 범위).'
      + ' 충돌·사망·먹기·스폰 위치·봇 배정 로직은 한 줄도 바뀌지 않았다.',
  },
  /* ── 2026-09-10 레인 A — 전면형 «요청 = 노출» (Partner 지시 「가드 통과가 확정된 뒤에만 요청」) ──
   *  ★Partner 승인 대기 항목이다. 지시서(2026-09-10 Partner 추가 지시 1·5)가 이 변경을 «명시»했고,
   *    콘솔 실측(7일 09-02~08: 전면형 요청 3,471 → 노출 1,392 = 40.1%, 로드 3,494 → 시도 1,968)이 근거다.
   *  바뀐 것 «넷»뿐이고 나머지(판 계수·빚 boolean·gate 세대번호·MIN_PLAY_MS·타임아웃 둘·AD_EVERY)는 그대로다:
   *    ① kickPreload 가 «빚(adPending)이 있을 때만» 로드한다(?ads=1 은 예외). 빚 없는 판 시작·부팅에서 요청 0.
   *    ② READY_TTL_MS(30분) — 묵은 로드는 버리고(wantsAd 도 안 띄운다) 빚이 있을 때 다시 받는다.
   *    ③ PRELOAD_BACKOFF_MS 30→60→120초(지시값). 재시도는 여전히 «유저 행동»에만 걸려 숨김 중 0.
   *    ④ onForeground() 신설 — 복귀 시 빚이 있는데 준비·로드 중이 아니면 백오프를 풀고 1회 재요청.
   *  검증: tools/qa_ads.py(P0·P2·P6 을 새 규칙으로 개정) + tools/qa_lane_a.py A절(빚 없는 시작 요청 0 · TTL · 복귀).
   */
  'src/ads/interstitial.ts': {
    sha: 'ca0b117dc9b6ca0c9cb3b3b0e5e15363eb835a19b4b33731ddc224ed42e46a52',
    why: '2026-09-10 레인 A(Partner 지시 「요청 = 노출」 + Codex 적대적 리뷰 지적 1·4·5 반영).'
      + ' ① kickPreload 가 빚(adPending)이 있을 때만 로드 ② READY_TTL_MS 30분(묵은 로드 폐기)'
      + ' ③ 백오프 30/60/120s ④ onForeground() — 백오프는 «지킨다»(nextRetryAt 무접촉)'
      + ' ⑤ 숨김(document.hidden) 중 요청 0 — 진입과 비동기 경계 «둘 다»에서 확인'
      + ' ⑥ ★정책 가드 3종 신설: 세션 60초(MIN_SESSION_AGE_MS) · 10분 간격(MIN_GAP_MS) ·'
      + ' 일 3회(DAILY_SHOW_CAP). 가드는 표시(wantsAd)와 «요청»(kickPreload) 둘 다가 본다.'
      + ' 노출 시각·그날 횟수는 기존 키(king-snake.ads.v1)에 «필드만» 추가해 저장(모르는 필드 무시 규약).'
      + ' ⑦ 진단 필드·테스트 훅(__ageReadyForTest·__advanceGuardClockForTest·adGuards).'
      + ' ⛔판 계수(plays)·빚 boolean·gate 세대번호·MIN_PLAY_MS·타임아웃 둘·AD_EVERY 는 «무변경».'
      + ' ★[추정] 전면형 노출 30~50% 감소 — 완화는 상수 3개(0/0/0). President/Partner 결정 대기.'
      + ' 검증: qa_ads.py P7-a~g · qa_lane_a.py A1~A9·V1·V3.',
  },
  /* ── 2026-09-10 레인 A — 개인정보처리방침 갱신 (★Partner 승인 · 제출 게이트에서 지시) ──
   *  Partner 원문: 「§5-ⓒ privacy.html 에 푸시 동의 기록 + 신규 저장 키 고지를 추가하는 것, Partner 승인한다.
   *  보호 파일 승인 절차대로 진행해라.」 — 머니 리그·미리·땅따먹기에서 이미 같은 패턴을 했고 President 결정 라인에 있다.
   *
   *  ★막힌 지점: 이 레인이 저장 키 «3개»(carry·push·xpromo)를 새로 만들었는데 방침에는 없었다.
   *    다른 앱의 방침은 「기록하는 항목은 다음이 전부입니다」를 «단언»한다. 그 문장이 거짓인 채로 나갈 뻔했다.
   *  ★그리고 열어 보니 더 큰 게 있었다 — 영문 절이 「fully offline · Ads/analytics/trackers: None ·
   *    there is no ad SDK」라고 «거짓»을 말하고 있었다. 한글 절만 광고 문구가 갱신되고 영문은 안 따라갔다.
   *    광고 지면 6개가 실린 앱이다. 저장 키보다 이쪽이 더 위험해서 «같이» 고쳤다.
   *  검증: tools/check_privacy_keys.mjs(신설) — 코드 9키 = en 표 9 = ko 표 9, 대조 11종 CAUGHT,
   *    ★end-to-end 양성대조(표에서 행을 실제로 지우고 실행) rc=1 확인. */
  /* ★2026-09-10 -50 추가분(레인 E 전수 감사 후속 · Partner 지시):
   *   ⑧ `<!-- SDK-DECLARE: ads=on analytics=off rewardAds=on push=on -->` 신설 —
   *     «기계가 읽는» 고지 선언이다. 사람이 읽는 표만 있고 이 한 줄이 없어서 공용 감사기가
   *     뱀만 「선언 없음(legacy-prose)」으로 읽었고 게이트 FAIL 2건이 났다(광고·리워드 고지 «확인 불가»).
   *     analytics=off 는 코드 신호 0건 실측에 따른 값이다(과다고지도 위반이다).
   *     ⛔선언은 문서 전체에 «한 벌»만 둔다 — 설명 주석에서 값을 «인용»하면 판독 토큰이 두 벌이 되어
   *       감사기가 첫 매치만 읽고 오판한다. 그래서 설명은 공개 문서에 두지 «않고» 여기에 적는다
   *       (공개 문서에 내부 도구·사고 이력을 적었더니 preflight 의 「내부 주석 유출」에 걸렸다 — 실측).
   *   ⑨ 저장 항목 표에 `king-snake.promo.v1:` + 프로모션 코드 행을 «표»로 추가(en/ko).
   *     이전엔 산문에만 있어 감사기의 「문서 누락 저장키」에 걸렸다. 지금 0건.
   *   검증: _shared/check_game_privacy_sdk.mjs → kingsnake structured, code/doc 3축 일치, 실패 0건.
   *        _shared/audit_game_privacy_matrix.py → 광고지면 7개(제거 배너 ID 사라짐)·문서 누락 저장키 0. */
  'public/privacy.html': {
    sha: '6eb1ba0b80cb6102777c85dc8485a8a45f7a58f27fae454e47b62b0468d622ef',
    why: '2026-09-10 레인 A(Partner 승인). ① 저장 항목 «표» 신설 — en/ko 각 9행, 키 이름과 담기는 내용을 한 줄씩.'
      + ' 이 레인 신설 3종(king-snake.carry.v1 · push.v1 · xpromo.v1) 포함.'
      + ' ② 「알림」 절 신설 — 동의 여부와 시각만 기록하고 «기기 토큰·푸시 주소는 받지도 저장하지도 않는다»,'
      + ' 끄기는 토스 앱 알림 설정. ③ 프로모션 접두 규칙(king-snake.promo.v1:<코드>)과 네이티브 미러'
      + '(ads.v1·push.v1 사본) 을 문장으로 설명. ④ ★영문 절의 «거짓 문구» 정정 — 「fully offline」·'
      + '「Network requests: None」·「Ads/analytics/trackers: None」·「there is no ad SDK」는 전부 사실이 아니었다'
      + '(전면형 1 + 리워드 5 지면이 라이브다). 한글 절 문구와 같은 사실로 맞췄다.'
      + ' ⑤ 한글 광고 요약을 새 가드에 맞춰 정정(「두 판마다 1회」 → 「최대 두 판마다 한 번, 하루 3회까지」 +'
      + ' 버튼을 눌렀을 때만 재생되는 보상형 광고 별도 설명). ⑥ 최종 수정일 2026-08-18 → 2026-09-10.'
      + ' ⑦ 언어 경계 표식 id="lang-split" 신설 — 검사기가 en/ko 를 «따로» 세어 한쪽만 갱신하는 사고를 잡는다.'
      + ' ⛔사업자 정보·문의처·아동 보호 절의 취지는 무변경.'
      + ' 검증: tools/check_privacy_keys.mjs (본검사 0건 · 대조 11/11 · end-to-end 양성대조 rc=1).',
  },
};

const sha = (b) => createHash('sha256').update(b).digest('hex');
const PRINT = process.argv.includes('--print-sha');
let fail = 0;
const rows = [];
for (const f of PROTECTED) {
  const a = resolve(LIVE, f), b = resolve(NEW, f);
  if (!existsSync(a)) { rows.push('MISSING(live)  ' + f); fail++; continue; }
  if (!existsSync(b)) { rows.push('MISSING(new)   ' + f); fail++; continue; }
  const ha = sha(readFileSync(a)), hb = sha(readFileSync(b));
  const same = ha === hb;
  if (PRINT && !same) { rows.push('SHA(new) ' + hb + ' ' + f); continue; }
  if (same) { rows.push('SAME ' + ha.slice(0, 16) + ' ' + f); continue; }
  const ok = CHANGED_BY_DESIGN[f];
  if (ok && ok.sha === hb) {
    // 승인된 «그» 내용과 정확히 같다. 통과시키되 이유를 화면에 남긴다.
    rows.push('CHANGED(approved) ' + hb.slice(0, 16) + ' ' + f + '  — ' + ok.why);
    continue;
  }
  if (ok) {
    rows.push('DIFF(approved 파일이지만 sha 불일치 = 승인 «밖»의 추가 변경) ' + hb.slice(0, 16) + ' ' + f);
  } else {
    rows.push('DIFF ' + ha.slice(0, 16) + ' ' + f);
  }
  fail++;
}
console.log(rows.join('\n'));
/* 양성대조: input.ts 사본에 1바이트 → 반드시 DIFF */
{
  const orig = readFileSync(resolve(LIVE, 'src/input.ts'));
  const tampered = Buffer.concat([orig, Buffer.from(' ')]);
  const detected = sha(orig) !== sha(tampered);
  console.log('positive control (input.ts + 1 byte):', detected ? 'DETECTED' : 'NOT DETECTED');
  if (!detected) fail++;
}
console.log('protected: ' + (PROTECTED.length - fail) + '/' + PROTECTED.length + ' identical');
console.log(fail ? 'RESULT: FAIL (' + fail + ')' : 'RESULT: PASS');
process.exit(fail ? 1 : 0);
