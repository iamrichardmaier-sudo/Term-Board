/**
 * One full pass over Learning Suite.
 *
 * A course that is not published yet is the normal case for six of the eight
 * this term, so it is skipped quietly rather than treated as a failure. A
 * course that IS published but blows up mid-scrape is recorded as a warning and
 * the run continues — a broken IHUM page must not cost the ARAB data.
 */

import { launch, ensureLoggedIn } from "./auth.js";
import { discoverCourses } from "./learningsuite/courses.js";
import { scrapeGradebook } from "./learningsuite/gradebook.js";
import { scrapeAssignments } from "./learningsuite/assignments.js";
import { scrapeContent } from "./learningsuite/content.js";
import { buildPayload } from "./normalize.js";
import { log } from "./log.js";

export async function scrapeAll({ headless = true, withContent = true, only = null } = {}) {
  const context = await launch({ headless });
  const page = context.pages()[0] || (await context.newPage());

  try {
    await ensureLoggedIn(page, { interactive: !headless });

    const courses = await discoverCourses(page);
    const targets = only
      ? courses.filter((c) => only.includes(c.code))
      : courses;

    const results = [];
    for (const course of targets) {
      if (!course.cid) {
        log.step(`${course.code}: not on Learning Suite yet — skipped`);
        results.push({ course, gradebook: null, assignments: null, content: null });
        continue;
      }

      log.info(`— ${course.code}`);
      const entry = { course, gradebook: null, assignments: null, content: null };
      try {
        entry.gradebook = await scrapeGradebook(page, course);
        entry.assignments = await scrapeAssignments(page, course);
        if (withContent) entry.content = await scrapeContent(page, course);

        // Published on paper but empty everywhere: treat as unpublished so the
        // board says "not on Learning Suite yet" instead of showing a blank.
        if (!entry.gradebook?.published && !entry.assignments?.published) {
          course.published = false;
        }
      } catch (err) {
        log.error(`${course.code}: ${err.message}`);
        entry.error = err.message;
      }
      results.push(entry);
    }

    return buildPayload(results);
  } finally {
    await context.close();
  }
}
