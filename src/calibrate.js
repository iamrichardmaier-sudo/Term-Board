/**
 * Dump the pages the scraper depends on, so a wrong guess in selectors.js can
 * be corrected by looking at the real markup instead of by trial and error.
 *
 * Output lands in calibration/, which is gitignored — these files contain
 * grades and reading text.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { LEARNING_SUITE, PATHS } from "./config.js";
import { launch, ensureLoggedIn } from "./auth.js";
import { discoverCourses } from "./learningsuite/courses.js";
import { readTables } from "./learningsuite/dom.js";
import { log } from "./log.js";

export async function calibrate({ headless = true } = {}) {
  const context = await launch({ headless });
  const page = context.pages()[0] || (await context.newPage());
  const outDir = path.join(PATHS.calibration, new Date().toISOString().slice(0, 10));
  await fs.mkdir(outDir, { recursive: true });

  try {
    await ensureLoggedIn(page, { interactive: !headless });
    const courses = await discoverCourses(page);
    const report = [];

    await dump(page, LEARNING_SUITE.origin + LEARNING_SUITE.paths.courseList, outDir, "course-list", report);

    for (const course of courses.filter((c) => c.cid)) {
      for (const kind of ["gradebook", "assignments", "content", "syllabus"]) {
        const url = LEARNING_SUITE.origin + LEARNING_SUITE.paths[kind](course.cid);
        await dump(page, url, outDir, `${course.code.replace(/\s+/g, "")}-${kind}`, report);
      }
    }

    await fs.writeFile(
      path.join(outDir, "report.json"),
      JSON.stringify(report, null, 2),
      "utf8",
    );

    log.info(`✓ calibration written to ${outDir}`);
    log.info("  report.json lists every table found, with its headers and row count.");
    log.info("  Match those headers against src/learningsuite/selectors.js.");
    return outDir;
  } finally {
    await context.close();
  }
}

async function dump(page, url, outDir, name, report) {
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    const html = await page.content();
    await fs.writeFile(path.join(outDir, `${name}.html`), html, "utf8");
    const tables = await readTables(page);
    report.push({
      name,
      url,
      status: response?.status() ?? null,
      finalUrl: page.url(),
      tables: tables.map((t) => ({
        id: t.id,
        className: t.className,
        headers: t.headers,
        rowCount: t.rows.length,
        firstRow: t.rows[0]?.map((c) => c.text) ?? [],
      })),
    });
    log.step(`dumped ${name} (${tables.length} table${tables.length === 1 ? "" : "s"})`);
  } catch (err) {
    report.push({ name, url, error: err.message });
    log.warn(`${name}: ${err.message}`);
  }
}
