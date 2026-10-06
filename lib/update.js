// lib/update.js
// @ts-check
/** Self-update check and project template diff/apply for /zero-update. */

import fs from "node:fs";
import path from "node:path";

import { DEFAULT_PINS } from "./mcp.js";
import { Manifest, pruneEmptyDirs } from "./manifest.js";
import { PACKAGE_DIR, ProjectPaths, version, zerossHome } from "./paths.js";
import { Plan, applyPlan, buildOps, preview, versionLt } from "./installer.js";
import { clone, insideRoot, readJson, writeJson } from "./writer.js";

const REGISTRY_URL = "https://registry.npmjs.org/zeross-cli/latest";
const CACHE_MS = 24 * 3600 * 1000;
const PACKAGE = "zeross-cli";

/** How this copy of zeross was installed, and the matching upgrade command. */
export function installMethod() {
  const dir = fs.realpathSync(PACKAGE_DIR).split(path.sep).join("/");
  if (fs.existsSync(path.join(PACKAGE_DIR, ".git"))) {
    return { method: "source", upgrade: `git -C ${PACKAGE_DIR} pull && zeross install` };
  }
  if (dir.includes("/_npx/")) return { method: "npx", upgrade: `npx ${PACKAGE}@latest install` };
  if (dir.includes("/.bun/install/global/")) return { method: "bun", upgrade: `bun add -g ${PACKAGE}@latest && zeross install` };
  if (dir.includes("/pnpm/global/") || dir.includes("/.pnpm/")) {
    return { method: "pnpm", upgrade: `pnpm add -g ${PACKAGE}@latest && zeross install` };
  }
  if (dir.includes(`/node_modules/${PACKAGE}`)) return { method: "npm", upgrade: `npm install -g ${PACKAGE}@latest && zeross install` };
  return { method: "unknown", upgrade: `npm install -g ${PACKAGE}@latest && zeross install` };
}

/** @param {boolean} [force] @returns {Promise<string | null>} */
export async function latestVersion(force = false) {
  const cache = path.join(zerossHome(), "update-check.json");
  const data = readJson(cache, {}) ?? {};
  if (!force && (data.checkedAt ?? 0) + CACHE_MS > Date.now()) return data.latest ?? null;
  try {
    const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return data.latest ?? null;
    const latest = String((await res.json()).version);
    writeJson(cache, { checkedAt: Date.now(), latest });
    return latest;
  } catch {
    return data.latest ?? null;
  }
}

/** @param {boolean} [force] */
export async function check(force = false) {
  const latest = await latestVersion(force);
  return { installed: version(), latest, updateAvailable: Boolean(latest) && versionLt(version(), latest), ...installMethod() };
}

/** @param {ProjectPaths} paths @param {Manifest} manifest */
function reconstructPlan(paths, manifest) {
  const config = readJson(paths.config, null);
  if (config === null) throw new Error("no .claude/zeross/config.json: run /zeross first");
  const components = [...new Set(Object.keys(manifest.files)
    .filter((r) => r.startsWith(".claude/skills/")).map((r) => r.split("/")[2]))].sort();
  const servers = readJson(paths.mcpJson, {})?.mcpServers ?? {};
  // Respect what the team chose: the guard hook only when config says so.
  return new Plan({ components, config: clone(config), mcp: { db: "db" in servers, playwright: "playwright" in servers },
    hooks: config.hooks?.guard ?? true });
}

/** @param {string} root */
export function diff(root) {
  const paths = new ProjectPaths(root);
  const manifest = new Manifest(paths);
  const plan = reconstructPlan(paths, manifest);
  const { ops, extras } = buildOps(paths, manifest, plan);
  const planned = new Set(ops.map((op) => op.rel));
  const pins = readJson(paths.config, {})?.mcp?.pins ?? {};
  return {
    ...preview(ops, extras),
    removedUpstream: Object.keys(manifest.files).filter((rel) => !planned.has(rel)).sort(),
    pinBumps: Object.fromEntries(Object.entries(DEFAULT_PINS).filter(([k, v]) => pins[k] !== v)
      .map(([k, v]) => [k, { from: pins[k] ?? null, to: v }])),
    manifestVersion: manifest.version,
    cliVersion: version(),
  };
}

/** @param {string} root @param {{ bumpPins?: boolean }} [opts] */
export function apply(root, { bumpPins = false } = {}) {
  const paths = new ProjectPaths(root);
  const before = diff(root);
  const result = applyPlan(root, reconstructPlan(paths, new Manifest(paths)).data);
  const manifest = new Manifest(paths);
  const { safe } = manifest.removable();
  const removed = before.removedUpstream.filter((rel) => safe.includes(rel));
  for (const rel of removed) {
    const target = insideRoot(paths.root, rel);
    fs.rmSync(target, { force: true });
    manifest.forget(rel);
    pruneEmptyDirs(paths.root, path.dirname(target));
  }
  if (removed.length) manifest.save();
  const bumps = Object.entries(before.pinBumps);
  if (bumpPins && bumps.length) {
    const config = readJson(paths.config, {}) ?? {};
    config.mcp ??= {};
    config.mcp.pins = { ...config.mcp.pins, ...Object.fromEntries(bumps.map(([k, v]) => [k, v.to])) };
    writeJson(paths.config, config);
  }
  return { ...result, removed, pinsBumped: bumpPins && bumps.length > 0 };
}
