# Questions and decisions

How to ask the user for decisions: few questions, concrete options, answers that are never re-asked.

## When to ask

- Ask only what the evidence and earlier answers do not settle.
- Always ask before:
  - work that touches business flow, auth, permissions, schema or migrations, money, or deletes user data
  - expanding scope to more apps, locales, migrations or repositories
  - any side effect `core.md` forbids without consent: commit, push, PR, build, whole test suite, non-local data write
  - building a destructive UI action whose confirmation behavior is unspecified (see "Destructive actions" in `.claude/rules/zeross/core.md`)
- Do not ask "may I continue?" or similar generic checkpoints. For a small, clear change, state the plan and proceed.
- Optional preferences are not blockers. Make a stated, reasonable choice and keep working.

## Show findings first

Before any question, show what you found and the approach you propose: the verdict or status table, root cause with file:line, and the options' trade-offs. Approval must apply to a concrete result, not a vague intent.

## AskUserQuestion protocol

- Use the `AskUserQuestion` tool.
- **At most 4 questions per call.** Each question is one self-contained decision.
- **2–4 options per question.** Put the recommended option first and end its label with ` (Recommended)`. Say why in its description.
- **Never add a literal "Other" option.** The tool already accepts free text.
- Use `multiSelect` only when several choices can be true together, e.g. knowledge candidates or reviewers.
- Keep labels short (≤ 5 words) and put detail in descriptions. Pre-fill detected values, e.g. the base branch from `git.baseBranch` and the branch name from `git.branchPattern`.
- **Batch related decisions.** Scope questions go in the first batch; the branch question (new or stay, plus source) comes right before the build/fix phase (`core.md` → "Branch decision"). Product decisions for one feature go together.

## Answers

- **Never re-ask a settled decision** in this task unless the scope materially changes. Carry answers forward: branch and base, design choice, cleanup choice, PR authorization.
- **An empty, default, skipped or timed-out answer is not consent.** For required decisions and authorizations, wait for a real answer. Meanwhile, continue only independent, read-only work.
- If the user answers in free text, restate how you understood it in one line, then act on it.
- If an answer conflicts with a rule pack or the ticket, point out the conflict once, then follow the user.

## Fallback

If `AskUserQuestion` is unavailable or denied in this session:

- Ask in chat with numbered options, the recommended one first and marked "(Recommended)", and say that free text is welcome.
- Do not fake a tool call. Do not switch modes yourself.
- Subagents and workers cannot ask the user. The main session owns all questions (see `executor.md`).
