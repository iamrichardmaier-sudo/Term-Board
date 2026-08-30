/**
 * Publishing to Supabase.
 *
 * The scraper signs in as Richard with the same publishable anon key the web
 * app and the Scriptable widget use. That key is not a secret — row-level
 * security is what protects the rows — so the only real credential here is the
 * account password, which comes from DPAPI on Windows and never from the repo.
 */

import { createClient } from "@supabase/supabase-js";
import { TERM } from "./config.js";
import { log } from "./log.js";
import * as credentials from "./credentials.js";

export async function connect() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  const email = process.env.SUPABASE_EMAIL;
  const password =
    process.env.SUPABASE_PASSWORD || (await credentials.read("supabase.password"));

  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set (see .env.example).");
  if (!email || !password) {
    throw new Error(
      "No Supabase credentials. Run `npm run login` to store them, or set " +
        "SUPABASE_EMAIL and SUPABASE_PASSWORD in the environment.",
    );
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Supabase sign-in failed: ${error.message}`);
  log.step(`signed in to Supabase as ${data.user.email}`);
  return { client, userId: data.user.id };
}

export async function publish({ snapshot, readings }) {
  const { client, userId } = await connect();

  const { error: snapErr } = await client.from("term_board_snapshots").insert({
    user_id: userId,
    term_id: TERM.id,
    scraped_at: snapshot.scrapedAt,
    payload: snapshot,
  });
  if (snapErr) throw new Error(`Snapshot insert failed: ${snapErr.message}`);
  log.step("snapshot published");

  if (readings.length) {
    // Upsert in batches — a term's worth of reading text is far past what a
    // single PostgREST request will accept.
    const BATCH = 25;
    for (let i = 0; i < readings.length; i += BATCH) {
      const rows = readings.slice(i, i + BATCH).map((r) => ({
        user_id: userId,
        term_id: TERM.id,
        assignment_id: r.assignmentId,
        course: r.course,
        title: r.title,
        bodies: r.bodies,
        chars: r.chars,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await client
        .from("term_board_readings")
        .upsert(rows, { onConflict: "user_id,term_id,assignment_id" });
      if (error) throw new Error(`Readings upsert failed: ${error.message}`);
    }
    log.step(`${readings.length} reading record${readings.length === 1 ? "" : "s"} published`);
  }

  await client.auth.signOut();
}

/** Used by `render` to rebuild the Term Board from the last good scrape. */
export async function fetchLatestSnapshot() {
  const { client, userId } = await connect();
  const { data, error } = await client
    .from("term_board_snapshots")
    .select("payload, scraped_at")
    .eq("user_id", userId)
    .eq("term_id", TERM.id)
    .order("scraped_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  await client.auth.signOut();
  if (error) throw new Error(`Snapshot fetch failed: ${error.message}`);
  return data?.payload || null;
}
