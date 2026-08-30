<#
    Registers the daily scrape with Task Scheduler.

    Run once, from an ordinary (non-admin) PowerShell prompt in the project
    folder:

        powershell -ExecutionPolicy Bypass -File windows\install-task.ps1

    The task runs as you, not as SYSTEM. That matters: the browser profile and
    the DPAPI-encrypted password are both scoped to your Windows account, and a
    task running as anything else could not read either.
#>

[CmdletBinding()]
param(
    [string]$Time = '06:00',
    [string]$TaskName = 'Term Board daily scrape',
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

$script = Join-Path $ProjectRoot 'windows\run-daily.ps1'
if (-not (Test-Path $script)) { throw "Cannot find $script" }

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" `
    -WorkingDirectory $ProjectRoot

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

# StartWhenAvailable is the important one on a laptop: if the Lenovo was asleep
# or shut at 6am, the scrape runs at the next opportunity instead of being
# skipped for the day. It deliberately does NOT wake the machine — a laptop that
# powers itself up in the night to scrape a gradebook is not a good trade.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -MultipleInstances IgnoreNew `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 15)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description 'Scrapes BYU Learning Suite and publishes to the Term Board.' `
    -Force | Out-Null

Write-Host "Registered '$TaskName' — daily at $Time." -ForegroundColor Green
Write-Host ""
Write-Host "  Run it now:     Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Check it:       Get-ScheduledTaskInfo -TaskName '$TaskName'"
Write-Host "  Remove it:      Unregister-ScheduledTask -TaskName '$TaskName'"
Write-Host ""
Write-Host "If you have not run 'npm run login' yet, do that first — the task" -ForegroundColor Yellow
Write-Host "cannot approve a Duo prompt on its own." -ForegroundColor Yellow
