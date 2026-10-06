# Project knowledge

Team-shared facts about this project that took effort to discover and that every Claude session should reuse. This folder is committed; teammates and their sessions all read it.

## What belongs here

- How to log in fastest locally, and which test roles exist (`auth-login.md`)
- Dev environment prerequisites: services to start, seed commands, feature flags needed locally
- Domain facts the code doesn't make obvious, e.g. "orders in `draft` are invisible to the warehouse role"
- Recurring gotchas, e.g. "the `tenantId` filter lives in the Mongoose plugin, not in each query"
- Where things live, e.g. "the email templates are in the `notifications` service, not this repo"

## What never belongs here

- **Passwords, tokens, API keys, OTP seeds, connection strings, cookies.** Store secrets in the OS keychain and reference them by name only (e.g. `passwordRef: keychain:zeross-test-<project>-<role>`) in the gitignored `.claude/zeross/local.json`.
- Personal settings, such as your own test email or DB grants. They go in `local.json` or `~/.claude/zeross/profile.json`.
- Coding rules. They go in `.claude/rules/zeross/custom.md`.
- Anything already documented in the project docs. Link to it instead.

## How knowledge is added

- **`/zero-learn <text>`** classifies the input as team knowledge, team rule, personal setting or secret. It checks for duplicates and conflicts, shows the diff, and writes only after you confirm.
- **At the end of each task**, zeross commands propose candidates (e.g. "found 2 login methods; the local OTP bypass is fastest → save to `auth-login.md`?"). Nothing is written unless you select it.
- Manual edits are fine. Keep the format below and commit them.

## Format

- **One topic per file**, named in kebab-case: `auth-login.md`, `dev-setup.md`, `billing-domain.md`.
- Each file starts with:

```markdown
# <Topic>

Last verified: YYYY-MM-DD

<one-line summary of what this file answers>
```

- Write short, factual bullets and tables. Cite file paths (`src/auth/otp.ts:42`) where the fact comes from code.
- When a fact is re-checked or changed, update `Last verified`. Treat a fact verified more than ~90 days ago as a hint, and re-check it before relying on it.
- Remove facts that are no longer true. Don't leave "old:" sections.
- English only.

## Index

| File | Topic | Last verified |
|---|---|---|
| `auth-login.md` | Login methods and test roles | YYYY-MM-DD |
