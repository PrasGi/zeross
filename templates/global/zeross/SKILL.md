---
name: zeross
description: Set up (or join) the zeross team workflow in the current project — detects stack, device capacity and Orca, interviews once for team rules/UI/docs/PR settings, installs zero-* skills, rules, hooks and MCP (GitHub, Jira, DB, Playwright) without overwriting anything, and tests every connection.
argument-hint: "[--reconfigure] [--personal-only]"
disable-model-invocation: true
---

# /zeross: project setup

Input: `$ARGUMENTS`

You install the zeross workflow into the project Claude Code was started in. The
`zeross` CLI does every deterministic step; you run the interview, explain, and
decide nothing on the user's behalf.

Ground rules for this whole skill:

- **Nothing is written before the preview is approved (phase 4).** Detection and
  dry runs only.
- **Never overwrite.** The CLI enforces it. Report conflicts; never work around them
  by deleting or renaming the user's files.
- **Questions:** use `AskUserQuestion` with at most 4 questions per call and 2–4
  options each. Put the recommended option first and label it "(Recommended)".
  Pre-fill detected values. Show the findings before you ask.
- **Secrets:** tokens and passwords never go into files, argv, or your replies.
  They go only into the OS keychain through `zeross secret set` (stdin).
- **Language:** conversation follows the session. Every file and config value is
  written in English.
- **CLI:** run `zeross <cmd> --json` and parse the output. If `zeross` is not on
  PATH, fall back to `npx -y zeross-cli <cmd>` (when `npx` exists). If neither
  works, stop and show the install options (end of this file).

## Phase 0: Preflight

1. `zeross --version` (the CLI needs Node.js ≥ 22). Then run
   `zeross doctor --json` and keep these values:
   - `device`
   - `capacity` (the recommended agent limits)
   - `session.orca`
   - `tools`
   - `playwrightChromium`
   - `project.root`, `project.workspaceRoot`
   - `warnings`
2. If `project.isGitRepo` is false, ask whether this folder really is the project
   root before going on.

## Phase 1: Install state

Run `zeross status --json`:

| `state` / flags | Meaning | Do |
|---|---|---|
| `fresh` | Never installed | Full flow: phases 2–7 |
| `installed` + `joinMode: true` | A teammate installed and committed it; this user has no personal setup | **Join mode**: skip team questions (batches A–D); run phase 3 batches E–G, then phases 5b–7 |
| `installed` + `joinMode: false` | Already set up for this user | Show a summary. Offer `/zero-update`, or `--reconfigure` (see below) |
| `outdated` | The manifest is older than the CLI | Recommend `/zero-update` first |
| `partial` | Tracked files are missing | Show them. Offer to re-apply (phases 4–5) |

`--personal-only` forces join mode. In join mode, tell the user:
"zeross is already installed for this project by your team; I'll only set up your
personal side (capacity, MCP credentials, test account)."

**`--reconfigure`** re-runs phases 2–7 with the current values pre-filled from
`.claude/zeross/config.json`. `zeross apply` is **add-only**: it adds missing files and
keys and keeps every existing value, so it never applies a changed answer by itself.
For each answer that differs from the current config:

1. Show the previewed JSON diff of `.claude/zeross/config.json` and ask for approval.
2. Edit `config.json` directly (only the changed keys), and validate it against
   `.claude/zeross/config.schema.json`.
3. When rule packs or scopes changed (`rules.packs`, `rules.scopes`) or `ui.*` changed,
   re-run `zeross apply --plan <file> --dry-run --json`, show the result, then apply, so
   the files under `.claude/rules/zeross/` are added or re-rendered.

## Phase 2: Scan

Run `zeross detect --json` and summarize it in a short table:

- apps: path, kind, stack, test and dev commands
- monorepo yes/no
- DB candidates, with evidence and env var **names**
- tickets: GitHub repo, Jira keys
- design-system candidates
- existing `.claude` assets and name clashes

Call out anything uncertain, e.g. a dev URL that is only a framework default
(`urlSource: framework-default`).

## Phase 3: Interview (team settings, asked once)

Run batches A–D for team settings and E–G for personal ones. Skip any question
whose answer is already unambiguous from detection; state the assumed value instead.

**A. Scope**
- Components. `AskUserQuestion` allows at most 4 options per question, so ask in two
  steps:
  1. One question: **All components (Recommended)** / **Customize**. "All" is every
     `zero-*` skill below.
  2. Only on **Customize**: up to 3 grouped multiSelect questions in one call, each
     with ≤4 options; mark the recommended ones "(Recommended)":
     - **Commands**: `zero-fix-bug`, `zero-build-small-feature`, `zero-build-feature`,
       `zero-create-pr`
     - **Reviews**: `zero-security-review`, `zero-ui-review` (the UI review is
       recommended only when an app has `kind` frontend/fullstack/mobile)
     - **Docs, PR and upkeep**: `zero-docs-writer`, `zero-pr-description`,
       `zero-learn`, `zero-update`
- **Dependencies are auto-included by the CLI:** selecting `zero-fix-bug`,
  `zero-build-small-feature` or `zero-build-feature` also installs
  `zero-docs-writer`, `zero-security-review`, `zero-ui-review` and `zero-learn`;
  `zero-create-pr` also installs `zero-pr-description`. Say so when the user
  deselects one of those, and show `autoIncluded` from the dry run in phase 4.
- Ticket platforms: Jira, GitHub or both. Then the Jira site URL and project keys,
  and the GitHub `owner/repo`.
- The app map (kind per app, which is FE and which is BE) when detection is unsure.

**B. Rules (expert defaults)**
- Rule packs: one question per group, in one call, each with ≤4 options and the
  detected choice first as "(Recommended)". `core` and `testing` are always
  included; `fe-core` comes with any FE framework and `be-core` with any BE stack.
  Don't ask about those. Skip a group when detection is unambiguous (state the
  assumed value) or the project has no such app.

  | Group | Options |
  |---|---|
  | FE framework | `fe-react-next` / `fe-vue-nuxt` / None |
  | FE extras (multiSelect) | `fe-design-system` (recommended when a design system exists) / `fe-forms` / `fe-state` |
  | BE stack | the detected pack, up to two plausible alternatives (same language first), and None. List all seven packs in the question text (`be-node-nest`, `be-node-express-fastify`, `be-go`, `be-python-fastapi`, `be-python-django`, `be-php-laravel`, `be-java-spring`); any of them can be typed as free text |
  | DB | `db-mongo` / `db-postgres` / `db-mysql` / None |
- Strictness: `strict` (Recommended) or `standard`.
- Comment policy: `none` / `exported` / `every-component`.
- Test policy: `logic-and-components` / `logic-only`.
- Custom rules, free text such as "no `any`" or "every new component needs a
  comment". Collect them as a list of short imperative sentences.
- Guard hook (blocks builds, whole-suite or coverage test runs, force-pushes and
  pushes to protected branches): **On (Recommended)** / Off. Becomes `hooks` in the
  plan and `config.json → hooks.guard`.
- **Where rules go.** The installer writes the packs to `.claude/rules/zeross/<pack>.md`
  (plus `custom.md`, `ui.md` and an always-on `zeross.md` workflow summary). Claude
  Code auto-loads every `.claude/rules/**/*.md`: files without `paths:` frontmatter at
  session start, files with `paths:` when Claude reads or edits a matching file.
  zeross never edits any `CLAUDE.md`.
  - Single app: no scoping; every pack loads at session start.
  - Monorepo: the installer computes default scopes from the app kinds (FE packs to
    the FE app folders, BE and DB packs to the BE app folders). Show those defaults
    and ask only whether to keep them (Recommended) or adjust; adjustments go into
    `ruleScopes` in the plan (`{ "<pack>": ["apps/web/**"] }`), stored as
    `config.json → rules.scopes`.

**C. UI review** (only if `zero-ui-review` is selected or auto-included, and an app
has `kind` frontend/fullstack/mobile)
- Is there a design system? If yes, which paths? Offer the detected candidates.
  Free-text notes, e.g. "shadcn/ui + Tailwind tokens in `src/styles/tokens.css`".
- Breakpoints: default 375×812 / 768×1024 / 1440×900, or custom.
- Dark mode? i18n?
- Extra UI rules (free text).

**D. Docs and PR**
- Docs path: root `docs/`, an app folder, or an existing docs folder (detected).
  Docs are always created/updated by the three build/fix commands (team rule; a
  touched module without a doc gets a short stub), so there is no auto-update
  question. In a monorepo, an app may get its own `docsPath`.
- PR base branch (default: the remote default branch).
- Default reviewers. Recommend `PrasGi` when that login is a collaborator (check
  with the GitHub MCP if it is already connected); otherwise ask.
- Close keywords on PRs: off (Recommended; uses "Refs") or on.

**E. Capacity and executor (personal)**
- Show the device line: "8 cores, 8 GB RAM (1.5 GB free)".
- Show the recommended max concurrent agents: code understanding / unit test /
  Playwright validation.
- Options:
  - **Recommended limits**
  - **Custom**: ask for the three numbers
  - **Serial only**: 1/1/1, no sub-agents
- Executor:
  - `auto` (Recommended). In Orca, read-only work uses native sub-agents and
    Playwright validation plus big sub-tasks use visible Orca workers.
  - `native`
  - `serial`
- Explain briefly: every Playwright agent runs its own Chromium and every
  unit-test agent its own runner, so those limits are lower.

**F. MCP**
- Which roles to set up: GitHub, Jira, DB, Playwright. Recommend those the
  project needs, e.g. Jira only if Jira is a ticket platform.
- GitHub/Jira scope:
  - **User scope + workspace wrapper** (Recommended when `workspaceRoot` exists):
    install once, and every repo under the workspace uses it. The token is
    chosen per workspace.
  - **Local (this project only)**.
- DB: confirm the type, the env file and the env var **name** (from
  `envCandidates`), plus any extra dev hosts that may be written to.
- **Context7** (optional, Recommended): current library docs over MCP before using an
  external API. Personal, user scope, works in every project; installed in phase 6.
  Record the team's choice in `config.json → integrations.context7` (boolean).

**G. Personal**
- Install `/zero-indonesia`? It is optional and personal: it goes to user scope.
- Default Playwright test-account email, plus extra role accounts if wanted
  (emails only now; passwords go to the keychain in phase 6).
- **Login methods** (team knowledge; ask only while
  `.claude/zeross/knowledge/auth-login.md` is missing or still has the line
  `Status: template — not filled yet`), one call:
  - Fastest local login method: **OTP bypass** / **Dev login route** / **Magic link**
    / **Password** (pre-select what detection or the code suggests; "unknown" can be
    typed as free text, which leaves the template unfilled)
  - Login URL: pre-fill `<apps[].dev.url>/login` or the detected login route
  - Test roles that exist (e.g. admin, member), with the notes the user gives

## Phase 4: Preview

Write the plan JSON to a temp file in your scratchpad (never inside the repo):

```json
{
  "components": ["zero-fix-bug", "..."],
  "config": {
    "project": { "name": "...", "monorepo": false, "apps": [ { "name": "web", "path": ".", "kind": "frontend",
      "stack": ["nextjs"], "packageManager": "pnpm",
      "test": { "runner": "vitest", "command": "pnpm exec vitest run {files}" },
      "lint": { "command": "pnpm exec eslint {files}" },
      "dev": { "url": "http://localhost:3000", "command": "pnpm dev" } } ] },
    "tickets": { "platforms": ["jira", "github"], "jira": { "site": "https://acme.atlassian.net", "projectKeys": ["VTX"] },
                 "github": { "repo": "acme/web" } },
    "git": { "baseBranch": "main" },
    "pr": { "defaultReviewers": ["PrasGi"], "closeKeywords": false },
    "rules": { "packs": ["fe-core", "fe-react-next"], "strictness": "strict", "commentPolicy": "none",
               "testPolicy": "logic-and-components" },
    "ui": { "designSystem": { "exists": true, "paths": ["src/components/ui"], "notes": "" },
            "darkMode": false, "i18n": false },
    "docs": { "path": "docs" },
    "db": { "enabled": true, "type": "mongodb", "envFile": ".env", "envVar": "MONGODB_URI", "devHosts": [] }
  },
  "customRules": ["Never use `any`; use `unknown` and narrow."],
  "uiRules": ["Every new component has a JSDoc summary comment."],
  "ruleScopes": { "fe-react-next": ["apps/web/**"], "be-node-nest": ["apps/api/**"] },
  "mcp": { "db": true, "playwright": true },
  "hooks": true
}
```

- `apps[].test.command` and `lint.command` run from the app's `path`, and `{files}`
  is relative to it.
- `ruleScopes` is optional. Omit it to take the installer's defaults (monorepo: scoped
  by app kind; single app: no scoping). It is stored as `config.json → rules.scopes`.
- `"hooks": true` installs the guard hook and is stored as `config.json → hooks.guard`
  (default true); `false` leaves the hook out, and `/zero-update` respects that.
- In join mode there is no plan. Skip to phase 5 (5a-2 when login answers were collected, then 5b).

Run `zeross apply --plan <file> --dry-run --json` and show:

- counts per action
- **conflicts**: files that exist and aren't ours, which stay untouched. Offer
  to skip them, or to have the user rename their file first.
- **modified**: team-edited files, where a `.zeross-new` will be written beside them
- `autoIncluded`: skills added as dependencies of the selected components
- the rule files under `.claude/rules/zeross/`, with their `paths:` scopes in a monorepo
- merges into `.claude/settings.json`, `.mcp.json` and `.gitignore`

Ask for approval: **Apply** (Recommended) / **Change answers** / **Cancel**.

## Phase 5: Apply

**5a. Team files** (skipped in join mode): run `zeross apply --plan <file> --json`.
Report the result in one short list, including `autoIncluded`.

**5a-2. Login knowledge** (when batch G collected login answers): build the new
`.claude/zeross/knowledge/auth-login.md` content from them, replacing the template's
example rows in "Login methods" and "Test roles", filling "Last verified" with today,
and removing the `Status: template — not filled yet` line. Show the diff first and
write only after the user approves. Emails and keychain refs only, never passwords.
In join mode this is a team file: remind the user to commit it.

**5b. Personal profile:**

```bash
zeross profile set capacity.mode='"recommended"' capacity.understanding=2 capacity.unitTest=1 \
  capacity.playwright=1 executor='"auto"' device='<doctor device JSON>' --json
zeross local set setupAt='"<ISO timestamp>"' playwright.defaultEmail='"me@acme.com"' --json
```

Use the user's real choices. Values are JSON (strings are quoted). If the user
picked `/zero-indonesia`, run `zeross install --with-indonesia --json`.

**Arrays** (e.g. `playwright.accounts`): read the current value with
`zeross local get playwright.accounts --json`, modify it, and write the whole array
back with `zeross local set 'playwright.accounts=[…]' --json`. Never set an array
element by index.

## Phase 6: MCP, one role at a time

For each selected role, follow this order: **check → (reuse | install) → test →
record**. When something fails, say exactly which step failed and what the user
can do. Never claim success without a passing test.

**GitHub**

1. Run `zeross mcp check github --json`. If `configured.connected` → go to step 7.
   If `equivalents` has a connected server, e.g. a `github` server the user already
   has, ask: **Reuse `<name>`** (Recommended) / **Install the zeross wrapper**.
   On reuse, run `zeross profile set mcpRoles.github='"<name>"'`, then test and stop.
2. Token: a fine-grained PAT at <https://github.com/settings/personal-access-tokens/new>.
   - Resource owner: the org.
   - Repositories: the workspace repos, or all.
   - Permissions: **Contents: Read and write**, **Pull requests: Read and write**,
     **Issues: Read and write**, **Metadata: Read**. Optional: Actions: Read,
     Commit statuses: Read.
   - Note that an org may need to approve fine-grained tokens.
3. Resolve the keychain service name. The workspace name is
   `basename(workspaceRoot)` for user scope, or the project name for local. Run
   `zeross mcp add github --scope <user|local> --workspace-root <dir> --workspace-name <name> --dry-run --json`
   and keep its `keychainService`. The CLI lowercases and sanitizes the name, so
   always use this value; never build the name yourself. Refs such as
   `keychain:<keychainService>` are not secrets and may be shown.
4. Store the token under `<keychainService>`. Ask which way:
   - **Own terminal** (Recommended, the token never enters the chat): the user runs
     `zeross secret set <keychainService>` and pastes at the hidden prompt.
   - **Paste in chat**: warn that it stays in this conversation's history. Then
     store it through stdin only:

     ```bash
     zeross secret set <keychainService> --json <<'ZEROSS_SECRET'
     <token>
     ZEROSS_SECRET
     ```

     Never echo it back or repeat it.
5. Run the same `zeross mcp add github …` command without `--dry-run`.
6. Auto-load with `.envrc`, if direnv is installed and the user wants it:
   `zeross secret envrc --dir <workspace or project root> --export GITHUB_PERSONAL_ACCESS_TOKEN=keychain:<keychainService> --allow --json`.
   For a project-local `.envrc`, confirm `.envrc` is gitignored first.
7. Run `zeross mcp test github --repo <owner/repo> --json`. Expect `ok: true`, a
   login, and `repoStatus: 200`. A `403`/`404` on the repo means missing repo
   access or a missing org approval for the token.

**Jira** follows the same steps, with these differences:

- The Jira server is the third-party `mcp-atlassian` (Python), launched with
  `uvx mcp-atlassian==<pin>`, so it needs `uv`. Check `command -v uvx` before
  step 2; if it is missing, ask the user to install uv (`brew install uv`, or
  <https://docs.astral.sh/uv/>) and re-check. GitHub, DB and Playwright don't need it.
- The token comes from <https://id.atlassian.com/manage-profile/security/api-tokens>.
- Resolve the keychain service with
  `zeross mcp add jira --scope … --jira-url https://<site>.atlassian.net --jira-username <email> --dry-run --json`
  and use its `keychainService` (normally `zeross-jira-<workspace>`, lowercased and
  sanitized) for `zeross secret set` and `.envrc`. Then run the same command without
  `--dry-run`.
- In `.envrc`, export `JIRA_API_TOKEN=keychain:<keychainService>`, `JIRA_URL=…` and
  `JIRA_USERNAME=…`.
- Test with `zeross mcp test jira --json`.
- If a claude.ai Atlassian connector shows up among the equivalents, mention it. The
  team standard is the API-token server, so recommend installing it unless the
  user prefers to reuse the connector.

**DB** (the entry is already in the committed `.mcp.json`)

1. Run `zeross mcp test db --no-claude --json` and show `engine`, `hosts`,
   `hostClass` and `writable`. Explain the policy:
   - local/dev hosts are writable
   - every other host is read-only unless the user grants it
   - production-looking hosts (`prod` in the host, or a `.env*prod*` env file) need a
     typed confirmation and get a session-only grant
2. Run `zeross profile set mcpRoles.db='"db"'`.

**Playwright**

1. If `playwrightChromium` is false, ask, then run `npx -y playwright install chromium`.
2. Run `zeross mcp test playwright --no-claude --json`, then
   `zeross profile set mcpRoles.playwright='"playwright"'`.
3. Test-account passwords: for each role the user wants, the user stores the
   password in their own terminal with `zeross secret set zeross-test-<project>-<role>`
   (lowercase kebab-case). Run `zeross secret get-ref <service> --json` to confirm it
   and get the exact ref. Then record the refs with the whole-array procedure from
   phase 5b: `zeross local get playwright.accounts --json`, add or update the entries,
   and write back the whole array, e.g.
   `zeross local set 'playwright.accounts=[{"role":"admin","email":"…","passwordRef":"keychain:zeross-test-<project>-admin"}]' --json`.
   At login time, sessions read the password only with
   `zeross secret reveal <service>`, which works only for `zeross-test-*` services.

New and changed MCP servers load on the next Claude Code start. Project `.mcp.json`
servers ask for a one-time approval, which each teammate accepts once.

**Context7** (if chosen; user scope, once per machine)

1. Run `zeross mcp check context7 --json`. If a `context7` server is already
   connected (also under another name), offer **Reuse** (Recommended) and map it
   with `zeross profile set mcpRoles.context7='"<name>"'`.
2. API key (optional, higher rate limits): ask **No key (Recommended)** / **Add a
   key**. With a key, the user runs `zeross secret set zeross-context7` in their
   own terminal (or pastes it for the stdin heredoc, with the transcript warning).
   The key never goes into `~/.claude.json`.
3. Run `zeross mcp add context7 --json`, then `zeross mcp test context7 --json`
   (`apiKey: present|absent`; the value is never printed).

## Phase 7: Verify and hand off

1. Run `zeross verify --json`. Report every failing check with its fix.
2. Final summary:
   - installed components (with auto-included ones) and rule packs, with their
     scopes in a monorepo
   - MCP roles with ✔ or ✘
   - capacity and executor
   - files with `.zeross-new` sidecars that need a manual merge
3. Next steps:
   - **Commit and push** `.claude/`, `.mcp.json` and `.gitignore` (suggest
     `chore: set up zeross workflow`) so teammates get the standard. zeross does not
     touch `CLAUDE.md`. Each teammate runs `/zeross` once for their personal side.
   - Restart Claude Code (or run `/mcp`) to load new servers.
   - Try it with `/zero-fix-bug <ticket>`.
   - **Recommend graphify** (do not install it): a local knowledge graph of the
     codebase that makes code understanding faster on large repos. If `tools.graphify`
     from doctor is false, add one line: "Recommended: graphify — install it yourself
     with `uv tool install graphifyy && graphify install`, then run `/graphify .`
     (https://github.com/Graphify-Labs/graphify). zeross uses `graphify-out/` automatically
     when it exists." Never run these commands for the user.
4. Never commit for the user unless they ask in this session.

## Install options (when the CLI is missing)

Requires Node.js ≥ 22. The npm package is `zeross-cli`; the command is `zeross`.

```bash
npm i -g zeross-cli && zeross install             # recommended
npx zeross-cli install                            # one-shot, no permanent install
pnpm add -g zeross-cli && zeross install          # pnpm
bun add -g zeross-cli && zeross install           # bun
npm i -g github:PrasGi/zeross && zeross install    # pre-release / private build
npm i -g . && zeross install                      # from a clone (or `npm link`)
```
