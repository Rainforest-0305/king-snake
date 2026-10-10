// deploy_pages.mjs - GitHub Pages 배포.
//
// 배포 대상: store/pwa/  ->  https://rainforest-0305.github.io/king-snake/
//
// ★ 왜 «레포 하나 = 게임 하나» 인가:
//   기존 7종(sumo-bounce / prism-grid / neon-thread / bloom-circuit /
//   territory-clash / money-league / animal-rider)이 전부 그 구조다
//   (Downloads/창업 서비스/Games for MS Store/_tools/identity.json 실측).
//   그래서 vite 의 base 는 './' 로 충분하다 - 각 레포가 «자기 루트»로 서빙된다.
//   한 레포의 하위 폴더로 바꾸면 base 를 '/king-snake/' 로 고쳐야 한다.
//
// ★ .nojekyll 이 반드시 있어야 한다. Jekyll 은 '_' 로 시작하는 경로를 통째로
//   지운다 - vite 가 해시 자산을 그런 이름으로 내보내면 조용히 404 가 난다.
//   (build_pwa.py 가 생성한다. 여기서는 «있는지 확인»만 한다.)
//
// 실행:
//   node tools/deploy_pages.mjs            # 실제 배포
//   node tools/deploy_pages.mjs --dry-run  # 확인만

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DRY = process.argv.includes('--dry-run');

// fileURLToPath 를 «반드시» 쓴다.
//   new URL(...).pathname 은 «URL 인코딩된» 문자열이다. 이 프로젝트 경로에는
//   한글(20260802_Partner업무 / 16_지렁이게임)이 들어 있어 %EC%97%85... 로 바뀌고,
//   그 상태로 fs 에 넘기면 「파일이 없다」가 된다. 실제로 배포 사전검증이 전부
//   «없음»으로 떨어졌다(2026-08-18). 윈도우 드라이브 문자 처리도 함께 해결된다.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'store', 'pwa');
/**
 * ★ 배포용 git 작업본은 «store/pwa 밖»에 둔다.
 *   처음엔 store/pwa 자체를 git 저장소로 만들었는데, build_pwa.py 가 매 빌드마다
 *   store/pwa 를 rmtree 로 통째로 지운다 - 그때 .git/objects 의 읽기전용 파일에서
 *   PermissionError 로 «빌드가 죽었다»(실측 2026-08-18).
 *   산출물 폴더와 배포 저장소는 «다른 것»이다. 섞으면 서로를 망가뜨린다.
 */
const WORK = path.join(ROOT, 'store', '_deploy');
const OWNER = 'Rainforest-0305';
const REPO = 'king-snake';
const PAGES_URL = `https://rainforest-0305.github.io/${REPO}/`;

function readToken() {
  const envPath = 'C:/Users/USER/ventures/gongsi-alert/.env';
  const t = fs.readFileSync(envPath, 'utf8');
  const m = t.match(/GITHUB_TOKEN\s*=\s*(\S+)/);
  if (!m) throw new Error('GITHUB_TOKEN 을 찾을 수 없다: ' + envPath);
  return m[1];
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
}

async function api(token, method, urlPath, body) {
  const res = await fetch('https://api.github.com' + urlPath, {
    method,
    headers: {
      Authorization: 'token ' + token,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'king-snake-deploy',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 텍스트 그대로 둔다 */ }
  return { status: res.status, json, text };
}

// ── 사전 검증: 배포할 것이 «실제로» 있는가 ─────────────────────────────
function preflight() {
  const must = ['index.html', 'manifest.json', 'sw.js', '.nojekyll', 'privacy.html'];
  const missing = must.filter((f) => !fs.existsSync(path.join(SRC, f)));
  if (missing.length) {
    throw new Error(
      '배포 소스가 불완전하다 (' + missing.join(', ') + ' 없음).\n' +
      '먼저: npm run icons && npm run build:web && python tools/build_pwa.py',
    );
  }
  const files = [];
  (function walk(d, rel) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = path.join(d, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(p, r);
      else files.push({ r, size: fs.statSync(p).size });
    }
  })(SRC, '');
  const total = files.reduce((a, f) => a + f.size, 0);
  console.log('배포 소스: ' + files.length + '개 파일, ' + (total / 1024 / 1024).toFixed(2) + ' MB');

  // 외부 URL 참조 0건 재확인(스토어 신고 내용과 일치해야 한다).
  let ext = 0;
  for (const f of files) {
    if (!/\.(html|js|json|css)$/.test(f.r)) continue;
    const s = fs.readFileSync(path.join(SRC, f.r), 'utf8');
    for (const m of s.matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
      const u = m[0];
      // 스키마 URN(w3.org 등)과 mailto 는 «요청»이 아니다.
      if (u.includes('www.w3.org') || u.startsWith('mailto:')) continue;
      ext++;
      console.log('  외부 URL: ' + f.r + ' -> ' + u.slice(0, 80));
    }
  }
  console.log('외부 URL 참조: ' + ext + '건' + (ext === 0 ? ' (요건 충족)' : ' ★확인 필요'));
  return files.length;
}

async function main() {
  preflight();
  if (DRY) {
    console.log('\n--dry-run: 여기까지. 실제 배포는 옵션 없이 실행.');
    return;
  }

  const token = readToken();

  // 1) 레포 확인 / 생성
  let r = await api(token, 'GET', `/repos/${OWNER}/${REPO}`);
  if (r.status === 404) {
    console.log('레포가 없다. 생성한다: ' + OWNER + '/' + REPO);
    r = await api(token, 'POST', '/user/repos', {
      name: REPO,
      description: 'King Snake - single-player snake arena. Offline, no tracking.',
      homepage: PAGES_URL,
      private: false,
      has_issues: false,
      has_projects: false,
      has_wiki: false,
      auto_init: false,
    });
    if (r.status >= 300) throw new Error('레포 생성 실패 ' + r.status + ': ' + r.text.slice(0, 300));
    console.log('생성됨: ' + r.json.full_name);
  } else if (r.status >= 300) {
    throw new Error('레포 조회 실패 ' + r.status + ': ' + r.text.slice(0, 300));
  } else {
    console.log('레포 존재: ' + r.json.full_name);
  }

  // 2) store/pwa 를 «독립 git 저장소»로 만들어 강제 푸시.
  //    ★ 프로젝트 전체를 올리지 않는다. 소스맵/노드모듈/한국어 주석이 그대로
  //      공개되는 사고가 있었다(04_땅따먹기 DEPLOYMENT_ID.md 기록).
  //      배포물은 «빌드 산출물만» 올린다.
  // 작업본 준비: .git 만 남기고 전부 비운 뒤 산출물을 그대로 복사한다.
  //   («덮어쓰기»만 하면 지워진 파일이 배포본에 남는다 - 옛 이름 자산이 그렇게 샌다.)
  fs.mkdirSync(WORK, { recursive: true });
  for (const e of fs.readdirSync(WORK)) {
    if (e === '.git') continue;
    fs.rmSync(path.join(WORK, e), { recursive: true, force: true });
  }
  fs.cpSync(SRC, WORK, { recursive: true });

  const git = (...a) => sh('git', a, { cwd: WORK });
  if (!fs.existsSync(path.join(WORK, '.git'))) git('init', '-q');
  try { git('config', 'user.name', 'Rainforest-0305'); } catch { /* noop */ }
  try { git('config', 'user.email', 'urimk0305@gmail.com'); } catch { /* noop */ }
  git('checkout', '-B', 'main');
  git('add', '-A');
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  try {
    git('commit', '-q', '-m', 'Deploy King Snake PWA (' + stamp + ')');
  } catch (e) {
    const msg = String(e.stdout || e.message);
    if (!/nothing to commit/i.test(msg)) throw e;
    console.log('변경 없음 - 기존 커밋 재사용');
  }
  const remote = `https://${token}@github.com/${OWNER}/${REPO}.git`;
  try { git('remote', 'remove', 'origin'); } catch { /* noop */ }
  git('remote', 'add', 'origin', remote);
  git('push', '-q', '-f', 'origin', 'main');
  console.log('푸시 완료 -> ' + OWNER + '/' + REPO + ' main');
  // ★ 토큰이 박힌 remote 를 남기지 않는다.
  try { git('remote', 'set-url', 'origin', `https://github.com/${OWNER}/${REPO}.git`); } catch { /* noop */ }

  // 3) Pages 활성화
  let pg = await api(token, 'GET', `/repos/${OWNER}/${REPO}/pages`);
  if (pg.status === 404) {
    pg = await api(token, 'POST', `/repos/${OWNER}/${REPO}/pages`, {
      source: { branch: 'main', path: '/' },
    });
    console.log('Pages 활성화 요청: ' + pg.status);
  } else {
    console.log('Pages 이미 활성: ' + (pg.json && pg.json.html_url));
  }

  // 4) 실제로 뜨는지 «확인»한다. 「배포했다」가 아니라 「응답했다」가 증거다.
  console.log('\n배포 확인 중 (GitHub Pages 는 첫 빌드에 1~2분 걸린다)...');
  for (let i = 0; i < 30; i++) {
    await new Promise((r2) => setTimeout(r2, 8000));
    try {
      const res = await fetch(PAGES_URL, { redirect: 'follow' });
      const body = res.ok ? await res.text() : '';
      if (res.ok && body.includes('King Snake')) {
        console.log('  ' + ((i + 1) * 8) + '초: HTTP ' + res.status + ' - 본문에 King Snake 확인');
        console.log('\n라이브: ' + PAGES_URL);
        return;
      }
      console.log('  ' + ((i + 1) * 8) + '초: HTTP ' + res.status);
    } catch (e) {
      console.log('  ' + ((i + 1) * 8) + '초: ' + String(e.message).slice(0, 60));
    }
  }
  console.log('\n★ 4분 안에 응답하지 않았다. 레포 Settings > Pages 를 직접 확인하라: ' + PAGES_URL);
  process.exitCode = 1;
}

main().catch((e) => {
  console.error('배포 실패:', e.message);
  process.exit(1);
});
