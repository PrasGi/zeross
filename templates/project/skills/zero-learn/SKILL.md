---
name: zero-learn
description: Save something learned about this project — team knowledge, a team rule, a team config change, a personal setting, or a secret (stored in the OS keychain, reference only) — with duplicate/conflict checks, a diff preview and confirmation before writing.
argument-hint: "[what to remember, in plain text]"
disable-model-invocation: true
---

# /zero-learn

Input: `$ARGUMENTS`. Empty → ask what to remember.

Commands (`/zero-fix-bug`, `/zero-build-*`) also read this file to save confirmed
knowledge-capture candidates at the end of a task; follow the same steps 2–6.

## 1. Load

Skip any file already in context. Read `.claude/zeross/workflow/questions.md`,
`.claude/zeross/config.json`, `.claude/zeross/knowledge/*.md`,
`.claude/rules/zeross/custom.md` and `.claude/rules/zeross/ui.md` (both are usually
auto-loaded already), `zeross local get --json` and `zeross profile get --json`.

## 2. Classify

Split the input into items; classify each one:

| Class | Destination | Examples |
|---|---|---|
| Team knowledge | `.claude/zeross/knowledge/<topic>.md` | fastest login path, test roles, OTP bypass rule on local, seed commands, gotchas |
| Team rule | `.claude/rules/zeross/custom.md` | "no `any`", "every new endpoint needs a rate limit" |
| Team config | `.claude/zeross/config.json` (e.g. `ui.*`, `pr.*`, `git.*`); UI rules via `ui.*` | "reviewers are alice and bob", "base branch is `develop`", "touch targets ≥ 44 px on mobile", "dark mode is on now" |
| Personal setting | `.claude/zeross/local.json` (per project) or `~/.claude/zeross/profile.json` (per machine) | default Playwright email, personal account per role, capacity limits, executor |
| Secret | OS keychain; store only `keychain:<service>` | test-account password, API token |

- Knowledge is **fact about the project**; a rule is **an instruction to follow**;
  team config is **a structured setting** the commands read from `config.json`.
- `.claude/rules/zeross/ui.md` is rendered from `config.json → ui` (extra UI rules in
  `ui.extraRules`) and is re-rendered by `zeross update apply`, so a change to it is
  a **team config** change to `config.json → ui.*`, never a hand edit of `ui.md`.
- Conversation language is never persisted (`/zero-indonesia` is per session);
  decline to save it.
- Topic = an existing knowledge file when one fits (e.g. `auth-login.md`);
  otherwise a short kebab-case name.
- Ambiguous → `AskUserQuestion` with the recommended class first.
- Secret detection: anything matching the secret patterns in
  `.claude/rules/zeross/core.md` → "Secrets",
  or labelled password/token/key/OTP seed. Never echo it back, never write it to any
  file, never pass it in a command's argv. Team knowledge may name env var names
  and roles, never values.

## 3. Dedupe and conflict check

Search the destination (and the other knowledge files) for the same fact:

- Same fact → report "already known"; offer only to refresh its "Last verified"
  date.
- Conflicting fact → show both, then ask: replace (Recommended when the new one was
  just verified) / keep both with the condition that separates them / discard new.
- New → continue.

## 4. Preview

Show the exact change as a unified diff per file (JSON diff for `config.json`,
`local.json` and `profile.json`). Knowledge entries use this shape:

```markdown
## <Entry title>

<Fact, in English, concise. Link file paths. Env var names only, never values.>

- Source: <ticket / session / file:line>
- Last verified: YYYY-MM-DD
```

## 5. Confirm

`AskUserQuestion`: save (Recommended) / edit first / cancel. An empty answer is not
consent.

## 6. Write

- **Knowledge** → edit or create `.claude/zeross/knowledge/<topic>.md`; add a row
  for a new topic to `.claude/zeross/knowledge/README.md` if it has an index. When
  `auth-login.md` still has the line `Status: template — not filled yet`, replace
  the example rows with the real ones and remove that line.
- **Rule** → append to `.claude/rules/zeross/custom.md` under the matching heading.
- **Team config** → a direct edit of `.claude/zeross/config.json` (the previewed
  JSON diff), keeping every other key. Validate against
  `.claude/zeross/config.schema.json`. For `ui.*` changes, then tell the user to run
  `zeross update apply` (or `/zero-update`) to re-render
  `.claude/rules/zeross/ui.md`, and show that diff too. For `rules.packs` or
  `rules.scopes` changes, re-run `zeross apply` through `/zeross --reconfigure`.
- **Personal (project)** → `zeross local set <dotted.key>=<json> --json`; show the
  result with `zeross local get --json`.
- **Personal (machine)** → `zeross profile set <dotted.key>=<json> --json`; show the
  result with `zeross profile get --json`.
- **Arrays** (e.g. `playwright.accounts`): read the whole array
  (`zeross local get playwright.accounts --json`), modify it, and write the whole
  array back (`zeross local set 'playwright.accounts=[…]' --json`). Never set an
  element by index.
- **Secret**:
  1. Service name = `zeross-test-<project.name>-<role>` for test accounts, in
     lowercase kebab-case (letters, digits, `.`, `_`, `-` only; the CLI rejects anything else).
  2. Ask the user to run, **in their own terminal** (not via Claude):
     `zeross secret set <service>` — it reads the value from stdin with no echo.
  3. After they confirm, run `zeross secret get-ref <service> --json` to verify it
     exists and get the `keychain:<service>` ref.
  4. Store only that ref, e.g. in the account's `passwordRef`, written with the
     whole-array procedure above.
  5. If the user already pasted the secret into the chat: do not repeat it, tell
     them it is now in the session transcript, and recommend rotating it if it is
     not a disposable test credential.

Team files (`knowledge/`, `.claude/rules/zeross/custom.md`, `config.json`, a
re-rendered `ui.md`) are committed by the user later; this command never commits.

## Example: fastest login method

During `/zero-fix-bug` two login paths were found on the local web app:

- Google login → external redirect, real Google account, 2FA — slow and flaky.
- Email + password, with the OTP step bypassed on local by
  `BYPASS_OTP_VERIFICATION=true` (env var name only) — two fields, no external
  dependency.

Proposed candidate: "Found 2 login methods; email + OTP bypass on local is fastest
→ save to `knowledge/auth-login.md`?" On confirmation, record the **fastest method
first**:

```markdown
## Login methods (fastest first)

1. Email + password with OTP bypass (local only). Requires
   `BYPASS_OTP_VERIFICATION=true` in the API env file; see
   [`apps/api/src/auth/otp.service.ts`](../../../apps/api/src/auth/otp.service.ts).
   Account per role: see each user's `local.json → playwright.accounts`.
2. Google login — use only when the ticket is about SSO.

- Source: VTX-123 session
- Last verified: 2026-10-06
```

The personal email goes to `local.json → playwright.defaultEmail`; the password goes
to the keychain via step 6 (Secret), never into the knowledge file.

## Report

Each item: class, destination, action (added / updated / already known / skipped),
and for secrets the stored ref only.
