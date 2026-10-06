#!/usr/bin/env node
// ~/.claude/zeross/bin/workspace-mcp.mjs
// @ts-check
/*
 * zeross wrapper for workspace-scoped MCP servers (GitHub, Jira).
 *
 * Usage (registered by `zeross mcp add`):
 *     node ~/.claude/zeross/bin/workspace-mcp.mjs github
 *     node ~/.claude/zeross/bin/workspace-mcp.mjs jira
 *     node ~/.claude/zeross/bin/workspace-mcp.mjs github --dry-run
 *
 * It picks the workspace from ~/.claude/zeross/workspaces.json whose root
 * contains the project Claude Code was started in (longest match wins), so one
 * user-scope registration serves every project in that workspace and a token
 * never crosses workspaces. Credentials resolve in this order:
 *     1. already in the environment (e.g. exported by direnv)
 *     2. OS keychain item named in the registry
 *     3. `direnv export json` in the workspace root
 * Secrets are passed to the server through the environment, never argv, and are
 * never printed.
 *
 * Node >= 22, `node:` builtins only.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_GITHUB_TOOLSETS = "default";
const DEFAULT_ATLASSIAN_PIN = "mcp-atlassian==0.23.1";
const GITHUB_DOCKER_IMAGE = "ghcr.io/github/github-mcp-server";

/** @typedef {{ name?: string, root?: string, github?: Record<string, any>, jira?: Record<string, any>, [key: string]: any }} Workspace */

/** A fatal, user-facing error: message printed to stderr, exit 1. */
export class ExitError extends Error {}

/** @param {string} p */
function expandUser(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Absolute path with symlinks resolved as far as the path exists (like Python's Path.resolve()).
 * @param {string} p
 */
function resolvePath(p) {
  let head = path.resolve(p);
  const tail = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(head), ...tail);
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return path.resolve(p);
      tail.unshift(path.basename(head));
      head = parent;
    }
  }
}

/**
 * First executable named `cmd` on PATH, or null.
 * @param {string} cmd
 */
function which(cmd) {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, cmd);
    try {
      if (fs.statSync(candidate).isFile()) {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      }
    } catch {
      // not here
    }
  }
  return null;
}

function claudeHome() {
  const custom = process.env.CLAUDE_CONFIG_DIR;
  return custom ? expandUser(custom) : path.join(os.homedir(), ".claude");
}

function registryPath() {
  return path.join(claudeHome(), "zeross", "workspaces.json");
}

/**
 * Registered workspaces; [] when the registry is missing or unreadable.
 * @param {string} [file]
 * @returns {Workspace[]}
 */
export function loadRegistry(file) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file || registryPath(), "utf8"));
  } catch {
    return [];
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  return Array.isArray(data.workspaces) ? data.workspaces : [];
}

function projectDir() {
  return resolvePath(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

/**
 * The workspace serving `role` whose root contains `project`; the longest root wins.
 * `project` must already be absolute and resolved.
 * @param {Workspace[]} registry
 * @param {string} role
 * @param {string} project
 * @returns {Workspace | null}
 */
export function pickWorkspace(registry, role, project) {
  /** @type {Workspace | null} */
  let best = null;
  let bestLen = -1;
  for (const ws of registry) {
    if (!ws || typeof ws !== "object" || !(role in ws)) continue;
    // An entry without a real absolute root would resolve to the cwd and match anything.
    if (typeof ws.root !== "string" || !ws.root.trim() || !path.isAbsolute(expandUser(ws.root))) continue;
    const root = resolvePath(expandUser(ws.root));
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    if ((project === root || project.startsWith(prefix)) && root.length > bestLen) {
      best = ws;
      bestLen = root.length;
    }
  }
  return best;
}

/**
 * Read a secret from the OS keychain (macOS `security`, Linux `secret-tool`); null when absent.
 * @param {string} service
 * @returns {string | null}
 */
export function keychainGet(service) {
  const account = process.env.USER || "";
  /** @type {string[]} */
  let cmd;
  if (process.platform === "darwin" && which("security")) {
    cmd = ["security", "find-generic-password", "-a", account, "-s", service, "-w"];
  } else if (which("secret-tool")) {
    cmd = ["secret-tool", "lookup", "service", service, "account", account];
  } else {
    return null;
  }
  const result = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const value = (result.stdout || "").trim();
  return !result.error && result.status === 0 && value ? value : null;
}

/**
 * String vars from `direnv export json` in `root`; {} without direnv or an .envrc.
 * @param {string} root
 * @returns {Record<string, string>}
 */
export function direnvEnv(root) {
  if (!which("direnv") || !fs.existsSync(path.join(root, ".envrc"))) return {};
  const result = spawnSync("direnv", ["export", "json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  let data;
  try {
    data = JSON.parse(result.stdout || "{}");
  } catch {
    return {};
  }
  if (!data || typeof data !== "object") return {};
  return Object.fromEntries(Object.entries(data).filter(([, v]) => typeof v === "string"));
}

/**
 * Env vars for the server and the names still missing. Never logs values.
 * @param {Workspace} ws
 * @param {string} role  "github" | "jira"
 * @returns {[env: Record<string, string>, missing: string[]]}
 */
export function resolveEnv(ws, role) {
  const root = expandUser(String(ws.root ?? ""));
  const spec = ws[role] || {};
  /** @type {Record<string, string | undefined>} */
  let wanted;
  /** @type {Record<string, string>} */
  let literals;
  if (role === "github") {
    wanted = { GITHUB_PERSONAL_ACCESS_TOKEN: spec.service };
    literals = {};
  } else {
    wanted = { JIRA_API_TOKEN: spec.service };
    literals = { JIRA_URL: spec.url ?? "", JIRA_USERNAME: spec.username ?? "" };
  }
  /** @type {Record<string, string>} */
  const env = Object.fromEntries(Object.entries(literals).filter(([, v]) => v));
  /** @type {Record<string, string> | null} */
  let fromDirenv = null;
  for (const [name, service] of Object.entries(wanted)) {
    let value = process.env[name] || (service ? keychainGet(service) : null);
    if (!value) {
      fromDirenv ??= direnvEnv(root);
      value = fromDirenv[name];
    }
    if (value) env[name] = value;
  }
  for (const name of Object.keys(literals)) {
    if (!(name in env)) {
      fromDirenv ??= direnvEnv(root);
      if (fromDirenv[name]) env[name] = fromDirenv[name];
    }
  }
  const missing = [...Object.keys(wanted), ...Object.keys(literals)].filter((name) => !env[name]);
  return [env, missing];
}

/**
 * argv for the MCP server of `role`.
 * @param {Workspace} ws
 * @param {string} role
 * @returns {string[]}
 */
export function serverCommand(ws, role) {
  const spec = ws[role] || {};
  if (role === "github") {
    const toolsets = spec.toolsets ?? DEFAULT_GITHUB_TOOLSETS;
    if (which("github-mcp-server")) return ["github-mcp-server", "stdio", `--toolsets=${toolsets}`];
    if (which("docker")) {
      return ["docker", "run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "-e", `GITHUB_TOOLSETS=${toolsets}`, GITHUB_DOCKER_IMAGE];
    }
    throw new ExitError(
      "workspace-mcp: github-mcp-server not found. Install it: `brew install github-mcp-server` (or install Docker).",
    );
  }
  // mcp-atlassian is a Python MCP server; uvx runs it from its pinned release.
  const pin = spec.pin ?? DEFAULT_ATLASSIAN_PIN;
  if (!which("uvx")) throw new ExitError("workspace-mcp: uvx not found. Install uv: https://docs.astral.sh/uv/");
  return ["uvx", pin];
}

/**
 * Run a child with inherited stdio, forwarding termination signals; resolves to its exit code.
 * Node has no exec(), so this process stays as a thin parent.
 * @param {string[]} cmd
 * @param {import("node:child_process").SpawnOptions} options
 * @returns {Promise<number>}
 */
function runChild(cmd, options) {
  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), { ...options, stdio: "inherit" });
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
      process.stderr.write(`workspace-mcp: cannot start ${cmd[0]}: ${err.message}\n`);
      finish(1);
    });
    child.once("close", (code, signal) => finish(code ?? 128 + (signal ? os.constants.signals[signal] : 0)));
  });
}

/**
 * @param {string[]} argv  `github|jira [--dry-run]`
 * @returns {Promise<number>}
 */
export async function main(argv) {
  if (!argv.length || (argv[0] !== "github" && argv[0] !== "jira")) {
    process.stderr.write("usage: workspace-mcp.mjs github|jira [--dry-run]\n");
    return 2;
  }
  const role = argv[0];
  const dryRun = argv.includes("--dry-run");
  const project = projectDir();
  const ws = pickWorkspace(loadRegistry(), role, project);
  if (!ws) {
    process.stderr.write(
      `workspace-mcp: no ${role} workspace registered for ${project}. Run /zeross or \`zeross mcp add ${role}\`.\n`,
    );
    return 1;
  }
  const [env, missing] = resolveEnv(ws, role);
  if (dryRun) {
    process.stdout.write(
      JSON.stringify({ role, workspace: ws.name ?? null, root: ws.root ?? null, resolved: Object.keys(env).sort(), missing }) +
        "\n",
    );
    return missing.length ? 1 : 0;
  }
  if (missing.length) {
    process.stderr.write(`workspace-mcp: ${role} credentials missing for workspace ${ws.name}: ${missing.join(", ")}\n`);
    return 1;
  }
  const cmd = serverCommand(ws, role);
  // Neutral cwd: no project .env leaks into the server.
  return runChild(cmd, { cwd: os.homedir(), env: { ...process.env, ...env } });
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
      process.stderr.write(err instanceof ExitError ? `${err.message}\n` : `workspace-mcp: ${err?.stack ?? err}\n`);
      process.exitCode = 1;
    },
  );
}
