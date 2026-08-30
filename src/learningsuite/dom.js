/**
 * Generic page-reading helpers.
 *
 * These carry no Learning Suite knowledge — they take the candidate lists from
 * selectors.js and turn whatever markup is actually there into plain objects.
 * Keeping the guessing and the parsing apart is what makes a wrong selector a
 * one-line fix.
 */

/** First selector in `candidates` that matches something on the page. */
export async function firstMatch(scope, candidates) {
  for (const sel of candidates) {
    const loc = scope.locator(sel).first();
    if (await loc.count().catch(() => 0)) return loc;
  }
  return null;
}

/**
 * Read every table on the page as { headers, rows } with the cell text already
 * trimmed, plus any href found in each cell so a row can be followed later.
 */
export async function readTables(page) {
  return page.evaluate(() => {
    const text = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();

    return Array.from(document.querySelectorAll("table")).map((table) => {
      const headerCells = Array.from(
        table.querySelectorAll("thead th, thead td, tr:first-child th"),
      );
      const headers = headerCells.map((c) => text(c).toLowerCase());

      const bodyRows = Array.from(
        table.querySelectorAll("tbody tr"),
      ).length
        ? Array.from(table.querySelectorAll("tbody tr"))
        : Array.from(table.querySelectorAll("tr")).slice(headers.length ? 1 : 0);

      const rows = bodyRows
        .map((tr) =>
          Array.from(tr.querySelectorAll("td, th")).map((td) => {
            const link = td.querySelector("a[href]");
            return { text: text(td), href: link ? link.href : null };
          }),
        )
        .filter((cells) => cells.some((c) => c.text.length));

      return { headers, rows, className: table.className || "", id: table.id || "" };
    });
  });
}

/**
 * Map a table's headers onto the fields described by a `columns` spec from
 * selectors.js. Returns { field: columnIndex }, omitting fields with no column.
 */
export function mapColumns(headers, columns) {
  const index = {};
  for (const [field, aliases] of Object.entries(columns)) {
    for (const alias of aliases) {
      const at = headers.findIndex((h) => h.includes(alias));
      if (at !== -1) {
        index[field] = at;
        break;
      }
    }
  }
  return index;
}

/**
 * Score how well a table matches a column spec, so the right table can be
 * picked out of a page that has several (nav tables, layout tables, footers).
 */
export function scoreTable(table, columns) {
  const mapped = mapColumns(table.headers, columns);
  return Object.keys(mapped).length + (table.rows.length ? 1 : 0);
}

export function pickBestTable(tables, columns) {
  let best = null;
  let bestScore = 0;
  for (const t of tables) {
    const score = scoreTable(t, columns);
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  // A table with no recognisable headers and no rows is not worth returning.
  return bestScore >= 2 ? best : null;
}

/** Cell text at a mapped column, or "" when that column is absent. */
export function cell(row, index, field) {
  const at = index[field];
  return at === undefined || !row[at] ? "" : row[at].text;
}

export function cellHref(row, index, field) {
  const at = index[field];
  return at === undefined || !row[at] ? null : row[at].href;
}

/** The whole page as visible text — used for unpublished-course detection. */
export async function pageText(page) {
  return page
    .evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim())
    .catch(() => "");
}
