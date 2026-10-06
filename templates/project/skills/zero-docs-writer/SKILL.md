---
name: zero-docs-writer
description: Write and maintain module-based project docs (one file per module with front matter mapping code to docs) — create a module doc from code, add a short stub for a module that has none, update docs affected by the current diff, or audit which docs are stale. Documents what the code does; never guesses.
argument-hint: "create <module> | stub <module> | update | audit"
---

# zero-docs-writer

Input: `$ARGUMENTS` → mode `create <module>`, `stub <module>`, `update`, or
`audit`. No mode → `update` when the working tree or branch has changes, otherwise
ask.

## Invocation behavior

- **Invoked directly by the user (report-only):** show the planned changes (files
  and sections, or the audit table) and ask before writing.
- **Called by a command** (`/zero-fix-bug`, `/zero-build-*`): docs are mandatory on
  every run. Write directly, without asking, within the affected modules, and
  return the list of files changed:
  - module has a doc → `update` + a Changelog entry (a one-liner even for changes
    with no documented behavior)
  - module has no doc → `stub`, unless the command asks for `create` (a new module
    in `/zero-build-feature`, or the user asked for a full doc)
  - **Ask once**, only when you would create the docs root folder itself (the
    resolved docs path does not exist yet): create it (Recommended) / skip docs for
    this task. On skip, return "docs not written: <reason>" so the command reports
    it as an open item.

## Load

- `.claude/zeross/config.json`: `docs.path` (relative to the project root),
  `project.apps` (including `apps[].docsPath`), `tickets.*`, `git.baseBranch`.
- `~/.claude/zeross/profile.json` → `capacity.understanding`, before fanning out
  subagents (missing → work serially).
- **Docs root per app:** `project.apps[].docsPath` when set, else `docs.path`. A
  module that spans apps with different roots lives under the root of the app that
  owns most of its `sources`; mention it in the other root's index.
- Index `<docs root>/README.md`. For module docs under `<docs root>/modules/`,
  read **only their front matter** first (enough to match `sources`, e.g. the lines
  between the leading `---` markers); open a full doc only when it is affected or
  being audited.
- Templates: `${CLAUDE_SKILL_DIR}/references/module-template.md` and
  `${CLAUDE_SKILL_DIR}/references/index-template.md`.
- The docs root does not exist yet → create it with the index template (direct
  invocation: ask first; called by a command: the ask-once rule above).

## Layout

```
<docs root>/README.md                # index: module table
<docs root>/modules/<module>.md      # one per module (auth, user, billing, …)
<docs root>/modules/<module>/        # split form when a doc exceeds ~400 lines:
  README.md                          #   front matter + overview + section links
  <section>.md                       #   e.g. interfaces.md, data-model.md
```

Module names are kebab-case business domains, not folder names.

## Module doc contract

Front matter (YAML); every key except `owner` is required:

```yaml
module: billing
apps: [api, web]                 # names from config project.apps
sources:                         # globs (project-root relative) mapping code → module
  - apps/api/src/billing/**
  - apps/web/src/app/(app)/billing/**
last_updated: 2026-10-06
related_tickets: [VTX-123, acme/web#45]
owner: ""                        # optional; shown in the index ("-" when empty)
stub: true                       # optional; only on stubs, removed when the doc is completed
```

Sections, in order (see the template): Overview · Architecture (components + a
mermaid flow) · Data model · Interfaces (backend endpoints; frontend routes,
components, state) · Business rules and edge cases · Permissions · Configuration
(env var names only) · Events, jobs and integrations · How to test · Changelog.
Keep a section with "None." when it does not apply; never delete headings.
**Stubs** are the one exception: front matter (with `stub: true`), Overview and
Changelog only.

## Modes

### `create <module>`

1. Find the module's code: routes/controllers, services, models/schemas, UI routes,
   jobs, tests. Derive `sources` globs that match only this module. Direct
   invocation: show them for confirmation. Called by a command: write them and list
   them in the returned report.
2. Read the code (read-only subagents per app within `capacity.understanding` for
   large modules) and fill every section from what the code does.
3. Write the doc from the module template; add the row to the index.

### `stub <module>`

For a touched module that has no doc yet, when a full doc is not requested.

1. Derive `sources` globs from the changed files' folders (keep them narrow; they
   can be widened later) and `apps` from `config.json`.
2. Write `<docs root>/modules/<module>.md` with: the front matter (`module`,
   `apps`, `sources`, `last_updated`, `related_tickets`, `stub: true`), an
   **Overview** of 2–5 lines on what the module does, taken from the code you read
   in this task (no guesses), and a **Changelog** with this task's entry.
3. Add the index row. A later `create <module>` fills the remaining sections and
   drops `stub: true`.

### `update`

1. Diff = `git merge-base HEAD origin/<git.baseBranch>` → working tree (committed
   branch changes plus uncommitted changes).
2. Map each changed file to modules by matching the `sources` globs from the
   front matter read at load time. Then open only the affected docs.
   - Changed files matching no module → list them. Direct invocation: offer `create`
     or `stub` for a new module, or extending an existing module's `sources`.
     Called by a command: `stub` (or `create` when the command asked for it).
3. For each affected module, update only the sections whose facts changed (an
   endpoint, a field, a rule, a permission, an env var name, a flow). On a stub,
   update the Overview only when it became wrong.
4. Set `last_updated` to today, add tickets to `related_tickets`, and add one
   Changelog row: date, ticket or PR link, one-line summary.
5. Refresh the module's index row.

### `audit` (always report-only)

For each module doc: last commit date touching its `sources`
(`git log -1 --format=%cs -- ':(glob)<glob>' …`) vs `last_updated`.

| Module | last_updated | Sources changed | Status |
|---|---|---|---|
| billing | 2026-08-01 | 2026-09-20 | STALE |

Also list stubs (`stub: true`), modules in the index without a file, files without
an index row, and source directories no module claims. Offer `update` for stale
modules and `create` for stubs.

## Writing rules

- Document code reality. Cite the source for non-obvious facts. Never guess:
  unknowns become `> TODO: <what is unknown and where to confirm it>`.
- No secrets, tokens, passwords, connection strings or internal-only URLs. Env vars
  by **name only**.
- English only, regardless of conversation language.
- Flows as mermaid (`flowchart` or `sequenceDiagram`), small and accurate.
- Link file paths relative to the doc file, e.g.
  `[billing.service.ts](../../apps/api/src/billing/billing.service.ts)`.
- Prefer tables for endpoints, fields, permissions and env vars.
- Match the existing docs' tone when the folder already exists; do not rewrite
  unrelated sections.

## Index maintenance

Each docs root's `README.md` keeps one table, sorted by module name:

| Module | Apps | Owner | Last updated | Doc |
|---|---|---|---|---|

Every module doc has exactly one row; values come from its front matter. Stubs
show `(stub)` after the module name.

## Report

Files created/updated/stubbed, sections touched per module, `sources` globs
written, TODOs left, unmapped changed files, or "docs not written: <reason>". Never
commit.
