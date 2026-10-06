# Changelog

All notable changes to zeross. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/).

## [0.1.2] - 2026-10-07

### Changed
- With `rules.e2e: follow-project`, `/zero-fix-bug`, `/zero-build-small-feature` and `/zero-build-feature`
  now ask before the fix/build phase whether final validation is the live Playwright MCP only or also an
  e2e spec, and only when the touched app has an e2e setup. No e2e spec is created without that answer;
  apps without e2e are validated through the Playwright MCP without a question.
- CI: `actions/checkout` v7.0.1 and `actions/setup-node` v7.0.0 (Node 24 runtime), pinned by SHA,
  replacing the deprecated Node 20 versions.

## [0.1.1] - 2026-10-06

### Fixed
- An ambient shell `GITHUB_PERSONAL_ACCESS_TOKEN` / `JIRA_API_TOKEN` no longer overrides the
  workspace's keychain token: the wrapper now resolves keychain → direnv of the workspace root →
  environment.
- `zeross secret set` rejects malformed service names (e.g. a copied trailing `.`) and names no
  workspace or known pattern references, instead of creating a stray keychain item (`--force`
  overrides the reference check).
- `/zeross` shows every command you must run in its own code block, reports actions only after
  they finished, keeps the session language, prefers single commands over compound pipelines,
  and never prints token length, prefix or hash.
- Jira project keys from detection are filtered to the keys that really occur.
- `zeross verify` reports a pending MCP approval as "action needed" instead of a failure.

### Added
- `zeross secret import` moves an existing token from an `.envrc` (`--from-envrc --var`) or an
  MCP config (`--from-mcp-json --server --env`) into the keychain without printing it.
- `zeross detect`: DB host class per env candidate, git branches and a recommended base branch,
  extra test configs, root ESLint fallback, backend workers in `apps/*`, design token files,
  dark-mode and i18n hints, login route candidates, existing project rules, existing e2e tests,
  and committed permission deny rules that would block the zero-* commands.
- `zeross mcp check`: scope, file and plaintext secrets per equivalent server, plus shadowing
  across scopes.
- `zeross mcp test github`: token kind, credential source, environment override, org status,
  a hint on 404 (resource owner / pending org approval), `--service` to test a keychain item;
  `--repo` defaults to the configured repo.
- `zeross mcp test jira` checks every configured project key.
- `zeross verify` runs the role auth tests (skip with `--no-mcp`) and reports duplicate MCP
  servers and plaintext secrets in MCP configs.
- Config `rules.e2e`: `none` (default, no new e2e files) or `follow-project` (follow the
  project's existing e2e conventions; only the related spec runs).

### Changed
- One workspace = one GitHub org + one Jira site: `zeross mcp add` records them, reports
  whether the workspace was created or updated, and warns when a project would mix them.
- `/zeross` setup: warns about blocking deny rules, asks about existing e2e tests and project
  rules, recommends the detected base branch, checks reviewers against collaborators, splits the
  MCP question into workspace root / server / token source, prefers local or docker DB hosts,
  and shows a mandatory preview table before applying.
- `git.protectedBranches` now includes `dev` by default.
- The `.envrc` zeross block starts with a comment explaining that values come from the OS
  keychain.
- Scratch files go to `.claude/zeross/local/` (gitignored) when a project forbids temp dirs.

## [0.1.0] - unreleased

### Added
- npm package `zeross-cli` (the command is `zeross`): `npm i -g zeross-cli`, `npx zeross-cli install`,
  `pnpm add -g` / `bun add -g`, or from git / a clone. Requires Node.js ≥ 22.
- `zeross` CLI in plain JavaScript (ESM + JSDoc), zero runtime dependencies, no build step:
  `install`, `uninstall`, `doctor`, `status`, `detect`, `apply`, `verify`, `mcp`, `secret`, `update`,
  `profile`, `local`, all with `--json`. `update check` detects the install method and prints the
  matching upgrade command.
- Global `/zeross` setup skill with join mode for teammates; optional `/zero-indonesia`.
- Project skills: `zero-fix-bug`, `zero-build-small-feature`, `zero-build-feature`, `zero-create-pr`,
  `zero-update`, `zero-learn`, `zero-security-review`, `zero-ui-review`, `zero-docs-writer`,
  `zero-pr-description`.
- Shared workflow, expert FE/BE/DB rule packs, knowledge templates.
- Manifest-based no-overwrite write policy with `.zeross-new` sidecars.
- Node MCP wrappers (`.mjs`): workspace-scoped GitHub/Jira (keychain + direnv), DB (host-classified
  write policy), Playwright (Chromium, persistent profile with automatic `--isolated` fallback).
  The Jira server itself is the third-party `mcp-atlassian`, launched via `uvx`.
- `PreToolUse` guard hook (`zeross-guard.mjs`): builds, whole-suite/coverage tests, force-push,
  protected-branch pushes.
