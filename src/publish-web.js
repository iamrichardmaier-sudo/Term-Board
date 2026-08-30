/**
 * Publish the board as static files in docs/, which GitHub Pages serves with no
 * build step and no workflow — Settings -> Pages -> main /docs:
 *
 *   https://iamrichardmaier-sudo.github.io/term-board/
 *   https://iamrichardmaier-sudo.github.io/term-board/board.json
 *
 * This is what lets the Scriptable widget just fetch its data. The Claude
 * artifact could never do that job — artifact URLs need a login, so a widget
 * request gets the app shell or a 403, never the board.
 *
 * GRADES ARE WITHHELD BY DEFAULT. This repository is public, because the widget
 * fetches board.json with no credentials — so anything written here is on the
 * open internet and indexable.
 * Assignment titles and due dates are syllabus information and go out; scores
 * do not. The widget reads those from Supabase instead, signed in as Richard.
 * Pass { publishGrades: true } if you decide otherwise — see README.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { renderBoard } from "./render.js";

const PAGES_URL = "https://iamrichardmaier-sudo.github.io/term-board/";
const ARTIFACT_URL = "https://claude.ai/code/artifact/5a6e40c4-1795-4f6e-8faf-893ab37117f5";

/** Switch to PAGES_URL once public/term-board/ is live on `main`. */
const BOARD_TAP_TARGET = ARTIFACT_URL;
import { log } from "./log.js";

/** Strip every score from a snapshot, leaving the schedule intact. */
function redactGrades(snapshot) {
  return {
    ...snapshot,
    gradesWithheld: true,
    courses: snapshot.courses.map((c) => ({
      ...c,
      grade: null,
      gradeLabel: c.published ? "Grades in the widget" : c.gradeLabel,
    })),
    assignments: snapshot.assignments.map((a) => ({
      ...a,
      score: null,
      possible: null,
      percent: null,
      graded: false,
    })),
  };
}

/**
 * The widget's feed. Deliberately small and flat — a home-screen widget refresh
 * should not pull a term of metadata, and the shape stays readable if you ever
 * open it in a browser.
 */
function boardJson(snapshot, publishGrades) {
  return {
    term: snapshot.term.label,
    generatedAt: snapshot.scrapedAt,
    seeded: Boolean(snapshot.seeded),
    gradesArePrivate: !publishGrades,
    // Where tapping the widget goes. The Pages copy is the better target — it
    // refreshes with every scrape — but Pages only publishes from `main`, so
    // until this work is merged that URL is a 404 and the tap is a dead end.
    // Until then, point at the Claude artifact, which is the same board and
    // works today. Flip BOARD_TAP_TARGET below once the merge lands.
    boardUrl: BOARD_TAP_TARGET,
    pagesUrl: PAGES_URL,

    // {course, grade} matches how the widget renders a row. Empty when grades
    // are withheld, which is what makes the widget fall back to Supabase.
    grades: publishGrades
      ? snapshot.courses
          .filter((c) => c.grade && c.grade.percent != null)
          .map((c) => ({
            course: c.code,
            grade: `${c.grade.percent}%`,
            percent: c.grade.percent,
          }))
      : [],

    courses: snapshot.courses.map((c) => ({
      course: c.code,
      name: c.name,
      group: c.group,
      published: c.published,
    })),

    assignments: snapshot.assignments.map((a) => ({
      id: a.id,
      course: a.course,
      title: a.title,
      due: a.due,
      category: a.category,
      minor: a.minor,
      conversationReady: a.conversationReady,
      textQuality: a.textQuality,
      ...(publishGrades && a.graded
        ? { score: a.score, possible: a.possible }
        : {}),
    })),

    flags: snapshot.flags.map((f) => ({
      course: f.course,
      title: f.title,
      quality: f.quality,
    })),
  };
}

/**
 * @param {object} snapshot
 * @param {string} outDir e.g. <repo>/public/term-board
 * @param {{publishGrades?: boolean}} options
 */
export async function publishWeb(snapshot, outDir, { publishGrades = false } = {}) {
  await fs.mkdir(outDir, { recursive: true });

  const forPage = publishGrades ? snapshot : redactGrades(snapshot);

  const html = await renderBoard(forPage);
  await fs.writeFile(path.join(outDir, "index.html"), pageShell(html), "utf8");

  const json = boardJson(snapshot, publishGrades);
  await fs.writeFile(
    path.join(outDir, "board.json"),
    JSON.stringify(json, null, 2),
    "utf8",
  );

  log.info(`✓ ${path.join(outDir, "index.html")}`);
  log.info(`✓ ${path.join(outDir, "board.json")} — ${json.assignments.length} assignments` +
    (publishGrades ? ", grades included" : ", grades withheld (widget reads Supabase)"));

  return json;
}

/**
 * The renderer emits an artifact body — no doctype, no head — because that is
 * what the Artifact host wants. A file served by Pages needs the wrapper the
 * host would otherwise have supplied.
 */
function pageShell(body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📋</text></svg>">
<style>:root{color-scheme:light dark}html,body{margin:0;padding:0}img{max-width:100%}</style>
</head>
<body>
${body}</body>
</html>
`;
}
