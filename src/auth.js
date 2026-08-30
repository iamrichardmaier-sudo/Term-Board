/**
 * BYU CAS + Duo login, built around a persistent browser profile.
 *
 * The daily run must not need a human. That works because Duo's "remember this
 * device for 30 days" writes a cookie into the profile directory, and CAS keeps
 * its own session cookie there too. `npm run login` opens a real window once so
 * that cookie can be earned; every scheduled run after that reuses it headless.
 *
 * When the cookie expires the scheduled run cannot silently recover — approving
 * a push needs a phone. So it fails loudly with NEEDS_REAUTH rather than hanging
 * on a challenge nobody is watching.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { LEARNING_SUITE, PATHS } from "./config.js";
import { log } from "./log.js";
import * as credentials from "./credentials.js";

export class NeedsReauth extends Error {
  constructor(message) {
    super(message);
    this.name = "NeedsReauth";
    this.code = "NEEDS_REAUTH";
  }
}

const SELECTORS = {
  netid: '#username, input[name="username"], input[name="netid"]',
  password: '#password, input[name="password"]',
  submit: 'button[type="submit"], input[type="submit"], button:has-text("Sign In")',
  duoFrame: 'iframe#duo_iframe, iframe[title*="Duo" i], iframe[src*="duosecurity"]',
  duoRemember: 'input[type="checkbox"]#trust-browser, label:has-text("Remember me"), button:has-text("Yes, this is my device")',
  duoPush: 'button:has-text("Send Me a Push"), button:has-text("Push")',
  loggedIn: 'a[href*="/student/"], #courseList, .course-list, nav',
};

/** True when the current URL is anywhere in BYU's identity provider. */
function isLoginUrl(url) {
  return /cas\.byu\.edu|api\.byu\.edu\/.*oauth|duosecurity\.com|login\.byu\.edu/i.test(url);
}

export async function launch({ headless = true } = {}) {
  await fs.mkdir(PATHS.profile, { recursive: true });
  const context = await chromium.launchPersistentContext(path.resolve(PATHS.profile), {
    headless,
    viewport: { width: 1400, height: 1000 },
    // Playwright's stock Chromium is fine here; the executable path is only set
    // when the environment pre-installs one (as CI images do).
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {}),
  });
  context.setDefaultTimeout(45_000);
  return context;
}

/**
 * Bring `page` to a signed-in Learning Suite session.
 *
 * @param {import('playwright').Page} page
 * @param {{interactive?: boolean}} options interactive allows waiting on a Duo push.
 */
export async function ensureLoggedIn(page, { interactive = false } = {}) {
  await page.goto(LEARNING_SUITE.origin + LEARNING_SUITE.paths.home, {
    waitUntil: "domcontentloaded",
  });

  if (!isLoginUrl(page.url())) {
    log.step("already signed in (profile session reused)");
    return;
  }

  log.step("session expired — signing in to CAS");

  const netid = process.env.BYU_NETID || (await credentials.read("byu.netid"));
  const password = await credentials.read("byu.password");

  if (!netid || !password) {
    throw new NeedsReauth(
      "No stored BYU credentials. Run `npm run login` once to sign in and store them.",
    );
  }

  const netidField = page.locator(SELECTORS.netid).first();
  if (await netidField.count()) {
    await netidField.fill(netid);
    await page.locator(SELECTORS.password).first().fill(password);
    await page.locator(SELECTORS.submit).first().click();
    await page.waitForLoadState("domcontentloaded");
  }

  await handleDuo(page, { interactive });

  await page.waitForURL((url) => !isLoginUrl(url.toString()), { timeout: 120_000 });
  log.step("signed in");
}

async function handleDuo(page, { interactive }) {
  // Duo shows up either as an embedded iframe (older prompt) or as a full
  // redirect to duosecurity.com (universal prompt). Handle both.
  const frameHandle = await page.locator(SELECTORS.duoFrame).first();
  const inIframe = (await frameHandle.count()) > 0;
  const onDuoPage = /duosecurity\.com/i.test(page.url());

  if (!inIframe && !onDuoPage) return;

  if (!interactive) {
    throw new NeedsReauth(
      "Duo is asking for approval, but this run is unattended. The 30-day " +
        "trusted-device cookie has expired. Run `npm run login` on the Lenovo to renew it.",
    );
  }

  const scope = inIframe ? page.frameLocator(SELECTORS.duoFrame).first() : page;

  const push = scope.locator(SELECTORS.duoPush).first();
  if (await push.count().catch(() => 0)) {
    log.info("sending Duo push — approve it on your phone");
    await push.click().catch(() => {});
  } else {
    log.info("waiting for Duo — approve the prompt on your phone");
  }

  // Tick "remember this device" wherever Duo offers it; this is the whole
  // reason the scheduled runs can stay unattended for the next 30 days.
  for (const sel of SELECTORS.duoRemember.split(", ")) {
    const el = scope.locator(sel).first();
    if (await el.count().catch(() => 0)) {
      await el.click({ timeout: 5_000 }).catch(() => {});
      log.step("marked this device as remembered");
      break;
    }
  }

  await page
    .waitForURL((url) => !isLoginUrl(url.toString()), { timeout: 180_000 })
    .catch(() => {
      throw new NeedsReauth("Duo approval timed out after three minutes.");
    });
}

/** `npm run login` — a one-off headed sign-in that seeds the profile. */
export async function interactiveLogin() {
  const netid =
    process.env.BYU_NETID || (await credentials.prompt("BYU NetID"));
  const password = await credentials.prompt("BYU password", { secret: true });

  if (process.platform === "win32") {
    await credentials.store("byu.netid", netid);
    await credentials.store("byu.password", password);
  } else {
    log.warn(
      `Not on Windows — credentials were not written to disk. ` +
        `The browser profile will still hold the session.`,
    );
    process.env.BYU_NETID = netid;
  }

  const context = await launch({ headless: false });
  const page = context.pages()[0] || (await context.newPage());
  try {
    process.env.BYU_NETID = netid;
    await ensureLoggedIn(page, { interactive: true });
    log.info("✓ signed in. The profile now holds the Duo trusted-device cookie.");
    log.info("  Scheduled runs will be unattended until it expires (~30 days).");
  } finally {
    await context.close();
  }
}
