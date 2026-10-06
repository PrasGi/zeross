// lib/cli.js
// @ts-check
/** zeross command line. Every subcommand supports --json for skills to parse. */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { runDetect } from "./detect.js";
import { runDoctor } from "./doctor.js";
import {
  applyPlan, installGlobal, projectStatus, refreshStaleGlobal, uninstallGlobal, uninstallProject,
} from "./installer.js";
import { Manifest } from "./manifest.js";
import * as mcp from "./mcp.js";
import { ProjectPaths, findProjectRoot, findWorkspaceRoot, profilePath, version } from "./paths.js";
import * as secrets from "./secrets.js";
import * as update from "./update.js";
import { readJson, sha256File, writeJson } from "./writer.js";

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;

const USAGE = `zeross <version> — team-standard Claude Code workflow toolkit

Usage: zeross <command> [options]   (every command accepts --json and --project <dir>)

  install [--with-indonesia]                 install the global /zeross skill
  uninstall [--project-scope] [--purge] [--dry-run]
  doctor | status | detect                   device/session checks, install state, project scan
  apply --plan <file> [--dry-run]            apply an install plan written by /zeross
  verify [--no-mcp]                          verify files, hooks and MCP connections
  mcp check|test|add <github|jira|db|playwright|context7> [...]
  secret set|get-ref <service> | secret reveal zeross-test-<…> | secret envrc --dir <d> --export VAR=keychain:<service> [--allow]
  update check [--force] | update diff | update apply [--bump-pins]
  profile get [key] | profile set key=<json> ...
  local get [key]   | local set key=<json> ...`;

/** @typedef {Record<string, any>} Opts */

/** @param {any} data @param {boolean} asJson */
function emit(data, asJson) {
  process.stdout.write(`${asJson ? JSON.stringify(data) : JSON.stringify(data, null, 2)}\n`);
}

/** @param {Opts} o */
const projectRoot = (o) => findProjectRoot(o.project ? path.resolve(o.project) : undefined);

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** `a.b[host.with.dots].c` → ["a", "b", "host.with.dots", "c"]. @param {string} key */
export function splitKey(key) {
  const parts = [...key.matchAll(/\[([^\]]+)\]|([^.[\]]+)/g)].map((m) => m[1] ?? m[2]);
  if (!parts.length || parts.some((p) => FORBIDDEN_KEYS.has(p))) throw new Error(`invalid key: ${JSON.stringify(key)}`);
  return parts;
}

/** @param {string} raw */
function parseValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** @param {Record<string, any>} data @param {string} key @param {any} value */
function setDotted(data, key, value) {
  const parts = splitKey(key);
  let node = data;
  for (const part of parts.slice(0, -1)) {
    if (typeof node[part] !== "object" || node[part] === null || Array.isArray(node[part])) node[part] = {};
    node = node[part];
  }
  node[parts[parts.length - 1]] = value;
}

/** @param {any} data @param {string | undefined} key */
function getDotted(data, key) {
  if (!key) return data;
  let node = data;
  for (const part of splitKey(key)) {
    if (typeof node !== "object" || node === null || !Object.hasOwn(node, part)) return null;
    node = node[part];
  }
  return node;
}

// ---------------------------------------------------------------------------
// handlers

/** @param {Opts} o */
function cmdInstall(o) {
  const results = installGlobal(o["with-indonesia"] ? ["zero-indonesia"] : []);
  const ok = results.every((r) => r.action !== "conflict");
  if (o.json) emit({ ok, version: version(), results }, true);
  else {
    for (const r of results) {
      const where = r.path ?? (r.paths ?? []).join(", ");
      process.stdout.write(`[${r.action}] ${r.skill}: ${where}${r.reason ? ` (${r.reason})` : ""}\n`);
    }
    if (ok) process.stdout.write(`\nzeross ${version()} installed. Open Claude Code in a project and run /zeross.\n`);
  }
  return ok ? EXIT_OK : EXIT_FAIL;
}

/** @param {Opts} o */
function cmdUninstall(o) {
  const result = o["project-scope"]
    ? uninstallProject(projectRoot(o), { purge: Boolean(o.purge), dryRun: Boolean(o["dry-run"]) })
    : { global: uninstallGlobal(Boolean(o.purge)) };
  emit(result, o.json);
  return EXIT_OK;
}

/** @param {Opts} o */
function cmdApply(o) {
  if (!o.plan) {
    emit({ ok: false, error: "--plan <file> is required" }, o.json);
    return EXIT_USAGE;
  }
  try {
    const plan = JSON.parse(fs.readFileSync(o.plan, "utf8"));
    emit({ ok: true, ...applyPlan(projectRoot(o), plan, { dryRun: Boolean(o["dry-run"]) }) }, o.json);
    return EXIT_OK;
  } catch (err) {
    emit({ ok: false, error: /** @type {Error} */ (err).message }, o.json);
    return EXIT_USAGE;
  }
}

/** @param {Opts} o */
function cmdVerify(o) {
  const root = projectRoot(o);
  const paths = new ProjectPaths(root);
  const manifest = new Manifest(paths);
  const tracked = Object.entries(manifest.files);
  const missing = tracked.filter(([rel]) => !fs.existsSync(paths.abs(rel))).map(([rel]) => rel);
  const modified = tracked.filter(([rel, rec]) => fs.existsSync(paths.abs(rel)) && sha256File(paths.abs(rel)) !== rec.sha256)
    .map(([rel]) => rel);
  const notExecutable = tracked.filter(([rel]) => rel.includes("/bin/") && fs.existsSync(paths.abs(rel))
    && !(fs.statSync(paths.abs(rel)).mode & 0o111)).map(([rel]) => rel);
  /** @type {Record<string, any>} */
  const checks = {
    manifest: manifest.exists,
    missingFiles: missing,
    modifiedFiles: modified,
    notExecutable,
    configPresent: fs.existsSync(paths.config),
    rulesInstalled: fs.existsSync(path.join(root, ".claude", "rules", "zeross", "zeross.md")),
    guardHook: JSON.stringify(readJson(paths.settings, {}) ?? {}).includes("zeross-guard.mjs"),
  };
  if (!o["no-mcp"]) {
    const roles = readJson(profilePath(), {})?.mcpRoles ?? {};
    checks.mcp = Object.fromEntries(mcp.ROLES.filter((r) => r in roles).map((r) => [r, mcp.serverStatus(mcp.roleName(r), root)]));
  }
  const ok = checks.manifest && !missing.length && !notExecutable.length && checks.configPresent && checks.rulesInstalled
    && Object.values(checks.mcp ?? {}).every((v) => v.connected);
  emit({ ok, ...checks }, o.json);
  return ok ? EXIT_OK : EXIT_FAIL;
}

/** @param {string[]} args @param {Opts} o */
async function cmdMcp(args, o) {
  const [sub, role] = args;
  if (!["check", "test", "add"].includes(sub) || !mcp.ROLES.includes(role)) {
    emit({ ok: false, error: "usage: zeross mcp check|test|add <github|jira|db|playwright|context7>" }, o.json);
    return EXIT_USAGE;
  }
  const root = projectRoot(o);
  if (sub === "check") {
    emit(mcp.checkRole(role, root), o.json);
    return EXIT_OK;
  }
  if (sub === "test") {
    const result = await mcp.testRole(role, root, { repo: o.repo ?? null, checkClaude: !o["no-claude"] });
    emit(result, o.json);
    return result.ok ? EXIT_OK : EXIT_FAIL;
  }
  if (role === "context7") {
    try {
      emit({ ok: true, ...mcp.addContext7({ projectRoot: root, dryRun: Boolean(o["dry-run"]) }) }, o.json);
      return EXIT_OK;
    } catch (err) {
      emit({ ok: false, error: /** @type {Error} */ (err).message }, o.json);
      return EXIT_FAIL;
    }
  }
  if (role !== "github" && role !== "jira") {
    emit({ ok: false, error: "db and playwright are added by `zeross apply` via .mcp.json" }, o.json);
    return EXIT_USAGE;
  }
  const scope = o.scope ?? "user";
  const wsRoot = o["workspace-root"] ? path.resolve(o["workspace-root"])
    : scope === "user" ? findWorkspaceRoot(root) ?? root : root;
  const wsName = o["workspace-name"] ?? path.basename(wsRoot);
  /** @type {Record<string, any>} */
  const spec = { service: secrets.serviceName(role, wsName) };
  if (role === "github") spec.toolsets = o.toolsets ?? "default";
  else {
    if (!o["jira-url"] || !o["jira-username"]) {
      emit({ ok: false, error: "--jira-url and --jira-username are required" }, o.json);
      return EXIT_USAGE;
    }
    Object.assign(spec, { url: o["jira-url"], username: o["jira-username"], pin: mcp.DEFAULT_PINS.atlassian });
  }
  try {
    const result = mcp.addWorkspaceRole(role, { workspaceName: wsName, workspaceRoot: wsRoot, scope, projectRoot: root,
      spec, dryRun: Boolean(o["dry-run"]) });
    emit({ ok: true, keychainService: spec.service, ...result }, o.json);
    return EXIT_OK;
  } catch (err) {
    emit({ ok: false, error: /** @type {Error} */ (err).message }, o.json);
    return EXIT_FAIL;
  }
}

/** @param {string[]} args @param {Opts} o */
async function cmdSecret(args, o) {
  const [sub, service] = args;
  if (sub === "set" && service) {
    try {
      secrets.assertService(service);
      secrets.setSecret(service, await secrets.readSecretFromStdin(`Paste secret for ${service} (input hidden): `));
    } catch (err) {
      emit({ ok: false, error: /** @type {Error} */ (err).message }, o.json);
      return EXIT_FAIL;
    }
    emit({ ok: true, ref: `keychain:${service}` }, o.json);
    return EXIT_OK;
  }
  if (sub === "reveal" && service) {
    // Only test-account passwords, typed into a local dev login (browser.md).
    // The value lands in the tool result, so nothing else may be revealed.
    if (!/^zeross-test-[A-Za-z0-9._-]+$/.test(service)) {
      emit({ ok: false, error: "reveal is limited to zeross-test-* services (local test-account passwords)" }, o.json);
      return EXIT_USAGE;
    }
    let value = null;
    try {
      value = secrets.getSecret(service);
    } catch (err) {
      emit({ ok: false, error: /** @type {Error} */ (err).message }, o.json);
      return EXIT_USAGE;
    }
    if (value === null) {
      emit({ ok: false, error: `no keychain item ${service}` }, o.json);
      return EXIT_FAIL;
    }
    process.stdout.write(`${value}\n`);
    return EXIT_OK;
  }
  if (sub === "get-ref" && service) {
    let found;
    try {
      found = secrets.hasSecret(service);
    } catch (err) {
      emit({ ok: false, error: /** @type {Error} */ (err).message }, o.json);
      return EXIT_USAGE;
    }
    emit({ ok: found, ref: `keychain:${service}`, exists: found, backend: secrets.backend() }, o.json);
    return found ? EXIT_OK : EXIT_FAIL;
  }
  if (sub === "envrc" && o.dir) {
    /** @type {Record<string, string>} */
    const exports = {};
    for (const item of /** @type {string[]} */ (o.export ?? [])) {
      const i = item.indexOf("=");
      if (i < 1) {
        emit({ ok: false, error: `expected VAR=value, got ${JSON.stringify(item)}` }, o.json);
        return EXIT_USAGE;
      }
      exports[item.slice(0, i)] = item.slice(i + 1);
    }
    try {
      const file = secrets.writeEnvrcBlock(path.resolve(o.dir), exports);
      emit({ ok: true, path: file, direnvAllowed: o.allow ? secrets.direnvAllow(path.resolve(o.dir)) : false }, o.json);
      return EXIT_OK;
    } catch (err) {
      emit({ ok: false, error: /** @type {Error} */ (err).message }, o.json);
      return EXIT_USAGE;
    }
  }
  emit({ ok: false, error: "usage: zeross secret set|get-ref|reveal <service> | secret envrc --dir <d> --export VAR=ref" }, o.json);
  return EXIT_USAGE;
}

/** @param {string[]} args @param {Opts} o */
async function cmdUpdate(args, o) {
  try {
    if (args[0] === "check") emit(await update.check(Boolean(o.force)), o.json);
    else if (args[0] === "diff") emit(update.diff(projectRoot(o)), o.json);
    else if (args[0] === "apply") emit({ ok: true, ...update.apply(projectRoot(o), { bumpPins: Boolean(o["bump-pins"]) }) }, o.json);
    else {
      emit({ ok: false, error: "usage: zeross update check|diff|apply" }, o.json);
      return EXIT_USAGE;
    }
  } catch (err) {
    emit({ ok: false, error: /** @type {Error} */ (err).message }, o.json);
    return EXIT_FAIL;
  }
  return EXIT_OK;
}

/** @param {string} file @param {string[]} args @param {Opts} o */
function kvStore(file, args, o) {
  const [sub, ...rest] = args;
  const data = readJson(file, {}) ?? {};
  if (sub === "get") {
    try {
      emit(getDotted(data, rest[0]), o.json);
    } catch (err) {
      emit({ ok: false, error: /** @type {Error} */ (err).message }, o.json);
      return EXIT_USAGE;
    }
    return EXIT_OK;
  }
  if (sub !== "set" || !rest.length) {
    emit({ ok: false, error: "usage: get [key] | set key=<json> ..." }, o.json);
    return EXIT_USAGE;
  }
  for (const pair of rest) {
    const i = pair.indexOf("=");
    if (i < 1) {
      emit({ ok: false, error: `expected key=value, got ${JSON.stringify(pair)}` }, o.json);
      return EXIT_USAGE;
    }
    try {
      setDotted(data, pair.slice(0, i), parseValue(pair.slice(i + 1)));
    } catch (err) {
      emit({ ok: false, error: /** @type {Error} */ (err).message }, o.json);
      return EXIT_USAGE;
    }
  }
  writeJson(file, data, 0o600);
  emit({ ok: true, path: file }, o.json);
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// entry

const OPTIONS = /** @type {const} */ ({
  json: { type: "boolean" },
  project: { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  "with-indonesia": { type: "boolean" },
  "project-scope": { type: "boolean" },
  purge: { type: "boolean" },
  "dry-run": { type: "boolean" },
  plan: { type: "string" },
  "no-mcp": { type: "boolean" },
  repo: { type: "string" },
  "no-claude": { type: "boolean" },
  scope: { type: "string" },
  "workspace-name": { type: "string" },
  "workspace-root": { type: "string" },
  toolsets: { type: "string" },
  "jira-url": { type: "string" },
  "jira-username": { type: "string" },
  dir: { type: "string" },
  export: { type: "string", multiple: true },
  allow: { type: "boolean" },
  force: { type: "boolean" },
  "bump-pins": { type: "boolean" },
});

/** @param {string[]} [argv] @returns {Promise<number>} */
export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    process.stderr.write(`zeross: ${/** @type {Error} */ (err).message}\n`);
    return EXIT_USAGE;
  }
  const o = /** @type {Opts} */ (parsed.values);
  const [cmd, ...args] = parsed.positionals;
  if (o.version) {
    process.stdout.write(`zeross ${version()}\n`);
    return EXIT_OK;
  }
  if (!cmd || o.help) {
    process.stdout.write(`${USAGE.replace("<version>", version())}\n`);
    return cmd || o.help ? EXIT_OK : EXIT_USAGE;
  }
  if (cmd !== "install" && cmd !== "uninstall") {
    try {
      refreshStaleGlobal();
    } catch {
      // a stale-skill refresh must never block the actual command
    }
  }
  switch (cmd) {
    case "install": return cmdInstall(o);
    case "uninstall": return cmdUninstall(o);
    case "doctor": emit(runDoctor(projectRoot(o)), o.json); return EXIT_OK;
    case "status": emit(projectStatus(projectRoot(o)), o.json); return EXIT_OK;
    case "detect": emit(runDetect(projectRoot(o)), o.json); return EXIT_OK;
    case "apply": return cmdApply(o);
    case "verify": return cmdVerify(o);
    case "mcp": return cmdMcp(args, o);
    case "secret": return cmdSecret(args, o);
    case "update": return cmdUpdate(args, o);
    case "profile": return kvStore(profilePath(), args, o);
    case "local": return kvStore(new ProjectPaths(projectRoot(o)).localJson, args, o);
    default:
      process.stderr.write(`zeross: unknown command '${cmd}'\n${USAGE.replace("<version>", version())}\n`);
      return EXIT_USAGE;
  }
}
