---
name: zero-update
description: Update zeross — check for a newer version, preview template changes for this project (new, safe updates, locally modified, removed, new config keys, MCP pin bumps), apply after approval, then re-run the per-user checks.
argument-hint: "[check]"
disable-model-invocation: true
---

# /zero-update

Input: `$ARGUMENTS` (`check` → stop after step 2).

Read `.claude/zeross/workflow/questions.md`. Nothing is written before the user
approves the preview.

## 1. Resolve the CLI

- `zeross --version`. Not on PATH → use `npx -y zeross-cli …` for every call
  below, and note that a one-shot install is in use.
- Every call uses `--json`; parse the JSON, never scrape text.
- A command fails → show the error and stop.

## 2. Version check

Run `zeross update check --json`: installed vs latest version, how zeross was
installed (`method`) and the matching `upgrade` command. Prefer that `upgrade`
command; the table below is the fallback when `method` is `unknown`.

Up to date → say so and continue to step 3 (templates can still lag the CLI).
Newer version → explain the upgrade command for the install path, show it in its own
fenced code block (never inline before punctuation), then ask the user to run it and
re-invoke `/zero-update` (the running CLI must be the new one):

| Install path | Upgrade |
|---|---|
| `npm i -g zeross-cli` | `npm install -g zeross-cli@latest && zeross install` |
| `npx zeross-cli` | `npx -y zeross-cli@latest install` (then `npx -y zeross-cli@latest …` for every call) |
| `pnpm add -g zeross-cli` | `pnpm add -g zeross-cli@latest && zeross install` |
| `bun add -g zeross-cli` | `bun add -g zeross-cli@latest && zeross install` |
| `npm i -g github:PrasGi/zeross` | `npm i -g github:PrasGi/zeross` again (same ref), then `zeross install` |
| clone + `npm i -g .` / `npm link` | `git pull` in the clone (re-run `npm i -g .` if not linked), then `zeross install` |

Unknown path → show the table and ask which applies. Never run the upgrade without
the user's go-ahead.

## 3. Diff

Run `zeross update diff --json` and present one preview table:

| Category | Files / keys | What happens |
|---|---|---|
| New | new templates/components | created |
| Updated (safe) | tracked, unmodified locally | replaced |
| Modified locally | tracked, edited by the team | **kept**; new version written as `<file>.zeross-new` |
| Removed | dropped from the templates | listed; removed only if unmodified |
| New config keys | `newKeys` on the `files[]` entry for `.claude/zeross/config.json` | added with their defaults (add-only; existing values untouched) |
| MCP pin bumps | `pinBumps` (`mcp.pins.*` old → new) | updated only with `--bump-pins` (asked in step 4) |

Rendered rule files under `.claude/rules/zeross/` (e.g. `ui.md`, re-rendered from
`config.json → ui`) follow the same file rules. The guard hook is installed or kept
only when `config.json → hooks.guard` is true (default); `false` means the team
turned it off, so never re-add it.

For each "modified locally" file, offer to show the diff between the local file and
the new template. Nothing to change → say so and go to step 6.

## 4. Approve and apply

One `AskUserQuestion` call:

- **Apply the update?** Apply (Recommended) / Cancel.
- **Bump MCP pins?** Only when `pinBumps` is non-empty: list each `old → new` in the
  description. Bump pins (Recommended) / Keep current pins.

Then run `zeross update apply --json`, adding `--bump-pins` only when the user
approved the bump (the no-overwrite policy is enforced by the CLI). Report what was
created, updated, sidecar-written and skipped.

For each `.zeross-new` sidecar, tell the user how to resolve it: merge by hand (or
ask Claude to merge), then delete the sidecar.

## 5. New config keys

The apply step already added the new keys with their defaults; nothing is asked
before it. Afterwards:

1. Show each new key with the default value it got (read them from
   `.claude/zeross/config.json`).
2. Offer to change any of them. On a change, show the previewed JSON diff of
   `.claude/zeross/config.json`, edit it directly after the user confirms (only
   those keys; never remove or rewrite other keys), and validate against
   `.claude/zeross/config.schema.json`. A change to `ui.*` → run
   `zeross update apply --json` again to re-render `.claude/rules/zeross/ui.md`.

## 6. Per-user checks

1. `zeross verify --json` → manifest files present, hashes match, the guard hook
   registered (only when `hooks.guard` is true), plus the role auth tests (repo,
   Jira project keys). Report its `actionNeeded` items (e.g. a pending MCP or org
   approval) apart from failures, and mention `duplicates` and `plaintextSecrets`
   with a recommendation; never delete or edit those configs yourself.
2. For every role configured in `~/.claude/zeross/profile.json → mcpRoles` that
   `verify` did not already test: `zeross mcp test <role> --json`. Report
   Connected / failed per role. A failed
   role → suggest `/zeross` (per-user setup) to repair it. After a pin bump, remind
   the user to reconnect via `/mcp`.
3. `zeross doctor --json` → Chromium present for Playwright. Missing → ask, then
   run `npx playwright install chromium`.

## Report

Version (old → new), files by category, sidecars to resolve, config keys added
(with their values), pins bumped or kept, MCP roles status, Chromium status. Next step: commit the updated `.claude/` (and
`.mcp.json` if pins changed) so teammates get the same version — the user commits;
this command never commits.
