# zeross

One Claude Code workflow for the whole team: **efficient, secure, accurate**.

zeross installs a standard set of skills, rules, hooks and MCP servers into each
project, so every programmer fixes bugs, builds features, reviews and opens PRs
the same way:

| Command | What it does |
|---|---|
| `/zero-fix-bug <tickets…>` | Reproduce → verdict per ticket → failing test → fix → passing test → security/UI review → Playwright validation → docs → report → dummy-data cleanup |
| `/zero-build-small-feature <ticket>` | Same flow; current-state assessment instead of reproduction; size guard |
| `/zero-build-feature <ticket>` | Discovery → discussion → **plan mode** → implement in waves → reviews → validation per acceptance criterion |
| `/zero-create-pr` | Commit (on request) → PR with ticket links, reviewers, assignee via GitHub MCP |
| `/zero-security-review`, `/zero-ui-review` | Expert reviews (report-only, or fix-blockers when a command calls them) |
| `/zero-docs-writer`, `/zero-pr-description` | Module docs; PR descriptions with a mandatory Ticket section |
| `/zero-learn`, `/zero-update` | Add team knowledge/rules; update zeross and project templates |
| `/zero-indonesia` | Optional, personal: conversation in Indonesian, files stay English |

## Install

Requires **Node.js ≥ 22** (the Playwright and DB MCP servers need it anyway).

```bash
npm i -g zeross-cli && zeross install     # recommended
```

Then open Claude Code in a project and run **`/zeross`**.

Alternatives:

| Channel | Command |
|---|---|
| One-shot, no permanent install | `npx zeross-cli install` |
| pnpm / bun | `pnpm add -g zeross-cli` / `bun add -g zeross-cli`, then `zeross install` |
| Pre-release / private build (git) | `npm i -g github:PrasGi/zeross && zeross install` |
| From a clone | `npm i -g .` (or `npm link`) in the repo, then `zeross install` |

`zeross install --with-indonesia` also installs `/zero-indonesia`.

Every channel installs the same CLI: plain JavaScript, zero runtime
dependencies, no build step. The npm package is named `zeross-cli` because
`zeross` is taken on npm; the command is `zeross` either way. When `zeross` is
not on `PATH`, `npx -y zeross-cli <cmd>` works as a fallback.

The Jira MCP server (`mcp-atlassian`) is a third-party Python server that zeross
launches with `uvx mcp-atlassian==<pin>`, so only users who enable Jira also need
[`uv`](https://docs.astral.sh/uv/) (`brew install uv`).

## What `/zeross` does in a project

1. **Preflight**: device spec, recommended max parallel agents per work type,
   Orca vs Claude Code, tools.
2. **Install state**: fresh, already installed by a teammate (join mode: personal
   setup only), outdated, or partial.
3. **Scan**: apps, stacks, monorepo layout, test/lint/dev commands, DB type, Jira
   keys and GitHub repo, design-system candidates.
4. **Interview, once**: components (dependencies such as the reviews and the docs
   writer are auto-included), rule packs (expert FE/BE/DB defaults), custom rules,
   guard hook, UI review (design system, breakpoints), docs path, PR reviewers,
   capacity and executor, MCP choices, the fastest local login method.
5. **Preview**, then apply. Nothing is written before you approve.
6. **MCP**: GitHub and Jira (user scope per workspace or local), DB and
   Playwright (project scope). Each is checked, installed or reused, then tested.
7. **Verify** and hand off: commit `.claude/`, `.mcp.json`, `.gitignore`.

## Rules, tests and docs

- **Rules are native Claude Code rules** in `.claude/rules/zeross/` (`core.md`,
  `testing.md`, the chosen packs, `custom.md`, `ui.md` and an always-on `zeross.md`
  summary). Claude Code auto-loads them; in a monorepo, FE packs are scoped to the FE
  app folders and BE/DB packs to the BE app folders with `paths:` frontmatter
  (`config.json → rules.scopes`), so they load only when Claude works on matching
  files. zeross never edits `CLAUDE.md`.
- **Tests are unit tests with edge cases**, written first (test → fail → fix →
  pass). **Validation is live** through the Playwright MCP. No e2e test files unless
  you ask for them.
- **Docs are always kept current** by the fix/build commands: affected module docs
  are updated with a Changelog entry, and a module without a doc gets a short stub.

## Optional helpers

- **Context7**: up-to-date library docs over MCP (`zeross mcp add context7`, optional API key in the keychain).
- **graphify** (recommended, install it yourself): `uv tool install graphifyy && graphify install`, then `/graphify .`. zeross uses `graphify-out/` when it exists.

## Safety model

- **Never overwrites.** A manifest records the hash of every file zeross wrote:
  - unmodified files can be updated
  - team-edited files get a `.zeross-new` sidecar
  - someone else's file of the same name is reported as a conflict and left alone
  - `.gitignore`, `.claude/settings.json` and `.mcp.json` are merged add-only;
    `config.json` only gains new keys with defaults
- **Secrets** live only in the OS keychain.
  - They are read from stdin and never put in argv, files or chat output.
  - `.envrc` (direnv) loads them from the keychain by reference.
  - The one exception is `zeross secret reveal <service>`, which works only for
    `zeross-test-*` services: local test-account passwords typed into the browser
    during validation. Its output lands in the session transcript, which is
    accepted for local test accounts only.
- **DB writes:**
  - local and dev hosts are writable
  - every other host is read-only unless you grant it in your personal
    `local.json`
  - production-looking hosts (`prod` in the host or a `.env*prod*` env file) need a
    typed confirmation and get a session grant
  - every write is logged first, then offered for cleanup
- **Guard hook** (`PreToolUse` on `Bash`, on unless `config.json → hooks.guard` is
  false) blocks builds, whole-suite or coverage test runs, force-pushes and pushes
  to protected branches. Escape hatches (`ZEROSS_ALLOW_BUILD=1`,
  `ZEROSS_ALLOW_FULL_TESTS=1`) are used only on an explicit request.

## Where things live

| Path | Scope | Committed |
|---|---|---|
| `.claude/skills/zero-*/` | team | yes |
| `.claude/rules/zeross/` | team | yes |
| `.claude/zeross/{config.json,manifest.json,workflow/,knowledge/,bin/}` | team | yes |
| `.claude/zeross/local.json`, `.claude/zeross/local/` | you, this project | no |
| `~/.claude/zeross/{profile.json,workspaces.json,bin/}` | you, this machine | no |
| OS keychain `zeross-*` items | you | no |

See [`docs/architecture.md`](docs/architecture.md) for the full contracts.

## CLI

```text
zeross install | uninstall [--project-scope] [--purge]
zeross doctor | status | detect | verify            (all accept --json)
zeross apply --plan plan.json [--dry-run]
zeross mcp check|test|add <github|jira|db|playwright>
zeross secret set|get-ref <service> | secret envrc --dir D --export VAR=keychain:<service>
zeross secret reveal <service>                      (zeross-test-* services only)
zeross update check|diff|apply [--bump-pins]
zeross profile get|set key=value | local get|set key=value
```

## Uninstall

```bash
zeross uninstall --project-scope    # in a project: removes unmodified zeross files (incl. .claude/rules/zeross/) and merged blocks
zeross uninstall                    # global skill and wrappers (add --purge for profile/registry)
npm uninstall -g zeross-cli         # or: pnpm remove -g zeross-cli / bun remove -g zeross-cli
```

Run `zeross uninstall` first: it removes what zeross installed under `~/.claude/`;
removing the npm package only removes the CLI.

## Development

```bash
node --test test/<area>.test.js     # run only the test file for the area you changed
npm link                            # put the working copy's `zeross` on PATH
```

Plain JavaScript ESM with JSDoc types, zero runtime dependencies, Node.js ≥ 22.
There is no build step: `bin/zeross.js` and `lib/*.js` run as-is, and
`templates/` ships unchanged in the npm package.
