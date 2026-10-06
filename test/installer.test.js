// test/installer.test.js
// @ts-check
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { main } from "../lib/cli.js";
import { applyPlan, installGlobal, projectStatus, refreshStaleGlobal, uninstallProject } from "../lib/installer.js";
import * as update from "../lib/update.js";
import { isolateClaudeHome, makeProject, readJsonFile, tempDir } from "./_core-helpers.js";

const home = isolateClaudeHome();

const PLAN = {
  components: ["zero-fix-bug", "zero-ui-review", "zero-security-review"],
  config: {
    project: { name: "proj", monorepo: false, apps: [] },
    rules: { packs: ["fe-core", "fe-react-next"], commentPolicy: "exported" },
    ui: { designSystem: { exists: true, paths: ["src/components/ui"] } },
    pr: { defaultReviewers: ["PrasGi"] },
  },
  customRules: ["Never use `any`."],
  uiRules: ["Every new component gets a Storybook story."],
  mcp: { db: true, playwright: true },
};

/** @param {string} root @param {{ dryRun?: boolean }} [opts] */
const apply = (root, opts) => applyPlan(root, structuredClone(PLAN), opts);
/** @param {string} root @param {...string} parts */
const at = (root, ...parts) => path.join(root, ...parts);
/** @param {string} file */
const read = (file) => fs.readFileSync(file, "utf8");

/** Run the CLI while swallowing its stdout. @param {string[]} argv */
async function cli(argv) {
  const write = process.stdout.write;
  process.stdout.write = () => true;
  try {
    return await main(argv);
  } finally {
    process.stdout.write = write;
  }
}

test("a dry run writes nothing", () => {
  const root = makeProject();
  const result = apply(root, { dryRun: true });
  assert.ok(result.counts.create > 10);
  assert.ok(!fs.existsSync(at(root, ".claude")));
  assert.ok(!fs.existsSync(at(root, "CLAUDE.md")));
});

test("apply installs everything and a second apply changes nothing", () => {
  const root = makeProject();
  apply(root);
  const z = at(root, ".claude", "zeross");
  const rules = at(root, ".claude", "rules", "zeross");
  assert.ok(fs.existsSync(at(root, ".claude", "skills", "zero-fix-bug", "SKILL.md")));
  assert.ok(fs.existsSync(at(rules, "fe-react-next.md")));
  assert.ok(fs.existsSync(at(rules, "zeross.md")));
  assert.ok(fs.statSync(at(z, "bin", "zeross-guard.mjs")).mode & 0o111);
  const ui = read(at(rules, "ui.md"));
  assert.ok(ui.includes("`src/components/ui`") && ui.includes("Storybook story"));
  assert.ok(!ui.split("-->")[1].includes("{{"));
  assert.ok(read(at(rules, "custom.md")).includes("- Never use `any`."));
  const config = readJsonFile(at(z, "config.json"));
  assert.deepEqual(config.pr.defaultReviewers, ["PrasGi"]);
  assert.deepEqual(config.rules.packs.slice(0, 2), ["core", "testing"]);
  assert.ok(config.mcp.pins.playwright.startsWith("@playwright/mcp@"));
  assert.ok(!fs.existsSync(at(root, "CLAUDE.md")), "zeross never writes CLAUDE.md");
  assert.ok(!read(at(rules, "fe-core.md")).startsWith("---"), "single app: packs are not path-scoped");
  assert.ok(JSON.stringify(readJsonFile(at(root, ".claude", "settings.json"))).includes("zeross-guard.mjs"));
  const mcp = readJsonFile(at(root, ".mcp.json"));
  assert.deepEqual(Object.keys(mcp.mcpServers).sort(), ["db", "playwright"]);
  assert.equal(mcp.mcpServers.db.command, "node");
  assert.ok(read(at(root, ".gitignore")).includes(".claude/zeross/local.json"));
  assert.ok(read(at(root, ".gitignore")).includes(".envrc"));
  assert.equal(config.hooks.guard, true);

  const second = apply(root);
  assert.ok(Object.keys(second.counts).every((a) => ["unchanged", "keep"].includes(a)), JSON.stringify(second.counts));
});

test("existing user files are preserved", () => {
  const root = makeProject();
  fs.writeFileSync(at(root, "CLAUDE.md"), "# Team notes\n");
  fs.mkdirSync(at(root, ".claude"));
  fs.writeFileSync(at(root, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Bash(ls)"] } }));
  fs.writeFileSync(at(root, ".mcp.json"), JSON.stringify({ mcpServers: { db: { command: "own-db" } } }));
  const foreign = at(root, ".claude", "skills", "zero-fix-bug", "SKILL.md");
  fs.mkdirSync(path.dirname(foreign), { recursive: true });
  fs.writeFileSync(foreign, "someone else's skill");

  const result = apply(root);

  assert.equal(read(foreign), "someone else's skill");
  assert.ok(result.conflicts.some((c) => c.path.endsWith("zero-fix-bug/SKILL.md")));
  assert.equal(read(at(root, "CLAUDE.md")), "# Team notes\n");
  const settings = readJsonFile(at(root, ".claude", "settings.json"));
  assert.deepEqual(settings.permissions.allow, ["Bash(ls)"]);
  assert.ok(settings.hooks);
  const mcp = readJsonFile(at(root, ".mcp.json"));
  assert.deepEqual(mcp.mcpServers.db, { command: "own-db" });
  assert.ok("playwright" in mcp.mcpServers);
});

test("a team edit survives re-apply with a sidecar", () => {
  const root = makeProject();
  apply(root);
  const core = at(root, ".claude", "zeross", "workflow", "core.md");
  fs.writeFileSync(core, "team customised");
  const result = apply(root);
  assert.equal(read(core), "team customised");
  assert.ok(result.modified.some((m) => m.path.endsWith("workflow/core.md")));
});

test("an unknown component is rejected", () => {
  assert.throws(() => applyPlan(makeProject(), { components: ["zero-nope"], config: {} }), /unknown components/);
});

test("status reports join mode for a teammate without personal setup", () => {
  const root = makeProject();
  assert.equal(projectStatus(root).state, "fresh");
  apply(root);
  const status = projectStatus(root);
  assert.equal(status.state, "installed");
  assert.equal(status.joinMode, true);
  assert.ok(status.components.includes("zero-fix-bug"));
});

test("uninstall removes only unmodified files and keeps team data", () => {
  const root = makeProject();
  fs.writeFileSync(at(root, "CLAUDE.md"), "# Team notes\n");
  apply(root);
  const kept = at(root, ".claude", "zeross", "workflow", "core.md");
  fs.writeFileSync(kept, "team customised");
  const result = uninstallProject(root);
  assert.ok(result.kept.includes(".claude/zeross/workflow/core.md"));
  assert.ok(fs.existsSync(kept));
  assert.ok(!fs.existsSync(at(root, ".claude", "skills", "zero-fix-bug")));
  assert.equal(read(at(root, "CLAUDE.md")), "# Team notes\n");
  assert.ok(!fs.existsSync(at(root, ".claude", "rules", "zeross", "core.md")));
  assert.ok(!read(at(root, ".claude", "settings.json")).includes("zeross-guard"));
  assert.ok(fs.existsSync(at(root, ".claude", "zeross", "config.json")));
});

test("global install never overwrites a foreign skill", () => {
  const foreign = at(home(), "skills", "zeross");
  fs.mkdirSync(foreign, { recursive: true });
  fs.writeFileSync(at(foreign, "SKILL.md"), "not ours");
  assert.equal(installGlobal()[0].action, "conflict");
  assert.equal(read(at(foreign, "SKILL.md")), "not ours");
});

test("global install stamps skills and refreshes stale ones", () => {
  installGlobal(["zero-indonesia"]);
  const dest = at(home(), "skills", "zeross");
  assert.ok(fs.existsSync(at(dest, "SKILL.md")) && fs.existsSync(at(dest, ".zeross_version")));
  assert.ok(fs.existsSync(at(home(), "skills", "zero-indonesia", "SKILL.md")));
  assert.ok(fs.existsSync(at(home(), "zeross", "bin", "workspace-mcp.mjs")));
  fs.writeFileSync(at(dest, ".zeross_version"), "0.0.1\n");
  assert.deepEqual(refreshStaleGlobal(), ["zeross"]);
});

test("cli local set handles host names with dots and writes 0600", async () => {
  const root = makeProject();
  const rc = await cli(["local", "set", "--project", root,
    'dbGrants[staging-db.acme.io]={"scope":"persistent"}', 'playwright.defaultEmail="me@acme.test"']);
  assert.equal(rc, 0);
  const localFile = at(root, ".claude", "zeross", "local.json");
  const local = readJsonFile(localFile);
  assert.deepEqual(local.dbGrants["staging-db.acme.io"], { scope: "persistent" });
  assert.equal(local.playwright.defaultEmail, "me@acme.test");
  assert.equal(fs.statSync(localFile).mode & 0o777, 0o600);
});

test("update reports and bumps pins without touching team edits", () => {
  const root = makeProject();
  apply(root);
  const configPath = at(root, ".claude", "zeross", "config.json");
  const config = readJsonFile(configPath);
  config.mcp.pins.playwright = "@playwright/mcp@0.0.1";
  fs.writeFileSync(configPath, JSON.stringify(config));
  const edited = at(root, ".claude", "zeross", "workflow", "testing.md");
  fs.writeFileSync(edited, "team version");

  const report = update.diff(root);
  assert.equal(report.pinBumps.playwright.from, "@playwright/mcp@0.0.1");
  assert.ok(report.modified.some((m) => m.path.endsWith("workflow/testing.md")));

  update.apply(root, { bumpPins: true });
  assert.notEqual(readJsonFile(configPath).mcp.pins.playwright, "@playwright/mcp@0.0.1");
  assert.equal(read(edited), "team version");
  assert.ok(fs.existsSync(`${edited}.zeross-new`));
});

test("the envrc command refuses literal secrets", async () => {
  const dir = tempDir();
  assert.equal(await cli(["secret", "envrc", "--dir", dir, "--export", "GITHUB_TOKEN=ghp_literal"]), 2);
  assert.ok(!fs.existsSync(at(dir, ".envrc")));
});

test("selecting a command auto-includes the skills it needs", () => {
  const root = makeProject();
  const result = applyPlan(root, { components: ["zero-fix-bug", "zero-create-pr"], config: {} });
  assert.deepEqual(result.autoIncluded.sort(),
    ["zero-docs-writer", "zero-learn", "zero-pr-description", "zero-security-review", "zero-ui-review"]);
  assert.ok(fs.existsSync(at(root, ".claude", "skills", "zero-pr-description", "SKILL.md")));
});

test("monorepo packs are path-scoped to the right apps", () => {
  const root = makeProject();
  applyPlan(root, { components: ["zero-fix-bug"], config: {
    project: { monorepo: true, apps: [
      { name: "web", path: "apps/web", kind: "frontend" },
      { name: "api", path: "apps/api", kind: "backend" },
    ] },
    rules: { packs: ["fe-core", "be-core", "db-mongo"] },
  } });
  const rules = at(root, ".claude", "rules", "zeross");
  assert.match(read(at(rules, "fe-core.md")), /^---\npaths:\n {2}- "apps\/web\/\*\*"\n---\n/);
  assert.match(read(at(rules, "be-core.md")), /- "apps\/api\/\*\*"/);
  assert.match(read(at(rules, "db-mongo.md")), /- "apps\/api\/\*\*"/);
  assert.ok(!read(at(rules, "core.md")).startsWith("---"));
  assert.match(read(at(rules, "ui.md")), /- "apps\/web\/\*\*"/);
});

test("ruleScopes cannot point outside the project", () => {
  assert.throws(() => applyPlan(makeProject(), { components: ["zero-learn"], config: {},
    ruleScopes: { core: ["../../**"] } }), /invalid ruleScopes/);
});

test("a crafted manifest cannot make uninstall delete files outside the project", () => {
  const root = makeProject();
  apply(root);
  const outside = path.join(path.dirname(root), "outside.txt");
  fs.writeFileSync(outside, "");
  const manifestFile = at(root, ".claude", "zeross", "manifest.json");
  const manifest = readJsonFile(manifestFile);
  manifest.files["../outside.txt"] = { sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", templateVersion: "x" };
  manifest.files["README.md"] = { sha256: "x", templateVersion: "x" };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const result = uninstallProject(root);
  assert.ok(fs.existsSync(outside), "file outside the project survives");
  assert.deepEqual(result.ignoredManifestEntries.sort(), ["../outside.txt", "README.md"]);
});

test("writes go through symlinks instead of replacing them", () => {
  const root = makeProject();
  fs.writeFileSync(at(root, "rules.gitignore"), "node_modules/\n");
  fs.symlinkSync("rules.gitignore", at(root, ".gitignore"));
  apply(root);
  assert.ok(fs.lstatSync(at(root, ".gitignore")).isSymbolicLink());
  assert.ok(read(at(root, "rules.gitignore")).includes(".claude/zeross/local.json"));
});

test("the guard hook is not re-added when the team turned it off", () => {
  const root = makeProject();
  applyPlan(root, { ...structuredClone(PLAN), hooks: false });
  assert.ok(!fs.existsSync(at(root, ".claude", "settings.json")) || !read(at(root, ".claude", "settings.json")).includes("zeross-guard"));
  update.apply(root);
  assert.ok(!fs.existsSync(at(root, ".claude", "settings.json")) || !read(at(root, ".claude", "settings.json")).includes("zeross-guard"));
});

test("an edited guard command is detected, not duplicated", () => {
  const root = makeProject();
  apply(root);
  const file = at(root, ".claude", "settings.json");
  const settings = readJsonFile(file);
  settings.hooks.PreToolUse[0].hooks[0].command = 'node "./.claude/zeross/bin/zeross-guard.mjs" --verbose';
  fs.writeFileSync(file, JSON.stringify(settings));
  apply(root);
  assert.equal(JSON.stringify(readJsonFile(file)).split("zeross-guard.mjs").length, 2);
});

test("cli local/profile set refuse prototype keys", async () => {
  const root = makeProject();
  for (const key of ["__proto__.polluted=1", "constructor.prototype.x=1", "a[__proto__]=1"]) {
    assert.equal(await cli(["local", "set", "--project", root, key]), 2, key);
  }
  assert.equal(/** @type {any} */ ({}).polluted, undefined);
});

test("secret reveal is limited to zeross-test-* services", async () => {
  assert.equal(await cli(["secret", "reveal", "zeross-github-ws"]), 2);
});

test("the envrc command rejects bad names, injections and secret-looking literals", async () => {
  const dir = tempDir();
  for (const item of ["NOEQUALS", "DATABASE_URL=postgres://app:hunter2@db/app", "db_password=hunter2",
    "API_KEY=sk-live-abc", "GH=keychain:svc$(touch /tmp/x)", 'X;rm=1', "OK=a\nb"]) {
    assert.equal(await cli(["secret", "envrc", "--dir", dir, "--export", item]), 2, item);
  }
  assert.equal(await cli(["secret", "envrc", "--dir", dir, "--export", "JIRA_URL=https://acme.atlassian.net/x'y"]), 0);
  assert.ok(read(at(dir, ".envrc")).includes("export JIRA_URL='https://acme.atlassian.net/x'\\''y'"));
});

test("secret get-ref rejects invalid service names without crashing", async () => {
  assert.equal(await cli(["secret", "get-ref", "Zeross Test"]), 2);
});

test("the always-on workflow rule reminds a teammate without a profile how to set up", () => {
  const root = makeProject();
  apply(root);
  const rule = read(at(root, ".claude", "rules", "zeross", "zeross.md"));
  assert.ok(rule.includes("~/.claude/zeross/profile.json"));
  assert.ok(rule.includes("npm i -g zeross-cli && zeross install"));
});
