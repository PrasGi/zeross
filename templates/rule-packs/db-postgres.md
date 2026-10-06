# PostgreSQL rules

Applies to: code, queries and migrations touching PostgreSQL (raw SQL, Prisma, Drizzle, TypeORM, Knex, SQLAlchemy, Django ORM, Eloquent, JPA, sqlc/pgx).

> Strictness follows `rules.strictness`. Working against a real DB through the DB MCP follows `.claude/zeross/workflow/data-safety.md`.

## Query safety

- **Parameterized queries only** (`$1`, `:name`, ORM bindings). Never interpolate or concatenate input, including into `ORDER BY`, `LIMIT` or identifiers. Allowlist sort columns and directions.
- Raw SQL helpers must use their safe forms: `Prisma.sql`/`$queryRaw` template, Drizzle `sql` template, Knex `?` bindings, SQLAlchemy `text()` with params.
- Scope by owner or tenant in the `WHERE` clause itself. If the project uses row-level security, set the tenant context per transaction.
- **Never run `UPDATE` or `DELETE` without a selective `WHERE`.** Count the affected rows first for bulk operations.

## Schema design

- Primary keys follow the project's convention (`uuid`/UUIDv7, `bigint generated always as identity`). Don't mix conventions within one schema.
- Use `timestamptz` (never `timestamp` without a time zone) for points in time. Add `created_at` and `updated_at` with defaults.
- Money uses `numeric(p,s)` or integer minor units. Never `float`/`real`/`money`.
- Text uses `text` with `CHECK` constraints for limits, unless the project uses `varchar(n)`. Enums use Postgres enums or `CHECK`, per the project.
- Enforce invariants in the DB: `NOT NULL`, `UNIQUE` (including partial unique indexes for soft delete, e.g. `WHERE deleted_at IS NULL`), `CHECK`, and foreign keys with an explicit `ON DELETE`.
- `jsonb` only for truly schemaless data. Index the paths you query (GIN or expression indexes).

## Indexes

- Index every foreign key column and every column used in common `WHERE`, `JOIN` and `ORDER BY` clauses.
- Composite order: equality columns first, then range or sort columns. Use partial indexes for filtered hot queries.
- Check non-trivial queries with `EXPLAIN (ANALYZE, BUFFERS)` on realistic data, and only against **local** data unless the user grants more. Avoid seq scans on large tables.
- Create indexes with `CREATE INDEX CONCURRENTLY` on existing large tables. It can't run inside a transaction, so configure the migration accordingly.

## N+1 and fetching

- Load relations eagerly or batched (`include`, `with`, `selectinload`, `JOIN FETCH`, DataLoader). Never query inside a loop over rows.
- Select only the needed columns. No `SELECT *` in application queries. Always `LIMIT`; use keyset pagination for large or live tables.

## Transactions and locking

- Wrap multi-step writes in a transaction. Keep transactions short, with no network calls inside.
- Prevent races with:
  - `UNIQUE` plus `ON CONFLICT` (upsert or idempotency keys)
  - conditional updates (`UPDATE … WHERE status = 'pending' RETURNING *`)
  - `SELECT … FOR UPDATE` (or `SKIP LOCKED` for queues)
  - optimistic `version` columns
- Know the isolation level. Use `SERIALIZABLE` or `REPEATABLE READ` only with retry logic for serialization failures (`40001`).
- Set `statement_timeout` and `lock_timeout` for migrations and long jobs, per the project's convention.

## Migrations

- Use the project's tool (Prisma Migrate, Drizzle Kit, Knex, Alembic, Django, Laravel, Flyway, Liquibase, goose, Atlas). **Never edit an applied migration.**
- Keep them **backward compatible** with the deployed code (expand/contract):
  - Add a column: nullable, or with a constant default (instant on PG 11+).
  - Add `NOT NULL`: add a `CHECK … NOT VALID`, then `VALIDATE`, then `SET NOT NULL`.
  - Add a foreign key: `NOT VALID` first, then `VALIDATE CONSTRAINT`.
  - Rename or drop: a new column, then dual-write and backfill, then switch the reads, then drop in a later deploy.
- Batch large backfills (by primary key ranges), outside the schema-change transaction.
- Flag anything that takes an `ACCESS EXCLUSIVE` lock on a large table: column type changes, non-concurrent indexes, `VACUUM FULL`.
- Every migration has a down step, or a documented reason why not.

## Testing

- Run integration tests against real Postgres (Testcontainers or a local test DB) with a transaction rolled back per test, or truncation. Never mock SQL semantics.
- Test unique-violation handling (→ 409), tenant scoping, the concurrent update path and the migration up/down on a fresh DB, when migrations change.
