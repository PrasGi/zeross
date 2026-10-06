// lib/detect.js
// @ts-check
/**
 * Project scanning: apps, stacks, test/lint/dev commands, DB, tickets, design
 * system. Detection only proposes; the /zeross interview confirms every value
 * before anything is written. Env files are scanned for variable NAMES and URL
 * schemes only; secret values never reach the output.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { exists, isDir } from "./paths.js";
import { readText } from "./writer.js";

export const ZEROSS_SKILLS = [
  "zero-fix-bug", "zero-build-small-feature", "zero-build-feature", "zero-create-pr",
  "zero-update", "zero-learn", "zero-security-review", "zero-ui-review",
  "zero-docs-writer", "zero-pr-description",
];

const MANIFEST_FILES = ["package.json", "go.mod", "pyproject.toml", "requirements.txt", "composer.json",
  "build.gradle", "build.gradle.kts", "pom.xml", "pubspec.yaml"];
const APP_PARENTS = ["apps", "services", "packages", "libs"];
const SPLIT_DIRS = ["frontend", "backend", "client", "server", "web", "api", "admin", "mobile"];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "vendor", ".venv", "venv", "target"]);

const FE_JS = { next: "nextjs", react: "react", vue: "vue", nuxt: "nuxt", svelte: "svelte",
  "@sveltejs/kit": "sveltekit", "@angular/core": "angular", "solid-js": "solid", astro: "astro" };
const MOBILE_JS = { "react-native": "react-native", expo: "expo" };
const BE_JS = { "@nestjs/core": "nestjs", express: "express", fastify: "fastify", koa: "koa", hono: "hono",
  "@hapi/hapi": "hapi" };
const STYLE_JS = { tailwindcss: "tailwind", "styled-components": "styled-components", "@mui/material": "mui",
  "@chakra-ui/react": "chakra", antd: "antd" };
const DB_JS = { mongoose: "mongodb", mongodb: "mongodb", pg: "postgres", postgres: "postgres", mysql2: "mysql",
  mysql: "mysql", "@prisma/client": "prisma", prisma: "prisma", typeorm: "typeorm", "drizzle-orm": "drizzle",
  sequelize: "sequelize", knex: "knex" };
const DB_GO = { "go.mongodb.org/mongo-driver": "mongodb", "github.com/lib/pq": "postgres",
  "github.com/jackc/pgx": "postgres", "github.com/go-sql-driver/mysql": "mysql", "gorm.io/gorm": "gorm" };
const GO_WEB = { "github.com/gin-gonic/gin": "gin", "github.com/labstack/echo": "echo",
  "github.com/gofiber/fiber": "fiber", "github.com/go-chi/chi": "chi" };
const PY_WEB = { fastapi: "fastapi", django: "django", flask: "flask" };
const DB_PY = { pymongo: "mongodb", motor: "mongodb", psycopg: "postgres", psycopg2: "postgres",
  asyncpg: "postgres", mysqlclient: "mysql", pymysql: "mysql", sqlalchemy: "sqlalchemy" };
/** @type {Record<string, string>} */
const URL_SCHEMES = { mongodb: "mongodb", "mongodb+srv": "mongodb", postgres: "postgres", postgresql: "postgres",
  mysql: "mysql", mariadb: "mysql" };
/** @type {Record<string, number>} */
const DEFAULT_PORTS = { nextjs: 3000, nuxt: 3000, nestjs: 3000, express: 3000, vue: 5173, react: 5173,
  svelte: 5173, sveltekit: 5173, astro: 4321, angular: 4200, fastapi: 8000, django: 8000, flask: 5000,
  laravel: 8000, go: 8080, spring: 8080 };
const JIRA_KEY = /\b([A-Z][A-Z0-9]{1,9})-\d+\b/g;
const JIRA_STOPLIST = new Set(["UTF", "ISO", "SHA", "RFC", "CVE", "ES", "HTTP", "TLS", "AES", "RSA", "MD", "GPT",
  "WCAG", "ECMA", "IEEE", "PEP", "OAUTH", "H", "V", "X", "IPV"]);
const DESIGN_SYSTEM_PATHS = ["components/ui", "src/components/ui", "app/components/ui", "packages/ui",
  "packages/design-system", "libs/ui", "src/design-system", "src/theme", "theme", "styles/tokens",
  "src/styles/tokens", ".storybook", "components.json", "tailwind.config.js", "tailwind.config.ts",
  "tailwind.config.cjs", "tailwind.config.mjs", "tokens.json"];

/** @param {string} file @returns {Record<string, any>} */
function readJsonSafe(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/** @param {unknown} v @returns {Record<string, any>} */
const asObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? /** @type {Record<string, any>} */ (v) : {});

/** @param {string} root @param {...string} args */
function git(root, ...args) {
  const out = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 10000 });
  return out.status === 0 ? out.stdout : "";
}

/** @param {string} dir */
function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name))
      .map((e) => path.join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

/** @param {string[]} items */
const unique = (items) => [...new Set(items)];

// ---------------------------------------------------------------------------
// Package manager & monorepo

/**
 * Declared or lockfile-implied package manager; `fallback` when neither exists.
 * @param {string} root @param {string | null} [fallback]
 * @returns {string | null}
 */
export function packageManager(root, fallback = null) {
  const declared = String(readJsonSafe(path.join(root, "package.json")).packageManager ?? "");
  for (const name of ["pnpm", "yarn", "bun", "npm"]) if (declared.startsWith(name)) return name;
  for (const [lock, name] of [["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lockb", "bun"],
    ["bun.lock", "bun"], ["package-lock.json", "npm"]]) {
    if (exists(path.join(root, lock))) return name;
  }
  if (fallback) return fallback;
  return exists(path.join(root, "package.json")) ? "npm" : null;
}

/** @param {string | null} pm */
const pmExec = (pm) => ({ pnpm: "pnpm exec", yarn: "yarn", bun: "bunx", npm: "npx" })[pm || "npm"] ?? "npx";
/** @param {string | null} pm */
const pmRun = (pm) => ({ pnpm: "pnpm", yarn: "yarn", bun: "bun run", npm: "npm run" })[pm || "npm"] ?? "npm run";

/** @param {string} root */
export function monorepoSignals(root) {
  const signals = ["pnpm-workspace.yaml", "turbo.json", "nx.json", "lerna.json", "go.work"]
    .filter((n) => exists(path.join(root, n)));
  if ("workspaces" in readJsonSafe(path.join(root, "package.json"))) signals.push("package.json#workspaces");
  return signals;
}

/** @param {string} dir */
const hasManifest = (dir) => MANIFEST_FILES.some((n) => exists(path.join(dir, n)));

/**
 * @param {string} root
 * @returns {{ isMonorepo: boolean, appDirs: string[] }}
 */
export function discoverAppDirs(root) {
  let found = APP_PARENTS.flatMap((parent) => listDirs(path.join(root, parent)).filter(hasManifest));
  if (!found.length) {
    found = SPLIT_DIRS.map((d) => path.join(root, d)).filter((d) => isDir(d) && hasManifest(d));
    if (found.length < 2) found = [];
  }
  if (!found.length) return { isMonorepo: monorepoSignals(root).length > 0, appDirs: [root] };
  return { isMonorepo: true, appDirs: found };
}

// ---------------------------------------------------------------------------
// Per-app detection

/** @param {string} dir @returns {Record<string, string>} */
function jsDeps(dir) {
  const pkg = readJsonSafe(path.join(dir, "package.json"));
  return { ...asObject(pkg.peerDependencies), ...asObject(pkg.devDependencies), ...asObject(pkg.dependencies) };
}

/** @param {string} dir */
function pyDeps(dir) {
  const text = `${readText(path.join(dir, "pyproject.toml"))}\n${readText(path.join(dir, "requirements.txt"))}`;
  return new Set([...text.matchAll(/^[\s"']*([A-Za-z0-9_.-]+)/gm)].map((m) => m[1].toLowerCase()));
}

/**
 * Labels from `table` whose key matches a dependency name (or a sub-path of it).
 * @param {Iterable<string>} names @param {Record<string, string>} table
 */
function match(names, table) {
  const list = [...names];
  /** @type {string[]} */
  const hits = [];
  for (const [key, label] of Object.entries(table)) {
    if (list.some((n) => n === key || n.startsWith(`${key}/`)) && !hits.includes(label)) hits.push(label);
  }
  return hits;
}

/**
 * @param {string} script @param {string[]} stack @param {string} app
 * @returns {[number | null, string]}
 */
function devPort(script, stack, app) {
  const fromScript = /(?:--port|-p)[ =](\d{2,5})/.exec(script);
  if (fromScript) return [Number(fromScript[1]), "script"];
  for (const envName of [".env.example", ".env.local", ".env"]) {
    const m = /^\s*PORT\s*=\s*['"]?(\d{2,5})/m.exec(readText(path.join(app, envName)));
    if (m) return [Number(m[1]), `env:${envName}`];
  }
  for (const label of stack) if (label in DEFAULT_PORTS) return [DEFAULT_PORTS[label], "framework-default"];
  return [null, "unknown"];
}

/** @param {[number | null, string]} port @param {string} command */
const devEntry = ([port, source], command) =>
  ({ command, url: port ? `http://localhost:${port}` : null, urlSource: source });

/**
 * @param {string} root @param {string} app @param {string | null} pm
 */
export function detectApp(root, app, pm) {
  const rel = app === root ? "." : path.relative(root, app).split(path.sep).join("/");
  /** @type {string[]} */ let stack = [];
  let kind = "library";
  /** @type {Record<string, any>} */ let test = {};
  /** @type {Record<string, any>} */ let lint = {};
  /** @type {Record<string, any>} */ let dev = {};
  /** @type {string[]} */ let dbHints = [];
  const empty = (/** @type {object} */ o) => Object.keys(o).length === 0;

  if (exists(path.join(app, "package.json"))) {
    const deps = jsDeps(app);
    const names = Object.keys(deps);
    const fe = match(names, FE_JS);
    const mobile = match(names, MOBILE_JS);
    const be = match(names, BE_JS);
    stack.push(...fe, ...mobile, ...be, ...match(names, STYLE_JS));
    dbHints.push(...match(names, DB_JS));
    if ("typescript" in deps) stack.push("typescript");
    const hasApiDir = ["app/api", "src/app/api", "pages/api"].some((d) => isDir(path.join(app, d)));
    if (mobile.length) kind = "mobile";
    else if (fe.some((f) => ["nextjs", "nuxt", "sveltekit"].includes(f))) kind = be.length || hasApiDir ? "fullstack" : "frontend";
    else if (fe.length && be.length) kind = "fullstack";
    else if (fe.length) kind = "frontend";
    else if (be.length) kind = "backend";
    const ex = pmExec(pm);
    if ("vitest" in deps) test = { runner: "vitest", command: `${ex} vitest run {files}` };
    else if ("jest" in deps) test = { runner: "jest", command: `${ex} jest {files}` };
    if ("eslint" in deps) lint = { command: `${ex} eslint {files}` };
    else if ("@biomejs/biome" in deps) lint = { command: `${ex} biome check {files}` };
    const scripts = asObject(readJsonSafe(path.join(app, "package.json")).scripts);
    const devScript = ["dev", "start:dev", "serve", "start"].find((s) => s in scripts);
    if (devScript && kind !== "library") dev = devEntry(devPort(String(scripts[devScript]), stack, app), `${pmRun(pm)} ${devScript}`);
  }

  if (exists(path.join(app, "go.mod"))) {
    const modules = [...readText(path.join(app, "go.mod")).matchAll(/^\s*([\w./-]+)\s+v/gm)].map((m) => m[1]);
    stack.push("go", ...match(modules, GO_WEB));
    dbHints.push(...match(modules, DB_GO));
    if (kind === "library") kind = "backend";
    if (empty(test)) test = { runner: "go", command: "go test {files}" };
    if (empty(lint) && (exists(path.join(app, ".golangci.yml")) || exists(path.join(app, ".golangci.yaml")))) {
      lint = { command: "golangci-lint run {files}" };
    }
    if (empty(dev)) dev = devEntry(devPort("", ["go"], app), "go run .");
  }

  if (exists(path.join(app, "pyproject.toml")) || exists(path.join(app, "requirements.txt"))) {
    const deps = pyDeps(app);
    const web = match(deps, PY_WEB);
    stack.push("python", ...web);
    dbHints.push(...match(deps, DB_PY));
    if (web.length && kind === "library") kind = "backend";
    const runner = exists(path.join(app, "uv.lock")) || exists(path.join(root, "uv.lock")) ? "uv run"
      : exists(path.join(app, "poetry.lock")) ? "poetry run" : "python -m";
    if (empty(test) && (deps.has("pytest") || exists(path.join(app, "pytest.ini")) || isDir(path.join(app, "tests")))) {
      test = { runner: "pytest", command: `${runner} pytest {files}` };
    }
    if (empty(lint) && deps.has("ruff")) lint = { command: `${runner} ruff check {files}` };
    if (web.length && empty(dev)) {
      const cmd = web.includes("django") ? "python manage.py runserver"
        : web.includes("fastapi") ? `${runner} uvicorn main:app --reload` : `${runner} flask run`;
      dev = devEntry(devPort("", web, app), cmd);
    }
  }

  if (exists(path.join(app, "composer.json"))) {
    const composer = readJsonSafe(path.join(app, "composer.json"));
    const req = { ...asObject(composer["require-dev"]), ...asObject(composer.require) };
    stack.push("php");
    if ("laravel/framework" in req) {
      stack.push("laravel");
      if (kind === "library") kind = "backend";
      if (empty(test)) test = { runner: "pestphp/pest" in req ? "pest" : "phpunit", command: "php artisan test {files}" };
      if (empty(dev)) dev = { command: "php artisan serve", url: "http://localhost:8000", urlSource: "framework-default" };
    } else if ("symfony/framework-bundle" in req) {
      stack.push("symfony");
      if (kind === "library") kind = "backend";
    }
    if (empty(test)) test = { runner: "phpunit", command: "vendor/bin/phpunit {files}" };
    if (empty(lint) && "laravel/pint" in req) lint = { command: "vendor/bin/pint {files}" };
    dbHints.push(...envDbTypes(app));
  }

  const gradle = readText(path.join(app, "build.gradle")) + readText(path.join(app, "build.gradle.kts"));
  const pom = readText(path.join(app, "pom.xml"));
  if (gradle || pom) {
    stack.push(exists(path.join(app, "build.gradle.kts")) || gradle.includes("kotlin") ? "kotlin" : "java");
    if (gradle.includes("spring-boot") || pom.includes("spring-boot")) {
      stack.push("spring");
      if (kind === "library") kind = "backend";
    }
    if (empty(test)) test = { runner: "junit", command: gradle ? "./gradlew test --tests {files}" : "./mvnw -Dtest={files} test" };
    if (stack.includes("spring") && empty(dev)) {
      dev = { command: gradle ? "./gradlew bootRun" : "./mvnw spring-boot:run", url: "http://localhost:8080",
        urlSource: "framework-default" };
    }
  }

  if (exists(path.join(app, "pubspec.yaml"))) {
    stack.push("flutter");
    kind = "mobile";
    if (empty(test)) test = { runner: "flutter", command: "flutter test {files}" };
  }

  return {
    name: path.basename(app),
    path: rel,
    kind,
    stack: unique(stack),
    packageManager: exists(path.join(app, "package.json")) ? pm : null,
    test,
    lint,
    dev,
    dbHints: unique(dbHints),
  };
}

// ---------------------------------------------------------------------------
// Database

/** @param {string} root */
function envFiles(root) {
  const names = [".env.example", ".env.sample", ".env.local", ".env", ".env.development"];
  const dirs = [root];
  for (const parent of [...APP_PARENTS, ...SPLIT_DIRS]) {
    const base = path.join(root, parent);
    if (isDir(base)) dirs.push(base, ...listDirs(base));
  }
  return unique(dirs.flatMap((d) => names.map((n) => path.join(d, n)))).filter((f) => {
    try {
      return fs.statSync(f).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * Variables whose value is a DB URL. Reports name + scheme only, never the value.
 * @param {string} root @param {string[]} files
 */
function envUrlVars(root, files) {
  /** @type {{ envFile: string, envVar: string, type: string }[]} */
  const out = [];
  const pattern = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*['"]?([a-z+]+):\/\//gm;
  for (const file of files) {
    for (const m of readText(file).matchAll(pattern)) {
      const type = URL_SCHEMES[m[2]];
      if (type) out.push({ envFile: path.relative(root, file).split(path.sep).join("/"), envVar: m[1], type });
    }
  }
  return out;
}

/** @param {string} app */
function envDbTypes(app) {
  return unique(envUrlVars(app, [path.join(app, ".env.example"), path.join(app, ".env")]).map((c) => c.type));
}

/** @param {string} root @param {string} pattern simple `*` glob over one directory level */
function globOne(root, pattern) {
  const [dir, base] = pattern.includes("/") ? [path.dirname(pattern), path.basename(pattern)] : [".", pattern];
  const re = new RegExp(`^${base.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  try {
    return fs.readdirSync(path.join(root, dir)).filter((n) => re.test(n)).map((n) => path.join(root, dir, n));
  } catch {
    return [];
  }
}

/**
 * @param {string} root
 * @param {ReturnType<typeof detectApp>[]} apps
 */
export function detectDb(root, apps) {
  /** @type {Map<string, string[]>} */
  const votes = new Map();
  const vote = (/** @type {string} */ kind, /** @type {string} */ why) => {
    votes.set(kind, [...(votes.get(kind) ?? []), why]);
  };
  for (const app of apps) {
    for (const hint of app.dbHints) if (["mongodb", "postgres", "mysql"].includes(hint)) vote(hint, `dependency in ${app.path}`);
  }
  const schemas = [path.join(root, "prisma", "schema.prisma"),
    ...listDirs(root).map((d) => path.join(d, "prisma", "schema.prisma")),
    ...listDirs(root).flatMap((d) => listDirs(d).map((s) => path.join(s, "prisma", "schema.prisma")))];
  for (const schema of schemas.filter((s) => exists(s))) {
    const m = /provider\s*=\s*"(postgresql|mysql|mongodb)"/.exec(readText(schema));
    if (m) vote(m[1] === "postgresql" ? "postgres" : m[1], `prisma provider in ${path.relative(root, schema)}`);
  }
  for (const compose of [...globOne(root, "docker-compose*.y*ml"), ...globOne(root, "compose*.y*ml")]) {
    const text = readText(compose);
    for (const [image, kind] of [["mongo", "mongodb"], ["postgres", "postgres"], ["mysql", "mysql"], ["mariadb", "mysql"]]) {
      if (new RegExp(`image:\\s*['"]?[\\w./-]*${image}`).test(text)) vote(kind, `${image} image in ${path.basename(compose)}`);
    }
  }
  const envVars = envUrlVars(root, envFiles(root));
  for (const item of envVars) vote(item.type, `${item.envVar} in ${item.envFile}`);
  const candidates = [...votes.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([type, evidence]) => ({ type, score: evidence.length, evidence: evidence.slice(0, 6),
      envCandidates: envVars.filter((e) => e.type === type) }));
  return { detected: candidates.length > 0, candidates };
}

// ---------------------------------------------------------------------------
// Tickets, design system, existing .claude

/** @param {string} root */
export function detectTickets(root) {
  let github = null;
  for (const line of git(root, "remote", "-v").split("\n")) {
    const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\s/.exec(`${line} `);
    if (m) {
      github = `${m[1]}/${m[2]}`;
      break;
    }
  }
  const text = `${git(root, "log", "-n", "300", "--format=%s%n%b")}\n${git(root, "branch", "-a", "--format=%(refname:short)")}`;
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const m of text.matchAll(JIRA_KEY)) {
    if (!JIRA_STOPLIST.has(m[1])) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  const jiraKeys = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).filter(([, n]) => n >= 2).map(([k]) => k);
  return {
    platforms: [...(jiraKeys.length ? ["jira"] : []), ...(github ? ["github"] : [])],
    github: github ? { repo: github } : null,
    jira: jiraKeys.length ? { projectKeys: jiraKeys } : null,
  };
}

/** @param {string} root @param {ReturnType<typeof detectApp>[]} apps */
export function detectDesignSystem(root, apps) {
  const bases = [root, ...apps.filter((a) => a.path !== ".").map((a) => path.join(root, a.path))];
  return unique(bases.flatMap((base) => DESIGN_SYSTEM_PATHS.map((rel) => path.join(base, rel)))
    .filter((p) => exists(p))
    .map((p) => path.relative(root, p).split(path.sep).join("/")));
}

/** @param {string} root */
export function detectExistingClaude(root) {
  const claude = path.join(root, ".claude");
  const skills = isDir(path.join(claude, "skills")) ? fs.readdirSync(path.join(claude, "skills")).sort() : [];
  const commands = isDir(path.join(claude, "commands"))
    ? fs.readdirSync(path.join(claude, "commands")).filter((n) => n.endsWith(".md")).map((n) => n.slice(0, -3)).sort()
    : [];
  const mcp = asObject(readJsonSafe(path.join(root, ".mcp.json")).mcpServers);
  const own = new Set([...skills, ...commands]);
  return {
    claudeMd: exists(path.join(root, "CLAUDE.md")),
    agentsMd: exists(path.join(root, "AGENTS.md")),
    skills,
    commands,
    mcpServers: Object.keys(mcp).sort(),
    zerossInstalled: exists(path.join(claude, "zeross", "manifest.json")),
    nameClashes: ZEROSS_SKILLS.filter((s) => own.has(s)).sort(),
  };
}

/** @param {string} root */
export function runDetect(root) {
  const pm = packageManager(root);
  const { isMonorepo, appDirs } = discoverAppDirs(root);
  const apps = appDirs.map((d) => detectApp(root, d, packageManager(d, pm)));
  return {
    root,
    name: path.basename(root),
    monorepo: isMonorepo,
    monorepoSignals: monorepoSignals(root),
    packageManager: pm,
    apps,
    db: detectDb(root, apps),
    tickets: detectTickets(root),
    designSystemCandidates: detectDesignSystem(root, apps),
    existing: detectExistingClaude(root),
  };
}
