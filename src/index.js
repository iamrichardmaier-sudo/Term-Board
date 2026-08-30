#!/usr/bin/env node
/**
 * term-board — CLI entry point.
 *
 *   login       one-off headed sign-in; seeds the browser profile and stores
 *               credentials with DPAPI. Run this first, and again whenever the
 *               Duo trusted-device cookie expires.
 *   scrape      the daily run. Scrapes, writes data/latest.json, publishes.
 *   calibrate   dumps Learning Suite's real markup for fixing selectors.
 *   render      rebuilds the Term Board HTML from the newest snapshot.
 *   doctor      checks the setup without touching Learning Suite.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { PATHS, TERM, COURSES } from "./config.js";
import { log } from "./log.js";
import * as credentials from "./credentials.js";

// Playwright and the scraper modules are imported lazily. `doctor` has to run
// on a machine where `npm install` has not finished yet — that is exactly when
// it is most useful — so a missing dependency must not break the entry point.

await loadDotEnv();

const [, , command = "help", ...rest] = process.argv;
const flags = new Set(rest.filter((a) => a.startsWith("--")));
const valueOf = (name) => {
  const hit = rest.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

try {
  switch (command) {
    case "login":
      await cmdLogin();
      break;
    case "scrape":
      await cmdScrape();
      break;
    case "calibrate":
      await (await import("./calibrate.js")).calibrate({ headless: !flags.has("--headed") });
      break;
    case "render":
      await cmdRender();
      break;
    case "doctor":
      await cmdDoctor();
      break;
    default:
      usage();
  }
} catch (err) {
  if (err?.code === "NEEDS_REAUTH" || err?.name === "NeedsReauth") {
    log.error(err.message);
    await writeStatus({ ok: false, needsReauth: true, message: err.message });
    // A distinct exit code so the scheduled task can tell "needs your phone"
    // apart from "the scraper is broken".
    process.exit(2);
  }
  log.error(err.stack || err.message);
  await writeStatus({ ok: false, needsReauth: false, message: err.message });
  process.exit(1);
}

async function cmdLogin() {
  const { interactiveLogin } = await import("./auth.js");
  await interactiveLogin();
  if (process.platform === "win32") {
    const email = process.env.SUPABASE_EMAIL || (await credentials.prompt("Supabase email"));
    const password = await credentials.prompt("Supabase password", { secret: true });
    await credentials.store("supabase.password", password);
    log.info(`✓ Supabase credentials stored for ${email}`);
  }
}

async function cmdScrape() {
  const only = valueOf("only")?.split(",").map((s) => s.trim().toUpperCase());
  const { scrapeAll } = await import("./scrape.js");
  const { renderBoard } = await import("./render.js");
  const { snapshot, readings } = await scrapeAll({
    headless: !flags.has("--headed"),
    withContent: !flags.has("--no-content"),
    only: only?.length ? only : null,
  });

  await fs.mkdir(PATHS.data, { recursive: true });
  await fs.writeFile(
    path.join(PATHS.data, "latest.json"),
    JSON.stringify(snapshot, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(PATHS.data, "readings.json"),
    JSON.stringify(readings, null, 2),
    "utf8",
  );

  const s = snapshot.stats;
  log.info(
    `✓ ${s.assignments} assignments across ${s.published}/${s.courses} published courses · ` +
      `${s.graded} graded · ${s.conversationReady} conversation-ready · ${s.flagged} flagged`,
  );
  for (const flag of snapshot.flags.slice(0, 10)) {
    log.flag(`${flag.course} — ${flag.title}: ${flag.reason}`);
  }
  for (const warning of snapshot.warnings) {
    log.warn(`${warning.course}: ${warning.message}`);
  }

  if (flags.has("--no-push")) {
    log.info("--no-push: nothing sent to Supabase. JSON is in data/.");
  } else {
    const { publish } = await import("./supabase.js");
    await publish({ snapshot, readings });
  }

  const html = await renderBoard(snapshot);
  await fs.writeFile(path.join(PATHS.data, "term-board.html"), html, "utf8");
  log.info(`✓ board HTML written to ${path.join(PATHS.data, "term-board.html")}`);

  await writeStatus({ ok: true, needsReauth: false, stats: s, scrapedAt: snapshot.scrapedAt });
}

async function cmdRender() {
  const from = valueOf("from");
  let snapshot;
  if (from) {
    snapshot = JSON.parse(await fs.readFile(from, "utf8"));
  } else {
    const local = path.join(PATHS.data, "latest.json");
    try {
      snapshot = JSON.parse(await fs.readFile(local, "utf8"));
      log.step(`rendering from ${local}`);
    } catch {
      const { fetchLatestSnapshot } = await import("./supabase.js");
      snapshot = await fetchLatestSnapshot();
      if (!snapshot) throw new Error("No snapshot found locally or in Supabase. Run `npm run scrape` first.");
    }
  }
  const out = valueOf("out") || path.join(PATHS.data, "term-board.html");
  const { renderBoard } = await import("./render.js");
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, await renderBoard(snapshot), "utf8");
  log.info(`✓ ${out}`);
}

async function cmdDoctor() {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  add("Node version", Number(process.versions.node.split(".")[0]) >= 20, process.version);
  add("Platform", true, `${process.platform} (${process.platform === "win32" ? "DPAPI available" : "DPAPI unavailable — use env vars"})`);

  try {
    await import("playwright");
    add("Playwright installed", true, "");
  } catch {
    add("Playwright installed", false, "run `npm install` then `npx playwright install chromium`");
  }

  const profile = await fs.stat(PATHS.profile).then(() => true).catch(() => false);
  add("Browser profile seeded", profile, profile ? PATHS.profile : "run `npm run login`");

  add("BYU NetID", Boolean(process.env.BYU_NETID || (await credentials.read("byu.netid"))), "");
  add("BYU password stored", Boolean(await credentials.read("byu.password")), "");
  add("SUPABASE_URL", Boolean(process.env.SUPABASE_URL), process.env.SUPABASE_URL || "missing");
  add("SUPABASE_ANON_KEY", Boolean(process.env.SUPABASE_ANON_KEY), "");
  add("Supabase password stored", Boolean(process.env.SUPABASE_PASSWORD || (await credentials.read("supabase.password"))), "");

  add("Term", true, `${TERM.label} · ${COURSES.length} courses · ${TERM.timezone}`);

  for (const c of checks) {
    console.log(`${c.ok ? "✓" : "✗"} ${c.name.padEnd(28)} ${c.detail}`);
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(failed.length ? `\n${failed.length} thing(s) still to set up.` : "\nAll set.");
}

/** A tiny status file the scheduled task and the widget can both read. */
async function writeStatus(status) {
  try {
    await fs.mkdir(PATHS.data, { recursive: true });
    await fs.writeFile(
      path.join(PATHS.data, "status.json"),
      JSON.stringify({ ...status, at: new Date().toISOString() }, null, 2),
      "utf8",
    );
  } catch {
    // Status is a convenience; never let it mask the real error.
  }
}

/** Minimal .env loader — one less dependency for three variables. */
async function loadDotEnv() {
  try {
    const raw = await fs.readFile(".env", "utf8");
    for (const line of raw.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const value = m[2].replace(/^["']|["']$/g, "");
      if (value && !process.env[m[1]]) process.env[m[1]] = value;
    }
  } catch {
    // No .env is fine when everything comes from the real environment.
  }
}

function usage() {
  console.log(`term-board — BYU Learning Suite scraper for the Term Board

  npm run login                 sign in once (headed) and store credentials
  npm run scrape                the daily run
  npm run dry-run               scrape without publishing to Supabase
  npm run calibrate             dump Learning Suite markup for fixing selectors
  npm run render                rebuild the board HTML from the last snapshot
  npm run doctor                check the setup

Flags: --headed  --no-push  --no-content  --only=ARAB 201  --from=file  --out=file`);
}
