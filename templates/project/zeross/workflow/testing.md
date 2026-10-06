# Testing

How to write, prove and run tests for a change: only the related files, with a proven failure first and the edge cases covered.

## Scope of tests

- Every code change needs unit coverage for the changed behavior. Coverage follows `config.json → rules.testPolicy`:
  - `logic-and-components`: logic (services, hooks, utils, handlers) **and** UI components with behavior
  - `logic-only`: logic only; test components only when they hold branching logic
- Update tests that assert obsolete behavior. Never delete a test to make the suite pass.
- Cover each acceptance criterion and each verdict's root cause with at least one test.
- Follow `.claude/rules/zeross/testing.md` for structure (AAA, naming, mocking).
- **E2E tests follow `config.json → rules.e2e`** (canonical in `.claude/rules/zeross/testing.md` → "No e2e test files"):
  - `none` (default, team rule): tests are unit tests with edge cases; validation runs live through the Playwright MCP (`browser.md`). Never create Playwright/Cypress/supertest e2e files unless the user explicitly asks; update existing ones only when the change breaks them.
  - `follow-project`: follow the repo's existing e2e conventions when a change calls for an e2e case. Still validate live through the Playwright MCP, and never run a whole e2e suite: only the related spec file(s).
  - Scratch helpers for the Playwright MCP live in the session scratchpad or `$TMPDIR`, never in the repo. If the project forbids temp dirs, use `.claude/zeross/local/` (gitignored).

## Edge cases (mandatory)

For each changed behavior, consider every category below. Test the ones that apply, and list the skipped ones with a reason in the report.

| Category | Examples |
|---|---|
| Empty | empty string, list, object or result set; no rows |
| Null / missing | `null`, `undefined`, absent field, optional relation missing |
| Boundary | 0, 1, max, max+1, page limits, date at midnight or month end, time zones |
| Invalid | wrong type or format, unknown enum, malformed ID, oversized input |
| Permission | unauthenticated, wrong role, another tenant's or user's resource (expect 403/404 as designed) |
| Concurrency | double submit, two writers, retry or idempotency, stale read |
| i18n | long translations, non-ASCII, RTL if supported, locale-formatted numbers and dates |

## Prove the test fails

A regression test is only proof if it fails on the broken behavior. **Test → fail → fix → pass** is the order. Use one of these:

1. **Test first (default).** Write the test before the fix, run it, and record the failing output (test name and assertion message). Then fix, rerun, and record the pass.
2. **Temporary mutation (fallback).** Only when the fix already exists (e.g. a review fix, or code written before the test). Make **one exact mutation per essential behavior** that reintroduces the defect. Because a `try/finally` can't span tool calls, back up, mutate, test and restore in **one Bash command**, so the restore runs even when the test fails:

   ```bash
   cp src/foo.ts src/foo.ts.zeross-bak && <mutate src/foo.ts, e.g. a sed -i edit> && <related test command>; mv src/foo.ts.zeross-bak src/foo.ts
   ```

   1. Confirm the test failed for the expected reason.
   2. Check the focused diff (`git diff -- src/foo.ts`) to confirm the restoration, and that no `*.zeross-bak` file is left.
   3. Rerun the test and confirm it passes.
- **Never `git stash`**, `git checkout -- <file>` or any command that can drop unrelated changes.
- If a regression test passes against the broken behavior, stop. The test does not cover the bug. Fix the test before going further.

## Running tests

- Run **only the related test files**, using the app's command: `config.json → project.apps[].test.command`, with `{files}` replaced by the space-separated test file paths.
  - Example: `pnpm vitest run src/foo/foo.test.ts src/foo/bar.test.ts`.
  - Run it from the app's `path` when the command expects that.
- Related files means:
  - tests you added or changed
  - tests of the modules you changed
  - tests of their direct callers when the contract changed
- **Never run the whole suite. Never add `--coverage`.** Not to "be safe", and not at the end. The same holds for e2e suites when `rules.e2e` is `follow-project`: only the related spec.
- At most `profile.json → capacity.unitTest` test processes at a time across all agents. Default to one.
- Report the exact commands, the pass/fail counts and any failures honestly. Fix the failures your change introduced. Report pre-existing failures as pre-existing, with evidence: they fail on the base too, or are unrelated.

## Lint

- Lint only the changed files: `config.json → project.apps[].lint.command`, with `{files}` replaced by the changed source and test files.
- Fix the lint errors you introduced. Do not fix lint in untouched code.
- If no lint command is configured, say so and skip it.

## Guard hook

The guard hook, what it blocks and its escape hatches are canonical in `.claude/rules/zeross/core.md` → "Side effects". If it blocks a test command, narrow it to the related files instead of reaching for `ZEROSS_ALLOW_FULL_TESTS=1`.
