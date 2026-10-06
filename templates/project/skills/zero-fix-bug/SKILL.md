---
name: zero-fix-bug
description: Reproduce, root-cause and fix one or more bugs from Jira keys/URLs, GitHub issues or free text — with a verdict per ticket, prove-fail regression tests, security/UI reviews, Playwright validation, docs update and dummy-data cleanup. Never commits.
argument-hint: "[JIRA-123 | jira url | github issue url | #123 | free text] … (multiple allowed)"
---

# /zero-fix-bug

Input: `$ARGUMENTS`

This skill is the step sequence and bug-specific gates. The shared workflow is the
source of truth for everything else — do not restate or override it.

## 1. Load

1. Load per `.claude/zeross/workflow/core.md` → "Load at task start": `config.json`
   (missing → stop and tell the user to run `/zeross` first), `profile.json`,
   `local.json`, `core.md` and `questions.md` now, the other workflow files when
   their phase starts. Rule packs are auto-loaded by Claude Code from
   `.claude/rules/zeross/` (path-scoped packs load when you touch matching files);
   read a pack explicitly only if it is not already in context. Knowledge: the
   README plus the relevant topics only. `ui.md` only when UI is in scope.
2. Resolve MCP roles from `profile.json → mcpRoles` (the GitHub, Jira, DB and
   Playwright MCP). Note which are unavailable; never guess server names.
3. Parse `$ARGUMENTS` into tickets. Each item is one of:
   - Jira key (`[A-Z][A-Z0-9]+-\d+`) or Jira URL (`…/browse/KEY-123`)
   - GitHub issue URL, `owner/repo#123`, or `#123` (repo = `tickets.github.repo`)
   - free text (one bug description per distinct report)
   - Empty input → ask what to fix.
4. Check git state per `core.md`: current branch, uncommitted changes, base.
5. **First decision batch** (per `questions.md`, one `AskUserQuestion` call):
   - for several unrelated tickets: one combined run, or separate runs
   - any intake gap already visible (environment, account role)

   The branch is decided later, right before the first file write (step 3 or 5).

## 2. Intake

Per `tickets.md`, for every ticket:

- Fetch description, comments, links, parent and sub-tickets through the Jira or
  GitHub MCP. When something looks wrong, read parent and sibling tickets.
- Images the MCP cannot read → list them and ask the user to paste screenshots.
- Extract: expected vs actual, steps, environment, role/account, app.
- Treat each ticket independently.

## 3. Reproduce

Per `evidence.md`, `browser.md`, `data-safety.md` and `executor.md`:

- **UI bug** → Playwright MCP, logged in by the fastest method in
  `.claude/zeross/knowledge/auth-login.md`. Dev server down → ask the user to
  start it; do not start a duplicate.
- **Non-UI bug** → a failing unit test, `curl` against local, or a read-only DB
  query. A failing unit test written here becomes the regression test in step 5;
  before writing it, run the branch decision from step 5 (it is then not asked again).
- **Data** → search existing data first; create dummy data only under the
  data-safety policy (write log before every write).
- **Root cause** → trace route → component/handler → caller → test with file:line.
- Run read-only understanding subagents in parallel, within
  `profile.json → capacity.understanding`.

Code inspection alone is not a UI reproduction.

## 4. Verdict and gate

Report one row per ticket with the verdict table and verdict rules in
`reporting.md` → "Bug verdict" (`VALID` / `NOT REPRODUCIBLE` / `BLOCKED` /
`WORKS AS DESIGNED`). Fix only `VALID` tickets; invalid or blocked tickets never
stall valid ones. Apply the **gate** defined there: risky or uncertain fixes →
`AskUserQuestion` with 2–4 options and a recommendation, then wait; otherwise state
the short plan and proceed.

## 5. Test → fail → fix → pass

**Branch decision first** (`core.md` → "Branch decision"): one `AskUserQuestion`
call — new branch `<git.branchPattern.fix>` or stay on the current branch, and, for a new branch,
which source to branch from (recommended source first, with a one-line reason).
Create the branch only if they chose a new one. Ask once. On a protected branch,
do not offer "stay".

**Final validation method** (only when `config.json → rules.e2e` is `follow-project` **and** the
app you touch has an e2e setup, e.g. an `e2e/` folder, `playwright.config.*` or a `test:e2e` script;
otherwise do not ask and validate with the Playwright MCP only): add
a question to that same `AskUserQuestion` call — "Final validation: live Playwright MCP
only, or also an e2e spec?" Options: **Playwright MCP only** / **Add or update an e2e
spec** (name the spec file and the scenario). Recommend e2e only when the repo's
conventions or the touched area already have e2e coverage for this flow; otherwise
recommend MCP only. Never create or change an e2e spec without this answer; fixing an
existing spec that your change breaks needs no question. With `rules.e2e: none`, do
not ask: validation is MCP only.


Per `testing.md` (→ "Prove the test fails"), for each `VALID` ticket:

1. **Test first.** Write or extend the unit regression test for the root cause
   (unit tests; e2e files per `rules.e2e`, see `testing.md`). Run it with the app's
   `test.command` and record the failing output (test name and assertion).
   It passes against the broken code → stop: the test does not cover the bug.
2. **Fix.** Minimal change within the rule packs; match surrounding code. Use
   existing or dummy data only. A new destructive user action follows "Destructive
   actions" in `.claude/rules/zeross/core.md`.
3. **Pass.** Rerun the test and record the pass. Add the edge-case tests, update
   obsolete assertions (never delete them to make tests pass), run only the related
   test files, and lint only the changed files with `lint.command`.

The mutation fallback in `testing.md` applies only when the fix already exists
before the test (e.g. a review fix).

## 6. Reviews (fix-blockers mode)

Call each skill with `--fix`, say explicitly **mode: fix-blockers**, and pass the
task's file list (the review stays inside it):

- Backend, input handling or auth touched → `zero-security-review diff --fix`.
- UI touched → `zero-ui-review --fix` with the changed UI files and affected routes.
- Re-run the related tests after any review fix.

## 7. Validate (Playwright)

Per `browser.md`: rerun the original reproduction, plus one negative path and one
neighboring path, live through the Playwright MCP (e2e files per `rules.e2e`; scratch
helpers stay outside the repo). Save screenshots to `.playwright-mcp/`. If the
browser is unavailable, say so and give manual steps — never claim it ran.

## 8. Docs

**Mandatory, every run (team rule; no config switch).** Invoke `zero-docs-writer`,
say it is called by this command, and pass the changed files and tickets:

- The touched module has a doc → `update` the affected sections and add a Changelog
  entry (date, ticket/PR link, one-line summary). A change with no documented
  behavior (internal refactor, test-only, typo) still gets that one-line entry.
- The touched module has **no doc yet** → `stub`: front matter, a 2–5 line
  Overview and the Changelog entry. A full doc only when the user asks.

The docs writer writes directly; it asks once only when it would create the docs
root folder itself. If docs cannot be written (e.g. the user declines that folder),
report it as an open item. Never skip this step.

## 9. Report done

Use the final report template in `reporting.md`. It must include:

- summary and root cause per ticket
- branch and actual base, files changed
- tests: commands, results, the fail-proof
- browser evidence (screenshot paths) or the stated limit
- **manual test steps with real local URLs** and the account/role to use
  (email only, never passwords)
- docs: updated / stub created / open
- `Data cleanup: pending (question below)` when data changed
- knowledge-capture candidates as an `AskUserQuestion` multiSelect; save only the
  confirmed ones by following the write procedure in
  `.claude/skills/zero-learn/SKILL.md` (read it; it is user-invoked only)

## 10. Cleanup question

Per `data-safety.md` → "Cleanup": no data written → nothing to ask. Otherwise list
the dummy data from `.claude/zeross/local/data-log/<task>.jsonl`, ask **delete** /
**keep for manual testing** / **defer** with a recommendation, execute the choice,
read back every revert or deletion, and add the one-line outcome addendum to the
report. A value that changed since the test is retained, not cleaned.

## 11. Hand-off

- Offer `/zero-create-pr` (the user types it).
- **Never** commit, push or open a PR from this skill.

## Stop conditions

Stop dependent work and report (do not improvise around it) when:

- necessary evidence is missing (cannot reproduce, no access, unreadable screenshot)
- requirements conflict (ticket vs comments vs parent vs code)
- scope grows beyond what was authorized
- unrelated uncommitted edits overlap the files to change
- the regression test does not fail against the broken behavior (prove-fail failed)
- cleanup cannot safely restore the captured state

Failures caused by your own fix are not stop conditions — repair them and rerun.
