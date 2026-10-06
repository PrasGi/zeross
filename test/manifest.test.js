// test/manifest.test.js
// @ts-check
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { ADOPT, CONFLICT, CREATE, DELETED, MODIFIED, Manifest, UNCHANGED, UPDATE } from "../lib/manifest.js";
import { ProjectPaths } from "../lib/paths.js";
import { tempDir } from "./_core-helpers.js";

const REL = ".claude/skills/zero-x/SKILL.md";
const newManifest = () => new Manifest(new ProjectPaths(tempDir()));

/** @param {Manifest} m @param {string} data */
function write(m, data) {
  m.apply([m.planFile(REL, data)]);
  m.save();
}

test("an absent file is created", () => {
  assert.equal(newManifest().planFile(REL, "v1").action, CREATE);
});

test("a tracked, unmodified file is updated or unchanged", () => {
  const m = newManifest();
  write(m, "v1");
  assert.equal(m.planFile(REL, "v1").action, UNCHANGED);
  assert.equal(m.planFile(REL, "v2").action, UPDATE);
});

test("a locally edited file gets a sidecar instead of an overwrite", () => {
  const m = newManifest();
  write(m, "v1");
  const target = m.paths.abs(REL);
  fs.writeFileSync(target, "team edit");
  const op = m.planFile(REL, "v2");
  assert.equal(op.action, MODIFIED);
  m.apply([op]);
  assert.equal(fs.readFileSync(target, "utf8"), "team edit");
  assert.equal(fs.readFileSync(`${target}.zeross-new`, "utf8"), "v2");
});

test("a foreign file is a conflict and stays untouched", () => {
  const m = newManifest();
  const target = m.paths.abs(REL);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "someone else's skill");
  const op = m.planFile(REL, "ours");
  assert.equal(op.action, CONFLICT);
  m.apply([op]);
  assert.equal(fs.readFileSync(target, "utf8"), "someone else's skill");
  assert.ok(!(REL in m.files));
});

test("an identical foreign file is adopted", () => {
  const m = newManifest();
  const target = m.paths.abs(REL);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "same");
  assert.equal(m.planFile(REL, "same").action, ADOPT);
});

test("a tracked file the user deleted is not recreated", () => {
  const m = newManifest();
  write(m, "v1");
  fs.rmSync(m.paths.abs(REL));
  assert.equal(m.planFile(REL, "v2").action, DELETED);
});
