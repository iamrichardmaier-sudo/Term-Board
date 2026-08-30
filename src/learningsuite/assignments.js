/**
 * Assignment scraping: the list, then each assignment's own page for the
 * rubric text and whatever reading it links to.
 *
 * The detail pass is the expensive half of the run, so it is bounded and
 * individually fault-tolerant: one assignment whose page 404s or whose PDF is
 * corrupt must not cost the other seventy.
 */

import { LEARNING_SUITE, MINOR_CATEGORIES } from "../config.js";
import { ASSIGNMENTS, ASSIGNMENT_DETAIL } from "./selectors.js";
import { readTables, mapColumns, pickBestTable, cell, cellHref, pageText, firstMatch } from "./dom.js";
import { isUnpublished } from "./gradebook.js";
import { parseDue, withinTerm } from "../dates.js";
import { htmlToText, judgeText } from "../extract/html.js";
import { extractPdf } from "../extract/pdf.js";
import { log } from "../log.js";

/** Items in these categories are drills, not deadlines the board leads with. */
function isMinor(category, title) {
  const haystack = `${category} ${title}`.toLowerCase();
  return MINOR_CATEGORIES.some((c) => haystack.includes(c.toLowerCase()));
}

export async function scrapeAssignments(page, course, { withDetail = true, detailLimit = 200 } = {}) {
  const url = LEARNING_SUITE.origin + LEARNING_SUITE.paths.assignments(course.cid);
  await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});

  const body = await pageText(page);
  if (isUnpublished(body)) {
    log.step(`${course.code}: assignments not published`);
    return { published: false, items: [] };
  }

  const tables = await readTables(page);
  const table = pickBestTable(tables, ASSIGNMENTS.columns);
  if (!table) {
    log.flag(`${course.code}: assignment page loaded but no recognisable assignment table`);
    return { published: true, items: [], needsCalibration: true };
  }

  const index = mapColumns(table.headers, ASSIGNMENTS.columns);
  const items = [];

  for (const row of table.rows) {
    const title = cell(row, index, "title").trim();
    if (!title) continue;

    const due = parseDue(cell(row, index, "due"));
    if (!withinTerm(due)) continue;

    const category = cell(row, index, "category").trim() || inferCategory(title);
    items.push({
      course: course.code,
      group: course.group,
      title,
      due,
      dueRaw: cell(row, index, "due").trim() || null,
      category,
      minor: isMinor(category, title),
      points: numberOrNull(cell(row, index, "points")),
      status: cell(row, index, "status").trim() || null,
      detailUrl: cellHref(row, index, "title") || cellHref(row, index, "due"),
      // Filled by the detail pass.
      instructions: null,
      rubric: null,
      readings: [],
      textQuality: "unknown",
      textQualityReason: null,
      conversationReady: false,
    });
  }

  log.step(`${course.code}: ${items.length} assignment${items.length === 1 ? "" : "s"}`);

  if (withDetail) {
    const withLinks = items.filter((i) => i.detailUrl).slice(0, detailLimit);
    for (const [n, item] of withLinks.entries()) {
      try {
        await loadDetail(page, item);
      } catch (err) {
        log.warn(`${course.code} · "${item.title}": detail failed — ${err.message}`);
        item.textQuality = "error";
        item.textQualityReason = `Could not read the assignment page: ${err.message}`;
      }
      if ((n + 1) % 10 === 0) log.step(`${course.code}: ${n + 1}/${withLinks.length} details`);
    }
  }

  return { published: true, items };
}

function numberOrNull(text) {
  const m = /-?\d+(?:\.\d+)?/.exec(String(text || ""));
  return m ? Number(m[0]) : null;
}

/** A best-effort category when the table has no category column. */
function inferCategory(title) {
  const t = title.toLowerCase();
  if (/final exam/.test(t)) return "Final";
  if (/midterm/.test(t)) return "Midterm";
  if (/\btest\b/.test(t)) return "Test";
  if (/\bquiz\b/.test(t)) return "Quiz";
  if (/\bessay\b|\bpaper\b/.test(t)) return "Paper";
  if (/presentation/.test(t)) return "Presentation";
  if (/speaking|oral/.test(t)) return "Speaking";
  if (/verb chart/.test(t)) return "Verb Chart";
  if (/drill/.test(t)) return "Drill";
  return "Assignment";
}

async function loadDetail(page, item) {
  await page.goto(item.detailUrl, { waitUntil: "domcontentloaded" });

  const bodyLoc = await firstMatch(page, ASSIGNMENT_DETAIL.body);
  const instructionsHtml = bodyLoc ? await bodyLoc.innerHTML().catch(() => "") : "";
  item.instructions = htmlToText(instructionsHtml) || null;

  const rubricLoc = await firstMatch(page, ASSIGNMENT_DETAIL.rubric);
  if (rubricLoc) {
    item.rubric = htmlToText(await rubricLoc.innerHTML().catch(() => "")) || null;
  }

  const attachments = await page.evaluate((sel) => {
    const seen = new Set();
    return Array.from(document.querySelectorAll(sel))
      .map((a) => ({ href: a.href, name: (a.textContent || "").replace(/\s+/g, " ").trim() }))
      .filter((a) => a.href && !seen.has(a.href) && seen.add(a.href));
  }, ASSIGNMENT_DETAIL.attachments);

  for (const attachment of attachments.slice(0, 6)) {
    item.readings.push(await fetchReading(page, attachment));
  }

  scoreItem(item);
}

/**
 * Pull one linked reading down through the browser's own session and turn it
 * into text. Requests go through `page.request`, so they carry the CAS cookies
 * without a second login.
 */
async function fetchReading(page, { href, name }) {
  const reading = { name: name || href, url: href, kind: "unknown", text: null, quality: "unknown", reason: null };
  try {
    const response = await page.request.get(href, { timeout: 30_000 });
    if (!response.ok()) {
      reading.quality = "error";
      reading.reason = `Download failed with HTTP ${response.status()}.`;
      return reading;
    }

    const type = (response.headers()["content-type"] || "").toLowerCase();

    if (type.includes("pdf") || /\.pdf(\?|$)/i.test(href)) {
      reading.kind = "pdf";
      const result = await extractPdf(await response.body());
      reading.text = result.text || null;
      reading.pages = result.pages;
      reading.charsPerPage = result.charsPerPage;
      reading.quality = result.quality;
      reading.reason = result.reason;
      return reading;
    }

    if (type.includes("html") || type.includes("text")) {
      reading.kind = type.includes("html") ? "html" : "text";
      const text = htmlToText(await response.text());
      reading.text = text || null;
      Object.assign(reading, judgeText(text));
      return reading;
    }

    // Word documents, slide decks, media. Recognised and reported rather than
    // silently dropped, so the flag on the widget can say what it actually is.
    reading.kind = type.split(";")[0] || "binary";
    reading.quality = "image-only";
    reading.reason = `This is a ${reading.kind} file, which this scraper does not read as text.`;
    return reading;
  } catch (err) {
    reading.quality = "error";
    reading.reason = `Could not fetch it: ${err.message}`;
    return reading;
  }
}

/**
 * Decide whether an assignment has enough clean text behind it to be worth a
 * voice walkthrough, and say why when it does not.
 */
export function scoreItem(item) {
  const sources = [];
  if (item.instructions) sources.push({ label: "instructions", ...judgeText(item.instructions), length: item.instructions.length });
  if (item.rubric) sources.push({ label: "rubric", ...judgeText(item.rubric), length: item.rubric.length });
  for (const r of item.readings) {
    sources.push({ label: r.name, quality: r.quality, reason: r.reason, length: (r.text || "").length });
  }

  if (!sources.length) {
    item.textQuality = "none";
    item.textQualityReason = "Nothing on this assignment's page to read — no instructions and no attachments.";
    item.conversationReady = false;
    return item;
  }

  const clean = sources.filter((s) => s.quality === "clean");
  if (clean.length) {
    item.textQuality = "clean";
    item.textQualityReason = null;
    item.conversationReady = true;
    return item;
  }

  const degraded = sources.filter((s) => s.quality === "image-only" || s.quality === "sparse" || s.quality === "error");
  item.textQuality = degraded.some((s) => s.quality === "image-only") ? "image-only" : "sparse";
  item.textQualityReason =
    degraded.map((s) => `${s.label}: ${s.reason || "no usable text"}`).join(" ") ||
    "No readable text could be extracted.";
  item.conversationReady = false;
  return item;
}
