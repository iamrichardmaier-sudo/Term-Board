# Term Board scraper

Pulls BYU Learning Suite every morning and feeds four surfaces from one scrape:

| Surface | What it gets |
|---|---|
| **Term Board** (Claude Artifact) | Assignments grouped by week, colour-coded by class, with live gradebook scores |
| **TermBoard.js** (iOS Scriptable widget) | What's due next, current grades, and a one-tap voice walkthrough of an assignment |
| **Read Aloud** (`docs/read.html` + `ReadAloud.js`) | Any PDF, scans included, read out loud. Share a file to it, or hit Listen on a reading the scraper already pulled |
| **Supabase** | The durable copy: a snapshot per run, plus the extracted reading text |

It replaces the manual pull that put ARAB 201 and IHUM 242 onto the board and
the Google Calendar by hand.

## How it fits together

```
  Lenovo, 6am                 GitHub (public)                Your phone
  ┌───────────────┐           ┌────────────────────┐        ┌───────────┐
  │ Task Scheduler│── push ──▶│ docs/index.html    │──────▶ │ TermBoard │
  │  Playwright   │           │ docs/board.json    │ sched. │  widget   │
  │  + Chromium   │           └────────────────────┘        └───────────┘
  └───────────────┘
          │                                                       ▲
          │                   Supabase (private, RLS)             │
          │                   ┌──────────────────────┐            │
          └──── publish ─────▶│ term_board_snapshots │── grades ──┘
                              │ term_board_readings  │
                              └──────────────────────┘
```

**The split is deliberate.** This repository is public — it has to be, because
the widget fetches `board.json` with no credentials — so the committed files
carry the *schedule* only — assignment
titles and due dates, which is syllabus information. **Grades never go there.**
They live in Supabase behind row-level security, and the widget fetches them
signed in as you. If you skip the sign-in, the schedule still works and the
grades section says so.

Hosting the board in the repo is also what makes the widget possible at all: a
Claude artifact URL requires a login, so fetching one from Scriptable returns the
app shell or a 403, never the board.

### Where the widget actually reads from

`raw.githubusercontent.com`, not Pages. Pages only publishes from `main`, so
until this work is merged the Pages URL is a 404 and the widget shows nothing.
Raw serves any branch immediately, with no build step and no deploy wait.

The widget tries these in order and takes the first that returns real JSON:

1. `raw.githubusercontent.com/iamrichardmaier-sudo/Term-Board/main/docs/board.json`
2. `iamrichardmaier-sudo.github.io/Term-Board/board.json`

Raw needs nothing set up and answers the moment a commit lands. Pages is the
same file behind a nicer URL, and needs enabling once:
**Settings → Pages → Source: `main` / `docs`**.

### If you want grades on the public page anyway

`npm run web -- --publish-grades` includes them. `windows/publish-to-repo.ps1`
will refuse to push that to the public repo unless you do it by hand — the check
is there because a gradebook on an indexable URL is hard to take back.

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
| `npm run web` | Writes the hosted board into `../public/term-board`. |
| `npm run doctor` | Checks the setup without touching Learning Suite. |
| `node test/smoke.mjs` | Tests the date parsing, payload building and rendering. |
| `node test/widget-logic.mjs` | Tests the widget's date bucketing and grade merge. |
| `node test/widget-fit.mjs` | Estimates rendered height per widget size and fails on overflow. |
| `node test/reader.mjs` | Tests the reader's text pipeline — line unwrapping, running headers, sentence splitting. |
| `npm test` | All four. |

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
dedicated section on the board, with the reason.

The scraper still does not OCR — a nightly Playwright run is the wrong place to
spend four minutes a page on it, and a wrong reading committed to Supabase is
wrong for the rest of the term. **Read Aloud does**, on the phone, on demand,
and it labels what it did: an OCR'd page is marked `OCR` in the text and counted
on the header pill, so a garbled sentence is attributable rather than mysterious.
So `image-only` still means "the board cannot promise this one" — and it is no
longer a dead end.

## Read Aloud

Give it a PDF, it reads the PDF to you. Text PDFs and scans both.

```
  a PDF            docs/read.html                          your ears
  ┌────────┐      ┌───────────────────────────────┐       ┌─────────┐
  │ share  │─────▶│ pdf.js      text layer        │       │ device  │
  │ sheet  │      │   ↓ under 120 chars/page      │──────▶│  voice  │
  │  or    │      │ tesseract.js  OCR that page   │       │   or    │
  │ picker │      │   ↓                           │       │  cloud  │
  └────────┘      │ unwrap · dehyphenate · split  │       │  voice  │
                  └───────────────────────────────┘       └─────────┘
```

**Three ways in.** Share a PDF to **Read Aloud** from Files, Mail or Safari and
it starts immediately. Run the script and it opens a picker. Or open a reading
the scraper already extracted, straight from the board's **Listen** button —
that one skips the parsing entirely, because the text is already in Supabase.

**It is also just a URL.** The reader is a single page in `docs/`, so
[read.html](https://iamrichardmaier-sudo.github.io/Term-Board/read.html) works
in any browser, on a laptop or a borrowed phone, with no Scriptable involved.
That is the whole reason it lives there and not as a string inside the script:
one copy of the code, two ways to run it.

### OCR only where it is needed

Every page is asked for its text layer first, and the verdict is counted up
before a single pixel is rendered. A forty-page born-digital reading therefore
never touches tesseract, never downloads the 15 MB model, and is ready in about
a second. A scan takes roughly five to fifteen seconds a page on a recent
iPhone, shown page by page on a progress meter rather than behind a spinner.

Pages that came from OCR are **labelled as such** — in the text, on the header
pill, and in the status line under the controls. That is the deal that makes
OCR acceptable here: not "trust it", but "here is which part you should not".

### Voices

| | Sounds like | Costs | Works offline |
|---|---|---|---|
| Device | fine, once you download a Premium voice | nothing | yes |
| ElevenLabs | a person | ~$0.001 a page | no |
| OpenAI | a person | ~$0.0003 a page | no |

**Do the free thing first.** Settings → Accessibility → Spoken Content → Voices
→ English → download a *Premium* voice. iOS ships compact voices by default and
only exposes what is installed, so the reader is choosing from a bad list until
you fix that — it is the difference between a satnav and a person, and it takes
a minute.

For a cloud voice, paste a key into the ⚙ sheet (in Safari) or the script's
**Voice settings** menu (in Scriptable). Text goes out in ~350-character
chunks, the next chunk is fetched while the current one plays, and the sentence
highlight is interpolated across the chunk — so tapping a sentence seeks to the
right second instead of restarting the paragraph. If the API refuses, the reader
says why and drops to the device voice rather than sitting there silently.

### What it will not do

- **Keep talking with the screen locked, from Scriptable.** A Scriptable WebView
  is suspended when it goes to the background. Opened in Safari with a cloud
  voice it keeps playing, with lock-screen controls; with a device voice it does
  not. This is a WebKit limitation, not a setting.
- **Read a language you have not given it.** OCR defaults to `eng`; set another
  [tesseract code](https://tesseract-ocr.github.io/tessdoc/Data-Files) in the ⚙
  sheet (`ara`, `fra`, …) and it fetches that model. Voice selection weights
  language above everything else, so an Arabic reading will not be handed to an
  English voice that merely sounds nicer.
- **Fix a bad scan.** A photo of a page at an angle in poor light comes out as
  nonsense, and it will read the nonsense. Check the OCR label before trusting
  a sentence that surprises you.

## Privacy

Scraped data is grades and instructors' copyrighted reading text, so:

- `data/`, `calibration/`, `.browser-profile/` and `.credentials/` are all
  gitignored. **Do not commit them** — this code lives in a public repository.
- Supabase rows are protected by row-level security scoped to your user. The
  anon key in the widget grants nothing on its own, exactly as in `wazn-review.js`.
- Your BYU password is encrypted with DPAPI under your Windows account. It is
  never written to the repo, and only needed when the Duo trust lapses.

Read Aloud adds two of its own:

- **PDFs never leave the phone.** Parsing and OCR both run on-device. The
  network is touched only to fetch the libraries and, on first use of a
  language, the OCR model.
- **A cloud voice is an exception to that, and a real one.** Choosing ElevenLabs
  or OpenAI sends the text of what you are reading to that company, a few
  hundred characters at a time. For a course reading that is someone's
  copyrighted text going to a third party — fine for most things, worth a
  thought for some. The device voice sends nothing anywhere. API keys are held
  in the iOS keychain when the reader is launched from Scriptable, and in the
  page's own `localStorage` when it is opened as a URL.

## Layout

```
src/
  index.js            CLI
  config.js           courses, term dates, URL shapes
  auth.js             CAS + Duo, persistent browser profile
  scrape.js           orchestrates one full pass
  normalize.js        raw scrape -> snapshot + readings
  render.js           snapshot -> Term Board HTML
  publish-web.js      snapshot -> public/term-board (grades withheld)
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
scriptable/TermBoard.js         the widget
scriptable/TermBoard-loader.js  optional: fetches the above at run time
scriptable/ReadAloud.js         courier: PDF bytes -> the reader page -> your ears
docs/read.html                  the reader itself. Also just a URL.
supabase/001_term_board.sql
windows/run-daily.ps1  install-task.ps1  publish-to-repo.ps1
test/smoke.mjs  widget-logic.mjs  widget-fit.mjs  reader.mjs
```
