// test/guard.test.js
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "templates", "project", "zeross", "bin", "zeross-guard.mjs");
const guard = await import(pathToFileURL(SCRIPT).href);

const temps = [];
/** A fresh, symlink-resolved temp dir; never under the real ~/.claude. */
function tmp() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "zeross-")));
  temps.push(dir);
  return dir;
}
after(() => temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
beforeEach(() => {
  process.env.CLAUDE_CONFIG_DIR = tmp();
});

const BUILDS = [
  "npm run build",
  "pnpm build",
  "pnpm --filter web build",
  "yarn build:prod",
  "cd apps/web && next build",
  "npx tsc -b",
  "turbo run build",
  "docker build -t x .",
  "docker compose build api",
  "vite build",
  "pnpm run --filter web build",
  "pnpm run -r build",
  "npm run-script build",
  "yarn workspace web build",
  "nx run web:build",
  "nx run-many -t build",
  "./gradlew build",
  "mvn verify",
  "HUSKY=0 pnpm build",
  "env NODE_ENV=production npm run build",
  "bun build ./index.ts",
];
for (const command of BUILDS) {
  test(`builds are blocked: ${command}`, () => {
    assert.match(guard.decide(command, ".") ?? "", /builds run only/);
  });
}

const WHOLE_SUITE = [
  "pnpm vitest",
  "npx vitest run",
  "pnpm test",
  "npm run test",
  "pnpm --filter web test",
  "jest -t 'login'",
  "pytest",
  "go test ./...",
  "php artisan test",
  "./gradlew test",
  "pnpm vitest run src/a.test.ts --coverage",
  "npx vitest run src/",
  "npx jest ./",
  "npx vitest run --outputFile report/x.json",
  "vendor/bin/phpunit",
  "npx playwright test",
  "npm t",
  "python -m pytest",
  "CI=1 pnpm test",
];
for (const command of WHOLE_SUITE) {
  test(`whole suite and coverage are blocked: ${command}`, () => {
    assert.match(guard.decide(command, ".") ?? "", /Blocked by zeross/);
  });
}

const ALLOWED = [
  "pnpm exec vitest run src/features/login/login.test.ts",
  "npx vitest run apps/web/src/a.spec.tsx -t 'submits'",
  "pnpm test -- src/utils/date.test.ts",
  "jest src/x.test.js",
  "pytest tests/test_users.py::test_create",
  "go test ./internal/billing",
  "php artisan test tests/Feature/LoginTest.php",
  "./gradlew test --tests com.acme.UserServiceTest",
  "pnpm add -D @testing-library/react",
  "git status && pnpm lint src/a.ts",
  "ZEROSS_ALLOW_BUILD=1 pnpm build",
  "ZEROSS_ALLOW_FULL_TESTS=1 pnpm vitest run",
  "echo build",
  'git commit -m "fix(ci): make next build pass"',
  'git commit -m "test(api): cover jest edge case"',
  'grep -rn "npm run build" docs',
  "pnpm add -D vitest",
  "npm i -D eslint-plugin-jest",
  "php artisan test --filter UserTest",
  "npx jest --testPathPattern users",
  "npx vitest run src/features/login",
  "pnpm --filter web exec vitest run src/a.test.ts",
  "npx jest path/to/x.test.ts --runInBand",
];
for (const command of ALLOWED) {
  test(`targeted and unrelated commands pass: ${command}`, () => {
    assert.equal(guard.decide(command, "."), null);
  });
}

test("tokens follow POSIX quoting and fall back on unbalanced quotes", () => {
  assert.deepEqual(guard.tokens(`jest -t 'a b' "c \\"d\\"" e\\ f ''`), ["jest", "-t", "a b", 'c "d"', "e f", ""]);
  assert.deepEqual(guard.tokens("echo 'unterminated x"), ["echo", "'unterminated", "x"]);
});

test("segments split on shell operators", () => {
  assert.deepEqual(guard.segments("a && b || c; d | e\nf"), ["a", "b", "c", "d", "e", "f"]);
});

test("force-push and protected push are blocked", () => {
  const cwd = tmp();
  assert.match(guard.decide("git push --force origin feature/x", cwd), /force-push/);
  assert.match(guard.decide("git push origin +feature/x", cwd), /force-push/);
  assert.match(guard.decide("git push origin main", cwd), /protected branch main/);
  assert.match(guard.decide("git push origin HEAD:develop", cwd), /protected branch develop/);
  assert.equal(guard.decide("git push -u origin fix/ABC-1-login", cwd), null);
});

test("plain push checks the current branch", () => {
  const cwd = tmp();
  const git = (...args) => assert.equal(spawnSync("git", args, { stdio: "ignore" }).status, 0);
  git("init", "-q", "-b", "main", cwd);
  git("-C", cwd, "-c", "user.email=a@b", "-c", "user.name=a", "commit", "--allow-empty", "-qm", "init");
  assert.match(guard.decide("git push", cwd), /protected branch main/);
});

test("hook protocol: exit 2 with stderr blocks, exit 0 allows", () => {
  const cwd = tmp();
  const payload = { tool_name: "Bash", tool_input: { command: "pnpm build" }, cwd };
  const run = (p) => spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify(p), encoding: "utf8", env: process.env });
  const blocked = run(payload);
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /Blocked by zeross/);
  payload.tool_input.command = "ls";
  assert.equal(run(payload).status, 0);
  assert.equal(spawnSync(process.execPath, [SCRIPT], { input: "not json", encoding: "utf8" }).status, 0);
});

test("push bypasses found in review are blocked", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "zeross-guard-"));
  spawnSync("git", ["init", "-q", "-b", "main", repo]);
  spawnSync("git", ["-C", repo, "-c", "user.email=a@b", "-c", "user.name=a", "commit", "--allow-empty", "-qm", "i"]);
  for (const cmd of ["git push origin HEAD", "git push -u origin HEAD", "HUSKY=0 git push", "HUSKY=0 git push --force origin x",
    "/usr/bin/git push -f", "command git push origin main", "git push -uf origin x", "git push -o ci.skip origin",
    "git -C . push origin main", "git push origin --delete main", "git push origin :main", "git push --all origin"]) {
    assert.ok(guard.decide(cmd, repo), cmd);
  }
  for (const cmd of ["git push origin feature/main-fix", "git push --force-with-lease origin fix/x", "git push -u origin fix/ABC-1"]) {
    assert.equal(guard.decide(cmd, repo), null, cmd);
  }
});
