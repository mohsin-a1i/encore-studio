$studioPort = if ($env:PORT) { [int]$env:PORT } else { 4318 }
$studioListener = Get-NetTCPConnection -LocalPort $studioPort -State Listen -ErrorAction SilentlyContinue |
    Where-Object LocalAddress -eq '127.0.0.1'

if ($studioListener) {
    $studioProcess = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $studioListener.OwningProcess)
    if (-not $studioProcess.CommandLine) {
        throw "Cannot inspect the process on port $studioPort. Run restart-studio.ps1 from an Administrator PowerShell to restart the protected studio process."
    }
    $expectedStudioScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'dist/server/studio-server.mjs'))
    $previousStudioScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'server.mjs'))
    if (($studioProcess.CommandLine -notlike ('*' + $expectedStudioScript + '*')) -and ($studioProcess.CommandLine -notlike ('*' + $previousStudioScript + '*'))) {
        throw "Port $studioPort belongs to another application."
    }
    Stop-Process -Id $studioListener.OwningProcess
}

& (Join-Path $PSScriptRoot 'start-studio.ps1')
