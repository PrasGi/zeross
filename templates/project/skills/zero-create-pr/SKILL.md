---
name: zero-create-pr
description: Commit the task's changes (after confirmation), push without force, draft the title and body with zero-pr-description, pick reviewers, assignee and draft state, and open the pull request through the GitHub MCP.
argument-hint: "[JIRA-123 | #123 | base:<branch> | draft] …"
disable-model-invocation: true
---

# /zero-create-pr

Input: `$ARGUMENTS` (optional ticket keys/refs, `base:<branch>`, `draft`).

Invoking this command authorizes the sequence below, but each git write (commit,
push) and the PR creation still need the confirmations listed. Never force-push,
never merge, never use the `gh` CLI for GitHub writes — use the GitHub MCP.

## 1. Load

- Read `.claude/zeross/workflow/core.md` and `questions.md`.
- Read `.claude/zeross/config.json` (`git.*`, `pr.*`, `tickets.*`) and
  `~/.claude/zeross/profile.json → mcpRoles`.
- Confirm the GitHub MCP is available. If not → stop; tell the user to run
  `/zeross` to set it up. No `gh` fallback.
- Repo = `tickets.github.repo`, else parse `git remote get-url origin`.
- Base = `base:` argument, else the base settled earlier in this session, else
  `git.baseBranch`.

## 2. Preflight

1. `git branch --show-current`. On a branch in `git.protectedBranches` (or
   detached HEAD) → stop. Offer to create a task branch from
   `git.branchPattern` and move the changes there (ask first).
2. Tickets = arguments + tickets worked in this session + keys found in the branch
   name. None → ask for one (free text "no ticket" is allowed; record the reason).
3. Check for an open PR for this head via the GitHub MCP. Exists → show its URL and
   ask: update its description / stop.
4. `git status --porcelain` and `git log --oneline origin/<base>..HEAD`.

## 3. Commit (only if there are uncommitted task changes)

1. Split changed files into **task files** (changed for these tickets in this
   session or clearly in scope) and **unrelated files**. Unsure → treat as unrelated
   and ask.
2. **Draft the commit message(s) first**, Conventional Commits:
   - `<type>(<scope>): <subject>` — imperative, ≤72 chars, no trailing period.
   - Body wrapped at 72, explaining why.
   - Footer: `Refs <KEY-123>` / `Refs owner/repo#123` per ticket.
     `BREAKING CHANGE: …` when applicable.
   - No tool-attribution trailer unless `pr.attributionFooter` is true.
   - Separable tickets → one commit per ticket (with its file list); otherwise one
     commit with all refs.
3. Show both file lists and the full drafted message(s), then `AskUserQuestion`:
   commit the task files with these messages (Recommended) / edit the messages /
   stop. On "edit", apply the user's changes and show them once more before
   committing. Unrelated files are never staged.
4. Pre-commit checklist:
   - Stage only task files by explicit path (`git add -- <paths>`); never
     `git add -A` / `.`.
   - Scan the staged diff for secrets (`git diff --staged`) against the patterns in
     `.claude/rules/zeross/core.md` → "Secrets". Any hit → stop and flag it
     (redacted); do not commit.
   - Lint the changed files with the app's `lint.command`; related tests already
     green in this session, or run them (related files only).
5. Write each approved message to a temp file in the session scratchpad (never in
   the repo) and run `git commit -F <file>`.
6. Show the commit(s) with `git log --stat -n <count>`.

## 4. Push

1. No commits ahead of `origin/<base>` → stop; nothing to open.
2. `AskUserQuestion`: push `<branch>` to `origin` (Recommended) / stop. Skip only if
   the branch is already pushed and up to date.
3. `git push -u origin <branch>` — never `--force` or `--force-with-lease`.
   Rejected (non-fast-forward) → stop and report; do not rewrite history.
4. Verify: `git ls-remote origin refs/heads/<branch>` equals `git rev-parse HEAD`.

## 5. Title and body

Invoke the `zero-pr-description` skill with source `branch`, the base, and the
ticket list. It follows `.github/pull_request_template.md` when present, includes
the mandatory `## Ticket` section and applies `pr.closeKeywords` and
`pr.attributionFooter`. Show the title and body; apply user edits.

## 6. Reviewers, draft, ticket comment (one question batch)

1. Collaborators: list repository collaborators via the GitHub MCP; current user
   via the GitHub MCP `get_me`. Exclude the current user (cannot self-review).
2. One `AskUserQuestion` call (≤4 questions):
   - **Reviewers** (multiSelect): `pr.defaultReviewers` that are collaborators
     first, marked "(Recommended)", then other likely reviewers
     (recent committers on the changed files). Max 4 options; the user can type
     other logins as free text. Validate typed logins against the collaborator list.
   - **Draft?** Default from `pr.draftByDefault` (or the `draft` argument) as the
     recommended option.
   - **Comment the PR link on the ticket(s)?** Only when `pr.commentOnTicket` is
     `ask`; `always` → yes without asking; `never` → skip.
3. Assignee = the current user from `get_me`.

## 7. Create and read back

1. Create the PR via the GitHub MCP: `base`, `head`, title, body, draft.
2. Request the chosen reviewers and set the assignee via the GitHub MCP.
3. Read the PR back and verify base, head, draft state, reviewers and assignees.
   Report any mismatch (e.g. reviewer lacks access) instead of claiming success.
4. Return the PR URL. When UI changed, list the local screenshot paths from
   `zero-pr-description` and tell the user to drag them into the PR description on
   GitHub (the GitHub MCP cannot upload images).

## 8. Ticket comment (optional)

Per the decision above: post `PR: <url>` (one line, plus the title) on each Jira
ticket via the Jira MCP and each GitHub issue via the GitHub MCP. Never transition
ticket status.

## Report

PR URL, base ← head, commits created (hash + subject), files staged, files left
unstaged, reviewers, assignee, draft state, ticket comments posted, screenshots to
attach by hand.

## Stop conditions

Protected or detached branch; secrets in the staged diff; push rejected; GitHub MCP
unavailable; unrelated changes overlapping task files; the user declines a step.
