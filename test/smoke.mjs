/**
 * End-to-end check of the parts that do not need Learning Suite: the date
 * parser, the payload builder and the board renderer.
 *
 * The fixture deliberately includes the awkward cases — a course that is not
 * published, a gradebook row with no assignment behind it, a scanned PDF, and
 * an assignment with no due date — because those are what actually break a
 * board that only ever gets tested on the happy path.
 */

import assert from "node:assert/strict";
import { buildPayload } from "../src/normalize.js";
import { renderBoard } from "../src/render.js";
import { parseDue } from "../src/dates.js";
import { scoreItem } from "../src/learningsuite/assignments.js";

const arab = { code: "ARAB 201", name: "2nd-Year Arabic", group: "arab", cid: "cid-5Ny6_0vtpMlw", published: true };
const ihum = { code: "IHUM 242", name: "Islamic Humanities", group: "ihum", cid: "cid-UeWtUUbc59pv", published: true };
const econ = { code: "ECON 380", name: "ECON 380", group: "econ", cid: null, published: false };

function assignment(course, title, dueRaw, category, extra = {}) {
  return {
    course: course.code, group: course.group, title,
    due: parseDue(dueRaw), dueRaw, category,
    minor: /drill|verb chart|activity/i.test(category),
    points: 10, status: null, detailUrl: `https://learningsuite.byu.edu/x/${title}`,
    instructions: null, rubric: null, readings: [],
    textQuality: "unknown", textQualityReason: null, conversationReady: false,
    ...extra,
  };
}

const cleanEssay = assignment(ihum, "Kickoff Essay", "Sep 10, 2026 11:59 PM", "Essay", {
  instructions: "Write eight hundred words on the interview. ".repeat(20),
  readings: [{ name: "Prompt.pdf", kind: "pdf", text: "The prompt text ".repeat(60), quality: "clean", reason: null }],
});
const scannedWorksheet = assignment(arab, "Drill 22 Worksheet", "Dec 2, 2026 11:59 PM", "AK Activity", {
  readings: [{ name: "worksheet.pdf", kind: "pdf", text: "", quality: "image-only", reason: "The PDF has no extractable text — it is almost certainly a scan." }],
});
const scannedQuiz = assignment(ihum, "Readings Quiz 1", "Sep 10, 2026 9:30 AM", "Quiz", {
  readings: [{ name: "reading-scan.pdf", kind: "pdf", text: "", quality: "image-only", reason: "The PDF has no extractable text — it is almost certainly a scan." }],
});
const undated = assignment(arab, "Speaking Appointment 1", "N/A", "Speaking");

[cleanEssay, scannedWorksheet, scannedQuiz, undated].forEach(scoreItem);

assert.equal(cleanEssay.conversationReady, true, "clean essay should be conversation-ready");
assert.equal(scannedQuiz.conversationReady, false, "scanned quiz must not be conversation-ready");
assert.equal(scannedQuiz.textQuality, "image-only");
assert.equal(undated.textQuality, "none");
assert.equal(undated.due, null);

const { snapshot, readings } = buildPayload([
  {
    course: arab,
    gradebook: {
      published: true,
      overall: { percent: 94.5, letter: "A", source: "page" },
      items: [
        { title: "Drill 22 Worksheet", score: 9, possible: 10, percent: 90, graded: true },
        { title: "Participation", score: 20, possible: 20, percent: 100, graded: true },
      ],
    },
    assignments: { published: true, items: [scannedWorksheet, undated] },
    content: { published: true, items: [] },
  },
  {
    course: ihum,
    gradebook: { published: true, overall: null, items: [] },
    assignments: { published: true, items: [cleanEssay, scannedQuiz] },
    content: { published: true, items: [{ name: "Week 1 reading", url: "x", kind: "html", text: "Ibn Khaldun ".repeat(80), quality: "clean", reason: null }] },
  },
  { course: econ, gradebook: null, assignments: null, content: null },
]);

// --- payload shape -------------------------------------------------------
assert.equal(snapshot.courses.length, 3);
const arabCourse = snapshot.courses.find((c) => c.code === "ARAB 201");
assert.equal(arabCourse.gradeLabel, "94.5% · A · 2 graded", `got: ${arabCourse.gradeLabel}`);
assert.equal(snapshot.courses.find((c) => c.code === "IHUM 242").gradeLabel, "No grades posted yet");
assert.equal(snapshot.courses.find((c) => c.code === "ECON 380").gradeLabel, "Not on Learning Suite yet");

// The orphan gradebook row became a board item.
assert.ok(snapshot.assignments.some((a) => a.title === "Participation" && a.graded));
// The matched row carried its score onto the assignment.
const worksheet = snapshot.assignments.find((a) => a.title === "Drill 22 Worksheet");
assert.equal(worksheet.score, 9);
assert.equal(worksheet.possible, 10);

// Undated items sort last rather than crashing the comparator.
assert.equal(snapshot.assignments.at(-1).due, null);

// Flags: minor items are excluded, real ones are not.
const flagged = snapshot.flags.map((f) => f.title);
assert.ok(flagged.includes("Readings Quiz 1"), "scanned quiz should be flagged");
assert.ok(!flagged.includes("Drill 22 Worksheet"), "minor drills should not clutter the flag list");

// Reading text is split out of the snapshot.
assert.ok(readings.some((r) => r.assignmentId === "ihum-242-kickoff-essay"));
assert.ok(readings.some((r) => r.courseContent));
assert.ok(!JSON.stringify(snapshot).includes("Ibn Khaldun"), "snapshot must stay light — no reading bodies");

// --- render --------------------------------------------------------------
const html = await renderBoard(snapshot);
assert.ok(html.includes("<title>Term Board</title>"));
assert.ok(html.includes("94.5% · A · 2 graded"), "course grade should replace the placeholder");
assert.ok(html.includes("No grades posted yet"), "a published course with no grades still says so");
assert.ok(html.includes("Not on Learning Suite yet"));
assert.ok(html.includes("--arab") && html.includes("--gci"), "original palette preserved");
assert.ok(html.includes("termboard-weeks"), "week open/closed persistence preserved");
assert.ok(html.includes("Show daily drills"), "drill toggle preserved");
assert.ok(html.includes("Won't work well in a voice walkthrough"));
assert.ok(!/<!doctype/i.test(html), "artifacts are published without a doctype");
assert.ok(!html.includes("<html"), "artifact body only");

// Balanced enough to parse: no stray unescaped braces from the template.
const opens = (html.match(/<div/g) || []).length;
const closes = (html.match(/<\/div>/g) || []).length;
assert.equal(opens, closes, `unbalanced divs: ${opens} open, ${closes} close`);

console.log("✓ smoke tests passed");
console.log(`  ${snapshot.stats.assignments} assignments · ${snapshot.stats.graded} graded · ` +
  `${snapshot.stats.conversationReady} conversation-ready · ${snapshot.stats.flagged} flagged`);
console.log(`  board HTML: ${(html.length / 1024).toFixed(1)} KB`);
