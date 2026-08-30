/**
 * Gradebook scraping: per-item scores and the running course total.
 *
 * A course with a published gradebook but no graded work yet is a normal state,
 * not a failure — it returns an empty item list and a null overall grade, which
 * the board renders as "no grades posted yet".
 */

import { LEARNING_SUITE } from "../config.js";
import { GRADEBOOK, SYLLABUS } from "./selectors.js";
import { readTables, mapColumns, pickBestTable, cell, pageText, firstMatch } from "./dom.js";
import { log } from "../log.js";

const NUMBER = /-?\d+(?:\.\d+)?/;

function num(text) {
  const m = NUMBER.exec(String(text || "").replace(/,/g, ""));
  return m ? Number(m[0]) : null;
}

/** "17/20", "17 out of 20", "85%" — all seen in gradebook cells. */
function parseScoreCell(text) {
  const s = String(text || "").trim();
  if (!s || /^(-|--|not graded|ungraded|n\/a)$/i.test(s)) return { score: null, possible: null };
  const pair = /(-?\d+(?:\.\d+)?)\s*(?:\/|out of)\s*(\d+(?:\.\d+)?)/i.exec(s);
  if (pair) return { score: Number(pair[1]), possible: Number(pair[2]) };
  return { score: num(s), possible: null };
}

export async function scrapeGradebook(page, course) {
  const url = LEARNING_SUITE.origin + LEARNING_SUITE.paths.gradebook(course.cid);
  await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});

  const body = await pageText(page);
  if (isUnpublished(body)) {
    log.step(`${course.code}: gradebook not published`);
    return { published: false, overall: null, items: [] };
  }

  const tables = await readTables(page);
  const table = pickBestTable(tables, GRADEBOOK.columns);
  if (!table) {
    log.flag(`${course.code}: gradebook page loaded but no recognisable grade table`);
    return { published: true, overall: null, items: [], needsCalibration: true };
  }

  const index = mapColumns(table.headers, GRADEBOOK.columns);
  const items = [];
  for (const row of table.rows) {
    const title = cell(row, index, "title").trim();
    if (!title || /^total$/i.test(title)) continue;

    const scoreText = cell(row, index, "score");
    const { score, possible } = parseScoreCell(scoreText);
    const declaredPossible = num(cell(row, index, "possible"));
    const percentText = cell(row, index, "percent");

    const outOf = possible ?? declaredPossible;
    const percent =
      num(percentText) ??
      (score !== null && outOf ? Math.round((score / outOf) * 1000) / 10 : null);

    items.push({ title, score, possible: outOf, percent, graded: score !== null });
  }

  const overall = await readOverall(page, items);
  const graded = items.filter((i) => i.graded).length;
  log.step(
    `${course.code}: gradebook ${items.length} item${items.length === 1 ? "" : "s"}, ` +
      `${graded} graded${overall?.percent != null ? `, overall ${overall.percent}%` : ""}`,
  );

  return { published: true, overall, items };
}

async function readOverall(page, items) {
  const loc = await firstMatch(page, GRADEBOOK.overall);
  if (loc) {
    const text = (await loc.textContent().catch(() => "")) || "";
    const percent = num(/(\d+(?:\.\d+)?)\s*%/.exec(text)?.[1] ?? "");
    const letter = /\b([A-D][+-]?|F)\b/.exec(text)?.[1] ?? null;
    if (percent !== null || letter) return { percent, letter, source: "page" };
  }

  // Fall back to computing it from the graded rows, which is what a student
  // would do by hand anyway.
  const graded = items.filter((i) => i.graded && i.possible);
  if (!graded.length) return null;
  const earned = graded.reduce((a, i) => a + i.score, 0);
  const out = graded.reduce((a, i) => a + i.possible, 0);
  if (!out) return null;
  return {
    percent: Math.round((earned / out) * 1000) / 10,
    letter: null,
    source: "computed",
  };
}

export function isUnpublished(text) {
  const lower = (text || "").toLowerCase();
  return SYLLABUS.unpublishedMarkers.some((m) => lower.includes(m));
}
