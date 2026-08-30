/**
 * Due-date parsing.
 *
 * Learning Suite renders dates in a handful of human formats and never with a
 * timezone. They are all Mountain Time, so the offset has to be reconstructed —
 * and it changes mid-semester (MDT ends 1 Nov 2026), which is exactly the seam
 * where a naive parser silently shifts every November deadline by an hour.
 */

import { TERM } from "./config.js";

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** The UTC offset America/Denver is on for a given local wall-clock date. */
export function mountainOffset(year, month, day) {
  // Ask the runtime rather than hard-coding DST rules, so this stays correct in
  // future years without a code change.
  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: TERM.timezone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName")?.value; // e.g. "GMT-6"
  const hours = Number(/GMT([+-]\d{1,2})/.exec(name || "")?.[1] ?? -7);
  const sign = hours < 0 ? "-" : "+";
  return `${sign}${String(Math.abs(hours)).padStart(2, "0")}:00`;
}

/**
 * Parse a Learning Suite date string into an ISO-8601 string with the right
 * Mountain offset. Returns null when the string carries no usable date — a
 * "no due date" assignment is normal and must not throw.
 */
export function parseDue(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/\s+/g, " ").trim();
  if (!s || /^(n\/?a|none|no due date|--|-)$/i.test(s)) return null;

  let year, month, day;

  // "Sep 3, 2026" / "September 3 2026" / "Sep 3" (year implied by the term)
  const named = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,)?(?:\s+(\d{4}))?/.exec(s);
  // "9/3/2026" or "9/3"
  const numeric = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(s);

  if (named && MONTHS[named[1].slice(0, 4).toLowerCase().replace(/\.$/, "")] !== undefined) {
    month = MONTHS[named[1].slice(0, 4).toLowerCase().replace(/\.$/, "")];
    day = Number(named[2]);
    year = named[3] ? Number(named[3]) : impliedYear(month);
  } else if (named && MONTHS[named[1].slice(0, 3).toLowerCase()] !== undefined) {
    month = MONTHS[named[1].slice(0, 3).toLowerCase()];
    day = Number(named[2]);
    year = named[3] ? Number(named[3]) : impliedYear(month);
  } else if (numeric) {
    month = Number(numeric[1]);
    day = Number(numeric[2]);
    const y = numeric[3];
    year = y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : impliedYear(month);
  } else {
    return null;
  }

  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;

  // "11:59 PM", "9:30am", "23:59". Learning Suite's default for a date with no
  // time is end of day, which matches how the board already reads.
  let hour = 23;
  let minute = 59;
  const time = /(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(s);
  if (time) {
    hour = Number(time[1]);
    minute = Number(time[2]);
    const meridiem = time[3]?.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else if (/\bnoon\b/i.test(s)) {
    hour = 12;
    minute = 0;
  } else if (/\bmidnight\b/i.test(s)) {
    hour = 0;
    minute = 0;
  }

  const pad = (n) => String(n).padStart(2, "0");
  const offset = mountainOffset(year, month, day);
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${offset}`;
}

/**
 * A bare "Sep 3" belongs to whichever year keeps it inside the term. Fall runs
 * Aug–Dec in one calendar year, so this is unambiguous in practice.
 */
function impliedYear(month) {
  const startYear = Number(TERM.starts.slice(0, 4));
  const endYear = Number(TERM.ends.slice(0, 4));
  if (startYear === endYear) return startYear;
  return month >= Number(TERM.starts.slice(5, 7)) ? startYear : endYear;
}

/** Is this due date inside the configured term window? */
export function withinTerm(iso) {
  if (!iso) return true; // undated items are kept; the board shows them last.
  const t = new Date(iso).getTime();
  const from = new Date(`${TERM.starts}T00:00:00${mountainOffset(
    ...TERM.starts.split("-").map(Number),
  )}`).getTime();
  const to = new Date(`${TERM.ends}T23:59:59${mountainOffset(
    ...TERM.ends.split("-").map(Number),
  )}`).getTime();
  return t >= from && t <= to;
}
