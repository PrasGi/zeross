// test/_core-helpers.js
// @ts-check
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach } from "node:test";

/** Fresh temp dir per call. */
export const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "zeross-"));

/**
 * Point CLAUDE_CONFIG_DIR at a temp dir before every test in the calling file,
 * so tests never touch the real ~/.claude. Returns a getter for the current home.
 */
export function isolateClaudeHome() {
  let home = "";
  beforeEach(() => {
    home = tempDir();
    process.env.CLAUDE_CONFIG_DIR = home;
    for (const v of ["ORCA_TERMINAL_HANDLE", "ORCA_WORKSPACE_ID", "GITHUB_PERSONAL_ACCESS_TOKEN", "JIRA_API_TOKEN"]) {
      delete process.env[v];
    }
  });
  return () => home;
}

/** A minimal git project with a Next.js app. */
export function makeProject() {
  const root = path.join(tempDir(), "proj");
  fs.mkdirSync(root);
  execFileSync("git", ["init", "-q", root]);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "proj",
    scripts: { dev: "next dev -p 3100" },
    dependencies: { next: "15", react: "19", mongoose: "8" },
    devDependencies: { vitest: "3", eslint: "9", typescript: "5", tailwindcss: "4" },
  }));
  fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  fs.writeFileSync(path.join(root, ".env.example"), "MONGODB_URI=mongodb://localhost:27017/app\nPORT=3100\n");
  return root;
}

/** @param {string} file */
export const readJsonFile = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
