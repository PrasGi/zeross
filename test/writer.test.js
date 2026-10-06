// test/writer.test.js
// @ts-check
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { HASH_MARKERS, atomicWrite, jsonMergeAddOnly, mergeMarkerBlock, removeMarkerBlock } from "../lib/writer.js";
import { tempDir } from "./_core-helpers.js";

test("marker block is inserted once and replaced in place", () => {
  const text = "# Project\n\nOwn notes.\n";
  const once = mergeMarkerBlock(text, "zeross v1");
  assert.equal(mergeMarkerBlock(once, "zeross v1"), once);
  const updated = mergeMarkerBlock(once, "zeross v2");
  assert.ok(updated.includes("Own notes.") && updated.includes("zeross v2") && !updated.includes("zeross v1"));
  assert.equal(updated.split("<!-- zeross:start -->").length, 2);
});

test("marker block on an empty file", () => {
  assert.equal(mergeMarkerBlock("", "x"), "<!-- zeross:start -->\nx\n<!-- zeross:end -->\n");
});

test("removing the marker block keeps user text", () => {
  const text = mergeMarkerBlock("node_modules/\n", ".claude/zeross/local/", HASH_MARKERS);
  assert.equal(removeMarkerBlock(text, HASH_MARKERS), "node_modules/\n");
});

test("JSON merge never removes or overrides", () => {
  const existing = { a: 1, list: [1, 2], nested: { keep: true } };
  const incoming = { a: 99, b: 2, list: [2, 3], nested: { keep: false, new: 1 } };
  assert.deepEqual(jsonMergeAddOnly(existing, incoming), { a: 1, b: 2, list: [1, 2, 3], nested: { keep: true, new: 1 } });
});

test("atomic write creates parents, sets mode and leaves no temp file", () => {
  const target = path.join(tempDir(), "a", "b", "f.sh");
  atomicWrite(target, "echo", 0o755);
  assert.equal(fs.readFileSync(target, "utf8"), "echo");
  assert.equal(fs.statSync(target).mode & 0o777, 0o755);
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ["f.sh"]);
});

test("a marker quoted inside user prose is not treated as the block", () => {
  const text = "# Doc\nWe write `<!-- zeross:start -->` markers.\nTeam rule A\n";
  const merged = mergeMarkerBlock(mergeMarkerBlock(text, "z1"), "z2");
  assert.ok(merged.includes("Team rule A") && merged.includes("z2") && !merged.includes("z1"));
  assert.equal(removeMarkerBlock(merged), text);
});

test("unpaired markers are refused instead of guessed", () => {
  assert.throws(() => mergeMarkerBlock("<!-- zeross:start -->\nx\n", "y"), /unpaired/);
});

test("insideRoot rejects escapes, including through symlinks", async () => {
  const { insideRoot } = await import("../lib/writer.js");
  const root = tempDir();
  for (const bad of ["../x", "/etc/passwd", "a/../../x", ""]) assert.throws(() => insideRoot(root, bad), /outside/, bad);
  fs.symlinkSync(tempDir(), path.join(root, "link"));
  assert.throws(() => insideRoot(root, "link/file.md"), /outside/);
  assert.ok(insideRoot(root, ".claude/rules/zeross/core.md").endsWith("core.md"));
});
