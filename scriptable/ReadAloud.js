// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-purple; icon-glyph: headphones; share-sheet-inputs: file-url, url;

/**
 * Read Aloud — hand it a PDF, it reads the PDF to you
 * ---------------------------------------------------------------------------
 * Text PDFs and scans both. Pages with a text layer are extracted; pages
 * without one are rendered and run through OCR on the phone. The result is
 * read out either by a device voice or, if you give it a key, by a cloud voice
 * that sounds like a person.
 *
 * WHERE THE WORK HAPPENS
 *
 * Almost none of it is in this file. Scriptable has no PDF parser, no OCR and
 * no audio player, but it does have a WebView, and a WebView has all three. So
 * this script is a courier: it gets hold of the bytes, hands them to
 * docs/read.html, puts that on the screen, and writes down where you stopped.
 *
 * Keeping the reader as a real web page rather than a string in here means the
 * same code is also just a URL — open it in Safari on any phone, laptop or
 * borrowed iPad and it works the same, with no Scriptable at all.
 *
 * THREE WAYS IN
 *   Share sheet   Share a PDF from Files, Mail, Safari, anywhere → Read Aloud.
 *   Run it        Opens a file picker.
 *   Term Board    The widget's in-app list calls straight into this one.
 *
 * SETUP
 *   1. Scriptable → + → paste this file → name it "Read Aloud".
 *   2. Run it once and pick a PDF.
 *   3. Optional, and the single biggest difference to how it sounds:
 *      Settings → Accessibility → Spoken Content → Voices → English →
 *      download a Premium voice.
 *   4. Also optional: paste an ElevenLabs or OpenAI key in the ⚙ sheet for a
 *      voice that is genuinely hard to tell from a person.
 */

const VERSION = "2026-09-16b";

const REPO = "iamrichardmaier-sudo/Term-Board";

// raw first, for the same reason the widget uses it first: it serves any branch
// the moment a commit lands, with no Pages build to wait on.
const PLAYER_URLS = [
  `https://raw.githubusercontent.com/${REPO}/main/docs/read.html`,
  `https://iamrichardmaier-sudo.github.io/Term-Board/read.html`,
];

// The page is loaded with a real https base URL rather than about:blank. An
// origin of null is refused by both voice APIs on the CORS preflight, so
// without this the cloud voices fail on the phone while working in a browser.
const BASE_URL = "https://iamrichardmaier-sudo.github.io/Term-Board/";

const PLAYER_CACHE = "ReadAloud.player.html";
const POSITIONS = "read-aloud-positions.json";

// evaluateJavaScript takes the whole script as one string, and a 40 MB PDF is
// 54 MB of base64. Older phones drop a call that size silently, so it goes over
// in slices.
const CHUNK = 262144;

const KEYCHAIN = {
  elevenKey: "readaloud.elevenlabs.key",
  elevenVoice: "readaloud.elevenlabs.voice",
  openaiKey: "readaloud.openai.key",
};

const fm = FileManager.local();

// ------------------------------------------------------------ the player

/**
 * The reader page, from the repo if it can be reached and from the cache if
 * not.
 *
 * Same trade as TermBoard-loader.js: this runs code fetched at run time from
 * your own public repository. The marker check is not security — anyone who
 * can push to the repo can change what runs here — it is there to stop a
 * captive-portal login page or a 404 being cached over a working copy.
 */
async function playerHtml() {
  const path = fm.joinPath(fm.libraryDirectory(), PLAYER_CACHE);

  for (const url of PLAYER_URLS) {
    try {
      const req = new Request(url);
      req.timeoutInterval = 20;
      const html = await req.loadString();
      if (html && html.includes("TermBoardReader") && html.length > 20000) {
        fm.writeString(path, html);
        return html;
      }
      console.warn(`${url} returned something that was not the reader`);
    } catch (e) {
      console.warn(`${url} failed: ${e}`);
    }
  }

  if (fm.fileExists(path)) {
    console.log("using the cached reader");
    return fm.readString(path);
  }
  return null;
}

// -------------------------------------------------------------- position

function positionsPath() {
  return fm.joinPath(fm.libraryDirectory(), POSITIONS);
}

function readPositions() {
  try {
    const p = positionsPath();
    return fm.fileExists(p) ? JSON.parse(fm.readString(p)) : {};
  } catch (e) {
    return {};
  }
}

/**
 * Keyed on name and byte length rather than on a hash of the contents: the
 * reader has to be handed a resume point before it has parsed anything, and
 * re-reading a 40 MB file to fingerprint it would cost more than it saves.
 */
function positionKey(name, bytes) {
  return `${name}|${bytes}`;
}

function savePosition(key, index, name) {
  const all = readPositions();
  all[key] = { index, name, at: Date.now() };

  // Keep the twenty most recent. This file is read on every run.
  const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
  const trimmed = {};
  for (const k of keys.slice(0, 20)) trimmed[k] = all[k];

  try {
    fm.writeString(positionsPath(), JSON.stringify(trimmed));
  } catch (e) {
    console.warn("could not save the position: " + e);
  }
}

// ------------------------------------------------------------- settings

/**
 * Keychain, not the page's localStorage.
 *
 * A Scriptable WebView starts with a fresh data store most runs, so anything
 * typed into the reader's settings sheet is gone by the next launch. Holding
 * the key out here means it is typed once, and it sits in the iOS keychain
 * rather than in a file in the scripts folder.
 */
function loadSettings() {
  const s = {};
  if (Keychain.contains(KEYCHAIN.elevenKey)) {
    s.elevenKey = Keychain.get(KEYCHAIN.elevenKey);
    s.engine = "elevenlabs";
    if (Keychain.contains(KEYCHAIN.elevenVoice)) s.elevenVoice = Keychain.get(KEYCHAIN.elevenVoice);
  } else if (Keychain.contains(KEYCHAIN.openaiKey)) {
    s.openaiKey = Keychain.get(KEYCHAIN.openaiKey);
    s.engine = "openai";
  }
  return s;
}

async function setUpVoice() {
  const a = new Alert();
  a.title = "Cloud voice";
  a.message =
    "Optional. A device voice costs nothing and works offline; a cloud voice " +
    "sounds like a person and runs about a tenth of a cent a page.\n\n" +
    "The key is stored in this phone's keychain and sent only to the voice " +
    "provider you pick.";
  a.addSecureTextField("ElevenLabs API key", Keychain.contains(KEYCHAIN.elevenKey) ? Keychain.get(KEYCHAIN.elevenKey) : "");
  a.addTextField("ElevenLabs voice ID (optional)", Keychain.contains(KEYCHAIN.elevenVoice) ? Keychain.get(KEYCHAIN.elevenVoice) : "");
  a.addSecureTextField("OpenAI API key", Keychain.contains(KEYCHAIN.openaiKey) ? Keychain.get(KEYCHAIN.openaiKey) : "");
  a.addAction("Save");
  a.addDestructiveAction("Forget both");
  a.addCancelAction("Cancel");

  const choice = await a.presentAlert();
  if (choice === -1) return;

  if (choice === 1) {
    for (const k of Object.values(KEYCHAIN)) if (Keychain.contains(k)) Keychain.remove(k);
    return;
  }

  const set = (slot, value) => {
    const v = (value || "").trim();
    if (v) Keychain.set(slot, v);
    else if (Keychain.contains(slot)) Keychain.remove(slot);
  };
  set(KEYCHAIN.elevenKey, a.textFieldValue(0));
  set(KEYCHAIN.elevenVoice, a.textFieldValue(1));
  set(KEYCHAIN.openaiKey, a.textFieldValue(2));
}

// ---------------------------------------------------------------- input

/** Share-sheet input, if this run came from one. */
function sharedPdfPaths() {
  const paths = (args.fileURLs || []).filter((p) => /\.pdf$/i.test(p));
  return paths;
}

async function pickPdf() {
  try {
    const picked = await DocumentPicker.open(["com.adobe.pdf", "public.pdf"]);
    return (picked || []).filter((p) => /\.pdf$/i.test(p));
  } catch (e) {
    return [];   // the picker throws on cancel
  }
}

/** A PDF behind a URL — a Learning Suite attachment, a link someone sent. */
async function downloadPdf(url) {
  const req = new Request(url);
  req.timeoutInterval = 45;
  const data = await req.load();
  const name = decodeURIComponent(url.split("/").pop().split("?")[0]) || "download.pdf";
  const path = fm.joinPath(fm.temporaryDirectory(), name.endsWith(".pdf") ? name : name + ".pdf");
  fm.write(path, data);
  return path;
}

// ---------------------------------------------------------------- reader

/**
 * Opens the reader, runs it, and writes down where it got to.
 *
 * The order here is the whole trick. Scriptable can run JavaScript in a
 * WebView before it is presented but not while it is on screen, so everything
 * that has to go in — settings, the content, the resume point — goes in first;
 * the extraction is kicked off without waiting for it, so what appears is the
 * progress meter rather than a blank sheet; and the state comes back out once
 * the sheet is dismissed.
 *
 * `payload` is the base64 of a PDF or the plain text of a reading. Either way
 * it goes over in slices: evaluateJavaScript takes the whole script as one
 * string, and a 40 MB PDF is 54 MB of base64, which older phones drop silently.
 */
async function present(name, payload, opener, opts) {
  const options = opts || {};
  const html = await playerHtml();

  if (!html) {
    await say(
      "Couldn't load the reader",
      "The reader page could not be downloaded and there is no cached copy on " +
      "this device yet. Check your connection and try once more.\n\n" + PLAYER_URLS[0],
    );
    return null;
  }

  const key = positionKey(name, payload.length);
  const resume = options.resume != null ? options.resume : (readPositions()[key] || {}).index || 0;

  const view = new WebView();
  await view.loadHTML(html, BASE_URL);

  const settings = { ...loadSettings(), ...(options.settings || {}) };
  await view.evaluateJavaScript(
    `window.__SCRIPTABLE__ = true; window.TermBoardReader.settings(${JSON.stringify(settings)});`,
  );

  for (let i = 0; i < payload.length; i += CHUNK) {
    await view.evaluateJavaScript(
      `window.TermBoardReader.pushChunk(${JSON.stringify(payload.slice(i, i + CHUNK))});`,
    );
  }

  // Deliberately not awaited inside the page: extraction and OCR can run for
  // minutes on a long scan, and the point of the progress meter is that it is
  // visible while they do.
  await view.evaluateJavaScript(opener(resume) + ' "started";');

  await view.present(true);

  // Back from the sheet. Whatever the reader got to is worth keeping even if
  // the page errored on the way — a failed read returns null and simply leaves
  // the old position alone.
  let state = null;
  try {
    state = await view.evaluateJavaScript("completion(window.TermBoardReader.state());", true);
  } catch (e) {
    console.warn("could not read the player state back: " + e);
  }

  if (state && typeof state.index === "number") {
    savePosition(key, state.index, name);
    console.log(`${name}: stopped at sentence ${state.index + 1} of ${state.sentences}`);
  }
  return state;
}

/** A PDF on disk. */
async function read(path, opts) {
  const name = path.split("/").pop();
  const data = Data.fromFile(path);
  if (!data) {
    await say("Couldn't read that file", name + " could not be opened.");
    return null;
  }
  return present(
    name,
    data.toBase64String(),
    (resume) => `window.TermBoardReader.openInjected(${JSON.stringify(name)}, ${resume});`,
    opts,
  );
}

/**
 * Text the scraper already extracted, rather than a file.
 *
 * Term Board's readings come out of Supabase as plain text, so there is no PDF
 * to hand over and nothing to parse — this path skips straight to speaking.
 */
async function readText(name, text, opts) {
  if (!text || !text.trim()) {
    await say("Nothing to read", "There is no extracted text for " + name + ".");
    return null;
  }
  return present(
    name,
    text,
    (resume) => `window.TermBoardReader.openText(${JSON.stringify(name)}, null, ${resume});`,
    opts,
  );
}

async function say(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addAction("OK");
  await a.presentAlert();
}

// ------------------------------------------------------------------ main

async function main() {
  console.log(`Read Aloud ${VERSION}`);

  // Shared straight in from Files or Mail: skip every menu and start reading.
  const shared = sharedPdfPaths();
  if (shared.length) {
    for (const path of shared) await read(path);
    Script.complete();
    return;
  }

  // Shared a link rather than a file.
  const urls = (args.urls || []).filter((u) => /\.pdf(\?|$)/i.test(u));
  if (urls.length) {
    try {
      await read(await downloadPdf(urls[0]));
    } catch (e) {
      await say("Couldn't download that", String(e));
    }
    Script.complete();
    return;
  }

  const recent = readPositions();
  const keys = Object.keys(recent).sort((a, b) => recent[b].at - recent[a].at).slice(0, 5);

  const menu = new Alert();
  menu.title = "Read Aloud";
  menu.message = "Pick a PDF and it will be read to you.";
  menu.addAction("Choose a PDF");
  menu.addAction("Paste a link");
  menu.addAction("Voice settings");
  menu.addCancelAction("Cancel");

  const choice = await menu.presentSheet();

  if (choice === 0) {
    const paths = await pickPdf();
    if (!paths.length) { Script.complete(); return; }
    for (const p of paths) await read(p);
  } else if (choice === 1) {
    const url = (Pasteboard.paste() || "").trim();
    if (!/^https?:\/\//.test(url)) {
      await say("Nothing to open", "The clipboard doesn't have a link on it.");
    } else {
      try { await read(await downloadPdf(url)); }
      catch (e) { await say("Couldn't download that", String(e)); }
    }
  } else if (choice === 2) {
    await setUpVoice();
  }

  if (keys.length) console.log("recent: " + keys.map((k) => recent[k].name).join(", "));
  Script.complete();
}

// Term Board imports this file to hand a reading straight over. `importModule`
// runs the whole script top to bottom, so the menu has to be suppressed on
// import or opening a reading would pop a file picker first.
module.exports = { read, readText, pickPdf, downloadPdf, setUpVoice, playerHtml, VERSION };

/**
 * Whether this run is an import rather than the script itself.
 *
 * Two independent tests, because neither is guaranteed on its own. The flag
 * only works if Scriptable evaluates both scripts in one JavaScript context,
 * which is not something to bet the entry point on; the filename test only
 * works if `module.filename` is populated. Either one saying "imported" is
 * enough, and if both are unavailable this falls through to running normally,
 * which is the right default for a script someone just tapped.
 *
 * `globalThis`, not `global` — Scriptable runs on JavaScriptCore, where the
 * Node spelling does not exist and throws a ReferenceError on sight.
 */
function importedAsModule() {
  if (typeof globalThis !== "undefined" && globalThis.READ_ALOUD_AS_MODULE === true) return true;

  // Script.name() is the script that was *run*; module.filename is the file
  // being evaluated. They differ only on an import. Both have to be readable
  // for the comparison to mean anything — if either is missing the answer is
  // "not imported", because a script that silently does nothing when tapped is
  // a far worse failure than a stray menu.
  try {
    const entry = Script.name();
    const here = module.filename.split("/").pop().replace(/\.js$/i, "");
    if (entry && here) return here !== entry;
  } catch (e) {}
  return false;
}

if (!importedAsModule()) {
  await main();
}
