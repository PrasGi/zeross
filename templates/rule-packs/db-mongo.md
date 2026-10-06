# MongoDB rules

Applies to: code and migrations touching MongoDB (native driver, Mongoose, Motor/PyMongo, Go driver, Spring Data Mongo, Prisma Mongo).

> Strictness follows `rules.strictness`. Working against a real DB through the DB MCP follows `.claude/zeross/workflow/data-safety.md`.

## Query safety

- **Sanitize `$` operators.** Never pass decoded JSON from the client straight into a filter, update or pipeline:
  - `{ email: req.body.email }`, where the email is `{ "$ne": null }`, is an injection.
  - Validate types first (string, ObjectId, number), or cast them (`String(x)`, `new ObjectId(x)` inside try/catch).
  - Strip `$`- and `.`-prefixed keys (`mongo-sanitize`, Mongoose `sanitizeFilter: true`, or the project's sanitizer).
- Never use `$where`, `$function`, `$accumulator` or `mapReduce` with user input. Never build field names from user input without an allowlist (sort fields, projections).
- Escape user input used in `$regex` and anchor it when possible. Unanchored, unescaped regex causes ReDoS and full scans.
- Validate ObjectIds before querying. A malformed ID means 400 or 404, not a 500 `CastError`.
- **Always scope by owner or tenant** in the filter itself (`{ _id, tenantId }`), not by checking after a fetch.

## Schema and validation

- Define the schema in code (Mongoose schema, Pydantic or struct tags) **and**, when the project uses them, `$jsonSchema` validators on the collection.
- Keep field names and types consistent across documents. Use explicit defaults for new fields, and handle missing fields in reads (older documents won't have them).
- Embed for data read together that is bounded in size. Reference for unbounded or independently updated data. Never grow arrays without bound; documents have a 16 MB cap.
- `timestamps: true` (or `createdAt`/`updatedAt`) on every collection, per the project's convention.

## Indexes

- Every query in a hot path has a supporting index. Check with `explain("executionStats")`: no `COLLSCAN` on big collections, and `totalDocsExamined` ≈ `nReturned`.
- Compound index order follows **ESR**: Equality fields, then Sort fields, then Range fields.
- Use unique indexes for natural keys (email per tenant, idempotency key). Partial indexes for soft-deleted or sparse data. TTL indexes for expiring data such as sessions and OTPs.
- Declare index changes in code or a migration, not by hand. Build indexes on big collections deliberately (rolling or off-peak), and flag it in the report.

## Reads

- Use projections to return only the needed fields. Never return `password`, tokens or internal flags.
- Use `.lean()` (Mongoose) for read-only paths. Cap `limit`. Use range-based or cursor pagination (`_id > lastId`) for large sets, not deep `skip`.
- Avoid N+1 lookups in loops. Batch with `$in`, or one `$lookup` with an indexed `foreignField`.
- Aggregations: put `$match` and `$project` early, use `allowDiskUse` only when justified, and cap output.

## Writes

- Use atomic operators (`$set`, `$inc`, `$push` with `$slice`, `$addToSet`) instead of read-modify-write. Use conditional updates (`{ _id, version }` or `{ status: "pending" }`) for state transitions.
- Use multi-document **transactions** (sessions with `withTransaction`) only where atomicity across documents is required. They need a replica set; check the deployment.
- `upsert` needs a unique index on the match key, to avoid duplicate inserts under concurrency.
- Set write concern per the project (usually `majority` for important data). Make writes idempotent where retries happen.
- Bulk changes: use `bulkWrite` in batches, and **never run an `updateMany`/`deleteMany` without a selective filter**. Count the matches first.

## Migrations

- Use the project's migration tool (migrate-mongo, a custom runner) with idempotent, batched, resumable scripts. Include a rollback, or document why there is none.
- Use the expand/contract pattern: write both fields, backfill, switch the reads, then remove the old field later.

## Testing

- Use `mongodb-memory-server` or a container per test file, never shared dev data. Clean collections in teardown.
- Test the injection case (an operator object as input), invalid ObjectIds, the tenant-scoping case and the concurrent update path.
