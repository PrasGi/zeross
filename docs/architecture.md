# zeross architecture & contracts

This file is the single source of truth for file layout, config keys and
cross-file contracts. Skills, workflow files and the CLI must agree with it.

## Distribution

npm only. The package is `zeross-cli` (`zeross` is taken on npm); the installed
command is `zeross` (`bin/zeross.js`). Every channel needs Node.js ≥ 22:

| Channel | Command |
|---|---|
| npm (primary) | `npm i -g zeross-cli && zeross install` |
| one-shot | `npx zeross-cli install` |
| pnpm / bun | `pnpm add -g zeross-cli` / `bun add -g zeross-cli`, then `zeross install` |
| git (pre-release/private) | `npm i -g github:PrasGi/zeross` |
| from a clone | `npm i -g .` (or `npm link`) in the repo |

`zeross update check --json` reports the detected `method` (`npm` | `npx` |
`pnpm` | `bun` | `source` | `unknown`) and the matching `upgrade` command. When
`zeross` is not on `PATH`, content falls back to `npx -y zeross-cli <cmd>`.

The version lives in `package.json` only; the release workflow publishes it
from a matching `v*` tag.

The only non-Node runtime in the toolkit is the third-party Jira MCP server
`mcp-atlassian` (Python), launched with `uvx mcp-atlassian==<pin>`; `uv` is
needed only by users who enable Jira.

## Two layers

1. **`zeross` CLI** (`bin/zeross.js` + `lib/*.js`): plain JavaScript ESM with
   JSDoc, zero runtime dependencies, Node.js ≥ 22, no build step. Deterministic
   work: device checks, detection, file writes with no-overwrite policy,
   manifest, MCP registration/tests, secrets, update checks. Every subcommand
   supports `--json`. Tests use `node:test` (`test/*.test.js`).
2. **Content** (`templates/` at the repo root): Markdown skills, shared workflow,
   rule packs, knowledge templates, hook and MCP wrapper scripts (`.mjs`, run
   with `node`). Copied into `~/.claude/` (global/personal) and
   `<project>/.claude/` (team, committed).

## Installed layout in a target project (committed unless marked)

```
<project>/
  .mcp.json                         # merged: "db", "playwright" entries
  .claude/
    settings.json                   # merged: PreToolUse Bash hook → zeross-guard (when hooks.guard)
    rules/
      zeross/                       # native Claude Code rules, auto-loaded (manifest-tracked, generated)
        zeross.md                   # always-on workflow summary (no paths:)
        core.md testing.md          # always included
        <pack>.md                   # chosen packs; `paths:` frontmatter in a monorepo (rules.scopes)
        custom.md                   # team rules (free text)
        ui.md                       # rendered from config.json → ui
    skills/
      zero-fix-bug/SKILL.md
      zero-build-small-feature/SKILL.md
      zero-build-feature/SKILL.md
      zero-create-pr/SKILL.md
      zero-update/SKILL.md
      zero-learn/SKILL.md
      zero-security-review/SKILL.md + references/*.md
      zero-ui-review/SKILL.md + references/*.md
      zero-docs-writer/SKILL.md + references/*.md
      zero-pr-description/SKILL.md
    zeross/
      config.json                   # team config (schema below)
      config.schema.json
      manifest.json                 # written by CLI only
      workflow/                     # shared workflow, read by commands
        core.md questions.md tickets.md evidence.md testing.md
        browser.md data-safety.md executor.md reporting.md
      knowledge/                    # team knowledge (README.md, auth-login.md, …)
      bin/
        db-mcp.mjs                  # DB MCP wrapper (node, no deps)
        playwright-mcp.mjs          # Playwright MCP wrapper (persistent profile, auto --isolated)
        zeross-guard.mjs            # PreToolUse Bash guard (node, no deps)
      local.json                    # GITIGNORED: personal per-project settings
      local/                        # GITIGNORED: data-log/, browser-profile/, plans/, scratch
```

Personal / machine (never committed):

```
~/.claude/skills/zeross/SKILL.md          # global orchestrator (/zeross) + .zeross_version
~/.claude/skills/zero-indonesia/SKILL.md  # optional
~/.claude/zeross/profile.json             # capacity, executor, mcpRoles, device snapshot
~/.claude/zeross/workspaces.json          # workspace registry for user-scope GitHub/Jira MCP (root, github.owner, jira.url)
~/.claude/zeross/bin/workspace-mcp.mjs    # one wrapper: `node workspace-mcp.mjs github|jira`
~/.claude/zeross/update-check.json        # npm registry check cache (24h)
```

How the scripts are registered:

```
.mcp.json        "db":         {"command":"node","args":["${CLAUDE_PROJECT_DIR:-.}/.claude/zeross/bin/db-mcp.mjs"]}
                 "playwright": {"command":"node","args":["${CLAUDE_PROJECT_DIR:-.}/.claude/zeross/bin/playwright-mcp.mjs"]}
settings.json    PreToolUse Bash → node "$CLAUDE_PROJECT_DIR/.claude/zeross/bin/zeross-guard.mjs"
claude mcp add   --scope <user|local> github-zeross -- node ~/.claude/zeross/bin/workspace-mcp.mjs github
                 --scope <user|local> jira-zeross   -- node ~/.claude/zeross/bin/workspace-mcp.mjs jira
```

Secrets live only in the OS keychain (`security` on macOS, `secret-tool` on
Linux) and/or a gitignored `.envrc` that reads from the keychain (the zeross block
starts with a comment line saying the values come from the OS keychain). Service names:
`zeross-github-<workspace>`, `zeross-jira-<workspace>`, `zeross-test-<project>-<role>`
(lowercased and sanitized by the CLI; `zeross mcp add … --dry-run --json` reports the
`keychainService` to use). `zeross secret set` accepts only names matching
`^zeross-[a-z0-9]+(-[a-z0-9]+)*$` (no trailing dot or dash) that are referenced by
`workspaces.json`, `local.json` or a known pattern (`zeross-test-*`, `zeross-context7`),
unless `--force`; it returns `{ ok, ref, replaced, referencedBy }`. `zeross secret import`
moves an existing literal token into the keychain without printing it. Keychain refs (`keychain:<service>`) are not secrets and
may be printed; secret values never are, with one exception:
`zeross secret reveal <service>` prints a value, **only** for `zeross-test-*`
services (local test-account passwords, read at typing time per
`workflow/browser.md`). Its output lands in the tool result and the session
transcript, which is accepted for local test accounts only.

## Rules loading

zeross never edits any `CLAUDE.md`. Rule packs are native Claude Code rules in
`.claude/rules/zeross/`, which Claude Code auto-loads:

- files without `paths:` frontmatter load at session start (single-app projects:
  every pack; always: `zeross.md`, `core.md`, `testing.md`, `custom.md`)
- files with `paths:` frontmatter load when Claude reads or edits a matching file.
  In a monorepo the installer computes defaults from app kinds (FE packs → FE app
  folders, BE and DB packs → BE app folders); the plan's optional `ruleScopes`
  overrides them and is stored as `config.json → rules.scopes`.

Project rules outside `zeross/` (`existing.projectRules` in `zeross detect`) are
never touched; `/zeross` offers a custom rule saying the project rule wins on a conflict.

Content says: "Rule packs are auto-loaded by Claude Code from `.claude/rules/zeross/`
(path-scoped packs load when you touch matching files). Read a pack explicitly only
if it is not already in context."

## Template source layout (`templates/`)

```
global/zeross/SKILL.md
global/zero-indonesia/SKILL.md
project/skills/<zero-*>/…                 → <project>/.claude/skills/<zero-*>/…
project/zeross/workflow/*.md              → <project>/.claude/zeross/workflow/
project/zeross/knowledge/*.md             → <project>/.claude/zeross/knowledge/
project/zeross/config.schema.json         → <project>/.claude/zeross/config.schema.json
project/zeross/bin/*.mjs                  → <project>/.claude/zeross/bin/
rule-packs/<pack>.md                      → <project>/.claude/rules/zeross/<pack>.md (chosen only)
user/bin/*.mjs                            → ~/.claude/zeross/bin/
```

## `config.json` (team)

```jsonc
{
  "$schema": "./config.schema.json",
  "schemaVersion": 1,
  "project": {
    "name": "ventrixio-fe",
    "monorepo": false,
    "apps": [
      {
        "name": "web",
        "path": ".",                       // relative to project root
        "kind": "frontend",                // frontend | backend | fullstack | library | mobile
        "stack": ["nextjs", "react", "tailwind"],
        "packageManager": "pnpm",
        "test": {
          "runner": "vitest",
          "command": "pnpm vitest run {files}"   // {files} = space-separated related test files
        },
        "lint": { "command": "pnpm eslint {files}" },
        "dev": { "url": "http://localhost:3000", "command": "pnpm dev" }
      }
    ]
  },
  "tickets": {
    "platforms": ["jira", "github"],
    "jira": { "site": "https://acme.atlassian.net", "projectKeys": ["VTX"] },
    "github": { "repo": "acme/ventrixio-fe" }
  },
  "git": {
    "baseBranch": "main",
    "protectedBranches": ["main", "master", "develop", "dev"],
    "branchPattern": { "fix": "fix/{ticket}-{slug}", "feature": "feature/{ticket}-{slug}" }
  },
  "pr": {
    "defaultReviewers": ["PrasGi"],
    "closeKeywords": false,             // false → "Refs", never "Closes/Fixes"
    "attributionFooter": false,
    "draftByDefault": false,
    "commentOnTicket": "ask"            // ask | always | never
  },
  "rules": {
    "packs": ["core", "testing", "fe-core", "fe-react-next"],
    "strictness": "strict",             // strict | standard
    "commentPolicy": "none",            // none | exported | every-component
    "testPolicy": "logic-and-components", // logic-and-components | logic-only
    "e2e": "none",                      // none (team rule: no new e2e files) | follow-project
    "scopes": { "fe-react-next": ["apps/web/**"] } // optional; pack → globs (`paths:`); monorepo only
  },
  "hooks": { "guard": true },           // PreToolUse Bash guard; false → not installed, never re-added by update
  "ui": {
    "designSystem": { "exists": true, "paths": ["src/components/ui"], "notes": "" },
    "breakpoints": [
      { "name": "mobile", "width": 375, "height": 812 },
      { "name": "tablet", "width": 768, "height": 1024 },
      { "name": "desktop", "width": 1440, "height": 900 }
    ],
    "darkMode": false,
    "i18n": false,
    "extraRules": []                    // free-text UI rules, rendered into .claude/rules/zeross/ui.md
  },
  "docs": { "path": "docs" },   // docs are always written by fix/build commands (no switch)
  "db": {
    "enabled": true,
    "type": "mongodb",                  // mongodb | postgres | mysql
    "envFile": ".env",                  // parsed, never sourced
    "envVar": "DATABASE_URL",           // name only, never the value
    "devHosts": []                      // extra hosts treated as dev (writable)
  },
  "integrations": { "context7": true },   // team-recommended optional helpers
  "mcp": {
    "pins": {
      "playwright": "@playwright/mcp@0.0.83",
      "dbhub": "@bytebase/dbhub@1.4.0",
      "mongodb": "mongodb-mcp-server@3.0.5",
      "atlassian": "mcp-atlassian==0.23.1"
    }
  }
}
```

## `local.json` (personal, per project, gitignored)

```jsonc
{
  "playwright": {
    "defaultEmail": "me@acme.com",
    "accounts": [ { "role": "admin", "email": "admin@acme.test", "passwordRef": "keychain:zeross-test-ventrixio-fe-admin" } ]
  },
  "dbGrants": {
    "staging-db.acme.internal": { "scope": "persistent", "grantedAt": "2026-10-06T12:00:00Z" },
    "prod-db.acme.io": { "scope": "session", "grantedAt": "2026-10-06T12:00:00Z", "expiresAt": "2026-10-06T20:00:00Z" }
  },
  "setupAt": "2026-10-06T12:00:00Z"        // personal setup done (status: joinMode=false)
}
```

## `~/.claude/zeross/profile.json` (personal, per machine)

```jsonc
{
  "device": { "os": "darwin", "arch": "arm64", "cpus": 8, "memTotalGb": 8 },
  "capacity": { "mode": "recommended", "understanding": 2, "unitTest": 1, "playwright": 1 },
  "executor": "auto",                    // auto | native | serial
  "mcpRoles": { "github": "github-zeross", "jira": "jira-zeross", "db": "db", "playwright": "playwright",
                "context7": "context7" }
}
```

Written with `zeross local set dotted.key=<json>`; `profile.json` with
`zeross profile set …`. Arrays (e.g. `playwright.accounts`) are read with
`zeross local get <key> --json`, modified and written back whole; never by index.
Every grant has `scope`: `persistent` or `session`; a `session` grant must carry a
future `expiresAt` (default: 8 hours or the end of the task, whichever is sooner).
`db-mcp.mjs` ignores grants with any other shape and expired ones; the task removes
its own session grant at cleanup (`zeross local set 'dbGrants[<host>]=null'`). The
wrapper treats a host as production-looking when its name contains `prod` or the
env file matches `.env*prod*`, whatever the host. Conversation language is never
persisted.

## Command conventions

- `apps[].test.command` and `apps[].lint.command` run from `apps[].path`;
  `{files}` is a space-separated list relative to that path. For Go, `{files}` holds
  package paths (`./internal/billing`) and Claude may append `-run <TestName>`.
- `apps[].docsPath` (optional) overrides `docs.path` for one app in a monorepo.
- `pr.attributionFooter: true` appends the line `🤖 Generated with Claude Code (zeross)`
  to PR bodies and commit message bodies; `false` (default) adds nothing.
- `zeross secret set|get-ref|reveal <service>` takes the full keychain service
  name, e.g. `zeross-test-<project>-<role>`. `reveal` refuses any service not named
  `zeross-test-*`.
- **Skill dependencies are auto-included** by `zeross apply`: `zero-fix-bug`,
  `zero-build-small-feature` and `zero-build-feature` pull in `zero-docs-writer`,
  `zero-security-review`, `zero-ui-review` and `zero-learn`; `zero-create-pr` pulls
  in `zero-pr-description`. The apply output lists them as `autoIncluded`.
- `rules.e2e`: `none` (default) keeps the team rule (no new e2e test files);
  `follow-project` applies the project's existing e2e conventions (only the related
  spec is ever run, never a whole e2e suite).
- `zeross update diff` reports `pinBumps` (applied only with `--bump-pins`) and, on
  the `files[]` entry for `.claude/zeross/config.json`, `newKeys`; `update apply`
  adds new keys with their defaults (add-only) and re-renders `ui.md` from
  `config.json → ui`.

## CLI output contracts (`--json`)

- **`zeross detect`**:
  - `db.candidates[].envCandidates[].hostClass`: `local | docker | remote | production | unknown` (host values are never printed)
  - `tickets.jira.projectKeys`: filtered to keys with ≥25% of the top key's count (branch names weigh more)
  - `git: { defaultBranch, branches, recommendedBase }`
  - `apps[].test.configs` (extra vitest/jest config files); `apps[].lint` falls back to the root ESLint config; `apps/*` workers with dev/start scripts get `kind: "backend"`
  - `designSystemCandidates` (incl. token files such as `tokens.css`), `ui: { darkModeHint, i18nHint }`, `loginRouteCandidates`
  - `existing.projectRules` (non-zeross `.claude/rules/*.md`), `existing.e2e: { detected, signals }`,
    `existing.denyConflicts: [{ file, rule }]` (deny patterns in `.claude/settings*.json` that match the project itself, e.g. `Write(~/**)`)
- **`zeross mcp check <role>`**: `equivalents[]` carry `scope`, `file` and `plaintextSecrets` (env var names with literal values);
  `shadows` / `shadowedBy` appear when the same server name exists in several scopes (project scope wins over user scope once approved).
- **`zeross mcp test github`**: `--repo` defaults to `config.tickets.github.repo`; `--service <name>` tests a specific keychain item.
  Adds `tokenKind` (`fine-grained | classic | unknown`, from the prefix only), `source` (`keychain | direnv | env`),
  `envOverride` (an environment variable with a different value exists; compared by hash), `orgStatus`, and on a 404 a `hint`
  (resource owner or pending org approval, with the settings URL).
- **`zeross mcp test jira`**: also checks every `config.tickets.jira.projectKeys` (`projects: { KEY: status }`); `ok` only when all
  are visible. Adds `source` / `envOverride`.
- **`zeross mcp add github|jira`**: records `github.owner` / `jira.url` on the workspace and returns
  `workspace: { name, root, action: "created" | "updated" }` plus `warnings` when the repo owner or Jira site differs from
  what the workspace already holds.
- **`zeross verify`**: runs the role auth tests (repo, Jira project keys) unless `--no-mcp`; an MCP "Pending approval" is
  reported under `actionNeeded`, not as a failure; adds `duplicates` (several active servers per role) and `plaintextSecrets`
  (MCP configs with literal secret env values: file, server, env names).

## Workspaces (user-scope GitHub/Jira)

- **One workspace = one GitHub org + one Jira site.** Repos of another org or site need their own workspace root
  (e.g. a sub-folder). `zeross mcp add` warns instead of silently mixing them.
- `workspace-mcp.mjs` picks the workspace by the longest matching root and resolves credentials in this order:
  **OS keychain → the workspace root's direnv `.envrc` → the environment**. An ambient shell `GITHUB_PERSONAL_ACCESS_TOKEN`
  or `JIRA_API_TOKEN` no longer overrides the workspace's keychain item.

## Cross-file contracts

- **MCP roles.** Content never hard-codes server names. It says "the GitHub
  MCP" and resolves the actual server via `profile.json → mcpRoles`.
- **Paths.** Content refers to project files relative to the project root,
  e.g. `.claude/zeross/workflow/core.md`.
- **Modes.** Review skills run `report-only` when invoked directly and
  `fix-blockers` when called by a command (the caller says so explicitly).
- **Language.** Conversation language follows the session (`/zero-indonesia`);
  every file, code comment, commit, PR and doc is English.
- **Questions.** Always `AskUserQuestion`, ≤4 questions per call, recommended
  option first with "(Recommended)", findings shown before asking.
- **No side effects without consent.** No commit/push/PR, build, full test
  suite, or non-local data write unless the user asked or granted it. The canonical
  git, build, test and destructive-action rules live in `rule-packs/core.md`;
  workflow files and skills point there.
- **Tests vs validation.** Tests are unit tests with edge cases, written first
  (test → fail → fix → pass). Validation is live through the Playwright MCP. With
  `rules.e2e: none` (default): no e2e test files (Playwright `@playwright/test` specs,
  Cypress, `*.e2e-spec.ts`, supertest suites against the booted app) unless the user
  explicitly asks; existing ones are updated only when the change breaks them. With
  `follow-project`: the project's e2e conventions apply, and only the related spec is
  run. MCP helper code lives in the session scratchpad or `$TMPDIR` (or
  `.claude/zeross/local/` when the project forbids temp dirs), never elsewhere in the
  repo. Canonical: `rule-packs/testing.md`.
- **Docs.** The three fix/build commands always run `zero-docs-writer`: `update` +
  Changelog when the module has a doc; a **stub** (front matter, 2–5 line Overview,
  Changelog entry, `stub: true`) when it has none; a full `create` for a new module
  in `/zero-build-feature` or on request. Per-app docs root: `apps[].docsPath`, else
  `docs.path`. Called by a command, the docs writer asks only once, when it would
  create the docs root folder.
- **Knowledge templates.** `knowledge/auth-login.md` ships with the first line
  `Status: template — not filled yet`; while present, sessions treat the login
  method as unknown and ask. `/zeross` (batch G) or `/zero-learn` fills it and
  removes the line.

## Write policy (CLI `writer` + `manifest`)

| State | Action |
|---|---|
| absent | create |
| tracked, hash == manifest | safe update |
| tracked, hash != manifest | keep; write `<file>.zeross-new`; report |
| untracked existing file | skip; report conflict |
| `.claude/rules/zeross/*.md` | manifest-tracked generated files (rules above); `ui.md` re-rendered from config |
| `.gitignore`, `.envrc` | marker-block merge |
| `settings.json`, `.mcp.json` | JSON merge, add-only |
| `config.json` | add-only: new keys get defaults; existing values are never changed by apply/update |

zeross never writes `CLAUDE.md`.

## Optional code-understanding helpers

- **Context7** (`zeross mcp add context7`): user-scope MCP through `~/.claude/zeross/bin/context7-mcp.mjs`,
  pinned `@upstash/context7-mcp`. Optional API key from the keychain item `zeross-context7` (env
  `CONTEXT7_API_KEY` for the server), never in `~/.claude.json`.
- **graphify**: recommended only. `/zeross` tells the user how to install it themselves
  (`uv tool install graphifyy && graphify install`, then `/graphify .`); zeross never installs or manages it.
  When `graphify-out/graph.json` exists, the workflow uses it (`workflow/evidence.md`).
- Team recommendation: `config.json → integrations.context7`. Workflow use: `workflow/evidence.md`.
