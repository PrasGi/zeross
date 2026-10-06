#!/usr/bin/env node
// .claude/zeross/bin/zeross-guard.mjs
// @ts-check
/*
 * zeross PreToolUse guard for Bash (committed).
 *
 * Stops accidental expensive or risky commands for every teammate:
 *   * builds (package-manager build scripts, next/vite/nuxt/astro/ng build, tsc -b, turbo/nx build,
 *     gradle build/assemble, mvn package/verify/install, docker build)
 *   * whole-suite or coverage test runs (vitest, jest, mocha, playwright test, cypress run,
 *     package test scripts, pytest, phpunit/pest, artisan test, go test ./..., gradle/mvn test)
 *     without specific test files
 *   * force-push, and pushes to (or deletes of) protected branches
 *
 * Commands are classified by their command word after stripping env assignments, wrappers
 * (command/env/sudo/npx/pnpm exec/…) and path prefixes, so text inside quoted arguments
 * (commit messages, grep patterns) never triggers a block.
 *
 * Escape hatches, only when the user explicitly asked for it in this session:
 *   ZEROSS_ALLOW_BUILD=1 <cmd>        ZEROSS_ALLOW_FULL_TESTS=1 <cmd>
 *
 * Exit code 2 blocks the call and shows stderr to Claude. Guardrail, not a
 * security boundary. Node >= 22, `node:` builtins only.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The script lives at <root>/.claude/zeross/bin/.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_PROTECTED = ["main", "master", "develop"];

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const PM_VALUE_FLAGS = new Set(["--filter", "-F", "-C", "--dir", "--prefix", "-w", "--workspace", "--cwd"]);
const PM_NON_SCRIPT = new Set(["add", "install", "i", "ci", "remove", "rm", "uninstall", "update", "up", "upgrade",
  "outdated", "audit", "list", "ls", "why", "info", "view", "init", "create", "dlx", "link", "unlink", "publish",
  "pack", "config", "store", "import", "dedupe", "prune", "login", "logout", "whoami", "version", "help"]);
const WRAPPERS = new Set(["command", "sudo", "nice", "time", "exec", "nohup", "xargs", "npx", "bunx", "cross-env", "dotenv"]);
const BUILD_TOOLS = new Set(["next", "vite", "nuxt", "nuxi", "astro", "ng", "remix", "react-scripts", "svelte-kit", "webpack",
  "rollup", "esbuild", "parcel"]);
const TEST_VALUE_FLAGS = new Set(["-t", "--testNamePattern", "-k", "-c", "--config", "--project", "--outputFile",
  "--reporter", "--root", "--dir", "--shard", "--workspace", "-m", "--maxWorkers", "--environment", "--browser",
  "--grep", "-g", "--timeout"]);
const TARGETING_FLAGS = new Set(["--testPathPattern", "--testPathPatterns", "--filter", "--tests", "--spec", "-s"]);
const TEST_FILE_HINT = /(\.(test|spec)\.|_test\.(go|py)$|(^|\/)test_\w+\.py|Test\.(php|java|kt)$|\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|php|go|java|kt|rb|vue|svelte)$|::)/;
const PUSH_VALUE_FLAGS = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);
const GIT_GLOBAL_VALUE_FLAGS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

/**
 * Split a command line into simple commands on unquoted `&&`, `||`, `;`, `|`, `&` and newlines.
 * @param {string} command
 * @returns {string[]}
 */
export function segments(command) {
  /** @type {string[]} */
  const out = [];
  let cur = "";
  /** @type {string | null} */
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      cur += c;
      if (c === "\\" && quote === '"' && i + 1 < command.length) cur += command[++i];
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      cur += c;
    } else if (c === "\\" && i + 1 < command.length) {
      cur += c + command[++i];
    } else if (c === ";" || c === "\n" || c === "|" || c === "&") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      if ((c === "|" || c === "&") && command[i + 1] === c) i++;
    } else {
      cur += c;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** @param {string} text */
const words = (text) => text.split(/\s+/).filter(Boolean);

/**
 * POSIX shell-like word splitting (same rules as Python's shlex.split): single
 * quotes are literal, double quotes honour `\"` and `\\`, a bare backslash
 * escapes the next character. Unbalanced input falls back to whitespace split.
 * @param {string} segment
 * @returns {string[]}
 */
export function tokens(segment) {
  /** @type {string[]} */
  const out = [];
  let cur = "";
  let inToken = false;
  /** @type {string | null} */
  let quote = null;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else cur += c;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === "\\" && (segment[i + 1] === '"' || segment[i + 1] === "\\")) cur += segment[++i];
      else cur += c;
      continue;
    }
    if (c === "\\") {
      if (i + 1 >= segment.length) return words(segment);
      cur += segment[++i];
      inToken = true;
    } else if (c === "'" || c === '"') {
      quote = c;
      inToken = true;
    } else if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      if (inToken) out.push(cur);
      cur = "";
      inToken = false;
    } else {
      cur += c;
      inToken = true;
    }
  }
  if (quote) return words(segment);
  if (inToken) out.push(cur);
  return out;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const KNOWN_BINS = new Set(["vitest", "jest", "mocha", "playwright", "cypress", "next", "vite", "nuxt", "nuxi", "astro", "ng",
  "remix", "react-scripts", "tsc", "turbo", "nx", "webpack", "rollup", "esbuild", "parcel"]);
/** Re-quote a token so it survives another tokens() pass. @param {string} t */
const quoteArg = (t) => (/^[\w@%+=:,./-]+$/.test(t) ? t : `'${t.replace(/'/g, "'\\''")}'`);
/** @param {string} word */
const baseName = (word) => word.slice(word.lastIndexOf("/") + 1);

/**
 * The effective command of a segment: env assignments, wrappers and path
 * prefixes removed. `pnpm exec vitest run x` → ["vitest", "run", "x"].
 * @param {string} segment
 * @returns {string[]}
 */
export function normalize(segment) {
  let toks = tokens(segment);
  for (let guard = 0; guard < 10 && toks.length; guard++) {
    while (toks.length && ASSIGNMENT.test(toks[0])) toks = toks.slice(1);
    if (!toks.length) break;
    const head = baseName(toks[0]);
    if (head === "env") {
      toks = toks.slice(1);
      while (toks.length && (toks[0].startsWith("-") || ASSIGNMENT.test(toks[0]))) toks = toks.slice(1);
      continue;
    }
    if (WRAPPERS.has(head)) {
      toks = toks.slice(1);
      while (toks.length && toks[0].startsWith("-")) toks = toks.slice(1); // wrapper options (npx -y, sudo -E, …)
      if (head === "dotenv" && toks[0] === "--") toks = toks.slice(1);
      continue;
    }
    if (PACKAGE_MANAGERS.has(head) && (toks[1] === "exec" || toks[1] === "dlx" || (head === "npm" && toks[1] === "x"))) {
      toks = toks.slice(2);
      while (toks.length && toks[0].startsWith("-")) toks = toks.slice(1);
      continue;
    }
    break;
  }
  return toks.length ? [baseName(toks[0]), ...toks.slice(1)] : [];
}

/**
 * For a package-manager invocation, the script it runs (or null).
 * `pnpm --filter web run build` → "build"; `yarn workspace web test` → "test"; `npm t` → "test".
 * @param {string[]} toks normalized tokens starting with npm|pnpm|yarn|bun
 * @returns {{ script: string | null, rest: string[] }}
 */
function pmScript(toks) {
  const [pm, ...args] = toks;
  let i = 0;
  const skipOptions = () => {
    while (i < args.length && args[i].startsWith("-")) {
      const flag = args[i].split("=")[0];
      i += PM_VALUE_FLAGS.has(flag) && !args[i].includes("=") ? 2 : 1;
    }
  };
  skipOptions();
  if (pm === "yarn" && args[i] === "workspace") {
    i += 2; // yarn workspace <name> <script>
    skipOptions();
  }
  if (pm === "yarn" && args[i] === "workspaces" && args[i + 1] === "foreach") {
    i += 2;
    while (i < args.length && args[i] !== "run") i++;
  }
  let sub = args[i];
  if (sub === undefined) return { script: null, rest: [] };
  if (sub === "run" || sub === "run-script" || sub === "rum" || sub === "urn") {
    i++;
    skipOptions();
    sub = args[i];
  } else if (sub === "t" || sub === "tst") {
    sub = "test";
  } else if (PM_NON_SCRIPT.has(sub)) {
    return { script: null, rest: [] };
  }
  return { script: sub ?? null, rest: args.slice(i + 1) };
}

/** @param {string} script */
const isBuildScript = (script) => /^build([:-].*)?$/.test(script) || script === "dist" || script === "compile";
/** @param {string} script */
const isTestScript = (script) => /^(test|tests|t)([:-].*)?$/.test(script) || /^(e2e|spec)([:-].*)?$/.test(script);

/**
 * @param {string} segment
 * @returns {boolean}
 */
export function isBuild(segment) {
  const toks = normalize(segment);
  if (!toks.length) return false;
  const [cmd, ...args] = toks;
  if (PACKAGE_MANAGERS.has(cmd)) {
    if (cmd === "bun" && args[0] === "build") return true; // bun's bundler
    const { script, rest } = pmScript(toks);
    if (script !== null && KNOWN_BINS.has(script)) return isBuild([script, ...rest].join(" ")); // `pnpm next build`
    return script !== null && isBuildScript(script);
  }
  if (BUILD_TOOLS.has(cmd)) return args.includes("build") || ["webpack", "rollup", "esbuild", "parcel"].includes(cmd);
  if (cmd === "tsc") return args.some((a) => a === "-b" || a === "--build");
  if (cmd === "turbo") return args.some((a) => isBuildScript(a)) && (args[0] === "build" || args[0] === "run");
  if (cmd === "nx") {
    if (args[0] === "build") return true;
    if (args[0] === "run" && args[1] && /:build(:|$)/.test(args[1])) return true;
    if (args[0] === "run-many" || args[0] === "affected") {
      return args.some((a, i) => (a === "-t" || a === "--target" || a === "--targets") && /(^|,)build(,|$)/.test(args[i + 1] ?? ""))
        || args.some((a) => /^--targets?=.*\bbuild\b/.test(a));
    }
    return false;
  }
  if (cmd === "docker") return args[0] === "build" || (args[0] === "buildx" && args[1] === "build")
    || (args[0] === "compose" && args.includes("build"));
  if (cmd === "docker-compose") return args.includes("build");
  if (cmd === "gradle" || cmd === "gradlew") return args.some((a) => ["build", "assemble", "bootJar", "jar"].includes(a));
  if (cmd === "mvn" || cmd === "mvnw") return args.some((a) => ["package", "verify", "install", "deploy"].includes(a));
  return false;
}

/**
 * Does the argument list target specific tests (files, deep paths, name/path filters)?
 * @param {string[]} args
 */
function isTargeted(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const flag = arg.split("=")[0];
    if (TARGETING_FLAGS.has(flag)) return true;
    if (arg.startsWith("-Dtest=")) return true;
    if (TEST_VALUE_FLAGS.has(flag)) {
      if (!arg.includes("=")) i++;
      continue;
    }
    if (arg.startsWith("-") || arg === "--") continue;
    if (TEST_FILE_HINT.test(arg)) return true;
    // A directory counts only when it is at least two levels deep (src/features/login),
    // never ".", "./", "/" or a bare top-level folder like "src/".
    const parts = arg.replace(/^\.\//, "").replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts.length >= 2 && !arg.endsWith("/...") && !parts.includes("..")) return true;
  }
  return false;
}

/**
 * Why this segment is a whole-suite or coverage test run, or null when it is targeted / not a test.
 * @param {string} segment
 * @returns {string | null}
 */
export function fullSuiteReason(segment) {
  const toks = normalize(segment);
  if (!toks.length) return null;
  const [cmd, ...args] = toks;
  /** @type {{ label: string, rest: string[] } | null} */
  let run = null;
  if (["vitest", "jest", "mocha", "ava", "jasmine", "karma", "pytest", "phpunit", "pest", "rspec"].includes(cmd)) {
    run = { label: cmd, rest: args };
  } else if (cmd === "playwright" && args[0] === "test") {
    run = { label: "playwright test", rest: args.slice(1) };
  } else if (cmd === "cypress" && args[0] === "run") {
    run = { label: "cypress run", rest: args.slice(1) };
  } else if ((cmd === "python" || cmd === "python3") && args[0] === "-m" && args[1] === "pytest") {
    run = { label: "pytest", rest: args.slice(2) };
  } else if (cmd === "php" && args[0] === "artisan" && args[1] === "test") {
    run = { label: "artisan test", rest: args.slice(2) };
  } else if (cmd === "go" && args[0] === "test") {
    if (args.some((a) => a === "--coverprofile" || a.startsWith("-cover"))) return "coverage runs";
    return args.slice(1).some((a) => a.endsWith("/...") || a === "...") ? "go test over all packages" : null;
  } else if (["gradle", "gradlew", "mvn", "mvnw"].includes(cmd) && args.some((a) => a === "test" || a === "check")) {
    return args.some((a) => a === "--tests" || a.startsWith("-Dtest=")) ? null : "gradle/maven test without specific tests";
  } else if (PACKAGE_MANAGERS.has(cmd)) {
    if (cmd === "bun" && args[0] === "test") run = { label: "bun test", rest: args.slice(1) };
    else {
      const { script, rest } = pmScript(toks);
      // `pnpm vitest …` / `yarn jest …` run the binary directly.
      if (script !== null && KNOWN_BINS.has(script)) return fullSuiteReason([script, ...rest].map(quoteArg).join(" "));
      if (script !== null && isTestScript(script)) run = { label: "package test script", rest };
    }
  }
  if (!run) return null;
  if (run.rest.some((a) => a.startsWith("--coverage") || a === "--cov" || a.startsWith("--cov="))) return "coverage runs";
  return isTargeted(run.rest) ? null : `${run.label} without specific test files`;
}

/** @returns {string[]} */
function protectedBranches() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude", "zeross", "config.json"), "utf8"));
    const branches = config?.git?.protectedBranches;
    return Array.isArray(branches) && branches.length ? branches.map(String) : DEFAULT_PROTECTED;
  } catch {
    return DEFAULT_PROTECTED;
  }
}

/** @param {string} cwd */
function currentBranch(cwd) {
  const out = spawnSync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], {
    encoding: "utf8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out.error ? "" : (out.stdout || "").trim();
}

/**
 * Why this `git push` must be blocked (force-push or protected target), or null.
 * @param {string} segment
 * @param {string} cwd
 * @returns {string | null}
 */
export function pushReason(segment, cwd) {
  const toks = normalize(segment);
  if (toks[0] !== "git") return null;
  let i = 1;
  let gitCwd = cwd;
  while (i < toks.length && toks[i].startsWith("-")) {
    const flag = toks[i].split("=")[0];
    if (GIT_GLOBAL_VALUE_FLAGS.has(flag) && !toks[i].includes("=")) {
      if (flag === "-C" && toks[i + 1]) gitCwd = path.resolve(cwd, toks[i + 1]);
      i += 2;
    } else {
      i += 1;
    }
  }
  if (toks[i] !== "push") return null;
  const args = toks.slice(i + 1);
  /** @type {string[]} */
  const positional = [];
  let force = false;
  let lease = false;
  let everything = false;
  let deleting = false;
  for (let j = 0; j < args.length; j++) {
    const arg = args[j];
    const flag = arg.split("=")[0];
    if (PUSH_VALUE_FLAGS.has(flag)) {
      if (!arg.includes("=")) j++;
      continue;
    }
    if (arg === "--force" || flag === "--force") force = true;
    else if (flag === "--force-with-lease" || flag === "--force-if-includes") lease = true;
    else if (arg === "--all" || arg === "--mirror" || arg === "--branches") everything = true;
    else if (arg === "--delete" || arg === "-d") deleting = true;
    else if (/^-[A-Za-z]+$/.test(arg)) {
      if (arg.includes("f")) force = true; // -f, -uf, -fu
      if (arg.includes("d")) deleting = true;
    } else if (!arg.startsWith("-")) positional.push(arg);
  }
  if (force || positional.slice(1).some((r) => r.startsWith("+"))) return "force-push";
  const protectedList = protectedBranches();
  if (everything) return "push of all branches (includes protected branches)";
  const here = () => currentBranch(gitCwd);
  const refspecs = positional.slice(1);
  const targets = refspecs.length
    ? refspecs.map((r) => {
      let dst = r.includes(":") ? r.slice(r.indexOf(":") + 1) : r;
      if (!dst && r.startsWith(":")) deleting = true;
      if (dst === "HEAD" || dst === "@" || dst === "") dst = r.includes(":") && r.startsWith(":") ? r.slice(1) : here();
      return dst.startsWith("refs/heads/") ? dst.slice("refs/heads/".length) : dst;
    })
    : [here()];
  const hit = targets.find((t) => protectedList.includes(t));
  if (hit !== undefined) return deleting ? `delete of protected branch ${hit}` : `push to protected branch ${hit}`;
  // --force-with-lease / --force-if-includes to a task branch is allowed on purpose (safe rebase flow).
  void lease;
  return null;
}

/**
 * The block message for a Bash command, or null to allow it.
 * @param {string} command
 * @param {string} cwd
 * @returns {string | null}
 */
export function decide(command, cwd) {
  const allowBuild = /(^|\s)ZEROSS_ALLOW_BUILD=1(\s|$)/.test(command);
  const allowTests = /(^|\s)ZEROSS_ALLOW_FULL_TESTS=1(\s|$)/.test(command);
  for (const seg of segments(command)) {
    if (!allowBuild && isBuild(seg)) {
      return (
        "Blocked by zeross: builds run only on an explicit user request. Ask the user; if they " +
        "asked for it in this session, re-run with `ZEROSS_ALLOW_BUILD=1 <command>`."
      );
    }
    let reason = allowTests ? null : fullSuiteReason(seg);
    if (reason) {
      return (
        `Blocked by zeross: ${reason}. Run only the test files related to the change ` +
        "(see .claude/zeross/workflow/testing.md). If the user explicitly asked for a full run, " +
        "re-run with `ZEROSS_ALLOW_FULL_TESTS=1 <command>`."
      );
    }
    reason = pushReason(seg, cwd);
    if (reason) {
      return (
        `Blocked by zeross: ${reason}. Pushes go to a task branch without force; protected ` +
        "branches change only through a PR. Ask the user how to proceed."
      );
    }
  }
  return null;
}

/**
 * Hook entry point: PreToolUse JSON on stdin; 2 blocks (message on stderr), 0 allows.
 * @param {string} input
 * @returns {number}
 */
export function main(input) {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    return 0;
  }
  if (!payload || typeof payload !== "object" || payload.tool_name !== "Bash") return 0;
  const command = String(payload.tool_input?.command ?? "");
  const message = decide(command, String(payload.cwd || ROOT));
  if (message) {
    process.stderr.write(message + "\n");
    return 2;
  }
  return 0;
}

function isMain() {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  let input = "";
  try {
    input = fs.readFileSync(0, "utf8");
  } catch {
    // No stdin: nothing to judge.
  }
  process.exitCode = main(input);
}
