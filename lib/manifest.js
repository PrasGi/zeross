// lib/manifest.js
// @ts-check
/**
 * Manifest of zeross-managed files and the no-overwrite write policy.
 *
 * The manifest (`.claude/zeross/manifest.json`, committed) records the hash of
 * every file zeross wrote. That separates "still exactly what we wrote" (safe
 * to update) from "edited by a person" (never touch) and from "someone else's
 * file with the same name" (conflict, skip).
 */

import fs from "node:fs";
import path from "node:path";

import { ProjectPaths, version } from "./paths.js";
import { atomicWrite, insideRoot, readJson, sha256, sha256File, writeJson } from "./writer.js";

export const CREATE = "create";
export const UPDATE = "update";
export const UNCHANGED = "unchanged";
export const ADOPT = "adopt";
export const MODIFIED = "modified";
export const CONFLICT = "conflict";
export const DELETED = "deleted-by-user";
export const SIDECAR_SUFFIX = ".zeross-new";

const WRITES = new Set([CREATE, UPDATE]);

/**
 * @typedef {{ rel: string, action: string, data: string | Buffer, mode?: number, reason?: string }} FileOp
 * @typedef {{ sha256: string, templateVersion: string }} FileRecord
 */

/** @param {FileOp} op */
export function opToJson(op) {
  /** @type {Record<string, string>} */
  const out = { path: op.rel, action: op.action };
  if (op.reason) out.reason = op.reason;
  if (op.action === MODIFIED) out.sidecar = op.rel + SIDECAR_SUFFIX;
  return out;
}

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const OWNED = /^\.claude\/(skills\/zero-[a-z0-9-]+|zeross|rules\/zeross)\/[A-Za-z0-9._\/-]+$/;

/** Paths zeross may create, update or delete. @param {string} rel */
export function isOwnedPath(rel) {
  return OWNED.test(rel) && !rel.split("/").some((part) => part === ".." || part === "." || part === "")
    && !rel.startsWith(".claude/zeross/local/") && rel !== ".claude/zeross/local.json";
}

export class Manifest {
  /** @param {ProjectPaths} paths */
  constructor(paths) {
    this.paths = paths;
    const data = readJson(paths.manifest, null);
    this.exists = Boolean(data);
    /** @type {{ schemaVersion: number, zerossVersion?: string, installedAt?: string, updatedAt?: string, files: Record<string, FileRecord> }} */
    this.data = { schemaVersion: 1, files: {}, ...(data || {}) };
    // The manifest is committed, so its keys are untrusted input: only paths
    // zeross itself can own are honoured. Anything else is dropped, never
    // updated or deleted.
    /** @type {string[]} */
    this.ignored = [];
    const files = typeof this.data.files === "object" && this.data.files !== null ? this.data.files : {};
    this.data.files = {};
    for (const [rel, record] of Object.entries(files)) {
      if (isOwnedPath(rel) && record && typeof record.sha256 === "string") this.data.files[rel] = record;
      else this.ignored.push(rel);
    }
  }

  get files() {
    return this.data.files;
  }

  get version() {
    return this.data.zerossVersion ?? null;
  }

  /**
   * Decide what to do with one file, without touching disk.
   * @param {string} rel
   * @param {string | Buffer} data
   * @param {number} [mode]
   * @returns {FileOp}
   */
  planFile(rel, data, mode) {
    const current = sha256File(insideRoot(this.paths.root, rel));
    const next = sha256(data);
    const record = this.files[rel];
    if (current === null) {
      return record
        ? { rel, action: DELETED, data, mode, reason: "tracked file was deleted; not recreated" }
        : { rel, action: CREATE, data, mode };
    }
    if (record) {
      if (current === record.sha256) return { rel, action: current === next ? UNCHANGED : UPDATE, data, mode };
      if (current === next) return { rel, action: ADOPT, data, mode, reason: "local edit matches the new template" };
      return { rel, action: MODIFIED, data, mode, reason: "edited locally; new version written beside it" };
    }
    if (current === next) return { rel, action: ADOPT, data, mode, reason: "identical file already present" };
    return { rel, action: CONFLICT, data, mode, reason: "file exists and is not managed by zeross" };
  }

  /** @param {FileOp[]} ops */
  apply(ops) {
    const templateVersion = version();
    for (const op of ops) {
      const target = insideRoot(this.paths.root, op.rel);
      if (WRITES.has(op.action)) {
        atomicWrite(target, op.data, op.mode);
        this.record(op.rel, op.data, templateVersion);
      } else if (op.action === ADOPT) {
        this.record(op.rel, op.data, templateVersion);
      } else if (op.action === MODIFIED) {
        atomicWrite(target + SIDECAR_SUFFIX, op.data, op.mode);
      }
    }
  }

  /** @param {string} rel @param {string | Buffer} data @param {string} templateVersion */
  record(rel, data, templateVersion) {
    this.files[rel] = { sha256: sha256(data), templateVersion };
  }

  /** @param {string} rel */
  forget(rel) {
    delete this.files[rel];
  }

  save() {
    const stamp = now();
    this.data.installedAt ??= stamp;
    this.data.updatedAt = stamp;
    this.data.zerossVersion = version();
    this.data.files = Object.fromEntries(Object.entries(this.files).sort(([a], [b]) => a.localeCompare(b)));
    writeJson(this.paths.manifest, this.data);
    this.exists = true;
  }

  /** @param {string} rel */
  isModified(rel) {
    const record = this.files[rel];
    const current = sha256File(insideRoot(this.paths.root, rel));
    return Boolean(record) && current !== null && current !== record.sha256;
  }

  /** Split tracked files into [safe to delete, keep because edited or gone]. */
  removable() {
    /** @type {string[]} */ const safe = [];
    /** @type {string[]} */ const keep = [];
    for (const [rel, record] of Object.entries(this.files)) {
      (sha256File(insideRoot(this.paths.root, rel)) === record.sha256 ? safe : keep).push(rel);
    }
    return { safe, keep };
  }
}

/**
 * Remove empty directories from `start` up to (not including) `root`.
 * @param {string} root
 * @param {string} start
 */
export function pruneEmptyDirs(root, start) {
  // Compare real paths: on macOS a temp root under /var is really /private/var.
  const real = (/** @type {string} */ p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  let current = real(start);
  const stop = real(root);
  while (current !== stop && current.startsWith(stop + path.sep)) {
    try {
      if (fs.readdirSync(current).length) return;
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}
