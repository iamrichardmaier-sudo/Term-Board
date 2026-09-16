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

// Usable inner height on a common iPhone, less the widget's own padding. The
// accessory families are the lock screen, where iOS gives every widget the
// same small box whatever the phone.
const USABLE = {
  small: 141, medium: 141, large: 305,
  accessoryCircular: 72, accessoryRectangular: 72, accessoryInline: 20,
};

const source = await fs.readFile(new URL("../scriptable/TermBoard.js", import.meta.url), "utf8");
const body = source.replace(/await run\(\);\s*$/, "");

function makeHarness(family) {
  const widget = {
    _items: [],
    _pad: 0,
    setPadding(t, _r, b) { this._pad = t + b; },
    set backgroundColor(_) {},
    set backgroundGradient(_) {},
    set addAccessoryWidgetBackground(_) {},
    set url(_) {},

    addText() {
      const x = { size: 12 };
      widget._items.push({ kind: "line", ref: x });
      return text(x);
    },
    addSpacer(n) { widget._items.push({ kind: "spacer", value: n }); },
    addStack() {
      const group = { kind: "line", refs: [] };
      widget._items.push(group);
      return stack(group);
    },
  };

  // A text or an image sets the height of the row it is in; so does a stack
  // given an explicit size, which is how the accent bars and the progress bar
  // are drawn. Everything lands in the same group so the row is measured by
  // its tallest thing, which is what iOS does.
  const text = (x) => ({
    set font(v) { x.size = v; },
    set textColor(_) {}, set lineLimit(_) {}, set minimumScaleFactor(_) {},
    set centerAlignText(_) {}, centerAlignText() {},
  });

  const stack = (group) => ({
    addText() { const x = { size: 12 }; group.refs.push(x); return text(x); },
    addStack() { return stack(group); },
    addImage() { const x = { size: 0 }; group.refs.push(x); return { set imageSize(v) { x.size = v.height; }, set tintColor(_) {}, set resizable(_) {}, set cornerRadius(_) {} }; },
    addSpacer() {},
    setPadding() {},
    centerAlignContent() {}, layoutVertically() {}, layoutHorizontally() {},
    set spacing(_) {}, set backgroundColor(_) {}, set cornerRadius(_) {},
    set borderWidth(_) {}, set borderColor(_) {}, set url(_) {},
    set size(v) { group.refs.push({ size: v.height }); },
  });

  const font = (n) => n;
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => stub() });

  return {
    widget,
    context: vm.createContext({
      config: { runsInWidget: true, widgetFamily: family },
      console: { log() {}, warn() {}, error() {} },
      ListWidget: function () { return widget; },
      Color: function () {},
      Size: function (width, height) { this.width = width; this.height = height; },
      Point: function (x, y) { this.x = x; this.y = y; },
      LinearGradient: function () {
        this.colors = []; this.locations = []; this.startPoint = null; this.endPoint = null;
      },
      Device: stub(),
      Font: { boldSystemFont: font, systemFont: font, mediumSystemFont: font, semiboldSystemFont: font },
      DateFormatter: function () { this.dateFormat = ""; this.string = () => "Sep 3"; },
      Request: stub(), Keychain: stub(), FileManager: stub(), Alert: stub(),
      UITable: stub(), UITableRow: stub(), Safari: stub(), Pasteboard: stub(), Script: stub(),
      SFSymbol: { named: () => ({ image: {} }) },
      global: {},
      importModule: () => { throw new Error("not available in the harness"); },
    }),
  };
}

const board = JSON.parse(await fs.readFile(new URL("../docs/board.json", import.meta.url), "utf8"));

console.log("size                  padding  nominal   worst    usable   verdict");
let failures = 0;

for (const family of ["small", "medium", "large", "accessoryCircular", "accessoryRectangular", "accessoryInline"]) {
  const { widget, context } = makeHarness(family);
  widget._items.length = 0;
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
    `${family.padEnd(22)}${String(pad).padEnd(9)}${String(nominal).padEnd(10)}` +
    `${String(worst).padEnd(9)}${String(usable).padEnd(9)}` +
    `${fits ? "fits" : "OVERFLOWS at 1.4"}`,
  );
}

assert.equal(failures, 0, `${failures} widget size(s) overflow at the pessimistic line height — rows would be clipped on the home screen`);
console.log("\n✓ every size fits, with margin for a larger text setting");
