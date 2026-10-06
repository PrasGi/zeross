# MySQL rules

Applies to: code, queries and migrations touching MySQL or MariaDB (raw SQL, Prisma, Drizzle, TypeORM, Knex, SQLAlchemy, Django ORM, Eloquent, JPA, GORM).

> Strictness follows `rules.strictness`. Working against a real DB through the DB MCP follows `.claude/zeross/workflow/data-safety.md`.

## Query safety

- **Parameterized queries only** (`?`, named bindings, ORM bindings). Never interpolate input into SQL, `ORDER BY`, `LIMIT` or identifiers. Allowlist sort columns and directions.
- Be aware of implicit type conversion: comparing a string column to a number disables the index and can match unexpected rows. Bind the correct types.
- Scope by owner or tenant in the `WHERE` clause itself.
- **Never run `UPDATE` or `DELETE` without a selective `WHERE`.** Count the matches first, and use `LIMIT` on batched deletes.

## Schema design

- InnoDB only. Use the `utf8mb4` charset with the project's collation (e.g. `utf8mb4_0900_ai_ci`). Never `utf8`/`utf8mb3` for user text.
- Primary keys follow the project's convention (`BIGINT UNSIGNED AUTO_INCREMENT`, or ordered UUIDs as `BINARY(16)`). Avoid random UUID strings as a clustered PK on hot tables.
- Use `DATETIME(3)`/`TIMESTAMP(3)` consistently, store UTC, and know `TIMESTAMP`'s 2038 limit and session time-zone conversion.
- Money uses `DECIMAL(p,s)` or integer minor units. Never `FLOAT`/`DOUBLE`.
- Enforce invariants with `NOT NULL`, `UNIQUE`, `CHECK` (MySQL 8.0.16+), and foreign keys with an explicit `ON DELETE`, when the project uses FKs. Some sharded setups don't; follow the project.
- Run with strict SQL mode (`STRICT_TRANS_TABLES`). Never rely on silent truncation.

## Indexes

- Index every foreign key column and every column in common `WHERE`, `JOIN` and `ORDER BY` clauses. Composite indexes follow the leftmost-prefix rule: equality columns first, then range or sort columns.
- Watch the index length limit on `utf8mb4` `VARCHAR`. Use prefix indexes only when the selectivity is known.
- Check non-trivial queries with `EXPLAIN` / `EXPLAIN ANALYZE` (8.0.18+), and only against **local** data unless the user grants more. Avoid `type: ALL` on big tables, `Using filesort`, and `Using temporary` in hot paths.

## N+1 and fetching

- Eager-load or batch relations. Never query in a loop. Select only the needed columns; no `SELECT *` in app queries.
- Always use `LIMIT`. Prefer keyset pagination (`WHERE id > ? ORDER BY id LIMIT ?`) over large `OFFSET`.

## Transactions and locking

- Multi-step writes go in a transaction. Keep it short, with no external calls inside.
- The default isolation is `REPEATABLE READ`. Gap and next-key locks can deadlock range updates, so retry on deadlock (`1213`) and lock-wait timeout (`1205`) with backoff.
- Prevent races with:
  - `UNIQUE` plus `INSERT … ON DUPLICATE KEY UPDATE` (or the ORM upsert), or idempotency keys
  - conditional updates (`UPDATE … WHERE status = 'pending'`, then check affected rows)
  - `SELECT … FOR UPDATE` (`SKIP LOCKED` for queues, 8.0+)
  - optimistic `version` columns
- Never mix transactional and non-transactional engines.

## Migrations

- Use the project's tool (Laravel, Django, Alembic, Prisma, Knex, Flyway, Liquibase, goose). **Never edit an applied migration.**
- Keep them **backward compatible** (expand/contract): add a nullable column, backfill in batches, then add the constraint. Renames and drops span several deploys.
- Know which DDL is online (`ALGORITHM=INSTANT/INPLACE, LOCK=NONE`) and which copies the table. Flag table-copying `ALTER`s on large tables. Recommend the project's online schema tool (gh-ost, pt-online-schema-change) when it applies.
- DDL commits implicitly. A failed multi-statement migration is not rolled back, so keep one logical change per migration.
- Every migration has a down step, or a documented reason why not.

## Testing

- Run integration tests against real MySQL (Testcontainers or a local test DB) with a transaction rolled back per test, or truncation.
- Test duplicate-key handling (→ 409), tenant scoping, the concurrent update path, and collation-sensitive comparisons (case, accents) where the logic depends on them.
