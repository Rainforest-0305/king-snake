#!/usr/bin/env bash
# 레인 9(-23) 검사 «순차» 실행. ★동시에 돌리면 타이밍 검사가 흔들린다
# (_PROGRESS.md 함정 ①: 브라우저 검사기 동시 실행 시 R1-a2/qa_render 가 FAIL 났다가
#  단독 재실행에서 PASS). 그래서 한 번에 하나씩만 돈다.
set -u
cd "$(dirname "$0")/.."
LOG="_ability_evidence_260902/logs"
mkdir -p "$LOG"
run() {
  name="$1"; shift
  echo "=== $name"
  "$@" > "$LOG/$name.log" 2>&1
  rc=$?
  tail -3 "$LOG/$name.log"
  echo "--> $name rc=$rc"
}
run qa_reward      python tools/qa_reward.py dist
run qa_ads         python tools/qa_ads.py
run qa_banner      python tools/qa_banner.py dist
run qa_i18n        python tools/qa_i18n.py
run qa_ui          python tools/qa_ui.py
run qa_touch       python tools/qa_touch.py
run qa_safearea    python tools/qa_safearea.py
run qa_render      python tools/qa_render.py
run qa_save_compat python tools/qa_save_compat.py dist
run verify_adunlock python tools/verify_adunlock.py dist --dir
echo "ALL_DONE"
