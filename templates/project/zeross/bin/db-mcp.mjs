#!/usr/bin/env node
// .claude/zeross/bin/db-mcp.mjs
// @ts-check
/*
 * zeross DB MCP wrapper (committed; contains no secrets).
 *
 * Reads the database URL by *parsing* (never sourcing) the env file named in
 * .claude/zeross/config.json → db.envFile / db.envVar, decides whether the
 * session may write, then starts the pinned MCP server:
 *     postgres / mysql → @bytebase/dbhub   (read-only via a private TOML config)
 *     mongodb          → mongodb-mcp-server (read-only via MDB_MCP_READ_ONLY)
 *
 * Write policy (see .claude/zeross/workflow/data-safety.md):
 *     local hosts (localhost, 127.0.0.1, *.local, docker-compose services) and
 *     config db.devHosts → writable; any other host → read-only unless
 *     .claude/zeross/local.json → dbGrants[<host>] holds a valid grant.
 *
 * The URL travels only through the environment or a 0600 temp file that is
 * removed when the server exits. It is never printed.
 *
 *     --dry-run   print the decision as JSON (no URL) and exit
 *
 * Node >= 22, `node:` builtins only.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The script lives at <root>/.claude/zeross/bin/.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ZEROSS = path.join(ROOT, ".claude", "zeross");
const DEFAULT_PINS = { dbhub: "@bytebase/dbhub@1.4.0", mongodb: "mongodb-mcp-server@3.0.5" };
const FALLBACK_ENV_FILES = [".env.local", ".env", "apps/api/.env", "backend/.env", "server/.env"];
const FALLBACK_VARS = ["DATABASE_URL", "DATABASE_URI", "MONGODB_URI", "MONGO_URI", "MONGO_URL", "MYSQL_URL", "POSTGRES_URL"];
/** @type {Record<string, string>} */
const SCHEMES = {
  postgres: "postgres",
  postgresql: "postgres",
  mysql: "mysql",
  mariadb: "mysql",
  mongodb: "mongodb",
  "mongodb+srv": "mongodb",
};
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"]);
const PRISMA_PARAMS = new Set(["schema", "connection_limit", "pool_timeout", "pgbouncer", "socket_timeout", "statement_cache_size"]);

/** A fatal, user-facing error: printed as `db-mcp: <message>`, exit 1. */
export class DieError extends Error {}

/**
 * @param {string} msg
 * @returns {never}
 */
function die(msg) {
  throw new DieError(msg);
}

/**
 * @param {unknown} value
 * @returns {Record<string, any>}
 */
const asObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? /** @type {any} */ (value) : {});

/**
 * @param {string} file
 * @returns {Record<string, any>}
 */
function readJson(file) {
  try {
    return asObject(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return {};
  }
}

/** @param {string} file */
function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** @param {string} s */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Last assignment of `name` in an env file, quotes and trailing comments stripped.
 * The file is parsed as text, never sourced or executed.
 * @param {string} file
 * @param {string} name
 * @returns {string}
 */
export function readVar(file, name) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(name)}\\s*=\\s*(.*)$`);
  let value = "";
  for (const line of text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/)) {
    const m = pattern.exec(line);
    if (!m) continue;
    let raw = m[1].trim();
    const quoted = /^(["'])(.*?)\1(\s+#.*)?$/.exec(raw);
    if (quoted) {
      raw = quoted[2]; // KEY="value" or KEY="value" # comment
    } else {
      raw = raw.replace(/\s+#.*$/, "");
    }
    value = raw;
  }
  return value;
}

/**
 * Find the database URL: config's envFile/envVar, else the usual suspects.
 * @param {Record<string, any>} db  config.json → db
 * @param {string} [root]
 * @returns {[envFile: string, envVar: string, url: string]}
 */
export function locateUrl(db, root = ROOT) {
  const files = db.envFile ? [String(db.envFile)] : FALLBACK_ENV_FILES;
  const names = db.envVar ? [String(db.envVar)] : FALLBACK_VARS;
  for (const rel of files) {
    const file = path.join(root, rel);
    if (!isFile(file)) continue;
    for (const name of names) {
      const value = readVar(file, name);
      if (value) return [rel, name, value];
    }
  }
  return die(`no ${names.join("/")} found in ${files.join(", ")} (set db.envFile / db.envVar in config.json)`);
}

/**
 * Lower-cased hosts of a connection URL (several for mongodb replica-set URLs).
 * @param {string} url
 * @returns {string[]}
 */
export function hostsOf(url) {
  const at = url.indexOf("://");
  if (at === -1) return [];
  const afterScheme = url.slice(at + 3);
  let netloc = afterScheme.split("/")[0].split("?")[0];
  netloc = netloc.slice(netloc.lastIndexOf("@") + 1);
  /** @type {string[]} */
  const hosts = [];
  for (let part of netloc.split(",")) {
    part = part.trim();
    if (part.startsWith("[")) hosts.push(part.slice(1).split("]")[0].toLowerCase());
    else hosts.push(part.split(":")[0].toLowerCase());
  }
  // libpq / pg-connection-string / Prisma let `?host=` and `?hostaddr=` override
  // (or supply) the host, including unix-socket directories. Count them too.
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  for (const pair of query.split("&")) {
    const [key, value = ""] = pair.split("=");
    if (key === "host" || key === "hostaddr" || key === "socket") {
      let decoded = value;
      try {
        decoded = decodeURIComponent(value);
      } catch {
        // keep raw
      }
      for (const h of decoded.split(",")) if (h) hosts.push(h.toLowerCase());
    }
  }
  return hosts.filter(Boolean);
}

/** A unix-socket path counts as local only in the usual local socket dirs. @param {string} h */
const isLocalSocket = (h) => /^\/(tmp|var\/run|run|private\/tmp)(\/|$)/.test(h);

/**
 * Service names from docker-compose / compose files in the project root.
 * @param {string} [root]
 * @returns {Set<string>}
 */
export function composeServices(root = ROOT) {
  /** @type {Set<string>} */
  const names = new Set();
  let entries;
  try {
    entries = fs.readdirSync(root).sort();
  } catch {
    return names;
  }
  for (const name of entries) {
    if (!/^(docker-)?compose.*\.y.*ml$/.test(name) || !isFile(path.join(root, name))) continue;
    const text = fs.readFileSync(path.join(root, name), "utf8").replace(/\r\n?/g, "\n");
    const block = /^services:\s*\n((?:[ \t]+.*\n?|\s*\n)*)/m.exec(text);
    if (!block) continue;
    for (const m of block[1].matchAll(/^[ \t]{2}([A-Za-z0-9_.-]+):/gm)) names.add(m[1].toLowerCase());
  }
  return names;
}

/**
 * local | dev | production | remote.
 * @param {string[]} hosts
 * @param {string} envFile
 * @param {string[]} devHosts
 * @param {string} [root]
 * @returns {string}
 */
export function classify(hosts, envFile, devHosts, root = ROOT) {
  // Production signals win over everything: a prod env file pointing at
  // localhost is usually an SSH tunnel or a cloud-sql proxy.
  if (path.basename(envFile).toLowerCase().includes("prod") || hosts.some((h) => h.includes("prod"))) return "production";
  // No host at all (e.g. `postgres://u:p@/db`) is not provably local.
  if (!hosts.length) return "remote";
  const dev = new Set([...devHosts.map((h) => String(h).toLowerCase()), ...composeServices(root)]);
  const local = (/** @type {string} */ h) => LOCAL_HOSTS.has(h) || h.endsWith(".local") || h.endsWith(".localhost") || isLocalSocket(h);
  if (hosts.every(local)) return "local";
  if (hosts.every((h) => dev.has(h) || local(h))) return "dev";
  return "remote";
}

// ISO 8601 with an explicit offset; an un-zoned expiry is ambiguous and never counts as valid.
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * The write grant covering every host, or null. Expired or malformed grants do not count.
 * @param {string[]} hosts
 * @param {string} [zerossDir]
 * @returns {Record<string, any> | null}
 */
export function activeGrant(hosts, zerossDir = ZEROSS) {
  const grants = asObject(readJson(path.join(zerossDir, "local.json")).dbGrants);
  const now = Date.now();
  for (const host of hosts) {
    const grant = Object.hasOwn(grants, host) ? grants[host] : null;
    if (!grant || typeof grant !== "object" || Array.isArray(grant)) return null;
    // Only explicit grants count: persistent, or session with a future expiry.
    if (grant.scope !== "persistent" && grant.scope !== "session") return null;
    const expires = grant.expiresAt;
    if (grant.scope === "session" && !expires) return null;
    if (expires) {
      if (typeof expires !== "string" || !ISO_WITH_OFFSET.test(expires)) return null;
      const at = Date.parse(expires.replace(" ", "T"));
      if (Number.isNaN(at) || at < now) return null;
    }
  }
  return hosts.length ? (grants[hosts[0]] ?? null) : null;
}

/**
 * Drop Prisma-only query params that real drivers reject.
 * @param {string} url
 * @returns {string}
 */
export function stripPrismaParams(url) {
  const q = url.indexOf("?");
  if (q === -1) return url;
  const base = url.slice(0, q);
  const kept = url
    .slice(q + 1)
    .split("&")
    .filter((p) => p && !PRISMA_PARAMS.has(p.split("=")[0]));
  return base + (kept.length ? "?" + kept.join("&") : "");
}

/**
 * TOML basic string.
 * @param {string} value
 * @returns {string}
 */
export function tomlStr(value) {
  return '"' + value.replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"';
}

/**
 * Run a child with inherited stdio, forwarding termination signals; resolves to its exit code.
 * @param {string} cmd
 * @param {string[]} args
 * @param {import("node:child_process").SpawnOptions} options
 * @param {() => void} [cleanup]
 * @returns {Promise<number>}
 */
function runChild(cmd, args, options, cleanup = () => {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...options, stdio: "inherit" });
    /** @type {Array<[NodeJS.Signals, () => void]>} */
    const forwards = ["SIGTERM", "SIGINT", "SIGHUP"].map((sig) => {
      const handler = () => {
        child.kill(/** @type {NodeJS.Signals} */ (sig));
      };
      process.on(/** @type {NodeJS.Signals} */ (sig), handler);
      return [/** @type {NodeJS.Signals} */ (sig), handler];
    });
    process.once("exit", cleanup); // last resort if we die before the child does
    let done = false;
    /** @param {number} code */
    const finish = (code) => {
      if (done) return;
      done = true;
      for (const [sig, handler] of forwards) process.off(sig, handler);
      process.off("exit", cleanup);
      cleanup();
      resolve(code);
    };
    child.once("error", (err) => {
      process.stderr.write(`db-mcp: cannot start ${cmd}: ${err.message}\n`);
      finish(1);
    });
    child.once("close", (code, signal) => {
      finish(code ?? 128 + (signal ? os.constants.signals[signal] : 0));
    });
  });
}

/**
 * Start dbhub with a private, 0600 TOML config holding the DSN.
 * @param {string} pin
 * @param {string} url
 * @param {boolean} writable
 * @returns {Promise<number>}
 */
/**
 * Remove DSN temp dirs left behind by a wrapper that was SIGKILLed. dbhub reads
 * its TOML only at startup, so anything older than a few hours is dead weight
 * holding a connection string on disk.
 * @param {string} runRoot
 */
export function sweepStale(runRoot, maxAgeMs = 6 * 3600 * 1000) {
  let entries = [];
  try {
    entries = fs.readdirSync(runRoot);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith("dbhub-")) continue;
    const dir = path.join(runRoot, name);
    try {
      if (Date.now() - fs.statSync(dir).mtimeMs > maxAgeMs) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // raced with another wrapper; ignore
    }
  }
}

function runDbhub(pin, url, writable) {
  const runRoot = path.join(ZEROSS, "local", "run");
  fs.mkdirSync(runRoot, { recursive: true });
  sweepStale(runRoot);
  const workdir = fs.mkdtempSync(path.join(runRoot, "dbhub-"));
  fs.chmodSync(workdir, 0o700);
  const config = path.join(workdir, "dbhub.toml");
  fs.writeFileSync(
    config,
    '[[sources]]\nid = "default"\n' +
      `dsn = ${tomlStr(url)}\n\n` +
      '[[tools]]\nname = "execute_sql"\nsource = "default"\n' +
      `readonly = ${writable ? "false" : "true"}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  fs.chmodSync(config, 0o600);
  const cleanup = () => fs.rmSync(workdir, { recursive: true, force: true });
  // cwd = the private temp dir, so dbhub cannot pick up the project's own .env.
  return runChild("npx", ["-y", pin, "--transport", "stdio", "--config", config], { cwd: workdir }, cleanup);
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const config = readJson(path.join(ZEROSS, "config.json"));
  const db = asObject(config.db);
  if (db.enabled === false) die("db is disabled in .claude/zeross/config.json");
  const pins = { ...DEFAULT_PINS, ...asObject(asObject(config.mcp).pins) };
  const [envFile, envVar, url] = locateUrl(db);
  const scheme = url.includes("://") ? url.slice(0, url.indexOf("://")).toLowerCase() : "";
  const engine = Object.hasOwn(SCHEMES, scheme) ? SCHEMES[scheme] : undefined;
  if (!engine) die(`unsupported URL scheme '${scheme}' in ${envVar} (${envFile})`);
  const hosts = hostsOf(url);
  const hostClass = classify(hosts, envFile, Array.isArray(db.devHosts) ? db.devHosts : []);
  const isLocal = hostClass === "local" || hostClass === "dev";
  const grant = isLocal ? null : activeGrant(hosts);
  const writable = isLocal || grant !== null;
  const reason = isLocal
    ? `${hostClass} host`
    : grant
      ? `granted (${grant.scope ?? "persistent"})`
      : `${hostClass} host without grant → read-only`;
  const server = engine === "mongodb" ? pins.mongodb : pins.dbhub;

  if (argv.includes("--dry-run")) {
    process.stdout.write(JSON.stringify({ engine, server, envFile, envVar, hosts, hostClass, writable, reason }) + "\n");
    return 0;
  }
  process.stderr.write(
    `db-mcp: engine=${engine} hosts=${hosts.join(",")} class=${hostClass} ` +
      `mode=${writable ? "read-write" : "read-only"} (${reason})\n`,
  );

  if (engine === "mongodb") {
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env, MDB_MCP_CONNECTION_STRING: url, MDB_MCP_TELEMETRY: "disabled" };
    if (!writable) env.MDB_MCP_READ_ONLY = "true";
    // Neutral cwd: no project .env leaks into the server.
    return runChild("npx", ["-y", server], { cwd: os.homedir(), env });
  }
  return runDbhub(server, stripPrismaParams(url), writable);
}

function isMain() {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(err instanceof DieError ? `db-mcp: ${err.message}\n` : `db-mcp: ${err?.stack ?? err}\n`);
      process.exitCode = 1;
    },
  );
}
