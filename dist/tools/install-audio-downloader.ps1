$studioRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$toolsFolder = Join-Path $studioRoot '.sites-runtime\bin'
$ytDlpFile = Join-Path $toolsFolder 'yt-dlp.exe'
$expectedHash = 'F5389D3698ECDE4EF06F4E6B1CE0294FE9AC1396228C8990B8D3416D6D177A7D'

if ((Test-Path -LiteralPath $ytDlpFile) -and (Get-FileHash -LiteralPath $ytDlpFile).Hash -eq $expectedHash) {
    Write-Output 'yt-dlp 2026.10.26 is already installed and verified.'
    exit 0
}

New-Item -ItemType Directory -Path $toolsFolder -Force | Out-Null
$downloadFile = Join-Path $toolsFolder 'yt-dlp.download.exe'
Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe' -OutFile $downloadFile
if ((Get-FileHash -LiteralPath $downloadFile).Hash -ne $expectedHash) {
    throw 'yt-dlp checksum verification failed. The executable was not installed.'
}
if (-not ([IO.Path]::GetFullPath($ytDlpFile)).StartsWith(([IO.Path]::GetFullPath($studioRoot)) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The downloader destination must stay inside the studio project.'
}
Move-Item -LiteralPath $downloadFile -Destination $ytDlpFile -Force
Write-Output 'yt-dlp 2026.10.26 installed and verified.'
