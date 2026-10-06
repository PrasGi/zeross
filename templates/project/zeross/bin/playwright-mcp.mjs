#!/usr/bin/env node
// .claude/zeross/bin/playwright-mcp.mjs
// @ts-check
/*
 * zeross Playwright MCP wrapper (committed).
 *
 * Starts the pinned @playwright/mcp with Chromium. The first session gets the
 * persistent profile in .claude/zeross/local/browser-profile so logins survive
 * between sessions. A persistent profile serves one browser at a time, so when
 * it is already in use (e.g. a parallel Orca worker) this instance falls back to
 * --isolated automatically.
 *
 * Personal options in .claude/zeross/local.json → playwright:
 *     "headless": true|false   (default false: you can watch the browser)
 * Environment:
 *     ZEROSS_PLAYWRIGHT_ISOLATED=1   force an isolated in-memory profile
 *
 *     --dry-run   print the decision as JSON and exit
 *
 * Node >= 22, `node:` builtins only.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The script lives at <root>/.claude/zeross/bin/.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ZEROSS = path.join(ROOT, ".claude", "zeross");
const DEFAULT_PIN = "@playwright/mcp@0.0.83";

/**
 * @param {unknown} value
 * @returns {Record<string, any>}
 */
const asObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? /** @type {any} */ (value) : {});

/**
 * @param {string} file
 * @returns {Record<string, any>}
 */
function readJson(file) {
  try {
    return asObject(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return {};
  }
}

/**
 * Whether another live Chromium holds the profile. Chromium's SingletonLock is a
 * symlink to '<hostname>-<pid>'; a lock from another host counts as in use.
 * @param {string} profile
 * @returns {boolean}
 */
export function profileInUse(profile) {
  let target;
  try {
    target = fs.readlinkSync(path.join(profile, "SingletonLock"));
  } catch {
    return false;
  }
  const dash = target.lastIndexOf("-");
  const host = dash === -1 ? "" : target.slice(0, dash);
  const pid = target.slice(dash + 1);
  if (host && host !== os.hostname()) return true;
  if (!/^\s*[+-]?\d+\s*$/.test(pid)) return false;
  try {
    process.kill(Number(pid), 0);
  } catch (err) {
    // ESRCH: stale lock. EPERM: alive but owned by someone else.
    return /** @type {NodeJS.ErrnoException} */ (err).code === "EPERM";
  }
  return true;
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const config = readJson(path.join(ZEROSS, "config.json"));
  const local = asObject(readJson(path.join(ZEROSS, "local.json")).playwright);
  const pins = asObject(asObject(config.mcp).pins);
  const pin = Object.hasOwn(pins, "playwright") ? pins.playwright : DEFAULT_PIN;
  const profile = path.join(ZEROSS, "local", "browser-profile");
  const output = path.join(ROOT, ".playwright-mcp");

  const forced = process.env.ZEROSS_PLAYWRIGHT_ISOLATED === "1" || argv.includes("--isolated");
  const isolated = forced || profileInUse(profile);
  const headless = Boolean(local.headless);
  const args = ["--browser", "chromium", "--output-dir", output];
  args.push(...(isolated ? ["--isolated"] : ["--user-data-dir", profile]));
  if (headless) args.push("--headless");

  if (argv.includes("--dry-run")) {
    const reason = forced ? "forced" : isolated ? "profile in use" : "profile free";
    process.stdout.write(
      JSON.stringify({ server: pin, mode: isolated ? "isolated" : "persistent", reason, headless, outputDir: output }) + "\n",
    );
    return 0;
  }
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(output, { recursive: true });
  return runChild("npx", ["-y", String(pin), ...args]);
}

/**
 * Run a child with inherited stdio, forwarding termination signals; resolves to its exit code.
 * Node has no exec(), so this process stays as a thin parent.
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<number>}
 */
function runChild(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    /** @type {NodeJS.Signals[]} */
    const signals = ["SIGTERM", "SIGINT", "SIGHUP"];
    const handlers = signals.map((sig) => {
      const handler = () => {
        child.kill(sig);
      };
      process.on(sig, handler);
      return handler;
    });
    let done = false;
    /** @param {number} code */
    const finish = (code) => {
      if (done) return;
      done = true;
      signals.forEach((sig, i) => process.off(sig, handlers[i]));
      resolve(code);
    };
    child.once("error", (err) => {
      process.stderr.write(`playwright-mcp: cannot start ${cmd}: ${err.message}\n`);
      finish(1);
    });
    child.once("close", (code, signal) => finish(code ?? 128 + (signal ? os.constants.signals[signal] : 0)));
  });
}

function isMain() {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`playwright-mcp: ${err?.stack ?? err}\n`);
      process.exitCode = 1;
    },
  );
}
