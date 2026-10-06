// lib/paths.js
// @ts-check
/** Locations zeross reads and writes. Every path is resolved here. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TEMPLATES_DIR = path.join(PACKAGE_DIR, "templates");
export const GLOBAL_SKILL_NAME = "zeross";
export const VERSION_STAMP = ".zeross_version";

/** @returns {string} */
export function version() {
  return JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, "package.json"), "utf8")).version;
}

/** ~/.claude, honoring CLAUDE_CONFIG_DIR like Claude Code does. */
export function claudeHome() {
  const custom = process.env.CLAUDE_CONFIG_DIR;
  return custom ? path.resolve(custom.replace(/^~(?=$|\/)/, os.homedir())) : path.join(os.homedir(), ".claude");
}

/** Per-user zeross state: profile, workspace registry, user-scope wrappers. */
export const zerossHome = () => path.join(claudeHome(), "zeross");
export const profilePath = () => path.join(zerossHome(), "profile.json");
export const workspacesPath = () => path.join(zerossHome(), "workspaces.json");
export const userBinDir = () => path.join(zerossHome(), "bin");
export const globalSkillsDir = () => path.join(claudeHome(), "skills");

/** @param {string} p */
export const exists = (p) => fs.existsSync(p);

/** @param {string} p */
export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Nearest ancestor holding .git; falls back to the start directory.
 * @param {string} [start]
 */
export function findProjectRoot(start) {
  let here = path.resolve(start || process.cwd());
  const origin = here;
  for (;;) {
    if (exists(path.join(here, ".git"))) return here;
    const parent = path.dirname(here);
    if (parent === here) return origin;
    here = parent;
  }
}

/**
 * Nearest ancestor of the project that holds two or more git repos,
 * e.g. ~/workspace/eterna/nusa-llc containing Ventrixio-BE, Ventrixio-FE, …
 * @param {string} projectRoot
 * @returns {string | null}
 */
export function findWorkspaceRoot(projectRoot) {
  let candidate = path.dirname(path.resolve(projectRoot));
  const home = os.homedir();
  while (candidate !== home && candidate !== path.dirname(candidate)) {
    let repos = 0;
    try {
      for (const entry of fs.readdirSync(candidate, { withFileTypes: true })) {
        if (entry.isDirectory() && exists(path.join(candidate, entry.name, ".git"))) repos += 1;
      }
    } catch {
      // unreadable directory: keep walking up
    }
    if (repos >= 2) return candidate;
    candidate = path.dirname(candidate);
  }
  return null;
}

/** Paths inside one target project. */
export class ProjectPaths {
  /** @param {string} root */
  constructor(root) {
    this.root = path.resolve(root);
    this.claudeDir = path.join(this.root, ".claude");
    this.skillsDir = path.join(this.claudeDir, "skills");
    this.zerossDir = path.join(this.claudeDir, "zeross");
    this.config = path.join(this.zerossDir, "config.json");
    this.manifest = path.join(this.zerossDir, "manifest.json");
    this.localJson = path.join(this.zerossDir, "local.json");
    this.localDir = path.join(this.zerossDir, "local");
    this.rulesDir = path.join(this.zerossDir, "rules");
    this.settings = path.join(this.claudeDir, "settings.json");
    this.mcpJson = path.join(this.root, ".mcp.json");
    this.claudeMd = path.join(this.root, "CLAUDE.md");
    this.gitignore = path.join(this.root, ".gitignore");
  }

  /** @param {string} p */
  rel(p) {
    return path.relative(this.root, path.resolve(p)).split(path.sep).join("/");
  }

  /** @param {string} rel */
  abs(rel) {
    return path.join(this.root, ...rel.split("/"));
  }
}
