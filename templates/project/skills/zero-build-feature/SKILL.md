---
name: zero-build-feature
description: Plan and build a substantial feature from Jira/GitHub tickets or free text — discovery across parent/sub/linked tickets and designs, batched decisions, an approved written plan in plan mode, wave-by-wave implementation within machine capacity, tests, reviews, Playwright validation per acceptance criterion, docs and cleanup. Never commits.
argument-hint: "[JIRA-123 | jira url | github issue url | #123 | free text] … (multiple allowed)"
---

# /zero-build-feature

Input: `$ARGUMENTS`

The shared workflow is the source of truth; this file is the step sequence and
feature-specific gates.

## 0. Load

1. Load per `.claude/zeross/workflow/core.md` → "Load at task start": `config.json`
   (missing → stop and tell the user to run `/zeross`), `profile.json`
   (`capacity`, `executor`, `mcpRoles`), `local.json`, `core.md` and `questions.md`
   now, the other workflow files when their phase starts. Rule packs are
   auto-loaded by Claude Code from `.claude/rules/zeross/` (path-scoped packs load
   when you touch matching files); read a pack explicitly only if it is not already
   in context. Knowledge: the README plus the relevant topics only. `ui.md` only
   when UI is in scope.
2. Parse `$ARGUMENTS` into tickets (Jira key/URL, GitHub URL / `owner/repo#N` /
   `#N`, free text). Empty → ask what to build.
3. Check git state per `core.md`.
4. **First decision batch**: any visible intake gap. The branch is decided after
   plan approval, right before implementation (step 4). The saved plan (step 3)
   goes to the gitignored `.claude/zeross/local/plans/`, so it never needs a branch.

## 1. Discovery

- **Tickets** (`tickets.md`): every ticket plus its parent, sub-tickets and linked
  tickets, with comments. Preserve acceptance criteria (AC) in their original
  numbering. List unreadable images and ask for screenshots.
- **Designs** (`tickets.md` → "Design references"): images or links on any platform;
  ask for an exported image when a link can't be read. Note gaps against the design
  system in `ui.md`, and pass the references to `zero-ui-review` later.
- **Current state** (`evidence.md`, `browser.md`): code paths with file:line, a
  Playwright screenshot of affected routes, read-only data queries.
- **Requirement status** per AC using `reporting.md`: `BUILD` / `PARTIAL` /
  `EXISTS` / `NEEDS DECISION`.
- Run read-only explore subagents in parallel within `capacity.understanding`
  (`executor.md`).

## 2. Discussion

Per `questions.md`: batch related decisions (≤4 per `AskUserQuestion` call),
recommendation first, findings shown before asking. Repeat until no open questions
remain. Typical decisions: scope cut, data model, API shape, permissions, rollout
flag, empty/error behavior.

When `config.json → rules.e2e` is `follow-project` and the touched app has an e2e setup
(`e2e/` folder, `playwright.config.*`, a `test:e2e` script), one of these decisions is the
**final validation method**: "live Playwright MCP only, or also e2e specs?" (name the
spec files and scenarios per acceptance criterion). Recommend e2e only where the repo
already covers the area with e2e. The plan's validation section records the answer;
never add an e2e spec the user did not choose. With `rules.e2e: none`, do not ask.

Destructive user actions follow "Destructive actions" in
`.claude/rules/zeross/core.md` (ask when the confirmation behavior is unspecified;
do not re-ask what the user already decided).

## 3. Plan (plan mode)

Call `EnterPlanMode` (if it is only listed as a deferred tool, load it first with
`ToolSearch` → `select:EnterPlanMode,ExitPlanMode`), then write the plan with these sections:

1. **Acceptance criteria** — original numbering, final status per AC.
2. **Architecture** — components, boundaries, a mermaid flow when useful.
3. **Data model / migration** — entities, fields, indexes; migration and backfill;
   backward compatibility.
4. **API contracts** — method, path, auth, request, response, errors.
5. **UI states** — loading, empty, error, permission-denied; breakpoints from config.
6. **Destructive-action confirmations** — per action, the dialog as defined in
   "Destructive actions" in `.claude/rules/zeross/core.md` (title, what is lost,
   labels, shared copy constant, existing dialog reused).
7. **Files** — create/modify list, grouped by app.
8. **Test plan** — unit tests per AC (test first), edge and permission cases,
   prove-fail method. E2E files per `rules.e2e` (`testing.md`).
9. **Validation plan per AC** — live Playwright MCP steps, account role, expected result.
10. **Risks, flags and rollout** — feature flag, migration order, rollback.
11. **Docs** — modules whose docs will be updated, created (new module) or stubbed.
12. **Task waves** — each task: id, owned files, depends-on, related tests,
    executor (inline / native subagent / Orca worker). Tasks in one wave never
    share a file; parallelism stays within `profile.json → capacity`.

Call `ExitPlanMode` for approval. Revise until approved.

**Fallback** — if plan mode is unavailable or declined: write the same plan to
`.claude/zeross/local/plans/<slug>.md` and ask for approval with
`AskUserQuestion` (Approve / Revise). After approval in plan mode, also save the
approved plan there so progress survives context compaction.

## 4. Implement, wave by wave

**Branch decision first** (`core.md` → "Branch decision"): one `AskUserQuestion`
call — new branch `<git.branchPattern.feature>` or stay on the current branch, and, for a new branch,
which source to branch from (recommended source first, with a one-line reason).
Create the branch only if they chose a new one. Ask once. On a protected branch,
do not offer "stay".
For a multi-wave feature, the parent ticket's branch or the base branch are the usual
sources; Orca workers and subagents all work on the branch chosen here.


Per `executor.md`:

- Small or tightly coupled tasks → inline.
- Large sub-tasks, when `executor` is `auto` and Orca is detected → Orca workers
  (visible tabs, ask/reply); otherwise native subagents or serial.
- **Never** two agents on the same file; never more unit-test processes or
  Playwright instances than `capacity` allows.
- Each task follows **test → fail → implement → pass** (`testing.md`): write its
  unit tests first and record the failing run, implement, rerun and record the pass;
  edge cases, related test files only, lint changed files only. E2E files per `rules.e2e`.
  The mutation fallback applies only when code already exists before its test.
- After each wave: review every worker diff yourself, run that wave's related
  tests, tick completed tasks in the saved plan. Do not start the next wave on a
  red wave.

## 5. Reviews (fix-blockers mode)

Call each skill with `--fix`, say explicitly **mode: fix-blockers**, and pass the
task's file list (the review stays inside it):

- Backend, input handling or auth touched → `zero-security-review diff --fix`.
- UI touched → `zero-ui-review --fix` with the changed UI files and affected routes.
- Large diffs: the review skills may fan out subagents within capacity.
- Re-run related tests after review fixes.

## 6. Validate per AC (Playwright)

Per `browser.md`: run the validation plan for every AC live through the
Playwright MCP, plus one negative and one neighboring path (e2e files per `rules.e2e`;
scratch helpers stay outside the repo). Parallel validation only with `--isolated`
instances and within `capacity.playwright`. Screenshots to `.playwright-mcp/`.
State any limit.

## 7. Docs

**Mandatory, every run (team rule; no config switch).** Invoke `zero-docs-writer`,
say it is called by this command, and pass the changed files and tickets:

- **New module** → `create` the full module doc.
- Touched module with a doc → `update` the affected sections and add a Changelog
  entry (date, ticket/PR link, one-line summary). A change with no documented
  behavior still gets that one-line entry.
- Touched existing module with **no doc yet** → `stub` (front matter, a 2–5 line
  Overview, the Changelog entry), or `create` when the user asks for a full doc.

The docs writer writes directly; it asks once only when it would create the docs
root folder itself. If docs cannot be written, report it as an open item. Never
skip this step.

## 8. Report against the AC

Use the final report template in `reporting.md`:

- AC table: AC number, final status (`DONE` / `PARTIAL` / `NOT DONE` / `DEFERRED`,
  defined in `reporting.md` → "Final requirement status"), evidence (test name,
  screenshot path)
- branch/base, files changed per wave, deviations from the plan and why
- tests with fail-proof; browser evidence or limits
- docs: created / updated / stub created / open
- migrations/flags to run, rollout notes
- manual test steps with real local URLs and account role/email (never passwords)
- `Data cleanup: pending (question below)` when data changed
- knowledge-capture candidates (multiSelect; save confirmed ones via the procedure
  in `.claude/skills/zero-learn/SKILL.md`)

Mark only completed tasks done in the saved plan; record pending cleanup or
blockers explicitly.

## 9. Cleanup

Per `data-safety.md` → "Cleanup": no writes → nothing to ask. Otherwise list the
write log and ask delete / keep for manual testing / defer (with a recommendation);
execute, read back, and add the one-line outcome addendum to the report.

## 10. Hand-off

Offer `/zero-create-pr`. Never commit, push or open a PR from this skill.

## Stop conditions

Stop dependent work and report when: necessary evidence is missing; requirements
conflict; scope grows beyond the approved plan (re-plan and re-approve); unrelated
uncommitted edits overlap target files; a core test does not fail without the new
behavior; a wave stays red after fixing your own failures; cleanup cannot safely
restore captured state.
