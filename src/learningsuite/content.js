/**
 * The course Content area.
 *
 * Assignments carry their own attachments, but a lot of reading — the IHUM
 * readings the quizzes are actually about, for instance — lives only here, one
 * level away from any assignment. This pass walks the content index shallowly
 * and extracts what it can, so the conversation feature has the reading and not
 * just the quiz title.
 *
 * It is deliberately shallow. Content trees can be large, and a scrape that
 * takes twenty minutes every morning is a scrape that gets turned off.
 */

import { LEARNING_SUITE } from "../config.js";
import { CONTENT } from "./selectors.js";
import { pageText, firstMatch } from "./dom.js";
import { isUnpublished } from "./gradebook.js";
import { htmlToText, judgeText } from "../extract/html.js";
import { extractPdf } from "../extract/pdf.js";
import { log } from "../log.js";

const MAX_ITEMS = 40;

export async function scrapeContent(page, course) {
  const url = LEARNING_SUITE.origin + LEARNING_SUITE.paths.content(course.cid);
  await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});

  const body = await pageText(page);
  if (isUnpublished(body)) {
    log.step(`${course.code}: no course content published`);
    return { published: false, items: [] };
  }

  const links = await page.evaluate((sel) => {
    const seen = new Set();
    return Array.from(document.querySelectorAll(sel))
      .map((a) => ({ href: a.href, name: (a.textContent || "").replace(/\s+/g, " ").trim() }))
      .filter((a) => a.href && a.name && !seen.has(a.href) && seen.add(a.href));
  }, CONTENT.itemLink);

  const items = [];
  for (const link of links.slice(0, MAX_ITEMS)) {
    try {
      items.push(await readContentItem(page, link));
    } catch (err) {
      items.push({
        name: link.name,
        url: link.href,
        kind: "unknown",
        text: null,
        quality: "error",
        reason: `Could not read it: ${err.message}`,
      });
    }
  }

  const clean = items.filter((i) => i.quality === "clean").length;
  log.step(
    `${course.code}: ${items.length} content item${items.length === 1 ? "" : "s"}, ${clean} with clean text`,
  );
  return { published: true, items };
}

async function readContentItem(page, { href, name }) {
  const item = { name, url: href, kind: "unknown", text: null, quality: "unknown", reason: null };

  if (/\.pdf(\?|$)/i.test(href)) {
    const response = await page.request.get(href, { timeout: 30_000 });
    if (!response.ok()) {
      item.kind = "pdf";
      item.quality = "error";
      item.reason = `Download failed with HTTP ${response.status()}.`;
      return item;
    }
    const result = await extractPdf(await response.body());
    return Object.assign(item, {
      kind: "pdf",
      text: result.text || null,
      pages: result.pages,
      charsPerPage: result.charsPerPage,
      quality: result.quality,
      reason: result.reason,
    });
  }

  await page.goto(href, { waitUntil: "domcontentloaded" });
  const bodyLoc = await firstMatch(page, CONTENT.body);
  const text = htmlToText(bodyLoc ? await bodyLoc.innerHTML().catch(() => "") : "");
  return Object.assign(item, { kind: "html", text: text || null }, judgeText(text));
}
