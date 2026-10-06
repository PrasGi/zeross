Status: template — not filled yet

# Auth and login

Last verified: YYYY-MM-DD

How to log in to each app locally, fastest method first, and which test roles exist. Read by `.claude/zeross/workflow/browser.md` before every Playwright login.

> While the `Status: template — not filled yet` line above is present, the rows below are examples, not facts: sessions treat the login method as unknown and ask. `/zeross` (batch G) or `/zero-learn` fills this file and removes that line.

> **Never put passwords, OTP secrets, tokens or cookies in this file.** Passwords live in the OS keychain. This file names the keychain reference only. Personal account choices live in `.claude/zeross/local.json`.

## Login methods

Order rows fastest first. Use the first one that works for the role you need.

| # | App | Method | URL | When to use | Speed |
|---|---|---|---|---|---|
| 1 | web | _e.g. Email + OTP with local bypass_ | `http://localhost:3000/login` | _local only; any role_ | _~5 s_ |
| 2 | web | _e.g. Email + password_ | `http://localhost:3000/login` | _accounts without OTP; staging-like checks_ | _~10 s_ |
| 3 | web | _e.g. SSO / Google_ | `http://localhost:3000/login` | _avoid in automation; needs manual step_ | _manual_ |

### Method notes

<!-- One subsection per method that needs more than "type email and password". -->

#### 1. _Method name_

- Steps: _1. open URL 2. type email 3. submit 4. enter OTP_
- Input quirks: _e.g. controlled inputs need key-by-key typing; submit stays disabled after `fill()`_
- Success signal: _e.g. redirect to `/dashboard`, avatar menu visible_
- Login side effects: _e.g. writes `users.lastLoginAt`, creates an `activity_logs` row; record before-values first (`data-safety.md`)_

## Local OTP bypass

<!-- Delete this section if the project has no OTP. -->

- Flag: _e.g. env var `BYPASS_OTP_VERIFICATION=true`, name only, never its value or the `.env` contents_
- Active in: _local only; must be off in every shared environment_
- Code rule: _e.g. the server date at login time formatted `DDMMYY`; compute it when logging in, never reuse an old code_
- Source: _e.g. `src/auth/otp.service.ts:57`_

## Test roles

Accounts used for reproduction and validation. Passwords are referenced by keychain name only. Each teammate keeps their own references in `.claude/zeross/local.json → playwright.accounts[]`.

| Role | Email | passwordRef | Workspace / tenant | Notes |
|---|---|---|---|---|
| _admin_ | _admin@example.test_ | `keychain:zeross-test-<project>-admin` | _Acme_ | _full access_ |
| _member_ | _member@example.test_ | `keychain:zeross-test-<project>-member` | _Acme_ | _no billing access_ |
| _none (OTP)_ | _any seeded user_ | _n/a: OTP bypass_ | _n/a_ | _use method 1_ |

## Switching accounts

- Log out, then clear the browser-context cookies and storage before logging in as another role.
- Confirm the active user, workspace and role in the UI (_e.g. the workspace switcher in the top bar_) before testing.

## Known issues

- _e.g. the session expires after 15 min idle locally; re-login if a 401 appears mid-test_
