// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: calendar-check;

/**
 * Term Board — home-screen widget and assignment browser for Scriptable (iOS)
 * ---------------------------------------------------------------------------
 * Two modes in one file, the same shape as wazn-review.js:
 *
 *   WIDGET   What is due next, and where each course's grade stands. Tapping
 *            it opens the browser below.
 *
 *   IN APP   Every assignment for the term, grouped by week, with its score and
 *            a "Start Conversation" action on the ones whose reading actually
 *            came through as clean text.
 *
 * Data comes from the term_board_snapshots and term_board_readings tables that
 * the Windows scraper fills each morning. Both are behind row-level security,
 * so this signs in as you exactly the way the Wazn script does — the anon key
 * below grants nothing on its own.
 *
 * Why "Start Conversation" opens a URL rather than talking directly: Scriptable
 * cannot host a voice session. It can hand Claude a fully-formed prompt though,
 * which is one tap away from the same thing — open it, then switch to voice.
 *
 * SETUP
 *   1. Scriptable → + → paste this file → name it "Term Board".
 *   2. Run it once. It asks for your Supabase email and password and stores
 *      them in the iOS Keychain on this device.
 *   3. Home screen → add a Scriptable widget → pick this script.
 *      Set "When Interacting" to "Run Script".
 */

// ---------------------------------------------------------------- config

const SUPABASE_URL = "https://fphpcfecgnfoogfaeihu.supabase.co";
// Publishable anon key — the same value the web app ships to browsers. Not a
// secret; row-level security is what actually protects the rows.
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwaHBjZmVjZ25mb29nZmFlaWh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNzY2NjAsImV4cCI6MjA5OTk1MjY2MH0.2OXlbp8EuQpgv0Mnk5Ps3XbL16-vI8vDDRTWi4yYOk4";

const DEFAULT_EMAIL = "i.am.richard.maier@gmail.com";
const TERM_ID = "fall-2026";

const KEY_EMAIL = "termboard.email";
const KEY_PASSWORD = "termboard.password";
const CACHE_FILE = "term-board-widget-cache.json";

// Matches the Term Board dashboard, so the phone and the browser look related.
const COLORS = {
  bg: "#F1F2ED",
  bgDark: "#181B24",
  ink: "#1B2130",
  inkDark: "#EDEEF2",
  soft: "#5B6272",
  faint: "#8B92A0",
  brand: "#2C3E64",
  arab: "#4C5FA0",
  ihum: "#A6742A",
  econ: "#2E7869",
  gci: "#7A4C7E",
  danger: "#A6342A",
  warn: "#C4622E",
  ok: "#3F7D5C",
};

// claude.ai accepts a prompt in ?q=. Long ones get unwieldy as a URL, so the
// deep link carries a trimmed version and the full text goes on the clipboard —
// a paste is one gesture, and a truncated reading would be worse.
const MAX_URL_PROMPT = 4000;

// ------------------------------------------------------------------ auth

async function credentials(promptIfMissing) {
  if (Keychain.contains(KEY_EMAIL) && Keychain.contains(KEY_PASSWORD)) {
    return { email: Keychain.get(KEY_EMAIL), password: Keychain.get(KEY_PASSWORD) };
  }
  // A widget refresh cannot show a prompt, so it just reports "not signed in".
  if (!promptIfMissing) return null;

  const a = new Alert();
  a.title = "Sign in to Term Board";
  a.message = "Stored in the iOS Keychain on this device only.";
  a.addTextField("Email", DEFAULT_EMAIL);
  a.addSecureTextField("Password");
  a.addAction("Sign in");
  a.addCancelAction("Cancel");
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

// ------------------------------------------------------------------ data

function restHeaders(token) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function fetchSnapshot(token) {
  const url =
    `${SUPABASE_URL}/rest/v1/term_board_snapshots` +
    `?select=payload,scraped_at&term_id=eq.${TERM_ID}` +
    `&order=scraped_at.desc&limit=1`;
  const req = new Request(url);
  req.headers = restHeaders(token);
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
  const prefix = String(courseCode).split(/\s+/)[0].toLowerCase();
  return ["arab", "ihum", "econ", "gci"].indexOf(prefix) >= 0 ? prefix : "econ";
}

function shortCode(courseCode) {
  return String(courseCode).split(/\s+/)[0];
}

function courseColor(courseCode) {
  return new Color(COLORS[groupOf(courseCode)] || COLORS.brand);
}

function dueDate(assignment) {
  return assignment.due ? new Date(assignment.due) : null;
}

function statusOf(assignment) {
  const d = dueDate(assignment);
  if (!d) return "later";
  const hours = (d - new Date()) / 36e5;
  if (hours < 0) return "overdue";
  if (hours <= 72) return "soon";
  return "later";
}

function fmtDue(assignment) {
  const d = dueDate(assignment);
  if (!d) return "no due date";
  const df = new DateFormatter();
  df.dateFormat = "MMM d";
  const tf = new DateFormatter();
  tf.dateFormat = "h:mm a";
  return `${df.string(d)} · ${tf.string(d)}`;
}

/** Upcoming, drills excluded, soonest first. */
function upcoming(snapshot, limit) {
  const now = new Date();
  const items = snapshot.assignments
    .filter((a) => !a.minor && a.due && new Date(a.due) >= now)
    .sort((a, b) => new Date(a.due) - new Date(b.due));
  return typeof limit === "number" ? items.slice(0, limit) : items;
}

function overdue(snapshot) {
  const now = new Date();
  return snapshot.assignments.filter(
    (a) => !a.minor && a.due && new Date(a.due) < now && !a.graded,
  );
}

// ---------------------------------------------------------------- widget

function buildWidget(snapshot, note) {
  const w = new ListWidget();
  const dark = Device.isUsingDarkAppearance();
  w.backgroundColor = new Color(dark ? COLORS.bgDark : COLORS.bg);
  w.setPadding(14, 14, 14, 14);

  const inkColor = new Color(dark ? COLORS.inkDark : COLORS.ink);

  const header = w.addStack();
  header.centerAlignContent();
  const title = header.addText("TERM BOARD");
  title.font = Font.boldSystemFont(10);
  title.textColor = new Color(COLORS.brand);
  header.addSpacer();

  if (snapshot) {
    const late = overdue(snapshot).length;
    if (late > 0) {
      const badge = header.addText(`${late} late`);
      badge.font = Font.boldSystemFont(10);
      badge.textColor = new Color(COLORS.danger);
    }
  }

  w.addSpacer(8);

  if (!snapshot) {
    const msg = w.addText(note || "Open to sign in");
    msg.font = Font.systemFont(12);
    msg.textColor = new Color(COLORS.faint);
    return w;
  }

  const size = config.widgetFamily || "medium";
  const rows = size === "small" ? 2 : size === "large" ? 7 : 4;

  const next = upcoming(snapshot, rows);
  if (next.length === 0) {
    const msg = w.addText("Nothing due ahead");
    msg.font = Font.systemFont(12);
    msg.textColor = new Color(COLORS.faint);
  }

  for (const a of next) {
    const row = w.addStack();
    row.centerAlignContent();
    row.spacing = 6;

    const chip = row.addText(shortCode(a.course));
    chip.font = Font.boldSystemFont(9);
    chip.textColor = courseColor(a.course);
    chip.lineLimit = 1;

    const name = row.addText(a.title);
    name.font = Font.systemFont(size === "small" ? 10 : 12);
    name.textColor = inkColor;
    name.lineLimit = 1;

    row.addSpacer();

    const when = row.addText(fmtDue(a).split(" · ")[0]);
    when.font = Font.mediumSystemFont(size === "small" ? 9 : 11);
    when.textColor = new Color(
      statusOf(a) === "overdue" ? COLORS.danger : statusOf(a) === "soon" ? COLORS.warn : COLORS.faint,
    );
    w.addSpacer(4);
  }

  // Grades — the whole reason this replaced a static placeholder.
  const graded = snapshot.courses.filter((c) => c.grade && c.grade.percent != null);
  if (graded.length && size !== "small") {
    w.addSpacer(4);
    const line = w.addStack();
    line.spacing = 8;
    for (const c of graded.slice(0, 4)) {
      const cell = line.addStack();
      cell.spacing = 3;
      const code = cell.addText(shortCode(c.code));
      code.font = Font.boldSystemFont(9);
      code.textColor = courseColor(c.code);
      const pct = cell.addText(`${c.grade.percent}%`);
      pct.font = Font.mediumSystemFont(9);
      pct.textColor = new Color(
        c.grade.percent >= 90 ? COLORS.ok : c.grade.percent >= 80 ? COLORS.warn : COLORS.danger,
      );
    }
    line.addSpacer();
  } else if (!graded.length && size !== "small") {
    w.addSpacer(4);
    const none = w.addText("No grades posted yet");
    none.font = Font.systemFont(9);
    none.textColor = new Color(COLORS.faint);
  }

  w.addSpacer(2);
  const stamp = w.addText(freshnessLine(snapshot));
  stamp.font = Font.systemFont(8);
  stamp.textColor = new Color(COLORS.faint);

  return w;
}

function freshnessLine(snapshot) {
  const scraped = new Date(snapshot.scrapedAt);
  const hours = (new Date() - scraped) / 36e5;
  const df = new DateFormatter();
  df.dateFormat = "MMM d, h:mm a";
  return hours > 36 ? `stale — last scrape ${df.string(scraped)}` : `updated ${df.string(scraped)}`;
}

// ------------------------------------------------------------ in-app UI

async function presentBoard(token, snapshot) {
  const table = new UITable();
  table.showSeparators = true;

  const header = new UITableRow();
  header.isHeader = true;
  header.addText("Term Board", freshnessLine(snapshot));
  table.addRow(header);

  // Grades first — it is the question you open the app to answer.
  const gradeRow = new UITableRow();
  gradeRow.height = 46;
  const gradeText = snapshot.courses
    .filter((c) => c.published)
    .map((c) => `${shortCode(c.code)} ${c.grade && c.grade.percent != null ? c.grade.percent + "%" : "—"}`)
    .join("   ");
  gradeRow.addText("Grades", gradeText || "No grades posted yet");
  table.addRow(gradeRow);

  const late = overdue(snapshot);
  if (late.length) {
    addSection(table, `Overdue (${late.length})`);
    for (const a of late) table.addRow(assignmentRow(a, token));
  }

  const ahead = upcoming(snapshot);
  addSection(table, `Coming up (${ahead.length})`);
  for (const a of ahead) table.addRow(assignmentRow(a, token));

  const flagged = snapshot.flags || [];
  if (flagged.length) {
    addSection(table, `Won't work in voice mode (${flagged.length})`);
    for (const f of flagged) {
      const row = new UITableRow();
      row.height = 60;
      row.addText(`${shortCode(f.course)} · ${f.title}`, f.reason || "No clean text extracted.");
      table.addRow(row);
    }
  }

  await table.present(false);
}

function addSection(table, title) {
  const row = new UITableRow();
  row.isHeader = true;
  row.backgroundColor = new Color(COLORS.brand, 0.08);
  row.addText(title);
  table.addRow(row);
}

function assignmentRow(a, token) {
  const row = new UITableRow();
  row.height = 58;
  row.dismissOnSelect = false;

  const score =
    a.graded && a.score != null
      ? `${a.score}${a.possible ? "/" + a.possible : ""}`
      : "";
  const flag = a.conversationReady ? "" : "  ⚑ no clean text";
  const subtitle = `${shortCode(a.course)} · ${fmtDue(a)} · ${a.category}${score ? "  ·  " + score : ""}${flag}`;

  const main = row.addText(a.title, subtitle);
  main.widthWeight = a.conversationReady ? 72 : 100;
  main.titleColor = new Color(COLORS.ink);
  main.subtitleColor = new Color(
    statusOf(a) === "overdue" ? COLORS.danger : COLORS.soft,
  );
  main.subtitleFont = Font.systemFont(11);

  if (a.conversationReady) {
    const button = row.addButton("Start Conversation");
    button.widthWeight = 28;
    button.onTap = async () => {
      await startConversation(token, a);
    };
  }

  return row;
}

// ------------------------------------------------- start a conversation

/**
 * Build a prompt out of the assignment's instructions and reading, hand it to
 * Claude, and leave the full text on the clipboard so nothing is lost to URL
 * length limits.
 */
async function startConversation(token, assignment) {
  const reading = await fetchReading(token, assignment.id);

  if (!reading || !reading.bodies || !reading.bodies.length) {
    const a = new Alert();
    a.title = "Nothing to read";
    a.message =
      "The scraper did not find any extractable text for this assignment, so " +
      "there is nothing to walk through. Open it on Learning Suite instead.";
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
    `The full assignment and reading (${prompt.length.toLocaleString()} characters) is on your ` +
    `clipboard. Claude will open with as much as fits in a link — paste if you want the rest, ` +
    `then switch to voice mode.`;
  a.addAction("Open Claude");
  a.addAction("Copy only");
  a.addCancelAction("Cancel");

  const choice = await a.presentAlert();
  if (choice !== 0) return;

  const trimmed = trimForUrl(prompt);
  Safari.open(`https://claude.ai/new?q=${encodeURIComponent(trimmed)}`);
}

function buildPrompt(assignment, reading) {
  const when = assignment.due
    ? new Date(assignment.due).toLocaleString()
    : "no due date listed";

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

/**
 * Keep the deep link to a length iOS and claude.ai will both accept, cutting at
 * a paragraph boundary so the link never ends mid-sentence.
 */
function trimForUrl(prompt) {
  if (prompt.length <= MAX_URL_PROMPT) return prompt;
  const head = prompt.slice(0, MAX_URL_PROMPT);
  const cut = head.lastIndexOf("\n\n");
  const body = cut > MAX_URL_PROMPT * 0.5 ? head.slice(0, cut) : head;
  return (
    body +
    "\n\n[The rest of the reading is on my clipboard — I'll paste it next.]"
  );
}

// ------------------------------------------------------------------ main

async function main() {
  const interactive = !config.runsInWidget;
  const token = await signIn(interactive);

  if (!token) {
    if (config.runsInWidget) {
      const cached = readCache();
      Script.setWidget(buildWidget(cached, "Open the app to sign in"));
      Script.complete();
      return;
    }
    const a = new Alert();
    a.title = "Could not sign in";
    a.message = "Check the email and password, then run this again.";
    a.addAction("OK");
    await a.presentAlert();
    return;
  }

  let snapshot;
  try {
    snapshot = await fetchSnapshot(token);
  } catch {
    snapshot = null;
  }

  if (!snapshot) {
    // Fall back to whatever the widget last saw rather than showing an error —
    // a day-old board still beats a blank one.
    snapshot = readCache();
    if (!snapshot && !config.runsInWidget) {
      const a = new Alert();
      a.title = "No scrape yet";
      a.message =
        "Nothing has been published to Supabase for this term. Run the scraper " +
        "on the Lenovo (npm run scrape) and try again.";
      a.addAction("OK");
      await a.presentAlert();
      return;
    }
  } else {
    writeCache(snapshot);
  }

  if (config.runsInWidget) {
    Script.setWidget(buildWidget(snapshot));
    Script.complete();
    return;
  }

  await presentBoard(token, snapshot);
}

await main();
