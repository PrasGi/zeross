# Evidence

How to establish facts before a verdict, a status or a plan: trace the code, check the data, reproduce the behavior.

## Code trace

For each ticket, trace the path the behavior takes and cite `file:line` at every hop:

1. **Entry:** the route, page or screen, or the API endpoint, job, consumer or CLI command.
2. **Component or handler:** the UI component, server action, controller or resolver.
3. **Callers and callees:** the service, repository or query, hooks and stores, shared utilities, and middleware, guards or pipes that run before the handler.
4. **Tests:** the existing tests for each hop. Note which behaviors are covered and which aren't.

Also check:

- **Neighboring implementations** that show the intended pattern or the expected behavior, e.g. the same feature on another page or another role.
- **Recent history:** `git log -L` or `git log --follow -- <file>` on the root-cause lines. If the issue looks already fixed, find the commit and its date.
- **Ownership:** whether the schema, type or API is owned by another package, service or repo. Never patch a consumer to work around a provider bug without saying so.

Fan out read-only exploration to native subagents within `capacity.understanding` (see `executor.md`). Verify their `file:line` claims before you rely on them.

## Data evidence

When persisted state decides the outcome (permissions, feature flags, status fields, tenant settings, missing relations):

- Query the DB MCP **read-only**: select only the fields you need, filter tightly, and always use a limit.
- Never print secrets, password hashes, tokens or full PII in chat. Mask emails and phone numbers unless the user needs them.
- If the DB MCP is unavailable, say the data was **not verified**. Do not imply it was.
- Creating or changing data follows `data-safety.md`.

## Reproduction

- **UI bugs need a browser reproduction** (`browser.md`) on the matching role, account and data state. **Code inspection alone is not UI reproduction.** If the browser is unavailable, the verdict is `BLOCKED` or explicitly "reproduced by code reading only". Never claim "reproduced".
- **Non-UI bugs:** use one of the following, and record the exact command and output:
  - a failing unit or integration test
  - `curl` against the **local** API
  - a read-only DB query showing the bad state
- Record the reproduction exactly: account and role, URL, steps, observed result, screenshot path or command output.
- Feature work: capture the **current state** the same way, with a code trace, a screenshot and the data. This grounds each requirement status in evidence.

## Standards of proof

- Every root-cause claim has a `file:line`. Every "works now" claim has evidence: a screenshot, test output, a query result, or the fixing commit.
- Separate **observed** from **inferred**. Label inferences.
- If the cause is unknown, say so. Do not invent one to fill the report.
- Stop and report `BLOCKED` when necessary evidence is missing. Name exactly what is missing: an account, data, access, a screenshot, or a running server.

## Code-understanding helpers (when installed)

- **graphify:** if `graphify-out/graph.json` exists, start codebase questions with
  `graphify query "<question>"` and follow its file:line pointers, then read the code.
  The graph can be stale; confirm every claim in the actual files before citing it.
- **Context7:** before writing code against an external library API you are not
  certain about (version-specific options, new APIs), resolve the library and read
  its docs through the Context7 MCP (`mcpRoles.context7`). Prefer the version in
  the project's lockfile.
