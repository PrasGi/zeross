// lib/secrets.js
// @ts-check
/**
 * OS keychain access and .envrc wiring. Secrets are read from stdin (never
 * argv), stored in the OS keychain, and only referenced elsewhere as
 * `keychain:<service>`. Nothing here prints a secret.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { which } from "./doctor.js";
import { HASH_MARKERS, atomicWrite, mergeMarkerBlock, readText } from "./writer.js";

export class SecretError extends Error {}

export const account = () => process.env.USER || os.userInfo().username;

/** @returns {"macos-keychain" | "secret-tool" | null} */
export function backend() {
  if (process.platform === "darwin" && which("security")) return "macos-keychain";
  if (which("secret-tool")) return "secret-tool";
  return null;
}

/** zeross-github-<workspace>, zeross-jira-<workspace>, zeross-test-<project>-<role>. @param {string} kind @param {string} scope */
export function serviceName(kind, scope) {
  const safe = scope.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `zeross-${kind}-${safe}`;
}

/** Double-quote for `security -i` command parsing. @param {string} value */
export const quote = (value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const SERVICE_RE = /^[A-Za-z0-9._-]+$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** @param {string} service */
export function assertService(service) {
  if (!SERVICE_RE.test(service)) throw new SecretError(`invalid keychain service name: ${JSON.stringify(service)}`);
}

/**
 * Values that look like secrets must go through keychain refs, never into .envrc as literals.
 * @param {string} name @param {string} value
 */
export function looksSecret(name, value) {
  return /(token|secret|passw|pwd|api[_-]?key|private[_-]?key|credential|auth)/i.test(name)
    || /^[a-z][a-z0-9+.-]*:\/\/[^/@\s]+:[^/@\s]*@/i.test(value)   // URL with user:password@
    || /^(gh[pousr]_|github_pat_|sk-|sk_live_|sk_test_|xox[abp]-|AKIA)/.test(value);
}

/** Names zeross itself creates; anything else needs --force. A trailing "." or "-" (copied punctuation) never matches. */
export const ZEROSS_SERVICE_RE = /^zeross-(github|jira|test|context7)(-[a-z0-9]+)*$/;
const STRICT_SERVICE_RE = /^zeross-[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Validate a service name for writing. Returns null when fine, else the reason.
 * @param {string} service @param {boolean} [force]
 */
export function serviceProblem(service, force = false) {
  if (!STRICT_SERVICE_RE.test(service)) {
    return `invalid service name ${JSON.stringify(service)}: use lowercase letters, digits and single dashes, e.g. zeross-github-<workspace> (no trailing "." or "-")`;
  }
  if (!force && !ZEROSS_SERVICE_RE.test(service)) {
    return `${service} is not a zeross service name (zeross-github-*, zeross-jira-*, zeross-test-*, zeross-context7); pass --force if you really mean it`;
  }
  return null;
}

/** Strip one pair of matching quotes. @param {string} v */
const unquote = (v) => (v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === '"' || v[0] === "'") ? v.slice(1, -1) : v);
/** Literal values only: shell expansions would need executing the file. @param {string} v */
const isLiteral = (v) => Boolean(v) && !/\$\(|\$\{|`/.test(v) && !/^\$[A-Za-z_]/.test(v);

/**
 * Read a literal `export NAME=value` from a shell env file without executing it.
 * @param {string} file @param {string} name
 */
export function literalFromEnvrc(file, name) {
  const text = readText(file);
  if (!text) throw new SecretError(`cannot read ${file}`);
  let value = null;
  const re = new RegExp(`^\\s*(?:export\\s+)?${name.replace(/[^A-Za-z0-9_]/g, "")}\\s*=\\s*(.*)$`);
  for (const line of text.split(/\r?\n/)) {
    const m = re.exec(line);
    if (m) value = unquote(m[1].replace(/\s+#.*$/, "").trim());
  }
  if (value === null) throw new SecretError(`${name} is not set in ${file}`);
  if (!isLiteral(value)) throw new SecretError(`${name} in ${file} is not a literal value (it is computed by the shell); nothing to import`);
  return value;
}

/**
 * Read a literal env value of one server from an MCP JSON config.
 * @param {string} file @param {string} server @param {string} name
 */
export function literalFromMcpJson(file, server, name) {
  let data;
  try {
    data = JSON.parse(readText(file));
  } catch {
    throw new SecretError(`cannot parse ${file}`);
  }
  const value = data?.mcpServers?.[server]?.env?.[name];
  if (typeof value !== "string" || !value) throw new SecretError(`${server}.env.${name} not found in ${file}`);
  if (!isLiteral(value)) throw new SecretError(`${server}.env.${name} in ${file} is a reference, not a literal; nothing to import`);
  return value;
}

/** Single-quote a literal for POSIX shells. @param {string} value */
const shellQuote = (value) => `'${value.replace(/'/g, "'\\''")}'`;

/**
 * Read one secret from stdin: a hidden prompt on a TTY, the first line when piped.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export async function readSecretFromStdin(prompt) {
  const value = process.stdin.isTTY ? await hiddenPrompt(prompt) : firstLine(fs.readFileSync(0, "utf8"));
  if (!value.trim()) throw new SecretError("empty secret");
  return value.trim();
}

/** @param {string} text */
const firstLine = (text) => text.split(/\r?\n/, 1)[0] ?? "";

/** @param {string} prompt @returns {Promise<string>} */
function hiddenPrompt(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    /** @param {string} chunk */
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          finish();
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          finish();
          reject(new SecretError("cancelled"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stderr.write("\n");
    };
    stdin.on("data", onData);
  });
}

/** @typedef {(cmd: string, args: string[], opts?: object) => { status: number | null, stdout?: any, stderr?: any }} Runner */

/**
 * @param {string} service
 * @param {string} value
 * @param {Runner} [run] injectable for tests
 * @param {ReturnType<typeof backend>} [kind]
 */
export function setSecret(service, value, run = spawnSync, kind = backend()) {
  assertService(service);
  // A newline would start a second `security -i` command.
  if (/[\r\n\0]/.test(value) || /[\r\n\0]/.test(account())) throw new SecretError("secret contains a line break or NUL");
  let result;
  if (kind === "macos-keychain") {
    // `security -i` reads the command from stdin, so the secret never appears
    // in argv (and therefore never in `ps`). -U updates in place.
    const command = `add-generic-password -U -a ${quote(account())} -s ${quote(service)} -w ${quote(value)}\n`;
    result = run("security", ["-i"], { input: command, encoding: "utf8" });
  } else if (kind === "secret-tool") {
    result = run("secret-tool", ["store", "--label", service, "service", service, "account", account()],
      { input: value, encoding: "utf8" });
  } else {
    throw new SecretError("no keychain backend (need macOS `security` or Linux `secret-tool`)");
  }
  // `security -i` can exit 0 on a failed command, so read the value back.
  if (result.status !== 0 || getSecret(service, run, kind) !== value) {
    throw new SecretError(`keychain write failed for ${service}: ${String(result.stderr ?? "").trim().slice(0, 200)}`);
  }
}

/**
 * @param {string} service
 * @param {Runner} [run] injectable for tests
 * @param {ReturnType<typeof backend>} [kind]
 * @returns {string | null}
 */
export function getSecret(service, run = spawnSync, kind = backend()) {
  assertService(service);
  /** @type {[string, string[]] | null} */
  const cmd = kind === "macos-keychain"
    ? ["security", ["find-generic-password", "-a", account(), "-s", service, "-w"]]
    : kind === "secret-tool" ? ["secret-tool", ["lookup", "service", service, "account", account()]] : null;
  if (!cmd) return null;
  const result = run(cmd[0], cmd[1], { encoding: "utf8" });
  const value = String(result.stdout ?? "").trim();
  return result.status === 0 && value ? value : null;
}

/** @param {string} service */
export const hasSecret = (service) => getSecret(service) !== null;

/** Shell expression that prints the secret, for use inside .envrc. @param {string} service */
export function keychainShellExpr(service) {
  if (backend() === "secret-tool") return `$(secret-tool lookup service ${service} account "$USER" 2>/dev/null)`;
  return `$(security find-generic-password -a "$USER" -s ${service} -w 2>/dev/null)`;
}

/**
 * Merge a zeross block into <directory>/.envrc. `exports` maps VAR → either
 * `keychain:<service>` (resolved at load time) or a literal non-secret value.
 * Names and services are validated and literals are single-quoted, so nothing
 * passed here can inject shell code into a file direnv will execute.
 * @param {string} directory
 * @param {Record<string, string>} exports
 */
export function writeEnvrcBlock(directory, exports) {
  const lines = Object.entries(exports).map(([name, ref]) => {
    if (!ENV_NAME_RE.test(name)) throw new SecretError(`invalid variable name: ${JSON.stringify(name)}`);
    if (ref.startsWith("keychain:")) {
      const service = ref.slice("keychain:".length);
      assertService(service);
      return `export ${name}="${keychainShellExpr(service)}"`;
    }
    if (looksSecret(name, ref)) throw new SecretError(`${name} looks like a secret; store it with \`zeross secret set\` and pass keychain:<service>`);
    if (/[\r\n\0]/.test(ref)) throw new SecretError(`${name} contains a line break`);
    return `export ${name}=${shellQuote(ref)}`;
  });
  const file = path.join(directory, ".envrc");
  const current = readText(file);
  const [start, end] = HASH_MARKERS;
  // Keep exports already in our block that this call did not mention.
  if (current.includes(start) && current.includes(end)) {
    const oldBlock = current.split(start)[1].split(end)[0];
    for (const line of oldBlock.trim().split("\n")) {
      const name = line.replace(/^export /, "").split("=", 1)[0].trim();
      if (name && !(name in exports)) lines.push(line);
    }
  }
  const header = "# Managed by zeross: values come from the OS keychain at load time; no secret is stored in this file.";
  const body = [header, ...lines.filter((l) => !l.startsWith("# ")).sort()].join("\n");
  atomicWrite(file, mergeMarkerBlock(current, body, HASH_MARKERS), 0o600);
  return file;
}

/** @param {string} directory */
export function direnvAllow(directory) {
  if (!which("direnv")) return false;
  return spawnSync("direnv", ["allow", directory]).status === 0;
}
