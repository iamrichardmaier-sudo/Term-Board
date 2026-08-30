// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: calendar-check;

/**
 * Term Board — loader
 * ---------------------------------------------------------------------------
 * Paste this ONCE. It fetches the real script from the repo and runs it, so
 * changes reach the phone without copying seven hundred lines across again.
 *
 * The last good copy is cached on the device, so this still works on a plane or
 * when GitHub is down — it only goes to the network to look for something newer.
 *
 * THE TRADE: this executes code fetched from the internet at run time. That is
 * fine here because it is your own repository and you control what lands in it,
 * but it does mean anyone who could push to that repo could run code on your
 * phone. If you would rather not accept that, don't use this file — paste
 * TermBoard.js directly instead. It is the same script; this one just saves the
 * copying.
 *
 * SETUP
 *   1. Scriptable → + → paste this file → name it "Term Board".
 *   2. Run it once. It downloads the real script and caches it.
 *   3. Home screen → add a Scriptable widget (Large) → pick this script.
 *      Set "When Interacting" to "Run Script".
 */

const SOURCE_URL =
  "https://raw.githubusercontent.com/iamrichardmaier-sudo/term-board" +
  "/main/scriptable/TermBoard.js";

const CACHE_NAME = "TermBoard.core.js";

// libraryDirectory, not documentsDirectory: documents is Scriptable's own script
// list, and a .js written there would show up as a second script to run.
const fm = FileManager.local();
const cachePath = fm.joinPath(fm.libraryDirectory(), CACHE_NAME);

let source = null;

try {
  const req = new Request(SOURCE_URL);
  req.timeoutInterval = 15;
  const fetched = await req.loadString();

  // A 404 from raw.githubusercontent is the string "404: Not Found", and any
  // proxy or captive portal returns HTML. Check for a marker the real script
  // always carries rather than trusting that something came back.
  if (fetched && fetched.includes("const VERSION") && fetched.length > 5000) {
    source = fetched;
    fm.writeString(cachePath, fetched);
  } else {
    console.warn("Fetched something that was not the Term Board script; using cache.");
  }
} catch (e) {
  console.warn("Could not reach GitHub, using the cached copy: " + e);
}

if (!source && fm.fileExists(cachePath)) {
  source = fm.readString(cachePath);
}

if (!source) {
  const a = new Alert();
  a.title = "Term Board couldn't start";
  a.message =
    "The script could not be downloaded and there is no cached copy on this " +
    "device yet. Check your connection and run it once more.\n\n" + SOURCE_URL;
  a.addAction("OK");
  if (config.runsInWidget) {
    const w = new ListWidget();
    w.backgroundColor = new Color("#1c1c1e");
    const t = w.addText("Term Board\nCouldn't load");
    t.textColor = new Color("#8e8e93");
    t.font = Font.systemFont(12);
    Script.setWidget(w);
    Script.complete();
  } else {
    await a.presentAlert();
  }
} else {
  // The script ends in a top-level `await run()`, which is legal inside an async
  // function but not at the top level of a Function body — hence the wrapper.
  // Scriptable's APIs are globals, so they resolve normally in here.
  await new Function(`return (async () => {\n${source}\n})()`)();
}
