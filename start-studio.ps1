Set-Location -LiteralPath $PSScriptRoot

$studioPort = if ($env:PORT) { [int]$env:PORT } else { 4318 }
$studioUrl = "http://127.0.0.1:$studioPort"

try {
    Invoke-WebRequest -Uri "$studioUrl/api/health/studio" -TimeoutSec 2 -UseBasicParsing | Out-Null
    Write-Output "Encore Studio is already running at $studioUrl"
    exit 0
} catch {
    # Start the service when no existing studio responds.
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
$dataFolder = Join-Path $PSScriptRoot 'data'
New-Item -ItemType Directory -Force -Path $dataFolder | Out-Null

$studioStart = @{
    FilePath = $nodePath
    ArgumentList = '"' + (Join-Path $PSScriptRoot 'dist/server/studio-server.mjs') + '"'
    WorkingDirectory = $PSScriptRoot
    WindowStyle = 'Hidden'
    RedirectStandardOutput = Join-Path $dataFolder 'server.log'
    RedirectStandardError = Join-Path $dataFolder 'server-error.log'
}
Start-Process @studioStart

for ($studioAttempt = 0; $studioAttempt -lt 30; $studioAttempt++) {
    try {
        Invoke-WebRequest -Uri "$studioUrl/api/health/studio" -TimeoutSec 2 -UseBasicParsing | Out-Null
        Write-Output "Encore Studio is ready at $studioUrl"
        exit 0
    } catch {
        Start-Sleep -Milliseconds 250
    }
}

throw 'The studio could not start. Check data/server-error.log for details.'
