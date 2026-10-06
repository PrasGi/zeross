# Changelog

All notable changes to zeross. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/).

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
