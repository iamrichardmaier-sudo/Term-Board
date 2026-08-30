/**
 * One-time migration: turn the Term Board's hand-built item list into a
 * scraper-shaped snapshot.
 *
 * The board was built by hand from a manual Learning Suite pull in August. This
 * lifts those hundred items into the schema the scraper emits, so the board can
 * switch to the generated renderer before the first real scrape rather than
 * going blank in between. After the first scrape this script has no further use.
 *
 *   node tools/seed-from-artifact.mjs <artifact.html> [out.json]
 */

import fs from "node:fs/promises";
import path from "node:path";
import { COURSES, TERM } from "../src/config.js";
import { slug, gradeLabel } from "../src/normalize.js";

const [, , input, output = "data/seed.json"] = process.argv;
if (!input) {
  console.error("usage: node tools/seed-from-artifact.mjs <artifact.html> [out.json]");
  process.exit(1);
}

const html = await fs.readFile(input, "utf8");

const start = html.indexOf("var items = [");
const end = html.indexOf("].map(function(r){", start);
if (start === -1 || end === -1) {
  console.error("Could not find the items array in that file.");
  process.exit(1);
}

const literal = html.slice(start + "var items = ".length, end + 1);
// The array references two constants declared just above it in the artifact.
const ARAB = "ARAB 201";
const IHUM = "IHUM 242";
const rows = new Function("ARAB", "IHUM", `return ${literal};`)(ARAB, IHUM);

const assignments = rows.map(([course, title, due, category, minor]) => ({
  id: slug(course, title),
  course,
  group: course === ARAB ? "arab" : "ihum",
  title,
  due,
  category,
  minor: Boolean(minor),
  points: null,
  score: null,
  possible: null,
  percent: null,
  graded: false,
  status: null,
  url: null,
  readingCount: 0,
  // Nothing was extracted for these — they came from a human reading the
  // gradebook. "unknown" keeps them out of the flag list, which is honest:
  // we have not looked at their readings yet, rather than looked and failed.
  textQuality: "unknown",
  textQualityReason: null,
  conversationReady: false,
}));

const seen = new Set(assignments.map((a) => a.course));
const courses = COURSES.map((c) => {
  const course = {
    code: c.code,
    name: c.name,
    group: c.group,
    cid: c.cid,
    published: seen.has(c.code),
    grade: null,
    contentItems: 0,
  };
  course.gradeLabel = gradeLabel(course);
  return course;
});

const snapshot = {
  schemaVersion: 1,
  term: { id: TERM.id, label: TERM.label, timezone: TERM.timezone },
  scrapedAt: new Date().toISOString(),
  seeded: true,
  courses,
  assignments,
  flags: [],
  warnings: [
    {
      course: "*",
      message:
        "Seeded from the hand-built board. Grades and reading text arrive with the first scrape.",
    },
  ],
  stats: {
    courses: courses.length,
    published: courses.filter((c) => c.published).length,
    assignments: assignments.length,
    graded: 0,
    conversationReady: 0,
    flagged: 0,
  },
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(snapshot, null, 2), "utf8");
console.log(`✓ ${output} — ${assignments.length} assignments, ${snapshot.stats.published} published courses`);
