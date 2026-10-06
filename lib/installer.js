// lib/installer.js
// @ts-check
/**
 * Global install and per-project apply / status / uninstall.
 *
 * The /zeross skill runs the interview, writes the answers to a plan JSON and
 * calls `zeross apply --plan <file> [--dry-run]`. This module turns that plan
 * into file operations that respect the manifest write policy.
 *
 * Rule packs are installed as native Claude Code rules in `.claude/rules/zeross/`
 * (path-scoped per app in a monorepo), so zeross never edits a CLAUDE.md.
 */

import fs from "node:fs";
import path from "node:path";

import { ZEROSS_SKILLS } from "./detect.js";
import { CONFLICT, MODIFIED, Manifest, opToJson, pruneEmptyDirs } from "./manifest.js";
import { DEFAULT_PINS, installUserBin, mergeProjectMcp, projectMcpEntries } from "./mcp.js";
import {
  GLOBAL_SKILL_NAME, ProjectPaths, TEMPLATES_DIR, VERSION_STAMP, exists, globalSkillsDir, isDir, profilePath,
  userBinDir, version, zerossHome,
} from "./paths.js";
import {
  HASH_MARKERS, MD_MARKERS, atomicWrite, clone, dumpJson, insideRoot, isPlainObject, jsonEqual, jsonMergeAddOnly,
  mergeMarkerBlock, readJson, readText, removeMarkerBlock,
} from "./writer.js";

/** @typedef {import("./manifest.js").FileOp} FileOp */

const PROJECT_TEMPLATES = path.join(TEMPLATES_DIR, "project");
const RULE_PACKS_DIR = path.join(TEMPLATES_DIR, "rule-packs");
export const RULES_DIR = ".claude/rules/zeross";
const ALWAYS_PACKS = ["core", "testing"];
const GENERATED_PACKS = ["custom", "ui"];
const SEED_DIRS = ["knowledge"]; // created once, then owned by the team (edited via /zero-learn)
export const OPTIONAL_GLOBAL_SKILLS = ["zero-indonesia"];
export const GUARD_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.claude/zeross/bin/zeross-guard.mjs"';
const GUARD_MARK = "zeross-guard.mjs";
const GITIGNORE_BLOCK = [".claude/zeross/local/", ".claude/zeross/local.json", ".playwright-mcp/", "*.zeross-new", ".envrc"]
  .join("\n");
const NO_CUSTOM_RULES = "- _No custom rules yet._";
const FE_KINDS = ["frontend", "fullstack", "mobile"];
const BE_KINDS = ["backend", "fullstack"];

/** Skills a command needs at runtime; selecting the command installs them too. */
export const DEPENDENCIES = {
  "zero-fix-bug": ["zero-docs-writer", "zero-security-review", "zero-ui-review", "zero-learn"],
  "zero-build-small-feature": ["zero-docs-writer", "zero-security-review", "zero-ui-review", "zero-learn"],
  "zero-build-feature": ["zero-docs-writer", "zero-security-review", "zero-ui-review", "zero-learn"],
  "zero-create-pr": ["zero-pr-description"],
};

// ---------------------------------------------------------------------------
// Global install (~/.claude/skills/zeross)

/** @param {string} dest */
function readStamp(dest) {
  const stamp = readText(path.join(dest, VERSION_STAMP)).trim();
  return stamp || null;
}

/** @param {string | null | undefined} v */
function parseVersion(v) {
  const [core, pre = ""] = String(v ?? "0").replace(/^v/, "").split("-", 2);
  return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
}

/**
 * SemVer-ish compare: numeric core first, then a prerelease ranks below its release.
 * @param {string | null | undefined} a @param {string | null | undefined} b
 */
export function versionLt(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.nums.length, pb.nums.length); i += 1) {
    const x = pa.nums[i] ?? 0;
    const y = pb.nums[i] ?? 0;
    if (x !== y) return x < y;
  }
  if (pa.pre === pb.pre) return false;
  if (!pa.pre) return false;
  if (!pb.pre) return true;
  const xs = pa.pre.split(".");
  const ys = pb.pre.split(".");
  for (let i = 0; i < Math.max(xs.length, ys.length); i += 1) {
    if (xs[i] === undefined) return true;
    if (ys[i] === undefined) return false;
    const [nx, ny] = [Number(xs[i]), Number(ys[i])];
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx < ny;
    } else if (xs[i] !== ys[i]) {
      return xs[i] < ys[i];
    }
  }
  return false;
}

/** @param {string} name @param {boolean} [force] */
export function installGlobalSkill(name, force = false) {
  const src = path.join(TEMPLATES_DIR, "global", name);
  const dest = path.join(globalSkillsDir(), name);
  if (exists(dest) && readStamp(dest) === null && !force) {
    return { skill: name, action: "conflict", path: dest,
      reason: "folder exists and was not installed by zeross; left untouched" };
  }
  const action = exists(dest) ? "update" : "create";
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  fs.writeFileSync(path.join(dest, VERSION_STAMP), `${version()}\n`);
  return { skill: name, action, path: dest };
}

/** @param {string[]} [withOptional] */
export function installGlobal(withOptional = []) {
  /** @type {Record<string, any>[]} */
  const results = [installGlobalSkill(GLOBAL_SKILL_NAME)];
  for (const name of withOptional) if (OPTIONAL_GLOBAL_SKILLS.includes(name)) results.push(installGlobalSkill(name));
  results.push({ skill: "user-bin", action: "update", paths: installUserBin() });
  return results;
}

/** Re-copy zeross-owned global skills whose stamp is older than this package. */
export function refreshStaleGlobal() {
  const refreshed = [];
  for (const name of [GLOBAL_SKILL_NAME, ...OPTIONAL_GLOBAL_SKILLS]) {
    const stamp = readStamp(path.join(globalSkillsDir(), name));
    if (stamp && versionLt(stamp, version())) {
      installGlobalSkill(name);
      refreshed.push(name);
    }
  }
  if (refreshed.length && isDir(userBinDir())) installUserBin();
  return refreshed;
}

/** @param {boolean} [purge] */
export function uninstallGlobal(purge = false) {
  const results = [];
  for (const name of [GLOBAL_SKILL_NAME, ...OPTIONAL_GLOBAL_SKILLS]) {
    const dest = path.join(globalSkillsDir(), name);
    if (exists(dest) && readStamp(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
      results.push({ path: dest, action: "removed" });
    } else if (exists(dest)) {
      results.push({ path: dest, action: "kept", reason: "not installed by zeross" });
    }
  }
  if (exists(userBinDir())) {
    fs.rmSync(userBinDir(), { recursive: true, force: true });
    results.push({ path: userBinDir(), action: "removed" });
  }
  if (purge && exists(zerossHome())) {
    fs.rmSync(zerossHome(), { recursive: true, force: true });
    results.push({ path: zerossHome(), action: "purged" });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Rendering helpers

/** @param {string} base @returns {string[]} files relative to base, posix separators */
function templateFiles(base) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".DS_Store" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(base, full).split(path.sep).join("/"));
    }
  };
  if (isDir(base)) walk(base);
  return out.sort();
}

/** @param {string} rel */
const modeFor = (rel) => (/\/bin\/[^/]+\.(mjs|js|sh)$/.test(`/${rel}`) ? 0o755 : undefined);

/** @param {string[]} items @param {string} empty */
const bullets = (items, empty) => (items.length ? items.map((i) => `- ${i}`).join("\n") : `- ${empty}`);

/** @param {Record<string, any>} config */
export function uiContext(config) {
  const ui = config.ui ?? {};
  const ds = ui.designSystem ?? {};
  const bps = ui.breakpoints ?? [];
  return {
    designSystemStatus: ds.exists ? "Yes" : "No",
    designSystemPaths: bullets((ds.paths ?? []).map((/** @type {string} */ p) => `\`${p}\``), "_None_"),
    designSystemNotes: ds.notes || "_None_",
    breakpoints: bullets(bps.map((/** @type {any} */ b) => `${b.name}: ${b.width}x${b.height}`),
      "mobile: 375x812\n- tablet: 768x1024\n- desktop: 1440x900"),
    darkMode: ui.darkMode ? "Yes" : "No",
    i18n: ui.i18n ? "Yes" : "No",
    extraUiRules: bullets(ui.extraRules ?? [], "_None_"),
  };
}

/** @param {string} text @param {Record<string, string>} context */
export const renderPlaceholders = (text, context) =>
  text.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key) => (key in context ? context[key] : whole));

/**
 * Render custom.md once, then only append rules not already present.
 * @param {string} existing @param {string[]} rules
 */
export function customRulesText(existing, rules) {
  const clean = rules.map((r) => r.trim()).filter(Boolean);
  if (!existing) {
    const template = readText(path.join(RULE_PACKS_DIR, "custom.md"));
    return renderPlaceholders(template, { customRules: bullets(clean, "_No custom rules yet._") });
  }
  const missing = clean.filter((r) => !existing.includes(r));
  if (!missing.length) return existing;
  const text = existing.replace(`${NO_CUSTOM_RULES}\n`, "").replace(/\n+$/, "");
  return `${text}\n${missing.map((r) => `- ${r}`).join("\n")}\n`;
}

/** Always-on summary rule that replaces the old CLAUDE.md block. */
export function workflowRule() {
  return `# zeross workflow

This project follows the zeross team workflow. Commands: \`/zero-fix-bug\`, \`/zero-build-small-feature\`,
\`/zero-build-feature\`, \`/zero-create-pr\`, \`/zero-learn\`, \`/zero-update\`. Reviews: \`/zero-security-review\`,
\`/zero-ui-review\`. Docs: \`/zero-docs-writer\`.

- Shared workflow: \`.claude/zeross/workflow/\` (read by the commands when their phase starts).
- Team config: \`.claude/zeross/config.json\`. Team knowledge: \`.claude/zeross/knowledge/\`.
- Rule packs: this folder (\`.claude/rules/zeross/\`). Packs with \`paths:\` load when you work on matching files.
`;
}

/**
 * Prepend `paths:` frontmatter when a pack is scoped.
 * @param {string} body @param {string[] | undefined} globs
 */
export function withPaths(body, globs) {
  if (!globs?.length) return body;
  return `---\npaths:\n${globs.map((g) => `  - ${JSON.stringify(g)}`).join("\n")}\n---\n\n${body}`;
}

/**
 * Default scopes: only in a monorepo with apps of distinct kinds. FE packs go to
 * FE apps, BE/DB packs to BE apps; shared packs (core, testing, custom) stay global.
 * @param {Record<string, any>} config @param {string[]} packs
 * @returns {Record<string, string[]>}
 */
export function defaultScopes(config, packs) {
  const apps = Array.isArray(config.project?.apps) ? config.project.apps : [];
  if (!config.project?.monorepo || apps.length < 2) return {};
  const globsFor = (/** @type {string[]} */ kinds) => apps
    .filter((/** @type {any} */ a) => kinds.includes(a.kind) && typeof a.path === "string" && a.path !== ".")
    .map((/** @type {any} */ a) => `${a.path.replace(/\/+$/, "")}/**`);
  const fe = globsFor(FE_KINDS);
  const be = globsFor(BE_KINDS);
  /** @type {Record<string, string[]>} */
  const scopes = {};
  for (const pack of [...packs, "ui"]) {
    const globs = pack.startsWith("fe-") || pack === "ui" ? fe : pack.startsWith("be-") || pack.startsWith("db-") ? be : [];
    if (globs.length) scopes[pack] = globs;
  }
  return scopes;
}

/** @param {unknown} scopes @returns {Record<string, string[]>} */
function validateScopes(scopes) {
  if (scopes === undefined || scopes === null) return {};
  if (!isPlainObject(scopes)) throw new Error("ruleScopes must be an object of pack → glob list");
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const [pack, globs] of Object.entries(scopes)) {
    if (!Array.isArray(globs) || globs.some((g) => typeof g !== "string" || !g || g.startsWith("/")
      || g.split("/").includes("..") || /[\r\n]/.test(g))) {
      throw new Error(`invalid ruleScopes for ${pack}: globs must be relative patterns inside the project`);
    }
    if (globs.length) out[pack] = [...globs];
  }
  return out;
}

/**
 * Dotted paths present in `next` but not in `prev` (objects only).
 * @param {any} prev @param {any} next @param {string} [prefix] @returns {string[]}
 */
export function newKeys(prev, next, prefix = "") {
  if (!isPlainObject(prev) || !isPlainObject(next)) return [];
  return Object.entries(next).flatMap(([key, value]) =>
    key in prev ? newKeys(prev[key], value, `${prefix}${key}.`) : [`${prefix}${key}`]);
}

/** @param {Record<string, any>} config */
export function withDefaults(config) {
  const defaults = {
    $schema: "./config.schema.json",
    schemaVersion: 1,
    git: { baseBranch: "main", protectedBranches: ["main", "master", "develop"],
      branchPattern: { fix: "fix/{ticket}-{slug}", feature: "feature/{ticket}-{slug}" } },
    pr: { defaultReviewers: [], closeKeywords: false, attributionFooter: false, draftByDefault: false,
      commentOnTicket: "ask" },
    rules: { packs: [...ALWAYS_PACKS], strictness: "strict", commentPolicy: "none", testPolicy: "logic-and-components" },
    ui: { designSystem: { exists: false, paths: [], notes: "" },
      breakpoints: [{ name: "mobile", width: 375, height: 812 }, { name: "tablet", width: 768, height: 1024 },
        { name: "desktop", width: 1440, height: 900 }],
      darkMode: false, i18n: false },
    docs: { path: "docs" },
    hooks: { guard: true },
    mcp: { pins: { ...DEFAULT_PINS } },
  };
  return jsonMergeAddOnly(config, defaults);
}

// ---------------------------------------------------------------------------
// Plan → operations

/** Validated install plan written by the /zeross skill. */
export class Plan {
  /** @param {Record<string, any>} data */
  constructor(data) {
    this.data = data;
    /** @type {Record<string, any>} */
    this.config = clone(data.config ?? {});
    const requested = data.components ?? [...ZEROSS_SKILLS];
    if (!Array.isArray(requested)) throw new Error("components must be a list");
    const unknown = requested.filter((/** @type {string} */ c) => !ZEROSS_SKILLS.includes(c)).sort();
    if (unknown.length) throw new Error(`unknown components: ${unknown.join(", ")}`);
    const withDeps = new Set(requested);
    for (const comp of requested) for (const dep of DEPENDENCIES[/** @type {keyof DEPENDENCIES} */ (comp)] ?? []) withDeps.add(dep);
    /** @type {string[]} */
    this.components = ZEROSS_SKILLS.filter((c) => withDeps.has(c));
    /** @type {string[]} */
    this.autoIncluded = this.components.filter((c) => !requested.includes(c));

    const rules = (this.config.rules ??= {});
    /** @type {string[]} */
    const packs = [...new Set([...ALWAYS_PACKS, ...(rules.packs ?? [])])];
    const missing = packs.filter((p) => !GENERATED_PACKS.includes(p)
      && (typeof p !== "string" || !/^[a-z0-9-]+$/.test(p) || !exists(path.join(RULE_PACKS_DIR, `${p}.md`))));
    if (missing.length) throw new Error(`unknown rule packs: ${missing.join(", ")}`);
    rules.packs = packs;
    this.packs = packs.filter((p) => !GENERATED_PACKS.includes(p));
    /** @type {string[]} */
    this.customRules = [...(data.customRules ?? [])];
    this.mcpRoles = ["db", "playwright"].filter((r) => data.mcp?.[r]);
    this.hooks = data.hooks ?? this.config.hooks?.guard ?? true;
    this.config.hooks = { ...this.config.hooks, guard: this.hooks };
    if (data.uiRules?.length) {
      const ui = (this.config.ui ??= {});
      ui.extraRules = [...new Set([...(ui.extraRules ?? []), ...data.uiRules])];
    }
    // Scopes are persisted in config so /zero-update re-renders the same frontmatter.
    this.scopes = validateScopes(data.ruleScopes ?? rules.scopes ?? defaultScopes(this.config, this.packs));
    rules.scopes = this.scopes;
    delete rules.targets;
  }

  get uiEnabled() {
    return this.components.includes("zero-ui-review");
  }
}

/**
 * @typedef {{ path: string, action: string, kind: string, reason?: string, newKeys?: string[],
 *   _data?: any, _src?: string, _target?: string }} Extra
 */

/**
 * File ops for manifest-tracked files, plus merge/seed actions (described, not yet applied).
 * @param {ProjectPaths} paths @param {Manifest} manifest @param {Plan} plan
 * @returns {{ ops: FileOp[], extras: Extra[] }}
 */
export function buildOps(paths, manifest, plan) {
  /** @type {FileOp[]} */ const ops = [];
  /** @type {Extra[]} */ const extras = [];
  /** @param {string} rel @param {string | Buffer} data @param {number} [mode] */
  const add = (rel, data, mode) => ops.push(manifest.planFile(rel, data, mode));

  for (const comp of plan.components) {
    const srcDir = path.join(PROJECT_TEMPLATES, "skills", comp);
    for (const rel of templateFiles(srcDir)) add(`.claude/skills/${comp}/${rel}`, fs.readFileSync(path.join(srcDir, rel)));
  }
  const zsrc = path.join(PROJECT_TEMPLATES, "zeross");
  for (const rel of templateFiles(zsrc)) {
    const src = path.join(zsrc, rel);
    if (SEED_DIRS.includes(rel.split("/")[0])) {
      const target = insideRoot(paths.root, `.claude/zeross/${rel}`);
      extras.push({ path: `.claude/zeross/${rel}`, action: exists(target) ? "keep" : "seed", kind: "seed",
        _src: src, _target: target });
      continue;
    }
    add(`.claude/zeross/${rel}`, fs.readFileSync(src), modeFor(rel));
  }

  const currentConfig = readJson(paths.config, null);
  const effective = jsonMergeAddOnly(currentConfig ?? {}, withDefaults(plan.config));
  add(`${RULES_DIR}/zeross.md`, workflowRule());
  for (const pack of plan.packs) {
    add(`${RULES_DIR}/${pack}.md`, withPaths(readText(path.join(RULE_PACKS_DIR, `${pack}.md`)), plan.scopes[pack]));
  }
  if (plan.uiEnabled) {
    const ui = renderPlaceholders(readText(path.join(RULE_PACKS_DIR, "ui.md")), uiContext(effective));
    add(`${RULES_DIR}/ui.md`, withPaths(ui, plan.scopes.ui));
  }

  // Team-owned files: merged, never overwritten.
  const customRel = `${RULES_DIR}/custom.md`;
  const existingCustom = readText(insideRoot(paths.root, customRel));
  const nextCustom = customRulesText(existingCustom, plan.customRules);
  if (nextCustom !== existingCustom) {
    extras.push({ path: customRel, action: existingCustom ? "append" : "create", kind: "text", _data: nextCustom });
  }
  if (currentConfig === null) {
    extras.push({ path: ".claude/zeross/config.json", action: "create", kind: "json", _data: effective });
  } else if (!jsonEqual(effective, currentConfig)) {
    extras.push({ path: ".claude/zeross/config.json", action: "merge (add-only)", kind: "json", _data: effective,
      newKeys: newKeys(currentConfig, effective).sort() });
  }

  if (plan.hooks) {
    const settings = readJson(paths.settings, {}) ?? {};
    const already = JSON.stringify(settings.hooks?.PreToolUse ?? []).includes(GUARD_MARK);
    if (!already) {
      const hook = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: GUARD_COMMAND }] }] } };
      extras.push({ path: ".claude/settings.json", action: "merge hook", kind: "json", _data: jsonMergeAddOnly(settings, hook) });
    }
  }

  if (plan.mcpRoles.length) {
    const result = mergeProjectMcp(paths.mcpJson, plan.mcpRoles);
    if (result.added.length) extras.push({ path: ".mcp.json", action: `add ${result.added.join(", ")}`, kind: "json", _data: result.data });
    for (const role of result.skipped) {
      extras.push({ path: ".mcp.json", action: "keep", kind: "info", reason: `server '${role}' already defined; left untouched` });
    }
  }

  const giCurrent = readText(paths.gitignore);
  const giUpdated = mergeMarkerBlock(giCurrent, GITIGNORE_BLOCK, HASH_MARKERS);
  if (giUpdated !== giCurrent) extras.push({ path: ".gitignore", action: "merge block", kind: "text", _data: giUpdated });
  return { ops, extras };
}

/** @param {FileOp[]} ops @param {Extra[]} extras */
export function preview(ops, extras) {
  const items = [
    ...ops.map(opToJson),
    ...extras.map((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith("_")))),
  ];
  /** @type {Record<string, number>} */
  const counts = {};
  for (const item of items) counts[item.action] = (counts[item.action] ?? 0) + 1;
  return {
    counts,
    conflicts: items.filter((i) => i.action === CONFLICT),
    modified: items.filter((i) => i.action === MODIFIED),
    files: items,
  };
}

/**
 * @param {string} root @param {Record<string, any>} planData @param {{ dryRun?: boolean }} [opts]
 */
export function applyPlan(root, planData, { dryRun = false } = {}) {
  const paths = new ProjectPaths(root);
  const manifest = new Manifest(paths);
  const plan = new Plan(planData);
  const { ops, extras } = buildOps(paths, manifest, plan);
  const result = { ...preview(ops, extras), autoIncluded: plan.autoIncluded, ignoredManifestEntries: manifest.ignored, dryRun };
  if (dryRun) return result;
  manifest.apply(ops);
  for (const extra of extras) {
    if (extra.kind === "seed" && extra.action === "seed" && extra._src && extra._target) {
      atomicWrite(extra._target, fs.readFileSync(extra._src));
    } else if (extra.kind === "text") {
      atomicWrite(insideRoot(paths.root, extra.path), extra._data);
    } else if (extra.kind === "json") {
      atomicWrite(insideRoot(paths.root, extra.path), dumpJson(extra._data));
    }
  }
  manifest.save();
  fs.mkdirSync(paths.localDir, { recursive: true });
  return result;
}

// ---------------------------------------------------------------------------
// Status & uninstall

/**
 * Sidecar files under .claude, without following symlinks or entering
 * personal/browser state. Unreadable directories are skipped.
 * @param {string} claudeDir
 */
function findSidecars(claudeDir) {
  /** @type {string[]} */
  const found = [];
  const skip = new Set(["node_modules", "local", "browser-profile"]);
  const walk = (/** @type {string} */ dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".zeross-new")) found.push(`.claude/${path.relative(claudeDir, full).split(path.sep).join("/")}`);
    }
  };
  if (isDir(claudeDir)) walk(claudeDir);
  return found.sort();
}

/** @param {string} root */
export function projectStatus(root) {
  const paths = new ProjectPaths(root);
  const manifest = new Manifest(paths);
  const tracked = Object.keys(manifest.files);
  let state = "fresh";
  if (manifest.exists) {
    if (tracked.some((rel) => !exists(insideRoot(paths.root, rel)))) state = "partial";
    else if (versionLt(manifest.version, version())) state = "outdated";
    else state = "installed";
  }
  const personal = { localJson: exists(paths.localJson), profile: exists(profilePath()) };
  return {
    state,
    joinMode: manifest.exists && !personal.localJson,
    manifestVersion: manifest.version,
    cliVersion: version(),
    components: [...new Set(tracked.filter((r) => r.startsWith(".claude/skills/")).map((r) => r.split("/")[2]))].sort(),
    modifiedFiles: tracked.filter((rel) => manifest.isModified(rel)),
    ignoredManifestEntries: manifest.ignored,
    configPresent: exists(paths.config),
    personal,
    sidecars: findSidecars(paths.claudeDir),
  };
}

/**
 * @param {string} root @param {{ purge?: boolean, dryRun?: boolean }} [opts]
 */
export function uninstallProject(root, { purge = false, dryRun = false } = {}) {
  const paths = new ProjectPaths(root);
  const manifest = new Manifest(paths);
  const { safe, keep } = manifest.removable();
  const actions = { removed: safe, kept: keep, ignoredManifestEntries: manifest.ignored, dryRun };
  if (dryRun) return actions;
  for (const rel of safe) {
    const target = insideRoot(paths.root, rel);
    fs.rmSync(target, { force: true });
    manifest.forget(rel);
    pruneEmptyDirs(paths.root, path.dirname(target));
  }
  // Legacy installs imported rules through a block in the root CLAUDE.md.
  const md = readText(paths.claudeMd);
  if (md.includes(MD_MARKERS[0])) atomicWrite(paths.claudeMd, removeMarkerBlock(md, MD_MARKERS));
  const gi = readText(paths.gitignore);
  if (gi.includes(HASH_MARKERS[0])) atomicWrite(paths.gitignore, removeMarkerBlock(gi, HASH_MARKERS));
  const settings = readJson(paths.settings, null);
  if (settings?.hooks?.PreToolUse) {
    settings.hooks.PreToolUse = settings.hooks.PreToolUse
      .map((/** @type {any} */ g) => ({ ...g,
        hooks: (g.hooks ?? []).filter((/** @type {any} */ h) => !String(h.command ?? "").includes(GUARD_MARK)) }))
      .filter((/** @type {any} */ g) => g.hooks.length);
    if (!settings.hooks.PreToolUse.length) delete settings.hooks.PreToolUse;
    if (!Object.keys(settings.hooks).length) delete settings.hooks;
    atomicWrite(paths.settings, dumpJson(settings));
  }
  const mcp = readJson(paths.mcpJson, null);
  if (mcp?.mcpServers) {
    for (const [role, entry] of Object.entries(projectMcpEntries())) {
      if (jsonEqual(mcp.mcpServers[role], entry)) delete mcp.mcpServers[role];
    }
    atomicWrite(paths.mcpJson, dumpJson(mcp));
  }
  if (keep.length) manifest.save();
  else fs.rmSync(paths.manifest, { force: true });
  if (purge) {
    for (const rel of [".claude/zeross/config.json", ".claude/zeross/local.json", ".claude/zeross/knowledge",
      ".claude/zeross/local", `${RULES_DIR}/custom.md`]) {
      fs.rmSync(insideRoot(paths.root, rel), { recursive: true, force: true });
    }
    pruneEmptyDirs(paths.root, insideRoot(paths.root, RULES_DIR));
    pruneEmptyDirs(paths.root, paths.zerossDir);
  }
  return actions;
}
