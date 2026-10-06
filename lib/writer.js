// lib/writer.js
// @ts-check
/**
 * Low-level, side-effect-safe file operations. Everything that touches a
 * user's file goes through here: atomic writes, marker-block merges for text
 * files, and add-only merges for JSON files.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** @typedef {[string, string]} Markers */

/** @type {Markers} */
export const MD_MARKERS = ["<!-- zeross:start -->", "<!-- zeross:end -->"];
/** @type {Markers} */
export const HASH_MARKERS = ["# >>> zeross >>>", "# <<< zeross <<<"];

/** @param {string | Buffer} data */
export const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

/** @param {string} file @returns {string | null} */
export function sha256File(file) {
  try {
    return sha256(fs.readFileSync(file));
  } catch {
    return null;
  }
}

/** @param {string} file @returns {string} */
export function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/**
 * Write via temp file + rename so a crash never leaves a half-written file.
 * Keeps the existing file mode unless `mode` is given.
 * @param {string} file
 * @param {string | Buffer} data
 * @param {number} [mode]
 */
export function atomicWrite(file, data, mode) {
  // Write through symlinks (e.g. CLAUDE.md -> AGENTS.md) instead of replacing them.
  try {
    if (fs.lstatSync(file).isSymbolicLink()) file = fs.realpathSync(file);
  } catch {
    // does not exist yet
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmp, data);
    if (mode !== undefined) fs.chmodSync(tmp, mode);
    else if (fs.existsSync(file)) fs.chmodSync(tmp, fs.statSync(file).mode & 0o777);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** @param {string} s */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class MarkerError extends Error {}

/**
 * Locate the zeross block. Markers only count when they sit alone on a line,
 * so a marker quoted inside user prose is never treated as ours. Unpaired or
 * repeated markers are refused rather than guessed at.
 * @param {string} text @param {Markers} markers
 * @returns {{ start: number, end: number } | null} span including both marker lines
 */
function findBlock(text, [start, end]) {
  const starts = [...text.matchAll(new RegExp(`^${escapeRe(start)}[ \\t]*$`, "gm"))];
  const ends = [...text.matchAll(new RegExp(`^${escapeRe(end)}[ \\t]*$`, "gm"))];
  if (!starts.length && !ends.length) return null;
  if (starts.length !== 1 || ends.length !== 1 || (ends[0].index ?? 0) < (starts[0].index ?? 0)) {
    throw new MarkerError(`unpaired or repeated zeross markers (${starts.length} start, ${ends.length} end); fix the file by hand`);
  }
  return { start: starts[0].index ?? 0, end: (ends[0].index ?? 0) + ends[0][0].length };
}

/**
 * Insert or replace the zeross-owned block; never touch text outside it.
 * @param {string} text
 * @param {string} block
 * @param {Markers} [markers]
 */
export function mergeMarkerBlock(text, block, markers = MD_MARKERS) {
  const body = `${markers[0]}\n${block.trim()}\n${markers[1]}`;
  const found = findBlock(text, markers);
  if (found) return text.slice(0, found.start) + body + text.slice(found.end);
  if (!text) return `${body}\n`;
  const sep = text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  return `${text}${sep}${body}\n`;
}

/**
 * @param {string} text
 * @param {Markers} [markers]
 */
export function removeMarkerBlock(text, markers = MD_MARKERS) {
  const found = findBlock(text, markers);
  if (!found) return text;
  const stripped = `${text.slice(0, found.start)}${text.slice(found.end)}`.replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
  return stripped ? `${stripped}\n` : "";
}

/** @param {unknown} v @returns {v is Record<string, any>} */
export const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Structural equality for JSON values. @param {unknown} a @param {unknown} b */
export function jsonEqual(a, b) {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

/** @param {any} v @returns {any} */
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isPlainObject(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

/**
 * Merge incoming into existing without removing or overriding anything.
 * Objects merge recursively; arrays gain items they lack; an existing scalar wins.
 * @param {any} existing
 * @param {any} incoming
 * @returns {any}
 */
export function jsonMergeAddOnly(existing, incoming) {
  if (isPlainObject(existing) && isPlainObject(incoming)) {
    const merged = { ...existing };
    for (const [key, value] of Object.entries(incoming)) {
      merged[key] = key in existing ? jsonMergeAddOnly(existing[key], value) : clone(value);
    }
    return merged;
  }
  if (Array.isArray(existing) && Array.isArray(incoming)) {
    const merged = [...existing];
    for (const item of incoming) if (!merged.some((m) => jsonEqual(m, item))) merged.push(clone(item));
    return merged;
  }
  return existing;
}

/** @template T @param {T} v @returns {T} */
export const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/**
 * @param {string} file
 * @param {any} [fallback]
 * @returns {any}
 */
export function readJson(file, fallback = null) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return fallback;
  }
  return JSON.parse(text);
}

/** @param {any} data */
export const dumpJson = (data) => `${JSON.stringify(data, null, 2)}\n`;

/**
 * @param {string} file
 * @param {any} data
 * @param {number} [mode]
 */
export function writeJson(file, data, mode) {
  atomicWrite(file, dumpJson(data), mode);
}

/**
 * Resolve `rel` under `root` and refuse anything that escapes it, including
 * through an existing symlink. Guards every path that comes from committed
 * files (manifest keys, config scopes), which a malicious repo could craft.
 * @param {string} root @param {string} rel
 * @returns {string} absolute path inside root
 */
export function insideRoot(root, rel) {
  if (typeof rel !== "string" || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..") || rel.includes("\0")) {
    throw new Error(`refusing path outside the project: ${JSON.stringify(rel)}`);
  }
  const realRoot = fs.realpathSync(root);
  const target = path.resolve(realRoot, rel);
  let probe = target;
  while (!fs.existsSync(probe) && probe !== realRoot) probe = path.dirname(probe);
  const realProbe = fs.realpathSync(probe);
  if (realProbe !== realRoot && !realProbe.startsWith(realRoot + path.sep)) {
    throw new Error(`refusing path outside the project: ${JSON.stringify(rel)}`);
  }
  return target;
}
