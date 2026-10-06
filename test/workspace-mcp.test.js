// test/workspace-mcp.test.js
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_SCRIPT = path.join(REPO, "templates", "user", "bin", "workspace-mcp.mjs");
const PLAYWRIGHT_SOURCE = path.join(REPO, "templates", "project", "zeross", "bin", "playwright-mcp.mjs");
const workspaceMcp = await import(pathToFileURL(WORKSPACE_SCRIPT).href);
const playwright = await import(pathToFileURL(PLAYWRIGHT_SOURCE).href);

const temps = [];
/** A fresh, symlink-resolved temp dir; never under the real ~/.claude. */
function tmp() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "zeross-")));
  temps.push(dir);
  return dir;
}
after(() => temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const ISOLATED_VARS = ["CLAUDE_CONFIG_DIR", "CLAUDE_PROJECT_DIR", "GITHUB_PERSONAL_ACCESS_TOKEN", "JIRA_API_TOKEN", "ZEROSS_PLAYWRIGHT_ISOLATED"];
let savedEnv = {};
beforeEach(() => {
  savedEnv = Object.fromEntries(ISOLATED_VARS.map((k) => [k, process.env[k]]));
  for (const k of ISOLATED_VARS) delete process.env[k];
  process.env.CLAUDE_CONFIG_DIR = tmp();
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("workspace pick: longest root wins", () => {
  const base = tmp();
  const outer = path.join(base, "ws");
  const inner = path.join(outer, "team");
  const registry = [
    { name: "outer", root: outer, github: {} },
    { name: "inner", root: inner, github: {} },
    { name: "jira-only", root: inner, jira: {} },
  ];
  const project = path.join(inner, "repo");
  fs.mkdirSync(project, { recursive: true });
  assert.equal(workspaceMcp.pickWorkspace(registry, "github", project).name, "inner");
  assert.equal(workspaceMcp.pickWorkspace(registry, "jira", project).name, "jira-only");
  assert.equal(workspaceMcp.pickWorkspace(registry, "github", path.join(base, "elsewhere")), null);
  // A sibling sharing the prefix is not inside the root.
  assert.equal(workspaceMcp.pickWorkspace(registry, "github", path.join(base, "ws-other")), null);
});

test("wrapper dry-run reports missing credentials without secrets", async () => {
  const base = tmp();
  const wsRoot = path.join(base, "ws");
  const project = path.join(wsRoot, "repo");
  fs.mkdirSync(project, { recursive: true });
  // A nonexistent keychain service and no .envrc: keychain and direnv lookups find nothing.
  const registryFile = path.join(process.env.CLAUDE_CONFIG_DIR, "zeross", "workspaces.json");
  fs.mkdirSync(path.dirname(registryFile), { recursive: true });
  fs.writeFileSync(
    registryFile,
    JSON.stringify({ workspaces: [{ name: "ws", root: wsRoot, github: { service: "zeross-github-test-nonexistent" } }] }),
    { mode: 0o600 },
  );
  process.env.CLAUDE_PROJECT_DIR = project;

  const out = spawnSync(process.execPath, [WORKSPACE_SCRIPT, "github", "--dry-run"], { encoding: "utf8", env: process.env });
  assert.equal(out.status, 1, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), {
    role: "github",
    workspace: "ws",
    root: wsRoot,
    resolved: [],
    missing: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
  });

  process.env.GITHUB_PERSONAL_ACCESS_TOKEN = "ghp_fake";
  const [env, missing] = workspaceMcp.resolveEnv(workspaceMcp.loadRegistry()[0], "github");
  assert.deepEqual(missing, []);
  assert.equal(env.GITHUB_PERSONAL_ACCESS_TOKEN, "ghp_fake");

  const ok = spawnSync(process.execPath, [WORKSPACE_SCRIPT, "github", "--dry-run"], { encoding: "utf8", env: process.env });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout).resolved, ["GITHUB_PERSONAL_ACCESS_TOKEN"]);
  assert.ok(!(ok.stdout + ok.stderr).includes("ghp_fake"), "the token must never be printed");
});

test("jira resolves literals from the registry and reports the token as missing", () => {
  const root = tmp();
  const ws = { name: "ws", root, jira: { service: "zeross-jira-test-nonexistent", url: "https://acme.atlassian.net", username: "me@acme.com" } };
  const [env, missing] = workspaceMcp.resolveEnv(ws, "jira");
  assert.deepEqual(env, { JIRA_URL: "https://acme.atlassian.net", JIRA_USERNAME: "me@acme.com" });
  assert.deepEqual(missing, ["JIRA_API_TOKEN"]);
});

test("usage and unregistered project", async () => {
  const usage = spawnSync(process.execPath, [WORKSPACE_SCRIPT], { encoding: "utf8", env: process.env });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage: workspace-mcp\.mjs github\|jira/);
  process.env.CLAUDE_PROJECT_DIR = tmp();
  const none = spawnSync(process.execPath, [WORKSPACE_SCRIPT, "jira", "--dry-run"], { encoding: "utf8", env: process.env });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /no jira workspace registered/);
});

/** Copy the committed playwright wrapper into a project and run --dry-run. */
function playwrightDryRun(root, { env = {}, args = [], local } = {}) {
  const dest = path.join(root, ".claude", "zeross", "bin", "playwright-mcp.mjs");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(PLAYWRIGHT_SOURCE, dest);
  if (local !== undefined) fs.writeFileSync(path.join(root, ".claude", "zeross", "local.json"), JSON.stringify(local));
  const out = spawnSync(process.execPath, [dest, "--dry-run", ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout);
}

test("playwright dry-run: persistent profile by default, isolated when forced", () => {
  const root = tmp();
  assert.deepEqual(playwrightDryRun(root), {
    server: "@playwright/mcp@0.0.83",
    mode: "persistent",
    reason: "profile free",
    headless: false,
    outputDir: path.join(root, ".playwright-mcp"),
  });
  const viaEnv = playwrightDryRun(root, { env: { ZEROSS_PLAYWRIGHT_ISOLATED: "1" } });
  assert.equal(viaEnv.mode, "isolated");
  assert.equal(viaEnv.reason, "forced");
  const viaFlag = playwrightDryRun(root, { args: ["--isolated"], local: { playwright: { headless: true } } });
  assert.equal(viaFlag.mode, "isolated");
  assert.equal(viaFlag.reason, "forced");
  assert.equal(viaFlag.headless, true);
});

test("playwright falls back to isolated while the profile lock is live", () => {
  const root = tmp();
  const profile = path.join(root, ".claude", "zeross", "local", "browser-profile");
  fs.mkdirSync(profile, { recursive: true });
  const lock = path.join(profile, "SingletonLock");
  fs.symlinkSync(`${os.hostname()}-${process.pid}`, lock);
  assert.equal(playwright.profileInUse(profile), true);
  const busy = playwrightDryRun(root);
  assert.equal(busy.mode, "isolated");
  assert.equal(busy.reason, "profile in use");

  fs.unlinkSync(lock);
  fs.symlinkSync(`${os.hostname()}-999999999`, lock); // stale: no such pid
  assert.equal(playwright.profileInUse(profile), false);
  fs.unlinkSync(lock);
  fs.symlinkSync("another-host-1", lock);
  assert.equal(playwright.profileInUse(profile), true);
  assert.equal(playwright.profileInUse(path.join(root, "no-profile")), false);
});
