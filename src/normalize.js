/**
 * Turn raw scrape output into the Term Board payload.
 *
 * Two shapes come out of here on purpose:
 *
 *   snapshot  Small. Everything the board and the widget draw — assignments,
 *             due dates, grades, and the conversation-readiness flag. Fetched
 *             on every widget refresh, so it must stay light.
 *
 *   readings  Large. The extracted instructions and reading text, keyed by
 *             assignment id, fetched only when a conversation is started.
 *
 * Splitting them is what keeps a home-screen widget from pulling a megabyte of
 * Al-Kitaab down every fifteen minutes.
 */

import { TERM } from "./config.js";

export function slug(...parts) {
  return parts
    .join(" ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

/** Loose title match, so "Quiz 13.1" lines up with "Quiz 13.1 (Vocab)". */
function titleKey(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();
}

/** Attach gradebook scores to the assignments they belong to. */
function joinGrades(assignments, gradebookItems) {
  const byKey = new Map();
  for (const g of gradebookItems) byKey.set(titleKey(g.title), g);

  for (const a of assignments) {
    const key = titleKey(a.title);
    let match = byKey.get(key);
    if (!match) {
      // Fall back to a containment match — gradebooks often prefix a category.
      for (const [k, g] of byKey) {
        if (k.includes(key) || key.includes(k)) {
          match = g;
          break;
        }
      }
    }
    if (match) {
      a.score = match.score;
      a.possible = match.possible ?? a.points;
      a.percent = match.percent;
      a.graded = match.graded;
    } else {
      a.score = null;
      a.possible = a.points;
      a.percent = null;
      a.graded = false;
    }
  }

  // Graded items that never appear on the assignment list (participation,
  // in-class credit) still belong on the board.
  const known = new Set(assignments.map((a) => titleKey(a.title)));
  return gradebookItems.filter((g) => g.graded && !known.has(titleKey(g.title)));
}

/** The sentence the board and widget show under a course name. */
export function gradeLabel(course) {
  if (!course.published) return "Not on Learning Suite yet";
  if (!course.grade || course.grade.percent === null || course.grade.percent === undefined) {
    return "No grades posted yet";
  }
  const { percent, letter, gradedCount } = course.grade;
  const pct = `${percent}%`;
  const head = letter ? `${pct} · ${letter}` : pct;
  return `${head} · ${gradedCount} graded`;
}

export function buildPayload(scraped, { scrapedAt = new Date().toISOString() } = {}) {
  const courses = [];
  const assignments = [];
  const readings = [];
  const flags = [];
  const warnings = [];

  for (const entry of scraped) {
    const { course, gradebook, assignments: raw, content, error } = entry;

    if (error) {
      warnings.push({ course: course.code, message: error });
    }

    const items = (raw?.items || []).map((item) => ({
      ...item,
      id: slug(course.code, item.title),
    }));

    const orphanGrades = joinGrades(items, gradebook?.items || []);
    for (const g of orphanGrades) {
      items.push({
        id: slug(course.code, g.title),
        course: course.code,
        group: course.group,
        title: g.title,
        due: null,
        dueRaw: null,
        category: "Graded item",
        minor: true,
        points: g.possible,
        score: g.score,
        possible: g.possible,
        percent: g.percent,
        graded: true,
        instructions: null,
        rubric: null,
        readings: [],
        textQuality: "none",
        textQualityReason: "This came from the gradebook only — there is no assignment page behind it.",
        conversationReady: false,
      });
    }

    const graded = items.filter((i) => i.graded);
    courses.push({
      code: course.code,
      name: course.name,
      group: course.group,
      cid: course.cid,
      published: Boolean(course.published && (gradebook?.published || raw?.published)),
      grade: gradebook?.overall
        ? { ...gradebook.overall, gradedCount: graded.length, itemCount: items.length }
        : graded.length
          ? { percent: null, letter: null, source: "none", gradedCount: graded.length, itemCount: items.length }
          : null,
      contentItems: content?.items?.length || 0,
    });
    courses[courses.length - 1].gradeLabel = gradeLabel(courses[courses.length - 1]);

    for (const item of items) {
      // The heavy text goes to the readings table, keyed by assignment id.
      const bodies = [];
      if (item.instructions) bodies.push({ label: "Instructions", text: item.instructions });
      if (item.rubric) bodies.push({ label: "Rubric", text: item.rubric });
      for (const r of item.readings) {
        if (r.text) bodies.push({ label: r.name, text: r.text });
      }
      if (bodies.length) {
        readings.push({
          assignmentId: item.id,
          course: course.code,
          title: item.title,
          bodies,
          chars: bodies.reduce((a, b) => a + b.text.length, 0),
        });
      }

      if (item.textQuality !== "clean" && item.textQuality !== "unknown" && !item.minor) {
        flags.push({
          course: course.code,
          assignmentId: item.id,
          title: item.title,
          quality: item.textQuality,
          reason: item.textQualityReason,
        });
      }

      assignments.push({
        id: item.id,
        course: item.course,
        group: item.group,
        title: item.title,
        due: item.due,
        category: item.category,
        minor: item.minor,
        points: item.points,
        score: item.score,
        possible: item.possible,
        percent: item.percent,
        graded: item.graded,
        status: item.status,
        url: item.detailUrl || null,
        readingCount: item.readings.length,
        textQuality: item.textQuality,
        textQualityReason: item.textQualityReason,
        conversationReady: item.conversationReady,
      });
    }

    // Course-level readings with no assignment behind them, kept so a quiz can
    // still be walked through using the week's reading.
    for (const c of content?.items || []) {
      if (c.text && c.quality === "clean") {
        readings.push({
          assignmentId: slug(course.code, "content", c.name),
          course: course.code,
          title: c.name,
          bodies: [{ label: c.name, text: c.text }],
          chars: c.text.length,
          courseContent: true,
        });
      }
    }

    if (raw?.needsCalibration || gradebook?.needsCalibration) {
      warnings.push({
        course: course.code,
        message:
          "The page loaded but nothing matched the expected table shape. " +
          "Run `npm run calibrate` and correct src/learningsuite/selectors.js.",
      });
    }
  }

  assignments.sort((a, b) => {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return new Date(a.due) - new Date(b.due);
  });

  return {
    snapshot: {
      schemaVersion: 1,
      term: { id: TERM.id, label: TERM.label, timezone: TERM.timezone },
      scrapedAt,
      courses,
      assignments,
      flags,
      warnings,
      stats: {
        courses: courses.length,
        published: courses.filter((c) => c.published).length,
        assignments: assignments.length,
        graded: assignments.filter((a) => a.graded).length,
        conversationReady: assignments.filter((a) => a.conversationReady).length,
        flagged: flags.length,
      },
    },
    readings,
  };
}
