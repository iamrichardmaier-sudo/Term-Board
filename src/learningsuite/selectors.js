/**
 * Every Learning-Suite-specific DOM assumption in the project lives here.
 *
 * IMPORTANT: these are unverified. Learning Suite sits behind CAS, so they were
 * written from the public URL shape rather than from the live markup, and the
 * first real run is expected to correct some of them. That is what
 * `npm run calibrate` is for: it dumps each page's HTML plus a summary of the
 * tables and headings it found, so a wrong guess here can be fixed in one file
 * without touching the pipeline.
 *
 * Each entry is a list of candidates tried in order. The parsers also fall back
 * to generic table reading, so a miss here degrades to "fewer fields" rather
 * than "no data".
 */

export const COURSE_LIST = {
  // Anchors whose href carries the /.NYCE/cid-<id>/ course namespace. This one
  // is reliable regardless of layout, because the URL shape is the API.
  courseLink: 'a[href*="/.NYCE/cid-"]',
  cidPattern: /\/\.NYCE\/(cid-[A-Za-z0-9_-]+)\//,
};

export const ASSIGNMENTS = {
  containers: [
    "table.assignment-list",
    "table#assignments",
    ".assignment-list",
    '[data-testid="assignments"]',
    "table",
  ],
  rows: ["tbody tr", "tr", ".assignment-row", "li.assignment"],
  // Header text used to work out which column is which, lower-cased and matched
  // as a substring. Order within each list is preference order.
  columns: {
    title: ["assignment", "title", "name", "item"],
    due: ["due", "due date", "deadline"],
    category: ["category", "type", "group"],
    points: ["points", "possible", "pts"],
    score: ["score", "grade", "earned", "your score"],
    status: ["status", "submitted"],
  },
  detailLink: 'a[href*="/student/assignment"], a[href*="assignmentId"], td a',
};

export const ASSIGNMENT_DETAIL = {
  // The rubric / instructions body. First match wins.
  body: [
    ".assignment-description",
    ".assignment-instructions",
    "#assignmentDescription",
    ".description",
    '[data-testid="assignment-body"]',
    "main",
  ],
  rubric: [".rubric", "table.rubric", "#rubric"],
  attachments: 'a[href$=".pdf"], a[href*="/file/"], a[href*="download"], a[href$=".docx"]',
};

export const GRADEBOOK = {
  containers: ["table#gradebook", "table.gradebook", ".gradebook", "table"],
  rows: ["tbody tr", "tr"],
  columns: {
    title: ["assignment", "item", "name", "category"],
    score: ["score", "points earned", "earned", "grade"],
    possible: ["possible", "out of", "points possible", "max"],
    percent: ["percent", "%"],
  },
  // The running course total, usually rendered outside the per-item table.
  overall: [
    ".course-grade",
    ".overall-grade",
    "#currentGrade",
    '[data-testid="course-grade"]',
    "tfoot tr",
  ],
};

export const CONTENT = {
  // Course content / reading material tree.
  itemLink: 'a[href*="/student/content"], a[href$=".pdf"], .content-item a, li a',
  title: [".content-title", "h1", "h2", ".title"],
  body: [".content-body", "#contentBody", "article", "main"],
};

export const SYLLABUS = {
  body: [".syllabus", "#syllabus", "article", "main"],
  // Learning Suite renders this (or something like it) when an instructor has
  // not published. Matched case-insensitively against the page's text.
  unpublishedMarkers: [
    "no syllabus",
    "not been published",
    "not yet published",
    "syllabus is not available",
    "instructor has not",
    "no content available",
  ],
};
