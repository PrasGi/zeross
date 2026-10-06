// lib/doctor.js
// @ts-check
/**
 * Device, environment and tooling checks. Answers: can this machine run code
 * understanding, unit tests and Playwright validation in parallel, and how
 * many agents of each kind at most? Is the session inside Orca or plain
 * Claude Code? Which tools are present?
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { exists, findProjectRoot, findWorkspaceRoot } from "./paths.js";

export const TOOLS = [
  "git", "node", "npx", "pnpm", "yarn", "bun", "uv", "uvx", "direnv",
  "claude", "orca", "github-mcp-server", "docker", "security", "secret-tool", "graphify", "gitleaks", "semgrep",
];
const ORCA_ENV_VARS = ["ORCA_TERMINAL_HANDLE", "ORCA_WORKSPACE_ID"];
const GiB = 2 ** 30;

/**
 * Run a command, returning trimmed stdout on success or null.
 * @param {string} cmd @param {string[]} args @param {number} [timeout]
 */
export function run(cmd, args, timeout = 5000) {
  const out = spawnSync(cmd, args, { encoding: "utf8", timeout });
  return out.status === 0 ? out.stdout.trim() : null;
}

/** @param {string} name */
export function which(name) {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // not here
    }
  }
  return null;
}

/** (total, available) RAM in GiB, best effort. */
export function memoryGb() {
  const total = os.totalmem() / GiB;
  if (process.platform === "darwin") {
    // os.freemem() on macOS excludes reclaimable pages; vm_stat is closer to reality.
    const vm = run("vm_stat", []) ?? "";
    const pageSize = Number(/page size of (\d+) bytes/.exec(vm)?.[1] ?? 4096);
    let pages = 0;
    for (const key of ["Pages free", "Pages inactive", "Pages speculative", "Pages purgeable"]) {
      pages += Number(new RegExp(`${key}:\\s+(\\d+)`).exec(vm)?.[1] ?? 0);
    }
    return { total, available: vm ? (pages * pageSize) / GiB : os.freemem() / GiB };
  }
  return { total, available: os.freemem() / GiB };
}

/**
 * Max concurrent agents per work type. Conservative on purpose: each
 * Playwright agent drives its own Chromium and each unit-test agent its own
 * runner process, so they are capped harder than read-only agents.
 * @param {number | null} memTotalGb
 * @param {number | null} cpus
 */
export function recommendCapacity(memTotalGb, cpus) {
  const mem = memTotalGb ?? 0;
  const cores = cpus ?? 1;
  /** @type {[string, [number, number, number]]} */
  const [tier, rec] =
    mem >= 30 && cores >= 10 ? ["high", [4, 3, 3]]
      : mem >= 15 ? ["medium", [3, 2, 2]]
        : mem >= 7 ? ["low", [2, 1, 1]]
          : ["minimal", [1, 1, 1]];
  return { tier, understanding: rec[0], unitTest: rec[1], playwright: rec[2], multiAgentSupported: rec[0] > 1 };
}

export function playwrightChromiumInstalled() {
  const custom = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const roots = custom
    ? [custom]
    : [path.join(os.homedir(), "Library", "Caches", "ms-playwright"), path.join(os.homedir(), ".cache", "ms-playwright")];
  return roots.some((root) => {
    try {
      return fs.readdirSync(root).some((n) => n.startsWith("chromium-"));
    } catch {
      return false;
    }
  });
}

export function detectSession() {
  const orca = ORCA_ENV_VARS.some((v) => Boolean(process.env[v]));
  return {
    host: orca ? "orca" : "claude-code",
    orca,
    insideClaudeCode: Boolean(process.env.CLAUDECODE),
    recommendedExecutor: "auto",
  };
}

const round1 = (/** @type {number} */ n) => Math.round(n * 10) / 10;

/** @param {string} [start] */
export function runDoctor(start) {
  const cpus = os.cpus().length || null;
  const { total, available } = memoryGb();
  const project = findProjectRoot(start);
  const workspace = findWorkspaceRoot(project);
  /** @type {Record<string, boolean>} */
  const tools = Object.fromEntries(TOOLS.map((t) => [t, which(t) !== null]));
  const [major] = process.versions.node.split(".").map(Number);
  const warnings = [];
  if (available < 1.5) warnings.push(`Only ${available.toFixed(1)} GiB RAM available now; close apps before parallel work.`);
  if (!tools.direnv) warnings.push("direnv not installed: .envrc token auto-load unavailable (keychain fallback still works).");
  if (major < 22) warnings.push(`Node ${process.versions.node} is below the supported minimum (22).`);
  return {
    device: { os: process.platform, arch: process.arch, cpus, memTotalGb: round1(total), memAvailableGb: round1(available) },
    capacity: recommendCapacity(total, cpus),
    session: detectSession(),
    node: process.versions.node,
    tools,
    claudeVersion: tools.claude ? run("claude", ["--version"]) : null,
    playwrightChromium: playwrightChromiumInstalled(),
    project: { root: project, isGitRepo: exists(path.join(project, ".git")), workspaceRoot: workspace },
    warnings,
  };
}
