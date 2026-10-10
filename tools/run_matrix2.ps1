# run_matrix2.ps1 - 벤치 매트릭스 2(거버너 빌드). 창 0, 순차(측정 오염 방지). 로그: _gfx_evidence_260830/bench/_matrix2_log.txt
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$log = Join-Path $root '_gfx_evidence_260830\bench\_matrix2_log.txt'
"START $(Get-Date -Format s)" | Out-File -FilePath $log -Encoding utf8
$fixed = @(@(4,10,600), @(4,30,200), @(4,56,100), @(8,10,600), @(8,30,200), @(8,56,100))
foreach ($s in $fixed) {
  $out = Join-Path $root ("_gfx_evidence_260830\bench\J_new_cpu{0}_n{1}_m{2}_bloomwatch.json" -f $s[0], $s[1], $s[2])
  if (Test-Path $out) { "SKIP exists $out" | Out-File -FilePath $log -Append -Encoding utf8; continue }
  "RUN J_new cpu$($s[0]) n$($s[1]) m$($s[2]) $(Get-Date -Format s)" | Out-File -FilePath $log -Append -Encoding utf8
  & python tools/gfx_harness.py bench dist J_new --cpu $s[0] --n $s[1] --mass $s[2] --layout ring 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
}
$adapt = @(@(8,30,200), @(16,30,200), @(16,56,100))
foreach ($s in $adapt) {
  $out = Join-Path $root ("_gfx_evidence_260830\bench\G2_new_cpu{0}_n{1}_m{2}_adaptive_bloomwatch.json" -f $s[0], $s[1], $s[2])
  if (Test-Path $out) { "SKIP exists $out" | Out-File -FilePath $log -Append -Encoding utf8; continue }
  "RUN G2_new cpu$($s[0]) n$($s[1]) m$($s[2]) adaptive $(Get-Date -Format s)" | Out-File -FilePath $log -Append -Encoding utf8
  & python tools/gfx_harness.py bench dist G2_new --cpu $s[0] --n $s[1] --mass $s[2] --layout ring --adaptive 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
}
"MATRIX_DONE $(Get-Date -Format s)" | Out-File -FilePath $log -Append -Encoding utf8
