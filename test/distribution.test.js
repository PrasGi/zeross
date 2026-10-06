// test/distribution.test.js
// @ts-check
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { tempDir } from "./_core-helpers.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "bin", "zeross.js");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

test("the bin prints the package version", () => {
  assert.equal(execFileSync("node", [BIN, "--version"], { encoding: "utf8" }).trim(), `zeross ${pkg.version}`);
});

test("update check reports the install method without network when cached", () => {
  const home = tempDir();
  fs.mkdirSync(path.join(home, "zeross"));
  fs.writeFileSync(path.join(home, "zeross", "update-check.json"), JSON.stringify({ checkedAt: Date.now(), latest: pkg.version }));
  const out = JSON.parse(execFileSync("node", [BIN, "update", "check", "--json"], {
    encoding: "utf8", env: { ...process.env, CLAUDE_CONFIG_DIR: home },
  }));
  assert.equal(out.installed, pkg.version);
  assert.equal(out.updateAvailable, false);
  assert.equal(out.method, "source"); // running from the git checkout
});

test("the published file list ships templates and no Python or tests", () => {
  assert.deepEqual(pkg.files, ["bin/", "lib/", "templates/"]);
  assert.equal(pkg.type, "module");
  assert.equal(pkg.engines.node, ">=22");
  assert.deepEqual(pkg.dependencies ?? {}, {});
});
