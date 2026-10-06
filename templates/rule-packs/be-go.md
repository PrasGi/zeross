# Go backend rules

Applies to: Go services (net/http, chi, gin, echo, fiber, gRPC).

> Strictness follows `rules.strictness`; comments follow `rules.commentPolicy` (godoc on exported identifiers when `exported` or `every-component`); tests follow `rules.testPolicy`. Read with `be-core.md`.

## Style and layout

- Always `gofmt`/`goimports`. Code must pass the project's `golangci-lint` config.
- Layout:
  - `cmd/<svc>/main.go` stays thin: wiring and signals.
  - Business code goes in `internal/<domain>` (handler, service, repository).
  - Follow the existing package boundaries.
- Package names are short, lower-case and singular, with no `util`/`common` dumping grounds.
- `ctx context.Context` is the first parameter of any function doing I/O. Never store a ctx in a struct.
- No global mutable state. Inject dependencies through struct fields and constructors (`NewService(repo Repo, log *slog.Logger)`).
- Keep interfaces small and defined by the consumer. Accept interfaces, return structs.

## Errors

- Handle every error. **Never `_ =` an error** without a reason.
- Wrap with context: `fmt.Errorf("load order %s: %w", id, err)`. Compare with `errors.Is`/`errors.As`. Use sentinel errors (`ErrNotFound`) or typed errors for domain cases.
- Map domain errors to HTTP or gRPC status in one place: the handler helper or middleware, or the interceptor.
- `panic` is not an error path. A recover middleware logs and returns 500.

## HTTP and gRPC handlers

- Decode JSON with `json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))` and `DisallowUnknownFields()`, then validate (go-playground/validator, or the project's validator).
- Validate path and query params explicitly: parse IDs, cap `limit`, whitelist sort fields.
- Get the authenticated principal from context, set by auth middleware. Check ownership or tenancy in the service.
- Set server timeouts (`ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, `IdleTimeout`). Never use the default `http.Server{}` without them.
- Outbound: use a shared `http.Client` with a `Timeout`, and propagate `ctx` (`http.NewRequestWithContext`). Always close response bodies.
- gRPC: validate requests (protovalidate or explicit checks), return `status.Error(codes.X, …)`, and respect deadlines.

## Concurrency

- Every goroutine has an owner, an exit path and cancellation through `ctx`. No goroutine leaks.
- Use `errgroup.WithContext` for fan-out with errors, and bound concurrency (`g.SetLimit`, or a semaphore).
- Protect shared state with `sync.Mutex`. Don't copy structs containing a mutex.
- Channel direction in signatures (`<-chan`, `chan<-`). The sender closes the channel.
- **[strict]** Tests must pass with `-race` on the packages you touched.

## Data access

- `database/sql`, sqlx, pgx or sqlc: placeholders only (`$1`/`?`). Never `fmt.Sprintf` user input into SQL.
- Always `defer rows.Close()` and check `rows.Err()`. Pass `ctx` to every query (`QueryContext`, `ExecContext`).
- Transactions: `BeginTx(ctx, …)`, then `defer tx.Rollback()` (a no-op after commit), then `Commit()`.
- Mongo driver: typed filters (`bson.D`) built from validated values, never from raw decoded maps (see `db-mongo.md`).

## Logging and config

- `log/slog` (or the project's logger) with structured fields and the request ID. No PII or secrets.
- Load config from env once at startup into a typed struct, validated, and fail fast.

## Testing

- Use the standard `testing` package plus the project's assertion library (testify `require`/`assert`, if used).
- Table-driven tests with `t.Run(tc.name, …)`. Mark helpers with `t.Helper()` and use `t.Cleanup`.
- HTTP handlers: `httptest.NewRecorder` and `httptest.NewRequest`. Cover valid, invalid body, unauthenticated, forbidden, not found and conflict.
- Run only the touched packages, filtered to the relevant tests: `go test -race ./internal/orders/... -run 'TestCreateOrder'`, per `project.apps[].test.command`. Never `go test ./...` unless asked.
