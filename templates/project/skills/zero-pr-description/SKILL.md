---
name: zero-pr-description
description: Draft a reviewer-ready English pull request title and body from the current session, the branch, Jira/GitHub tickets or free text — with a mandatory Ticket section, grouped changes with rationale, a test plan and the repo's PR template. Drafting only; never commits, pushes or opens a PR.
argument-hint: "[session | branch [base] | JIRA-123 | jira url | github issue url | #123 | free text] …"
---

# zero-pr-description

Input: `$ARGUMENTS`

Write the title and body in English regardless of the conversation language. Keep
technical identifiers unchanged. **Drafting never authorizes a commit, push, PR
creation or PR update** — `/zero-create-pr` does that.

## Load

- `.claude/zeross/config.json`: `git.baseBranch`, `tickets.jira.site`,
  `tickets.github.repo`, `pr.closeKeywords`, `pr.attributionFooter`.
- `~/.claude/zeross/profile.json → mcpRoles` for the GitHub and Jira MCP.
- Repo PR template, first found: `.github/pull_request_template.md`,
  `.github/PULL_REQUEST_TEMPLATE.md`, `docs/pull_request_template.md`.

## Sources

Use the sources the user names (several may combine). Do not run git commands
speculatively.

| Argument | Source |
|---|---|
| `session` | Changes discussed and implemented in this conversation |
| `branch [base]` | Base = given, else the base settled this session, else `git.baseBranch`. `git merge-base HEAD origin/<base>`; branch-only commits `git log --oneline <mb>..HEAD`; changed-file summary `git diff --stat <mb>..HEAD`; then only the targeted diffs needed to explain each change |
| Jira key / URL | Issue, comments, parent via the Jira MCP |
| GitHub URL / `owner/repo#N` / `#N` | Issue, labels, comments via the GitHub MCP |
| Free text / file paths | Use as given |

- No argument → `session` if this session implemented changes, else ask.
- Called by `/zero-create-pr` → `branch` plus the tickets it passes.
- Ticket keys also come from the branch name and commit footers (`Refs …`).
- Uncommitted changes are not part of a branch PR; mention them only in the context
  line.
- MCP unavailable → ask the user for the ticket context; never fall back to `gh`.

## Ticket links (mandatory `## Ticket` section)

Every worked ticket is linked:

- Jira: `[KEY-123](<tickets.jira.site>/browse/KEY-123)` — site from config, else from
  the ticket URL the user gave, else ask.
- GitHub: `owner/repo#123` (full reference, even in the same repo).
- No ticket → `No ticket — <reason the user gave>`.

`pr.closeKeywords`:

- `false` (default) → prefix with `Refs`. **Never** `Closes`, `Fixes` or `Resolves`
  anywhere in the body.
- `true` → `Closes owner/repo#123` only for GitHub issues this PR fully resolves;
  Jira keys always use `Refs`.

## Body

If a repo PR template exists, follow its headings and order, and fill gaps with the
sections below (always keep `## Ticket`). Otherwise use exactly:

```markdown
## Summary

<One sentence: the change and its user-facing outcome.>

## Ticket

- Refs [KEY-123](<tickets.jira.site>/browse/KEY-123) — <ticket title>

## What

<Observable problem, missing behavior or prior state.>

## Why

<Business, UX, reliability or bug impact. Must not repeat What.>

## What we did (and why)

### <Logical change group>
- <Specific implementation change>
- **Why:** <Reason for this approach>

## Test plan

- [ ] <Concrete automated check: related test file + command>
- [ ] <Manual check: local URL, role, steps, expected result>
- [ ] <Edge-case or regression check>

## Screenshots / UI

<Required when UI changed. Write "Screenshots: to be attached" plus one line per image saying what it shows (before/after, viewport). Omit the section otherwise.>

## Breaking changes / Migration

<Migrations, env var names, flags, ordering. Omit when none.>

## Out of scope

<Intentional non-changes. Omit when none.>
```

## Screenshots

Screenshots in `.playwright-mcp/` are local and gitignored, and the GitHub MCP
cannot upload images. So:

- Never link `.playwright-mcp/…` paths in the body, and never commit the images.
- The body's `## Screenshots / UI` section carries the placeholder
  `Screenshots: to be attached` with a one-line caption per image.
- In the output, list the local paths to attach (e.g.
  `.playwright-mcp/proj-123-checkout-after.png → "after, mobile 375"`) and tell the
  user to drag them into the PR description on GitHub after the PR is created.

## Writing rules

- Every section has concrete content; no placeholders in the output, except the
  `Screenshots: to be attached` line.
- Group "What we did" by responsibility, not file order; each group has `**Why:**`.
- Plain language over identifier dumps; mention paths only when they help review.
- Never claim tests, builds, browser checks or migrations ran unless the source
  shows they ran.
- Never suggest a full-suite or build command unless the user asked for it.
- No secrets, env values, tokens or internal-only URLs.
- Attribution: add a tool-attribution footer only when `pr.attributionFooter` is
  `true`; otherwise none.

## Output

1. One context line (source used, base, commit count, tickets).
2. `Suggested title:` in Conventional Commit style —
   `` `type(scope): imperative outcome` ``, ≤72 chars, no trailing period.
3. The raw body in a plain fenced block **with no language tag**, so Markdown is not
   rendered. If the body contains a fence, use a longer outer fence.
4. When UI changed: the local screenshot paths to attach, with their captions, and
   the instruction to drag them into the PR after it is created.

Copy to the clipboard only on explicit request (`pbcopy`, then confirm).

## Quality checklist (verify before returning)

- [ ] Title is Conventional Commit style, imperative, outcome-focused, ≤72 chars.
- [ ] `## Ticket` present; every worked ticket linked with the correct format.
- [ ] No `Closes` / `Fixes` / `Resolves` unless `pr.closeKeywords` is `true`.
- [ ] Every required section present and non-empty; `What` ≠ `Why`.
- [ ] Each change group states its why.
- [ ] Test plan items are actionable and backed by evidence.
- [ ] Screenshots section present when UI changed, with the "to be attached"
      placeholder; local paths listed in the output, not in the body.
- [ ] Repo PR template followed when present.
- [ ] No secrets, internal URLs, placeholders; attribution per config.
- [ ] Body is inside a plain fenced block.
