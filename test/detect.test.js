// test/detect.test.js
// @ts-check
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runDetect } from "../lib/detect.js";
import { makeProject, tempDir } from "./_core-helpers.js";

test("a single Next.js app", () => {
  const result = runDetect(makeProject());
  assert.equal(result.monorepo, false);
  const [app] = result.apps;
  assert.equal(app.kind, "frontend");
  for (const s of ["nextjs", "react", "tailwind", "typescript"]) assert.ok(app.stack.includes(s), s);
  assert.equal(app.test.command, "pnpm exec vitest run {files}");
  assert.deepEqual(app.dev, { command: "pnpm dev", url: "http://localhost:3100", urlSource: "script" });
  assert.equal(result.db.candidates[0].type, "mongodb");
});

test("the env scan never returns secret values", () => {
  const root = makeProject();
  fs.writeFileSync(path.join(root, ".env"), "DATABASE_URL=postgres://admin:s3cr3t@db.internal:5432/app\n");
  const dumped = JSON.stringify(runDetect(root));
  assert.ok(!dumped.includes("s3cr3t") && !dumped.includes("db.internal"));
  assert.ok(dumped.includes("DATABASE_URL"));
});

test("a monorepo with a frontend, a backend and a Go service", () => {
  const root = path.join(tempDir(), "mono");
  /** @param {string} rel @param {string} text */
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  put("pnpm-workspace.yaml", "packages: ['apps/*']\n");
  put("pnpm-lock.yaml", "");
  put("apps/web/package.json", JSON.stringify({ dependencies: { vue: "3" }, devDependencies: { vitest: "3" } }));
  put("apps/api/package.json", JSON.stringify({ dependencies: { "@nestjs/core": "10", pg: "8" }, devDependencies: { jest: "29" } }));
  put("services/worker/go.mod", "module w\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.0\n\tgithub.com/jackc/pgx/v5 v5.5.0\n)\n");
  const result = runDetect(root);
  const byPath = Object.fromEntries(result.apps.map((a) => [a.path, a]));
  assert.equal(result.monorepo, true);
  assert.deepEqual([byPath["apps/web"].kind, byPath["apps/web"].packageManager], ["frontend", "pnpm"]);
  assert.deepEqual([byPath["apps/api"].kind, byPath["apps/api"].packageManager], ["backend", "pnpm"]);
  assert.equal(byPath["services/worker"].kind, "backend");
  assert.equal(result.db.candidates[0].type, "postgres");
});

test("tickets come from the git remote and history", () => {
  const root = makeProject();
  const git = ["-C", root, "-c", "user.email=a@b", "-c", "user.name=a"];
  execFileSync("git", [...git, "remote", "add", "origin", "git@github.com:acme/proj.git"]);
  for (const msg of ["feat(auth): add login VTX-12", "fix: VTX-13 crash", "chore: utf UTF-8 ISO-8601 cleanup"]) {
    execFileSync("git", [...git, "commit", "--allow-empty", "-qm", msg]);
  }
  const { tickets } = runDetect(root);
  assert.deepEqual(tickets.github, { repo: "acme/proj" });
  assert.deepEqual(tickets.jira, { projectKeys: ["VTX"] });
  assert.deepEqual(tickets.platforms, ["jira", "github"]);
});

test("malformed manifests do not crash detection", () => {
  const root = makeProject();
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: "dev", dependencies: ["next"] }));
  assert.doesNotThrow(() => runDetect(root));
});

test("DB env candidates get a host class without exposing the URL", () => {
  const root = makeProject();
  fs.writeFileSync(path.join(root, "docker-compose.yml"), "services:\n  postgres:\n    image: postgres:16\n");
  fs.writeFileSync(path.join(root, ".env"), [
    "LOCAL_DATABASE_URL=postgres://u:s3cr3t@72.61.141.67:5432/app",
    "DOCKER_DB_URL=postgres://u:p@postgres:5432/app",
    "DEV_DB_URL=postgres://u:p@localhost:5432/app",
    "REF_DB_URL=postgres://${DB_HOST}/app",
  ].join("\n"));
  const out = runDetect(root);
  const pg = out.db.candidates.find((c) => c.type === "postgres");
  const byVar = Object.fromEntries(pg.envCandidates.map((e) => [e.envVar, e.hostClass]));
  assert.deepEqual(byVar, { LOCAL_DATABASE_URL: "remote", DOCKER_DB_URL: "docker", DEV_DB_URL: "local", REF_DB_URL: "unknown" });
  assert.ok(!JSON.stringify(out).includes("72.61.141.67") && !JSON.stringify(out).includes("s3cr3t"));
});

test("only dominant Jira keys survive, branch names weigh more", () => {
  const root = makeProject();
  const git = ["-C", root, "-c", "user.email=a@b", "-c", "user.name=a"];
  for (let i = 0; i < 10; i++) execFileSync("git", [...git, "commit", "--allow-empty", "-qm", `feat: EP-${i} work`]);
  for (const msg of ["chore: API-1 note", "chore: API-2 note", "fix: CODE-3", "fix: CODE-4"]) execFileSync("git", [...git, "commit", "--allow-empty", "-qm", msg]);
  assert.deepEqual(runDetect(root).tickets.jira, { projectKeys: ["EP"] });
});

test("existing project rules, e2e suites, login routes and blocking deny rules are reported", () => {
  const root = makeProject();
  const put = (/** @type {string} */ rel, /** @type {string} */ text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  put(".claude/rules/frontend.md", "# FE");
  put(".claude/rules/zeross/core.md", "# ours");
  put("e2e/login.spec.ts", "");
  put("src/app/(auth)/sign-in/page.tsx", "export default function P() {}");
  put(".claude/settings.json", JSON.stringify({ permissions: { deny: ["Edit(~/**)", "Edit(~/.ssh/**)", "Read(.env)"] } }));
  const out = runDetect(root);
  assert.deepEqual(out.existing.projectRules, [".claude/rules/frontend.md"]);
  assert.equal(out.existing.e2e.detected, true);
  assert.ok(out.loginRouteCandidates.includes("src/app/(auth)/sign-in/page.tsx"));
  const denied = out.existing.denyConflicts.map((d) => d.rule);
  assert.ok(denied.includes("Edit(~/**)") || root.startsWith(os.homedir()) === false);
  assert.ok(!denied.includes("Edit(~/.ssh/**)"));
});

test("a worker under apps/ with a long-running script is a backend", () => {
  const root = path.join(tempDir(), "mono2");
  fs.mkdirSync(path.join(root, "apps", "workers"), { recursive: true });
  fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages: ['apps/*']\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ devDependencies: { eslint: "9" } }));
  fs.writeFileSync(path.join(root, "apps", "workers", "package.json"), JSON.stringify({ scripts: { dev: "tsx watch src/main.ts", lint: "eslint ." }, devDependencies: { vitest: "3" } }));
  const [app] = runDetect(root).apps;
  assert.equal(app.kind, "backend");
  assert.ok(app.lint.command.includes("eslint"));
});
