// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: calendar-check;

/**
 * Term Board — home-screen widget and assignment browser for Scriptable (iOS)
 * ---------------------------------------------------------------------------
 * WIDGET   Two sections: current grades, then what's due soon. Tapping opens
 *          the full board in Safari.
 *
 * IN APP   Every assignment for the term with its score, and a "Start
 *          Conversation" action on the ones whose reading came through as
 *          clean text.
 *
 * WHERE THE DATA COMES FROM
 *
 *   Assignments  A plain JSON file on GitHub Pages, written by the scraper and
 *                committed to the benarabic repo. Public, no sign-in, one
 *                fetch. This is why the board is hosted in the repo: a Claude
 *                artifact URL needs a login, so fetching one from Scriptable
 *                returns the app shell or a 403, never the board.
 *
 *   Grades       Supabase, signed in as you. Scores are NOT in the public JSON —
 *                GitHub Pages is the open internet, and a gradebook does not
 *                belong there. If you have not signed in, everything else still
 *                works and the grades section says so.
 *
 * SETUP
 *   1. Scriptable → + → paste this file → name it "Term Board".
 *   2. Run it once and sign in when asked, to see grades. Skip it if you only
 *      want the schedule.
 *   3. Home screen → add a Scriptable widget (Large is the intended size) →
 *      pick this script. Set "When Interacting" to "Run Script".
 */

// ---------------------------------------------------------------- config

/**
 * Bumped whenever this file changes. Shown in the in-app header and logged on
 * every run, so "which version is actually on the phone?" is answerable in two
 * seconds instead of by reading a diff.
 */
const VERSION = "2026-08-31a";

const REPO = "iamrichardmaier-sudo/Term-Board";

const BOARD_URL = "https://iamrichardmaier-sudo.github.io/Term-Board/";

/**
 * Tried in order, first valid JSON wins.
 *
 * raw.githubusercontent.com comes first because it needs nothing set up: it
 * serves a public repo's files the moment a commit lands, with no build and no
 * deploy wait. Pages serves the same file behind a nicer URL but has to be
 * switched on (Settings -> Pages -> main /docs), so it is the second entry
 * rather than the first — and having both means either one can be down.
 */
const DATA_URLS = [
  `https://raw.githubusercontent.com/${REPO}/main/docs/board.json`,
  BOARD_URL + "board.json",
];

const SUPABASE_URL = "https://fphpcfecgnfoogfaeihu.supabase.co";
// Publishable anon key — the same value the web app ships to browsers. Not a
// secret; row-level security is what actually protects the rows.
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwaHBjZmVjZ25mb29nZmFlaWh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNzY2NjAsImV4cCI6MjA5OTk1MjY2MH0.2OXlbp8EuQpgv0Mnk5Ps3XbL16-vI8vDDRTWi4yYOk4";

// Must be the SAME Supabase account the scraper signs in as. Row-level security
// scopes every row to one user, so a mismatch here does not error — it just
// returns nothing. Matches wazn-review.js, which uses the same project.
const DEFAULT_EMAIL = "rbm66@byu.edu";
const TERM_ID = "fall-2026";

const KEY_EMAIL = "termboard.email";
const KEY_PASSWORD = "termboard.password";
const CACHE_FILE = "term-board-widget-cache.json";

const INK = "#ffffff";
const BG = "#1c1c1e";
const MUTED = "#8e8e93";
const FAINT = "#636366";
const GOOD = "#30d158";
const WARN = "#ff9f0a";
const BAD = "#ff453a";

// Per-course accents, carried over from the board so the two read as one system.
const COURSE_COLORS = { arab: "#7d8fd6", ihum: "#d9ad5e", econ: "#6fbfa8", gci: "#c99bce" };

// claude.ai accepts a prompt in ?q=. Long ones get unwieldy as a URL, so the
// deep link carries a trimmed version and the full text goes on the clipboard.
const MAX_URL_PROMPT = 4000;

// ------------------------------------------------------------------ time

/**
 * Whole days from now until `dateStr`, by calendar day rather than by elapsed
 * hours. Rounding the raw difference would call something due at 11:59 tonight
 * "1d", which is exactly the case the widget exists to get right.
 */
function daysUntil(dateStr) {
  const due = new Date(dateStr);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfDue = new Date(due);
  startOfDue.setHours(0, 0, 0, 0);
  return Math.round((startOfDue - startOfToday) / 86400000);
}

function formatDue(dateStr) {
  if (!dateStr) return "—";
  const d = daysUntil(dateStr);
  if (d < -1) return `${Math.abs(d)}d late`;
  if (d === -1) return "yesterday";
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d < 7) return `${d}d`;
  const df = new DateFormatter();
  df.dateFormat = "MMM d";
  return df.string(new Date(dateStr));
}

function dueColor(dateStr) {
  const d = daysUntil(dateStr);
  if (d < 0) return BAD;
  if (d <= 1) return BAD;
  if (d <= 3) return WARN;
  return MUTED;
}

// ------------------------------------------------------------ data: board

async function fetchBoard() {
  const failures = [];

  for (const url of DATA_URLS) {
    try {
      const req = new Request(url);
      req.timeoutInterval = 12;
      const data = await req.loadJSON();
      // A 404 from raw.githubusercontent is HTML, not JSON, and a Pages 404 is
      // the SPA shell — both parse into something without assignments rather
      // than throwing, so the shape is what decides, not the status code.
      if (data && Array.isArray(data.assignments) && data.assignments.length) {
        return { ...data, source: url };
      }
      failures.push(`${url} — no assignments in the response`);
    } catch (e) {
      failures.push(`${url} — ${e}`);
    }
  }

  throw new Error("Could not load board.json.\n\n" + failures.join("\n"));
}

// ----------------------------------------------------------- data: grades

async function credentials(promptIfMissing) {
  if (Keychain.contains(KEY_EMAIL) && Keychain.contains(KEY_PASSWORD)) {
    return { email: Keychain.get(KEY_EMAIL), password: Keychain.get(KEY_PASSWORD) };
  }
  // A widget refresh cannot show a prompt, so it just goes without grades.
  if (!promptIfMissing) return null;

  const a = new Alert();
  a.title = "Sign in for grades";
  a.message =
    "Scores live in Supabase, not in the public board file. Stored in the iOS " +
    "Keychain on this device only. Skip this and everything else still works.";
  a.addTextField("Email", DEFAULT_EMAIL);
  a.addSecureTextField("Password");
  a.addAction("Sign in");
  a.addCancelAction("Skip");
  if ((await a.presentAlert()) === -1) return null;

  const email = a.textFieldValue(0).trim();
  const password = a.textFieldValue(1);
  if (!email || !password) return null;

  Keychain.set(KEY_EMAIL, email);
  Keychain.set(KEY_PASSWORD, password);
  return { email, password };
}

function forgetCredentials() {
  if (Keychain.contains(KEY_EMAIL)) Keychain.remove(KEY_EMAIL);
  if (Keychain.contains(KEY_PASSWORD)) Keychain.remove(KEY_PASSWORD);
}

async function signIn(promptIfMissing) {
  const creds = await credentials(promptIfMissing);
  if (!creds) return null;

  const req = new Request(`${SUPABASE_URL}/auth/v1/token?grant_type=password`);
  req.method = "POST";
  req.headers = { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" };
  req.body = JSON.stringify({ email: creds.email, password: creds.password });

  const res = await req.loadJSON();
  if (!res || !res.access_token) {
    // Wrong password, or the account changed — clear it so the next run asks
    // again rather than failing identically forever.
    if (promptIfMissing) forgetCredentials();
    return null;
  }
  return res.access_token;
}

function restHeaders(token) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/** The newest scrape's snapshot, which carries the scores. */
async function fetchSnapshot(token) {
  const url =
    `${SUPABASE_URL}/rest/v1/term_board_snapshots` +
    `?select=payload&term_id=eq.${TERM_ID}&order=scraped_at.desc&limit=1`;
  const req = new Request(url);
  req.headers = restHeaders(token);
  req.timeoutInterval = 15;
  const rows = await req.loadJSON();
  return Array.isArray(rows) && rows.length ? rows[0].payload : null;
}

async function fetchReading(token, assignmentId) {
  const url =
    `${SUPABASE_URL}/rest/v1/term_board_readings` +
    `?select=title,course,bodies&term_id=eq.${TERM_ID}` +
    `&assignment_id=eq.${encodeURIComponent(assignmentId)}&limit=1`;
  const req = new Request(url);
  req.headers = restHeaders(token);
  const rows = await req.loadJSON();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// ----------------------------------------------------------------- cache

function cachePath() {
  const fm = FileManager.local();
  return fm.joinPath(fm.cacheDirectory(), CACHE_FILE);
}

function readCache() {
  try {
    const fm = FileManager.local();
    const p = cachePath();
    if (!fm.fileExists(p)) return null;
    return JSON.parse(fm.readString(p));
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    FileManager.local().writeString(cachePath(), JSON.stringify(data));
  } catch {
    /* a stale widget is not worth failing the run over */
  }
}

// ----------------------------------------------------------------- shape

function groupOf(courseCode) {
  const p = String(courseCode).split(/\s+/)[0].toLowerCase();
  return ["arab", "ihum", "econ", "gci"].indexOf(p) >= 0 ? p : "econ";
}

function shortCode(courseCode) {
  return String(courseCode).split(/\s+/)[0];
}

function courseColor(courseCode) {
  return new Color(COURSE_COLORS[groupOf(courseCode)] || MUTED);
}

function gradeColor(percent) {
  if (percent >= 90) return new Color(GOOD);
  if (percent >= 80) return new Color(WARN);
  return new Color(BAD);
}

/**
 * Merge the public schedule with the private scores. The JSON is the source of
 * truth for what exists; Supabase adds what it is worth.
 */
function merge(board, snapshot) {
  const scores = new Map();
  const grades = [];

  if (snapshot) {
    for (const a of snapshot.assignments || []) {
      if (a.graded && a.score != null) scores.set(a.id, a);
    }
    for (const c of snapshot.courses || []) {
      if (c.grade && c.grade.percent != null) {
        grades.push({ course: c.code, percent: c.grade.percent, grade: `${c.grade.percent}%` });
      }
    }
  }

  const assignments = board.assignments.map((a) => {
    const scored = scores.get(a.id);
    return scored ? { ...a, score: scored.score, possible: scored.possible, graded: true } : a;
  });

  // If grades were published into the JSON itself, use those.
  return {
    ...board,
    assignments,
    grades: grades.length ? grades : board.grades || [],
  };
}

/** Overdue and ungraded — the things that actually need attention. */
function overdue(data) {
  return data.assignments
    .filter((a) => !a.minor && a.due && daysUntil(a.due) < 0 && !a.graded)
    .sort((a, b) => new Date(a.due) - new Date(b.due));
}

function upcoming(data, limit) {
  const items = data.assignments
    .filter((a) => !a.minor && a.due && daysUntil(a.due) >= 0)
    .sort((a, b) => new Date(a.due) - new Date(b.due));
  return typeof limit === "number" ? items.slice(0, limit) : items;
}

// ---------------------------------------------------------------- widget

function sectionHeader(w, text, trailing) {
  const stack = w.addStack();
  stack.centerAlignContent();
  const label = stack.addText(text);
  label.font = Font.semiboldSystemFont(11);
  label.textColor = new Color(MUTED);
  if (trailing) {
    stack.addSpacer();
    const t = stack.addText(trailing);
    t.font = Font.semiboldSystemFont(11);
    t.textColor = new Color(BAD);
  }
  w.addSpacer(4);
}

function buildWidget(data, note) {
  const w = new ListWidget();
  w.setPadding(14, 14, 14, 14);
  w.backgroundColor = new Color(BG);
  // The feed names its own tap target, so this follows the board wherever it
  // actually lives without needing the script re-pasted.
  w.url = (data && data.boardUrl) || BOARD_URL;

  const family = config.widgetFamily || "large";
  const small = family === "small";

  const head = w.addStack();
  head.centerAlignContent();
  const title = head.addText("Term Board");
  title.font = Font.boldSystemFont(small ? 13 : 16);
  title.textColor = new Color(INK);
  head.addSpacer();
  if (data && data.term && !small) {
    const term = head.addText(data.term);
    term.font = Font.systemFont(10);
    term.textColor = new Color(FAINT);
  }

  w.addSpacer(small ? 4 : 8);

  if (!data) {
    const msg = w.addText(note || "Couldn't reach the board.");
    msg.font = Font.systemFont(12);
    msg.textColor = new Color(MUTED);
    return w;
  }

  // ---- Grades ----
  if (!small) {
    sectionHeader(w, "GRADES");
    const grades = data.grades || [];
    if (grades.length === 0) {
      const none = w.addText(
        data.gradesArePrivate && !data.signedIn
          ? "Open the app and sign in to see grades."
          : "No grades posted yet.",
      );
      none.font = Font.systemFont(12);
      none.textColor = new Color(MUTED);
      w.addSpacer(2);
    } else {
      for (const g of grades.slice(0, family === "large" ? 4 : 2)) {
        const row = w.addStack();
        row.centerAlignContent();
        const name = row.addText(g.course);
        name.font = Font.systemFont(13);
        name.textColor = courseColor(g.course);
        row.addSpacer();
        const score = row.addText(g.grade);
        score.font = Font.boldSystemFont(13);
        score.textColor = gradeColor(g.percent);
        w.addSpacer(3);
      }
    }
    w.addSpacer(9);
  }

  // ---- Due ----
  const late = overdue(data);
  const rows = small ? 3 : family === "medium" ? 4 : 6;
  const list = [...late, ...upcoming(data, rows)].slice(0, rows);

  sectionHeader(w, "DUE SOON", late.length ? `${late.length} overdue` : null);

  if (list.length === 0) {
    const none = w.addText("Nothing left on the board.");
    none.font = Font.systemFont(12);
    none.textColor = new Color(MUTED);
  } else {
    for (const a of list) {
      const row = w.addStack();
      row.centerAlignContent();
      row.spacing = 5;

      const chip = row.addText(shortCode(a.course));
      chip.font = Font.mediumSystemFont(11);
      chip.textColor = courseColor(a.course);

      const label = row.addText(a.title);
      label.font = Font.systemFont(13);
      label.textColor = new Color(INK);
      label.lineLimit = 1;

      row.addSpacer();

      if (!a.conversationReady && a.textQuality && a.textQuality !== "unknown") {
        const flag = row.addText("⚑");
        flag.font = Font.systemFont(10);
        flag.textColor = new Color(WARN);
      }

      const due = row.addText(formatDue(a.due));
      due.font = Font.systemFont(12);
      due.textColor = new Color(dueColor(a.due));

      w.addSpacer(4);
    }
  }

  w.addSpacer();
  const footer = w.addText(footerText(data));
  footer.font = Font.systemFont(10);
  footer.textColor = new Color(FAINT);

  return w;
}

function footerText(data) {
  if (!data.generatedAt) return "Tap for full board";
  const age = (new Date() - new Date(data.generatedAt)) / 36e5;
  if (data.seeded) return "Seeded — awaiting first scrape";
  if (age > 36) return `Stale — last scrape ${Math.round(age / 24)}d ago`;
  return "Tap for full board";
}

// ------------------------------------------------------------ in-app UI

async function presentBoard(data, token) {
  const table = new UITable();
  table.showSeparators = true;

  const header = new UITableRow();
  header.isHeader = true;
  header.addText(`Term Board · v${VERSION}`, footerDetail(data));
  table.addRow(header);

  // Which URL answered. The one recurring failure with this script has been a
  // stale copy pointing at a dead URL, and this makes that visible at a glance.
  if (data.source) {
    const src = new UITableRow();
    src.height = 40;
    src.addText("Data source", String(data.source).replace(/^https:\/\//, ""));
    table.addRow(src);
  }

  const gradeRow = new UITableRow();
  gradeRow.height = 46;
  const grades = data.grades || [];
  gradeRow.addText(
    "Grades",
    grades.length
      ? grades.map((g) => `${shortCode(g.course)} ${g.grade}`).join("   ")
      : token
        ? "No grades posted yet"
        : "Not signed in — run again to sign in",
  );
  table.addRow(gradeRow);

  const late = overdue(data);
  if (late.length) {
    addSection(table, `Overdue (${late.length})`);
    for (const a of late) table.addRow(assignmentRow(a, token));
  }

  const ahead = upcoming(data);
  addSection(table, `Coming up (${ahead.length})`);
  for (const a of ahead) table.addRow(assignmentRow(a, token));

  const flagged = data.flags || [];
  if (flagged.length) {
    addSection(table, `Won't work in voice mode (${flagged.length})`);
    for (const f of flagged) {
      const row = new UITableRow();
      row.height = 50;
      row.addText(`${shortCode(f.course)} · ${f.title}`, `Reading is ${f.quality} — no clean text.`);
      table.addRow(row);
    }
  }

  await table.present(false);
}

function footerDetail(data) {
  if (!data.generatedAt) return "";
  const df = new DateFormatter();
  df.dateFormat = "MMM d, h:mm a";
  return (data.seeded ? "Seeded " : "Updated ") + df.string(new Date(data.generatedAt));
}

function addSection(table, title) {
  const row = new UITableRow();
  row.isHeader = true;
  row.addText(title);
  table.addRow(row);
}

function assignmentRow(a, token) {
  const row = new UITableRow();
  row.height = 58;
  row.dismissOnSelect = false;

  const score = a.graded && a.score != null ? `  ·  ${a.score}${a.possible ? "/" + a.possible : ""}` : "";
  const flag = a.conversationReady ? "" : "  ⚑ no clean text";
  const subtitle = `${shortCode(a.course)} · ${formatDue(a.due)} · ${a.category}${score}${flag}`;

  const main = row.addText(a.title, subtitle);
  main.widthWeight = a.conversationReady && token ? 72 : 100;
  main.subtitleFont = Font.systemFont(11);

  // The action needs both a readable assignment and a signed-in session to
  // fetch the text, so it is only offered when both are true.
  if (a.conversationReady && token) {
    const button = row.addButton("Start Conversation");
    button.widthWeight = 28;
    button.onTap = async () => {
      await startConversation(token, a);
    };
  }

  return row;
}

// ------------------------------------------------- start a conversation

async function startConversation(token, assignment) {
  const reading = await fetchReading(token, assignment.id);

  if (!reading || !reading.bodies || !reading.bodies.length) {
    const a = new Alert();
    a.title = "Nothing to read";
    a.message =
      "The scraper found no extractable text for this one, so there is nothing " +
      "to walk through. Open it on Learning Suite instead.";
    a.addAction("OK");
    await a.presentAlert();
    return;
  }

  const prompt = buildPrompt(assignment, reading);
  Pasteboard.copy(prompt);

  const a = new Alert();
  a.title = "Start a voice walkthrough";
  a.message =
    `${assignment.title}\n\n` +
    `The full assignment and reading (${prompt.length.toLocaleString()} characters) is on ` +
    `your clipboard. Claude opens with as much as fits in a link — paste for the rest, ` +
    `then switch to voice mode.`;
  a.addAction("Open Claude");
  a.addAction("Copy only");
  a.addCancelAction("Cancel");

  if ((await a.presentAlert()) !== 0) return;
  Safari.open(`https://claude.ai/new?q=${encodeURIComponent(trimForUrl(prompt))}`);
}

function buildPrompt(assignment, reading) {
  const when = assignment.due ? new Date(assignment.due).toLocaleString() : "no due date listed";

  const lines = [
    `I'm working on "${assignment.title}" for ${assignment.course}. It's due ${when}.`,
    "",
    "Walk me through this out loud, conversationally. Ask me questions rather than",
    "handing me answers — check what I already understand, then take it a section at",
    "a time. If it's a set of questions, work them with me one by one. If it's a",
    "reading, help me get through it and make sure I can say what it argued.",
    "",
    "Here is everything from Learning Suite:",
    "",
  ];

  for (const body of reading.bodies) {
    lines.push(`--- ${body.label.toUpperCase()} ---`);
    lines.push(body.text.trim());
    lines.push("");
  }

  return lines.join("\n").trim();
}

/** Cut at a paragraph boundary so the link never ends mid-sentence. */
function trimForUrl(prompt) {
  if (prompt.length <= MAX_URL_PROMPT) return prompt;
  const head = prompt.slice(0, MAX_URL_PROMPT);
  const cut = head.lastIndexOf("\n\n");
  const body = cut > MAX_URL_PROMPT * 0.5 ? head.slice(0, cut) : head;
  return body + "\n\n[The rest of the reading is on my clipboard — I'll paste it next.]";
}

// ------------------------------------------------------------------ main

async function run() {
  const interactive = !config.runsInWidget;
  console.log(`Term Board ${VERSION}`);

  let board = null;
  let boardError = null;
  try {
    board = await fetchBoard();
    console.log(`board loaded from ${board.source}`);
  } catch (e) {
    boardError = String(e);
    console.error(boardError);
  }

  // Grades are a bonus, never a blocker: a failed sign-in still leaves the
  // schedule, which is most of what the widget is for.
  let token = null;
  let snapshot = null;
  try {
    token = await signIn(interactive);
    if (token) snapshot = await fetchSnapshot(token);
  } catch (e) {
    console.error("grades unavailable: " + e);
  }

  let data = board ? merge(board, snapshot) : null;
  if (data) {
    data.signedIn = Boolean(token);
    writeCache(data);
  } else {
    data = readCache();
  }

  if (config.runsInWidget) {
    Script.setWidget(buildWidget(data, "Couldn't reach the board — check back shortly."));
    Script.complete();
    return;
  }

  if (!data) {
    const a = new Alert();
    a.title = "Couldn't load the board";
    a.message =
      (boardError || "No data, and nothing cached on this device.") +
      "\n\nIf board.json has not been pushed yet, that is expected.";
    a.addAction("OK");
    await a.presentAlert();
    return;
  }

  await presentBoard(data, token);
  Script.complete();
}

await run();
