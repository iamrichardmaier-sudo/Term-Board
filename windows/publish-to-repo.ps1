<#
    Commits the hosted board and pushes, so GitHub Pages redeploys it and the
    Scriptable widget sees fresh data.

    This is what makes the board self-updating. Only two files move:

        docs/index.html   the board page
        docs/board.json   the widget's feed

    Neither contains grades — the scraper withholds them, because Pages is
    public. Scores stay in Supabase and reach the widget from there.

    Called by run-daily.ps1 after a successful scrape. Safe to run by hand.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
Set-Location $RepoRoot

if (-not (Test-Path (Join-Path $RepoRoot '.git'))) {
    Write-Host "No git repo at $RepoRoot — skipping the repo publish."
    exit 0
}

$paths = @('docs/index.html', 'docs/board.json')

# Nothing to do on a day when the board did not change — an empty commit every
# morning would bury the real history.
$changed = & git status --porcelain -- $paths
if (-not $changed) {
    Write-Host 'Board unchanged — nothing to publish.'
    exit 0
}

# Refuse to publish anything with scores in it, whatever the renderer did.
# This is the last line of defence before a gradebook reaches a public URL.
$json = Get-Content 'docs/board.json' -Raw | ConvertFrom-Json
if ($json.gradesArePrivate -ne $true) {
    Write-Warning 'board.json is marked as containing grades. Refusing to push to a public repo.'
    Write-Warning 'Re-run the scrape without --publish-grades, or push it yourself if this is deliberate.'
    exit 1
}

& git add -- $paths
& git -c core.hooksPath=/dev/null commit -m "Update Term Board — $(Get-Date -Format 'yyyy-MM-dd')" | Out-Null
& git push origin $Branch

Write-Host "Published $($json.assignments.Count) assignments to GitHub Pages."
Write-Host 'Pages takes a minute or two to redeploy.'
