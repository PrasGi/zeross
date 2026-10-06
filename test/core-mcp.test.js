// test/core-mcp.test.js
// @ts-check
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { recommendCapacity } from "../lib/doctor.js";
import { findEquivalents, mergeProjectMcp, parseMcpList } from "../lib/mcp.js";
import { quote, setSecret, writeEnvrcBlock } from "../lib/secrets.js";
import { tempDir } from "./_core-helpers.js";

const MCP_LIST = `Checking MCP server health…

claude.ai Atlassian Rovo: https://mcp.atlassian.com/v1/mcp - ✔ Connected
github: /Users/me/.claude/bin/github-mcp.sh  - ✔ Connected
db: node .claude/zeross/bin/db-mcp.mjs - ⏸ Pending approval
broken: npx thing - ✘ Failed to connect
`;

test("parses `claude mcp list` and finds equivalent servers", () => {
  const servers = parseMcpList(MCP_LIST);
  assert.deepEqual(servers.map((s) => s.name), ["claude.ai Atlassian Rovo", "github", "db", "broken"]);
  assert.ok(servers[2].pendingApproval && !servers[3].connected);
  assert.deepEqual(findEquivalents("jira", servers).map((s) => s.name), ["claude.ai Atlassian Rovo"]);
  assert.deepEqual(findEquivalents("github", servers).map((s) => s.name), ["github"]);
});

test("merging project MCP entries never replaces an existing server", () => {
  const file = path.join(tempDir(), ".mcp.json");
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { playwright: { command: "mine" } } }));
  const result = mergeProjectMcp(file, ["db", "playwright"]);
  assert.deepEqual(result.added, ["db"]);
  assert.deepEqual(result.skipped, ["playwright"]);
  assert.deepEqual(result.data.mcpServers.playwright, { command: "mine" });
});

test("the .envrc block uses keychain refs, keeps user lines and is private", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, ".envrc"), "export OWN=1\n");
  writeEnvrcBlock(dir, { GITHUB_PERSONAL_ACCESS_TOKEN: "keychain:zeross-github-ws", JIRA_URL: "https://acme.atlassian.net" });
  writeEnvrcBlock(dir, { JIRA_API_TOKEN: "keychain:zeross-jira-ws" });
  const text = fs.readFileSync(path.join(dir, ".envrc"), "utf8");
  assert.ok(text.startsWith("export OWN=1\n"));
  for (const s of ["zeross-github-ws", "zeross-jira-ws", "JIRA_URL"]) assert.ok(text.includes(s), s);
  assert.equal(text.split("# >>> zeross >>>").length, 2);
  assert.equal(fs.statSync(path.join(dir, ".envrc")).mode & 0o777, 0o600);
});

test("keychain values go to `security -i` on stdin, never argv", () => {
  assert.equal(quote('v"al\\ue'), '"v\\"al\\\\ue"');
  /** @type {{ cmd: string, args: string[], input?: string }[]} */
  const calls = [];
  /** @type {import("../lib/secrets.js").Runner} */
  const fakeRun = (cmd, args, opts) => {
    calls.push({ cmd, args, input: /** @type {any} */ (opts)?.input });
    return { status: 0, stdout: 'v"al\\ue', stderr: "" };
  };
  setSecret("zeross-github-ws", 'v"al\\ue', fakeRun, "macos-keychain");
  const write = calls.find((c) => c.cmd === "security" && c.args[0] === "-i");
  assert.ok(write, "uses `security -i`");
  assert.ok(!write.args.join(" ").includes('v"al'));
  assert.ok(write.input?.includes('-w "v\\"al\\\\ue"'));
});

for (const [mem, cpus, expected] of /** @type {[number, number, number[]][]} */ ([
  [8, 8, [2, 1, 1]], [16, 10, [3, 2, 2]], [32, 12, [4, 3, 3]], [4, 4, [1, 1, 1]], [36, 8, [3, 2, 2]],
])) {
  test(`capacity for ${mem} GB / ${cpus} cores`, () => {
    const cap = recommendCapacity(mem, cpus);
    assert.deepEqual([cap.understanding, cap.unitTest, cap.playwright], expected);
  });
}

test("keychain writes refuse line breaks and bad service names", async () => {
  const { SecretError } = await import("../lib/secrets.js");
  const noop = /** @type {any} */ (() => ({ status: 0, stdout: "x" }));
  assert.throws(() => setSecret("svc\nshow-keychain-info", "x", noop, "macos-keychain"), SecretError);
  assert.throws(() => setSecret("zeross-github-ws", "a\nb", noop, "macos-keychain"), SecretError);
});

test("versionLt ranks prereleases below their release", async () => {
  const { versionLt } = await import("../lib/installer.js");
  assert.equal(versionLt("1.0.0-beta.2", "1.0.0"), true);
  assert.equal(versionLt("1.0.0", "1.0.0-beta.2"), false);
  assert.equal(versionLt("1.0.0-beta.2", "1.0.0-beta.10"), true);
  assert.equal(versionLt("0.9.9", "0.10.0"), true);
  assert.equal(versionLt("1.0.0", "1.0.0"), false);
});

test("context7 wrapper reports key presence without printing it", async () => {
  const { execFileSync } = await import("node:child_process");
  const script = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "templates", "user", "bin", "context7-mcp.mjs");
  const run = (/** @type {Record<string, string>} */ env) =>
    JSON.parse(execFileSync(process.execPath, [script, "--dry-run"], { encoding: "utf8", env: { ...process.env, PATH: "/nonexistent", ...env } }));
  const withKey = execFileSync("node", [script, "--dry-run"], { encoding: "utf8", env: { ...process.env, CONTEXT7_API_KEY: "ctx7sk-secret" } });
  assert.ok(!withKey.includes("ctx7sk-secret"));
  assert.equal(JSON.parse(withKey).apiKey, "present");
  assert.equal(run({ CONTEXT7_API_KEY: "" }).apiKey, "absent");
});

test("mcp add context7 --dry-run plans a user-scope wrapper", async () => {
  const { addContext7 } = await import("../lib/mcp.js");
  const plan = addContext7({ projectRoot: tempDir(), dryRun: true });
  assert.equal(plan.scope, "user");
  assert.equal(plan.keychainService, "zeross-context7");
  assert.ok(plan.command[1].endsWith("context7-mcp.mjs"));
});
