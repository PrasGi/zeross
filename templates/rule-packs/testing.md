# Testing rules

Applies to: every test file in every app (unit, integration, component). E2E test files follow `rules.e2e` (default: not written); see "No e2e test files".

> Strictness follows `rules.strictness` (see `core.md`). Workflow details such as running tests and fail-proof are in `.claude/zeross/workflow/testing.md`.

## Policy

- Follow `rules.testPolicy`:
  - `logic-and-components`: test logic (services, handlers, hooks, utils, reducers, validators) **and** every new or changed UI component that has behavior: interaction, conditional rendering, state.
  - `logic-only`: test logic. Test a component only when it holds branching logic that can't be extracted. Otherwise extract the logic into a hook or util and test that.
- Every bug fix ships a regression test that **failed before the fix**: test first (test → fail → fix → pass), or, when the fix already exists, one temporary mutation that is applied, tested and restored in a single command (see `.claude/zeross/workflow/testing.md`). Never `git stash`.
- Every acceptance criterion maps to at least one test, or to a stated manual validation.

## No e2e test files (team rule, `rules.e2e`)

`config.json → rules.e2e` decides how e2e tests are handled:

- **`none` (default, team rule):**
  - **Tests = unit tests with edge cases. Validation = live, through the Playwright MCP** (`.claude/zeross/workflow/browser.md`).
  - **Never create e2e test files** unless the user explicitly asks in this session. That covers Playwright test files (`*.spec.ts` / `*.e2e.ts` importing `@playwright/test`), Cypress specs, HTTP e2e suites (`*.e2e-spec.ts`, `supertest` against the fully bootstrapped app and its real dependencies), Selenium/WebdriverIO, Detox/Maestro flows, and the equivalents in other stacks.
  - **Existing e2e files** may be updated only when the change breaks them. Do not extend them with new cases.
- **`follow-project`:** the project already has e2e tests and the team keeps them. The user decides per task whether a change gets an e2e spec (the zeross fix/build commands ask before the fix/build phase); only then add or change a spec, following the repo's existing e2e conventions (location, naming, framework, fixtures). Always validate live through the Playwright MCP. **Never run a whole e2e suite**: run only the related spec file(s), and only against local targets.
- Either way:
  - Helper code needed to drive the Playwright MCP (evaluate snippets, scratch scripts, data payloads) lives in a private temp location (the Claude Code session scratchpad, or `$TMPDIR`), **never in the repo**. If the project forbids temp dirs, use `.claude/zeross/local/` (gitignored) instead.
  - Controller, route and handler tests stay unit-level: the handler with its collaborators mocked at the boundary (in-process helpers such as `app.inject()`, `httptest`, `MockMvc` or `TestClient` are fine), never the fully bootstrapped app against real services.

## Structure

- **Arrange–Act–Assert.** Keep three visible blocks. One behavior per test; several asserts are fine when they check the same behavior.
- Name tests as behavior: `returns 404 when the order belongs to another tenant`, not `test getOrder 2`.
- Co-locate tests per the project convention (`foo.test.ts` next to `foo.ts`, `tests/` mirroring `src/`, `*_test.go` beside the package). Follow what the app already does.
- Use the app's existing test utilities, factories, fixtures and custom render helpers. Don't create parallel ones.
- **[strict]** Table-driven or parameterized tests for input variants (`it.each`, `t.Run` tables, `@pytest.mark.parametrize`, `@ParameterizedTest`, Pest datasets).

## What to cover

- The happy path, then the error paths: invalid input, missing data, dependency failure, timeouts.
- **Edge cases are mandatory.** Cover empty, null or missing, boundary, invalid, permission, concurrency or idempotency, and i18n. Test the ones that apply and state the skipped ones with a reason.
- Authorization: unauthenticated → 401; authenticated but not allowed → 403 (or 404 when the project hides existence). Cover the cross-tenant or another user's ID case for every endpoint taking an ID.
- Never test framework code, third-party libraries or private implementation details.

## Behavior over implementation

- Assert observable outcomes: return values, rendered text and roles, HTTP status and body, persisted state, emitted events.
- Don't assert private calls, internal state, call order of internals, or CSS class names.
- UI: query by role, label or text (`getByRole`, `getByLabelText`). Use `data-testid` only as a last resort. Use `userEvent` over `fireEvent`.
- **[strict]** No snapshot tests for logic or component behavior. Snapshots only for stable serialized output (e.g. generated config), and kept small. Never update snapshots blindly.

## Mocks and data

- Mock at the boundary: HTTP clients, DB clients (in unit tests), filesystem, clock, random, queues, third-party SDKs. Never mock the unit under test or its internal collaborators.
- Prefer fakes (in-memory repo, MSW handlers, fake clock) over deep mock chains.
- Factories over large fixtures. Use only the fields relevant to the scenario.
- Deterministic tests only:
  - freeze time (`vi.useFakeTimers`, `freezegun`, an injected clock)
  - seed randomness
  - no real network
  - no dependence on test order or shared mutable state
- Integration tests isolate data: a transaction rolled back per test, a fresh schema or container, or tagged records cleaned in teardown. Never hit shared dev or staging data from automated tests.
- No `sleep` or fixed timeouts. Wait for conditions (`findBy*`, `waitFor`, `expect.poll`, `Eventually`).

## Hygiene

- No `.only`, `.skip`, `xit`, `t.Skip` or `@Disabled` left in the diff without a ticket reference.
- Don't loosen assertions to make a test pass. Fix the code, or fix the test's wrong expectation and say why.
- Type test code as strictly as production code. No `any` in tests to silence errors.
- Clean up subscriptions, timers, servers and DOM between tests (`afterEach`), unless the runner does it automatically.
