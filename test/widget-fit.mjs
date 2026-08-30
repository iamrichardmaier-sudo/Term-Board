/**
 * Estimates rendered height per widget size.
 *
 * iOS clips a Scriptable widget silently — rows past the bottom edge simply do
 * not appear, with no error — so overflow is invisible until you look at the
 * home screen and notice the footer is missing. This walks the real
 * buildWidget() with instrumented stubs, treating a top-level text or stack as
 * one line of about 1.2x its font size, and compares the total against the
 * usable height of each family.
 *
 * The numbers are approximate. They are here to catch "medium is 80 points
 * over", not to predict layout to the pixel.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

// Usable inner height on a common iPhone, less the widget's own padding.
const USABLE = { small: 141, medium: 141, large: 305 };

const source = await fs.readFile(new URL("../scriptable/TermBoard.js", import.meta.url), "utf8");
const body = source.replace(/await run\(\);\s*$/, "");

function makeHarness(family) {
  const lines = [];

  class Text {
    constructor(size) { this.size = size; }
    set font(f) { this.size = f; }
    set textColor(_) {} set lineLimit(_) {} set minimumScaleFactor(_) {}
  }
  class Stack {
    constructor(sink) { this.sink = sink; this.max = 0; }
    addText(t) { const x = new Text(0); this.sink.pending.push(x); this._track(x); return x; }
    addStack() { return this; }
    addSpacer() {} centerAlignContent() {} set spacing(_) {} layoutHorizontally() {}
    _track(x) { this.sink.current.push(x); }
  }

  const widget = {
    _items: [],
    setPadding(t, _r, b) { this._pad = t + b; },
    set backgroundColor(_) {} , set url(_) {},
    addText(s) { const x = { size: 12 }; widget._items.push({ kind: "line", ref: x }); 
      return { set font(v) { x.size = v; }, set textColor(_) {}, set lineLimit(_) {}, set minimumScaleFactor(_) {} }; },
    addSpacer(n) { widget._items.push({ kind: "spacer", value: n }); },
    addStack() {
      const group = { kind: "line", refs: [] };
      widget._items.push(group);
      const st = {
        addText() { const x = { size: 12 }; group.refs.push(x);
          return { set font(v) { x.size = v; }, set textColor(_) {}, set lineLimit(_) {}, set minimumScaleFactor(_) {} }; },
        addStack() { return st; },
        addSpacer() {}, centerAlignContent() {}, set spacing(_) {}, layoutHorizontally() {},
      };
      return st;
    },
  };

  const font = (n) => n;
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => stub() });

  return {
    widget,
    context: vm.createContext({
      config: { runsInWidget: true, widgetFamily: family },
      console: { log() {}, warn() {}, error() {} },
      ListWidget: function () { return widget; },
      Color: function () {}, Device: stub(),
      Font: { boldSystemFont: font, systemFont: font, mediumSystemFont: font, semiboldSystemFont: font },
      DateFormatter: function () { this.dateFormat = ""; this.string = () => "Sep 3"; },
      Request: stub(), Keychain: stub(), FileManager: stub(), Alert: stub(),
      UITable: stub(), UITableRow: stub(), Safari: stub(), Pasteboard: stub(), Script: stub(),
    }),
  };
}

const board = JSON.parse(await fs.readFile(new URL("../docs/board.json", import.meta.url), "utf8"));

console.log("size    padding  nominal   worst    usable   verdict");
let failures = 0;

for (const family of ["small", "medium", "large"]) {
  const { widget, context } = makeHarness(family);
  vm.runInContext(`${body}\nglobalThis.__build = buildWidget;`, context);

  const data = { ...board, grades: [
    { course: "ARAB 201", percent: 94.5, grade: "94.5%" },
    { course: "IHUM 242", percent: 88, grade: "88%" },
  ], signedIn: true };

  context.__build(data);

  // Line height is estimated, so the guard is the pessimistic figure. 1.25 is
  // about right for SF; 1.4 covers a larger Dynamic Type setting or a device
  // whose widget is a little shorter than the reference. A layout that only
  // fits at 1.25 is one accessibility setting away from losing its footer.
  const measure = (mult) => {
    let content = 0;
    for (const item of widget._items) {
      if (item.kind === "spacer") content += item.value === undefined ? 0 : item.value;
      else if (item.refs) content += Math.max(...item.refs.map((r) => r.size), 8) * mult;
      else content += (item.ref?.size ?? 12) * mult;
    }
    return content;
  };

  const pad = widget._pad ?? 0;
  const nominal = Math.round(measure(1.25) + pad);
  const worst = Math.round(measure(1.4) + pad);
  const usable = USABLE[family] + pad; // USABLE is inner; add padding back
  const fits = worst <= usable;
  if (!fits) failures++;
  console.log(
    `${family.padEnd(8)}${String(pad).padEnd(9)}${String(nominal).padEnd(10)}` +
    `${String(worst).padEnd(9)}${String(usable).padEnd(9)}` +
    `${fits ? "fits" : "OVERFLOWS at 1.4"}`,
  );
}

assert.equal(failures, 0, `${failures} widget size(s) overflow at the pessimistic line height — rows would be clipped on the home screen`);
console.log("\n✓ every size fits, with margin for a larger text setting");
