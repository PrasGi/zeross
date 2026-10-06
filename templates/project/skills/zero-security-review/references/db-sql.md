# Database: SQL (PostgreSQL, MySQL/MariaDB) and SQL ORMs

Team rule: parameterized queries always; never concatenate user input into SQL.

## Parameterization by API

| API | Safe | Injectable |
|---|---|---|
| node-postgres (`pg`) | `query('… WHERE id = $1', [id])` | template literal / `+` into the text |
| mysql2 | `execute('… = ?', [x])`, `query('… = ?', [x])` | string building; see object escaping below |
| Prisma | `` $queryRaw`… ${x}` `` (tagged template binds), `Prisma.sql` | `$queryRawUnsafe(str)`, `$executeRawUnsafe(str)`, `Prisma.raw(user)`, `$queryRaw(Prisma.raw(...))` |
| Drizzle | `` sql`… ${x}` ``, query builder | `sql.raw(user)` |
| Knex | builder, `raw('… ?', [x])`, `whereRaw('… ?', [x])` | `` raw(`… ${x}`) ``, `whereRaw` with interpolation |
| TypeORM | `.where('u.id = :id', { id })`, repository methods | `` .where(`u.id = ${id}`) ``, `query(str)`, `.orderBy(userInput)` |
| Sequelize | `replacements`/`bind` options, model methods | `` query(`… ${x}`) ``, `literal(user)`, `fn`/`col` with user input |
| Go `database/sql`/sqlx/pgx/GORM | `$1`/`?` args, `Where("a = ?", x)` | `fmt.Sprintf`, GORM string conditions/`Order`/`Raw` with input (see `stack-go.md`) |
| SQLAlchemy | `text("… :x").bindparams(x=…)`, ORM | `text(f"…")`, string `order_by` |
| Django | ORM, `raw(sql, params)`, `cursor.execute(sql, params)` | `extra()`, `RawSQL(f…)`, f-string/`%` in `execute` |
| Laravel | Eloquent/builder, `whereRaw('… ?', [$x])` | `DB::raw("… $x")`, `DB::select("… $x")`, raw methods with interpolation |
| JPA/JDBC | `:name`, `?1`, `PreparedStatement` | `createQuery(… + x)`, `createNativeQuery(… + x)`, `Statement.execute(… + x)` |

## Identifiers and clauses that cannot be bound

- [ ] `ORDER BY` column and direction, table/column names, `LIMIT`/`OFFSET` in some drivers, `IN (...)` lists built by hand, `INTERVAL` units, JSON path keys: map from an allowlist (`{ name: 'u.name', created: 'u.created_at' }[input]`), cast numerics, or use driver helpers (`pg-format` `%I`/`%L`, `sql.identifier`, Knex `.orderBy(col)` with allowlisted `col`).
- [ ] `IN` lists: generate placeholders (`$1,$2,…`), use `= ANY($1)` with an array in Postgres, `sqlx.In`, or builder `whereIn`.
- [ ] `LIKE` search: bind the value; escape `%` and `_` (and the escape char) from user input when literal matching is intended (otherwise `%` enables enumeration and slow scans).

## Driver and dialect traps

- [ ] **mysqljs / mysql2 object escaping**: with `query('… WHERE password = ?', [req.body.password])`, an object `{"password": 1}` expands to `` `password` = 1 ``, producing ``password = `password` = 1`` (always true in MySQL) → auth bypass. Fix: validate scalar types, or set `stringifyObjects: true` on the connection.
- [ ] **MySQL type coercion**: comparing a string column to a number (`WHERE token = 0`) casts strings to numbers; non-numeric strings become 0, so `0` matches them. Ensure parameters are strings for string columns (JSON bodies can send numbers).
- [ ] **Postgres**: dynamic SQL in PL/pgSQL `EXECUTE` must use `format('%I', …)` / `%L` or `USING` params; `SECURITY DEFINER` functions set `search_path`.
- [ ] Multiple statements enabled (`multipleStatements: true` in mysql) widens injection impact: flag it if any injectable query exists.
- [ ] Second-order injection: values read from the DB and concatenated into later queries.

## Authorization at the query

- [ ] Owner/tenant predicates in `WHERE` for every select, update and delete (`UPDATE … WHERE id = $1 AND tenant_id = $2`), checking affected rows.
- [ ] Joins do not pull rows from other tenants (`JOIN … ON … AND b.tenant_id = a.tenant_id`).
- [ ] Postgres Row-Level Security, if used: policies on all tenant tables, `FORCE ROW LEVEL SECURITY` for table owners, app role not `BYPASSRLS`/superuser, tenant set via `SET LOCAL` inside a transaction (plain `SET` leaks across pooled connections; PgBouncer transaction mode needs `SET LOCAL`).
- [ ] Views/materialized views exposing cross-tenant data.

## Transactions, locking and races

- [ ] Check-then-act sequences wrapped in a transaction with the right lock or an atomic conditional `UPDATE … WHERE … RETURNING` (see `business-logic.md`).
- [ ] `SELECT … FOR UPDATE` (or `FOR UPDATE SKIP LOCKED` for queues) inside the same transaction as the write.
- [ ] Unique constraints back "only once" rules; `INSERT … ON CONFLICT DO NOTHING/UPDATE` (Postgres) or `INSERT … ON DUPLICATE KEY UPDATE` (MySQL) instead of read-then-insert.
- [ ] Isolation: READ COMMITTED (Postgres default) / REPEATABLE READ (InnoDB default) do not prevent all anomalies; invariants across rows need explicit locks or SERIALIZABLE with retry.
- [ ] ORM transactions actually share the transaction client (Prisma interactive `$transaction(async (tx) => …)` uses `tx`, not the global client; TypeORM `manager` from the transaction; Sequelize `transaction` option passed to every call).

## Migrations in the diff

- [ ] No dropped constraints/indexes that enforced uniqueness or ownership without replacement.
- [ ] `GRANT` statements least-privilege; no `GRANT ALL … TO PUBLIC`.
- [ ] Backfills/data migrations do not log or expose PII; destructive steps (`DROP`, `TRUNCATE`, `DELETE` without `WHERE`) are intended and reversible or confirmed.
- [ ] New columns holding secrets/PII: encrypted or access-restricted per project policy.

## Errors, logging, limits

- [ ] SQL errors not returned to clients (leaks schema, aids injection).
- [ ] ORM query logging (`logging: true`, `show-sql`, `echo=True`) off in production or redacted (logs bound values).
- [ ] Pagination capped; expensive queries have `statement_timeout` / `max_execution_time` where user-driven.

## Connection and privileges

- [ ] Connection URL from env (`config.db.envVar`), never in code or committed config.
- [ ] TLS for remote DBs (`sslmode=verify-full` / `require`, MySQL `ssl` options); never `sslmode=disable` to a network host.
- [ ] App DB user is not superuser/owner; migrations run with a separate role when possible; read-only roles for reporting.
