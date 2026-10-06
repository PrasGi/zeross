#!/usr/bin/env node
// ~/.claude/zeross/bin/context7-mcp.mjs
// @ts-check
/*
 * zeross wrapper for the Context7 MCP server (up-to-date library docs).
 *
 * Registered once at user scope by `zeross mcp add context7`. The API key is
 * optional (higher rate limits). It is never written to ~/.claude.json: it is
 * read from the environment or the OS keychain item `zeross-context7` and
 * handed to the server through the environment, never argv.
 *
 *   --dry-run   print {server, apiKey: "present"|"absent"} and exit
 *
 * Node >= 22, `node:` builtins only.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_PIN = "@upstash/context7-mcp@4.1.1";
export const KEYCHAIN_SERVICE = "zeross-context7";

/** @param {string} name */
function which(name) {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    try {
      fs.accessSync(path.join(dir, name), fs.constants.X_OK);
      return true;
    } catch {
      // keep looking
    }
  }
  return false;
}

/** API key from env, then keychain; null when absent. */
export function resolveKey() {
  if (process.env.CONTEXT7_API_KEY) return process.env.CONTEXT7_API_KEY;
  const account = process.env.USER || os.userInfo().username;
  /** @type {[string, string[]] | null} */
  const cmd = process.platform === "darwin" && which("security")
    ? ["security", ["find-generic-password", "-a", account, "-s", KEYCHAIN_SERVICE, "-w"]]
    : which("secret-tool") ? ["secret-tool", ["lookup", "service", KEYCHAIN_SERVICE, "account", account]] : null;
  if (!cmd) return null;
  const out = spawnSync(cmd[0], cmd[1], { encoding: "utf8" });
  const value = (out.stdout || "").trim();
  return out.status === 0 && value ? value : null;
}

/** @param {string[]} argv @returns {Promise<number>} */
export async function main(argv) {
  const pin = process.env.ZEROSS_CONTEXT7_PIN || DEFAULT_PIN;
  const key = resolveKey();
  if (argv.includes("--dry-run")) {
    process.stdout.write(`${JSON.stringify({ server: pin, apiKey: key ? "present" : "absent" })}\n`);
    return 0;
  }
  const env = { ...process.env };
  if (key) env.CONTEXT7_API_KEY = key;
  const child = spawn("npx", ["-y", pin], { stdio: "inherit", env, cwd: os.homedir() });
  for (const sig of /** @type {NodeJS.Signals[]} */ (["SIGTERM", "SIGINT", "SIGHUP"])) {
    process.on(sig, () => child.kill(sig));
  }
  return new Promise((resolve) => {
    child.on("error", (err) => {
      process.stderr.write(`context7-mcp: cannot start npx: ${err.message}\n`);
      resolve(1);
    });
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 128 + (os.constants.signals[signal] ?? 0) : 1)));
  });
}

function isMain() {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMain()) process.exitCode = await main(process.argv.slice(2));
