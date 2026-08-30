# Setting this up on the Lenovo

Everything below is run from an ordinary PowerShell prompt in the project
folder. None of it needs administrator rights — and it shouldn't have them, for
the reason in step 4.

## 1. Install

```powershell
npm install
npx playwright install chromium
```

Playwright downloads its own Chromium (~150 MB). It is kept separate from the
Chrome you browse with on purpose: the scraper gets its own browser profile, so
signing it in cannot disturb your normal sessions and vice versa.

## 2. Fill in `.env`

```powershell
Copy-Item .env.example .env
notepad .env
```

You need `SUPABASE_ANON_KEY` — the same publishable key the Wazn widget uses.
It's in `wazn-review.js` in the benarabic repo, and in the Supabase dashboard
under Project Settings → API. Leave `SUPABASE_PASSWORD` blank; step 3 stores it
properly.

## 3. Sign in once

```powershell
npm run login
```

A real Chromium window opens on BYU's login page. It will:

1. Ask for your NetID and password at the terminal and encrypt them with DPAPI,
   which ties the ciphertext to your Windows account — copied to another machine
   the file is useless.
2. Fill in CAS and trigger Duo.
3. **Approve the push on your phone**, and tick *Remember this device* / *Yes,
   this is my device* if Duo offers it. The script clicks that for you where it
   can find it, but tick it yourself if you see it — everything unattended
   depends on that cookie.

Then it asks for your Supabase email and password and stores those the same way.

The result lives in `.browser-profile/`. That folder **is** the login: treat it
like a password, and don't copy it anywhere.

## 4. Check and try it

```powershell
npm run doctor       # every line should be a tick
npm run dry-run      # scrapes, writes data\, publishes nothing
```

`dry-run` prints a summary — assignments found per course, how many are graded,
how many are conversation-ready, and which ones got flagged. Expect some fields
to come back empty on the very first run; see the calibration section in the
README.

Once it looks right:

```powershell
npm run scrape       # the real thing, publishes to Supabase
```

## 5. Schedule it

```powershell
powershell -ExecutionPolicy Bypass -File windows\install-task.ps1
```

Registers **Term Board daily scrape** for 06:00. Pass `-Time '05:30'` for a
different hour.

It runs **as you**, not as SYSTEM — deliberately. The browser profile and the
DPAPI-encrypted password are both scoped to your Windows account, and a task
running as SYSTEM could read neither.

`-StartWhenAvailable` is set, so if the laptop is shut or asleep at 6am the
scrape runs the next time you open it rather than being skipped. It will not
wake the machine by itself.

Useful afterwards:

```powershell
Start-ScheduledTask   -TaskName 'Term Board daily scrape'   # run it now
Get-ScheduledTaskInfo -TaskName 'Term Board daily scrape'   # last result
Get-Content data\logs\scrape-*.log -Tail 40                 # what happened
Unregister-ScheduledTask -TaskName 'Term Board daily scrape'
```

## When it asks for Duo again

Roughly monthly, the trusted-device cookie expires. The task can't approve a
push with nobody there, so it stops with exit code 2 and raises a Windows
notification: *"BYU wants a Duo approval again."*

Run `npm run login`, approve once, and it's unattended for another 30 days.
Nothing else needs re-doing — the Supabase credentials and the scheduled task
are untouched.

## If something breaks

| Symptom | Cause | Fix |
|---|---|---|
| Exit code 2, toast about Duo | Trust cookie expired | `npm run login` |
| Exit code 1, "Supabase sign-in failed" | Password changed | `npm run login` |
| Runs fine, but assignments are empty | Selectors don't match the real markup | `npm run calibrate`, then edit `src/learningsuite/selectors.js` |
| Six courses always skipped | Their instructors still haven't published | Nothing to do — that's correct behaviour |
| Task never fires | Laptop shut at 06:00 | It should catch up; check `Get-ScheduledTaskInfo` |

## 6. Optional: let the Term Board refresh itself

The widget reads Supabase directly and needs nothing more. The **Term Board
artifact** is different: an Artifact runs under a content-security policy that
blocks every outbound request, so it cannot fetch its own data — it has to be
regenerated and republished by Claude.

Claude can't reach your Supabase rows (that needs your password), but it can
already read your Google Drive. So the scrape drops its output there and a daily
Claude routine picks it up.

```powershell
winget install Rclone.Rclone
rclone config          # n → name it "gdrive" → drive → accept the defaults
```

After that `windows\run-daily.ps1` copies `data\term-board.html` and
`data\latest.json` into a **Term Board** folder in your Drive on every successful
run. If rclone isn't installed the step is skipped silently and everything else
still works — you'd just refresh the board by asking Claude directly.
