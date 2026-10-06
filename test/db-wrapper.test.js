// test/db-wrapper.test.js
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(REPO, "templates", "project", "zeross", "bin", "db-mcp.mjs");
const db = await import(pathToFileURL(SOURCE).href);

const temps = [];
/** A fresh, symlink-resolved temp dir; never under the real ~/.claude. */
function tmp() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "zeross-")));
  temps.push(dir);
  return dir;
}
after(() => temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

/** Copy the committed wrapper into a project, as `zeross apply` would. */
function installScript(root) {
  const dest = path.join(root, ".claude", "zeross", "bin", "db-mcp.mjs");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(SOURCE, dest);
  return dest;
}

function dryRun(root, envLine, config, local) {
  const script = installScript(root);
  const zdir = path.join(root, ".claude", "zeross");
  fs.writeFileSync(path.join(zdir, "config.json"), JSON.stringify(config ?? { db: { envFile: ".env", envVar: "DATABASE_URL" } }));
  if (local !== undefined) fs.writeFileSync(path.join(zdir, "local.json"), JSON.stringify(local));
  fs.writeFileSync(path.join(root, ".env"), envLine + "\n");
  const out = spawnSync(process.execPath, [script, "--dry-run"], {
    encoding: "utf8",
    env: { ...process.env, CLAUDE_CONFIG_DIR: tmp() },
  });
  assert.equal(out.status, 0, out.stderr);
  assert.ok(!(out.stdout + out.stderr).includes("s3cr3t"), "the password must never be printed");
  return JSON.parse(out.stdout);
}

const CASES = [
  ["postgres://u:s3cr3t@localhost:5432/app", "local", true],
  ["mongodb://u:s3cr3t@127.0.0.1:27017/app", "local", true],
  ["mysql://u:s3cr3t@staging-db.acme.io:3306/app", "remote", false],
  ["postgres://u:s3cr3t@prod-db.acme.io:5432/app", "production", false],
  ["mongodb+srv://u:s3cr3t@cluster0.abc.mongodb.net/app", "remote", false],
];
for (const [url, hostClass, writable] of CASES) {
  test(`host classification and default write policy: ${hostClass} ${url.split("@")[1]}`, () => {
    const result = dryRun(tmp(), `DATABASE_URL="${url}"`);
    assert.equal(result.hostClass, hostClass);
    assert.equal(result.writable, writable);
  });
}

test("compose services and devHosts are writable", () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, "docker-compose.yml"), "services:\n  mongo:\n    image: mongo:7\n");
  assert.equal(dryRun(root, "DATABASE_URL=mongodb://mongo:27017/app").hostClass, "dev");
  const config = { db: { envFile: ".env", envVar: "DATABASE_URL", devHosts: ["dev-db.acme.io"] } };
  assert.equal(dryRun(root, "DATABASE_URL=postgres://u:s3cr3t@dev-db.acme.io/app", config).writable, true);
});

test("explicit grant enables writes until expiry", () => {
  const root = tmp();
  const url = "DATABASE_URL=mysql://u:s3cr3t@staging-db.acme.io/app";
  const granted = dryRun(root, url, undefined, { dbGrants: { "staging-db.acme.io": { scope: "persistent" } } });
  assert.equal(granted.writable, true);
  assert.match(granted.reason, /granted/);
  const expired = dryRun(root, url, undefined, {
    dbGrants: { "staging-db.acme.io": { scope: "session", expiresAt: "2000-01-01T00:00:00Z" } },
  });
  assert.equal(expired.writable, false);
  const future = dryRun(root, url, undefined, {
    dbGrants: { "staging-db.acme.io": { scope: "session", expiresAt: "2999-01-01T00:00:00+00:00" } },
  });
  assert.equal(future.writable, true);
  assert.match(future.reason, /granted \(session\)/);
});

test("env file is parsed, not executed", () => {
  const root = tmp();
  const marker = path.join(root, "pwned");
  const result = dryRun(root, `DATABASE_URL=postgres://localhost/app # $(touch ${marker})`);
  assert.equal(result.engine, "postgres");
  assert.ok(!fs.existsSync(marker));
});

test("dry-run reports the decision fields and the pinned server", () => {
  const result = dryRun(tmp(), "DATABASE_URL=postgres://u:s3cr3t@localhost/app");
  assert.deepEqual(Object.keys(result), ["engine", "server", "envFile", "envVar", "hosts", "hostClass", "writable", "reason"]);
  assert.equal(result.server, "@bytebase/dbhub@1.4.0");
  assert.deepEqual(result.hosts, ["localhost"]);
});

test("readVar keeps the last assignment and strips quotes and comments", () => {
  const file = path.join(tmp(), ".env");
  fs.writeFileSync(file, "DATABASE_URL=one\r\nexport DATABASE_URL='two # kept'\nOTHER=x\nDATABASE_URL = three # gone\n");
  assert.equal(db.readVar(file, "DATABASE_URL"), "three");
  fs.writeFileSync(file, "export DATABASE_URL='two # kept'\n");
  assert.equal(db.readVar(file, "DATABASE_URL"), "two # kept");
  assert.equal(db.readVar(path.join(tmp(), "missing"), "DATABASE_URL"), "");
});

test("hostsOf handles credentials, replica sets and IPv6", () => {
  assert.deepEqual(db.hostsOf("mongodb://u:p@A.example:1,b.example:2/app?x=1"), ["a.example", "b.example"]);
  assert.deepEqual(db.hostsOf("postgres://u:p@w@[::1]:5432/app"), ["::1"]);
});

test("stripPrismaParams and tomlStr", () => {
  assert.equal(db.stripPrismaParams("postgres://h/app?schema=public&sslmode=require&pgbouncer=true"), "postgres://h/app?sslmode=require");
  assert.equal(db.stripPrismaParams("postgres://h/app?schema=public"), "postgres://h/app");
  assert.equal(db.tomlStr('a"b\\c'), '"a\\"b\\\\c"');
});

test("unsupported scheme and missing URL fail without printing the URL", () => {
  const root = tmp();
  const script = installScript(root);
  fs.writeFileSync(path.join(root, ".claude", "zeross", "config.json"), JSON.stringify({ db: { envFile: ".env", envVar: "DATABASE_URL" } }));
  fs.writeFileSync(path.join(root, ".env"), "DATABASE_URL=redis://u:s3cr3t@localhost/0\n");
  const bad = spawnSync(process.execPath, [script, "--dry-run"], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^db-mcp: unsupported URL scheme 'redis'/);
  assert.ok(!(bad.stdout + bad.stderr).includes("s3cr3t"));
  fs.writeFileSync(path.join(root, ".env"), "OTHER=1\n");
  const missing = spawnSync(process.execPath, [script, "--dry-run"], { encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no DATABASE_URL found in \.env/);
});

test("hosts hidden in the query string or missing hosts are never local", async () => {
  const m = await import(pathToFileURL(SOURCE).href);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeross-"));
  for (const url of ["postgres://app:x@/app?host=prod-db.acme.io", "postgresql:///app?host=db.acme.io",
    "postgres://u:p@localhost/db?host=/cloudsql/proj:region:inst"]) {
    assert.notEqual(m.classify(m.hostsOf(url), ".env", [], root), "local", url);
  }
  assert.equal(m.classify(m.hostsOf("postgres://u:p@/db?host=/tmp"), ".env", [], root), "local");
  assert.equal(m.classify([], ".env", [], root), "remote");
});

test("a production env file wins over a local-looking host", async () => {
  const m = await import(pathToFileURL(SOURCE).href);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeross-"));
  assert.equal(m.classify(["localhost"], ".env.production", [], root), "production");
  assert.equal(m.classify(["localhost"], "apps/api/.env.prod.local", [], root), "production");
});

test("grants need an explicit scope, and session grants need a future expiry", async () => {
  const m = await import(pathToFileURL(SOURCE).href);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeross-"));
  const write = (/** @type {any} */ grant) =>
    fs.writeFileSync(path.join(dir, "local.json"), JSON.stringify({ dbGrants: { "db.acme.io": grant } }));
  for (const bad of [{}, { scope: "session" }, { scope: "forever" }, null]) {
    write(bad);
    assert.equal(m.activeGrant(["db.acme.io"], dir), null, JSON.stringify(bad));
  }
  write({ scope: "session", expiresAt: new Date(Date.now() + 3600e3).toISOString() });
  assert.ok(m.activeGrant(["db.acme.io"], dir));
});

test("quoted values with a trailing comment parse", async () => {
  const m = await import(pathToFileURL(SOURCE).href);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zeross-")), ".env");
  fs.writeFileSync(file, 'DATABASE_URL="postgres://localhost/app" # local db\n');
  assert.equal(m.readVar(file, "DATABASE_URL"), "postgres://localhost/app");
});
