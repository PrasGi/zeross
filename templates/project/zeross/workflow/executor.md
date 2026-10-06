# Executor

Who runs which work (main session, native subagents or Orca workers), and how many at once.

## Inputs

From `~/.claude/zeross/profile.json`:

- `capacity.understanding`: max concurrent read-only explore and review agents
- `capacity.unitTest`: max concurrent test processes, across all agents
- `capacity.playwright`: max concurrent browser sessions
- `executor`: `auto` | `native` | `serial`

If the profile is missing, use `serial` with every capacity set to 1.

**Orca detection:** the session runs inside Orca when the env var `ORCA_TERMINAL_HANDLE` or `ORCA_WORKSPACE_ID` is set. Check with `printenv ORCA_TERMINAL_HANDLE ORCA_WORKSPACE_ID`.

## Routing

| Work | `executor: auto` | `executor: native` | `executor: serial` |
|---|---|---|---|
| Read-only explore, trace or review | native subagents | native subagents | main session |
| Playwright validation | Orca workers if Orca is detected, else native subagents | native subagents | main session |
| Large build-feature sub-tasks (one plan wave) | Orca workers if Orca is detected, else native subagents | native subagents | main session |
| Small edits, fixes, tests | main session | main session | main session |

- **Read-only explore and review never go to Orca workers.** Under `auto` and `native` they use native subagents (the Agent tool), Orca or not, because their results come straight back into context. Under `serial` they run in the main session, like everything else.
- **Orca workers:**
  - Before the first one, load the orchestration instructions: the `orchestration` skill, or `orca skills get orchestration` when the skill isn't installed.
  - Start workers with `orca orchestration worker-start`, in visible tabs, and coordinate them through its ask/reply and wait mechanisms.
  - Do not guess flags. Use what the orchestration instructions document.
- When in doubt, run serially in the main session. Correctness beats parallelism.

## Limits (never exceed)

- Concurrent explore and review agents ≤ `capacity.understanding`.
- Concurrent test processes ≤ `capacity.unitTest`, counting every agent and worker. A worker running tests uses up a slot.
- Concurrent browser sessions ≤ `capacity.playwright`. Parallel sessions use isolated Playwright instances (`browser.md`).
- **Never let two agents edit the same file.** Before a parallel wave:
  - give each task a disjoint file list
  - leave shared files (barrels, route tables, i18n catalogs, lockfiles, schema files) to the main session after the wave
- No builds, dev servers or full suites in any agent (`core.md`, `testing.md`).

## Briefing agents and workers

Every brief must be self-contained:

- the goal and exact scope
- the files it may read and the files it may edit
- the relevant rule packs and workflow files to read
- the expected output format, e.g. findings with `file:line`, confidence and evidence
- the limits: no commits or pushes, no builds, no whole suite, no DB writes unless delegated under `data-safety.md`, no new dependencies

**Subagents and workers cannot ask the user.** Tell them to stop and return open questions instead of guessing. The main session owns every `AskUserQuestion` (`questions.md`).

## After agents return

- **Verify before reporting.** Re-read the cited `file:line`, rerun the claimed test command where cheap, and check that the edits match the brief and the rule packs.
- Reject or redo output that cites lines that don't exist, edits files outside its list, or claims checks it didn't run.
- Merge findings yourself. Never paste a raw agent dump into the report.
