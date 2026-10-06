---
name: zero-build-small-feature
description: Build a small, well-scoped feature or enhancement from Jira keys/URLs, GitHub issues or free text — assess the current state, report a status per requirement, implement by copying an existing pattern, test, review, validate in the browser and clean up. Recommends /zero-build-feature when the work is too big. Never commits.
argument-hint: "[JIRA-123 | jira url | github issue url | #123 | free text] … (multiple allowed)"
---

# /zero-build-small-feature

Input: `$ARGUMENTS`

Same flow as `/zero-fix-bug`, with reproduction replaced by a current-state
assessment and a size guard. The shared workflow is the source of truth; this file
is the step sequence and feature-specific gates.

## 1. Load

1. Load per `.claude/zeross/workflow/core.md` → "Load at task start": `config.json`
   (missing → stop and tell the user to run `/zeross`), `profile.json`,
   `local.json`, `core.md` and `questions.md` now, the other workflow files when
   their phase starts. Rule packs are auto-loaded by Claude Code from
   `.claude/rules/zeross/` (path-scoped packs load when you touch matching files);
   read a pack explicitly only if it is not already in context. Knowledge: the
   README plus the relevant topics only. `ui.md` only when UI is in scope.
2. Resolve MCP roles via `profile.json → mcpRoles`.
3. Parse `$ARGUMENTS` into tickets (Jira key/URL, GitHub URL / `owner/repo#N` /
   `#N`, free text). Empty → ask what to build.
4. Check git state per `core.md`.
5. **First decision batch**: any visible intake gap. The branch is decided right
   before the build phase (step 5).

## 2. Intake

Per `tickets.md`: description, comments, links, parent and sub-tickets through the
Jira/GitHub MCP. Preserve acceptance criteria and their original numbering. List
unreadable images and ask for screenshots. Collect designs per `tickets.md` → "Design
references" (images or links on any platform) and pass them to `zero-ui-review`.

## 3. Current-state assessment

Per `evidence.md`, `browser.md`, `data-safety.md` and `executor.md`:

- **Code** → what exists today: route → component/handler → service → data, with
  file:line. Find the closest existing similar feature to copy.
- **UI** → Playwright screenshot of the current state on the affected route(s),
  logged in via `.claude/zeross/knowledge/auth-login.md` (fastest method).
- **Data** → read-only queries for the entities involved; dummy data only under
  the data-safety policy.
- Run read-only understanding subagents in parallel within
  `capacity.understanding`.

## 4. Requirement status and gate

Report one row per requirement (AC numbering preserved) with the status table in
`reporting.md` → "Feature requirement status" (`BUILD` / `PARTIAL` / `EXISTS` /
`NEEDS DECISION`). Follow with a **short approach** that copies the existing pattern
found in step 3 (files to touch, pattern source file:line, tests to add).

**Size guard** — if the assessment shows any of: a schema change or migration, a
new module, changes across several apps, or more than ~5–6 files →
`AskUserQuestion`: switch to `/zero-build-feature` (Recommended) / continue here
with the stated scope. On switch, stop and hand over the findings so far.

**Gate** — business flow, auth, permissions, schema/migrations, money, any
`NEEDS DECISION`, or you are uncertain → `AskUserQuestion` with 2–4 options and a
recommendation. Otherwise state the approach and proceed.

Destructive user actions follow "Destructive actions" in
`.claude/rules/zeross/core.md` (ask when the confirmation behavior is unspecified).

## 5. Test → fail → build → pass

**Branch decision first** (`core.md` → "Branch decision"): one `AskUserQuestion`
call — new branch `<git.branchPattern.feature>` or stay on the current branch, and, for a new branch,
which source to branch from (recommended source first, with a one-line reason).
Create the branch only if they chose a new one. Ask once. On a protected branch,
do not offer "stay".


Per `testing.md` (→ "Prove the test fails"), for each `BUILD` and `PARTIAL` item:

1. **Test first.** Write the unit tests for the requirement (unit tests; e2e
   files per `rules.e2e`, see `testing.md`). Run them and record the failing output.
2. **Build.** Implement only `BUILD` and `PARTIAL` items, copying the chosen
   pattern. Stay within the rule packs; UI follows the design system in `ui.md`.
   Cover loading, empty, error and permission states for new UI.
3. **Pass.** Rerun and record the pass. Add the edge-case and permission tests, run
   only the related test files, and lint only the changed files.

The mutation fallback in `testing.md` applies only when the code already exists
before the test (e.g. a review fix). Never `git stash`.

## 6. Reviews (fix-blockers mode)

Call each skill with `--fix`, say explicitly **mode: fix-blockers**, and pass the
task's file list (the review stays inside it):

- Backend, input handling or auth touched → `zero-security-review diff --fix`.
- UI touched → `zero-ui-review --fix` with the changed UI files and affected routes.
- Re-run related tests after review fixes.

## 7. Validate (Playwright)

Per `browser.md`: exercise every requirement live through the Playwright MCP, plus
one negative path and one neighboring path (e2e files per `rules.e2e`; scratch helpers stay
outside the repo). Screenshots to `.playwright-mcp/`. State any limit.

## 8. Docs

**Mandatory, every run (team rule; no config switch).** Invoke `zero-docs-writer`,
say it is called by this command, and pass the changed files and tickets:

- The touched module has a doc → `update` the affected sections and add a Changelog
  entry (date, ticket/PR link, one-line summary). A change with no documented
  behavior still gets that one-line entry.
- The touched module has **no doc yet** → `stub`: front matter, a 2–5 line
  Overview and the Changelog entry. A full doc only when the user asks.

The docs writer writes directly; it asks once only when it would create the docs
root folder itself. If docs cannot be written, report it as an open item. Never
skip this step.

## 9. Report done

Use the final report template in `reporting.md`: requirement table with the final
status (`DONE` / `PARTIAL` / `NOT DONE` / `DEFERRED`), branch/base, files changed,
tests with fail-proof, browser evidence, manual test steps with real local URLs and
the account role/email (never passwords), docs, `Data cleanup: pending (question
below)` when data changed, and knowledge-capture candidates (multiSelect; save
confirmed ones via the procedure in `.claude/skills/zero-learn/SKILL.md`).

## 10. Cleanup question

Per `data-safety.md` → "Cleanup": no writes → nothing to ask. Otherwise list the
write log and ask delete / keep for manual testing / defer (with a recommendation);
execute, read back, and add the one-line outcome addendum to the report.

## 11. Hand-off

Offer `/zero-create-pr`. Never commit, push or open a PR from this skill.

## Stop conditions

Stop dependent work and report when: necessary evidence is missing; requirements
conflict; scope grows beyond authorization (re-apply the size guard); unrelated
uncommitted edits overlap target files; a core test does not fail without the new
behavior; cleanup cannot safely restore captured state. Failures caused by your own
change are not stop conditions — fix and rerun.
