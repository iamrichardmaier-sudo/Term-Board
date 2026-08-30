<#
    Copies the rendered board and the snapshot into Google Drive, so the daily
    Claude routine has something to read.

    Why Drive rather than a direct publish: the Term Board is an Artifact, and
    an Artifact cannot fetch its own data — the sandbox blocks every outbound
    request. It has to be regenerated and republished by Claude. Claude can
    already read your Drive; it cannot reach your Supabase rows, because those
    need your password. Drive is the one private channel both ends already have.

    Requires rclone with a Google Drive remote (see SETUP-WINDOWS.md). If rclone
    is not configured this exits quietly — the scrape itself has already
    succeeded by this point, and the widget does not depend on this step.
#>

[CmdletBinding()]
param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$Remote = 'gdrive',
    [string]$Folder = 'Term Board'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) {
    Write-Host 'rclone not installed — skipping the Drive copy.'
    exit 0
}

$remotes = & rclone listremotes 2>$null
if ($remotes -notcontains "${Remote}:") {
    Write-Host "rclone has no '$Remote' remote — skipping the Drive copy."
    exit 0
}

$board = Join-Path $ProjectRoot 'data\term-board.html'
$snapshot = Join-Path $ProjectRoot 'data\latest.json'

foreach ($file in @($board, $snapshot)) {
    if (Test-Path $file) {
        & rclone copy $file "${Remote}:$Folder/" --no-traverse
        Write-Host "Uploaded $(Split-Path -Leaf $file)"
    }
}
