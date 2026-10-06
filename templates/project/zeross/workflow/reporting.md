# Reporting

Report formats for verdicts, requirement status, the final "done" report and knowledge capture. Keep reports to the point: tables and facts, no narration.

## Bug verdict (before any edit)

One row per ticket:

| Ticket | Verdict | Evidence | Root cause | Impact | Severity | Fix approach |
|---|---|---|---|---|---|---|
| PROJ-123 | VALID | screenshot `.playwright-mcp/proj-123-repro-before.png`; console 500 on `POST /api/orders` | `src/orders/service.ts:142`: discount applied twice | every checkout with a coupon | High | apply the discount once in `calculateTotal`; regression test |

| Verdict | Meaning | Evidence required |
|---|---|---|
| `VALID` | reproduced | the reproduction, plus root cause at `file:line` |
| `NOT REPRODUCIBLE` | works now | the passing reproduction; the fixing commit and date when found |
| `BLOCKED` | can't decide | exactly what is missing: account, data, access, screenshot, server |
| `WORKS AS DESIGNED` | behavior is intended | the code, ticket or decision that defines it, and who decided |

- Severity: `Critical` (data loss, security, outage), `High` (core flow broken, no workaround), `Medium` (workaround exists), `Low` (cosmetic or rare).
- Fix only `VALID` tickets. Preventive changes for non-reproduced tickets need the user to redefine the task.
- **Gate:** if the fix touches business flow, auth, permissions, schema or migrations, or money, or you are uncertain, ask with 2–4 options and a recommendation, findings shown first (`questions.md`), and wait for the answer. Otherwise state the short plan (files, approach, tests) and proceed without another checkpoint.

## Feature requirement status (before any edit)

One row per requirement, keeping the acceptance criteria's original numbering:

| # | Requirement | Status | Evidence | Gap / decision |
|---|---|---|---|---|
| AC1 | export orders as CSV | PARTIAL | `src/orders/export.ts:20` exports JSON only | add CSV serializer |

| Status | Meaning |
|---|---|
| `BUILD` | missing and well defined |
| `PARTIAL` | exists in part; name what exists and what remains |
| `EXISTS` | already works; cite evidence and recommend dropping it from scope |
| `NEEDS DECISION` | a product or scope decision is open; give concrete options |

Follow it with a short approach that names the existing pattern to copy, plus the unspecified empty, error, permission and destructive-action states.

## Final requirement status (done report)

In the done report, every requirement or AC gets a final status, in its original numbering:

| Status | Meaning | Evidence required |
|---|---|---|
| `DONE` | built and verified | the test name(s), plus the browser validation or screenshot path for UI |
| `PARTIAL` | part of it works | what works, what remains, and why it stopped |
| `NOT DONE` | not built | the reason: blocker, failed validation, or a decision still open |
| `DEFERRED` | moved out of scope by the user or the approved plan | who decided, and where it is tracked (follow-up ticket, plan) |

A requirement that was `EXISTS` at assessment is reported as `DONE` with the original evidence and "no change".

## Final "done" report

```markdown
## Summary
<1–3 lines: what was wrong or needed, what changed>

## Root cause / approach
<root cause at file:line (bugs) or approach and pattern followed (features)>
<features: AC table with the final status per AC (DONE / PARTIAL / NOT DONE / DEFERRED), original numbering>

## Files changed
- `path/to/file.ts`: <one line why>

## Tests
- Command: `<exact command>` → <N passed, M failed>
- Fail-proof: <test name> failed before the fix with "<assertion>" (test-first) | mutation "<what>" → failed, restored, passing
- Edge cases covered: <categories>; skipped: <category: reason>
- Lint: `<command>` → <result>

## Browser evidence
- Reproduction: <result> (`.playwright-mcp/…png`)
- Negative path: <result>
- Neighboring path: <result>
- <or: "Not run: <reason>">

## Manual test steps
Prerequisite: <dev server command>, account: <role> (`<email>`)  ← never a password
1. Open <full local URL>
2. <action> → expected: <result>
3. <step that proves the fix>
Does following these steps write data? <yes/no, what>

## Reviews
- zero-security-review: <verdict, findings fixed / remaining>
- zero-ui-review: <verdict, findings fixed / remaining>

## Docs
<updated: files and sections + the Changelog entry | stub created: <file> (no doc existed) | created: <file> (full doc) | "open: <why docs could not be written>">

## Data cleanup
<none changed | pending (question below)>

## Next step
Branch `<branch>` from `origin/<base>`, uncommitted. Run `/zero-create-pr` when ready.
```

- **Data cleanup** is decided after this report (`data-safety.md` → "Cleanup"): the report says `pending (question below)`, the cleanup question follows, and after executing the choice add a one-line addendum with the outcome, e.g. `Data cleanup: cleaned 3 records (read back)` or `deferred: log at .claude/zeross/local/data-log/<task>.jsonl`.
- Report failures and limits honestly. A pending item is reported as pending, never as done.
- Never auto-commit. Only offer `/zero-create-pr`.
- No passwords, tokens, connection strings or unmasked PII anywhere in the report.

## Knowledge capture

At the end of a task, collect reusable facts you had to discover, for example:

- the fastest login path
- an OTP bypass rule
- a test role and its account
- a non-obvious dev-server prerequisite
- a seed command
- a domain rule
- a recurring gotcha

Then:

1. Drop anything already in `.claude/zeross/knowledge/`, `.claude/rules/zeross/custom.md` or `.claude/zeross/config.json`, and anything secret.
2. Ask with `AskUserQuestion`, `multiSelect: true`. List each candidate with its target file, e.g. "Local OTP bypass = server date DDMMYY → `knowledge/auth-login.md`".
3. For the selected items, apply `/zero-learn` semantics:
   - classify each one: team knowledge, team rule, team config, personal setting, or secret (keychain plus a reference only)
   - check for duplicates and conflicts
   - **show the diff and confirm before writing**
   - add "Last verified: YYYY-MM-DD"
4. If the user selects nothing, write nothing.
