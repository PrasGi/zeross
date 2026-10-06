# Core rules

Applies to: every app and every task in this project.

## How packs are enforced

- Read the settings from `.claude/zeross/config.json → rules`.
- **Strictness**, from `rules.strictness`:
  - `strict`: every bullet in every pack is mandatory.
  - `standard`: bullets tagged **[strict]** are strong recommendations. Follow them in new code, and don't retrofit old code. Every other bullet is mandatory.
- **Comment policy**, from `rules.commentPolicy`:
  - `none`: add no new comments or doc comments. Keep existing ones, and update them when the code they describe changes. Tool directives (`eslint-disable-next-line <rule> -- <reason>`, `//nolint:<linter> // <reason>`, `# type: ignore[code]`) are allowed only with a reason, and only when unavoidable.
  - `exported`: write a doc comment on every new or changed **exported or public** symbol (JSDoc, TSDoc, godoc, docstring, PHPDoc, Javadoc). Describe the contract (inputs, outputs, errors, side effects), not the implementation. Nothing on private code, except a short *why* for non-obvious workarounds.
  - `every-component`: everything in `exported`, plus a one-line purpose comment on every new component, module, handler, service and job.
  - In every mode, never write comments that restate the code, change logs in comments, or commented-out code.
- **Test policy**, from `rules.testPolicy`: see `testing.md`.
- When a pack conflicts with the established pattern in the file being edited, follow the file and flag the conflict in the report. `custom.md` overrides the packs.

## Git

- Conventional Commits: `<type>(<scope>): <subject>`, imperative mood, ≤ 72 chars, no trailing period. Types: `feat fix docs style refactor perf test chore ci build revert`.
- The body explains *why*. Breaking changes use a `BREAKING CHANGE:` footer. Ticket footer: `Refs PROJ-123`. Use `Closes` only when `pr.closeKeywords` is true.
- Branches follow `git.branchPattern`. Never work on, commit to or push to `git.protectedBranches` (default `main`, `master`, `develop`). Never force-push. Never merge.
- Commit, push or open a PR only when the user explicitly asks. A request such as "commit, push and open a PR into `release/x`" authorizes that whole sequence once. An approval to implement does not authorize any of them.
- Stage only the task's files, by explicit path. Never `git add -A` or `git add .` with unrelated changes present.
- Never `git stash`, `git checkout -- <file>`, `git reset` or `git clean` the user's work.

## Secrets

- Never write secrets, tokens, passwords, private keys or credentialed connection strings into source, tests, fixtures, docs, logs or commit messages. Not even as placeholders outside `*.example` files.
- Config comes from env vars or a secret manager. Commit `.env.example` with **names only**. Never read or edit a real `.env` except to parse names the user pointed to.
- Flag any of these immediately and refuse to write them. This list is the team's canonical secret-pattern baseline; reviews and `/zero-learn` cite it:
  - AWS: `AKIA[0-9A-Z]{16}`, or 40-char base64 strings near "aws"
  - GitHub: `gh[ps]_[A-Za-z0-9]{36,}`
  - OpenAI: `sk-[A-Za-z0-9]{48}`
  - Anthropic: `sk-ant-[A-Za-z0-9\-_]{90,}`
  - Stripe: `sk_live_` or `sk_test_`
  - Private keys: `-----BEGIN * PRIVATE KEY-----`
  - Generic: `(password|secret|token)\s*[:=]\s*["'][^"']{8,}`
  - DB URLs with credentials: `(postgres|mysql|mongodb)://[^:]+:[^@]+@`
- Redact secrets found in existing code in every output (`ghp_****`).

## Side effects

This section and "Git" above are the canonical copy of the git, build and test side-effect rules. Workflow files point here and add only their workflow-specific steps.

- **No builds** unless the user explicitly asks in this session: `npm|pnpm|yarn|bun run build`, `next build`, `nuxt build`, `tsc -b`, `docker build`, `gradle build`, `mvn package`, `go build ./...` for release artifacts, and the equivalents. Type-check single files or rely on the related tests instead.
- **Tests:** run only the related test files. Never the whole suite, never `--coverage`, unless the user asks.
- **No e2e test files** unless the user explicitly asks: see "No e2e test files" in `testing.md`.
- No new dependencies without saying why. Prefer what is already installed. Note known CVEs for new packages (`npm audit`, `pip-audit`, `govulncheck`, `composer audit`), scoped to the change.
- Never start long-running servers, and never write to non-local data, without consent (`.claude/zeross/workflow/browser.md`, `.claude/zeross/workflow/data-safety.md`).
- **Guard hook.** When enabled (`config.json → hooks.guard`, default true), `.claude/zeross/bin/zeross-guard.mjs` (a PreToolUse hook on Bash) blocks builds, whole-suite test runs, `--coverage`, force-pushes and pushes to protected branches. It is a guardrail, not permission: a command it misses is still forbidden. If it blocks a command you did not need, narrow the command. Use the escape hatches **only when the user explicitly asked for that exact action in this session**, never on your own initiative or to get past a block:
  - `ZEROSS_ALLOW_BUILD=1 <build command>`: the user asked for a build
  - `ZEROSS_ALLOW_FULL_TESTS=1 <test command>`: the user asked for the full suite or for coverage

## Editing

- Read a file and its neighbours before editing. Never overwrite blindly.
- Match the surrounding code: naming, structure, error handling, imports and aliases, formatting. Reuse existing helpers, components and patterns before writing new ones.
- Keep diffs minimal and scoped to the task. No drive-by refactors or reformatting.
- **[strict]** No dead code, unused exports, leftover debug logging, `TODO` without a ticket, or commented-out code in the diff.
- Validate all external input at the boundary: HTTP body, params, query, headers, files, webhooks, queue messages.
- SQL and NoSQL: parameterized queries only. Never concatenate or interpolate user input.
- Prefer explicit types and narrow interfaces. No escape hatches (`any`, `interface{}` abuse, `mixed`, raw `Object`) without a reason.

## Destructive actions

This section is the canonical copy of the destructive-action rule. Other packs, workflow files and skills point here.

- Any user-facing action that destroys work, loses data, or has a consequence the user can't undo needs a confirmation before it executes. That covers delete, remove or archive anything a user created; cancel, discard or leave a form or wizard holding unsaved input; overwrite or replace existing content (uploads, regeneration); bulk actions; publishing to an audience; sending money; revoking access.
- Not destructive: navigation with nothing unsaved, reversible toggles, and actions with a visible undo (e.g. a toast with Undo that delays the actual delete).
- If the requirement doesn't say whether to confirm, **ask before implementing** (`AskUserQuestion`), with "With a confirmation dialog" as the recommended option. Do not silently add or skip it. Don't re-ask when the user already decided for that action in this task.
- The dialog needs:
  - a title naming the consequence ("Delete project Atlas?"), never just "Are you sure?"
  - one line saying what will be lost, in the user's terms
  - two plainly labelled actions ("Keep" / "Delete", "Stay" / "Leave"), never "OK" / "Cancel" or "Yes" / "No"
  - the destructive action styled as destructive, and the safe action as the default (initial focus; Enter does not confirm the destructive one)
  - Esc or a backdrop click means "do not proceed"
  - a typed confirmation (enter the name) for irreversible, high-impact deletes when the project already uses that pattern
- Reuse the project's existing confirmation dialog. If the same wording appears in more than one place, extract it to one exported constant and assert against that constant in tests.
- A missing confirmation is a review **Blocker** unless the ticket, plan or user explicitly waived it.

## Language

- Everything written to disk is English: code, comments, tests, docs, commits, PRs.
