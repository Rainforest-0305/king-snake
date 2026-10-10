#!/usr/bin/env bash
# 최종 검사 일괄(헤드리스, 순차). 로그 → _gfx_evidence_260830/qa2/
set -u
cd "$(dirname "$0")/.."
mkdir -p _gfx_evidence_260830/qa2
Q=_gfx_evidence_260830/qa2
node tools/check_protected.mjs > $Q/check_protected.log 2>&1; echo "check_protected: $(tail -1 $Q/check_protected.log)"
node tools/scan_ads.mjs dist ../coil-rush/dist/web > $Q/scan_ads.log 2>&1; echo "scan_ads: $(tail -1 $Q/scan_ads.log)"
python tools/qa_save_compat.py dist > $Q/qa_save_compat.log 2>&1; echo "qa_save_compat: $(head -1 $Q/qa_save_compat.log)"
for t in qa_render qa_ui qa_touch qa_i18n qa_safearea qa_ads qa_touch_input; do
  python tools/$t.py > $Q/$t.log 2>&1; rc=$?; echo "$t: rc=$rc $(grep -c -E 'FAIL|Error|Traceback' $Q/$t.log) fail-lines"
done
python tools/gfx_harness.py shots dist final_ios > $Q/shots_ko.log 2>&1; tail -1 $Q/shots_ko.log
python tools/gfx_harness.py shots dist final_ios_en --locale en > $Q/shots_en.log 2>&1; tail -1 $Q/shots_en.log
python tools/gfx_harness.py xfade dist xfade_final > $Q/xfade.log 2>&1; tail -1 $Q/xfade.log
echo QA_DONE
