param(
  [Parameter(Mandatory = $true)][int]$RootPid,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [int]$IntervalSeconds = 10
)

$ErrorActionPreference = 'SilentlyContinue'
$logicalProcessors = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
$previousCpu = $null
$previousTime = $null

while ($true) {
  $all = @(Get-CimInstance Win32_Process)
  $root = $all | Where-Object { $_.ProcessId -eq $RootPid -and $_.Name -eq 'chrome.exe' } | Select-Object -First 1
  if (-not $root) { break }

  $pids = [System.Collections.Generic.HashSet[int]]::new()
  [void]$pids.Add($RootPid)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($process in $all) {
      if ($pids.Contains([int]$process.ParentProcessId) -and $pids.Add([int]$process.ProcessId)) { $changed = $true }
    }
  }

  $processes = @(Get-Process -Id @($pids) -ErrorAction SilentlyContinue)
  $now = Get-Date
  $cpuSeconds = ($processes | Measure-Object -Property CPU -Sum).Sum
  $workingSetBytes = ($processes | Measure-Object -Property WorkingSet64 -Sum).Sum
  $privateBytes = ($processes | Measure-Object -Property PrivateMemorySize64 -Sum).Sum
  $elapsed = if ($previousTime) { [Math]::Max(0.001, ($now - $previousTime).TotalSeconds) } else { $null }
  $cpuOneCorePct = if ($null -ne $previousCpu -and $elapsed) { 100 * ($cpuSeconds - $previousCpu) / $elapsed } else { $null }
  # Per-process GPU and host counters are unavailable on this workstation. Avoid
  # Get-Counter's one-second sampling waits so resource monitoring stays light.
  $nvidiaUtilPct = $null
  $nvidiaMemoryMB = $null
  try {
    $nvidia = (& nvidia-smi.exe --query-gpu=utilization.gpu,memory.used --format=csv,noheader,nounits 2>$null | Select-Object -First 1) -split ','
    if ($nvidia.Count -ge 2) { $nvidiaUtilPct = [double]$nvidia[0].Trim(); $nvidiaMemoryMB = [double]$nvidia[1].Trim() }
  } catch {}

  $record = [ordered]@{
    timestampUtc = $now.ToUniversalTime().ToString('o')
    rootPid = $RootPid
    processCount = $processes.Count
    cpuPctOfOneCore = $cpuOneCorePct
    cpuPctOfMachine = if ($null -ne $cpuOneCorePct -and $logicalProcessors) { $cpuOneCorePct / $logicalProcessors } else { $null }
    workingSetMB = if ($workingSetBytes) { $workingSetBytes / 1MB } else { $null }
    privateBytesMB = if ($privateBytes) { $privateBytes / 1MB } else { $null }
    hostCpuPct = $null
    chromeGpu3dMaxEnginePct = $null
    chromeGpuDedicatedMB = $null
    chromeGpuSharedMB = $null
    nvidiaDeviceUtilPct = $nvidiaUtilPct
    nvidiaDeviceMemoryUsedMB = $nvidiaMemoryMB
  }
  Add-Content -LiteralPath $OutputPath -Value (ConvertTo-Json -InputObject $record -Compress) -Encoding utf8
  $previousCpu = $cpuSeconds
  $previousTime = $now
  Start-Sleep -Seconds $IntervalSeconds
}
