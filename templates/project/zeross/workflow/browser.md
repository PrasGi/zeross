# Browser

How to reproduce and validate in a real browser with the Playwright MCP: safe logins, honest evidence, few side effects.

## Before opening the browser

1. Pick the app: `config.json → project.apps[]`, by the route or ticket.
2. Check its dev server at `apps[].dev.url`, e.g. with `curl -sS -o /dev/null -w '%{http_code}' <url>`.
3. If it is down, **do not start it yourself.** Ask the user to start it and show the command: `apps[].dev.command`, run from `apps[].path`. Continue with code and test work while waiting. Never start a duplicate server.
4. Read `.claude/zeross/knowledge/auth-login.md` before logging in. If it still carries the line `Status: template — not filled yet` (its first line), there is **no known login method**: ask the user how to log in (method, URL, role) instead of guessing from the template rows, and offer to save the answer to `auth-login.md` at the end (`reporting.md` → "Knowledge capture").

## Login

- Use the **fastest method** listed in `auth-login.md`, e.g. local OTP bypass, dev login route or magic link, before a full password flow.
- **Account:**
  - Use the account whose role matches the ticket, from `.claude/zeross/local.json → playwright.accounts[]`.
  - Otherwise use `playwright.defaultEmail`.
  - If no account fits the role, ask. Do not borrow another person's account.
- **Passwords (team policy: bypass first, keychain only for test accounts on local):**
  - Prefer any method that needs no password: local OTP bypass, dev login route, magic link, an existing session in the persistent profile.
  - When a password is unavoidable, use one **only** if all hold: the account is a test account (`playwright.accounts[]` with a `passwordRef`), and the target is a local dev URL (`apps[].dev.url`, `localhost`, `*.local`).
  - Get it only through the `passwordRef` keychain reference, e.g. `keychain:zeross-test-<project>-<role>`. **The one way to read it** is `zeross secret reveal <service>` (service = the ref without `keychain:`), run at the moment of typing, with the value passed straight to the input. The CLI refuses any service not named `zeross-test-*`.
  - The revealed value lands in the tool result and the typed value travels through a tool call, so both are recorded in the session transcript. That is accepted only for local test accounts; never use it for a real person's account or any non-local host, and never reveal any other secret.
  - **Never echo it** in chat, reports, logs, files, commands shown to the user, or screenshots of filled fields.
  - Anything else (no ref, non-local host, a real account): ask the user to log in manually in the open browser window. The persistent profile keeps the session.
- **OTP bypass:** compute the code exactly as `auth-login.md` describes, e.g. from the server date at login time. Never hard-code an old code, and never read or print `.env` values.
- **Controlled inputs:** if `fill()` doesn't enable the submit button, clear the field and type key by key (`browser_type` with slow typing, or `browser_press_key` per character).
- **Switching accounts:** log out, then clear the browser-context cookies and storage before logging in as someone else. Confirm the active user, workspace and role in the UI before testing.
- **Login side effects:** logins and visits can write data, such as `lastLoginAt`, activity logs, sessions or onboarding flags. Record the **before-values** of known side effects in the write log *before* logging in (`data-safety.md`), not afterwards.

## Reproduce and validate

Validation is live, through the Playwright MCP. It never produces e2e test files (team rule: `.claude/rules/zeross/testing.md` → "No e2e test files"). Helper code you need to drive the MCP (evaluate snippets, scratch scripts, payload files) goes in the session scratchpad or `$TMPDIR`, never in the repo.

- Follow the intake steps exactly (`tickets.md`): the same role, workspace, data state and URL.
- **Every validation run covers:**
  1. **The original reproduction**, now passing, or failing when you are reproducing the bug
  2. **One negative path**: invalid input, a forbidden role, or an empty state
  3. **One neighboring path**: an adjacent feature sharing the changed code, to catch regressions
- Check the console (`browser_console_messages`) and failed network requests on every page you validate.
- Measure instead of eyeballing when it matters: text, computed styles, element geometry, request payloads, `scrollWidth > clientWidth` for overflow.
- For feature work, validate each acceptance criterion in its original numbering.

## Evidence

- Save screenshots to `.playwright-mcp/`, which is gitignored. Name them `<ticket>-<step>-<before|after>.png`, where `<ticket>` is the ticket key in lowercase (`proj-123`, `gh-123`) or the branch slug for free-text tasks, e.g. `proj-123-repro-before.png`.
  `zero-ui-review` uses its own pattern with the same lowercase key: `[<ticket>-]ui-<route-slug>-<breakpoint>[-<state>].png`.
- Reference screenshot paths in the report. Never commit them.
- Do not screenshot pages showing secrets, tokens or unmasked PII.

## Failures and limits

- Tell apart: server down, browser launch failure, auth or session failure, and app error. Report the real error message.
- If browser validation can't run, say so plainly, give manual steps instead (`reporting.md`), and never claim it ran.
- Close tabs you opened when done. Leave the persistent profile in place.

## Parallel browsers

- At most `profile.json → capacity.playwright` concurrent browser sessions.
- Parallel sessions must use **isolated** Playwright instances (`--isolated`), never the shared persistent profile. Who runs them follows `executor.md`.
