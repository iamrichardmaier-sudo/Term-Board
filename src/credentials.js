/**
 * Credential storage.
 *
 * On Windows this shells out to PowerShell's DPAPI wrappers
 * (ConvertFrom-SecureString / ConvertTo-SecureString), which encrypt under the
 * logged-in Windows account. The ciphertext on disk is useless to any other
 * user on the machine and useless if the file is copied elsewhere.
 *
 * Elsewhere it falls back to environment variables only — this deliberately
 * refuses to write a plaintext secret to disk on a platform where it cannot
 * encrypt one.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { PATHS } from "./config.js";
import { log } from "./log.js";

const run = promisify(execFile);
const isWindows = process.platform === "win32";

function file(name) {
  return path.join(PATHS.credentials, `${name}.dpapi`);
}

async function powershell(script) {
  const { stdout } = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  return stdout.trim();
}

/** Encrypt `value` under the current Windows user and store it as `name`. */
export async function store(name, value) {
  if (!isWindows) {
    throw new Error(
      `Cannot store secrets on ${process.platform}. Set it in the environment instead.`,
    );
  }
  await fs.mkdir(PATHS.credentials, { recursive: true });
  // The value is passed through an environment variable rather than the command
  // line so it never appears in the process table or a shell history.
  const { stdout } = await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "ConvertTo-SecureString -String $env:TB_SECRET -AsPlainText -Force | ConvertFrom-SecureString",
    ],
    { windowsHide: true, env: { ...process.env, TB_SECRET: value } },
  );
  await fs.writeFile(file(name), stdout.trim(), { mode: 0o600 });
  log.step(`stored ${name} (DPAPI, current Windows user only)`);
}

/** Read a stored secret, or null if it was never stored. */
export async function read(name) {
  const fromEnv = process.env[name.toUpperCase().replace(/[^A-Z0-9]/g, "_")];
  if (fromEnv) return fromEnv;
  if (!isWindows) return null;

  let cipher;
  try {
    cipher = (await fs.readFile(file(name), "utf8")).trim();
  } catch {
    return null;
  }
  try {
    return await powershell(
      "$s = ConvertTo-SecureString -String $env:TB_CIPHER; " +
        "[Runtime.InteropServices.Marshal]::PtrToStringAuto(" +
        "[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))",
    ).then((v) => v || null);
  } catch (err) {
    log.warn(`could not decrypt ${name}: ${err.message}`);
    return null;
  }
}

/** Prompt on the terminal without echoing. Used only during `login`. */
export async function prompt(question, { secret = false } = {}) {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  if (!secret) {
    const answer = await rl.question(`${question}: `);
    rl.close();
    return answer.trim();
  }
  // Suppress echo by swallowing the write while the answer is typed.
  const onData = (chunk) => {
    const s = chunk.toString();
    if (s !== "\r" && s !== "\n" && s !== "\r\n") return;
  };
  rl.output.write(`${question}: `);
  const original = rl.output.write.bind(rl.output);
  rl.output.write = onData;
  const answer = await rl.question("");
  rl.output.write = original;
  rl.output.write("\n");
  rl.close();
  return answer.trim();
}
