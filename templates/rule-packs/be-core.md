# Backend core rules

Applies to: every backend app (`project.apps[].kind` = `backend` or `fullstack`), whatever the language.

> Strictness follows `rules.strictness`; comments follow `rules.commentPolicy`; tests follow `rules.testPolicy` (see `core.md`).

## Layering

- **Controller/handler → service → repository/data access.** Match the layering the app already uses.
  - Handlers: parse, validate, authorize and map the response.
  - Services: business rules and transactions.
  - Repositories: queries.
- Never put queries in handlers, or HTTP concerns (status codes, request objects) in services.
- Keep domain logic framework-light, so it can be tested without booting the app.
- Inject dependencies (constructor or DI container). No module-level mutable singletons for clients or state.

## Boundary validation

- Validate **every** external input at the boundary: body, query, params, headers, cookies, files, webhooks, queue messages, CLI args. Use the project's mandated library.
- Reject unknown fields, and enforce types, formats, enums, string lengths and numeric ranges. **Cap pagination** (`limit` ≤ a max, default page size).
- **Mass assignment:** map validated DTOs to entities explicitly. Never let a client set `id`, `role`, `ownerId`, `tenantId`, `isAdmin`, `status` transitions or prices.
- Never pass raw request objects into services.

## AuthN and AuthZ

- Every handler is authenticated unless it is explicitly public, and public routes are listed and justified.
- **Authorize on every handler and resource:**
  - Check ownership or tenancy for every client-supplied ID (IDOR/BOLA).
  - Check roles or permissions for privileged functions (BFLA).
  - Scope every query by tenant in multi-tenant apps.
- Use the existing guards, policies and middleware. Before adding a check, confirm the global ones don't already cover it, and don't duplicate them.
- Return 401 when unauthenticated, and 403 when forbidden (or 404 when the project hides existence). Be consistent.

## Errors

- Use typed, domain-level errors (`NotFoundError`, `ConflictError`, `ValidationError`), mapped to HTTP or gRPC status in one place (an error middleware, filter or handler).
- Use one consistent error shape across the API, e.g. `{ "error": { "code", "message", "details" } }`, or the project's existing shape.
- Never leak stack traces, SQL, internal IDs of other tenants, or library error messages to clients.
- Don't swallow errors. Wrap them with context and log once, at the boundary.

## Writes and consistency

- Multi-step writes that must be atomic go in a **transaction**.
- Prevent check-then-act races with unique constraints, conditional updates, row locks or optimistic versioning.
- **Idempotency for writes** that can be retried (payments, webhooks, job handlers, POSTs from flaky clients): idempotency keys, or natural unique keys.
- Money: use integer minor units or a decimal type. Never floats.
- Time: store UTC and accept and return ISO 8601. Be explicit about time zones in business rules.
- Make side effects (emails, webhooks, events) happen after commit: an outbox, or after-commit hooks.

## API contract

- Use correct methods and status codes: `201` with `Location` for creates, `204` for empty responses, `409` for conflicts, `422` for validation, `429` with `Retry-After`.
- **Backward compatibility:** add optional fields freely. Removing or renaming fields, changing types, or tightening validation needs versioning or a migration plan, flagged in the report.
- Keep the OpenAPI, GraphQL or proto contract and generated clients in sync in the same change.
- Use cursor pagination for large or live datasets, and always return the next cursor or page info.

## Logging and observability

- Structured logs (JSON or the project's logger) with a request or correlation ID. Use the existing logger, never `console.log` or `print` in committed code.
- **No PII or secrets in logs**: no passwords, tokens, full emails, phone numbers, card data or request bodies by default. Mask them.
- Log at the right level: `error` for actionable failures, `warn` for degraded states, `info` for business events, `debug` sparingly.

## Migrations

- Migrations are **backward compatible** with the currently deployed code (expand, then contract):
  - Add a nullable column, backfill it, then add the constraint.
  - Never rename or drop in the same deploy as the code change.
- Every migration is reversible, or documents why it isn't. Batch large backfills. Flag locking operations on big tables.
- Never edit an applied migration. Add a new one.

## Outbound calls

- Set timeouts on every outbound HTTP, DB and queue call. Retry only idempotent calls, with backoff and jitter.
- Allowlist outbound URLs built from user input (SSRF). Block private and metadata IP ranges.
- Verify webhook signatures (HMAC with a timing-safe compare) before parsing the payload.

## Testing

- Unit-test services with fakes at the repository and client boundary.
- Handler or integration tests per endpoint:
  - happy path
  - validation error
  - unauthenticated
  - forbidden or another tenant's resource
  - not found
  - conflict or idempotent retry where relevant
