// lib/mcp.js
// @ts-check
/**
 * MCP server checks, registration and connection tests.
 *
 * Roles: github, jira (workspace-scoped, user or local scope), db and
 * playwright (project-scoped via the committed .mcp.json). Skills refer to
 * roles; the actual server name per role is kept in
 * ~/.claude/zeross/profile.json → mcpRoles.
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { which } from "./doctor.js";
import { TEMPLATES_DIR, profilePath, userBinDir, workspacesPath } from "./paths.js";
import { jsonMergeAddOnly, readJson, writeJson } from "./writer.js";

export const ROLES = ["github", "jira", "db", "playwright", "context7"];
/** @type {Record<string, string>} */
export const DEFAULT_NAMES = { github: "github-zeross", jira: "jira-zeross", db: "db", playwright: "playwright",
  context7: "context7" };
/** @type {Record<string, string>} */
export const DEFAULT_PINS = {
  playwright: "@playwright/mcp@0.0.83",
  dbhub: "@bytebase/dbhub@1.4.0",
  mongodb: "mongodb-mcp-server@3.0.5",
  atlassian: "mcp-atlassian==0.23.1",
  context7: "@upstash/context7-mcp@4.1.1",
};
/** @type {Record<string, string[]>} */
const EQUIVALENT_HINTS = {
  github: ["github"],
  jira: ["jira", "atlassian"],
  playwright: ["playwright"],
  db: ["dbhub", "mongodb-mcp-server", "mongodb", "postgres", "mysql", "db-mcp"],
  context7: ["context7"],
};
const WORKSPACE_WRAPPER = "workspace-mcp.mjs";

/**
 * @typedef {{ name: string, target: string, status: string, connected: boolean, pendingApproval: boolean }} McpServer
 */

/** @param {string[]} args @param {string} [cwd] */
function claude(args, cwd) {
  if (!which("claude")) throw new Error("`claude` CLI not found on PATH");
  return spawnSync("claude", args, { cwd, encoding: "utf8", timeout: 90_000 });
}

/**
 * Parse `claude mcp list` lines: `<name>: <target> - <status>`.
 * @param {string} output
 * @returns {McpServer[]}
 */
export function parseMcpList(output) {
  /** @type {McpServer[]} */
  const servers = [];
  for (const line of output.split("\n")) {
    if (!line.includes(": ") || !line.includes(" - ")) continue;
    const cut = line.lastIndexOf(" - ");
    const head = line.slice(0, cut);
    const status = line.slice(cut + 3).trim();
    const sep = head.indexOf(": ");
    servers.push({
      name: head.slice(0, sep).trim(),
      target: head.slice(sep + 2).trim(),
      status,
      connected: status.includes("Connected"),
      pendingApproval: status.includes("Pending"),
    });
  }
  return servers;
}

/** @param {string} cwd */
export const listServers = (cwd) => parseMcpList(claude(["mcp", "list"], cwd).stdout ?? "");

/** @param {string} name @param {string} cwd */
export function serverStatus(name, cwd) {
  const result = claude(["mcp", "get", name], cwd);
  const lines = `${result.stdout ?? ""}${result.stderr ?? ""}`.split("\n");
  const field = (/** @type {string} */ key) => {
    const line = lines.find((l) => l.trim().startsWith(`${key}:`));
    return line ? line.slice(line.indexOf(":") + 1).trim() : null;
  };
  const status = field("Status");
  return { name, exists: result.status === 0 && status !== null, status, scope: field("Scope"),
    connected: Boolean(status?.includes("Connected")) };
}

/** @param {string} role @param {McpServer[]} servers */
export function findEquivalents(role, servers) {
  const hints = EQUIVALENT_HINTS[role];
  return servers.filter((s) => hints.some((h) => `${s.name} ${s.target}`.toLowerCase().includes(h)));
}

// ---------------------------------------------------------------------------
// profile & workspace registry

/** @returns {Record<string, any>} */
export const loadProfile = () => readJson(profilePath(), {}) ?? {};

/** @param {Record<string, any>} profile */
export const saveProfile = (profile) => writeJson(profilePath(), profile, 0o600);

/** @param {string} role @param {string} serverName */
export function setRole(role, serverName) {
  const profile = loadProfile();
  profile.mcpRoles = { ...profile.mcpRoles, [role]: serverName };
  saveProfile(profile);
}

/** @param {string} role */
export const roleName = (role) => loadProfile().mcpRoles?.[role] ?? DEFAULT_NAMES[role];

export function loadWorkspaces() {
  const data = readJson(workspacesPath(), {}) ?? {};
  data.workspaces ??= [];
  return data;
}

/**
 * @param {string} name @param {string} root @param {string} role @param {Record<string, any>} spec
 */
export function upsertWorkspace(name, root, role, spec) {
  const data = loadWorkspaces();
  const resolved = path.resolve(root);
  let entry = data.workspaces.find((/** @type {any} */ w) => w.root === resolved);
  const action = entry ? "updated" : "created";
  if (!entry) {
    entry = { name, root: resolved };
    data.workspaces.push(entry);
  }
  entry[role] = { ...entry[role], ...spec };
  writeJson(workspacesPath(), data, 0o600);
  return { entry, action };
}

/** @param {string} root */
export const findWorkspace = (root) =>
  loadWorkspaces().workspaces.find((/** @type {any} */ w) => w.root === path.resolve(root)) ?? null;

/** Import the shipped wrapper so the CLI and the wrapper share resolution logic. */
async function wrapperModule() {
  return import(pathToFileURL(path.join(TEMPLATES_DIR, "user", "bin", WORKSPACE_WRAPPER)).href);
}

/** Copy user-scope wrappers into ~/.claude/zeross/bin (a zeross-owned directory). */
export function installUserBin() {
  const target = userBinDir();
  fs.mkdirSync(target, { recursive: true });
  const src = path.join(TEMPLATES_DIR, "user", "bin");
  return fs.readdirSync(src).filter((n) => n.endsWith(".mjs")).sort().map((name) => {
    const dest = path.join(target, name);
    fs.copyFileSync(path.join(src, name), dest);
    fs.chmodSync(dest, 0o755);
    return dest;
  });
}

// ---------------------------------------------------------------------------
// add

/**
 * Register github/jira for a workspace. Secrets must already be in the keychain.
 * One workspace serves one GitHub org and one Jira site: registering a
 * different owner/site on an existing workspace is reported as a warning.
 * @param {string} role
 * @param {{ workspaceName: string, workspaceRoot: string, scope: string, projectRoot: string,
 *   spec: Record<string, any>, dryRun?: boolean }} opts
 */
export function addWorkspaceRole(role, { workspaceName, workspaceRoot, scope, projectRoot, spec, dryRun = false }) {
  if (!["github", "jira"].includes(role)) throw new Error("only github and jira are workspace roles");
  if (!["user", "local"].includes(scope)) throw new Error("scope must be user or local");
  const name = DEFAULT_NAMES[role];
  const wrapper = path.join(userBinDir(), WORKSPACE_WRAPPER);
  const existingWs = findWorkspace(workspaceRoot);
  /** @type {string[]} */
  const warnings = [];
  const prev = existingWs?.[role] ?? {};
  if (role === "github" && prev.owner && spec.owner && prev.owner.toLowerCase() !== String(spec.owner).toLowerCase()) {
    warnings.push(`workspace ${existingWs.name} already serves GitHub org ${prev.owner}; this project belongs to ${spec.owner}. Use a separate workspace root for it.`);
  }
  if (role === "jira" && prev.url && spec.url && prev.url.replace(/\/+$/, "") !== String(spec.url).replace(/\/+$/, "")) {
    warnings.push(`workspace ${existingWs.name} already uses another Jira site; this project needs its own workspace root.`);
  }
  const plan = { role, name, scope, root: path.resolve(workspaceRoot), command: ["node", wrapper, role],
    workspace: { name: existingWs?.name ?? workspaceName, root: path.resolve(workspaceRoot),
      action: existingWs ? "updated" : "created" }, warnings };
  if (dryRun) return { ...plan, dryRun: true };
  installUserBin();
  upsertWorkspace(workspaceName, workspaceRoot, role, spec);
  const existing = serverStatus(name, projectRoot);
  if (!existing.exists) {
    const result = claude(["mcp", "add", "--scope", scope, name, "--", "node", wrapper, role], projectRoot);
    if (result.status !== 0) throw new Error(`claude mcp add failed: ${String(result.stderr).trim().slice(0, 300)}`);
  }
  setRole(role, name);
  return { ...plan, serverRegistered: !existing.exists, serverAlreadyExisted: existing.exists };
}

/**
 * Register the Context7 docs server once at user scope. The optional API key
 * lives in the keychain (`zeross-context7`) and is read by the wrapper.
 * @param {{ projectRoot: string, dryRun?: boolean }} opts
 */
export function addContext7({ projectRoot, dryRun = false }) {
  const name = DEFAULT_NAMES.context7;
  const wrapper = path.join(userBinDir(), "context7-mcp.mjs");
  const plan = { role: "context7", name, scope: "user", command: ["node", wrapper], keychainService: "zeross-context7" };
  if (dryRun) return { ...plan, dryRun: true };
  installUserBin();
  const existing = serverStatus(name, projectRoot);
  if (!existing.exists) {
    const result = claude(["mcp", "add", "--scope", "user", name, "--", "node", wrapper], projectRoot);
    if (result.status !== 0) throw new Error(`claude mcp add failed: ${String(result.stderr).trim().slice(0, 300)}`);
  }
  setRole("context7", name);
  return { ...plan, registered: !existing.exists, alreadyExisted: existing.exists };
}

/**
 * Entries zeross merges into the committed .mcp.json. Both point at committed
 * wrappers that read pins from config.json, so .mcp.json never changes on a pin bump.
 * @returns {Record<string, { command: string, args: string[] }>}
 */
export function projectMcpEntries() {
  return {
    db: { command: "node", args: ["${CLAUDE_PROJECT_DIR:-.}/.claude/zeross/bin/db-mcp.mjs"] },
    playwright: { command: "node", args: ["${CLAUDE_PROJECT_DIR:-.}/.claude/zeross/bin/playwright-mcp.mjs"] },
  };
}

/** @param {string} mcpJson @param {string[]} roles */
export function mergeProjectMcp(mcpJson, roles) {
  const current = readJson(mcpJson, {}) ?? {};
  const servers = current.mcpServers ?? {};
  const entries = projectMcpEntries();
  const added = roles.filter((r) => !(r in servers));
  const skipped = roles.filter((r) => r in servers);
  const data = jsonMergeAddOnly(current, { mcpServers: Object.fromEntries(added.map((r) => [r, entries[r]])) });
  return { data, added, skipped };
}

// ---------------------------------------------------------------------------
// tests

/**
 * @param {string} url @param {Record<string, string>} headers
 * @returns {Promise<[number, any]>}
 */
async function httpGet(url, headers) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "zeross", ...headers }, signal: AbortSignal.timeout(10_000) });
    let body = null;
    try {
      body = await res.json();
    } catch {
      // non-JSON body
    }
    return [res.status, body];
  } catch {
    return [0, null];
  }
}

const sha = (/** @type {string} */ v) => crypto.createHash("sha256").update(v).digest("hex");

/** Token kind from its prefix only; the value is never returned. @param {string} token */
export function tokenKind(token) {
  if (token.startsWith("github_pat_")) return "fine-grained";
  if (token.startsWith("ghp_")) return "classic";
  if (/^gh[ous]_/.test(token)) return "oauth";
  return "unknown";
}

/**
 * @param {string} role @param {string} projectRoot @param {string | null} [service] test this keychain item instead
 */
async function resolveWorkspace(role, projectRoot, service = null) {
  const wm = await wrapperModule();
  const ws = wm.pickWorkspace(wm.loadRegistry(workspacesPath()), role, path.resolve(projectRoot));
  if (!ws) return { error: `no ${role} workspace registered for this project` };
  const [env, missing, source] = wm.resolveEnvDetailed(ws, role);
  const tokenVar = role === "github" ? "GITHUB_PERSONAL_ACCESS_TOKEN" : "JIRA_API_TOKEN";
  if (service) {
    const value = wm.keychainGet(service);
    if (!value) return { error: `no keychain item ${service}`, workspace: ws.name };
    env[tokenVar] = value;
    source[tokenVar] = `keychain:${service}`;
  }
  const ambient = process.env[tokenVar];
  const envOverride = Boolean(ambient && env[tokenVar] && sha(ambient) !== sha(env[tokenVar]));
  const stillMissing = missing.filter((m) => !env[m]);
  return stillMissing.length ? { error: `missing ${stillMissing.join(", ")}`, workspace: ws.name }
    : { ws, env, source: source[tokenVar], envOverride };
}

/** @param {string} projectRoot */
const projectConfig = (projectRoot) => readJson(path.join(projectRoot, ".claude", "zeross", "config.json"), {}) ?? {};

/**
 * @param {string} projectRoot @param {string | null} repo default: config.tickets.github.repo
 * @param {{ service?: string | null }} [opts]
 */
export async function testGithub(projectRoot, repo, { service = null } = {}) {
  repo ||= projectConfig(projectRoot).tickets?.github?.repo ?? null;
  const r = await resolveWorkspace("github", projectRoot, service);
  if (!r.env) return { ok: false, ...r };
  const token = r.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
  const [status, user] = await httpGet("https://api.github.com/user", headers);
  /** @type {Record<string, any>} */
  const out = { workspace: r.ws.name, source: r.source, envOverride: r.envOverride, tokenKind: tokenKind(token),
    userStatus: status, login: status === 200 ? user?.login : null };
  if (repo) {
    const owner = repo.split("/")[0];
    const [rstatus, rdata] = await httpGet(`https://api.github.com/repos/${repo}`, headers);
    const [ostatus] = await httpGet(`https://api.github.com/orgs/${owner}`, headers);
    Object.assign(out, { repo, repoStatus: rstatus, orgStatus: ostatus,
      repoPermissions: rstatus === 200 ? rdata?.permissions : null });
    if (rstatus === 404 || rstatus === 403) {
      out.hint = out.tokenKind === "fine-grained"
        ? `Fine-grained token: its resource owner must be ${owner}, the repository must be selected, and an org owner may still need to approve it (status "Pending"). Check https://github.com/settings/personal-access-tokens and https://github.com/organizations/${owner}/settings/personal-access-token-requests`
        : `The token's account cannot see ${repo}: check repository access, org membership or SSO authorization for ${owner}.`;
    }
  }
  if (r.envOverride) out.envHint = "An environment variable holds a different GitHub token; the workspace keychain item is used. Remove the global export (e.g. in ~/.zshrc) to avoid confusion.";
  out.ok = status === 200 && (!repo || out.repoStatus === 200);
  return out;
}

/**
 * @param {string} projectRoot @param {{ service?: string | null }} [opts]
 */
export async function testJira(projectRoot, { service = null } = {}) {
  const r = await resolveWorkspace("jira", projectRoot, service);
  if (!r.env) return { ok: false, ...r };
  const base = r.env.JIRA_URL.replace(/\/+$/, "");
  const headers = { Authorization: `Basic ${Buffer.from(`${r.env.JIRA_USERNAME}:${r.env.JIRA_API_TOKEN}`).toString("base64")}`,
    Accept: "application/json" };
  const [status, me] = await httpGet(`${base}/rest/api/3/myself`, headers);
  const keys = /** @type {string[]} */ (projectConfig(projectRoot).tickets?.jira?.projectKeys ?? []);
  /** @type {Record<string, number>} */
  const projects = {};
  for (const key of keys) projects[key] = (await httpGet(`${base}/rest/api/3/project/${encodeURIComponent(key)}`, headers))[0];
  const missingKeys = keys.filter((k) => projects[k] !== 200);
  /** @type {Record<string, any>} */
  const out = { workspace: r.ws.name, source: r.source, envOverride: r.envOverride, status,
    account: status === 200 ? me?.displayName : null, projects,
    ok: status === 200 && missingKeys.length === 0 };
  if (status === 200 && missingKeys.length) {
    out.hint = `Logged in, but project(s) ${missingKeys.join(", ")} are not visible on this Jira site. The workspace may point at another site, or the account lacks access.`;
  }
  if (r.envOverride) out.envHint = "An environment variable holds a different JIRA_API_TOKEN; the workspace keychain item is used. Remove the global export to avoid confusion.";
  return out;
}

/** @param {string} projectRoot @param {string} script */
export function testProjectWrapper(projectRoot, script) {
  const file = path.join(projectRoot, ".claude", "zeross", "bin", script);
  if (!fs.existsSync(file)) return { ok: false, error: `.claude/zeross/bin/${script} missing` };
  const result = spawnSync("node", [file, "--dry-run"], {
    cwd: projectRoot, encoding: "utf8", timeout: 30_000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
  });
  let info;
  try {
    info = JSON.parse(result.stdout || "{}");
  } catch {
    info = { raw: String(result.stdout).slice(-500) };
  }
  return { ok: result.status === 0, ...info, stderr: String(result.stderr ?? "").trim().slice(-300) || null };
}

/** @param {string} script */
export function testUserWrapper(script) {
  const file = path.join(userBinDir(), script);
  if (!fs.existsSync(file)) return { ok: false, error: `~/.claude/zeross/bin/${script} missing; run \`zeross mcp add\`` };
  const result = spawnSync("node", [file, "--dry-run"], { encoding: "utf8", timeout: 30_000 });
  let info;
  try {
    info = JSON.parse(result.stdout || "{}");
  } catch {
    info = { raw: String(result.stdout).slice(-500) };
  }
  return { ok: result.status === 0, ...info };
}

/**
 * @param {string} role @param {string} projectRoot
 * @param {{ repo?: string | null, checkClaude?: boolean, service?: string | null }} [opts]
 * @returns {Promise<Record<string, any>>}
 */
export async function testRole(role, projectRoot, { repo = null, checkClaude = true, service = null } = {}) {
  /** @type {Record<string, any>} */
  let result;
  if (role === "github") result = await testGithub(projectRoot, repo, { service });
  else if (role === "jira") result = await testJira(projectRoot, { service });
  else if (role === "db") result = testProjectWrapper(projectRoot, "db-mcp.mjs");
  else if (role === "playwright") result = testProjectWrapper(projectRoot, "playwright-mcp.mjs");
  else if (role === "context7") result = testUserWrapper("context7-mcp.mjs");
  else throw new Error(`unknown role ${role}`);
  if (checkClaude && which("claude")) {
    const status = serverStatus(roleName(role), projectRoot);
    result.claude = status;
    if (status.status && /pending/i.test(status.status)) result.actionNeeded = "approve the project MCP server once (open Claude Code here, or /mcp)";
    result.ok = Boolean(result.ok) && status.connected;
  }
  return { ...result, role };
}

// ---------------------------------------------------------------------------
// config scanning (names, scopes and secret *names* only; never values)

const SECRET_NAME = /(token|secret|passw|pwd|api[_-]?key|private[_-]?key|credential|auth)/i;
const ENV_REF = /^\$\{[A-Za-z_][A-Za-z0-9_]*(:-[^}]*)?\}$/;

/**
 * @param {Record<string, any>} servers @param {string} scope @param {string} file
 * @returns {{ name: string, scope: string, file: string, plaintextSecrets: string[] }[]}
 */
function describeServers(servers, scope, file) {
  return Object.entries(servers ?? {}).map(([name, def]) => {
    const env = def?.env && typeof def.env === "object" ? def.env : {};
    const headers = def?.headers && typeof def.headers === "object" ? def.headers : {};
    const plaintextSecrets = [
      ...Object.entries(env).filter(([k, v]) => SECRET_NAME.test(k) && typeof v === "string" && v && !ENV_REF.test(v)).map(([k]) => k),
      ...Object.entries(headers).filter(([k, v]) => /authorization/i.test(k) && typeof v === "string" && !/\$\{/.test(v)).map(([k]) => `header:${k}`),
    ];
    return { name, scope, file, plaintextSecrets };
  });
}

/**
 * Every MCP server definition that applies to a project: user and local scope
 * from ~/.claude.json, project scope from .mcp.json here and in parent folders.
 * @param {string} projectRoot
 */
export function scanMcpConfigs(projectRoot) {
  const home = os.homedir();
  const claudeJson = path.join(home, ".claude.json");
  const cfg = readJson(claudeJson, {}) ?? {};
  let real = path.resolve(projectRoot);
  try {
    real = fs.realpathSync(projectRoot);
  } catch {
    // keep resolved path
  }
  const found = [
    ...describeServers(cfg.mcpServers, "user", "~/.claude.json"),
    ...describeServers(cfg.projects?.[real]?.mcpServers ?? cfg.projects?.[path.resolve(projectRoot)]?.mcpServers, "local", "~/.claude.json"),
  ];
  // The project's own .mcp.json, then parent folders up to (not including) home.
  let dir = path.resolve(projectRoot);
  for (;;) {
    const file = path.join(dir, ".mcp.json");
    const data = readJson(file, null);
    if (data?.mcpServers) found.push(...describeServers(data.mcpServers, "project", file.startsWith(home) ? file.replace(home, "~") : file));
    const parent = path.dirname(dir);
    if (parent === dir || !parent.startsWith(`${home}${path.sep}`)) break;
    dir = parent;
  }
  return found;
}

/** @param {string} role @param {string} projectRoot */
export function checkRole(role, projectRoot) {
  const servers = listServers(projectRoot);
  const defs = scanMcpConfigs(projectRoot);
  const configured = roleName(role);
  const enrich = (/** @type {McpServer} */ s) => {
    const matches = defs.filter((d) => d.name === s.name);
    return { ...s, definitions: matches.map(({ scope, file, plaintextSecrets }) => ({ scope, file, plaintextSecrets })),
      plaintextSecrets: matches.flatMap((d) => d.plaintextSecrets) };
  };
  const sameName = defs.filter((d) => d.name === configured);
  return {
    role,
    configuredName: configured,
    configured: servers.find((s) => s.name === configured) ? enrich(/** @type {McpServer} */ (servers.find((s) => s.name === configured))) : null,
    shadows: sameName.length > 1 ? sameName.map(({ scope, file }) => ({ scope, file })) : [],
    equivalents: findEquivalents(role, servers).filter((s) => s.name !== configured).map(enrich),
  };
}
