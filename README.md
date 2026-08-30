# Term Board scraper

Pulls BYU Learning Suite every morning and feeds three things from one scrape:

| Surface | What it gets |
|---|---|
| **Term Board** (Claude Artifact) | Assignments grouped by week, colour-coded by class, with live gradebook scores |
| **TermBoard.js** (iOS Scriptable widget) | What's due next, current grades, and a one-tap voice walkthrough of an assignment |
| **Supabase** | The durable copy: a snapshot per run, plus the extracted reading text |

It replaces the manual pull that put ARAB 201 and IHUM 242 onto the board and
the Google Calendar by hand.

## How it fits together

```
  Lenovo, 6am                    Supabase (private, RLS)         Your phone
  ┌───────────────┐              ┌──────────────────────┐        ┌──────────┐
  │ Task Scheduler│─── scrape ──▶│ term_board_snapshots │◀──────│ TermBoard │
  │  Playwright   │              │ term_board_readings  │        │  widget   │
  │  + Chromium   │              └──────────────────────┘        └──────────┘
  └───────────────┘                        │
          │                                │  daily Claude routine
          └── data/term-board.html ────────┴──▶ republishes the Term Board artifact
```

The artifact is regenerated rather than fetching for itself, because an Artifact
runs under a content-security policy that blocks every outbound request. It
cannot poll. So the scraper renders the HTML and a scheduled Claude routine
publishes it to the same URL.

## Setup

Windows setup — credentials, Duo, and the scheduled task — is in
[SETUP-WINDOWS.md](SETUP-WINDOWS.md). The short version:

```powershell
npm install
npx playwright install chromium
npm run login          # one headed sign-in; approve Duo, tick "remember"
npm run doctor         # confirms everything is in place
npm run dry-run        # scrape without publishing
powershell -ExecutionPolicy Bypass -File windows\install-task.ps1
```

## Commands

| Command | What it does |
|---|---|
| `npm run login` | Headed sign-in. Seeds the browser profile and stores credentials with DPAPI. Re-run when Duo's 30-day trust expires. |
| `npm run scrape` | The daily run: scrape, write `data/`, publish to Supabase, render the board HTML. |
| `npm run dry-run` | The same, without touching Supabase. |
| `npm run calibrate` | Dumps Learning Suite's real markup to `calibration/`. See below. |
| `npm run render` | Rebuilds the board HTML from the last snapshot. |
| `npm run doctor` | Checks the setup without touching Learning Suite. |
| `node test/smoke.mjs` | Tests the date parsing, payload building and rendering. |

## The selectors need one calibration pass

**This is the one thing that will not work out of the box.** Learning Suite sits
behind CAS, so `src/learningsuite/selectors.js` was written from the URL shape
rather than from the live markup — the course-id pattern is confirmed (it is
visible in the gradebook links already on the board), but the table and column
selectors are educated guesses.

They are all in that one file, and the parsers fall back to generic table
reading, so the realistic first-run outcome is "most fields, some missing"
rather than "nothing". To fix the rest:

```powershell
npm run calibrate
```

That writes `calibration/<date>/` with each page's HTML and a `report.json`
listing every table found, its headers, and its first row. Match those headers
against the `columns` lists in `selectors.js` and correct them. Nothing else in
the project needs to change.

## What gets flagged

The point of extracting text rather than collecting PDF links is the voice
walkthrough: Claude can only talk you through a reading it can actually read.
Every assignment therefore carries a verdict:

| `textQuality` | Meaning |
|---|---|
| `clean` | Enough real text to walk through. `conversationReady: true`. |
| `sparse` | Some text, but too little — a thin text layer, or a mostly-blank worksheet. |
| `image-only` | A scan or a photo of a page. No text at all without OCR. |
| `none` | Nothing on the assignment page and no attachments. |
| `error` | The page or file could not be fetched. |

Anything but `clean` shows as **⚑ no clean text** in the widget and in a
dedicated section on the board, with the reason. OCR would fix the `image-only`
cases; it is deliberately not in scope here, because a wrong OCR reading spoken
aloud with confidence is worse than an honest "this one won't work".

## Privacy

Scraped data is grades and instructors' copyrighted reading text, so:

- `data/`, `calibration/`, `.browser-profile/` and `.credentials/` are all
  gitignored. **Do not commit them** — this code lives in a public repository.
- Supabase rows are protected by row-level security scoped to your user. The
  anon key in the widget grants nothing on its own, exactly as in `wazn-review.js`.
- Your BYU password is encrypted with DPAPI under your Windows account. It is
  never written to the repo, and only needed when the Duo trust lapses.

## Layout

```
src/
  index.js            CLI
  config.js           courses, term dates, URL shapes
  auth.js             CAS + Duo, persistent browser profile
  scrape.js           orchestrates one full pass
  normalize.js        raw scrape -> snapshot + readings
  render.js           snapshot -> Term Board HTML
  supabase.js         publish / fetch
  dates.js            Learning Suite dates -> ISO with the right Mountain offset
  credentials.js      DPAPI storage
  calibrate.js        markup dumper
  learningsuite/
    selectors.js      ← every DOM assumption, in one file
    dom.js            generic table reading
    courses.js  assignments.js  gradebook.js  content.js
  extract/
    pdf.js            pdf.js text + scanned detection
    html.js           HTML -> text
  template/styles.css the Term Board's own CSS, reused unchanged
scriptable/TermBoard.js
supabase/001_term_board.sql
windows/run-daily.ps1  install-task.ps1
test/smoke.mjs
```
