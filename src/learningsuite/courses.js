/**
 * Work out which of the eight configured courses Learning Suite will actually
 * talk to today.
 *
 * Six of the eight had no published course when the board was first built. The
 * course id cannot be guessed, so it is read off whatever links the course list
 * renders, matched back to the configured course by its catalogue code.
 */

import { COURSES, LEARNING_SUITE } from "../config.js";
import { COURSE_LIST } from "./selectors.js";
import { log } from "../log.js";

/** Normalise "ARAB 201 (001)", "ARAB201", "Arab 201" to "ARAB 201". */
function normaliseCode(text) {
  const m = /\b([A-Za-z]{2,6})\s*[- ]?\s*(\d{3}[A-Za-z]?)\b/.exec(text || "");
  return m ? `${m[1].toUpperCase()} ${m[2].toUpperCase()}` : null;
}

export async function discoverCourses(page) {
  await page.goto(LEARNING_SUITE.origin + LEARNING_SUITE.paths.courseList, {
    waitUntil: "domcontentloaded",
  });

  const links = await page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(sel)).map((a) => ({
      href: a.href,
      text: (a.textContent || "").replace(/\s+/g, " ").trim(),
      // The row around the link often carries the code when the link text is
      // just the course title.
      context: (a.closest("li, tr, .course, .course-card")?.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200),
    }));
  }, COURSE_LIST.courseLink);

  /** @type {Map<string,string>} code -> cid */
  const found = new Map();
  for (const link of links) {
    const cid = COURSE_LIST.cidPattern.exec(link.href)?.[1];
    if (!cid) continue;
    const code = normaliseCode(link.text) || normaliseCode(link.context);
    if (code && !found.has(code)) found.set(code, cid);
  }

  log.step(`course list: ${found.size} course link${found.size === 1 ? "" : "s"} resolved`);

  // Configured cids win when the page yields nothing — the two known courses
  // keep working even if the course-list markup changes under us.
  return COURSES.map((course) => {
    const cid = found.get(course.code) || course.cid || null;
    return {
      ...course,
      cid,
      discovered: Boolean(found.get(course.code)),
      published: Boolean(cid),
    };
  });
}
