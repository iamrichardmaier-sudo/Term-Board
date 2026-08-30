/**
 * Tests the parts of TermBoard.js that are plain logic: date bucketing, the
 * public/private merge, and the overdue and upcoming filters.
 *
 * Scriptable's globals do not exist under Node, so the file is loaded with them
 * stubbed and its trailing `await run()` removed. Everything that touches the
 * network or the UI is out of scope here — this covers the code that would
 * silently show the wrong day.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = await fs.readFile(new URL("../scriptable/TermBoard.js", import.meta.url), "utf8");
const body = source.replace(/await run\(\);\s*$/, "");

const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => stub() });
const context = vm.createContext({
  config: { runsInWidget: false, widgetFamily: "large" },
  console,
  Request: stub(), Keychain: stub(), FileManager: stub(), Alert: stub(),
  ListWidget: stub(), UITable: stub(), UITableRow: stub(), Safari: stub(),
  Pasteboard: stub(), Script: stub(), Color: stub(), Font: stub(), Device: stub(),
  DateFormatter: function () { this.dateFormat = ""; this.string = (d) => d.toISOString().slice(0, 10); },
});

vm.runInContext(
  `${body}\nglobalThis.__t = { daysUntil, formatDue, merge, overdue, upcoming, shortCode, groupOf };`,
  context,
);
const t = context.__t;

// --- daysUntil buckets by calendar day, not elapsed hours ------------------
const today = new Date();
const endOfToday = new Date(today); endOfToday.setHours(23, 59, 0, 0);
const tomorrowLate = new Date(today); tomorrowLate.setDate(today.getDate() + 1); tomorrowLate.setHours(23, 59, 0, 0);
const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

assert.equal(t.daysUntil(endOfToday.toISOString()), 0, "something due tonight is due today");
assert.equal(t.formatDue(endOfToday.toISOString()), "today");
assert.equal(t.daysUntil(tomorrowLate.toISOString()), 1);
assert.equal(t.formatDue(tomorrowLate.toISOString()), "tomorrow");
assert.equal(t.formatDue(yesterday.toISOString()), "yesterday");

// --- merge overlays private scores onto the public schedule ----------------
const board = {
  term: "Fall 2026",
  gradesArePrivate: true,
  grades: [],
  assignments: [
    { id: "a1", course: "ARAB 201", title: "Quiz 13.1", due: endOfToday.toISOString(), category: "Quiz", minor: false, conversationReady: true },
    { id: "a2", course: "IHUM 242", title: "Kickoff Essay", due: tomorrowLate.toISOString(), category: "Essay", minor: false, conversationReady: false, textQuality: "image-only" },
    { id: "a3", course: "ARAB 201", title: "Drill 2", due: tomorrowLate.toISOString(), category: "Drill", minor: true, conversationReady: false },
    { id: "a4", course: "IHUM 242", title: "Map assignment", due: yesterday.toISOString(), category: "Assignment", minor: false, conversationReady: true },
  ],
  flags: [],
};
const snapshot = {
  courses: [
    { code: "ARAB 201", grade: { percent: 94.5 } },
    { code: "IHUM 242", grade: null },
  ],
  assignments: [{ id: "a1", graded: true, score: 9, possible: 10 }],
};

const merged = t.merge(board, snapshot);
assert.equal(merged.grades.length, 1, "only courses with a posted grade appear");
assert.equal(merged.grades[0].grade, "94.5%");
assert.equal(merged.assignments.find((a) => a.id === "a1").score, 9, "score overlaid from Supabase");
assert.equal(merged.assignments.find((a) => a.id === "a2").score, undefined, "ungraded stays ungraded");

// Without a snapshot the schedule still works, just without scores.
const noGrades = t.merge(board, null);
assert.deepEqual(noGrades.grades, []);
assert.equal(noGrades.assignments.length, 4);

// --- filters ---------------------------------------------------------------
const late = t.overdue(merged);
assert.equal(late.length, 1, "one overdue, ungraded item");
assert.equal(late[0].id, "a4");

const ahead = t.upcoming(merged);
assert.ok(!ahead.some((a) => a.minor), "drills stay off the widget");
assert.ok(!ahead.some((a) => a.id === "a4"), "overdue is not 'upcoming'");
assert.equal(ahead[0].id, "a1", "soonest first");

// A graded overdue item is done, not outstanding.
const settled = t.merge({ ...board, assignments: [{ ...board.assignments[3], id: "a4" }] }, { courses: [], assignments: [{ id: "a4", graded: true, score: 10, possible: 10 }] });
assert.equal(t.overdue(settled).length, 0, "a graded past-due item is not overdue");

assert.equal(t.shortCode("ARAB 201"), "ARAB");
assert.equal(t.groupOf("GCI 330"), "gci");
assert.equal(t.groupOf("ECON 378"), "econ");

// --- the real published feed parses and filters ---------------------------
const real = JSON.parse(await fs.readFile(new URL("../docs/board.json", import.meta.url), "utf8"));
assert.ok(Array.isArray(real.assignments) && real.assignments.length > 0);
assert.equal(real.gradesArePrivate, true);
assert.ok(!JSON.stringify(real).includes('"score"'), "no scores in the public feed");
const realMerged = t.merge(real, null);
console.log("✓ widget logic tests passed");
console.log(`  real feed: ${real.assignments.length} assignments · ` +
  `${t.upcoming(realMerged).length} upcoming · ${t.overdue(realMerged).length} overdue`);
