# Core workflow

Authority, scope, git safety and start-of-task loading for every zeross command (`/zero-fix-bug`, `/zero-build-small-feature`, `/zero-build-feature`, `/zero-create-pr`).

## Authority and scope

- Explicit user instructions in this session override these workflow files. Rule packs and these files override generic habits.
- Keep every choice and authorization the user already gave in this task. Do not re-ask (see `questions.md`).
- An approval to implement covers implementation only. It does not authorize commits, pushes, PRs, builds, full test suites, non-local data writes, or work in other repositories.
- Stay inside the ticket's scope. Do not refactor, rename or "clean up" code the task does not need. Note anything else you spot as a follow-up in the report.
- Read sibling repositories only when the user widens the scope. Before editing one, read its own `CLAUDE.md` and rules.
- If the task turns out to be larger than the command allows, stop and ask. For example, `/zero-build-small-feature` hits its size guard and should switch to `/zero-build-feature`.

## Git safety

The git rules themselves (no commit, push or PR without an explicit request; no force-push or merge; protected branches; staging; no `stash`/`reset`/`clean` of the user's work) are canonical in `.claude/rules/zeross/core.md` → "Git". This section adds the workflow steps.

- **Branch name.** Use `git.branchPattern.fix` for bugs and `git.branchPattern.feature` for features. Fill in `{ticket}` with the ticket key (e.g. `PROJ-123`, or `123` for a GitHub issue) and `{slug}` with 2–5 lowercase kebab-case words. For free-text tasks with no ticket, drop `{ticket}-`.
- **Branch decision (ask, never assume).** Right before the build/fix phase, i.e. before the first file
  write of the task, ask one `AskUserQuestion` call with two questions:
  1. **Where to work:** "New branch `<name from branchPattern>`" or "Stay on `<current branch>`".
     - Recommend **new branch** when the current branch is protected, belongs to another ticket, or is
       the base branch. Never offer "stay" on a protected branch (`git.protectedBranches`).
     - Recommend **stay** when the current branch is already this task's branch (its name contains the
       ticket key) or the user is clearly continuing work there.
  2. **Source for a new branch** (ignored if they stay). Offer 2–3 real candidates with a one-line
     reason each, recommended first. Find them with `git fetch --prune origin` and
     `git branch -r --list 'origin/<base>' 'origin/release/*' 'origin/*<parent-key>*'`:
     - `origin/<git.baseBranch>`, freshly fetched: default for an independent ticket.
     - The current branch: when the task builds on its unmerged work (follow-up, sub-task, same feature).
     - The parent ticket's branch: when the ticket is a sub-task of a feature developed on its own branch.
     - A `release/*` or hotfix branch: when the ticket targets a release (fix version, milestone,
       `hotfix` label) or the bug exists only there.
  If reproduction must write a file earlier (e.g. a failing test in `/zero-fix-bug`), ask at that point
  instead, still before the write. Ask once per task; never re-ask after it is settled.
- **Creating the branch** (only if they chose a new one):
  1. `git fetch origin <source>` (skip for a purely local source branch)
  2. `git switch -c <branch> <origin/source or local source>`
  3. Confirm the source exists and say which commit the branch starts from.
- **Uncommitted changes.** Run `git status --porcelain` before switching branches or editing.
  - Changes unrelated to this task: stop and ask. Offer to keep working on the current branch, or let the user commit or move them first.
  - Never discard or hide them to get a clean tree.
- Use local git for history, fetch, commit and the authorized push. Use the GitHub MCP for issues, PRs, comments and reviews.

## Builds and heavy commands

Canonical in `.claude/rules/zeross/core.md` → "Side effects" (no builds, related tests only, the guard hook and its escape hatches). Workflow additions:

- Never start long-running servers yourself. See `browser.md`.
- Running tests follows `testing.md`.

## Editing discipline

- Read a file before editing it, and read its neighbours (callers, sibling components, tests) before choosing a pattern.
- Match the surrounding code: naming, file layout, imports and aliases, error handling, test style. Copy an existing similar implementation instead of inventing a new pattern.
- Follow the rule packs in `.claude/rules/zeross/`, including `custom.md`. When a pack conflicts with the established code in the file you are editing, follow the code and mention the conflict in the report.
- Keep diffs minimal. Do not reformat untouched lines.
- Never write secrets, tokens, passwords or real connection strings into any file. Use env var **names** only.

## Language

- Conversation follows the session: Indonesian only when `/zero-indonesia` was invoked this session, English otherwise.
- **Everything written to disk is English:** code, comments, tests, docs, knowledge, commit messages, PR titles and descriptions, ticket comments.

## MCP roles

Never hard-code MCP server names. Resolve each role through `~/.claude/zeross/profile.json → mcpRoles`:

| Role | Key | Used for |
|---|---|---|
| GitHub MCP | `mcpRoles.github` | issues, PRs, comments, reviewers, `get_me` |
| Jira MCP | `mcpRoles.jira` | issues, comments, links, transitions |
| DB MCP | `mcpRoles.db` | read-only queries; writes only under `data-safety.md` |
| Playwright MCP | `mcpRoles.playwright` | browser reproduction and validation (`browser.md`) |

- Tools appear as `mcp__<server-name>__<tool>`. Use the server name from `mcpRoles`.
- If a role is missing or the server is not connected, say which role is unavailable and continue with what works. Suggest `/mcp` to reconnect, or `/zeross` to set it up. Never claim a check ran when its MCP was unavailable.

## Load at task start

Read these once per task, before discovery. **Skip any file already in context.**

1. `.claude/zeross/config.json`. **Required.** If it is missing, stop and tell the user to run `/zeross`.
2. `~/.claude/zeross/profile.json`: `capacity`, `executor`, `mcpRoles`. If it is missing, assume serial execution and ask the user to run `/zeross` for personal setup.
3. `.claude/zeross/local.json`, if present: Playwright accounts and DB grants. Never print secrets or grant details beyond host names; keychain refs (`keychain:…`) are not secrets and may be shown.
4. `.claude/zeross/workflow/core.md` (this file) and `questions.md`. Load the others when their phase starts:
   - `tickets.md`: intake
   - `evidence.md`: reproduction and assessment
   - `testing.md`: tests
   - `browser.md`: any Playwright use
   - `data-safety.md`: any DB access
   - `executor.md`: before spawning any agent or worker
   - `reporting.md`: verdict, status and final report
5. **Rule packs** are auto-loaded by Claude Code from `.claude/rules/zeross/` (path-scoped packs load when you touch matching files). Read a pack explicitly only if it is not already in context, e.g. `ui.md` when UI code is in scope but no UI file has been opened yet.
6. `.claude/zeross/knowledge/README.md`, then only the topic files relevant to the task, e.g. `auth-login.md` before any login.

Then check git state (current branch, `git status --porcelain`). The branch question itself comes later, right before the build/fix phase (see "Branch decision").
