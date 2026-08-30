/**
 * Static facts about the term. Everything here is stable across a semester;
 * anything that changes daily is scraped, not configured.
 */

export const TERM = {
  id: "fall-2026",
  label: "Fall 2026",
  // Used to bound the assignment window so a course that leaves last term's
  // items visible cannot leak them onto the board.
  starts: "2026-08-31",
  ends: "2026-12-18",
  timezone: process.env.TERM_BOARD_TIMEZONE || "America/Denver",
};

export const LEARNING_SUITE = {
  origin: "https://learningsuite.byu.edu",
  // Learning Suite namespaces every student route under /.NYCE/cid-<courseId>/.
  // These paths are the part most likely to drift; `npm run calibrate` dumps
  // each one so they can be corrected without touching the rest of the code.
  paths: {
    home: "/",
    courseList: "/student/home",
    assignments: (cid) => `/.NYCE/${cid}/student/assignments`,
    gradebook: (cid) => `/.NYCE/${cid}/student/gradebook`,
    content: (cid) => `/.NYCE/${cid}/student/content`,
    syllabus: (cid) => `/.NYCE/${cid}/student/syllabus`,
  },
};

/**
 * The eight Fall 2026 courses.
 *
 * `cid` is Learning Suite's opaque course id, taken from the gradebook links
 * already on the Term Board. The six without one are not published yet — the
 * scraper discovers their ids from the course list once they appear, and skips
 * them quietly until then.
 *
 * `group` drives the colour band on the board and in the widget, and matches
 * the CSS custom properties the Term Board artifact already defines.
 */
export const COURSES = [
  { code: "ARAB 201", name: "2nd-Year Arabic",        group: "arab", cid: "cid-5Ny6_0vtpMlw" },
  { code: "IHUM 242", name: "Islamic Humanities",     group: "ihum", cid: "cid-UeWtUUbc59pv" },
  { code: "ECON 378", name: "ECON 378",               group: "econ", cid: null },
  { code: "ECON 380", name: "ECON 380",               group: "econ", cid: null },
  { code: "ECON 381", name: "ECON 381",               group: "econ", cid: null },
  { code: "ECON 210", name: "Career Prep",            group: "econ", cid: null },
  { code: "GCI 320",  name: "Implementing Social Impact", group: "gci", cid: null },
  { code: "GCI 330",  name: "Evaluating Social Impact",   group: "gci", cid: null },
];

/** Categories the board treats as background noise rather than real deadlines. */
export const MINOR_CATEGORIES = [
  "AK Activity",
  "Verb Chart",
  "Drill",
  "Daily Drill",
  "Practice",
];

/**
 * A reading has to survive this much clean text before it is worth handing to a
 * voice conversation. Below it, the item is flagged rather than dropped — a
 * scanned worksheet still belongs on the board, it just will not read aloud.
 */
export const TEXT_QUALITY = {
  minCharsForConversation: 400,
  // Mean extractable characters per PDF page. A born-digital page clears this
  // comfortably; a scanned image page yields almost nothing.
  minCharsPerPdfPage: 120,
};

export const PATHS = {
  profile: ".browser-profile",
  credentials: ".credentials",
  data: "data",
  calibration: "calibration",
};
