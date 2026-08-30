<#
    Term Board — daily scrape.

    Invoked by Task Scheduler. Everything it prints goes to a dated log so a
    failure at 6am is still diagnosable at 6pm.

    Exit codes from the scraper:
        0  fine
        1  something broke
        2  Duo needs a human — the 30-day trusted-device cookie has expired
#>

[CmdletBinding()]
param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
Set-Location $ProjectRoot

$logDir = Join-Path $ProjectRoot 'data\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("scrape-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))

function Notify {
    param([string]$Title, [string]$Message)
    # A plain toast via the Windows Runtime. Deliberately best-effort: a missing
    # notification must never turn a working scrape into a failed one.
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
            [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $texts = $template.GetElementsByTagName('text')
        $texts.Item(0).AppendChild($template.CreateTextNode($Title)) | Out-Null
        $texts.Item(1).AppendChild($template.CreateTextNode($Message)) | Out-Null
        $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Term Board').Show($toast)
    } catch {
        Write-Warning "Could not show a notification: $_"
    }
}

"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') — starting ===" | Tee-Object -FilePath $log -Append

& node src/index.js scrape 2>&1 | Tee-Object -FilePath $log -Append
$code = $LASTEXITCODE

switch ($code) {
    0 {
        # Best-effort: the scrape has already succeeded, and the widget reads
        # Supabase directly, so a failed Drive copy must not fail the run.
        try {
            & (Join-Path $PSScriptRoot 'publish-to-drive.ps1') 2>&1 |
                Tee-Object -FilePath $log -Append
        } catch {
            "Drive copy failed (not fatal): $_" | Tee-Object -FilePath $log -Append
        }
        "=== finished cleanly ===" | Tee-Object -FilePath $log -Append
    }
    2 {
        "=== needs re-authorisation ===" | Tee-Object -FilePath $log -Append
        Notify 'Term Board needs you' 'BYU wants a Duo approval again. Run "npm run login" on this PC to renew it for another 30 days.'
    }
    default {
        "=== failed with exit code $code ===" | Tee-Object -FilePath $log -Append
        Notify 'Term Board scrape failed' "Exit code $code. See data\logs for the details."
    }
}

# Keep a fortnight of logs; the scraped data itself lives in Supabase.
Get-ChildItem $logDir -Filter 'scrape-*.log' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 14 |
    Remove-Item -Force -ErrorAction SilentlyContinue

exit $code
