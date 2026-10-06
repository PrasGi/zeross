# Data safety

DB access policy, dummy data, the write log and cleanup. Read this before any DB MCP call or any browser action that writes data.

## Access policy

The DB MCP (`mcpRoles.db`) runs through `.claude/zeross/bin/db-mcp.mjs`. The wrapper reads the URL by **parsing** `config.json → db.envFile` for `db.envVar`, and picks the mode from the host when it starts.

| Host class | How it is detected | Mode |
|---|---|---|
| Local/dev | `localhost`, `127.0.0.1`, `::1`, `*.local`, docker-compose service names, hosts in `config.json → db.devHosts` | Writable |
| Other (staging, shared dev, cloud) | anything else | **Read-only**, unless `.claude/zeross/local.json → dbGrants[<host>]` exists |
| Production-looking | `prod` in the host name, or an env file matching `.env*prod*` (e.g. `.env.production`), whatever the host | Read-only; a write needs a typed confirmation and a session-only grant |

- **Read-only is the default.** Assume read-only unless the wrapper reported write mode for a local/dev host or a grant exists.
- **Granting writes on a non-local host:**
  1. Show what you need to write and why, the host (never the full URL), and the rows affected.
  2. Ask with `AskUserQuestion`. "Keep read-only (Recommended)" comes first.
  3. Only on an explicit yes, write the grant with
     `zeross local set 'dbGrants[<host>]={"scope":"persistent","grantedAt":"<ISO-8601>"}' --json`
     (brackets keep dots in host names intact).
- **Grant shape.** Every grant has `scope`: `persistent` or `session`. A `session` grant also needs an `expiresAt` in the future; the wrapper ignores grants with any other shape, and expired session grants.
- **Production-looking hosts:**
  - Explain the risk.
  - Require the user to **type the host name** in a free-text answer. A clicked option is not enough.
  - Write a session grant, at most 8 hours ahead (or the end of the task, whichever is sooner):
    `zeross local set 'dbGrants[<host>]={"scope":"session","grantedAt":"<ISO-8601>","expiresAt":"<ISO-8601, ≤ 8 h ahead>"}' --json`
  - Remove the grant when the task ends, whatever the outcome:
    `zeross local set 'dbGrants[<host>]=null' --json`
- After any grant change, ask the user to reconnect the DB MCP with `/mcp` so the wrapper restarts in the new mode. **Check the mode before writing:** run `zeross mcp test db --no-claude --json` and confirm `writable: true` for the host. If it is still `false`, do not write.
- Never print the connection string, credentials or env file contents. Never source the env file.
- If the DB MCP is unavailable, do not fall back to ad-hoc DB clients with credentials unless the user explicitly asks.
- Read-only flags are defense in depth, not a guarantee. Still never issue a write without a grant.

## Before creating data

1. **Search existing data first.** A record with the right role, state or relation is better than a new one. Query read-only, with tight filters and a limit.
2. Create data only when nothing fits, and only through the app's own flow or API when practical, so its invariants hold.
3. Any shared, non-local write needs a grant (above). Browser testing is not blanket permission to rewrite shared records.

## Dummy data tagging

Tag everything you create, so cleanup can find it:

- Emails: `zeross+<task>@example.test`
- Names and titles: a `[zeross <task>]` prefix, when free text is allowed
- Mongo, or schemas that allow extra fields: `__zeross_task: "<task>"`
- Never use real customer data, real emails or real phone numbers.

`<task>` is the ticket key in lowercase (`proj-123`, `gh-123`). For free-text tasks it is the branch slug.

## Write log

Every write is logged to `.claude/zeross/local/data-log/<task>.jsonl`, which is gitignored. That includes writes you make, and known side effects of browser actions such as `lastLoginAt`.

- **The log entry is appended BEFORE the write.** One JSON object per line:

```json
{"ts":"2026-10-06T12:00:00Z","op":"update","target":"users","id":"665f…","before":{"status":"active","flags":null},"after":{"status":"suspended"}}
```

- `op`: `insert`, `update`, `delete`, or `side-effect`.
- `target`: the table or collection.
- `id`: the primary key. Generate it client-side for inserts where possible (ObjectId or UUID). Otherwise log `null`, then append a follow-up line with the real id right after the insert.
- `before`: the fields' prior values. Use the `"__absent__"` marker for fields that did not exist. Inserts use `null`.
- `after`: the values the write sets. Deletes use `null`.
- For a delete, keep the full deleted row in `before`.
- Never log secrets, password hashes or tokens. Mask such fields as `"__redacted__"` and treat them as non-restorable.
- Keep the log until cleanup is resolved. Never edit past lines; append only.

## Cleanup

### Ask

The cleanup question comes **after** the final "done" report (`reporting.md`). That report shows `Data cleanup: pending (question below)` whenever data changed.

- If no data changed, the report says `none changed` and there is no question.
- Otherwise, after the report (its manual test steps come first), summarize the log: the count per target and the records created or changed.
- Ask with a recommendation:
  - **Delete / restore now:** recommended when the data only served automated validation
  - **Keep for manual testing:** recommended when the report's manual steps rely on it; list exactly what remains
  - **Defer:** leave it, with the log path recorded as pending cleanup
- Reuse a cleanup choice the user already made in this task.
- After executing the choice, add a **one-line addendum** with the outcome, e.g. `Data cleanup: cleaned 3 records (read back), 1 retained (changed since the test)`, `kept for manual testing: <list>`, or `deferred: log at .claude/zeross/local/data-log/<task>.jsonl`.

### Execute

1. Restore only the logged fields and remove only the logged inserts.
2. Before each restore, **check that the current value still equals the logged `after`**. If someone changed it since, leave it and report the difference.
3. Fields logged as `"__absent__"` are removed with `$unset` (Mongo), or set back to the column's prior value or default (SQL). Never write `null` in their place.
4. Use a transaction when the DB supports one: Mongo replica set, Postgres, MySQL InnoDB.
5. **Read back** every restored and deleted record, and append `{"op":"cleanup",…}` lines with the result.
6. Clear the browser cookies afterwards, so a live session doesn't recreate side effects immediately.
7. Report each record as cleaned, retained (with the reason) or failed. Never claim a clean sweep you did not verify.
